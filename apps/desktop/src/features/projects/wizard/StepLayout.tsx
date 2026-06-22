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
    <div className="alm-wizard-layout">
      {/* Naming pattern */}
      <div className="alm-wizard-layout__section">
        <label
          htmlFor="naming-pattern"
          className="alm-wizard-layout__label"
        >
          Naming pattern
        </label>
        <input
          id="naming-pattern"
          type="text"
          value={pattern}
          onChange={(e) => onChange({ namingPattern: e.target.value })}
          placeholder={DEFAULT_PATTERN}
          className="alm-wizard-layout__input"
        />
        <div className="alm-wizard-layout__token-row">
          {AVAILABLE_TOKENS.map((t) => (
            <span
              key={t.token}
              title={`Example: ${t.example}`}
              className="alm-wizard-layout__token-chip"
            >
              {t.token}
            </span>
          ))}
        </div>
      </div>

      {/* Directory structure preview */}
      <div className="alm-wizard-layout__section">
        <h3 className="alm-wizard-layout__label">
          Directory structure preview
        </h3>
        <div className="alm-wizard-layout__preview">
          {examplePaths.structure.map((path, i) => {
            const depth = path.split('/').length - examplePaths.root.split('/').length;
            const isDir = path.endsWith('/') || path.includes('(');
            return (
              <div
                key={i}
                className="alm-wizard-layout__path-row"
                data-dir={isDir ? 'true' : undefined}
                // eslint-disable-next-line no-restricted-syntax -- dynamic: depth-based indent padding for layout tree rows
                style={{ paddingLeft: `${Math.max(0, depth) * 12}px` }}
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
