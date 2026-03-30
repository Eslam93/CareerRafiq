import { NavLink, Outlet } from 'react-router-dom';
import { useLogoutMutation, useSessionQuery } from '../api-hooks.js';
import { webRoutes } from '../route-paths.js';

const navItems = [
  { to: webRoutes.setup, label: 'Setup' },
  { to: webRoutes.review, label: 'Review' },
  { to: webRoutes.cvs, label: 'CVs' },
  { to: webRoutes.tracker, label: 'Tracker' },
  { to: webRoutes.manualCapture, label: 'Manual Capture' },
  { to: webRoutes.ops, label: 'Ops' },
];

export function AppShell() {
  const sessionQuery = useSessionQuery();
  const logoutMutation = useLogoutMutation();
  const session = sessionQuery.data;

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__eyebrow">AI Job Fit Copilot</span>
          <strong>CareerRafiq</strong>
        </div>
        <nav className="topbar__nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'topbar__link topbar__link--active' : 'topbar__link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar__session">
          {session?.authenticated ? (
            <div className="topbar__session-meta">
              <span>{session.user?.email ?? '(no email)'}</span>
              <span>{session.accessLevel} access | expires {session.sessionExpiresAt ? new Date(session.sessionExpiresAt).toLocaleString() : 'n/a'}</span>
              {session.returnAccessRequiresVerification ? <span>Return access still requires verification.</span> : null}
              {session.emailCollectionRequired ? <span>Add an email to receive a return-access link.</span> : null}
              <button type="button" className="button button--ghost" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
                {logoutMutation.isPending ? 'Signing out...' : 'Logout'}
              </button>
            </div>
          ) : (
            <span>anonymous</span>
          )}
        </div>
      </header>
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}
