import { useState, useCallback, useRef } from 'react';
import { Btn } from '@/ui';

interface NamingStructureProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

interface TokenChip {
  id: string;
  label: string;
  value: string;
  type: 'token' | 'separator';
}

const FRAME_TYPES = ['Light', 'Dark', 'Flat', 'Bias', 'Dark flat'] as const;

function Token({ kind, label, onRemove }: { kind: 'token' | 'separator'; label: string; onRemove?: () => void }) {
  return (
    <span
      className={`alm-naming__chip alm-naming__chip--${kind === 'separator' ? 'separator' : 'token'}`}
      draggable
    >
      {kind !== 'separator' && (
        <span style={{ color: '#7080a0' }}>&#8942;&#8942;</span>
      )}
      <span>{label}</span>
      {onRemove && (
        <button
          type="button"
          className="alm-naming__chip-remove"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
        >
          &times;
        </button>
      )}
    </span>
  );
}

function PatternBuilder({
  tokens,
  disabled,
}: {
  tokens: TokenChip[];
  disabled?: boolean;
}) {
  return (
    <div
      className="alm-naming__dropzone"
      style={disabled ? { opacity: 0.5, background: 'var(--alm-surface)' } : undefined}
    >
      {tokens.map((tk, i) => (
        <Token key={i} kind={tk.type} label={tk.label} />
      ))}
      <span style={{ width: 1, height: 18, background: 'var(--alm-border)', margin: '0 4px' }} />
      <Btn size="sm">+ Token</Btn>
      <Btn size="sm">+ Separator</Btn>
    </div>
  );
}

function FrameOverride({
  label,
  enabled,
  tokens,
  onToggle,
}: {
  label: string;
  enabled: boolean;
  tokens: TokenChip[];
  onToggle: () => void;
}) {
  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--alm-border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          onClick={onToggle}
          role="switch"
          aria-checked={enabled}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            background: enabled ? 'var(--alm-text-secondary)' : 'var(--alm-gray-200)',
            border: '1px solid var(--alm-border)',
            position: 'relative',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 1,
              left: enabled ? 15 : 1,
              width: 14,
              height: 14,
              borderRadius: 7,
              background: 'var(--alm-bg)',
              border: '1px solid var(--alm-border)',
              transition: 'left 0.15s',
            }}
          />
        </span>
        <span style={{ fontSize: 'var(--alm-text-base)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        <PatternBuilder tokens={tokens} disabled={!enabled} />
      </div>
    </div>
  );
}

export function NamingStructure({ save }: NamingStructureProps) {
  const defaultTokens: TokenChip[] = [
    { id: '1', label: '{target}', value: '{target}', type: 'token' },
    { id: '2', label: '/', value: '/', type: 'separator' },
    { id: '3', label: '{filter}', value: '{filter}', type: 'token' },
    { id: '4', label: '/', value: '/', type: 'separator' },
    { id: '5', label: '{date}', value: '{date}', type: 'token' },
    { id: '6', label: '/', value: '/', type: 'separator' },
    { id: '7', label: '{frame_type}', value: '{frame_type}', type: 'token' },
    { id: '8', label: '/', value: '/', type: 'separator' },
  ];

  const [overrides, setOverrides] = useState<Record<string, boolean>>({
    Light: false,
    Dark: false,
    Flat: false,
    Bias: false,
    'Dark flat': false,
  });

  const toggleOverride = (ft: string) => {
    setOverrides((prev) => ({ ...prev, [ft]: !prev[ft] }));
  };

  return (
    <div className="alm-naming">
      {/* Global pattern */}
      <div className="alm-naming__section-label">Global pattern</div>
      <PatternBuilder tokens={defaultTokens} />

      {/* Preview */}
      <div className="alm-naming__section-label" style={{ marginTop: 'var(--alm-space-7)' }}>
        Preview using recent fits
      </div>
      <div className="alm-naming__preview">
        <code className="alm-mono">M101/Ha/2026-04-12/lights/</code>
        <code className="alm-mono">M101/OIII/2026-04-13/lights/</code>
        <code className="alm-mono">M101/---/2026-04/darks/</code>
      </div>

      {/* Per-frame-type overrides */}
      <div className="alm-naming__section-label" style={{ marginTop: 'var(--alm-space-9)' }}>
        Per-frame-type overrides
      </div>
      <div>
        {FRAME_TYPES.map((ft) => (
          <FrameOverride
            key={ft}
            label={ft}
            enabled={overrides[ft]}
            tokens={defaultTokens}
            onToggle={() => toggleOverride(ft)}
          />
        ))}
      </div>
    </div>
  );
}
