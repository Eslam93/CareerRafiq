import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app-shell.js';
import { AuthConsumePage } from './pages/auth-consume-page.js';
import { CvsPage } from './pages/cvs-page.js';
import { EyeConsolePage } from './pages/eye-console-page.js';
import { JobReviewPage } from './pages/job-review-page.js';
import { LoginPage } from './pages/login-page.js';
import { ManualCapturePage } from './pages/manual-capture-page.js';
import { NotFoundPage } from './pages/not-found-page.js';
import { OpsPage } from './pages/ops-page.js';
import { ReviewPage } from './pages/review-page.js';
import { SetupPage } from './pages/setup-page.js';
import { TrackerDetailPage } from './pages/tracker-detail-page.js';
import { TrackerPage } from './pages/tracker-page.js';
import { webRoutes } from './route-paths.js';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to={webRoutes.setup} replace />} />
        <Route path={webRoutes.setup} element={<SetupPage />} />
        <Route path={webRoutes.login} element={<LoginPage />} />
        <Route path={webRoutes.review} element={<ReviewPage />} />
        <Route path={webRoutes.cvs} element={<CvsPage />} />
        <Route path={webRoutes.ops} element={<OpsPage />} />
        <Route path={webRoutes.opsEye} element={<EyeConsolePage />} />
        <Route path={webRoutes.manualCapture} element={<ManualCapturePage />} />
        <Route path={webRoutes.jobReview} element={<JobReviewPage />} />
        <Route path={webRoutes.tracker} element={<TrackerPage />} />
        <Route path={webRoutes.trackerDetail} element={<TrackerDetailPage />} />
        <Route path={webRoutes.authConsume} element={<AuthConsumePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
