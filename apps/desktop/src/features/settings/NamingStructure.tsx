import { useState, useCallback, useRef } from 'react';
import { Checkbox } from '@base-ui-components/react/checkbox';

interface NamingStructureProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface TokenChip {
  id: string;
  label: string;
  value: string;
  type: 'token' | 'separator';
}

const AVAILABLE_TOKENS: TokenChip[] = [
  { id: 'target', label: 'target', value: '{target}', type: 'token' },
  { id: 'filter', label: 'filter', value: '{filter}', type: 'token' },
  { id: 'date', label: 'date', value: '{date}', type: 'token' },
  { id: 'sequence', label: 'sequence', value: '{sequence}', type: 'token' },
  { id: 'binning', label: 'binning', value: '{binning}', type: 'token' },
  { id: 'gain', label: 'gain', value: '{gain}', type: 'token' },
];

const AVAILABLE_SEPARATORS: TokenChip[] = [
  { id: 'sep-dash', label: '-', value: '-', type: 'separator' },
  { id: 'sep-underscore', label: '_', value: '_', type: 'separator' },
  { id: 'sep-slash', label: '/', value: '/', type: 'separator' },
];

const FRAME_TYPES = ['lights', 'darks', 'flats', 'bias'] as const;

type MockMetadata = {
  label: string;
  target: string;
  filter: string;
  date: string;
  sequence: string;
  binning: string;
  gain: string;
};

const PREVIEW_EXAMPLES: MockMetadata[] = [
  {
    label: 'NGC 7000 · Ha',
    target: 'NGC7000',
    filter: 'Ha',
    date: '2026-05-18',
    sequence: '001',
    binning: '1x1',
    gain: '100',
  },
  {
    label: 'M42 · OIII',
    target: 'M42',
    filter: 'OIII',
    date: '2026-03-04',
    sequence: '007',
    binning: '1x1',
    gain: '120',
  },
  {
    label: 'IC1805 · SII',
    target: 'IC1805',
    filter: 'SII',
    date: '2025-11-29',
    sequence: '023',
    binning: '2x2',
    gain: '80',
  },
];

function buildPreview(pattern: TokenChip[], meta: MockMetadata): string {
  return pattern
    .map((chip) => {
      if (chip.type === 'separator') return chip.value;
      const key = chip.value.replace(/[{}]/g, '') as keyof MockMetadata;
      if (key === 'label') return chip.value;
      return meta[key] ?? chip.value;
    })
    .join('');
}

interface PatternBuilderProps {
  pattern: TokenChip[];
  onPatternChange: (pattern: TokenChip[]) => void;
  label?: string;
}

function PatternBuilder({ pattern, onPatternChange, label }: PatternBuilderProps) {
  const dragIdxRef = useRef<number | null>(null);
  const [editingSep, setEditingSep] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, chip: TokenChip, fromIndex?: number) => {
    e.dataTransfer.setData('application/json', JSON.stringify(chip));
    e.dataTransfer.setData('text/plain', fromIndex?.toString() ?? '-1');
    e.dataTransfer.effectAllowed = 'copyMove';
    if (fromIndex !== undefined) {
      dragIdxRef.current = fromIndex;
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const chipData = e.dataTransfer.getData('application/json');
    if (!chipData) return;
    const chip: TokenChip = JSON.parse(chipData);
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);

    const newPattern = [...pattern];
    if (fromIdx >= 0) {
      // Moving within the drop zone
      newPattern.splice(fromIdx, 1);
    }
    // Generate unique id for the instance
    const newChip = { ...chip, id: `${chip.id}-${Date.now()}` };
    newPattern.push(newChip);
    onPatternChange(newPattern);
    dragIdxRef.current = null;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleRemove = (index: number) => {
    const newPattern = pattern.filter((_, i) => i !== index);
    onPatternChange(newPattern);
  };

  const handleSepEdit = (index: number, value: string) => {
    const newPattern = [...pattern];
    newPattern[index] = { ...newPattern[index], label: value, value };
    onPatternChange(newPattern);
    setEditingSep(null);
  };

  return (
    <div className="alm-naming__builder">
      {label && <span className="alm-naming__builder-label">{label}</span>}
      <div
        className="alm-naming__dropzone"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        role="listbox"
        aria-label={label ?? 'Pattern drop zone'}
      >
        {pattern.length === 0 && (
          <span className="alm-naming__dropzone-hint">
            Drag tokens and separators here
          </span>
        )}
        {pattern.map((chip, i) => (
          <span
            key={`${chip.id}-${i}`}
            className={`alm-naming__chip alm-naming__chip--${chip.type}`}
            draggable
            onDragStart={(e) => handleDragStart(e, chip, i)}
            role="option"
            aria-selected
          >
            {chip.type === 'separator' && editingSep === i ? (
              <input
                className="alm-naming__sep-input"
                defaultValue={chip.value}
                autoFocus
                onBlur={(e) => handleSepEdit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSepEdit(i, e.currentTarget.value);
                }}
                size={2}
                aria-label="Edit separator"
              />
            ) : (
              <span
                onClick={chip.type === 'separator' ? () => setEditingSep(i) : undefined}
              >
                {chip.label}
              </span>
            )}
            <button
              type="button"
              className="alm-naming__chip-remove"
              onClick={() => handleRemove(i)}
              aria-label={`Remove ${chip.label}`}
            >
              &times;
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

export function NamingStructure({ save }: NamingStructureProps) {
  const [pattern, setPattern] = useState<TokenChip[]>([
    { id: 'target-1', label: 'target', value: '{target}', type: 'token' },
    { id: 'sep-1', label: '_', value: '_', type: 'separator' },
    { id: 'filter-1', label: 'filter', value: '{filter}', type: 'token' },
    { id: 'sep-2', label: '_', value: '_', type: 'separator' },
    { id: 'date-1', label: 'date', value: '{date}', type: 'token' },
    { id: 'sep-3', label: '_', value: '_', type: 'separator' },
    { id: 'sequence-1', label: 'sequence', value: '{sequence}', type: 'token' },
  ]);

  const [overrides, setOverrides] = useState<Record<string, TokenChip[] | null>>({
    lights: null,
    darks: null,
    flats: null,
    bias: null,
  });

  const handlePatternChange = useCallback(
    (newPattern: TokenChip[]) => {
      setPattern(newPattern);
      save('naming', {
        pattern: newPattern.map((c) => c.value).join(''),
        overrides: Object.fromEntries(
          Object.entries(overrides)
            .filter(([, v]) => v !== null)
            .map(([k, v]) => [k, v!.map((c) => c.value).join('')]),
        ),
      });
    },
    [save, overrides],
  );

  const handleOverrideChange = useCallback(
    (frameType: string, newPattern: TokenChip[]) => {
      const updated = { ...overrides, [frameType]: newPattern };
      setOverrides(updated);
      save('naming', {
        pattern: pattern.map((c) => c.value).join(''),
        overrides: Object.fromEntries(
          Object.entries(updated)
            .filter(([, v]) => v !== null)
            .map(([k, v]) => [k, v!.map((c) => c.value).join('')]),
        ),
      });
    },
    [save, pattern, overrides],
  );

  const toggleOverride = (frameType: string) => {
    setOverrides((prev) => ({
      ...prev,
      [frameType]: prev[frameType] === null ? [...pattern] : null,
    }));
  };

  const handleDragStart = (e: React.DragEvent, chip: TokenChip) => {
    e.dataTransfer.setData('application/json', JSON.stringify(chip));
    e.dataTransfer.setData('text/plain', '-1');
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="alm-naming">
      {/* Token palette */}
      <div className="alm-naming__palette">
        <div className="alm-naming__palette-group">
          <span className="alm-naming__palette-label">Tokens</span>
          <div className="alm-naming__palette-chips">
            {AVAILABLE_TOKENS.map((token) => (
              <span
                key={token.id}
                className="alm-naming__chip alm-naming__chip--token"
                draggable
                onDragStart={(e) => handleDragStart(e, token)}
              >
                {token.label}
              </span>
            ))}
          </div>
        </div>
        <div className="alm-naming__palette-group">
          <span className="alm-naming__palette-label">Separators</span>
          <div className="alm-naming__palette-chips">
            {AVAILABLE_SEPARATORS.map((sep) => (
              <span
                key={sep.id}
                className="alm-naming__chip alm-naming__chip--separator"
                draggable
                onDragStart={(e) => handleDragStart(e, sep)}
              >
                {sep.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main pattern */}
      <PatternBuilder
        pattern={pattern}
        onPatternChange={handlePatternChange}
        label="Default pattern"
      />

      {/* Preview — 3 examples using different session metadata */}
      <div className="alm-naming__preview">
        <span className="alm-naming__preview-label">Live preview</span>
        {PREVIEW_EXAMPLES.map((meta) => (
          <div key={meta.label} className="alm-naming__preview-row">
            <span className="alm-naming__preview-meta">{meta.label}</span>
            <code className="alm-mono">{buildPreview(pattern, meta)}</code>
          </div>
        ))}
      </div>

      {/* Per-frame-type overrides */}
      <div className="alm-naming__overrides">
        <span className="alm-naming__overrides-label">Per-frame-type overrides</span>
        {FRAME_TYPES.map((ft) => (
          <div key={ft} className="alm-naming__override-row">
            <label className="alm-naming__override-toggle">
              <Checkbox.Root
                className="alm-checkbox"
                checked={overrides[ft] !== null}
                onCheckedChange={() => toggleOverride(ft)}
                aria-label={`Override ${ft} pattern`}
              >
                <Checkbox.Indicator className="alm-checkbox__indicator">
                  &#x2713;
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span>{ft}</span>
            </label>
            {overrides[ft] !== null && (
              <PatternBuilder
                pattern={overrides[ft]!}
                onPatternChange={(p) => handleOverrideChange(ft, p)}
                label={`${ft} pattern`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
