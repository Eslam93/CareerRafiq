import type { CapturePageResponse, EvaluateJobResponse, ExtractPageRequest } from '@career-rafiq/contracts';
import { ExtensionApiError, type ExtensionApiClient } from './api-client.js';
import { createQuickResultFromEvaluation, type ExtensionQuickResultState, type ExtensionShellEvent } from './state.js';

export interface ExtensionRuntimeTarget {
  dispatch: (event: ExtensionShellEvent) => void;
}

export interface ExtensionRuntimeCaptureInput {
  pageUrl: string;
  pageContent: string;
  sourceIdentifier?: ExtractPageRequest['sourceIdentifier'];
}

export interface ExtensionRuntimeCaptureOutput {
  quickResult: ExtensionQuickResultState | null;
  reviewRequired: boolean;
  jobId: string | null;
}

export interface ExtensionRuntime {
  captureAndEvaluate: (input: ExtensionRuntimeCaptureInput) => Promise<ExtensionRuntimeCaptureOutput>;
  reset: () => void;
}

function buildReviewReasons(capture: CapturePageResponse): string[] {
  const reasons = capture.validation.reasons;
  if (reasons.length > 0) return reasons;
  return ['Capture requires manual review before final verdict.'];
}

function buildUnsupportedReason(extractionNotes: string[]): string {
  return extractionNotes[0] ?? 'This page is not supported yet. Use manual paste fallback.';
}

function assertEvaluableJob(capture: CapturePageResponse): asserts capture is CapturePageResponse & { job: NonNullable<CapturePageResponse['job']> } {
  if (!capture.job) {
    throw new Error('Capture did not produce a job record.');
  }
}

function assertEvaluationReady(evaluated: EvaluateJobResponse): asserts evaluated is EvaluateJobResponse & {
  evaluation: NonNullable<EvaluateJobResponse['evaluation']>;
} {
  if (!evaluated.evaluation) {
    throw new Error('Evaluation response is missing the evaluation payload.');
  }
}

export function createExtensionRuntime(target: ExtensionRuntimeTarget, apiClient: ExtensionApiClient): ExtensionRuntime {
  async function recordClientEvent(
    code: string,
    summary: string,
    payload: Record<string, unknown> = {},
    severity: 'info' | 'warning' | 'error' = 'info',
  ): Promise<void> {
    if (!apiClient.getEyeSessionId()) {
      return;
    }
    try {
      await apiClient.recordClientDiagnosticEvent({
        area: 'extension',
        stage: 'runtime',
        code,
        severity,
        summary,
        requestId: apiClient.getLastRequestId(),
        payload,
        clientSurface: 'extension',
      });
    } catch {
      // Keep diagnostics best-effort so manual testing never blocks on Eye writes.
    }
  }

  return {
    async captureAndEvaluate(input) {
      target.dispatch({ type: 'CAPTURE_STARTED', pageUrl: input.pageUrl, eyeSessionId: apiClient.getEyeSessionId() });
      await recordClientEvent('extension_capture_clicked', 'Extension capture started.', {
        pageUrl: input.pageUrl,
        sourceIdentifier: input.sourceIdentifier ?? null,
      });

      try {
        const capture = await apiClient.capturePage({
          sourceUrl: input.pageUrl,
          pageContent: input.pageContent,
          ...(input.sourceIdentifier ? { sourceIdentifier: input.sourceIdentifier } : {}),
        });

        if (!capture.supported) {
          await recordClientEvent('extension_capture_unsupported_page', 'Captured page is unsupported.', {
            pageUrl: input.pageUrl,
            extractionNotes: capture.extraction.extractionNotes,
          }, 'warning');
          target.dispatch({
            type: 'UNSUPPORTED_PAGE',
            pageUrl: input.pageUrl,
            reason: buildUnsupportedReason(capture.extraction.extractionNotes),
            requestId: apiClient.getLastRequestId(),
            eyeSessionId: apiClient.getEyeSessionId(),
          });
          return { quickResult: null, reviewRequired: true, jobId: null };
        }

        const jobId = capture.job?.id ?? capture.trackerItem?.jobId ?? null;
        if (capture.validation.status === 'failed') {
          await recordClientEvent('extension_capture_failed_validation', 'Capture failed validation and needs manual correction.', {
            jobId,
            reasons: capture.validation.reasons,
          }, 'warning');
          target.dispatch({
            type: 'CAPTURE_FAILED',
            jobId,
            message: capture.validation.reasons[0] ?? 'Extraction failed and needs manual correction.',
            requestId: apiClient.getLastRequestId(),
            eyeSessionId: apiClient.getEyeSessionId(),
          });
          return { quickResult: null, reviewRequired: true, jobId };
        }

        if (capture.validation.status === 'review_required') {
          await recordClientEvent('extension_capture_review_required', 'Capture requires review before verdict.', {
            jobId,
            reasons: buildReviewReasons(capture),
          }, 'warning');
          target.dispatch({
            type: 'REVIEW_REQUIRED',
            quickResult: null,
            reasons: buildReviewReasons(capture),
            jobId,
            requestId: apiClient.getLastRequestId(),
            eyeSessionId: apiClient.getEyeSessionId(),
          });
          return { quickResult: null, reviewRequired: true, jobId };
        }

        assertEvaluableJob(capture);
        const evaluated = await apiClient.evaluateJob({ jobId: capture.job.id });
        assertEvaluationReady(evaluated);

        const quickResult = createQuickResultFromEvaluation(
          evaluated.evaluation,
          evaluated.trackerItem,
          evaluated.recommendedCvName ?? null,
        );
        const reviewRequired = evaluated.evaluation.reviewGateStatus === 'review_required';
        const analyticsProperties = {
          jobId: evaluated.evaluation.jobId,
          ...(evaluated.trackerItem?.id ? { trackerItemId: evaluated.trackerItem.id } : {}),
          evaluationVersion: evaluated.evaluation.evaluationVersion,
          verdict: evaluated.evaluation.verdict,
          ...(evaluated.evaluation.recommendedCvId ? { recommendedCvId: evaluated.evaluation.recommendedCvId } : {}),
        };

        if (reviewRequired) {
          await recordClientEvent('extension_evaluation_review_required', 'Evaluation remained review-gated.', {
            jobId: capture.job.id,
            reviewReasons: buildReviewReasons(capture),
          }, 'warning');
          target.dispatch({
            type: 'REVIEW_REQUIRED',
            quickResult,
            reasons: buildReviewReasons(capture),
            jobId: capture.job.id,
            requestId: apiClient.getLastRequestId(),
            eyeSessionId: apiClient.getEyeSessionId(),
          });
          return { quickResult, reviewRequired: true, jobId: capture.job.id };
        }

        await apiClient.trackAnalyticsEvent('verdict_shown', analyticsProperties);
        if (evaluated.evaluation.recommendedCvId) {
          await apiClient.trackAnalyticsEvent('recommended_cv_shown', analyticsProperties);
        }

        target.dispatch({
          type: 'EVALUATION_READY',
          quickResult,
          jobId: capture.job.id,
          requestId: apiClient.getLastRequestId(),
          eyeSessionId: apiClient.getEyeSessionId(),
        });
        await recordClientEvent('extension_evaluation_ready', 'Evaluation completed successfully in the extension.', {
          jobId: capture.job.id,
          verdict: evaluated.evaluation.verdict,
          recommendedCvId: evaluated.evaluation.recommendedCvId,
        });
        return { quickResult, reviewRequired: false, jobId: capture.job.id };
      } catch (error) {
        if (error instanceof ExtensionApiError && error.status === 401) {
          await recordClientEvent('extension_capture_unauthorized', 'Extension capture hit an unauthorized response.', {
            pageUrl: input.pageUrl,
          }, 'warning');
          throw error;
        }
        const message = error instanceof Error ? error.message : 'Unexpected runtime error.';
        target.dispatch({
          type: 'CAPTURE_FAILED',
          message,
          requestId: error instanceof ExtensionApiError ? error.requestId : apiClient.getLastRequestId(),
          eyeSessionId: apiClient.getEyeSessionId(),
        });
        await recordClientEvent('extension_capture_failed', 'Extension capture failed unexpectedly.', {
          pageUrl: input.pageUrl,
          error: message,
        }, 'error');
        return { quickResult: null, reviewRequired: true, jobId: null };
      }
    },
    reset() {
      target.dispatch({ type: 'RESET' });
    },
  };
}
