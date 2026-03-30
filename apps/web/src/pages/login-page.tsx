import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMagicLinkRequestMutation, useSessionQuery } from '../api-hooks.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { webRoutes } from '../route-paths.js';
import { toErrorMessage } from '../utils/text.js';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const sessionQuery = useSessionQuery();
  const requestMutation = useMagicLinkRequestMutation();
  const returnTo = searchParams.get('returnTo');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      return;
    }
    await requestMutation.mutateAsync(email.trim());
  }

  return (
    <div className="page-stack">
      <PageSection title="Resume your account" subtitle="CareerRafiq uses passwordless return access. Enter the email tied to your CV setup and request a magic link.">
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          </label>
          <button type="submit" disabled={requestMutation.isPending || email.trim().length === 0}>
            {requestMutation.isPending ? 'Sending...' : 'Send magic link'}
          </button>
        </form>
        <QueryState
          isLoading={requestMutation.isPending}
          errorMessage={requestMutation.error ? toErrorMessage(requestMutation.error) : null}
          loadingLabel="Sending magic link..."
        />
        {requestMutation.data ? (
          <div className="callout callout--success">
            Magic link sent to {requestMutation.data.sentTo}. If SMTP is disabled during beta, open the Ops page to inspect the latest outbox record.
          </div>
        ) : null}
        {returnTo ? <p className="muted">Requested return target: {returnTo}</p> : null}
      </PageSection>

      <PageSection title="Session status" subtitle="Useful when the extension opens this screen after session expiry.">
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
          </div>
        ) : null}
        <div className="button-row">
          <Link to={webRoutes.setup}>Setup</Link>
          <Link to={webRoutes.tracker}>Tracker</Link>
          <Link to={webRoutes.ops}>Ops</Link>
        </div>
      </PageSection>
    </div>
  );
}
