import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { CvUploadCommitDecision } from '@career-rafiq/contracts';
import { Link } from 'react-router-dom';
import {
  useAnalyzeCvUploadsMutation,
  useCommitCvUploadsMutation,
  useCvDetailQuery,
  useCvListQuery,
  useSetCvDefaultMutation,
} from '../api-hooks.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { webRoutes } from '../route-paths.js';
import { toErrorMessage } from '../utils/text.js';

interface PendingResolutionState {
  decision: 'create_new' | 'update_existing' | null;
  targetCvId: string | null;
}

export function CvsPage() {
  const cvListQuery = useCvListQuery();
  const cvItems = cvListQuery.data?.items ?? [];
  const [selectedCvId, setSelectedCvId] = useState('');
  const selectedCv = cvItems.find((item) => item.cv.id === selectedCvId) ?? cvItems[0] ?? null;
  const cvDetailQuery = useCvDetailQuery(selectedCv?.cv.id ?? '');
  const analyzeMutation = useAnalyzeCvUploadsMutation();
  const commitMutation = useCommitCvUploadsMutation();
  const setDefaultMutation = useSetCvDefaultMutation();

  const [files, setFiles] = useState<File[]>([]);
  const [resolutionStateByToken, setResolutionStateByToken] = useState<Record<string, PendingResolutionState>>({});

  const analysis = analyzeMutation.data?.items ?? [];
  const resolutionRequiredItems = analysis.filter((item) => item.status === 'resolution_required');
  const committableItems = analysis.filter((item) => item.status !== 'rejected_non_cv');

  useEffect(() => {
    if (selectedCv) {
      setSelectedCvId(selectedCv.cv.id);
    }
  }, [selectedCv?.cv.id]);

  useEffect(() => {
    if (analysis.length === 0) {
      setResolutionStateByToken({});
      return;
    }
    setResolutionStateByToken((current) => {
      const next = { ...current };
      for (const item of analysis) {
        if (item.status !== 'resolution_required') {
          continue;
        }
        next[item.uploadToken] ??= {
          decision: null,
          targetCvId: item.candidateMatches[0]?.candidateCvId ?? null,
        };
      }
      return next;
    });
  }, [analysis]);

  const readyToCommit = useMemo(() => {
    if (analysis.length === 0 || committableItems.length === 0) {
      return false;
    }
    return resolutionRequiredItems.every((item) => {
      const state = resolutionStateByToken[item.uploadToken];
      return Boolean(state?.decision) && (state?.decision !== 'update_existing' || state.targetCvId);
    });
  }, [analysis, committableItems.length, resolutionRequiredItems, resolutionStateByToken]);

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) {
      return;
    }
    await analyzeMutation.mutateAsync(files);
  }

  async function handleCommit(): Promise<void> {
    if (!readyToCommit) {
      return;
    }

    const decisions: CvUploadCommitDecision[] = analysis
      .filter((item) => item.status !== 'rejected_non_cv')
      .map((item) => {
        if (item.status === 'accepted') {
          return {
            uploadToken: item.uploadToken,
            decision: 'create_new',
            targetCvId: null,
          };
        }

        const state = resolutionStateByToken[item.uploadToken];
        return {
          uploadToken: item.uploadToken,
          decision: state?.decision ?? 'create_new',
          targetCvId: state?.targetCvId ?? null,
        };
      });

    await commitMutation.mutateAsync({ files, decisions });
    setFiles([]);
    setResolutionStateByToken({});
    analyzeMutation.reset();
  }

  return (
    <div className="page-stack">
      <PageSection
        title="CV Manager"
        subtitle="Browse active CVs, inspect version history, upload replacements, and choose which CV should act as the default tie-breaker."
      >
        <QueryState
          isLoading={cvListQuery.isLoading}
          errorMessage={cvListQuery.error ? toErrorMessage(cvListQuery.error) : null}
          loadingLabel="Loading CV library..."
        />
        {cvItems.length > 0 ? (
          <div className="stack">
            <div className="card-grid">
              {cvItems.map((item) => (
                <button
                  key={item.cv.id}
                  type="button"
                  className={item.cv.id === selectedCv?.cv.id ? 'button' : 'button button--ghost'}
                  onClick={() => setSelectedCvId(item.cv.id)}
                >
                  {item.cvProfile?.cvName ?? item.cv.fileName}
                  {item.isDefault ? ' (Default)' : ''}
                </button>
              ))}
            </div>

            {selectedCv ? (
              <div className="stack">
                <div className="callout callout--neutral">
                  <strong>{selectedCv.cvProfile?.cvName ?? selectedCv.cv.fileName}</strong>
                  <p className="muted">Last updated: {new Date(selectedCv.lastUpdatedAt).toLocaleString()}</p>
                  <p className="muted">Version count: {selectedCv.versionCount}</p>
                  <p className="muted">Processing status: {selectedCv.cv.processingStatus}</p>
                  <div className="button-row">
                    <button
                      type="button"
                      onClick={() => setDefaultMutation.mutate(selectedCv.cv.id)}
                      disabled={setDefaultMutation.isPending || selectedCv.isDefault}
                    >
                      {selectedCv.isDefault ? 'Current default CV' : 'Set as default'}
                    </button>
                    <Link className="button button--ghost" to={`${webRoutes.review}?cvId=${encodeURIComponent(selectedCv.cv.id)}`}>
                      Open in review editor
                    </Link>
                  </div>
                </div>

                <QueryState
                  isLoading={cvDetailQuery.isLoading}
                  errorMessage={cvDetailQuery.error ? toErrorMessage(cvDetailQuery.error) : null}
                  loadingLabel="Loading CV details..."
                />
                {cvDetailQuery.data ? (
                  <div className="stack">
                    <div className="callout callout--neutral">
                      <strong>Profile summary</strong>
                      <p><strong>Primary role:</strong> {cvDetailQuery.data.cvProfile?.primaryRole ?? 'Unknown'}</p>
                      <p><strong>Seniority:</strong> {cvDetailQuery.data.cvProfile?.seniority ?? 'unknown'}</p>
                      <p><strong>Career track:</strong> {cvDetailQuery.data.cvProfile?.careerTrack ?? 'Unknown'}</p>
                      <p><strong>Core stack:</strong> {cvDetailQuery.data.cvProfile?.coreStack.join(', ') || 'None'}</p>
                    </div>
                    <div className="callout callout--neutral">
                      <strong>Version history</strong>
                      <ul className="simple-list">
                        {cvDetailQuery.data.versions.map((version) => (
                          <li key={version.id}>
                            <strong>{version.fileName}</strong> | uploaded {new Date(version.uploadedAt).toLocaleString()}
                            {version.supersededAt ? ` | superseded ${new Date(version.supersededAt).toLocaleString()}` : ' | current'}
                            {version.classification ? ` | ${version.classification.documentTypeLabel ?? (version.classification.isResume ? 'resume' : 'non-resume')}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="muted">No CVs have been added yet.</p>
            )}
          </div>
        ) : null}
      </PageSection>

      <PageSection
        title="Upload Or Update"
        subtitle="Analyze files first, then explicitly choose whether each matched upload should create a new CV or replace an existing one."
      >
        <form className="form-grid" onSubmit={handleAnalyze}>
          <label className="field">
            <span>Files</span>
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.txt"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>
          <button type="submit" disabled={files.length === 0 || analyzeMutation.isPending}>
            {analyzeMutation.isPending ? 'Analyzing uploads...' : 'Analyze uploads'}
          </button>
        </form>

        <QueryState
          isLoading={analyzeMutation.isPending || commitMutation.isPending}
          errorMessage={
            (analyzeMutation.error ? toErrorMessage(analyzeMutation.error) : null) ??
            (commitMutation.error ? toErrorMessage(commitMutation.error) : null)
          }
          loadingLabel={analyzeMutation.isPending ? 'Analyzing uploads...' : 'Committing CV uploads...'}
        />

        {analysis.length > 0 ? (
          <div className="stack">
            {analysis.map((item) => (
              <div key={item.uploadToken} className={`callout ${item.status === 'rejected_non_cv' ? 'callout--warning' : 'callout--neutral'}`}>
                <strong>{item.fileName}</strong>
                <p><strong>Status:</strong> {item.status.replaceAll('_', ' ')}</p>
                <p><strong>Classifier:</strong> {item.classification?.reason ?? 'No classifier output recorded.'}</p>
                {item.warning ? <p><strong>Warning:</strong> {item.warning}</p> : null}
                {item.status === 'resolution_required' ? (
                  <div className="stack">
                    <label className="field">
                      <span>Decision</span>
                      <select
                        value={resolutionStateByToken[item.uploadToken]?.decision ?? ''}
                        onChange={(event) =>
                          setResolutionStateByToken((current) => ({
                            ...current,
                            [item.uploadToken]: {
                              decision: event.target.value === 'update_existing' ? 'update_existing' : event.target.value === 'create_new' ? 'create_new' : null,
                              targetCvId: current[item.uploadToken]?.targetCvId ?? item.candidateMatches[0]?.candidateCvId ?? null,
                            },
                          }))
                        }
                      >
                        <option value="">Choose one</option>
                        <option value="create_new">Create a new CV</option>
                        <option value="update_existing">Update an existing CV</option>
                      </select>
                    </label>
                    {resolutionStateByToken[item.uploadToken]?.decision === 'update_existing' ? (
                      <label className="field">
                        <span>Existing CV</span>
                        <select
                          value={resolutionStateByToken[item.uploadToken]?.targetCvId ?? ''}
                          onChange={(event) =>
                            setResolutionStateByToken((current) => ({
                              ...current,
                              [item.uploadToken]: {
                                decision: 'update_existing',
                                targetCvId: event.target.value,
                              },
                            }))
                          }
                        >
                          {item.candidateMatches.map((candidate) => (
                            <option key={candidate.candidateCvId} value={candidate.candidateCvId}>
                              {candidate.candidateCvName} | {candidate.matchType.replaceAll('_', ' ')} | {(candidate.score * 100).toFixed(0)}%
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <ul className="simple-list">
                      {item.candidateMatches.map((candidate) => (
                        <li key={`${item.uploadToken}-${candidate.candidateCvId}`}>
                          {candidate.candidateCvName}: {candidate.reasons.join(' ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}

            <button type="button" onClick={() => void handleCommit()} disabled={commitMutation.isPending || !readyToCommit}>
              {commitMutation.isPending ? 'Applying CV changes...' : 'Commit uploads'}
            </button>
            {commitMutation.data?.reevaluatedJobIds.length ? (
              <p className="muted">Reevaluated jobs: {commitMutation.data.reevaluatedJobIds.join(', ')}</p>
            ) : null}
          </div>
        ) : null}
      </PageSection>
    </div>
  );
}
