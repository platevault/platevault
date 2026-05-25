import { useState } from 'react';
import { Pill, Box, Btn, Section } from '@/ui';

export type SourceViewStrategy = 'symlink' | 'hardlink' | 'copy' | 'junction';
export type ConflictPolicy = 'fail' | 'rename' | 'skip' | 'manual';

export interface StepViewsData {
  strategy: SourceViewStrategy;
  conflictPolicy?: ConflictPolicy;
}

export interface StepViewsProps {
  data: StepViewsData;
  onChange: (data: StepViewsData) => void;
}

// ── Mock view row (matches wireframe table) ─────────────────────────────────

interface ViewRow {
  name: string;
  strategy: string;
  scope: string;
  items: string;
  estimatedSize: string;
}

const DEFAULT_VIEWS: ViewRow[] = [
  {
    name: 'wbpp_input',
    strategy: 'junction',
    scope: 'all sources (3 lights + 4 masters)',
    items: '126 items',
    estimatedSize: '12 KB',
  },
];

// ── Component ───────────────────────────────────────────────────────────────

export function StepViews({ data, onChange }: StepViewsProps) {
  const [viewName, setViewName] = useState('wbpp_input');
  const conflictPolicy = data.conflictPolicy ?? 'fail';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Step description */}
      <div style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)', maxWidth: 640 }}>
        A source view is a tool-friendly projection of your source map. PixInsight/WBPP will
        read source files through this view. The strategy is preset from{' '}
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          style={{ color: 'var(--alm-accent)', textDecoration: 'underline' }}
        >
          Settings &rarr; Source view strategy
        </a>{' '}
        &mdash; override here if you need.
      </div>

      {/* ── Strategy (from settings) ── */}
      <Box
        heading="Strategy (from settings)"
        right={
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-accent)', textDecoration: 'underline' }}
          >
            Override for this project
          </a>
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Pill label="NTFS JUNCTION" variant="ok" size="sm" />
          <span style={{ fontSize: 'var(--alm-text-sm)' }}>Default for Windows + PixInsight</span>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            ~12 KB on disk &middot; no admin &middot; cleanup-safe
          </span>
        </div>
        <div style={{ marginTop: 6, fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          If a fallback is needed (e.g. across volumes), the plan will indicate per item.
        </div>
      </Box>

      {/* ── Views to generate ── */}
      <Section title="Views to generate">
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-space-3)' }}>
          for mosaic projects, one view per panel; otherwise a single wbpp_input
        </div>
        <table className="alm-simple-table">
          <thead>
            <tr>
              <th>View name</th>
              <th>Strategy</th>
              <th>Scope</th>
              <th>Items</th>
              <th>Estimated size</th>
            </tr>
          </thead>
          <tbody>
            {DEFAULT_VIEWS.map((row) => (
              <tr key={row.name}>
                <td className="alm-mono">
                  <input
                    value={viewName}
                    onChange={(e) => setViewName(e.target.value)}
                    style={{
                      width: 160,
                      fontFamily: 'var(--alm-font-mono)',
                      fontSize: 'var(--alm-text-xs)',
                      padding: '3px 6px',
                      border: '1px solid var(--alm-border)',
                      background: 'var(--alm-bg)',
                      color: 'var(--alm-text)',
                    }}
                    aria-label="View name"
                  />
                </td>
                <td><Pill label={row.strategy} variant="ok" size="sm" /></td>
                <td style={{ fontSize: 'var(--alm-text-xs)' }}>{row.scope}</td>
                <td className="alm-mono" style={{ fontSize: '11px' }}>{row.items}</td>
                <td className="alm-mono" style={{ fontSize: '11px' }}>{row.estimatedSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Btn size="sm" style={{ marginTop: 'var(--alm-space-3)' }}>+ Add view (per panel / per filter)</Btn>
      </Section>

      {/* ── Conflict policy ── */}
      <Box
        heading="Conflict policy"
        right={
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-accent)', textDecoration: 'underline' }}
          >
            defaults from settings
          </a>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0', cursor: 'pointer' }}>
            <input
              type="radio"
              name="conflict-policy"
              checked={conflictPolicy === 'fail'}
              onChange={() => onChange({ ...data, conflictPolicy: 'fail' })}
            />{' '}
            fail if exists (safest)
          </label>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0', cursor: 'pointer' }}>
            <input
              type="radio"
              name="conflict-policy"
              checked={conflictPolicy === 'rename'}
              onChange={() => onChange({ ...data, conflictPolicy: 'rename' })}
            />{' '}
            rename with suffix
          </label>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0', cursor: 'pointer' }}>
            <input
              type="radio"
              name="conflict-policy"
              checked={conflictPolicy === 'skip'}
              onChange={() => onChange({ ...data, conflictPolicy: 'skip' })}
            />{' '}
            skip existing
          </label>
          <label style={{ display: 'block', fontSize: 'var(--alm-text-xs)', padding: '2px 0', cursor: 'pointer' }}>
            <input
              type="radio"
              name="conflict-policy"
              checked={conflictPolicy === 'manual'}
              onChange={() => onChange({ ...data, conflictPolicy: 'manual' })}
            />{' '}
            require manual resolution
          </label>
        </div>
      </Box>
    </div>
  );
}
