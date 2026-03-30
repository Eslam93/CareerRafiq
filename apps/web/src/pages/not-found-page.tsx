import { Link } from 'react-router-dom';
import { PageSection } from '../components/page-section.js';
import { webRoutes } from '../route-paths.js';

export function NotFoundPage() {
  return (
    <div className="page-stack">
      <PageSection title="Route Not Found" subtitle="Use one of the internal beta routes below.">
        <ul className="simple-list">
          <li>
            <Link to={webRoutes.setup}>{webRoutes.setup}</Link>
          </li>
          <li>
            <Link to={webRoutes.review}>{webRoutes.review}</Link>
          </li>
          <li>
            <Link to={webRoutes.manualCapture}>{webRoutes.manualCapture}</Link>
          </li>
          <li>
            <Link to={webRoutes.tracker}>{webRoutes.tracker}</Link>
          </li>
          <li>
            <Link to={webRoutes.ops}>{webRoutes.ops}</Link>
          </li>
          <li>
            <Link to={webRoutes.authConsume}>{webRoutes.authConsume}</Link>
          </li>
        </ul>
      </PageSection>
    </div>
  );
}
