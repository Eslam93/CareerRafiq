import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { setStoredEyeSessionId } from '../api-client.js';
import { useDevEmailOutboxLookupMutation, useDiagnosticEventsQuery, useEyeCurrentQuery, useOpsSummaryQuery, useRecordClientDiagnosticEventMutation, useRuntimeDetailQuery, useRuntimeReadinessQuery, useStartEyeSessionMutation, useStopEyeSessionMutation } from '../api-hooks.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { jobReviewPath, opsEyePath, trackerDetailPath } from '../route-paths.js';
import { toErrorMessage } from '../utils/text.js';

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

export function OpsPage() {
  const opsSummaryQuery = useOpsSummaryQuery();
  const runtimeReadinessQuery = useRuntimeReadinessQuery();
  const runtimeDetailQuery = useRuntimeDetailQuery();
  const eyeCurrentQuery = useEyeCurrentQuery();
  const startEyeSessionMutation = useStartEyeSessionMutation();
  const stopEyeSessionMutation = useStopEyeSessionMutation();
  const recordClientDiagnosticEventMutation = useRecordClientDiagnosticEventMutation();
  const outboxLookupMutation = useDevEmailOutboxLookupMutation();
  const [lookupEmail, setLookupEmail] = useState('');
  const summary = opsSummaryQuery.data?.summary ?? null;
  const readiness = runtimeReadinessQuery.data ?? null;
  const runtimeDetail = runtimeDetailQuery.data ?? null;
  const activeEyeSession = eyeCurrentQuery.data?.session ?? null;
  const eyeEventsQuery = useDiagnosticEventsQuery(
    {
      eyeSessionId: activeEyeSession?.id ?? null,
      limit: 20,
      sinceMinutes: 240,
    },
    Boolean(activeEyeSession),
  );

  useEffect(() => {
    if (!lookupEmail && summary?.email.currentAddress) {
      setLookupEmail(summary.email.currentAddress);
    }
  }, [lookupEmail, summary?.email.currentAddress]);

  useEffect(() => {
    setStoredEyeSessionId(activeEyeSession?.id ?? null);
  }, [activeEyeSession?.id]);

  async function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookupEmail.trim()) {
      return;
    }
    await outboxLookupMutation.mutateAsync(lookupEmail.trim());
  }

  const latestMessage = outboxLookupMutation.data?.message ?? null;
  const eyeEvents = eyeEventsQuery.data?.events ?? [];

  async function handleStartEyeSession() {
    const result = await startEyeSessionMutation.mutateAsync({
      label: `manual-${new Date().toISOString().slice(0, 19)}`,
    });
    if (result.session?.id) {
      setStoredEyeSessionId(result.session.id);
      await recordClientDiagnosticEventMutation.mutateAsync({
        eyeSessionId: result.session.id,
        area: 'client',
        stage: 'ops',
        code: 'eye_session_started_from_web',
        severity: 'info',
        summary: 'Eye session was started from the Ops page.',
      });
    }
  }

  async function handleStopEyeSession() {
    if (!activeEyeSession?.id) {
      return;
    }
    await recordClientDiagnosticEventMutation.mutateAsync({
      eyeSessionId: activeEyeSession.id,
      area: 'client',
      stage: 'ops',
      code: 'eye_session_stopped_from_web',
      severity: 'info',
      summary: 'Eye session stop was requested from the Ops page.',
    });
    await stopEyeSessionMutation.mutateAsync(activeEyeSession.id);
    setStoredEyeSessionId(null);
  }

  async function handleCopyEyeBundle() {
    const recentRequestIds = [...new Set(eyeEvents.map((event) => event.requestId).filter(Boolean))].slice(0, 8);
    const touchedJobIds = [...new Set(eyeEvents.map((event) => event.jobId).filter(Boolean))].slice(0, 8);
    const latestFailureCodes = eyeEvents.filter((event) => event.severity !== 'info').slice(0, 8).map((event) => event.code);
    await navigator.clipboard.writeText(
      [
        `eyeSessionId: ${activeEyeSession?.id ?? 'none'}`,
        `operatorEmail: ${summary?.user.email ?? 'unknown'}`,
        `activeUserId: ${summary?.user.id ?? 'unknown'}`,
        `latestRequestIds: ${recentRequestIds.join(', ') || 'none'}`,
        `latestFailureCodes: ${latestFailureCodes.join(', ') || 'none'}`,
        `touchedJobIds: ${touchedJobIds.join(', ') || 'none'}`,
        `timeWindowMinutes: 240`,
      ].join('\n'),
    );
  }

  return (
    <div className="page-stack">
      <PageSection title="Ops Summary" subtitle="Internal launch checks for delivery, tracker coverage, and analytics instrumentation.">
        <QueryState
          isLoading={opsSummaryQuery.isLoading}
          errorMessage={opsSummaryQuery.error ? toErrorMessage(opsSummaryQuery.error) : null}
          loadingLabel="Loading operational summary..."
        />
        {summary ? (
          <div className="stack">
            <div className={summary.analytics.missingKeyEvents.length > 0 ? 'callout callout--warning' : 'callout callout--success'}>
              <strong>Coverage check:</strong>{' '}
              {summary.analytics.missingKeyEvents.length > 0
                ? `Missing expected analytics events: ${summary.analytics.missingKeyEvents.join(', ')}`
                : 'Core launch instrumentation is present for this account.'}
            </div>
            <div className="pill-grid">
              <SummaryPill label="Account" value={summary.user.accountStatus} tone={summary.user.accountStatus === 'verified' ? 'good' : 'warning'} />
              <SummaryPill
                label="Tracker Items"
                value={String(summary.tracker.totalItems)}
                tone={summary.tracker.totalItems > 0 ? 'good' : 'neutral'}
              />
              <SummaryPill
                label="Review Queue"
                value={String(summary.tracker.reviewRequiredItems)}
                tone={summary.tracker.reviewRequiredItems > 0 ? 'warning' : 'good'}
              />
              <SummaryPill
                label="Latest Email"
                value={formatLabel(summary.email.latestDeliveryStatus)}
                tone={summary.email.latestDeliveryStatus === 'failed' ? 'warning' : summary.email.latestDeliveryStatus ? 'good' : 'neutral'}
              />
              <SummaryPill
                label="Active Overrides"
                value={String(summary.tracker.overrideActiveItems.length)}
                tone={summary.tracker.overrideActiveItems.length > 0 ? 'warning' : 'good'}
              />
            </div>
          </div>
        ) : null}
      </PageSection>

      <PageSection title="Runtime Readiness" subtitle="Server readiness checks for database, web bundle, email, and AI configuration.">
        <QueryState
          isLoading={runtimeReadinessQuery.isLoading}
          errorMessage={runtimeReadinessQuery.error ? toErrorMessage(runtimeReadinessQuery.error) : null}
          loadingLabel="Loading runtime readiness..."
        />
        {readiness ? (
          <div className="stack">
            <div className={readiness.warnings.length > 0 ? 'callout callout--warning' : 'callout callout--success'}>
              <strong>Ready state:</strong>{' '}
              {readiness.warnings.length > 0
                ? readiness.warnings.join(' ')
                : 'Database, served web bundle, and configured integrations are in a usable state.'}
            </div>
            <div className="pill-grid">
              <SummaryPill label="Database" value={readiness.checks.databaseReady ? 'ready' : 'not ready'} tone={readiness.checks.databaseReady ? 'good' : 'warning'} />
              <SummaryPill label="Web bundle" value={readiness.checks.webBundleReady ? 'ready' : 'not ready'} tone={readiness.checks.webBundleReady ? 'good' : 'warning'} />
              <SummaryPill label="Email delivery" value={readiness.checks.emailDeliveryConfigured ? 'smtp' : 'dev outbox'} tone={readiness.checks.emailDeliveryConfigured ? 'good' : 'neutral'} />
              <SummaryPill label="AI provider" value={readiness.checks.aiProviderConfigured ? 'configured' : 'disabled'} tone={readiness.checks.aiProviderConfigured ? 'good' : 'neutral'} />
            </div>
            <div className="panel-grid">
              <article className="card card--compact">
                <strong>Configured AI flags</strong>
                <p className="muted">
                  {Object.entries(readiness.ai.configuredFlags)
                    .filter(([, enabled]) => enabled)
                    .map(([name]) => formatLabel(name))
                    .join(', ') || 'None'}
                </p>
              </article>
              <article className="card card--compact">
                <strong>Active AI features</strong>
                <p className="muted">
                  {Object.entries(readiness.ai.activeFeatures)
                    .filter(([, enabled]) => enabled)
                    .map(([name]) => formatLabel(name))
                    .join(', ') || 'None'}
                </p>
              </article>
            </div>
          </div>
        ) : (
          <p className="muted">Load the readiness payload to inspect runtime health.</p>
        )}
      </PageSection>

      <PageSection title="Eye Mode" subtitle="Operator-only deep diagnostics for manual testing, request replay, and root-cause inspection.">
        <QueryState
          isLoading={eyeCurrentQuery.isLoading || runtimeDetailQuery.isLoading}
          errorMessage={eyeCurrentQuery.error ? toErrorMessage(eyeCurrentQuery.error) : runtimeDetailQuery.error ? toErrorMessage(runtimeDetailQuery.error) : eyeEventsQuery.error ? toErrorMessage(eyeEventsQuery.error) : null}
          loadingLabel="Loading Eye diagnostics..."
        />
        <div className="stack">
          <div className="button-row">
            <button type="button" onClick={() => void handleStartEyeSession()} disabled={startEyeSessionMutation.isPending || Boolean(activeEyeSession)}>
              {startEyeSessionMutation.isPending ? 'Starting...' : 'Start Eye session'}
            </button>
            <button type="button" onClick={() => void handleStopEyeSession()} disabled={stopEyeSessionMutation.isPending || !activeEyeSession}>
              {stopEyeSessionMutation.isPending ? 'Stopping...' : 'Stop Eye session'}
            </button>
            <Link to={opsEyePath({ eyeSessionId: activeEyeSession?.id ?? null })}>Open Eye console</Link>
            <button type="button" onClick={() => void handleCopyEyeBundle()} disabled={!activeEyeSession}>
              Copy diagnostic bundle
            </button>
          </div>
          <div className={activeEyeSession ? 'callout callout--warning' : 'callout callout--success'}>
            <strong>Active session:</strong>{' '}
            {activeEyeSession
              ? `${activeEyeSession.label ?? activeEyeSession.id} started ${new Date(activeEyeSession.startedAt).toLocaleString()}`
              : 'No Eye session is currently attached to this browser.'}
          </div>
          {runtimeDetail ? (
            <div className="panel-grid">
              <article className="card card--compact">
                <strong>Allowed origins</strong>
                <p className="muted">{runtimeDetail.origins.allowed.join(', ') || 'none'}</p>
              </article>
              <article className="card card--compact">
                <strong>Cookie mode</strong>
                <p className="muted">
                  secure={runtimeDetail.cookies.secure ? 'true' : 'false'} | sameSite={runtimeDetail.cookies.sameSite}
                </p>
              </article>
              <article className="card card--compact">
                <strong>Eye retention</strong>
                <p className="muted">{runtimeDetail.eye.retentionDays} day(s)</p>
              </article>
              <article className="card card--compact">
                <strong>Capture rate limit</strong>
                <p className="muted">
                  {runtimeDetail.rateLimits.capture.max} / {runtimeDetail.rateLimits.capture.windowSeconds}s
                </p>
              </article>
            </div>
          ) : null}
          <div className="stack">
            <strong>Recent Eye events</strong>
            {eyeEvents.length > 0 ? (
              <div className="panel-grid">
                {eyeEvents.slice(0, 6).map((event) => (
                  <article key={event.id} className="card card--compact">
                    <strong>{event.code}</strong>
                    <p className="muted">{event.area} / {event.stage}</p>
                    <p className="muted">{event.summary}</p>
                    <p className="muted">Request: {event.requestId ?? 'n/a'}</p>
                    <div className="button-row">
                      <Link to={opsEyePath({ eyeSessionId: event.eyeSessionId, requestId: event.requestId, jobId: event.jobId, area: event.area, severity: event.severity })}>
                        Inspect in Eye console
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">Start an Eye session to collect detailed runtime events for manual testing.</p>
            )}
          </div>
        </div>
      </PageSection>

      <PageSection title="Tracker Health" subtitle="Source-of-truth job records, review backlog, and duplicate surfacing.">
        {summary ? (
          <div className="stack">
            <div className="panel-grid">
              {summary.tracker.byStatus.map((entry) => (
                <article key={entry.status} className="card card--compact">
                  <strong>{formatLabel(entry.status)}</strong>
                  <p className="muted">{entry.count} item(s)</p>
                </article>
              ))}
            </div>
            <div className="panel-grid">
              <article className="card card--compact">
                <strong>Items with active evaluation</strong>
                <p className="muted">{summary.tracker.itemsWithActiveEvaluation}</p>
              </article>
              <article className="card card--compact">
                <strong>Probable duplicate candidates</strong>
                <p className="muted">{summary.tracker.duplicateCandidateItems}</p>
              </article>
            </div>

            <div className="stack">
              <strong>Review queue</strong>
              {summary.tracker.reviewQueue.length > 0 ? (
                <div className="panel-grid">
                  {summary.tracker.reviewQueue.map((entry) => (
                    <article key={entry.jobId} className="card card--compact">
                      <strong>{entry.title ?? 'Untitled role'}</strong>
                      <p className="muted">{entry.company ?? 'Unknown company'}</p>
                      <p className="muted">Status: {formatLabel(entry.currentStatus)}</p>
                      <p className="muted">Reasons: {entry.reviewReasons.join(', ') || 'n/a'}</p>
                      <div className="button-row">
                        <Link to={jobReviewPath(entry.jobId)}>Open review</Link>
                        <Link to={trackerDetailPath(entry.jobId)}>Tracker detail</Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No jobs are currently waiting in the review queue.</p>
              )}
            </div>

            <div className="stack">
              <strong>Duplicate queue</strong>
              {summary.tracker.duplicateQueue.length > 0 ? (
                <div className="panel-grid">
                  {summary.tracker.duplicateQueue.map((entry) => (
                    <article key={entry.jobId} className="card card--compact">
                      <strong>{entry.title ?? 'Untitled role'}</strong>
                      <p className="muted">{entry.company ?? 'Unknown company'}</p>
                      <p className="muted">{entry.duplicateCount} possible duplicate(s)</p>
                      <div className="button-row">
                        <Link to={trackerDetailPath(entry.jobId)}>Resolve duplicates</Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No unresolved duplicate candidates are currently visible.</p>
              )}
            </div>

            <div className="stack">
              <strong>Active overrides</strong>
              {summary.tracker.overrideActiveItems.length > 0 ? (
                <div className="panel-grid">
                  {summary.tracker.overrideActiveItems.map((entry) => (
                    <article key={entry.jobId} className="card card--compact">
                      <strong>{entry.title ?? 'Untitled role'}</strong>
                      <p className="muted">{entry.company ?? 'Unknown company'}</p>
                      <p className="muted">
                        Recommendation: {formatLabel(entry.recommendedCvDecision)} | verdict: {formatLabel(entry.verdictDecision)}
                      </p>
                      <div className="button-row">
                        <Link to={trackerDetailPath(entry.jobId)}>Open tracker detail</Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No manual trust overrides are currently active.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="muted">Load the summary to see tracker health.</p>
        )}
      </PageSection>

      <PageSection title="Analytics Coverage" subtitle="Recent event counts show whether the main funnel is instrumented end to end.">
        {summary ? (
          <div className="stack">
            <p>
              <strong>Total recorded events:</strong> {summary.analytics.totalEvents}
            </p>
            {summary.analytics.byName.length > 0 ? (
              <div className="panel-grid">
                {summary.analytics.byName.map((entry) => (
                  <article key={entry.name} className="card card--compact">
                    <strong>{formatLabel(entry.name)}</strong>
                    <p className="muted">{entry.count} event(s)</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No analytics events recorded yet for this account.</p>
            )}
          </div>
        ) : (
          <p className="muted">Load the summary to see analytics counts.</p>
        )}
      </PageSection>

      <PageSection title="Email Outbox Lookup" subtitle="Use this when SMTP is disabled or when a delivery needs inspection during beta.">
        <form className="form-grid" onSubmit={handleLookup}>
          <label className="field">
            <span>Email address</span>
            <input
              value={lookupEmail}
              onChange={(event) => setLookupEmail(event.target.value)}
              placeholder="name@example.com"
              inputMode="email"
            />
          </label>
          <div className="button-row">
            <button type="submit" disabled={outboxLookupMutation.isPending || lookupEmail.trim().length === 0}>
              {outboxLookupMutation.isPending ? 'Checking...' : 'Load latest message'}
            </button>
          </div>
        </form>
        <QueryState
          isLoading={outboxLookupMutation.isPending}
          errorMessage={outboxLookupMutation.error ? toErrorMessage(outboxLookupMutation.error) : null}
          loadingLabel="Looking up latest email outbox record..."
        />
        {latestMessage ? (
          <div className="stack">
            <div className="pill-grid">
              <SummaryPill
                label="Delivery status"
                value={formatLabel(latestMessage.deliveryStatus)}
                tone={latestMessage.deliveryStatus === 'failed' ? 'warning' : 'good'}
              />
              <SummaryPill label="Provider" value={formatLabel(latestMessage.deliveryProvider)} tone="neutral" />
              <SummaryPill label="Created" value={new Date(latestMessage.createdAt).toLocaleString()} tone="neutral" />
              <SummaryPill
                label="Last attempt"
                value={latestMessage.lastAttemptAt ? new Date(latestMessage.lastAttemptAt).toLocaleString() : 'n/a'}
                tone="neutral"
              />
            </div>
            {latestMessage.errorMessage ? (
              <div className="callout callout--warning">
                <strong>Delivery error:</strong> {latestMessage.errorMessage}
              </div>
            ) : null}
            <div className="stack">
              <p>
                <strong>Subject:</strong> {latestMessage.subject}
              </p>
              <pre>{latestMessage.body}</pre>
            </div>
          </div>
        ) : (
          <p className="muted">No outbox message loaded yet.</p>
        )}
      </PageSection>
    </div>
  );
}
