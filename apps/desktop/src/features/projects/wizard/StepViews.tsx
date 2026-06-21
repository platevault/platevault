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
    <div className="alm-wizard-views">
      {/* Step description */}
      <div className="alm-wizard-views__desc">
        A source view is a tool-friendly projection of your source map. PixInsight/WBPP will
        read source files through this view. The strategy is preset from{' '}
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          className="alm-wizard-views__link"
        >
          Settings &rarr; Source view strategy
        </a>{' '}
        &mdash; override here if you need.
      </div>

      {/* ── Strategy (from settings) ── */}
      <Box title="Strategy (from settings)">
        <div className="alm-wizard-views__box-header">
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="alm-wizard-views__box-link"
          >
            Override for this project
          </a>
        </div>
        <div className="alm-wizard-views__strategy-row">
          <Pill variant="ok">NTFS JUNCTION</Pill>
          <span className="alm-wizard-views__strategy-label">Default for Windows + PixInsight</span>
          <span className="alm-wizard-views__strategy-meta">
            ~12 KB on disk &middot; no admin &middot; cleanup-safe
          </span>
        </div>
        <div className="alm-wizard-views__strategy-note">
          If a fallback is needed (e.g. across volumes), the plan will indicate per item.
        </div>
      </Box>

      {/* ── Views to generate ── */}
      <Section title="Views to generate">
        <div className="alm-wizard-views__table-hint">
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
                    className="alm-wizard-views__name-input"
                    aria-label="View name"
                  />
                </td>
                <td><Pill variant="ok">{row.strategy}</Pill></td>
                <td className="alm-wizard-views__td-scope">{row.scope}</td>
                <td className="alm-mono alm-wizard-views__td-small">{row.items}</td>
                <td className="alm-mono alm-wizard-views__td-small">{row.estimatedSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Btn size="sm" className="alm-wizard-views__add-btn">+ Add view (per panel / per filter)</Btn>
      </Section>

      {/* ── Conflict policy ── */}
      <Box title="Conflict policy">
        <div className="alm-wizard-views__box-header">
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="alm-wizard-views__box-link"
          >
            defaults from settings
          </a>
        </div>
        <div className="alm-wizard-views__radio-group">
          <label className="alm-wizard-views__radio-label">
            <input
              type="radio"
              name="conflict-policy"
              checked={conflictPolicy === 'fail'}
              onChange={() => onChange({ ...data, conflictPolicy: 'fail' })}
            />{' '}
            fail if exists (safest)
          </label>
          <label className="alm-wizard-views__radio-label">
            <input
              type="radio"
              name="conflict-policy"
              checked={conflictPolicy === 'rename'}
              onChange={() => onChange({ ...data, conflictPolicy: 'rename' })}
            />{' '}
            rename with suffix
          </label>
          <label className="alm-wizard-views__radio-label">
            <input
              type="radio"
              name="conflict-policy"
              checked={conflictPolicy === 'skip'}
              onChange={() => onChange({ ...data, conflictPolicy: 'skip' })}
            />{' '}
            skip existing
          </label>
          <label className="alm-wizard-views__radio-label">
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
