/**
 * MasterDetail — spec 007 wired · spec 043 §4 (calibration detail hero) ·
 * tasks #100/#101.
 *
 * Uses the canonical DetailPanel with the `facts` prop so the fingerprint +
 * reuse KV sits in the pinned left column and the compatible-sessions match
 * table sits in the scrolling right content column — matching the two-column
 * contract from the unified DetailPanel design.
 *
 * The Lock icon was removed (task #101): it had no associated behavior, no
 * tooltip reason, and no visual explanation. Masters are not user-locked; reuse
 * is shown in the Reuse rail card.
 *
 * The calibration.match.suggest contract targets *light* sessions, not master
 * sessions, so we anchor it on the master's sourceSessionId to surface the
 * sessions sharing this master's fingerprint.
 */

import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';
import {
  DetailPane,
  DetailPanel,
  MetricLine,
  RailCard,
} from '@/components';
import { Pill, EmptyState, KV, Btn } from '@/ui';
import type { PillVariant } from '@/ui';
import { useCalibrationSuggest, useCalibrationAssign } from './useCalibration';
import { MatchCandidatesPanel } from './MatchCandidatesPanel';

// ── Helpers ───────────────────────────────────────────────────────────────────

function kindVariant(kind: string): PillVariant {
  const map: Record<string, PillVariant> = { dark: 'info', flat: 'accent', bias: 'neutral' };
  return map[kind.toLowerCase()] ?? 'neutral';
}

// Per-master contextual actions. These act on the selected master and therefore
// live in the DETAIL panel header (not the global page top bar): the top bar
// holds only page-level search / filters / group-by.
interface ContextualAction {
  label: string;
  variant?: 'primary' | 'danger' | 'ghost';
}

function masterActions(master: CalibrationMaster, agingThresholdDays: number): ContextualAction[] {
  const isAging = master.ageDays > agingThresholdDays;
  const actions: ContextualAction[] = [{ label: 'Use in project', variant: 'primary' }];
  if (isAging) actions.push({ label: 'Replace master', variant: 'danger' });
  actions.push({ label: 'Reveal in Explorer' });
  return actions;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  master: CalibrationMaster | null;
  prefillSuggestion: boolean;
  /** Days threshold for aging warnings. Comes from persisted settings (FR-023). */
  agingThresholdDays: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MasterDetail({ master, prefillSuggestion, agingThresholdDays }: Props) {
  // Use sourceSessionId as the session anchor for suggest.
  // This is the calibration session that produced the master — we use it
  // to find which other masters would match the same fingerprint.
  const sessionId = master?.sourceSessionId ?? undefined;

  const { response, loading: suggestLoading, error: suggestError, refresh } = useCalibrationSuggest(sessionId);
  const { assigning, assign } = useCalibrationAssign();

  const handleAssign = async (masterId: string, override: boolean) => {
    if (!sessionId) return { status: 'error' as const, error: { code: 'session.not_found', message: 'No session' } };
    const res = await assign(sessionId, masterId, override);
    if (res.status === 'success') {
      refresh();
    }
    return res as { status: string; error?: { code: string; message: string; details?: { dimensions: string[] } } };
  };

  if (!master) {
    return (
      <DetailPane>
        <EmptyState
          title="Select a master"
          desc="Choose a calibration master from the list to view its details and suggestions."
        />
      </DetailPane>
    );
  }

  const isAging1Year = master.ageDays >= 365;
  const isAgingWarn = master.ageDays > agingThresholdDays && !isAging1Year;
  const kindStr = master.kind.toString().toLowerCase().replace('_', ' ');

  const fp = master.fingerprint;

  // Human-readable fingerprint identity for the header (was an id hash).
  const kindCap = kindStr.charAt(0).toUpperCase() + kindStr.slice(1);
  const masterDisc =
    kindStr === 'dark' ? (fp.exposureS != null ? `${fp.exposureS}s` : '')
    : kindStr === 'flat' ? (fp.filter ?? '')
    : '';
  const masterTitle = masterDisc ? `Master ${kindCap} · ${masterDisc}` : `Master ${kindCap}`;

  // Facts column (left): fingerprint KV — compact, does not scroll.
  const facts = (
    <div className="alm-rail__panel">
      <RailCard title="Master fingerprint">
        {/* 2-column KV grid: keeps the fingerprint compact so the whole
            detail fits the wide-short bottom panel without inner scroll. */}
        <div className="alm-calib-kvgrid">
          <KV label="Kind" value={kindStr} />
          <KV label="Camera" value={fp.camera} />
          <KV label="Gain" value={String(fp.gain)} />
          <KV label="Exposure" value={`${fp.exposureS}s`} />
          {fp.tempC != null && <KV label="Temperature" value={`${fp.tempC}°C`} />}
          {fp.filter && <KV label="Filter" value={fp.filter} />}
          {fp.sensorMode && <KV label="Sensor mode" value={fp.sensorMode} />}
          <KV label="Binning" value={fp.binning} />
          <KV label="Size" value={fmtBytes(master.sizeBytes)} />
        </div>
      </RailCard>
    </div>
  );

  // Aux column (right): reuse policy + usage stats.
  const auxColumn = (
    <div className="alm-rail__panel">
      <RailCard title="Reuse policy">
        <div className="alm-calib-kvgrid">
          <KV label="Sessions matched" value={String((master.usedBySessionIds ?? []).length)} />
          <KV label="Projects linked" value={String((master.usedByProjectIds ?? []).length)} />
          <KV label="Created" value={master.createdAt.split('T')[0]} />
          <KV label="Age" value={`${master.ageDays}d`} />
        </div>
      </RailCard>
      <RailCard title="Usage stats">
        <MetricLine
          metrics={[
            { value: fmtBytes(master.sizeBytes), label: 'on disk' },
            { value: `${master.ageDays}d`, label: 'age' },
            { value: (master.usedBySessionIds ?? []).length, label: 'sessions' },
            { value: (master.usedByProjectIds ?? []).length, label: 'projects' },
          ]}
        />
      </RailCard>
    </div>
  );

  return (
    <DetailPanel
      variant="calibration"
      // Title: master identity (kind + discriminator). The Lock icon was removed
      // (task #101): it had no behavior, no tooltip reason, and no explanation.
      // Masters are not user-locked; reuse is shown in the Reuse rail card.
      title={<span>{masterTitle}</span>}
      titleExtra={
        <>
          <Pill variant={kindVariant(kindStr)}>{kindStr.toUpperCase()}</Pill>
          {isAging1Year && <Pill variant="danger">aging &gt; 1 year</Pill>}
          {isAgingWarn && <Pill variant="warn">aging {master.ageDays}d</Pill>}
        </>
      }
      subtitle={`${kindStr} · ${fmtBytes(master.sizeBytes)}`}
      actions={masterActions(master, agingThresholdDays).map((a) => (
        <Btn key={a.label} size="sm" variant={a.variant}>
          {a.label}
        </Btn>
      ))}
      facts={facts}
      aux={auxColumn}
    >
      {/* Content column (center, scrolls): compatible-sessions match table is
          the hero of the master detail. */}
      <MatchCandidatesPanel
        sessionId={sessionId ?? ''}
        response={response}
        loading={suggestLoading}
        error={suggestError}
        onAssign={handleAssign}
        assigning={assigning}
        prefillSuggestion={prefillSuggestion}
      />
    </DetailPanel>
  );
}
