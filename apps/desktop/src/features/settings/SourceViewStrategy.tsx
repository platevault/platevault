import { useState } from 'react';
import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import { Pill, Box, KV } from '@/ui';

interface SourceViewStrategyProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface Strategy {
  id: string;
  label: string;
  desc: string;
  size: string;
  portable: string;
  tools: string;
  safety: string;
  recommended: boolean;
}

const STRATEGIES: Strategy[] = [
  { id: 'manifest', label: 'Manifest-only', desc: 'Write a JSON listing source paths. No filesystem entries.', size: '~10 KB', portable: '✓', tools: '✗ (needs paths)', safety: '✓', recommended: false },
  { id: 'symlink', label: 'Symbolic links', desc: 'POSIX symlinks. May need admin on Windows.', size: '~10 KB', portable: '✓', tools: '✓ most', safety: '~ admin', recommended: false },
  { id: 'junction', label: 'NTFS junctions', desc: 'Directory junctions on Windows. WBPP-friendly, no admin.', size: '~10 KB', portable: 'Windows', tools: '✓ WBPP', safety: '✓', recommended: true },
  { id: 'hardlink', label: 'Hard links', desc: 'Same-volume only. Identical inode.', size: '~10 KB', portable: 'same vol', tools: '✓', safety: '✓', recommended: false },
  { id: 'copy', label: 'Full copy', desc: 'Duplicate every file. Use only for portable workflows.', size: '8.4 GB', portable: '✓', tools: '✓', safety: '⚠ duplicates', recommended: false },
  { id: 'hybrid', label: 'Hybrid', desc: 'Junction by default; fall back to symlink/copy per item.', size: 'varies', portable: '✓', tools: '✓', safety: '✓', recommended: false },
];

export function SourceViewStrategy({ save }: SourceViewStrategyProps) {
  const [selected, setSelected] = useState('junction');

  const handleChange = (value: unknown) => {
    const id = value as string;
    setSelected(id);
    save('source_view', { strategy: id });
  };

  return (
    <div className="alm-svs">
      {/* Section: Default strategy */}
      <div className="alm-datasources__section-header">
        <span className="alm-datasources__section-title">Default strategy</span>
        <span className="alm-datasources__section-sub">
          applied when creating a new project (overridable in the wizard)
        </span>
      </div>

      <RadioGroup
        value={selected}
        onValueChange={handleChange}
        aria-label="Source view strategy"
      >
        <table className="alm-svs__table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>Strategy</th>
              <th style={{ width: 80 }}>Disk usage</th>
              <th style={{ width: 80 }}>Portable</th>
              <th style={{ width: 90 }}>Tool compat.</th>
              <th style={{ width: 80 }}>Safety</th>
            </tr>
          </thead>
          <tbody>
            {STRATEGIES.map((s) => (
              <tr
                key={s.id}
                className={selected === s.id ? 'alm-svs__row--selected' : undefined}
                style={s.recommended ? { background: '#f5f3e8' } : undefined}
                onClick={() => handleChange(s.id)}
              >
                <td>
                  <Radio.Root
                    value={s.id}
                    className="alm-radio"
                    aria-label={s.label}
                  >
                    <Radio.Indicator className="alm-radio__indicator" />
                  </Radio.Root>
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {s.label}{' '}
                    {s.recommended && <Pill label="DEFAULT" variant="ok" size="sm" />}
                  </div>
                  <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                    {s.desc}
                  </div>
                </td>
                <td className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
                  {s.size}
                </td>
                <td style={{ fontSize: 'var(--alm-text-xs)' }}>{s.portable}</td>
                <td style={{ fontSize: 'var(--alm-text-xs)' }}>{s.tools}</td>
                <td style={{ fontSize: 'var(--alm-text-xs)' }}>{s.safety}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </RadioGroup>

      {/* Two-column boxes below */}
      <div className="alm-datasources__boxes" style={{ marginTop: 'var(--alm-space-7)' }}>
        <Box heading="Per-platform overrides">
          <KV label="Windows" value="NTFS junction" />
          <KV label="macOS" value="Symlink" />
          <KV label="Linux" value="Symlink" />
          <KV label="Across volumes" value="fall back to copy (with confirm)" />
        </Box>
        <Box heading="Default conflict policy">
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0' }}>
            <input type="radio" name="cp" defaultChecked /> fail if exists (safest)
          </label>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0' }}>
            <input type="radio" name="cp" /> rename with suffix
          </label>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0' }}>
            <input type="radio" name="cp" /> skip existing
          </label>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0' }}>
            <input type="radio" name="cp" /> require manual resolution
          </label>
        </Box>
      </div>
    </div>
  );
}
