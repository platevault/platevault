import { useMemo } from 'react';
import type { StepNameData } from './StepName';
import type { SourceViewStrategy } from './StepViews';

export interface StepLayoutData {
  namingPattern: string;
}

export interface StepLayoutProps {
  data: StepLayoutData;
  nameData: StepNameData;
  strategy: SourceViewStrategy;
  onChange: (data: StepLayoutData) => void;
}

const DEFAULT_PATTERN = '{target}_{filter}_{exposure}s_{sequence:04d}';

const AVAILABLE_TOKENS = [
  { token: '{target}', example: 'NGC7000' },
  { token: '{filter}', example: 'Ha' },
  { token: '{exposure}', example: '600' },
  { token: '{sequence:04d}', example: '0001' },
  { token: '{date}', example: '2026-04-15' },
  { token: '{gain}', example: '100' },
  { token: '{binning}', example: '1x1' },
];

export function StepLayout({ data, nameData, strategy, onChange }: StepLayoutProps) {
  const pattern = data.namingPattern || DEFAULT_PATTERN;

  // Generate example paths based on current wizard state
  const examplePaths = useMemo(() => {
    const projectSlug = nameData.name
      ? nameData.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
      : 'Project_Name';

    const base = `/media/Astrophoto/Projects/${projectSlug}`;
    const ext = nameData.workflowProfile === 'planetary' ? '.ser' : '.fit';

    const exampleFilename = pattern
      .replace('{target}', 'NGC7000')
      .replace('{filter}', 'Ha')
      .replace('{exposure}', '600')
      .replace('{sequence:04d}', '0001')
      .replace('{date}', '2026-04-15')
      .replace('{gain}', '100')
      .replace('{binning}', '1x1');

    return {
      root: base,
      structure: [
        `${base}/`,
        `${base}/lights/Ha/`,
        `${base}/lights/Ha/${exampleFilename}${ext}`,
        `${base}/lights/OIII/`,
        `${base}/calibration/darks/`,
        `${base}/calibration/flats/Ha/`,
        `${base}/source-view/ (${strategy})`,
        `${base}/processing/`,
        `${base}/outputs/`,
      ],
    };
  }, [nameData, pattern, strategy]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Naming pattern */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
        <label
          htmlFor="naming-pattern"
          style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}
        >
          Naming pattern
        </label>
        <input
          id="naming-pattern"
          type="text"
          value={pattern}
          onChange={(e) => onChange({ namingPattern: e.target.value })}
          placeholder={DEFAULT_PATTERN}
          style={{
            padding: 'var(--alm-space-2) var(--alm-space-3)',
            border: '1px solid var(--alm-border)',
            borderRadius: 4,
            fontSize: 'var(--alm-text-sm)',
            fontFamily: 'var(--alm-font-mono)',
            background: 'var(--alm-surface)',
            color: 'var(--alm-text)',
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--alm-space-2)', marginTop: 'var(--alm-space-1)' }}>
          {AVAILABLE_TOKENS.map((t) => (
            <span
              key={t.token}
              title={`Example: ${t.example}`}
              style={{
                padding: '2px 6px',
                background: 'var(--alm-surface)',
                border: '1px solid var(--alm-border)',
                borderRadius: 4,
                fontSize: '10px',
                fontFamily: 'var(--alm-font-mono)',
                color: 'var(--alm-text-muted)',
                cursor: 'help',
              }}
            >
              {t.token}
            </span>
          ))}
        </div>
      </div>

      {/* Directory structure preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
        <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>
          Directory structure preview
        </h3>
        <div
          style={{
            padding: 'var(--alm-space-3) var(--alm-space-4)',
            background: 'var(--alm-surface)',
            border: '1px solid var(--alm-border)',
            borderRadius: 6,
            fontFamily: 'var(--alm-font-mono)',
            fontSize: 'var(--alm-text-xs)',
            lineHeight: 1.8,
            overflow: 'auto',
          }}
        >
          {examplePaths.structure.map((path, i) => {
            const depth = path.split('/').length - examplePaths.root.split('/').length;
            const isDir = path.endsWith('/') || path.includes('(');
            return (
              <div
                key={i}
                style={{
                  paddingLeft: `${Math.max(0, depth) * 12}px`,
                  color: isDir ? 'var(--alm-info)' : 'var(--alm-text)',
                }}
              >
                {isDir ? '\u{1F4C1} ' : '\u{1F4C4} '}
                {path.replace(examplePaths.root, '.')}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
