import { useState } from 'react';
import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import { Pill } from '@/ui';

export type SourceViewStrategy = 'symlink' | 'hardlink' | 'copy' | 'junction';

export interface StepViewsData {
  strategy: SourceViewStrategy;
}

export interface StepViewsProps {
  data: StepViewsData;
  onChange: (data: StepViewsData) => void;
}

const STRATEGIES: Array<{ id: SourceViewStrategy; label: string; description: string }> = [
  { id: 'symlink', label: 'Symbolic links', description: 'Fast, zero disk usage, works cross-platform. Requires permissions on Windows.' },
  { id: 'hardlink', label: 'Hard links', description: 'Zero extra disk usage, transparent to applications. Same filesystem only.' },
  { id: 'copy', label: 'Full copy', description: 'Independent copies. Uses extra disk space but guarantees isolation.' },
  { id: 'junction', label: 'Junctions (Windows)', description: 'Directory-level links on Windows NTFS. Similar to symlinks but for directories only.' },
];

export function StepViews({ data, onChange }: StepViewsProps) {
  const [showOptions, setShowOptions] = useState(data.strategy !== 'symlink');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Default strategy chip */}
      <div>
        <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600, marginBottom: 'var(--alm-space-3)' }}>
          Source View Strategy
        </h3>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--alm-space-3)',
            padding: 'var(--alm-space-3) var(--alm-space-4)',
            border: '1px solid var(--alm-border)',
            borderRadius: 8,
            background: 'var(--alm-surface)',
          }}
        >
          <Pill label={data.strategy} variant="info" />
          <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            {STRATEGIES.find((s) => s.id === data.strategy)?.description}
          </span>
        </div>
      </div>

      {/* Disclosure for alternative strategies */}
      {!showOptions ? (
        <button
          type="button"
          onClick={() => setShowOptions(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--alm-info)',
            fontSize: 'var(--alm-text-xs)',
            cursor: 'pointer',
            textDecoration: 'underline',
            padding: 0,
            textAlign: 'left',
          }}
        >
          Use different strategy
        </button>
      ) : (
        <RadioGroup
          value={data.strategy}
          onValueChange={(value) => onChange({ strategy: value as SourceViewStrategy })}
          aria-label="Source view strategy"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}
        >
          <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', fontWeight: 500 }}>
            Choose a source view strategy:
          </span>
          {STRATEGIES.map((strategy) => (
            <label
              key={strategy.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--alm-space-3)',
                padding: 'var(--alm-space-3)',
                border: `1px solid ${data.strategy === strategy.id ? 'var(--alm-gray-900)' : 'var(--alm-border)'}`,
                borderRadius: 6,
                cursor: 'pointer',
                background: data.strategy === strategy.id ? 'var(--alm-surface)' : 'transparent',
              }}
            >
              <Radio.Root
                value={strategy.id}
                className="alm-radio"
                aria-label={strategy.label}
              >
                <Radio.Indicator className="alm-radio__indicator" />
              </Radio.Root>
              <div>
                <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 500 }}>
                  {strategy.label}
                </div>
                <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                  {strategy.description}
                </div>
              </div>
            </label>
          ))}
        </RadioGroup>
      )}
    </div>
  );
}
