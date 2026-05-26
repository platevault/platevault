import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { Btn } from '@/ui';

interface NamingStructureProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const AVAILABLE_TOKENS = [
  '{object}',
  '{target}',
  '{filter}',
  '{date}',
  '{date_time}',
  '{frame_type}',
  '{exposure}',
  '{gain}',
  '{binning}',
  '{camera}',
  '{telescope}',
  '{sequence}',
  '{session_id}',
] as const;

const SEPARATORS = ['/', '_', '-', '.'] as const;

/* No "Dark flat" frame type per task spec */
const FRAME_TYPES = ['Light', 'Dark', 'Flat', 'Bias'] as const;

/* Default patterns: lights use {object}, darks/flats/bias do not (research R4) */
const DEFAULT_PATTERNS: Record<string, string[]> = {
  Light: ['{object}', '/', '{filter}', '/', '{date}', '/', '{frame_type}', '/'],
  Dark: ['{camera}', '/', '{exposure}', '/', '{date}', '/', '{frame_type}', '/'],
  Flat: ['{camera}', '/', '{filter}', '/', '{date}', '/', '{frame_type}', '/'],
  Bias: ['{camera}', '/', '{date}', '/', '{frame_type}', '/'],
};

/* Mock metadata for preview */
const PREVIEW_VALUES: Record<string, string> = {
  '{object}': 'M101',
  '{target}': 'M101',
  '{filter}': 'Ha',
  '{date}': '2026-04-12',
  '{date_time}': '2026-04-12T22_30',
  '{frame_type}': 'lights',
  '{exposure}': '300s',
  '{gain}': 'g100',
  '{binning}': '1x1',
  '{camera}': 'ASI2600MM',
  '{telescope}': 'Esprit100',
  '{sequence}': '0001',
  '{session_id}': 'a3f7',
};

function resolvePreview(tokens: string[]): string {
  return tokens
    .map((t) => PREVIEW_VALUES[t] ?? t)
    .join('');
}

function TokenChip({
  token,
  onRemove,
}: {
  token: string;
  onRemove: () => void;
}) {
  const isSep = !token.startsWith('{');
  return (
    <span
      className={clsx(
        'alm-naming__chip',
        isSep ? 'alm-naming__chip--separator' : 'alm-naming__chip--token',
      )}
    >
      <span>{token}</span>
      <button
        type="button"
        className="alm-naming__chip-remove"
        onClick={onRemove}
        aria-label={`Remove ${token}`}
      >
        &times;
      </button>
    </span>
  );
}

function PatternEditor({
  tokens,
  onChange,
  label,
}: {
  tokens: string[];
  onChange: (tokens: string[]) => void;
  label: string;
}) {
  const [showTokenMenu, setShowTokenMenu] = useState(false);
  const [showSepMenu, setShowSepMenu] = useState(false);

  const handleAddToken = (token: string) => {
    onChange([...tokens, token]);
    setShowTokenMenu(false);
  };

  const handleAddSeparator = (sep: string) => {
    onChange([...tokens, sep]);
    setShowSepMenu(false);
  };

  const handleRemove = (index: number) => {
    onChange(tokens.filter((_, i) => i !== index));
  };

  const preview = resolvePreview(tokens);

  return (
    <div className="alm-naming__editor" aria-label={label}>
      <div className="alm-naming__dropzone">
        {tokens.map((tk, i) => (
          <TokenChip key={`${tk}-${i}`} token={tk} onRemove={() => handleRemove(i)} />
        ))}
        <span className="alm-naming__divider" />
        <div className="alm-naming__add-group">
          <Btn size="sm" onClick={() => setShowTokenMenu(!showTokenMenu)}>
            + Token
          </Btn>
          {showTokenMenu && (
            <div className="alm-naming__dropdown">
              {AVAILABLE_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="alm-naming__dropdown-item"
                  onClick={() => handleAddToken(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="alm-naming__add-group">
          <Btn size="sm" onClick={() => setShowSepMenu(!showSepMenu)}>
            + Separator
          </Btn>
          {showSepMenu && (
            <div className="alm-naming__dropdown">
              {SEPARATORS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="alm-naming__dropdown-item"
                  onClick={() => handleAddSeparator(s)}
                >
                  {s === '/' ? '/ (path)' : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {tokens.length > 0 && (
        <div className="alm-naming__preview-line">
          <span className="alm-naming__preview-label">Preview:</span>
          <code className="alm-mono">{preview}</code>
        </div>
      )}
    </div>
  );
}

export function NamingStructure({ save }: NamingStructureProps) {
  const [patterns, setPatterns] = useState<Record<string, string[]>>(DEFAULT_PATTERNS);

  const handlePatternChange = (frameType: string, tokens: string[]) => {
    const updated = { ...patterns, [frameType]: tokens };
    setPatterns(updated);
    save('naming', { patterns: updated });
  };

  /* Combined preview for all frame types */
  const previewLines = useMemo(() => {
    return FRAME_TYPES.map((ft) => ({
      type: ft,
      path: resolvePreview(patterns[ft] ?? []),
    }));
  }, [patterns]);

  return (
    <div className="alm-naming">
      {/* Per-frame-type patterns */}
      {FRAME_TYPES.map((ft) => (
        <section key={ft} className="alm-naming__section">
          <h3 className="alm-naming__section-label">{ft} frames</h3>
          <PatternEditor
            tokens={patterns[ft] ?? []}
            onChange={(tokens) => handlePatternChange(ft, tokens)}
            label={`${ft} naming pattern`}
          />
        </section>
      ))}

      {/* Combined preview */}
      <section className="alm-naming__section">
        <h3 className="alm-naming__section-label">Live Preview</h3>
        <div className="alm-naming__preview">
          {previewLines.map(({ type, path }) => (
            <div key={type} className="alm-naming__preview-row">
              <span className="alm-naming__preview-type">{type}:</span>
              <code className="alm-mono">{path}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
