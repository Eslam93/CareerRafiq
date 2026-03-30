import type { DuplicateResolutionDecision, EvaluationResult, Job, TrackerItem, TrackerStatus, VerdictDecisionState } from '@career-rafiq/contracts';
import { createId, nowIso, unique } from './helpers.js';
import { buildTrackerNextAction, createReviewRequiredTrackerNextAction } from './next-actions.js';

function createDefaultDuplicateResolution(): TrackerItem['duplicateResolution'] {
  return {
    decision: 'pending',
    duplicateJobId: null,
    dismissedJobIds: [],
    resolvedAt: null,
  };
}

function appendDecisionHistory(
  trackerItem: TrackerItem,
  entry: Omit<TrackerItem['decisionHistory'][number], 'id'>,
): TrackerItem['decisionHistory'] {
  return [
    ...trackerItem.decisionHistory,
    {
      id: createId('trkdh'),
      ...entry,
    },
  ];
}

export function createTrackerItem(job: Job, evaluation: EvaluationResult | null, clock: () => Date = () => new Date()): TrackerItem {
  return {
    id: createId('trk'),
    userId: job.userId,
    jobId: job.id,
    currentStatus: 'saved',
    notes: '',
    manualOverrides: {},
    userSelectedCvId: null,
    recommendedCvDecision: 'pending',
    verdictDecision: 'pending',
    activeEvaluationId: evaluation?.id ?? null,
    historicalEvaluationIds: [],
    recommendationSnapshot: evaluation
      ? {
          recommendedCvId: evaluation.recommendedCvId,
          verdict: evaluation.verdict,
          totalScore: evaluation.totalScore,
        }
      : null,
    nextActionSnapshot: evaluation?.nextAction ?? (job.jobExtractionState === 'review_required' ? createReviewRequiredTrackerNextAction() : null),
    probableDuplicateJobIds: [],
    duplicateResolution: createDefaultDuplicateResolution(),
    decisionHistory: [],
    createdAt: nowIso(clock),
    updatedAt: nowIso(clock),
    archivedAt: null,
  };
}

export function updateTrackerFromEvaluation(trackerItem: TrackerItem, evaluation: EvaluationResult, clock: () => Date = () => new Date()): TrackerItem {
  const recommendationChanged = trackerItem.recommendationSnapshot?.recommendedCvId !== evaluation.recommendedCvId;
  const verdictChanged = trackerItem.recommendationSnapshot?.verdict !== evaluation.verdict;
  const shouldPreserveRecommendationOverride = trackerItem.recommendedCvDecision === 'overridden' && Boolean(trackerItem.userSelectedCvId);
  const shouldPreserveVerdictOverride = trackerItem.verdictDecision === 'overridden';
  const nextHistoricalIds = unique(
    trackerItem.activeEvaluationId && trackerItem.activeEvaluationId !== evaluation.id
      ? [...trackerItem.historicalEvaluationIds, trackerItem.activeEvaluationId]
      : trackerItem.historicalEvaluationIds,
  );

  return {
    ...trackerItem,
    userSelectedCvId: recommendationChanged && !shouldPreserveRecommendationOverride ? null : trackerItem.userSelectedCvId,
    recommendedCvDecision:
      recommendationChanged && !shouldPreserveRecommendationOverride
        ? 'pending'
        : trackerItem.recommendedCvDecision,
    verdictDecision:
      verdictChanged && !shouldPreserveVerdictOverride
        ? 'pending'
        : trackerItem.verdictDecision,
    activeEvaluationId: evaluation.id,
    historicalEvaluationIds: nextHistoricalIds,
    recommendationSnapshot: {
      recommendedCvId: evaluation.recommendedCvId,
      verdict: evaluation.verdict,
      totalScore: evaluation.totalScore,
    },
    nextActionSnapshot: buildTrackerNextAction({
      currentStatus: trackerItem.currentStatus,
      evaluationNextAction: evaluation.nextAction,
      recommendationDecision:
        recommendationChanged && !shouldPreserveRecommendationOverride
          ? 'pending'
          : trackerItem.recommendedCvDecision,
      hasRecommendedCv: Boolean(evaluation.recommendedCvId),
    }),
    updatedAt: nowIso(clock),
  };
}

export function patchTrackerStatus(
  trackerItem: TrackerItem,
  status: TrackerStatus,
  activeEvaluation: EvaluationResult | null,
  clock: () => Date = () => new Date(),
): TrackerItem {
  return {
    ...trackerItem,
    currentStatus: status,
    nextActionSnapshot: buildTrackerNextAction({
      currentStatus: status,
      evaluationNextAction: activeEvaluation?.nextAction ?? null,
      recommendationDecision: trackerItem.recommendedCvDecision,
      hasRecommendedCv: Boolean(trackerItem.recommendationSnapshot?.recommendedCvId),
    }),
    updatedAt: nowIso(clock),
  };
}

export function patchTrackerRecommendationDecision(
  trackerItem: TrackerItem,
  decision: 'pending' | 'accepted' | 'overridden',
  selectedCvId: string | null,
  activeEvaluation: EvaluationResult | null,
  clock: () => Date = () => new Date(),
): TrackerItem {
  const timestamp = nowIso(clock);
  return {
    ...trackerItem,
    userSelectedCvId: decision === 'pending' ? null : selectedCvId,
    recommendedCvDecision: decision,
    decisionHistory: appendDecisionHistory(trackerItem, {
      type: 'recommendation',
      action: decision === 'pending' ? 'reset' : decision,
      timestamp,
      evaluationId: activeEvaluation?.id ?? trackerItem.activeEvaluationId,
      summary:
        decision === 'pending'
          ? 'Reset recommendation trust decision to the latest system output.'
          : decision === 'accepted'
            ? 'Accepted the system CV recommendation.'
            : 'Overrode the system CV recommendation.',
      metadata: {
        previousDecision: trackerItem.recommendedCvDecision,
        previousSelectedCvId: trackerItem.userSelectedCvId,
        selectedCvId: decision === 'pending' ? null : selectedCvId,
        recommendedCvId: trackerItem.recommendationSnapshot?.recommendedCvId ?? null,
      },
    }),
    nextActionSnapshot: buildTrackerNextAction({
      currentStatus: trackerItem.currentStatus,
      evaluationNextAction: activeEvaluation?.nextAction ?? null,
      recommendationDecision: decision,
      hasRecommendedCv: Boolean(trackerItem.recommendationSnapshot?.recommendedCvId),
    }),
    updatedAt: timestamp,
  };
}

export function patchTrackerVerdictDecision(
  trackerItem: TrackerItem,
  decision: VerdictDecisionState,
  activeEvaluation: EvaluationResult | null,
  clock: () => Date = () => new Date(),
): TrackerItem {
  const timestamp = nowIso(clock);
  return {
    ...trackerItem,
    verdictDecision: decision,
    decisionHistory: appendDecisionHistory(trackerItem, {
      type: 'verdict',
      action: decision === 'pending' ? 'reset' : decision,
      timestamp,
      evaluationId: activeEvaluation?.id ?? trackerItem.activeEvaluationId,
      summary:
        decision === 'pending'
          ? 'Reset verdict trust decision to the latest system output.'
          : decision === 'followed'
            ? 'Followed the system verdict.'
            : 'Overrode the system verdict.',
      metadata: {
        previousDecision: trackerItem.verdictDecision,
        verdict: trackerItem.recommendationSnapshot?.verdict ?? null,
      },
    }),
    nextActionSnapshot: buildTrackerNextAction({
      currentStatus: trackerItem.currentStatus,
      evaluationNextAction: activeEvaluation?.nextAction ?? null,
      recommendationDecision: trackerItem.recommendedCvDecision,
      hasRecommendedCv: Boolean(trackerItem.recommendationSnapshot?.recommendedCvId),
    }),
    updatedAt: timestamp,
  };
}

export function patchTrackerDuplicateResolution(
  trackerItem: TrackerItem,
  decision: DuplicateResolutionDecision,
  duplicateJobId: string | null,
  clock: () => Date = () => new Date(),
): TrackerItem {
  const timestamp = nowIso(clock);
  const dismissedJobIds = decision === 'pending'
    ? trackerItem.duplicateResolution.dismissedJobIds
    : unique([
        ...trackerItem.duplicateResolution.dismissedJobIds,
        ...trackerItem.probableDuplicateJobIds.filter((jobId) => jobId !== duplicateJobId),
      ]);
  return {
    ...trackerItem,
    probableDuplicateJobIds: decision === 'pending' ? trackerItem.probableDuplicateJobIds : [],
    duplicateResolution: {
      decision,
      duplicateJobId: decision === 'duplicate_confirmed' ? duplicateJobId : null,
      dismissedJobIds,
      resolvedAt: decision === 'pending' ? null : timestamp,
    },
    decisionHistory: appendDecisionHistory(trackerItem, {
      type: 'duplicate',
      action: decision === 'pending' ? 'reset' : decision,
      timestamp,
      evaluationId: trackerItem.activeEvaluationId,
      summary:
        decision === 'pending'
          ? 'Reset duplicate review state.'
          : decision === 'duplicate_confirmed'
            ? 'Marked this opportunity as a duplicate of another tracker item.'
            : 'Confirmed this opportunity should remain separate from similar items.',
      metadata: {
        duplicateJobId,
        previousDecision: trackerItem.duplicateResolution.decision,
        previousDuplicateJobId: trackerItem.duplicateResolution.duplicateJobId,
        dismissedJobIds,
      },
    }),
    updatedAt: timestamp,
  };
}
