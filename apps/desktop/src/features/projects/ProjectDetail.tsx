import { useParams } from '@tanstack/react-router';
import { ProjectDetailPane } from './ProjectDetailPane';

/**
 * Route-level wrapper for /projects/:id.
 * Extracts the route param and delegates to ProjectDetailPane which works
 * both inline (3-pane) and standalone (direct route).
 */
export function ProjectDetail() {
  const { id } = useParams({ strict: false }) as { id: string };

  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <ProjectDetailPane projectId={id} />
    </div>
  );
}
