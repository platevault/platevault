import { useState } from 'react';
import { Button } from '@base-ui-components/react/button';
import { Radio } from '@base-ui-components/react/radio';
import { RadioGroup } from '@base-ui-components/react/radio-group';
import { DirPicker } from '@/ui';
import { Trash2 } from 'lucide-react';

export interface SourceEntry {
  path: string;
  category: 'raw' | 'calibration' | 'project' | 'inbox';
  estimatedFiles?: number;
}

export interface StepSourcesProps {
  sources: SourceEntry[];
  onSourcesChange: (sources: SourceEntry[]) => void;
  onNext: () => void;
  onBack: () => void;
}

const CATEGORIES = [
  { value: 'raw', label: 'Raw', description: 'Light frames, unprocessed captures' },
  { value: 'calibration', label: 'Calibration', description: 'Darks, flats, bias frames' },
  { value: 'project', label: 'Project', description: 'Processing project folders' },
  { value: 'inbox', label: 'Inbox', description: 'New/unsorted captures' },
] as const;

export function StepSources({ sources, onSourcesChange, onNext, onBack }: StepSourcesProps) {
  const [pendingPath, setPendingPath] = useState('');
  const [pendingCategory, setPendingCategory] = useState<SourceEntry['category']>('raw');

  function addSource() {
    if (!pendingPath) return;
    const entry: SourceEntry = {
      path: pendingPath,
      category: pendingCategory,
      estimatedFiles: Math.floor(Math.random() * 2000) + 50, // Placeholder until real scan
    };
    onSourcesChange([...sources, entry]);
    setPendingPath('');
    setPendingCategory('raw');
  }

  function removeSource(index: number) {
    onSourcesChange(sources.filter((_, i) => i !== index));
  }

  const canProceed = sources.length > 0;

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ fontSize: 'var(--alm-text-lg)', fontWeight: 600, marginBottom: 'var(--alm-space-2)' }}>
        Library Sources
      </h2>
      <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-space-5)' }}>
        Add the folders where your astrophotography files live. You can add more later in Settings.
      </p>

      {/* Existing sources list */}
      {sources.length > 0 && (
        <div style={{ marginBottom: 'var(--alm-space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
          {sources.map((source, i) => (
            <div
              key={`${source.path}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--alm-space-3)',
                padding: 'var(--alm-space-3)',
                background: 'var(--alm-surface)',
                borderRadius: 'var(--alm-radius-sm)',
                border: '1px solid var(--alm-border)',
              }}
            >
              <span style={{
                fontSize: 'var(--alm-text-xs)',
                fontFamily: 'var(--alm-font-mono)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {source.path}
              </span>
              <span style={{
                fontSize: 'var(--alm-text-xs)',
                padding: '2px 8px',
                borderRadius: 'var(--alm-radius-sm)',
                background: 'var(--alm-gray-100)',
                color: 'var(--alm-text-muted)',
                textTransform: 'capitalize',
              }}>
                {source.category}
              </span>
              {source.estimatedFiles != null && (
                <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                  ~{source.estimatedFiles.toLocaleString()} files
                </span>
              )}
              <Button
                className="alm-btn alm-btn--sm alm-btn--ghost"
                onClick={() => removeSource(i)}
                aria-label={`Remove ${source.path}`}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add new source form */}
      <div style={{
        padding: 'var(--alm-space-4)',
        border: '1px dashed var(--alm-border)',
        borderRadius: 'var(--alm-radius-sm)',
        marginBottom: 'var(--alm-space-5)',
      }}>
        <DirPicker
          value={pendingPath}
          onChange={setPendingPath}
          label="Folder"
        />

        <div style={{ marginTop: 'var(--alm-space-3)' }}>
          <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', display: 'block', marginBottom: 'var(--alm-space-2)' }}>
            Category
          </span>
          <RadioGroup
            value={pendingCategory}
            onValueChange={(val) => setPendingCategory(val as SourceEntry['category'])}
            aria-label="Source category"
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}
          >
            {CATEGORIES.map((cat) => (
              <label
                key={cat.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--alm-space-2)',
                  cursor: 'pointer',
                  fontSize: 'var(--alm-text-xs)',
                }}
              >
                <Radio.Root
                  value={cat.value}
                  className="alm-radio"
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: '2px solid var(--alm-gray-300)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Radio.Indicator
                    className="alm-radio__indicator"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'var(--alm-gray-900)',
                    }}
                  />
                </Radio.Root>
                <span>{cat.label}</span>
                <span style={{ color: 'var(--alm-text-muted)' }}> — {cat.description}</span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div style={{ marginTop: 'var(--alm-space-4)', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            className="alm-btn alm-btn--sm"
            onClick={addSource}
            disabled={!pendingPath}
          >
            Add source
          </Button>
        </div>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button className="alm-btn alm-btn--ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          className="alm-btn alm-btn--primary"
          onClick={onNext}
          disabled={!canProceed}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
