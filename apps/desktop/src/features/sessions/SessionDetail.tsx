/**
 * SessionDetail — spec 006 wired.
 *
 * Detail drawer for an InventorySession. Shows Lifecycle, Facts, Provenance,
 * and Linked sections per spec 006 research.md §5. Review actions are
 * action-bound (FR-006): Confirm only appears when eligible, Re-open only
 * when already confirmed/rejected, Reject as danger.
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
import { Pill, Section, EmptyState, Lock } from '@/ui';
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';

interface Props {
  session: InventorySession | null;
  onConfirm: () => void;
  onReopen: () => void;
  onReject: () => void;
  isPending?: boolean;
}

export function SessionDetail({ session, onConfirm, onReopen, onReject, isPending }: Props) {
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

  // Action-bound CTA visibility (spec 006 FR-006):
  // Confirm only when in discovered / candidate / needs_review.
  // Re-open only when confirmed or rejected.
  // Reject always except when already rejected.
  const confirmVisible = ['discovered', 'candidate', 'needs_review'].includes(session.state);
  const reopenVisible = ['confirmed', 'rejected'].includes(session.state);
  const rejectVisible = session.state !== 'rejected';

  const displayPath = session.name;

  const facts = [
    { key: 'target', label: 'Target', value: session.target ?? '—', source: 'fits' as const },
    { key: 'filter', label: 'Filter', value: session.filter ?? '—', source: 'fits' as const },
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

  // Provenance summary rows — confidence/evidence detail NOT shown (spec 002 FR-006).
  const provenanceFacts = session.provenance
    ? ([
        session.provenance.target
          ? {
              key: 'prov-target',
              label: 'Target provenance',
              value: session.provenance.target,
              source: 'inferred' as const,
            }
          : null,
        session.provenance.filter
          ? {
              key: 'prov-filter',
              label: 'Filter provenance',
              value: session.provenance.filter,
              source: 'inferred' as const,
            }
          : null,
        session.provenance.inferred
          ? {
              key: 'prov-inferred',
              label: 'Inferred',
              value: session.provenance.inferred,
              source: 'inferred' as const,
            }
          : null,
        session.provenance.confirmedBy
          ? {
              key: 'prov-confirmed',
              label: 'Confirmed by',
              value: session.provenance.confirmedBy,
              source: 'user' as const,
            }
          : null,
      ].filter(Boolean) as Array<{
        key: string;
        label: string;
        value: string;
        source: 'fits' | 'user' | 'inferred';
      }>)
    : [];

  return (
    <DetailPane fill>
      <DetailHeader
        title={
          <>
            {isLinked && <Lock />}
            <strong>{session.target ?? session.name}</strong>
            {session.filter ? ` · ${session.filter}` : null}
            {session.capturedOn ? ` · ${session.capturedOn}` : null}
          </>
        }
        titleExtra={
          <>
            <Pill variant="neutral">{session.frames} frames</Pill>
            {/* FR-004: state as plain structured data, not a decorative bubble */}
            <Pill variant={sessionStateVariant(session.state)}>
              {session.state === 'discovered' || session.state === 'candidate'
                ? 'Needs review'
                : sessionStateLabel(session.state)}
            </Pill>
          </>
        }
        subtitle={displayPath}
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
            <RailCard title="Review state">
              <Pill variant={sessionStateVariant(session.state)}>
                {session.state === 'discovered' || session.state === 'candidate'
                  ? 'Needs review'
                  : sessionStateLabel(session.state)}
              </Pill>
              <div className="alm-session-detail__action-stack">
                {confirmVisible && (
                  <button
                    className="alm-btn alm-btn--primary alm-btn--sm"
                    onClick={onConfirm}
                    disabled={isPending}
                    data-testid="btn-confirm"
                  >
                    Confirm
                  </button>
                )}
                {reopenVisible && (
                  <button
                    className="alm-btn alm-btn--sm"
                    onClick={onReopen}
                    disabled={isPending}
                    data-testid="btn-reopen"
                  >
                    Re-open review
                  </button>
                )}
                {rejectVisible && (
                  <button
                    className="alm-btn alm-btn--danger alm-btn--sm"
                    onClick={onReject}
                    disabled={isPending}
                    data-testid="btn-reject"
                  >
                    Reject session
                  </button>
                )}
                {isLinked && (
                  <div className="alm-session-detail__lock-notice">
                    Linked to a project — metadata locked while in use.
                  </div>
                )}
              </div>
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
            </RailCard>
          </Rail>
        }
      >
        <Section title="Facts">
          <PropertyTable mode="view" showSource properties={facts} />
        </Section>

        {provenanceFacts.length > 0 && (
          <Section title="Provenance">
            <PropertyTable mode="view" showSource properties={provenanceFacts} />
          </Section>
        )}

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
