/**
 * SessionDetail — spec 006 wired; spec 043 §4 redesign (task #79/#99/#100).
 *
 * Detail panel for an InventorySession. Uses the shared DetailPanel wrapper
 * (task #100) so Sessions and Calibration share one header construct.
 *
 * Density + de-duplication (#99):
 *   The table row already shows: Target, Filter, Frames, Integration (exposure),
 *   Night, Camera, State, Projects. The detail panel MUST NOT repeat those
 *   fields in the title bar or as the primary hero.
 *
 *   - Title: target identity (always the identity anchor; appropriate to repeat
 *     as the selected-item label in the panel header).
 *   - Subtitle: camera · gain · sensor temp — equipment context NOT in the row.
 *   - MetricLine removed: it repeated Frames / Exposure / Type from the row.
 *   - Layout: side-by-side two-column (mirrors calibration detail):
 *       Left  (~280px) — compact 2-column KV grid of FITS facts.
 *       Right (flex: 1) — review state pill + linked projects.
 *     This is the right shape for the wide-short ListPageLayout bottom panel.
 *
 * Review actions (Confirm / Re-open / Reject) are CONTEXTUAL — they act on the
 * selected session — so they live in the detail header's actions slot, not the
 * global PageTopBar (task #79). The SessionsPage passes handlers + visibility.
 *
 * Provenance is surfaced inline via the Facts KV provenance label (inferred vs
 * FITS-extracted). A separate Provenance section is not needed.
 *
 * SC-004: no column is named Tags or Handling.
 * FR-004: state renders as plain structured data, not a decorative bubble.
 */

import type { InventorySession } from '@/api/commands';
import {
  DetailPane,
  DetailPanel,
  RailCard,
} from '@/components';
import { Pill, EmptyState, Lock, KV, Btn } from '@/ui';
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';

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
}

/**
 * Equipment context subtitle: camera · gain · sensor temp.
 * Shows fields NOT already visible in the table row (which shows Target,
 * Filter, Frames, Integration, Night, Camera, State, Projects). We include
 * Camera here too as the subtitle anchor — it provides identity context when
 * the panel is open, even though the row shows it.
 */
function equipmentSubtitle(session: InventorySession): string {
  const parts: string[] = [];
  if (session.camera) parts.push(session.camera);
  if (session.gain) parts.push(`g${session.gain}`);
  if (session.setTemp) parts.push(session.setTemp);
  if (session.binning) parts.push(session.binning);
  return parts.join(' · ');
}

export function SessionDetail({
  session,
  onConfirm,
  onReopen,
  onReject,
  confirmVisible = false,
  reopenVisible = false,
  rejectVisible = false,
  pending = false,
}: Props) {
  if (!session) {
    return (
      <DetailPane>
        <EmptyState
          title="Select a session"
          desc="Choose a session from the list to view its details."
        />
      </DetailPane>
    );
  }

  const isLinked = (session.linked?.projects?.length ?? 0) > 0;

  // Provenance: if a value was inferred, surface it via the KV provenance label.
  const prov = session.provenance;
  const targetProv = prov?.target ? 'Inferred' : 'FITS';
  const filterProv = prov?.filter ? 'Inferred' : 'FITS';

  return (
    <DetailPanel
      variant="sessions"
      title={
        <span className="alm-session-detail__heading">
          {isLinked && (
            <Lock reason="Linked to a project — metadata locked while in use." />
          )}
          <strong>{session.target ?? session.name}</strong>
        </span>
      }
      subtitle={equipmentSubtitle(session) || undefined}
      actions={
        <>
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
        </>
      }
    >
      {/* Side-by-side layout for the wide-short bottom panel.
          Left: compact 2-col KV grid of FITS facts.
          Right: review state + linked projects.
          See .cssblocks/detail-density.css. */}
      <div className="alm-session-detail">

        {/* ── Facts column ── */}
        <aside className="alm-session-detail__facts">
          <div className="alm-rail__panel">
            <RailCard title="Facts">
              <div className="alm-session-detail__kvgrid">
                <KV label="Target" value={session.target ?? '—'} provenance={targetProv} />
                <KV label="Filter" value={session.filter ?? '—'} provenance={filterProv} />
                <KV label="Frames" value={String(session.frames)} />
                <KV label="Exposure" value={session.exposure ?? '—'} />
                <KV label="Night" value={session.capturedOn ?? '—'} />
                <KV label="Camera" value={session.camera ?? '—'} />
                <KV label="Gain" value={session.gain ?? '—'} />
                <KV label="Binning" value={session.binning ?? '—'} />
                {session.setTemp && <KV label="Sensor temp" value={session.setTemp} />}
                {prov?.confirmedBy && (
                  <KV label="Confirmed by" value={prov.confirmedBy} provenance="User" />
                )}
              </div>
            </RailCard>
          </div>
        </aside>

        {/* ── State + linked column ── */}
        <div className="alm-session-detail__state">
          <div className="alm-rail__panel">
            {/* FR-004: state as read-only structured data; actions live in the header */}
            <RailCard title="Review state">
              <Pill variant={sessionStateVariant(session.state)}>
                {session.state === 'discovered' || session.state === 'candidate'
                  ? 'Needs review'
                  : sessionStateLabel(session.state)}
              </Pill>
            </RailCard>

            <RailCard title="Linked projects">
              {isLinked ? (
                <div className="alm-session-detail__linked-pills">
                  {session.linked?.projects?.map((p) => (
                    <Pill key={p.id} variant="info">
                      {p.name}
                    </Pill>
                  ))}
                </div>
              ) : (
                <span className="alm-session-detail__no-linked">None</span>
              )}
            </RailCard>

            {(session.linked?.calibration != null || session.linked?.session != null) && (
              <RailCard title="Linked">
                {session.linked?.session && (
                  <KV label="Session" value={session.linked.session} />
                )}
                {session.linked?.calibration && (
                  <KV label="Calibration" value={session.linked.calibration} />
                )}
              </RailCard>
            )}
          </div>
        </div>

      </div>
    </DetailPanel>
  );
}
