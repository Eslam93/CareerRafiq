import { Link, useSearchParams } from 'react-router-dom';
import { useMagicLinkConsumeQuery } from '../api-hooks.js';
import { PageSection } from '../components/page-section.js';
import { QueryState } from '../components/query-state.js';
import { webRoutes } from '../route-paths.js';
import { toErrorMessage } from '../utils/text.js';

export function AuthConsumePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  const consumeQuery = useMagicLinkConsumeQuery(token, email);

  return (
    <div className="page-stack">
      <PageSection title="Magic Link Consume" subtitle="Consume verification/login token and bootstrap authenticated session.">
        {!token ? <p>Missing token query parameter.</p> : null}
        <QueryState
          isLoading={consumeQuery.isLoading}
          errorMessage={consumeQuery.error ? toErrorMessage(consumeQuery.error) : null}
          loadingLabel="Consuming magic link..."
        />
        {consumeQuery.data ? (
          <div className="stack">
            <p>
              <strong>Verified:</strong> {consumeQuery.data.verified ? 'Yes' : 'No'}
            </p>
            <p>
              <strong>Access level:</strong> {consumeQuery.data.accessLevel ?? 'n/a'}
            </p>
            <p>
              <strong>User:</strong> {consumeQuery.data.user?.id ?? 'n/a'}
            </p>
            <div className="button-row">
              <Link to={webRoutes.tracker}>Open tracker</Link>
              <Link to={webRoutes.review}>Open review</Link>
            </div>
          </div>
        ) : null}
      </PageSection>
    </div>
  );
}
