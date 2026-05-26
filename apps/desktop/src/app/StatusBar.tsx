import { Link } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { useLogPanel } from './LogPanelContext';
import { useOperationStatus } from './OperationStatusContext';

interface StatusBarProps {
  inboxCount?: number;
  sessionCount?: number;
  calibrationCount?: number;
  cleanupReclaimableBytes?: number;
  volumes?: { path: string; freeBytes: number; totalBytes: number; warning: boolean }[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function StatusBar({
  inboxCount = 0,
  sessionCount = 0,
  calibrationCount = 0,
  cleanupReclaimableBytes = 0,
  volumes = [],
}: StatusBarProps) {
  const { toggle } = useLogPanel();
  const { statusLabel } = useOperationStatus();
  const isIngesting = statusLabel !== 'Idle';

  return (
    <div className="alm-statusbar">
      {/* Inbox badge */}
      {inboxCount > 0 && (
        <Link to="/inbox" className="alm-statusbar__inbox-badge">
          {inboxCount} new
        </Link>
      )}

      {/* Ingestion progress */}
      {isIngesting && (
        <span className="alm-statusbar__ingestion">{statusLabel}</span>
      )}

      {/* Library stats */}
      <span className="alm-statusbar__stats">
        {sessionCount} sessions
        <span className="alm-statusbar__sep">&middot;</span>
        {calibrationCount} cal
      </span>

      {/* Cleanup available */}
      {cleanupReclaimableBytes > 0 && (
        <span className="alm-statusbar__cleanup">
          {formatBytes(cleanupReclaimableBytes)} reclaimable
        </span>
      )}

      {/* Storage health per volume */}
      {volumes.map((vol) => (
        <span
          key={vol.path}
          className={clsx(
            'alm-statusbar__volume',
            vol.warning && 'alm-statusbar__volume--warn',
          )}
          title={`${vol.path}: ${formatBytes(vol.freeBytes)} free / ${formatBytes(vol.totalBytes)}`}
        >
          {vol.path.split(/[\\/]/).pop()}
          {vol.warning && ' ⚠'}
        </span>
      ))}

      {/* Log toggle */}
      <button
        type="button"
        className="alm-statusbar__log-toggle"
        onClick={toggle}
        aria-label="Toggle log panel"
      >
        Log
      </button>
    </div>
  );
}
