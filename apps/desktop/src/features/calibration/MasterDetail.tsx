/**
 * MasterDetail — spec 007 wired.
 *
 * Shows master fingerprint facts (from the real CalibrationMaster DTO) and
 * the ranked match candidates panel (from calibration.match.suggest using the
 * master's source_session_id as the anchor session).
 *
 * The calibration.match.suggest contract targets *light* sessions, not master
 * sessions. The MatchCandidatesPanel below is surfaced here so that when a user
 * selects a master they can see which sessions it would match (from that master's
 * originating session perspective). For the project-level accordion (T034) see
 * ProjectDetail.
 */

import type { CalibrationMaster } from '@/bindings/types';
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
  // Use source_session_id as the session anchor for suggest.
  // This is the calibration session that produced the master — we use it
  // to find which other masters would match the same fingerprint.
  const sessionId = master?.source_session_id ?? undefined;

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

  const isAging1Year = master.age_days >= 365;
  const isAgingWarn = master.age_days > agingThresholdDays && !isAging1Year;
  const kindStr = master.kind.toString().toLowerCase().replace('_', ' ');

  const fp = master.fingerprint;
  const properties: Array<{ key: string; label: string; value: string }> = [
    { key: 'kind', label: 'Kind', value: kindStr },
    { key: 'camera', label: 'Camera', value: fp.camera },
    { key: 'gain', label: 'Gain', value: String(fp.gain) },
    { key: 'exposure', label: 'Exposure', value: `${fp.exposure_s}s` },
  ];
  if (fp.temp_c != null) {
    properties.push({ key: 'temp', label: 'Temperature', value: `${fp.temp_c}°C` });
  }
  if (fp.filter) {
    properties.push({ key: 'filter', label: 'Filter', value: fp.filter });
  }
  if (fp.sensor_mode) {
    properties.push({ key: 'sensor_mode', label: 'Sensor mode', value: fp.sensor_mode });
  }
  properties.push({ key: 'binning', label: 'Binning', value: fp.binning });
  properties.push({ key: 'size', label: 'Size', value: fmtBytes(master.size_bytes) });

  return (
    <DetailPane fill>
      <DetailHeader
        title={
          <>
            <Lock />
            <span className="alm-mono">{master.id.slice(0, 12)}…</span>
          </>
        }
        titleExtra={
          <>
            <Pill variant={kindVariant(kindStr)}>{kindStr.toUpperCase()}</Pill>
            {isAging1Year && <Pill variant="danger">aging &gt; 1 year</Pill>}
            {isAgingWarn && <Pill variant="warn">aging {master.age_days}d</Pill>}
          </>
        }
        subtitle={`${kindStr} · ${fmtBytes(master.size_bytes)}`}
      />

      <MetricLine
        metrics={[
          { value: fmtBytes(master.size_bytes), label: 'on disk' },
          { value: `${master.age_days}d`, label: 'age' },
          { value: (master.used_by_session_ids ?? []).length, label: 'sessions' },
          { value: (master.used_by_project_ids ?? []).length, label: 'projects' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title="Master fingerprint">
              <PropertyTable mode="view" properties={properties} />
            </RailCard>

            <RailCard title="Reuse">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-xs)' }}>
                <div style={{ color: 'var(--alm-text-secondary)' }}>
                  <span style={{ color: 'var(--alm-text-faint)' }}>Sessions matched</span>{' '}
                  <strong>{(master.used_by_session_ids ?? []).length}</strong>
                </div>
                <div style={{ color: 'var(--alm-text-secondary)' }}>
                  <span style={{ color: 'var(--alm-text-faint)' }}>Projects linked</span>{' '}
                  <strong>{(master.used_by_project_ids ?? []).length}</strong>
                </div>
                <div style={{ color: 'var(--alm-text-secondary)' }}>
                  <span style={{ color: 'var(--alm-text-faint)' }}>Created</span>{' '}
                  {master.created_at.split('T')[0]}
                </div>
              </div>
            </RailCard>
          </Rail>
        }
      >
        <Section title="Calibration fingerprint" count={properties.length}>
          <PropertyTable mode="view" properties={properties} />
        </Section>

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
