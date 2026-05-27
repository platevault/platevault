import type { MasterFixture } from '@/data/fixtures/calibration';
import { focusedMaster } from '@/data/fixtures/calibration';
import { DetailPane, DetailHeader } from '@/components';
import { Pill, Btn, Box, KV, Table, EmptyState, Lock } from '@/ui';

interface Props {
  master: MasterFixture | null;
}

// Compatible sessions fixture (shown for the focused master only)
const COMPAT_SESSIONS = [
  { check: 'ok', session: 'NGC 7000 · Ha · 2024-11-30', frames: 54, score: 0.92, softMismatch: '—', decision: 'accepted' as const },
  { check: 'ok', session: 'NGC 7000 · OIII · 2024-11-30', frames: 38, score: 0.92, softMismatch: '—', decision: 'accepted' as const },
  { check: 'ok', session: 'NGC 7000 · SII · 2024-12-01', frames: 22, score: 0.91, softMismatch: '—', decision: 'undecided' as const },
  { check: 'soft', session: 'NGC 7000 · Ha · 2024-12-15', frames: 30, score: 0.88, softMismatch: '−10.3°C vs −10°C (Δ 0.3)', decision: 'undecided' as const },
];

export function MasterDetail({ master }: Props) {
  if (!master) {
    return (
      <DetailPane>
        <EmptyState
          title="Select a master"
          desc="Choose a calibration master from the list to view its details."
        />
      </DetailPane>
    );
  }

  const isAging1Year = master.age >= 365;
  const isAgingWarn = master.aging && !isAging1Year;

  return (
    <DetailPane>
      {/* Header */}
      <DetailHeader
        title={
          <>
            <Lock />
            <span className="alm-mono">{master.name}</span>
          </>
        }
        titleExtra={
          <>
            <Pill variant="info">MASTER · {master.kind.toUpperCase()}</Pill>
            {isAging1Year && <Pill variant="danger">aging &gt; 1 year</Pill>}
            {isAgingWarn && <Pill variant="warn">aging {master.age}d</Pill>}
          </>
        }
        subtitle={`${master.name}.xisf · ${master.size}`}
        actions={
          <>
            <Btn size="sm">Reveal</Btn>
            <Btn size="sm">Use in project</Btn>
          </>
        }
      />

      {/* Three-column box grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, margin: '12px 0' }}>
        <Box title="Matching fingerprint">
          {focusedMaster.fingerprint.map(row => (
            <KV key={row.k} label={row.k} value={row.v} provenance={row.prov} />
          ))}
          <div style={{ marginTop: 8, fontSize: 11 }}>
            <span style={{ color: 'var(--alm-text-muted)' }}>Binary match: </span>
            <span className="alm-mono">exact ({focusedMaster.fingerprint.length}/{focusedMaster.fingerprint.length} fields)</span>
          </div>
        </Box>

        <Box title="Provenance">
          <KV label="Kind" value={master.kind} />
          <KV label="Exposure" value={master.exposure} />
          <KV label="Temperature" value={master.temp} />
          <KV label="Gain" value={String(master.gain)} />
          <KV label="Camera" value={master.camera} />
          <KV label="Binning" value={master.binning} />
          <KV label="Age" value={`${master.age}d`} />
          <KV label="Size" value={master.size} />
        </Box>

        <Box title="Usage">
          <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div className="alm-mono" style={{ fontSize: 24, fontWeight: 700 }}>{master.sessions}</div>
              <div style={{ fontSize: 11, color: 'var(--alm-text-muted)' }}>sessions matched</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="alm-mono" style={{ fontSize: 24, fontWeight: 700 }}>{master.projects}</div>
              <div style={{ fontSize: 11, color: 'var(--alm-text-muted)' }}>projects</div>
            </div>
          </div>
        </Box>
      </div>

      {/* Compatible acquisition sessions */}
      <Table
        columns={[
          { key: 'check', label: '' },
          { key: 'session', label: 'Session' },
          { key: 'frames', label: 'Frames' },
          { key: 'score', label: 'Score' },
          { key: 'softMismatch', label: 'Soft mismatches' },
          { key: 'decision', label: 'Decision' },
        ]}
        rows={COMPAT_SESSIONS.map(s => ({
          check: s.check === 'ok'
            ? <span style={{ color: 'var(--alm-ok)' }}>✓</span>
            : <span style={{ color: 'var(--alm-warn)' }}>~</span>,
          session: <strong>{s.session}</strong>,
          frames: <span className="alm-mono">{s.frames}</span>,
          score: <span className="alm-mono">{s.score.toFixed(2)}</span>,
          softMismatch: s.softMismatch === '—'
            ? <span style={{ color: 'var(--alm-text-faint)' }}>—</span>
            : <span style={{ color: 'var(--alm-warn)' }}>{s.softMismatch}</span>,
          decision: <Pill variant={s.decision === 'accepted' ? 'ok' : 'warn'}>{s.decision}</Pill>,
        }))}
      />
    </DetailPane>
  );
}
