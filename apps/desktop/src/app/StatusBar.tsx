import { clsx } from 'clsx';
import { useLogPanel } from './LogPanelContext';
import { useOperationStatus } from './OperationStatusContext';
import { useStatusSummary } from './useStatusSummary';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Status bar (design v4): three zones. LEFT = the current operation (transient),
 * RIGHT = persistent storage/cleanup health, far right = log toggle. Library
 * inventory counts were removed — those live in the nav badges and on the pages.
 */
export function StatusBar() {
  const { toggle } = useLogPanel();
  const { statusLabel } = useOperationStatus();
  const status = useStatusSummary();
  const isActive = statusLabel !== 'Idle';

  return (
    <div className="alm-frame__statusbar">
      {/* LEFT — current operation */}
      <div className="alm-statusbar__op">
        {isActive ? (
          <>
            <span className="alm-statusbar__spinner" />
            <span>{statusLabel}</span>
          </>
        ) : (
          <span className="alm-statusbar__idle">Ready</span>
        )}
      </div>

      {/* RIGHT — persistent storage / cleanup health + log */}
      <div className="alm-statusbar__right">
        {status.cleanupReclaimableBytes > 0 && (
          <span>{formatBytes(status.cleanupReclaimableBytes)} reclaimable</span>
        )}
        {status.volumes.map((vol) => {
          const usedPct =
            vol.totalBytes > 0 ? Math.round(((vol.totalBytes - vol.freeBytes) / vol.totalBytes) * 100) : 0;
          const label = vol.path.split(/[\\/]/).pop() || vol.path;
          return (
            <span
              key={vol.path}
              className={clsx('alm-statusbar__vol', vol.warning && 'alm-statusbar__vol--warn')}
              title={`${vol.path}: ${formatBytes(vol.freeBytes)} free / ${formatBytes(vol.totalBytes)}`}
            >
              <span>{label}</span>
              <span className="alm-statusbar__meter">
                {/* eslint-disable-next-line no-restricted-syntax -- dynamic: disk usage meter width % */}
                <i style={{ width: `${usedPct}%` }} />
              </span>
              <span>{usedPct}%</span>
            </span>
          );
        })}
        <button
          type="button"
          className="alm-statusbar__log-toggle"
          onClick={toggle}
          aria-label="Toggle log panel"
        >
          Log
        </button>
      </div>
    </div>
  );
}
