import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TrackerStatus } from '@career-rafiq/contracts';
import { Link, useParams } from 'react-router-dom';
import { getStoredEyeSessionId, webApiClient } from '../api-client.js';
import {
  useAddTrackerNoteMutation,
  useRecordClientDiagnosticEventMutation,
  useResolveTrackerDuplicateMutation,
  useTrackerDetailQuery,
  useUpdateTrackerRecommendationMutation,
  useUpdateTrackerStatusMutation,
  useUpdateTrackerVerdictMutation,
} from '../api-hooks.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { jobReviewPath, trackerDetailPath } from '../route-paths.js';
import { toErrorMessage } from '../utils/text.js';

const trackerStatusOptions: TrackerStatus[] = [
  'saved',
  'considering',
  'applied',
  'interviewing',
  'rejected',
  'offer',
  'archived_not_pursuing',
];

function SummaryPill(props: { label: string; value: string; tone: 'good' | 'warning' | 'neutral' }) {
  return (
    <div className={`pill pill--${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function formatLabel(value: string | null | undefined) {
  if (!value) return 'n/a';
  return value.replaceAll('_', ' ');
}

function formatNextAction(
  nextAction:
    | {
        code: string;
        label: string;
        rationale: string;
      }
    | null
    | undefined,
) {
  if (!nextAction) return 'n/a';
  return `${nextAction.label} (${nextAction.code})`;
}

function renderList(items: readonly string[]) {
  if (items.length === 0) return 'None';
  return items.join(', ');
}

function renderTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) return 'n/a';
  return new Date(timestamp).toLocaleString();
}

function formatCvName(
  cvId: string | null | undefined,
  availableCvs: Array<{ cvId: string; cvName: string }>,
) {
  if (!cvId) return 'n/a';
  return availableCvs.find((cv) => cv.cvId === cvId)?.cvName ?? cvId;
}

export function TrackerDetailPage() {
  const params = useParams();
  const jobId = params['jobId'] ?? '';
  const detailQuery = useTrackerDetailQuery(jobId);
  const updateStatusMutation = useUpdateTrackerStatusMutation(jobId);
  const addNoteMutation = useAddTrackerNoteMutation(jobId);
  const updateRecommendationMutation = useUpdateTrackerRecommendationMutation(jobId);
  const updateVerdictMutation = useUpdateTrackerVerdictMutation(jobId);
  const resolveDuplicateMutation = useResolveTrackerDuplicateMutation(jobId);
  const recordClientDiagnosticEventMutation = useRecordClientDiagnosticEventMutation();
  const trackerItem = detailQuery.data?.trackerItem ?? null;
  const trackedJobIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<TrackerStatus>('saved');
  const [note, setNote] = useState('');
  const [selectedCvId, setSelectedCvId] = useState('');
  const [selectedDuplicateJobId, setSelectedDuplicateJobId] = useState('');

  useEffect(() => {
    if (!trackerItem) return;
    setStatus(trackerItem.currentStatus);
    setNote(trackerItem.notes);
  }, [trackerItem]);

  useEffect(() => {
    if (!detailQuery.data) return;
    setSelectedCvId((current) => {
      if (current && detailQuery.data.availableCvs.some((cv) => cv.cvId === current)) {
        return current;
      }
      return (
        detailQuery.data.trackerItem?.userSelectedCvId ??
        detailQuery.data.trackerItem?.recommendationSnapshot?.recommendedCvId ??
        detailQuery.data.availableCvs[0]?.cvId ??
        ''
      );
    });
  }, [detailQuery.data]);

  useEffect(() => {
    if (!detailQuery.data) return;
    setSelectedDuplicateJobId((current) => {
      if (current && detailQuery.data.probableDuplicates.some((duplicate) => duplicate.jobId === current)) {
        return current;
      }
      return detailQuery.data.trackerItem?.duplicateResolution.duplicateJobId
        ?? detailQuery.data.probableDuplicates[0]?.jobId
        ?? '';
    });
  }, [detailQuery.data]);

  useEffect(() => {
    if (!detailQuery.data?.job || trackedJobIdRef.current === jobId) {
      return;
    }
    trackedJobIdRef.current = jobId;
    const properties = {
      jobId,
      ...(detailQuery.data.trackerItem?.id ? { trackerItemId: detailQuery.data.trackerItem.id } : {}),
    };
    void webApiClient.trackAnalyticsEvent('tracked_job_opened', properties);
    void webApiClient.trackAnalyticsEvent('details_view_opened', properties);
  }, [detailQuery.data, jobId]);

  async function handleStatusUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await updateStatusMutation.mutateAsync(status);
  }

  async function handleNoteUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await addNoteMutation.mutateAsync(note);
  }

  async function handleAcceptRecommendation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await recordTrackerClientEvent('tracker_recommendation_accept_clicked', 'Accepted the system recommendation.', {
      selectedCvId: trackerItem?.recommendationSnapshot?.recommendedCvId ?? null,
    });
    await updateRecommendationMutation.mutateAsync({
      decision: 'accepted',
      selectedCvId: trackerItem?.recommendationSnapshot?.recommendedCvId ?? null,
    });
  }

  async function handleOverrideRecommendation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCvId) return;
    await recordTrackerClientEvent('tracker_recommendation_override_clicked', 'Overrode the system recommendation.', {
      selectedCvId,
    });
    await updateRecommendationMutation.mutateAsync({
      decision: 'overridden',
      selectedCvId,
    });
  }

  async function handleResetRecommendation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await recordTrackerClientEvent('tracker_recommendation_reset_clicked', 'Reset recommendation back to the system value.');
    await updateRecommendationMutation.mutateAsync({ decision: 'pending' });
  }

  async function handleFollowVerdict(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await recordTrackerClientEvent('tracker_verdict_follow_clicked', 'Followed the system verdict.');
    await updateVerdictMutation.mutateAsync({ decision: 'followed' });
  }

  async function handleOverrideVerdict(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await recordTrackerClientEvent('tracker_verdict_override_clicked', 'Overrode the system verdict.');
    await updateVerdictMutation.mutateAsync({ decision: 'overridden' });
  }

  async function handleResetVerdict(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await recordTrackerClientEvent('tracker_verdict_reset_clicked', 'Reset verdict back to the system value.');
    await updateVerdictMutation.mutateAsync({ decision: 'pending' });
  }

  async function handleConfirmDistinctDuplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await recordTrackerClientEvent('tracker_duplicate_distinct_clicked', 'Confirmed this tracker item is distinct.');
    await resolveDuplicateMutation.mutateAsync({ decision: 'distinct_confirmed' });
  }

  async function handleConfirmDuplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDuplicateJobId) return;
    await recordTrackerClientEvent('tracker_duplicate_confirm_clicked', 'Marked this tracker item as a duplicate.', {
      duplicateJobId: selectedDuplicateJobId,
    });
    await resolveDuplicateMutation.mutateAsync({
      decision: 'duplicate_confirmed',
      duplicateJobId: selectedDuplicateJobId,
    });
  }

  async function handleResetDuplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await recordTrackerClientEvent('tracker_duplicate_reset_clicked', 'Reset duplicate review to pending.');
    await resolveDuplicateMutation.mutateAsync({ decision: 'pending' });
  }

  const activeEvaluation = detailQuery.data?.evaluation ?? null;
  const historicalEvaluations = detailQuery.data?.historicalEvaluations ?? [];
  const probableDuplicates = detailQuery.data?.probableDuplicates ?? [];
  const availableCvs = detailQuery.data?.availableCvs ?? [];
  const trackerRecommendation = trackerItem?.recommendationSnapshot ?? null;
  const reviewRequired = detailQuery.data?.validation?.status !== 'proceed';
  const decisionHistory = trackerItem?.decisionHistory ?? [];
  const duplicateResolution = trackerItem?.duplicateResolution ?? null;

  async function recordTrackerClientEvent(code: string, summary: string, payload?: Record<string, unknown>) {
    if (!getStoredEyeSessionId() || !jobId) {
      return;
    }
    await recordClientDiagnosticEventMutation.mutateAsync({
      area: 'client',
      stage: 'tracker_detail',
      code,
      severity: 'info',
      summary,
      jobId,
      trackerItemId: trackerItem?.id ?? null,
      ...(payload ? { payload } : {}),
    });
  }

  return (
    <div className="page-stack">
      <PageSection title="Tracker Detail" subtitle="Job state, trust decisions, evaluation evidence, and manual workflow updates.">
        {!jobId ? <p>Missing job id in route.</p> : null}
        <QueryState
          isLoading={detailQuery.isLoading}
          errorMessage={detailQuery.error ? toErrorMessage(detailQuery.error) : null}
          loadingLabel="Loading tracker detail..."
        />

        {detailQuery.data?.job ? (
          <div className="stack">
            <div className={reviewRequired ? 'callout callout--warning' : 'callout callout--success'}>
              <strong>Job state:</strong>{' '}
              {reviewRequired
                ? 'This opportunity still has review-gated extraction data. Confirm the job facts before fully trusting the verdict.'
                : 'This opportunity is evaluation-ready and the tracker record is in a stable state.'}
            </div>
            <div className="pill-grid">
              <SummaryPill label="Status" value={formatLabel(trackerItem?.currentStatus)} tone="neutral" />
              <SummaryPill label="Verdict" value={activeEvaluation?.verdict ?? trackerRecommendation?.verdict ?? 'n/a'} tone={activeEvaluation?.verdict === 'apply' ? 'good' : reviewRequired ? 'warning' : 'neutral'} />
              <SummaryPill label="Recommendation trust" value={formatLabel(trackerItem?.recommendedCvDecision)} tone="neutral" />
              <SummaryPill label="Verdict trust" value={formatLabel(trackerItem?.verdictDecision)} tone="neutral" />
            </div>
            <div className="panel-grid">
              <article className="card card--compact">
                <strong>{detailQuery.data.job.normalizedJobObject.title ?? 'Untitled role'}</strong>
                <p className="muted">{detailQuery.data.job.normalizedJobObject.company ?? 'Unknown company'}</p>
                <p className="muted">
                  {detailQuery.data.job.normalizedJobObject.location ?? 'Unknown location'} | {formatLabel(detailQuery.data.job.normalizedJobObject.workSetup)}
                </p>
              </article>
              <article className="card card--compact">
                <strong>Source</strong>
                <p className="muted">{formatLabel(detailQuery.data.job.sourceIdentifier)}</p>
                <p className="muted">{detailQuery.data.job.sourceUrl ?? 'n/a'}</p>
              </article>
              <article className="card card--compact">
                <strong>Tracker timestamps</strong>
                <p className="muted">Created {renderTimestamp(trackerItem?.createdAt)}</p>
                <p className="muted">Updated {renderTimestamp(trackerItem?.updatedAt)}</p>
              </article>
            </div>
            {reviewRequired ? (
              <div className="button-row">
                <Link to={jobReviewPath(jobId)}>Finish job review</Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </PageSection>

      <PageSection title="Workflow" subtitle="Status, next action, and evaluation lineage remain separate from trust decisions.">
        {trackerItem ? (
          <div className="panel-grid">
            <article className="card card--compact">
              <strong>Next action</strong>
              <p className="muted">{formatNextAction(trackerItem.nextActionSnapshot ?? activeEvaluation?.nextAction)}</p>
            </article>
            <article className="card card--compact">
              <strong>Recommended CV</strong>
              <p className="muted">{formatCvName(trackerRecommendation?.recommendedCvId, availableCvs)}</p>
              <p className="muted">User selected: {formatCvName(trackerItem.userSelectedCvId, availableCvs)}</p>
            </article>
            <article className="card card--compact">
              <strong>Evaluation lineage</strong>
              <p className="muted">Active: {activeEvaluation?.id ?? trackerItem.activeEvaluationId ?? 'none'}</p>
              <p className="muted">Historical: {historicalEvaluations.length}</p>
            </article>
          </div>
        ) : (
          <p>No tracker record found for this job id.</p>
        )}
      </PageSection>

      <PageSection title="Recommendation Trust" subtitle="Accept the system CV recommendation or record an explicit override.">
        {trackerItem ? (
          <div className="stack">
            <p>
              <strong>System recommendation:</strong> {trackerRecommendation?.verdict ?? 'n/a'} / {formatCvName(trackerRecommendation?.recommendedCvId, availableCvs)}
            </p>
            {trackerItem.recommendedCvDecision === 'overridden' ? (
              <div className="callout callout--warning">
                <strong>Manual override is active</strong>
                <p className="muted">Selected CV: {formatCvName(trackerItem.userSelectedCvId, availableCvs)}</p>
              </div>
            ) : null}
            <p className="muted">This does not change tracker status. It only records whether the recommendation was followed or overridden.</p>
            <div className="button-row">
              <form onSubmit={handleAcceptRecommendation}>
                <button type="submit" disabled={updateRecommendationMutation.isPending || !trackerRecommendation?.recommendedCvId}>
                  {updateRecommendationMutation.isPending ? 'Saving...' : 'Use recommended CV'}
                </button>
              </form>
              {trackerItem.recommendedCvDecision !== 'pending' ? (
                <form onSubmit={handleResetRecommendation}>
                  <button type="submit" disabled={updateRecommendationMutation.isPending}>
                    {updateRecommendationMutation.isPending ? 'Saving...' : 'Reset to latest system recommendation'}
                  </button>
                </form>
              ) : null}
            </div>
            <form className="form-grid" onSubmit={handleOverrideRecommendation}>
              <label className="field">
                <span>Choose different CV</span>
                <select value={selectedCvId} onChange={(event) => setSelectedCvId(event.target.value)}>
                  <option value="">Select a CV</option>
                  {availableCvs.map((cv) => (
                    <option key={cv.cvId} value={cv.cvId}>
                      {cv.cvName}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={updateRecommendationMutation.isPending || !selectedCvId}>
                {updateRecommendationMutation.isPending ? 'Saving...' : 'Override with selected CV'}
              </button>
            </form>
          </div>
        ) : (
          <p>No recommendation data is available for this job.</p>
        )}
      </PageSection>

      <PageSection title="Verdict Trust" subtitle="Record whether the system verdict was followed or intentionally overridden.">
        {trackerItem ? (
          <div className="stack">
            <p>
              <strong>System verdict:</strong> {activeEvaluation?.verdict ?? trackerRecommendation?.verdict ?? 'n/a'}
            </p>
            <div className="button-row">
              <form onSubmit={handleFollowVerdict}>
                <button type="submit" disabled={updateVerdictMutation.isPending}>
                  {updateVerdictMutation.isPending ? 'Saving...' : 'Follow verdict'}
                </button>
              </form>
              <form onSubmit={handleOverrideVerdict}>
                <button type="submit" disabled={updateVerdictMutation.isPending}>
                  {updateVerdictMutation.isPending ? 'Saving...' : 'Override verdict'}
                </button>
              </form>
              {trackerItem.verdictDecision !== 'pending' ? (
                <form onSubmit={handleResetVerdict}>
                  <button type="submit" disabled={updateVerdictMutation.isPending}>
                    {updateVerdictMutation.isPending ? 'Saving...' : 'Reset to latest system verdict'}
                  </button>
                </form>
              ) : null}
            </div>
            <p className="muted">Current verdict decision: {formatLabel(trackerItem.verdictDecision)}</p>
          </div>
        ) : (
          <p>No verdict data is available for this job.</p>
        )}
      </PageSection>

      <PageSection title="Evaluation Evidence" subtitle="Current output, explanation evidence, and historical runs.">
        {activeEvaluation ? (
          <div className="stack">
            <div className="pill-grid">
              <SummaryPill label="Information quality" value={activeEvaluation.informationQualityScore.toFixed(2)} tone={activeEvaluation.informationQualityScore >= 70 ? 'good' : 'warning'} />
              <SummaryPill label="Extraction version" value={activeEvaluation.extractionVersion} tone="neutral" />
              <SummaryPill label="Review gate" value={formatLabel(activeEvaluation.reviewGateStatus)} tone={activeEvaluation.reviewGateStatus === 'proceed' ? 'good' : 'warning'} />
              <SummaryPill label="AI artifacts" value={String(activeEvaluation.aiArtifactReferences.length)} tone="neutral" />
            </div>
            <div className="callout callout--neutral">
              <strong>Concise explanation:</strong> {activeEvaluation.conciseExplanation}
            </div>
            <p>
              <strong>Major gaps:</strong> {activeEvaluation.majorGapsSummary.length > 0 ? activeEvaluation.majorGapsSummary.join(', ') : 'None'}
            </p>
            <p>
              <strong>Unknown data flags:</strong> {renderList(activeEvaluation.unknownDataFlags)}
            </p>
            <p>
              <strong>Explanation source fields:</strong> job[{renderList(activeEvaluation.explanationSourceFields.jobFields)}], CV[{renderList(activeEvaluation.explanationSourceFields.cvFields)}], preferences[{renderList(activeEvaluation.explanationSourceFields.preferenceFields)}]
            </p>
            <p>
              <strong>Used inferred company or sector signal:</strong> {activeEvaluation.explanationSourceFields.usedInferredCompanyOrSectorSignal ? 'Yes' : 'No'}
            </p>
            {detailQuery.data?.extractionMeta ? (
              <div className="callout callout--neutral">
                <strong>Extraction meta:</strong> version {detailQuery.data.extractionMeta.extractionVersion} | reviews {detailQuery.data.extractionMeta.reviewCount}
              </div>
            ) : null}
          </div>
        ) : (
          <p>No active evaluation yet.</p>
        )}

        <div className="stack" style={{ marginTop: '1rem' }}>
          <h3>Historical evaluations</h3>
          {historicalEvaluations.length > 0 ? (
            <div className="panel-grid">
              {historicalEvaluations.map((evaluation) => (
                <article key={evaluation.id} className="card card--compact">
                  <strong>{evaluation.verdict ?? 'n/a'}</strong>
                  <p className="muted">Created {renderTimestamp(evaluation.createdAt)}</p>
                  <p className="muted">Recommended CV: {formatCvName(evaluation.recommendedCvId, availableCvs)}</p>
                  <p className="muted">Next action: {formatNextAction(evaluation.nextAction)}</p>
                  <p className="muted">Information quality: {evaluation.informationQualityScore.toFixed(2)}</p>
                  <p className="muted">Unknown data flags: {renderList(evaluation.unknownDataFlags)}</p>
                </article>
              ))}
            </div>
          ) : (
            <p>No historical evaluations recorded.</p>
          )}
        </div>
      </PageSection>

      <PageSection title="Duplicate Risk" subtitle="Probable duplicates remain explicit until you decide how to handle them.">
        <div className="stack">
          {duplicateResolution ? (
            <div className="callout callout--neutral">
              <strong>Resolution state:</strong> {formatLabel(duplicateResolution.decision)}
              {duplicateResolution.duplicateJobId ? (
                <p className="muted">
                  Duplicate target: <Link to={trackerDetailPath(duplicateResolution.duplicateJobId)}>{duplicateResolution.duplicateJobId}</Link>
                </p>
              ) : null}
            </div>
          ) : null}

          {probableDuplicates.length > 0 ? (
            <>
              <div className="panel-grid">
                {probableDuplicates.map((duplicate) => (
                  <article key={duplicate.jobId} className="card card--compact">
                    <strong>{duplicate.title ?? 'Untitled role'}</strong>
                    <p className="muted">{duplicate.company ?? 'Unknown company'}</p>
                    <p className="muted">Status: {duplicate.currentStatus ?? 'n/a'}</p>
                    <Link to={trackerDetailPath(duplicate.jobId)}>Open duplicate</Link>
                  </article>
                ))}
              </div>

              <div className="panel-grid">
                <form className="form-grid" onSubmit={handleConfirmDistinctDuplicate}>
                  <p className="muted">Use this when the role only looks similar but should stay as its own tracker item.</p>
                  <button type="submit" disabled={resolveDuplicateMutation.isPending}>
                    {resolveDuplicateMutation.isPending ? 'Saving...' : 'Keep as separate opportunity'}
                  </button>
                </form>

                <form className="form-grid" onSubmit={handleConfirmDuplicate}>
                  <label className="field">
                    <span>Duplicate of</span>
                    <select value={selectedDuplicateJobId} onChange={(event) => setSelectedDuplicateJobId(event.target.value)}>
                      <option value="">Select a tracker item</option>
                      {probableDuplicates.map((duplicate) => (
                        <option key={duplicate.jobId} value={duplicate.jobId}>
                          {(duplicate.title ?? 'Untitled role')} - {(duplicate.company ?? 'Unknown company')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" disabled={resolveDuplicateMutation.isPending || !selectedDuplicateJobId}>
                    {resolveDuplicateMutation.isPending ? 'Saving...' : 'Mark as duplicate'}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <p>No probable duplicates identified.</p>
          )}

          {duplicateResolution?.decision !== 'pending' ? (
            <form onSubmit={handleResetDuplicate}>
              <button type="submit" disabled={resolveDuplicateMutation.isPending}>
                {resolveDuplicateMutation.isPending ? 'Saving...' : 'Reset duplicate review'}
              </button>
            </form>
          ) : null}
        </div>
      </PageSection>

      <PageSection title="Decision History" subtitle="Trust decisions remain auditable across reevaluations.">
        {decisionHistory.length > 0 ? (
          <div className="panel-grid">
            {[...decisionHistory].slice(-8).reverse().map((entry) => (
              <article key={entry.id} className="card card--compact">
                <strong>{formatLabel(entry.type)}: {formatLabel(entry.action)}</strong>
                <p className="muted">{entry.summary}</p>
                <p className="muted">At: {renderTimestamp(entry.timestamp)}</p>
                <p className="muted">Evaluation: {entry.evaluationId ?? 'n/a'}</p>
              </article>
            ))}
          </div>
        ) : (
          <p>No trust decisions recorded yet.</p>
        )}
      </PageSection>

      <PageSection title="Workflow Updates" subtitle="Status and notes remain user-owned and are not overwritten by reevaluation.">
        <div className="panel-grid">
          <form className="form-grid" onSubmit={handleStatusUpdate}>
            <label className="field">
              <span>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as TrackerStatus)}>
                {trackerStatusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={!trackerItem || updateStatusMutation.isPending}>
              {updateStatusMutation.isPending ? 'Updating status...' : 'Save status'}
            </button>
          </form>

          <form className="form-grid" onSubmit={handleNoteUpdate}>
            <label className="field">
              <span>Notes</span>
              <textarea rows={5} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <button type="submit" disabled={!trackerItem || addNoteMutation.isPending}>
              {addNoteMutation.isPending ? 'Saving note...' : 'Save note'}
            </button>
          </form>
        </div>
        <QueryState
          isLoading={
            updateStatusMutation.isPending
            || addNoteMutation.isPending
            || updateRecommendationMutation.isPending
            || updateVerdictMutation.isPending
            || resolveDuplicateMutation.isPending
          }
          errorMessage={
            (updateStatusMutation.error ? toErrorMessage(updateStatusMutation.error) : null) ??
            (addNoteMutation.error ? toErrorMessage(addNoteMutation.error) : null) ??
            (updateRecommendationMutation.error ? toErrorMessage(updateRecommendationMutation.error) : null) ??
            (updateVerdictMutation.error ? toErrorMessage(updateVerdictMutation.error) : null) ??
            (resolveDuplicateMutation.error ? toErrorMessage(resolveDuplicateMutation.error) : null)
          }
          loadingLabel="Saving tracker changes..."
        />
      </PageSection>
    </div>
  );
}
