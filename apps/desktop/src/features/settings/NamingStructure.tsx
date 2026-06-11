// spec 018 — partial owner: pattern, autoApplyPattern are spec 018 DB keys.
// TODO(spec-018-T015): add useEffect to load pattern/autoApplyPattern via getSettings('naming').
import { useState, useMemo } from 'react';
import { Btn } from '@/ui';

interface NamingStructureProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

const AVAILABLE_TOKENS = [
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

const FRAME_TYPES = ['Light', 'Dark', 'Flat', 'Bias'] as const;

const DEFAULT_PATTERNS: Record<string, string[]> = {
  Light: ['{target}', '/', '{filter}', '/', '{date}', '/', '{frame_type}', '/'],
  Dark: ['{camera}', '/', '{exposure}', '/', '{date}', '/', '{frame_type}', '/'],
  Flat: ['{camera}', '/', '{filter}', '/', '{date}', '/', '{frame_type}', '/'],
  Bias: ['{camera}', '/', '{date}', '/', '{frame_type}', '/'],
};

const PREVIEW_VALUES: Record<string, string> = {
  '{target}': 'NGC7000',
  '{filter}': 'Ha',
  '{date}': '2026-04-12',
  '{date_time}': '2026-04-12T22_30',
  '{frame_type}': 'lights',
  '{exposure}': '300s',
  '{gain}': 'g100',
  '{binning}': '1x1',
  '{camera}': 'ASI2600MM',
  '{telescope}': 'FSQ106',
  '{sequence}': '0001',
  '{session_id}': 'a3f7',
};

function resolvePreview(tokens: string[]): string {
  return tokens.map((t) => PREVIEW_VALUES[t] ?? t).join('');
}

function PatternEditor({
  tokens,
  onChange,
  frameType,
}: {
  tokens: string[];
  onChange: (tokens: string[]) => void;
  frameType: string;
}) {
  const [showTokenMenu, setShowTokenMenu] = useState(false);
  const [showSepMenu, setShowSepMenu] = useState(false);

  const handleRemove = (index: number) => onChange(tokens.filter((_, i) => i !== index));
  const handleAddToken = (t: string) => { onChange([...tokens, t]); setShowTokenMenu(false); };
  const handleAddSep = (s: string) => { onChange([...tokens, s]); setShowSepMenu(false); };
  const preview = resolvePreview(tokens);

  return (
    <div style={{ marginBottom: 'var(--alm-sp-2)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--alm-sp-1)', alignItems: 'center', minHeight: 32 }}>
        {tokens.map((tk, i) => {
          const isSep = !tk.startsWith('{');
          return (
            <span key={`${tk}-${i}`} className={isSep ? 'alm-sep-chip' : 'alm-token-chip'}>
              {tk}
              <span
                className="alm-token-chip__x"
                role="button"
                tabIndex={0}
                aria-label={`Remove ${tk}`}
                onClick={() => handleRemove(i)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRemove(i); }}
              >
                &times;
              </span>
            </span>
          );
        })}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Btn size="sm" onClick={() => { setShowTokenMenu(!showTokenMenu); setShowSepMenu(false); }}>
            + Token
          </Btn>
          {showTokenMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 10,
              background: 'var(--alm-surface)', border: '1px solid var(--alm-border)',
              borderRadius: 'var(--alm-radius)', padding: 'var(--alm-sp-1)',
              minWidth: 160, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            }}>
              {AVAILABLE_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '4px 8px', background: 'none', border: 'none',
                    cursor: 'pointer', fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)',
                    color: 'var(--alm-text)',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = 'var(--alm-hover-bg)')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
                  onClick={() => handleAddToken(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Btn size="sm" onClick={() => { setShowSepMenu(!showSepMenu); setShowTokenMenu(false); }}>
            + Sep
          </Btn>
          {showSepMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 10,
              background: 'var(--alm-surface)', border: '1px solid var(--alm-border)',
              borderRadius: 'var(--alm-radius)', padding: 'var(--alm-sp-1)',
              minWidth: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            }}>
              {SEPARATORS.map((s) => (
                <button
                  key={s}
                  type="button"
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '4px 8px', background: 'none', border: 'none',
                    cursor: 'pointer', fontFamily: 'var(--alm-font-mono)', fontSize: 'var(--alm-text-xs)',
                    color: 'var(--alm-text)',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = 'var(--alm-hover-bg)')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
                  onClick={() => handleAddSep(s)}
                >
                  {s === '/' ? '/ (path separator)' : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {tokens.length > 0 && (
        <div style={{ marginTop: 'var(--alm-sp-1)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          Preview: <code className="alm-mono" style={{ color: 'var(--alm-text)' }}>{preview}</code>
        </div>
      )}
    </div>
  );
}

export function NamingStructure({ save }: NamingStructureProps) {
  const [patterns, setPatterns] = useState<Record<string, string[]>>(DEFAULT_PATTERNS);

  const handleChange = (ft: string, tokens: string[]) => {
    const updated = { ...patterns, [ft]: tokens };
    setPatterns(updated);
    save('naming', { patterns: updated });
  };

  const previewLines = useMemo(
    () => FRAME_TYPES.map((ft) => ({ type: ft, path: resolvePreview(patterns[ft] ?? []) })),
    [patterns],
  );

  return (
    <>
      {FRAME_TYPES.map((ft) => (
        <div key={ft} className="alm-settings__group">
          <div className="alm-settings__group-title">{ft} frames</div>
          <div className="alm-settings__row">
            <div className="alm-settings__row-content">
              <PatternEditor
                tokens={patterns[ft] ?? []}
                onChange={(tokens) => handleChange(ft, tokens)}
                frameType={ft}
              />
            </div>
          </div>
        </div>
      ))}

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Live Preview</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}>
          {previewLines.map(({ type, path }) => (
            <div key={type} style={{ display: 'flex', gap: 'var(--alm-sp-3)', alignItems: 'baseline' }}>
              <span style={{ width: 60, fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', flexShrink: 0 }}>
                {type}:
              </span>
              <code className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>{path || '—'}</code>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
