import { useState } from 'react';
import { Pill, Lock, Box, KV, DirPicker } from '@/ui';

interface CleanupPolicyProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type CleanupAction = 'keep' | 'archive' | 'trash' | 'rm link' | 'DELETE' | '---';

interface ToolCell {
  def: CleanupAction;
  locked?: boolean;
  danger?: boolean;
}

interface PolicyRow {
  label: string;
  shared?: boolean;
  pi?: ToolCell;
  siril?: ToolCell;
  planetary?: ToolCell;
  when: string;
}

const ROWS: PolicyRow[] = [
  // Processing artifacts (tool-specific)
  { label: 'Registered frames', pi: { def: 'trash' }, siril: { def: 'trash' }, planetary: { def: 'keep' }, when: 'after output verified' },
  { label: 'Calibrated frames', pi: { def: 'trash' }, siril: { def: 'trash' }, planetary: { def: '---' }, when: 'after output verified' },
  { label: 'Debayered frames', pi: { def: 'trash' }, siril: { def: 'trash' }, planetary: { def: '---' }, when: 'after output verified' },
  { label: 'Local normalized', pi: { def: 'trash' }, siril: { def: '---' }, planetary: { def: '---' }, when: 'after output verified' },
  { label: 'Drizzle data', pi: { def: 'trash' }, siril: { def: 'trash' }, planetary: { def: '---' }, when: 'after output verified' },
  { label: 'Integration cache', pi: { def: 'trash' }, siril: { def: 'trash' }, planetary: { def: 'trash' }, when: 'after output verified' },
  { label: 'Stack output (intermediate)', pi: { def: 'keep' }, siril: { def: 'keep' }, planetary: { def: 'keep' }, when: '---' },
  { label: 'Temporary files', pi: { def: 'DELETE', danger: true }, siril: { def: 'DELETE', danger: true }, planetary: { def: 'DELETE', danger: true }, when: 'always' },
  { label: 'Processing logs', pi: { def: 'archive' }, siril: { def: 'archive' }, planetary: { def: 'archive' }, when: 'on completion' },
  { label: 'Process icons / tool config', pi: { def: 'keep', locked: true }, siril: { def: 'keep', locked: true }, planetary: { def: 'keep', locked: true }, when: '---' },
];

const SHARED_ROWS: PolicyRow[] = [
  { label: 'Source frames (raw lights)', shared: true, pi: { def: 'keep', locked: true }, when: 'never' },
  { label: 'Calibration sessions / masters', shared: true, pi: { def: 'keep', locked: true }, when: 'never' },
  { label: 'Source views', shared: true, pi: { def: 'rm link' }, when: 'on view retire' },
  { label: 'Final outputs', shared: true, pi: { def: 'keep', locked: true }, when: 'never' },
  { label: 'Notes & manifests', shared: true, pi: { def: 'keep', locked: true }, when: 'never' },
];

function ActionPill({ action, locked }: { action: CleanupAction; locked?: boolean }) {
  if (action === '---') return <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>;
  if (locked) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Lock /> <span style={{ fontSize: 'var(--alm-text-xs)' }}>keep</span>
      </span>
    );
  }
  const variant = action === 'keep' ? 'ok' as const
    : action === 'archive' ? 'info' as const
    : action === 'trash' ? 'warn' as const
    : action === 'rm link' ? 'ghost' as const
    : action === 'DELETE' ? 'danger' as const
    : 'neutral' as const;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Pill label={action} variant={variant} size="sm" />
      <span style={{ color: 'var(--alm-text-faint)', fontSize: 10 }}>&#9662;</span>
    </span>
  );
}

export function CleanupPolicy({ save }: CleanupPolicyProps) {
  const [processingDir] = useState('processing/');
  const [outputDir] = useState('outputs/');

  return (
    <div className="alm-cleanup">
      {/* Processing directory section */}
      <div className="alm-datasources__section-header">
        <span className="alm-datasources__section-title">Processing directory</span>
        <span className="alm-datasources__section-sub">
          the subdirectory inside each project where your processing tool writes its work
        </span>
      </div>
      <div style={{ border: '1px solid var(--alm-border)', background: 'var(--alm-bg)', padding: 'var(--alm-space-5)' }}>
        <table className="alm-cleanup__matrix">
          <thead>
            <tr>
              <th style={{ width: 160 }}>Workflow</th>
              <th>Processing directory (relative to project root)</th>
              <th style={{ width: 260 }}>Output directory</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>PixInsight / WBPP</strong></td>
              <td><code className="alm-mono">{processingDir}</code></td>
              <td><code className="alm-mono">{outputDir}</code></td>
            </tr>
            <tr>
              <td><strong>Siril</strong></td>
              <td><code className="alm-mono">{processingDir}</code></td>
              <td><code className="alm-mono">{outputDir}</code></td>
            </tr>
            <tr>
              <td><strong>Planetary / lunar</strong></td>
              <td><code className="alm-mono">{processingDir}</code></td>
              <td><code className="alm-mono">{outputDir}</code></td>
            </tr>
          </tbody>
        </table>
        <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', margin: 0, marginTop: 8 }}>
          Anything inside the processing directory is cleanup-eligible per the matrix below.
          Everything outside it (sources, manifests, outputs, notes) is protected by default.
        </p>
      </div>

      {/* Policy matrix */}
      <div style={{ marginTop: 'var(--alm-space-8)' }}>
        <div className="alm-datasources__section-header">
          <span className="alm-datasources__section-title">Policy matrix</span>
          <span className="alm-datasources__section-sub">
            default action per data type, per processing tool -- click any cell to change it
          </span>
        </div>
        <table className="alm-cleanup__matrix">
          <thead>
            <tr>
              <th>Data type</th>
              <th style={{ width: 130 }}>PixInsight / WBPP</th>
              <th style={{ width: 130 }}>Siril</th>
              <th style={{ width: 130 }}>Planetary</th>
              <th style={{ width: 140 }}>Trigger</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {/* Processing artifacts group header */}
            <tr>
              <td
                colSpan={6}
                className="alm-cleanup__group-header"
              >
                Processing artifacts (tool-specific)
              </td>
            </tr>
            {ROWS.map((r, i) => {
              const isDanger = r.pi?.danger || r.siril?.danger || r.planetary?.danger;
              return (
                <tr
                  key={i}
                  style={isDanger ? { background: '#faf0ec' } : undefined}
                >
                  <td><strong>{r.label}</strong></td>
                  <td><ActionPill action={r.pi?.def ?? '---'} locked={r.pi?.locked} /></td>
                  <td><ActionPill action={r.siril?.def ?? '---'} locked={r.siril?.locked} /></td>
                  <td><ActionPill action={r.planetary?.def ?? '---'} locked={r.planetary?.locked} /></td>
                  <td style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>{r.when === '---' ? '—' : r.when}</td>
                  <td>{isDanger && <Pill label="destructive" variant="danger" size="sm" />}</td>
                </tr>
              );
            })}

            {/* Shared categories group header */}
            <tr>
              <td
                colSpan={6}
                className="alm-cleanup__group-header"
              >
                Shared categories (apply regardless of tool)
              </td>
            </tr>
            {SHARED_ROWS.map((r, i) => (
              <tr key={`s-${i}`}>
                <td>
                  {r.pi?.locked && <Lock />} <strong>{r.label}</strong>
                </td>
                <td colSpan={3} style={{ textAlign: 'center' }}>
                  <ActionPill action={r.pi?.def ?? '---'} locked={r.pi?.locked} />
                </td>
                <td style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>{r.when}</td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Two-column boxes below */}
      <div className="alm-datasources__boxes" style={{ marginTop: 'var(--alm-space-7)' }}>
        <Box heading="When does cleanup run?">
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0' }}>
            <input type="radio" name="when" defaultChecked /> Only when I generate a plan (manual)
          </label>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0' }}>
            <input type="radio" name="when" /> Suggest after output is verified
          </label>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0' }}>
            <input type="radio" name="when" /> Suggest after project transitions to completed
          </label>
        </Box>
        <Box heading="Approval requirements">
          <KV label="Trash" value="output must be recorded" />
          <KV label="Archive" value="output must be accepted (verified)" />
          <KV label="DELETE" value="output accepted + explicit per-plan approval" />
          <KV
            label="Permanent delete"
            value={
              <span style={{ color: 'var(--alm-danger)' }}>
                disabled by default -- enable per cell above
              </span>
            }
          />
        </Box>
      </div>
    </div>
  );
}
