import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EmploymentType, WorkSetup } from '@career-rafiq/contracts';
import { useParams } from 'react-router-dom';
import { getStoredEyeSessionId, webApiClient } from '../api-client.js';
import {
  useEvaluateJobMutation,
  useJobReviewQuery,
  useRecordClientDiagnosticEventMutation,
  useReprocessJobMutation,
  useSaveJobReviewMutation,
} from '../api-hooks.js';
import { TokenListInput } from '../components/token-list-input.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { toErrorMessage } from '../utils/text.js';

const workSetupOptions: WorkSetup[] = ['remote', 'hybrid', 'onsite', 'unknown'];
const employmentTypeOptions: EmploymentType[] = [
  'full_time',
  'part_time',
  'contract',
  'freelance',
  'temporary',
  'internship',
  'unknown',
];

function SummaryPill(props: { label: string; value: string; tone: 'good' | 'warning' | 'neutral' }) {
  return (
    <div className={`pill pill--${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function formatLabel(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }
  return value.replaceAll('_', ' ');
}

function formatCvName(
  cvId: string | null | undefined,
  availableCvs: Array<{ cvId: string; cvName: string }>,
): string {
  if (!cvId) {
    return 'n/a';
  }
  return availableCvs.find((cv) => cv.cvId === cvId)?.cvName ?? cvId;
}

export function JobReviewPage() {
  const params = useParams();
  const jobId = params['jobId'] ?? '';
  const jobReviewQuery = useJobReviewQuery(jobId);
  const saveReviewMutation = useSaveJobReviewMutation(jobId);
  const reprocessMutation = useReprocessJobMutation(jobId);
  const evaluateMutation = useEvaluateJobMutation(jobId);
  const recordClientDiagnosticEventMutation = useRecordClientDiagnosticEventMutation();
  const trackedJobIdRef = useRef<string | null>(null);
  const trackedEvaluationIdRef = useRef<string | null>(null);
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [workSetup, setWorkSetup] = useState<WorkSetup>('unknown');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('unknown');
  const [description, setDescription] = useState('');
  const [recruiterOrPosterSignal, setRecruiterOrPosterSignal] = useState('');
  const [companySector, setCompanySector] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [reevaluateAfterSave, setReevaluateAfterSave] = useState(true);
  const [reevaluateAfterReprocess, setReevaluateAfterReprocess] = useState(false);

  useEffect(() => {
    const job = jobReviewQuery.data?.job;
    if (!job) return;
    setTitle(job.normalizedJobObject.title ?? '');
    setCompany(job.normalizedJobObject.company ?? '');
    setLocation(job.normalizedJobObject.location ?? '');
    setWorkSetup(job.normalizedJobObject.workSetup);
    setEmploymentType(job.normalizedJobObject.employmentType);
    setDescription(job.normalizedJobObject.description);
    setRecruiterOrPosterSignal(job.normalizedJobObject.recruiterOrPosterSignal ?? '');
    setCompanySector(job.normalizedJobObject.companySector ?? '');
    setCompanyType(job.normalizedJobObject.companyType ?? '');
    setKeywords(job.normalizedJobObject.keywords);
  }, [jobReviewQuery.data?.job]);

  useEffect(() => {
    if (!jobReviewQuery.data?.job || trackedJobIdRef.current === jobId) {
      return;
    }
    trackedJobIdRef.current = jobId;
    void webApiClient.trackAnalyticsEvent('details_view_opened', {
      jobId,
      ...(jobReviewQuery.data.trackerItem?.id ? { trackerItemId: jobReviewQuery.data.trackerItem.id } : {}),
    });
  }, [jobId, jobReviewQuery.data]);

  useEffect(() => {
    const evaluation = evaluateMutation.data?.evaluation;
    if (!evaluation || trackedEvaluationIdRef.current === evaluation.id) {
      return;
    }
    trackedEvaluationIdRef.current = evaluation.id;
    const properties = {
      jobId: evaluation.jobId,
      ...(evaluateMutation.data?.trackerItem?.id ? { trackerItemId: evaluateMutation.data.trackerItem.id } : {}),
      ...(evaluation.recommendedCvId ? { recommendedCvId: evaluation.recommendedCvId } : {}),
      evaluationVersion: evaluation.evaluationVersion,
      verdict: evaluation.verdict,
    };
    void webApiClient.trackAnalyticsEvent('verdict_shown', properties);
    if (evaluation.recommendedCvId) {
      void webApiClient.trackAnalyticsEvent('recommended_cv_shown', properties);
    }
  }, [evaluateMutation.data]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobId) return;
    if (getStoredEyeSessionId()) {
      await recordClientDiagnosticEventMutation.mutateAsync({
        area: 'client',
        stage: 'job_review',
        code: 'job_review_submitted',
        severity: 'info',
        summary: 'Job review form submitted.',
        jobId,
        payload: {
          reevaluateAfterSave,
          title: title.trim() || null,
          company: company.trim() || null,
        },
      });
    }
    await saveReviewMutation.mutateAsync({
      title: title.trim() || null,
      company: company.trim() || null,
      location: location.trim() || null,
      workSetup,
      employmentType,
      description: description.trim(),
      recruiterOrPosterSignal: recruiterOrPosterSignal.trim() || null,
      companySector: companySector.trim() || null,
      companyType: companyType.trim() || null,
      keywords,
      reevaluateAfterSave,
    });
  }

  async function handleEvaluate() {
    if (!jobId) return;
    if (getStoredEyeSessionId()) {
      await recordClientDiagnosticEventMutation.mutateAsync({
        area: 'client',
        stage: 'job_review',
        code: 'job_review_evaluate_clicked',
        severity: 'info',
        summary: 'Evaluate was requested from job review.',
        jobId,
      });
    }
    await evaluateMutation.mutateAsync();
  }

  async function handleReprocess() {
    if (!jobId) return;
    if (getStoredEyeSessionId()) {
      await recordClientDiagnosticEventMutation.mutateAsync({
        area: 'client',
        stage: 'job_review',
        code: 'job_review_reprocess_clicked',
        severity: 'info',
        summary: 'Reprocess was requested from job review.',
        jobId,
        payload: {
          reevaluateAfterReprocess,
        },
      });
    }
    await reprocessMutation.mutateAsync(reevaluateAfterReprocess);
  }

  const activeEvaluation = evaluateMutation.data?.evaluation ?? jobReviewQuery.data?.evaluation ?? null;
  const validation = jobReviewQuery.data?.validation ?? null;
  const extractionMeta = jobReviewQuery.data?.extractionMeta ?? null;
  const availableCvs = jobReviewQuery.data?.availableCvs ?? [];

  return (
    <div className="page-stack">
      <PageSection title="Job Review" subtitle="Review-gated jobs must be confirmed here before deterministic evaluation becomes trustworthy.">
        {!jobId ? <p>Missing job id in route.</p> : null}
        <QueryState
          isLoading={jobReviewQuery.isLoading}
          errorMessage={jobReviewQuery.error ? toErrorMessage(jobReviewQuery.error) : null}
          loadingLabel="Loading job review payload..."
        />
        {validation ? (
          <div className="stack">
            <div className={validation.status === 'proceed' ? 'callout callout--success' : 'callout callout--warning'}>
              <strong>Review gate:</strong>{' '}
              {validation.status === 'proceed'
                ? 'This job is usable for evaluation. You can still edit it before running another verdict.'
                : 'The current extraction is still incomplete or uncertain. Confirm the key fields below before trusting the result.'}
            </div>
            <div className="pill-grid">
              <SummaryPill
                label="Status"
                value={formatLabel(validation.status)}
                tone={validation.status === 'proceed' ? 'good' : 'warning'}
              />
              <SummaryPill
                label="Confidence"
                value={`${Math.round(validation.extractionConfidence * 100)}%`}
                tone={validation.extractionConfidence >= 0.8 ? 'good' : validation.extractionConfidence >= 0.6 ? 'neutral' : 'warning'}
              />
              <SummaryPill
                label="Review count"
                value={String(extractionMeta?.reviewCount ?? 0)}
                tone={extractionMeta?.reviewCount ? 'warning' : 'neutral'}
              />
              <SummaryPill
                label="Extraction version"
                value={extractionMeta?.extractionVersion ?? 'n/a'}
                tone="neutral"
              />
            </div>
            {validation.reasons.length > 0 ? (
              <div className="callout callout--warning">
                <strong>Why review is required:</strong> {validation.reasons.join(', ')}
              </div>
            ) : null}
          </div>
        ) : null}
      </PageSection>

      <PageSection title="Signals and Evidence" subtitle="Use the extracted evidence to decide what must be corrected versus what is safe to keep.">
        {extractionMeta ? (
          <div className="stack">
            <div className="panel-grid">
              <article className="card card--compact">
                <strong>Confidence hints</strong>
                <p className="muted">{extractionMeta.sourceConfidenceHints.join(', ') || 'None'}</p>
              </article>
              <article className="card card--compact">
                <strong>Ambiguity flags</strong>
                <p className="muted">{extractionMeta.ambiguityFlags.join(', ') || 'None'}</p>
              </article>
              <article className="card card--compact">
                <strong>Extraction notes</strong>
                <p className="muted">{extractionMeta.extractionNotes.join(', ') || 'None'}</p>
              </article>
              <article className="card card--compact">
                <strong>AI artifacts</strong>
                <p className="muted">{extractionMeta.aiArtifactReferences.length} linked artifact(s)</p>
              </article>
            </div>
            {extractionMeta.consensusSummary ? (
              <div className="callout callout--neutral">
                <strong>Consensus:</strong> {formatLabel(extractionMeta.consensusSummary.strategy)} | agreement{' '}
                {formatLabel(extractionMeta.consensusSummary.agreement)} | runs {extractionMeta.consensusSummary.runs}
              </div>
            ) : null}
            {extractionMeta.coherenceAssessment ? (
              <div className="callout callout--neutral">
                <strong>Coherence:</strong> {extractionMeta.coherenceAssessment.note} ({Math.round(extractionMeta.coherenceAssessment.confidence * 100)}%)
              </div>
            ) : null}
            {extractionMeta.sourceOfTruthSummary ? (
              <div className="callout callout--neutral">
                <strong>Source of truth summary:</strong> {extractionMeta.sourceOfTruthSummary}
              </div>
            ) : null}
            {extractionMeta.fieldEvidence.length > 0 ? (
              <div className="panel-grid">
                {extractionMeta.fieldEvidence.map((entry) => (
                  <article key={`${entry.field}-${entry.provenance}`} className="card card--compact">
                    <strong>{formatLabel(entry.field)}</strong>
                    <p className="muted">
                      {Math.round(entry.confidence * 100)}% confidence | provenance {formatLabel(entry.provenance)}
                    </p>
                    <p className="muted">Evidence: {entry.evidence.join(' | ') || 'None'}</p>
                    <p className="muted">Reasons: {entry.reasons.join(', ') || 'None'}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No field-level evidence was stored for this extraction.</p>
            )}
            {Object.keys(extractionMeta.mergedFieldProvenance).length > 0 ? (
              <div className="callout callout--neutral">
                <strong>Current field provenance</strong>
                <p className="muted">
                  {Object.entries(extractionMeta.mergedFieldProvenance)
                    .map(([field, provenance]) => `${formatLabel(field)}: ${formatLabel(provenance)}`)
                    .join(' | ')}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">No extraction metadata found for this job yet.</p>
        )}
      </PageSection>

      <PageSection title="Correction Form" subtitle="Confirm the job facts here. Save first, then evaluate once the review gate clears.">
        {jobReviewQuery.data?.job ? (
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>Company</span>
              <input value={company} onChange={(event) => setCompany(event.target.value)} />
            </label>
            <label className="field">
              <span>Location</span>
              <input value={location} onChange={(event) => setLocation(event.target.value)} />
            </label>
            <label className="field">
              <span>Work setup</span>
              <select value={workSetup} onChange={(event) => setWorkSetup(event.target.value as WorkSetup)}>
                {workSetupOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Employment type</span>
              <select value={employmentType} onChange={(event) => setEmploymentType(event.target.value as EmploymentType)}>
                {employmentTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--full">
              <span>Description</span>
              <textarea rows={8} value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <TokenListInput
              label="Keywords"
              values={keywords}
              onChange={setKeywords}
              placeholder="python, aws, kubernetes"
              hint="Add terms that should be preserved in normalization and evaluation."
            />
            <label className="field">
              <span>Poster signal</span>
              <input value={recruiterOrPosterSignal} onChange={(event) => setRecruiterOrPosterSignal(event.target.value)} />
            </label>
            <label className="field">
              <span>Company sector</span>
              <input value={companySector} onChange={(event) => setCompanySector(event.target.value)} />
            </label>
            <label className="field">
              <span>Company type</span>
              <input value={companyType} onChange={(event) => setCompanyType(event.target.value)} />
            </label>

            <label className="field field--checkbox">
              <input type="checkbox" checked={reevaluateAfterSave} onChange={(event) => setReevaluateAfterSave(event.target.checked)} />
              <span>Reevaluate automatically after save when the review gate clears.</span>
            </label>
            <label className="field field--checkbox">
              <input
                type="checkbox"
                checked={reevaluateAfterReprocess}
                onChange={(event) => setReevaluateAfterReprocess(event.target.checked)}
              />
              <span>Reevaluate automatically after reprocessing the stored capture.</span>
            </label>

            <div className="button-row">
              <button type="submit" disabled={saveReviewMutation.isPending}>
                {saveReviewMutation.isPending ? 'Saving...' : 'Save corrections'}
              </button>
              <button type="button" onClick={handleEvaluate} disabled={evaluateMutation.isPending}>
                {evaluateMutation.isPending ? 'Evaluating...' : 'Evaluate now'}
              </button>
              <button type="button" onClick={handleReprocess} disabled={reprocessMutation.isPending}>
                {reprocessMutation.isPending ? 'Reprocessing...' : 'Retry stored capture'}
              </button>
            </div>
          </form>
        ) : (
          <p>No job found for this id.</p>
        )}
        <QueryState
          isLoading={saveReviewMutation.isPending || evaluateMutation.isPending || reprocessMutation.isPending}
          errorMessage={
            (saveReviewMutation.error ? toErrorMessage(saveReviewMutation.error) : null) ??
            (evaluateMutation.error ? toErrorMessage(evaluateMutation.error) : null) ??
            (reprocessMutation.error ? toErrorMessage(reprocessMutation.error) : null)
          }
          loadingLabel="Submitting job review action..."
        />
      </PageSection>

      <PageSection title="Extraction History" subtitle="Every manual correction and retry is preserved for auditability.">
        {extractionMeta?.history.length ? (
          <div className="panel-grid">
            {extractionMeta.history.map((entry) => (
              <article key={`${entry.timestamp}-${entry.action}`} className="card card--compact">
                <strong>{formatLabel(entry.action)}</strong>
                <p className="muted">{new Date(entry.timestamp).toLocaleString()}</p>
                <p className="muted">
                  {formatLabel(entry.status)} | {Math.round(entry.extractionConfidence * 100)}% confidence | source {formatLabel(entry.source)}
                </p>
                <p className="muted">{entry.note}</p>
              </article>
            ))}
          </div>
        ) : (
          <p>No extraction history recorded yet.</p>
        )}
      </PageSection>

      <PageSection title="Latest Evaluation" subtitle="Compact result contract: verdict, recommended CV, explanation, and major gaps.">
        {activeEvaluation ? (
          <div className="stack">
            <div className="pill-grid">
              <SummaryPill label="Verdict" value={activeEvaluation.verdict ?? 'n/a'} tone={activeEvaluation.verdict === 'apply' ? 'good' : 'warning'} />
              <SummaryPill label="Recommended CV" value={formatCvName(activeEvaluation.recommendedCvId, availableCvs)} tone="neutral" />
              <SummaryPill
                label="Information quality"
                value={activeEvaluation.informationQualityScore.toFixed(2)}
                tone={activeEvaluation.informationQualityScore >= 70 ? 'good' : 'warning'}
              />
              <SummaryPill label="Evaluation version" value={activeEvaluation.evaluationVersion} tone="neutral" />
            </div>
            <div className="callout callout--neutral">
              <strong>Concise explanation:</strong> {activeEvaluation.conciseExplanation}
            </div>
            <p>
              <strong>Major gaps:</strong> {activeEvaluation.majorGapsSummary.length > 0 ? activeEvaluation.majorGapsSummary.join(', ') : 'None'}
            </p>
            <p>
              <strong>Next action:</strong> {activeEvaluation.nextAction ? `${activeEvaluation.nextAction.label} (${activeEvaluation.nextAction.code})` : 'n/a'}
            </p>
          </div>
        ) : (
          <p>Run evaluation to see the latest quick-result payload.</p>
        )}
      </PageSection>
    </div>
  );
}
