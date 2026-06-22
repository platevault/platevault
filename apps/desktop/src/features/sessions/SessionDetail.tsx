/**
 * SessionDetail — clean tabular session detail (spec 043 §4 redesign).
 *
 * The session's attributes render as a flat PropertyTable (Property | Value |
 * Source) spread across two columns inside the canonical DetailPanel. Linked
 * projects sit below with a clickable link per project. Review/Confirm actions
 * live in the header.
 *
 * The per-frame frames table + review-state pill were removed: a session is a
 * single frame-type group, so the frames table only duplicated the row data;
 * the freed space lets the attribute table use both columns.
 */

import type { InventorySession } from '@/api/commands';
import {
  DetailPane,
  DetailPanel,
  PropertyTable,
  type PropertyDef,
} from '@/components';
import { EmptyState, Btn } from '@/ui';

interface Props {
  session: InventorySession | null;
  /** Contextual review-action handlers (act on this session). */
  onConfirm?: () => void;
  onReopen?: () => void;
  onReject?: () => void;
  /** Action visibility — driven by the session's canonical state on the page. */
  confirmVisible?: boolean;
  reopenVisible?: boolean;
  rejectVisible?: boolean;
  /** A review mutation is in flight for this session. */
  pending?: boolean;
  /** Open a linked project — wired by the page to navigation. */
  onOpenProject?: (projectId: string) => void;
}

/** Equipment context subtitle: camera · gain · sensor temp · binning. */
function equipmentSubtitle(session: InventorySession): string {
  const parts: string[] = [];
  if (session.camera) parts.push(session.camera);
  if (session.gain) parts.push(`g${session.gain}`);
  if (session.setTemp) parts.push(session.setTemp);
  if (session.binning) parts.push(session.binning);
  return parts.join(' · ');
}

/** Derive total integration seconds from frames × per-frame exposure. */
function integrationSeconds(session: InventorySession): number | null {
  if (!session.exposure) return null;
  const raw = session.exposure.replace(/s$/i, '');
  const secs = parseFloat(raw);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return secs * session.frames;
}

function fmtSeconds(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionDetail({
  session,
  onConfirm,
  onReopen,
  onReject,
  confirmVisible = false,
  reopenVisible = false,
  rejectVisible = false,
  pending = false,
  onOpenProject,
}: Props) {
  if (!session) {
    return (
      <DetailPane>
        <EmptyState
          title="Select a session"
          desc="Select a session to view its details."
        />
      </DetailPane>
    );
  }

  const isLinked = (session.linked?.projects?.length ?? 0) > 0;
  const prov = session.provenance;
  const totalSec = integrationSeconds(session);
  const integrationLabel = totalSec != null ? fmtSeconds(totalSec) : null;

  // Session facts as a clean tabular PropertyTable, spread across two columns.
  const factProps: PropertyDef[] = [
    { key: 'target', label: 'Target', value: session.target ?? null, source: prov?.target ? 'inferred' : 'fits' },
    { key: 'filter', label: 'Filter', value: session.filter ?? null, source: prov?.filter ? 'inferred' : 'fits' },
    { key: 'frames', label: 'Frames', value: session.frames },
    { key: 'exposure', label: 'Exposure', value: session.exposure ?? null, source: 'fits' },
    ...(integrationLabel != null
      ? [{ key: 'integration', label: 'Total integration', value: integrationLabel } as PropertyDef]
      : []),
    { key: 'night', label: 'Night', value: session.capturedOn ?? null, source: 'fits' },
    { key: 'camera', label: 'Camera', value: session.camera ?? null, source: 'fits' },
    { key: 'gain', label: 'Gain', value: session.gain ?? null, source: 'fits' },
    { key: 'binning', label: 'Binning', value: session.binning ?? null, source: 'fits' },
    ...(session.setTemp
      ? [{ key: 'temp', label: 'Sensor temp', value: session.setTemp, source: 'fits' } as PropertyDef]
      : []),
    ...(prov?.confirmedBy
      ? [{ key: 'confirmedby', label: 'Confirmed by', value: prov.confirmedBy, source: 'user' } as PropertyDef]
      : []),
  ];

  const mid = Math.ceil(factProps.length / 2);
  const colA = factProps.slice(0, mid);
  const colB = factProps.slice(mid);

  // Review actions sit inline with the title (left-grouped) so growing the
  // panel only adds trailing whitespace — it never spreads the title and
  // buttons apart.
  const actionButtons = (
    <span className="alm-session-detail2__actions">
      {confirmVisible && (
        <Btn size="sm" variant="primary" onClick={onConfirm} disabled={pending}>
          Confirm
        </Btn>
      )}
      {reopenVisible && (
        <Btn size="sm" onClick={onReopen} disabled={pending}>
          Re-open review
        </Btn>
      )}
      {rejectVisible && (
        <Btn size="sm" variant="danger" onClick={onReject} disabled={pending}>
          Reject
        </Btn>
      )}
    </span>
  );

  return (
    <DetailPanel
      variant="sessions"
      title={<strong>{session.target ?? session.name}</strong>}
      titleExtra={actionButtons}
      subtitle={equipmentSubtitle(session) || undefined}
    >
      {/* Left-packed columns: [props A] [props B] [linked projects]. */}
      <div className="alm-session-detail2">
        <div className="alm-session-detail2__col">
          <PropertyTable mode="view" showSource properties={colA} />
        </div>
        <div className="alm-session-detail2__col">
          <PropertyTable mode="view" showSource properties={colB} />
        </div>
        <div className="alm-session-detail2__linked">
          <div className="alm-session-detail2__head">Linked projects</div>
          {isLinked ? (
            <div className="alm-session-detail2__linked-list">
              {session.linked?.projects?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="alm-session-detail2__link"
                  onClick={() => onOpenProject?.(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          ) : (
            <span className="alm-session-detail2__muted">None</span>
          )}
        </div>
      </div>
    </DetailPanel>
  );
}
