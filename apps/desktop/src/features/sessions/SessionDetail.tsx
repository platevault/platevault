/**
 * SessionDetail — spec 006 wired; spec 043 §4 redesign (task #79).
 *
 * Detail panel for an InventorySession. The header spans the full panel width:
 * the target is the heading and a single concise acquisition line summarizes
 * the session (filter · frames · integration · night). The duplicate header
 * pills ("N frames", "Needs review") were removed — frames is a table column
 * and review state lives in the table and the REVIEW STATE rail card.
 *
 * Review actions (Confirm / Re-open / Reject) are CONTEXTUAL — they act on the
 * selected session — so they live in this header's actions slot, not the global
 * PageTopBar (task #79; supersedes the earlier FR-006 top-bar placement). The
 * SessionsPage passes the handlers, visibility flags, and pending state.
 *
 * Provenance is no longer a separate section: the Facts table's SOURCE column
 * already distinguishes FITS-extracted from inferred values, so target/filter
 * inference is surfaced inline (source: 'inferred') on the relevant fact rows.
 *
 * SC-004: no column is named Tags or Handling.
 * FR-004: state renders as plain structured data, not a decorative bubble.
 */

import type { InventorySession } from '@/api/commands';
import {
  DetailPane,
  DetailHeader,
  MetricLine,
  DetailGrid,
  Rail,
  RailCard,
  PropertyTable,
} from '@/components';
import { Pill, Section, EmptyState, Lock, Btn } from '@/ui';
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

/** One-line acquisition summary: filter · frames · integration · night. */
function acquisitionSummary(session: InventorySession): string {
  const parts: string[] = [];
  if (session.filter) parts.push(session.filter);
  parts.push(`${session.frames} ${session.frames === 1 ? 'frame' : 'frames'}`);
  if (session.exposure) parts.push(session.exposure);
  if (session.capturedOn) parts.push(session.capturedOn);
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

  // Provenance is merged into the Facts SOURCE column: if a value's identity was
  // inferred (provenance carries a value for it), the fact row reports
  // source='inferred' instead of 'fits'. Everything else is FITS-extracted.
  const prov = session.provenance;
  const targetSource = prov?.target ? ('inferred' as const) : ('fits' as const);
  const filterSource = prov?.filter ? ('inferred' as const) : ('fits' as const);

  const facts: Array<{ key: string; label: string; value: string; source: 'fits' | 'user' | 'inferred' }> = [
    { key: 'target', label: 'Target', value: session.target ?? '—', source: targetSource },
    { key: 'filter', label: 'Filter', value: session.filter ?? '—', source: filterSource },
    {
      key: 'exposure',
      label: 'Exposure',
      value: session.exposure ?? '—',
      source: 'fits' as const,
    },
    {
      key: 'capturedOn',
      label: 'Captured',
      value: session.capturedOn ?? '—',
      source: 'fits' as const,
    },
    { key: 'camera', label: 'Camera', value: session.camera ?? '—', source: 'fits' as const },
    { key: 'gain', label: 'Gain', value: session.gain ?? '—', source: 'fits' as const },
    {
      key: 'binning',
      label: 'Binning',
      value: session.binning ?? '—',
      source: 'fits' as const,
    },
    {
      key: 'setTemp',
      label: 'Sensor temp',
      value: session.setTemp ?? '—',
      source: 'fits' as const,
    },
  ];

  // Confirmed-by stays in the Facts table as an explicit 'user'-sourced row when
  // present — it records who confirmed identity, not an inferred value.
  if (prov?.confirmedBy) {
    facts.push({
      key: 'confirmedBy',
      label: 'Confirmed by',
      value: prov.confirmedBy,
      source: 'user' as const,
    });
  }

  return (
    <DetailPane fill>
      <DetailHeader
        title={
          <span className="alm-session-detail__heading">
            {isLinked && <Lock />}
            <strong>{session.target ?? session.name}</strong>
          </span>
        }
        subtitle={acquisitionSummary(session)}
        actions={
          <>
            {confirmVisible && (
              <Btn
                size="sm"
                variant="primary"
                onClick={onConfirm}
                disabled={pending}
              >
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
      />

      <MetricLine
        metrics={[
          { value: session.frames, label: 'frames' },
          { value: session.exposure ?? '—', label: 'exposure' },
          { value: session.type, label: 'type' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
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
                <span className="alm-session-detail__no-linked">
                  None
                </span>
              )}
              {isLinked && (
                <p className="alm-session-detail__lock-notice">
                  Linked to a project — metadata locked while in use.
                </p>
              )}
            </RailCard>
          </Rail>
        }
      >
        <Section title="Facts">
          <PropertyTable mode="view" showSource properties={facts} />
        </Section>

        {(session.linked?.calibration != null || session.linked?.session != null) && (
          <Section title="Linked">
            <PropertyTable
              mode="view"
              showSource
              properties={([
                session.linked?.session
                  ? {
                      key: 'linked-session',
                      label: 'Session',
                      value: session.linked.session,
                      source: 'fits' as const,
                    }
                  : null,
                session.linked?.calibration
                  ? {
                      key: 'linked-calibration',
                      label: 'Calibration',
                      value: session.linked.calibration,
                      source: 'fits' as const,
                    }
                  : null,
              ].filter(Boolean)) as Array<{
                key: string;
                label: string;
                value: string;
                source: 'fits' | 'user' | 'inferred';
              }>}
            />
          </Section>
        )}
      </DetailGrid>
    </DetailPane>
  );
}
