import { useParams } from '@tanstack/react-router';
import { TargetDetailPane } from './TargetDetailPane';

/**
 * Route-level component for /targets/$id.
 * Extracts the ID param and delegates to TargetDetailPane.
 */
export function TargetDetail() {
  const { id } = useParams({ strict: false }) as { id: string };

  return (
    <div className="alm-page" data-testid="TargetDetail">
      <TargetDetailPane targetId={id} />
    </div>
  );
}
