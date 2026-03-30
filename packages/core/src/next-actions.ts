import type { NextAction, RecommendationDecisionState, TrackerStatus, Verdict } from '@career-rafiq/contracts';

function createNextAction(code: NextAction['code'], rationale: string): NextAction {
  const labels: Record<NextAction['code'], string> = {
    review_job_data: 'Review job data',
    review_fit_before_applying: 'Review fit before applying',
    review_major_gaps_before_applying: 'Review major gaps before applying',
    accept_or_override_recommended_cv: 'Choose which CV to use',
    archive_and_move_on: 'Archive and move on',
    record_offer_decision: 'Record offer decision',
    update_after_interview: 'Update after interview',
    mark_process_progress: 'Mark process progress',
    apply_with_selected_cv: 'Apply with selected CV',
  };

  return {
    code,
    label: labels[code],
    rationale,
  };
}

export function buildEvaluationNextAction(input: {
  reviewGateStatus: 'proceed' | 'review_required' | 'failed';
  verdict: Verdict | null;
  recommendedCvId: string | null;
  majorGapsSummary: string[];
}): NextAction | null {
  if (input.reviewGateStatus !== 'proceed') {
    return createNextAction('review_job_data', 'The extracted job data needs review before a final verdict is safe to use.');
  }

  if (!input.recommendedCvId) {
    return createNextAction('review_fit_before_applying', 'No recommended CV was available, so the fit needs review before applying.');
  }

  if (input.verdict === 'apply') {
    if (input.majorGapsSummary.length > 0) {
      return createNextAction('review_major_gaps_before_applying', 'The role looks strong overall, but the major gaps should be reviewed before applying.');
    }
    return createNextAction('accept_or_override_recommended_cv', 'A recommended CV is available and should be confirmed before applying.');
  }

  if (input.verdict === 'consider') {
    return createNextAction('review_fit_before_applying', 'The role is viable but should be reviewed before deciding to apply.');
  }

  if (input.verdict === 'skip') {
    return createNextAction('archive_and_move_on', 'The current fit is weak enough that the default next step is to archive the opportunity.');
  }

  return createNextAction('review_fit_before_applying', 'The fit needs review before taking the next step.');
}

export function buildTrackerNextAction(input: {
  currentStatus: TrackerStatus;
  evaluationNextAction: NextAction | null;
  recommendationDecision: RecommendationDecisionState;
  hasRecommendedCv: boolean;
}): NextAction | null {
  if (input.currentStatus === 'rejected' || input.currentStatus === 'archived_not_pursuing') {
    return createNextAction('archive_and_move_on', 'This opportunity is already closed out in the tracker.');
  }

  if (input.currentStatus === 'offer') {
    return createNextAction('record_offer_decision', 'An offer exists, so the next step is to record the final decision.');
  }

  if (input.currentStatus === 'interviewing') {
    return createNextAction('update_after_interview', 'The process is in interview stage, so the next step is to record progress after each round.');
  }

  if (input.currentStatus === 'applied') {
    return createNextAction('mark_process_progress', 'The application is already submitted, so the next step is to track process progress.');
  }

  if (input.hasRecommendedCv && input.recommendationDecision === 'pending') {
    return createNextAction('accept_or_override_recommended_cv', 'A recommended CV is available and still needs an explicit decision.');
  }

  if (input.hasRecommendedCv && input.recommendationDecision !== 'pending') {
    return createNextAction('apply_with_selected_cv', 'A CV has already been chosen, so the next step is to apply with that selection.');
  }

  return input.evaluationNextAction;
}

export function createReviewRequiredTrackerNextAction(): NextAction {
  return createNextAction('review_job_data', 'The captured job needs correction before evaluation can continue.');
}
