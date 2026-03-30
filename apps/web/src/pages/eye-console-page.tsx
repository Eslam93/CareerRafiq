import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDiagnosticEventsQuery, useEyeCurrentQuery } from '../api-hooks.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { opsEyePath, webRoutes } from '../route-paths.js';
import { toErrorMessage } from '../utils/text.js';

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function buildDiagnosticBundle(input: {
  eyeSessionId: string | null;
  requestId: string | null;
  events: Array<{
    requestId: string | null;
    jobId: string | null;
    code: string;
    severity: string;
    createdAt: string;
  }>;
}): string {
  const recentRequestIds = [...new Set(input.events.map((event) => event.requestId).filter(Boolean))].slice(0, 8);
  const touchedJobIds = [...new Set(input.events.map((event) => event.jobId).filter(Boolean))].slice(0, 8);
  const latestFailures = input.events
    .filter((event) => event.severity !== 'info')
    .slice(0, 8)
    .map((event) => `${event.code} @ ${event.createdAt}`);

  return [
    `eyeSessionId: ${input.eyeSessionId ?? 'none'}`,
    `requestId: ${input.requestId ?? 'none'}`,
    `recentRequestIds: ${recentRequestIds.join(', ') || 'none'}`,
    `touchedJobIds: ${touchedJobIds.join(', ') || 'none'}`,
    `latestFailures: ${latestFailures.join(' | ') || 'none'}`,
  ].join('\n');
}

export function EyeConsolePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const eyeCurrentQuery = useEyeCurrentQuery();
  const filters = useMemo(
    () => ({
      eyeSessionId: searchParams.get('eyeSessionId') ?? eyeCurrentQuery.data?.session?.id ?? null,
      requestId: searchParams.get('requestId') ?? null,
      jobId: searchParams.get('jobId') ?? null,
      area: (searchParams.get('area') as Parameters<typeof useDiagnosticEventsQuery>[0]['area']) ?? null,
      severity: (searchParams.get('severity') as Parameters<typeof useDiagnosticEventsQuery>[0]['severity']) ?? null,
      sinceMinutes: Number(searchParams.get('sinceMinutes') ?? '60'),
      limit: Number(searchParams.get('limit') ?? '200'),
    }),
    [eyeCurrentQuery.data?.session?.id, searchParams],
  );
  const eventsQuery = useDiagnosticEventsQuery(filters);
  const events = eventsQuery.data?.events ?? [];
  const selectedEvent =
    events.find((event) => event.id === selectedEventId)
    ?? events[0]
    ?? null;

  function updateFilter(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (!value) {
      next.delete(name);
    } else {
      next.set(name, value);
    }
    setSearchParams(next);
  }

  async function handleCopyBundle() {
    await navigator.clipboard.writeText(
      buildDiagnosticBundle({
        eyeSessionId: filters.eyeSessionId,
        requestId: filters.requestId,
        events,
      }),
    );
  }

  return (
    <div className="page-stack">
      <PageSection title="Eye Console" subtitle="Operator timeline for request, auth, capture, extraction, AI, evaluation, and tracker traces.">
        <QueryState
          isLoading={eyeCurrentQuery.isLoading || eventsQuery.isLoading}
          errorMessage={eyeCurrentQuery.error ? toErrorMessage(eyeCurrentQuery.error) : eventsQuery.error ? toErrorMessage(eventsQuery.error) : null}
          loadingLabel="Loading Eye diagnostics..."
        />
        <div className="stack">
          <div className="button-row">
            <Link to={webRoutes.ops}>Back to Ops</Link>
            <button type="button" onClick={() => void handleCopyBundle()} disabled={events.length === 0}>
              Copy diagnostic bundle
            </button>
          </div>
          <form className="form-grid" onSubmit={(event) => event.preventDefault()}>
            <label className="field">
              <span>Eye session</span>
              <input value={filters.eyeSessionId ?? ''} onChange={(event) => updateFilter('eyeSessionId', event.target.value)} placeholder="eye_..." />
            </label>
            <label className="field">
              <span>Request ID</span>
              <input value={filters.requestId ?? ''} onChange={(event) => updateFilter('requestId', event.target.value)} placeholder="req_..." />
            </label>
            <label className="field">
              <span>Job ID</span>
              <input value={filters.jobId ?? ''} onChange={(event) => updateFilter('jobId', event.target.value)} placeholder="job_..." />
            </label>
            <label className="field">
              <span>Area</span>
              <select value={filters.area ?? ''} onChange={(event) => updateFilter('area', event.target.value)}>
                <option value="">All</option>
                <option value="request">request</option>
                <option value="auth">auth</option>
                <option value="runtime">runtime</option>
                <option value="ops">ops</option>
                <option value="extension">extension</option>
                <option value="capture">capture</option>
                <option value="extraction">extraction</option>
                <option value="ai">ai</option>
                <option value="evaluation">evaluation</option>
                <option value="tracker">tracker</option>
                <option value="client">client</option>
              </select>
            </label>
            <label className="field">
              <span>Severity</span>
              <select value={filters.severity ?? ''} onChange={(event) => updateFilter('severity', event.target.value)}>
                <option value="">All</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
            </label>
            <label className="field">
              <span>Window</span>
              <select value={String(filters.sinceMinutes)} onChange={(event) => updateFilter('sinceMinutes', event.target.value)}>
                <option value="15">15 minutes</option>
                <option value="60">1 hour</option>
                <option value="240">4 hours</option>
                <option value="1440">24 hours</option>
              </select>
            </label>
          </form>
        </div>
      </PageSection>

      <PageSection title="Timeline" subtitle="Most recent diagnostic events first.">
        {events.length > 0 ? (
          <div className="panel-grid">
            {events.map((event) => (
              <button
                key={event.id}
                type="button"
                className="card card--compact"
                onClick={() => setSelectedEventId(event.id)}
              >
                <strong>{event.code}</strong>
                <p className="muted">{event.area} / {event.stage}</p>
                <p className="muted">{event.summary}</p>
                <p className="muted">{formatTimestamp(event.createdAt)}</p>
                <p className="muted">Severity: {event.severity}</p>
                <p className="muted">Request: {event.requestId ?? 'n/a'}</p>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No diagnostic events matched the current filter set.</p>
        )}
      </PageSection>

      <PageSection title="Selected Event" subtitle="Step-by-step payload behind the selected diagnostic event.">
        {selectedEvent ? (
          <div className="stack">
            <div className="pill-grid">
              <div className={`pill pill--${selectedEvent.severity === 'error' ? 'warning' : selectedEvent.severity === 'warning' ? 'warning' : 'good'}`}>
                <span>Severity</span>
                <strong>{selectedEvent.severity}</strong>
              </div>
              <div className="pill pill--neutral">
                <span>Area</span>
                <strong>{selectedEvent.area}</strong>
              </div>
              <div className="pill pill--neutral">
                <span>Stage</span>
                <strong>{selectedEvent.stage}</strong>
              </div>
              <div className="pill pill--neutral">
                <span>Request ID</span>
                <strong>{selectedEvent.requestId ?? 'n/a'}</strong>
              </div>
            </div>
            <p><strong>Summary:</strong> {selectedEvent.summary}</p>
            <p><strong>Created:</strong> {formatTimestamp(selectedEvent.createdAt)}</p>
            <p><strong>Filtered link:</strong> <Link to={opsEyePath({ eyeSessionId: selectedEvent.eyeSessionId, requestId: selectedEvent.requestId, jobId: selectedEvent.jobId, area: selectedEvent.area, severity: selectedEvent.severity })}>Open focused view</Link></p>
            <pre>{JSON.stringify(selectedEvent.payload ?? {}, null, 2)}</pre>
          </div>
        ) : (
          <p className="muted">Select a timeline entry to inspect the underlying payload.</p>
        )}
      </PageSection>
    </div>
  );
}
