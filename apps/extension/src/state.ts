import type { EvaluationResult, TrackerItem } from '@career-rafiq/contracts';

export type ExtensionViewStatus =
  | 'idle'
  | 'loading'
  | 'result'
  | 'review_required'
  | 'unsupported_page'
  | 'error';

export interface ExtensionQuickResultState {
  verdict: EvaluationResult['verdict'];
  recommendedCvId: string | null;
  recommendedCvName: string | null;
  conciseExplanation: string;
  majorGapsSummary: string[];
  reviewGateStatus: EvaluationResult['reviewGateStatus'];
  trackerItem: TrackerItem | null;
}

export interface ExtensionShellState {
  status: ExtensionViewStatus;
  quickResult: ExtensionQuickResultState | null;
  reviewReasons: string[];
  errorMessage: string | null;
  pageUrl: string | null;
  jobId: string | null;
  unsupportedReason: string | null;
  requestId: string | null;
  eyeSessionId: string | null;
  updatedAt: string;
}

export type ExtensionShellEvent =
  | { type: 'CAPTURE_STARTED'; pageUrl: string; eyeSessionId?: string | null }
  | { type: 'CAPTURE_FAILED'; message: string; jobId?: string | null; requestId?: string | null; eyeSessionId?: string | null }
  | { type: 'UNSUPPORTED_PAGE'; reason?: string; pageUrl?: string; requestId?: string | null; eyeSessionId?: string | null }
  | { type: 'REVIEW_REQUIRED'; quickResult: ExtensionQuickResultState | null; reasons: string[]; jobId: string | null; requestId?: string | null; eyeSessionId?: string | null }
  | { type: 'EVALUATION_READY'; quickResult: ExtensionQuickResultState; jobId: string | null; requestId?: string | null; eyeSessionId?: string | null }
  | { type: 'RESET' };

function nowIso(): string {
  return new Date().toISOString();
}

export function createInitialExtensionState(): ExtensionShellState {
  return {
    status: 'idle',
    quickResult: null,
    reviewReasons: [],
    errorMessage: null,
    pageUrl: null,
    jobId: null,
    unsupportedReason: null,
    requestId: null,
    eyeSessionId: null,
    updatedAt: nowIso(),
  };
}

export function reduceExtensionState(
  current: ExtensionShellState,
  event: ExtensionShellEvent,
): ExtensionShellState {
  switch (event.type) {
    case 'CAPTURE_STARTED':
      return {
        ...current,
        status: 'loading',
        quickResult: null,
        reviewReasons: [],
        errorMessage: null,
        unsupportedReason: null,
        pageUrl: event.pageUrl,
        jobId: null,
        requestId: null,
        eyeSessionId: event.eyeSessionId ?? current.eyeSessionId,
        updatedAt: nowIso(),
      };
    case 'CAPTURE_FAILED':
      return {
        ...current,
        status: 'error',
        quickResult: null,
        reviewReasons: [],
        errorMessage: event.message,
        jobId: event.jobId ?? null,
        unsupportedReason: null,
        requestId: event.requestId ?? current.requestId,
        eyeSessionId: event.eyeSessionId ?? current.eyeSessionId,
        updatedAt: nowIso(),
      };
    case 'UNSUPPORTED_PAGE':
      return {
        ...current,
        status: 'unsupported_page',
        quickResult: null,
        reviewReasons: [],
        errorMessage: null,
        unsupportedReason: event.reason ?? 'This page is not supported yet.',
        pageUrl: event.pageUrl ?? current.pageUrl,
        jobId: null,
        requestId: event.requestId ?? current.requestId,
        eyeSessionId: event.eyeSessionId ?? current.eyeSessionId,
        updatedAt: nowIso(),
      };
    case 'REVIEW_REQUIRED':
      return {
        ...current,
        status: 'review_required',
        quickResult: event.quickResult,
        reviewReasons: event.reasons,
        errorMessage: null,
        jobId: event.jobId,
        unsupportedReason: null,
        requestId: event.requestId ?? current.requestId,
        eyeSessionId: event.eyeSessionId ?? current.eyeSessionId,
        updatedAt: nowIso(),
      };
    case 'EVALUATION_READY':
      return {
        ...current,
        status: 'result',
        quickResult: event.quickResult,
        reviewReasons: [],
        errorMessage: null,
        jobId: event.jobId,
        unsupportedReason: null,
        requestId: event.requestId ?? current.requestId,
        eyeSessionId: event.eyeSessionId ?? current.eyeSessionId,
        updatedAt: nowIso(),
      };
    case 'RESET':
      return createInitialExtensionState();
    default:
      return current;
  }
}

export function createQuickResultFromEvaluation(
  evaluation: EvaluationResult,
  trackerItem: TrackerItem | null,
  recommendedCvName: string | null = null,
): ExtensionQuickResultState {
  return {
    verdict: evaluation.verdict,
    recommendedCvId: evaluation.recommendedCvId,
    recommendedCvName,
    conciseExplanation: evaluation.conciseExplanation,
    majorGapsSummary: evaluation.majorGapsSummary,
    reviewGateStatus: evaluation.reviewGateStatus,
    trackerItem,
  };
}
