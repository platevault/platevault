import { clsx } from 'clsx';
import { useLogPanel } from './LogPanelContext';
import { useOperationStatus } from './OperationStatusContext';
import { usePageStatus } from './PageStatusContext';
import { useStatusSummary } from './useStatusSummary';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

/**
 * Status bar (design v4): three zones. LEFT = the current operation (transient),
 * CENTER = GLOBAL library inventory totals (task #87 — stable across routes,
 * NOT per-page counts), RIGHT = persistent storage/cleanup health + log toggle.
 *
 * The global totals come from `useStatusSummary()` → `commands.statusSummary()`
 * (the real `LibraryStats` DTO: sessions / projects / calibration sets /
 * targets). There is no library-wide image/file count in the contract yet (the
 * Advanced settings "Records" line is hardcoded), so the image total is a STUB
 * placeholder until the metadata-ingest pipeline exposes one.
 */
export function StatusBar() {
  const { toggle } = useLogPanel();
  const { statusLabel } = useOperationStatus();
  const status = useStatusSummary();
  const pageStatus = usePageStatus();
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

      {/* PAGE-CONTEXTUAL — shown only when the active page populates the slot
          (currently: Inbox folder/master count + per-frame-type breakdown).
          Sits left-of-center and is cleared automatically on route change. */}
      {pageStatus != null && (
        <div className="alm-statusbar__page" data-testid="statusbar-page-status">
          {pageStatus}
        </div>
      )}

      {/* CENTER — GLOBAL library inventory (stable across routes, task #87).
          Sessions / projects / calibration masters / targets are real totals
          from the status_summary contract. Images is a STUB until a library-wide
          file count lands in the metadata pipeline. */}
      <div className="alm-statusbar__lib" data-testid="statusbar-library-stats">
        <span title="Total acquisition sessions">
          {formatCount(status.sessionCount)} sessions
        </span>
        <span className="alm-statusbar__sep">·</span>
        <span title="Total projects">{formatCount(status.projectCount)} projects</span>
        <span className="alm-statusbar__sep">·</span>
        <span title="Total calibration masters">
          {formatCount(status.calibrationCount)} masters
        </span>
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
