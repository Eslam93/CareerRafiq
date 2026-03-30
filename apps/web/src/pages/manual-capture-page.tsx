import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { EmploymentType, WorkSetup } from '@career-rafiq/contracts';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getStoredEyeSessionId } from '../api-client.js';
import { useManualCaptureMutation, useRecordClientDiagnosticEventMutation } from '../api-hooks.js';
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

function formatLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

export function ManualCapturePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sourceUrl = searchParams.get('sourceUrl');
  const captureMutation = useManualCaptureMutation();
  const recordClientDiagnosticEventMutation = useRecordClientDiagnosticEventMutation();
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [workSetup, setWorkSetup] = useState<WorkSetup>('unknown');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('unknown');
  const [recruiterOrPosterSignal, setRecruiterOrPosterSignal] = useState('');
  const [companySector, setCompanySector] = useState('');
  const [companyType, setCompanyType] = useState('');

  const completionCount = useMemo(
    () => [title, company, location, description, ...keywords].filter((value) => value.trim().length > 0).length,
    [company, description, keywords, location, title],
  );

  useEffect(() => {
    if (!getStoredEyeSessionId()) {
      return;
    }
    void recordClientDiagnosticEventMutation.mutateAsync({
      area: 'client',
      stage: 'manual_capture',
      code: 'manual_capture_opened',
      severity: 'info',
      summary: 'Manual capture page opened.',
      payload: {
        sourceUrl,
      },
    });
  }, [recordClientDiagnosticEventMutation, sourceUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (getStoredEyeSessionId()) {
      await recordClientDiagnosticEventMutation.mutateAsync({
        area: 'client',
        stage: 'manual_capture',
        code: 'manual_capture_submitted',
        severity: 'info',
        summary: 'Manual capture form submitted.',
        payload: {
          sourceUrl,
          title: title.trim() || null,
          company: company.trim() || null,
        },
      });
    }
    const result = await captureMutation.mutateAsync({
      sourceUrl,
      sourceIdentifier: 'manual',
      title: title.trim() || null,
      company: company.trim() || null,
      location: location.trim() || null,
      workSetup,
      employmentType,
      description: description.trim() || null,
      recruiterOrPosterSignal: recruiterOrPosterSignal.trim() || null,
      companySector: companySector.trim() || null,
      companyType: companyType.trim() || null,
      keywords,
    });
    const jobId = result.job?.id ?? result.trackerItem?.jobId;
    if (!jobId) {
      return;
    }
    navigate(result.validation.status === 'proceed' ? `/tracker/${encodeURIComponent(jobId)}` : `/jobs/${encodeURIComponent(jobId)}/review`);
  }

  return (
    <div className="page-stack">
      <PageSection title="Manual Capture" subtitle="Use this when a page is unsupported or when automatic extraction missed key fields.">
        <div className="stack">
          <div className="callout callout--neutral">
            <strong>How this works:</strong> partial capture is allowed. Low-confidence or incomplete jobs still go through the review gate before any verdict is shown.
          </div>
          <div className="pill-grid">
            <SummaryPill label="Source URL" value={sourceUrl ? 'attached' : 'optional'} tone={sourceUrl ? 'good' : 'neutral'} />
            <SummaryPill label="Filled signals" value={String(completionCount)} tone={completionCount >= 3 ? 'good' : 'warning'} />
            <SummaryPill label="Work setup" value={formatLabel(workSetup)} tone={workSetup === 'unknown' ? 'neutral' : 'good'} />
            <SummaryPill
              label="Employment type"
              value={formatLabel(employmentType)}
              tone={employmentType === 'unknown' ? 'neutral' : 'good'}
            />
          </div>
        </div>
      </PageSection>

      <PageSection title="Core Job Details" subtitle="Title, description, and keywords give the evaluator the strongest signal.">
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span>Source URL</span>
            <input value={sourceUrl ?? ''} readOnly placeholder="Optional source URL passed from the extension" />
          </label>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Platform Engineer" />
          </label>
          <label className="field">
            <span>Company</span>
            <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Acme" />
          </label>
          <label className="field">
            <span>Location</span>
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Remote, Cairo, Berlin, ..." />
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
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={10}
              placeholder="Paste the job responsibilities, required skills, and context."
            />
          </label>
          <TokenListInput
            label="Keywords"
            values={keywords}
            onChange={setKeywords}
            placeholder="python, aws, kubernetes"
            hint="Add the terms that should survive normalization even if the source page was incomplete."
          />

          <div className="callout callout--neutral">
            <strong>Optional enrichment:</strong> sector, company type, and poster signal help the explanation layer but are not required to create the tracker item.
          </div>

          <label className="field">
            <span>Poster or recruiter signal</span>
            <input
              value={recruiterOrPosterSignal}
              onChange={(event) => setRecruiterOrPosterSignal(event.target.value)}
              placeholder="Internal recruiter, founder post, agency recruiter, ..."
            />
          </label>
          <label className="field">
            <span>Company sector</span>
            <input value={companySector} onChange={(event) => setCompanySector(event.target.value)} placeholder="Fintech, SaaS, Healthcare" />
          </label>
          <label className="field">
            <span>Company type</span>
            <input value={companyType} onChange={(event) => setCompanyType(event.target.value)} placeholder="Startup, enterprise, agency" />
          </label>

          <div className="button-row">
            <button type="submit" disabled={captureMutation.isPending}>
              {captureMutation.isPending ? 'Capturing...' : 'Create tracker item'}
            </button>
          </div>
        </form>
        <QueryState
          isLoading={captureMutation.isPending}
          errorMessage={captureMutation.error ? toErrorMessage(captureMutation.error) : null}
          loadingLabel="Submitting manual capture..."
        />
      </PageSection>
    </div>
  );
}
