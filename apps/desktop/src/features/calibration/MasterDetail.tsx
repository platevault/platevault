/**
 * MasterDetail — spec 007 wired · spec 043 §4 (calibration detail hero).
 *
 * The hero of the master detail is the COMPATIBLE-SESSIONS MATCH TABLE
 * (`MatchCandidatesPanel`): which acquisition sessions this master can
 * calibrate, ranked by confidence. The master's fingerprint + reuse facts live
 * once in the shared RailCard + KV rail.
 *
 * The calibration.match.suggest contract targets *light* sessions, not master
 * sessions, so we anchor it on the master's sourceSessionId to surface the
 * sessions sharing this master's fingerprint. For the project-level accordion
 * (T034) see ProjectDetail.
 */

import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';
import {
  DetailPane,
  DetailHeader,
  MetricLine,
  DetailGrid,
  Rail,
  RailCard,
} from '@/components';
import { Pill, EmptyState, Lock, KV } from '@/ui';
import type { PillVariant } from '@/ui';
import { useCalibrationSuggest, useCalibrationAssign } from './useCalibration';
import { MatchCandidatesPanel } from './MatchCandidatesPanel';

// ── Helpers ───────────────────────────────────────────────────────────────────

function kindVariant(kind: string): PillVariant {
  const map: Record<string, PillVariant> = { dark: 'info', flat: 'accent', bias: 'neutral' };
  return map[kind.toLowerCase()] ?? 'neutral';
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

  return (
    <DetailPane fill>
      <DetailHeader
        title={
          <>
            <Lock />
            <span>{masterTitle}</span>
          </>
        }
        titleExtra={
          <>
            <Pill variant={kindVariant(kindStr)}>{kindStr.toUpperCase()}</Pill>
            {isAging1Year && <Pill variant="danger">aging &gt; 1 year</Pill>}
            {isAgingWarn && <Pill variant="warn">aging {master.ageDays}d</Pill>}
          </>
        }
        subtitle={`${kindStr} · ${fmtBytes(master.sizeBytes)}`}
      />

      <MetricLine
        metrics={[
          { value: fmtBytes(master.sizeBytes), label: 'on disk' },
          { value: `${master.ageDays}d`, label: 'age' },
          { value: (master.usedBySessionIds ?? []).length, label: 'sessions' },
          { value: (master.usedByProjectIds ?? []).length, label: 'projects' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title="Master fingerprint">
              <KV label="Kind" value={kindStr} />
              <KV label="Camera" value={fp.camera} />
              <KV label="Gain" value={String(fp.gain)} />
              <KV label="Exposure" value={`${fp.exposureS}s`} />
              {fp.tempC != null && <KV label="Temperature" value={`${fp.tempC}°C`} />}
              {fp.filter && <KV label="Filter" value={fp.filter} />}
              {fp.sensorMode && <KV label="Sensor mode" value={fp.sensorMode} />}
              <KV label="Binning" value={fp.binning} />
              <KV label="Size" value={fmtBytes(master.sizeBytes)} />
            </RailCard>

            <RailCard title="Reuse">
              <KV label="Sessions matched" value={String((master.usedBySessionIds ?? []).length)} />
              <KV label="Projects linked" value={String((master.usedByProjectIds ?? []).length)} />
              <KV label="Created" value={master.createdAt.split('T')[0]} />
            </RailCard>
          </Rail>
        }
      >
        {/* Fingerprint lives once, in the rail. The compatible-sessions match
            panel is the hero of the main column. */}
        <MatchCandidatesPanel
          sessionId={sessionId ?? ''}
          response={response}
          loading={suggestLoading}
          error={suggestError}
          onAssign={handleAssign}
          assigning={assigning}
          prefillSuggestion={prefillSuggestion}
        />
      </DetailGrid>
    </DetailPane>
  );
}
