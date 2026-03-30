import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBootstrapMutation, useCurrentSetupQuery, useSessionQuery } from '../api-hooks.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { webRoutes } from '../route-paths.js';
import { toErrorMessage } from '../utils/text.js';

function SummaryPill(props: { label: string; value: string; tone: 'good' | 'warning' | 'neutral' }) {
  return (
    <div className={`pill pill--${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const sessionQuery = useSessionQuery();
  const setupQuery = useCurrentSetupQuery();
  const bootstrapMutation = useBootstrapMutation();
  const [files, setFiles] = useState<File[]>([]);

  const setupSnapshot = setupQuery.data?.bootstrap ?? null;
  const summaryPills = useMemo(() => {
    if (!setupSnapshot) {
      return [
        { label: 'CVs', value: '0', tone: 'neutral' as const },
        { label: 'Setup', value: 'Not started', tone: 'warning' as const },
      ];
    }
    return [
      { label: 'CVs', value: String(setupSnapshot.cvs.length), tone: 'good' as const },
      { label: 'Detected emails', value: String(setupSnapshot.detectedEmails.length), tone: setupSnapshot.detectedEmails.length > 0 ? 'good' as const : 'warning' as const },
      { label: 'Minimum setup', value: setupSnapshot.minimumUsableDataReady ? 'Ready' : 'Blocked', tone: setupSnapshot.minimumUsableDataReady ? 'good' as const : 'warning' as const },
      { label: 'Return access', value: setupSnapshot.returnAccessRequiresVerification ? 'Needs verification' : 'Ready', tone: setupSnapshot.returnAccessRequiresVerification ? 'warning' as const : 'good' as const },
    ];
  }, [setupSnapshot]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) return;
    await bootstrapMutation.mutateAsync(files);
    navigate(webRoutes.review);
  }

  return (
    <div className="page-stack">
      <PageSection title="Start with your CVs" subtitle="Upload one or more PDF, DOCX, or TXT CVs to generate positioning, default preferences, and a temporary session.">
        <div className="stack">
          <div className="pill-grid">
            {summaryPills.map((pill) => (
              <SummaryPill key={pill.label} label={pill.label} value={pill.value} tone={pill.tone} />
            ))}
          </div>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span>CV uploads</span>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.txt"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            <button type="submit" disabled={files.length === 0 || bootstrapMutation.isPending}>
              {bootstrapMutation.isPending ? 'Bootstrapping...' : 'Generate setup'}
            </button>
          </form>
          {files.length > 0 ? (
            <div className="callout callout--neutral">
              <strong>Ready to upload</strong>
              <ul className="simple-list">
                {files.map((file) => (
                  <li key={`${file.name}-${file.lastModified}`}>
                    {file.name} · {Math.ceil(file.size / 1024)} KB
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <QueryState
          isLoading={bootstrapMutation.isPending}
          errorMessage={bootstrapMutation.error ? toErrorMessage(bootstrapMutation.error) : null}
          loadingLabel="Generating setup payload..."
        />
      </PageSection>

      <PageSection title="What happens next" subtitle="The product keeps setup lightweight, but it should still be explicit about what it extracted and what still needs confirmation.">
        <div className="stack">
          <p>1. Parse each uploaded CV independently and preserve the original file.</p>
          <p>2. Create a temporary or unverified account if an email is found.</p>
          <p>3. Generate per-CV positioning and global job preferences.</p>
          <p>4. Let you review or correct the generated data before capturing jobs.</p>
        </div>
      </PageSection>

      <PageSection title="Current session" subtitle="This is the live server-backed session state, reduced to the decisions that matter for onboarding.">
        <QueryState
          isLoading={sessionQuery.isLoading}
          errorMessage={sessionQuery.error ? toErrorMessage(sessionQuery.error) : null}
          loadingLabel="Loading session..."
        />
        {sessionQuery.data ? (
          <div className="stack">
            <p><strong>Authenticated:</strong> {sessionQuery.data.authenticated ? 'Yes' : 'No'}</p>
            <p><strong>Access level:</strong> {sessionQuery.data.accessLevel}</p>
            <p><strong>Email:</strong> {sessionQuery.data.user?.email ?? 'None yet'}</p>
            <p><strong>Verification needed for return access:</strong> {sessionQuery.data.returnAccessRequiresVerification ? 'Yes' : 'No'}</p>
          </div>
        ) : null}
      </PageSection>
    </div>
  );
}
