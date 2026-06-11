// spec 015 — Token Pattern Builder: backend-wired resolver, validator, preview.
// spec 018 — pattern + autoApplyPattern keys persisted via settings transport.
import { useState, useEffect, useCallback } from 'react';
import { Btn } from '@/ui';
import {
  getSettings,
  updateSettings,
  patternValidate,
  patternPreview,
  type PatternPart,
  type PatternPreviewResponse,
} from '@/api/commands';

interface NamingStructureProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

// ── Token / separator vocabulary ──────────────────────────────────────────────

const AVAILABLE_TOKENS = [
  'target',
  'filter',
  'date',
  'frame_type',
  'camera',
  'exposure',
  'gain',
  'binning',
  'set_temp',
] as const;

const SEPARATORS = ['/', '-', '_', ' '] as const;

// ── Sample metadata for live preview (R-Preview) ─────────────────────────────

const SAMPLE_METADATA = {
  target: 'NGC7000',
  filter: 'Ha',
  date: '2026-04-12',
  frame_type: 'light' as const,
  camera: 'ASI2600MM',
  exposure: '300s',
  gain: '100',
  binning: '1x1',
  set_temp: '-10C',
};

// ── Default pattern {target}/{filter}/{date}/{frame_type}/ ────────────────────

const DEFAULT_PATTERN: PatternPart[] = [
  { id: 'p0', kind: 'token', value: 'target' },
  { id: 'p1', kind: 'separator', value: '/' },
  { id: 'p2', kind: 'token', value: 'filter' },
  { id: 'p3', kind: 'separator', value: '/' },
  { id: 'p4', kind: 'token', value: 'date' },
  { id: 'p5', kind: 'separator', value: '/' },
  { id: 'p6', kind: 'token', value: 'frame_type' },
  { id: 'p7', kind: 'separator', value: '/' },
];

// ── Stable id generation ──────────────────────────────────────────────────────

let _idCounter = 100;
function nextId(): string {
  return `pp${(_idCounter++).toString()}`;
}

// ── PatternChipsEditor ────────────────────────────────────────────────────────

function PatternChipsEditor({
  pattern,
  onChange,
  errorCode,
  warnings,
}: {
  pattern: PatternPart[];
  onChange: (parts: PatternPart[]) => void;
  errorCode?: string;
  warnings: string[];
}) {
  const [showTokenMenu, setShowTokenMenu] = useState(false);
  const [showSepMenu, setShowSepMenu] = useState(false);

  const handleRemove = (id: string) => onChange(pattern.filter((p) => p.id !== id));

  const handleAddToken = (value: string) => {
    onChange([...pattern, { id: nextId(), kind: 'token', value }]);
    setShowTokenMenu(false);
  };

  const handleAddSep = (value: string) => {
    onChange([...pattern, { id: nextId(), kind: 'separator', value }]);
    setShowSepMenu(false);
  };

  return (
    <div>
      {/* Chip row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--alm-sp-1)',
          alignItems: 'center',
          minHeight: 32,
        }}
      >
        {pattern.map((part) => {
          const isSep = part.kind === 'separator';
          const label = isSep ? (part.value === ' ' ? '⎵' : part.value) : `{${part.value}}`;
          return (
            <span key={part.id} className={isSep ? 'alm-sep-chip' : 'alm-token-chip'}>
              {label}
              <span
                className="alm-token-chip__x"
                role="button"
                tabIndex={0}
                aria-label={`Remove ${label}`}
                onClick={() => handleRemove(part.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRemove(part.id);
                }}
              >
                &times;
              </span>
            </span>
          );
        })}

        {/* Add Token menu */}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Btn
            size="sm"
            onClick={() => {
              setShowTokenMenu(!showTokenMenu);
              setShowSepMenu(false);
            }}
          >
            + Token
          </Btn>
          {showTokenMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 10,
                background: 'var(--alm-surface)',
                border: '1px solid var(--alm-border)',
                borderRadius: 'var(--alm-radius)',
                padding: 'var(--alm-sp-1)',
                minWidth: 160,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              }}
            >
              {AVAILABLE_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '4px 8px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--alm-font-mono)',
                    fontSize: 'var(--alm-text-xs)',
                    color: 'var(--alm-text)',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = 'var(--alm-hover-bg)')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
                  onClick={() => handleAddToken(t)}
                >
                  {`{${t}}`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Add Separator menu */}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <Btn
            size="sm"
            onClick={() => {
              setShowSepMenu(!showSepMenu);
              setShowTokenMenu(false);
            }}
          >
            + Sep
          </Btn>
          {showSepMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 10,
                background: 'var(--alm-surface)',
                border: '1px solid var(--alm-border)',
                borderRadius: 'var(--alm-radius)',
                padding: 'var(--alm-sp-1)',
                minWidth: 100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              }}
            >
              {SEPARATORS.map((s) => (
                <button
                  key={s}
                  type="button"
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '4px 8px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: 'var(--alm-font-mono)',
                    fontSize: 'var(--alm-text-xs)',
                    color: 'var(--alm-text)',
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = 'var(--alm-hover-bg)')}
                  onMouseOut={(e) => (e.currentTarget.style.background = 'none')}
                  onClick={() => handleAddSep(s)}
                >
                  {s === '/' ? '/ (path separator)' : s === ' ' ? '⎵ (space)' : s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Validation feedback */}
      {errorCode && (
        <div
          style={{
            marginTop: 'var(--alm-sp-1)',
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-error, #c0392b)',
          }}
          role="alert"
        >
          {errorCode === 'pattern.empty' && 'Pattern is empty — add at least one token.'}
          {errorCode === 'token.unknown' && 'Pattern contains an unknown token.'}
          {errorCode && !['pattern.empty', 'token.unknown'].includes(errorCode) &&
            `Invalid pattern (${errorCode})`}
        </div>
      )}
      {warnings.length > 0 && (
        <div
          style={{
            marginTop: 'var(--alm-sp-1)',
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
          }}
        >
          {warnings.includes('no_path_separator') && (
            <span>No path separator (/) — all tokens resolve to one flat folder.{' '}</span>
          )}
          {warnings.includes('consecutive_separators') && (
            <span>Consecutive separators detected.{' '}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── NamingStructure ───────────────────────────────────────────────────────────

export function NamingStructure({ save }: NamingStructureProps) {
  const [pattern, setPattern] = useState<PatternPart[]>(DEFAULT_PATTERN);
  const [autoApplyPattern, setAutoApplyPattern] = useState(true);
  const [preview, setPreview] = useState<PatternPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [validateResult, setValidateResult] = useState<{
    valid: boolean;
    warnings: string[];
    errorCode?: string;
  } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // ── Load saved pattern on mount (spec 018 keys: pattern, autoApplyPattern) ─
  useEffect(() => {
    getSettings({ scope: 'naming' })
      .then((data) => {
        const vals = data.values as Record<string, unknown>;
        if (Array.isArray(vals.pattern) && vals.pattern.length > 0) {
          setPattern(vals.pattern as PatternPart[]);
        }
        if (typeof vals.autoApplyPattern === 'boolean') {
          setAutoApplyPattern(vals.autoApplyPattern);
        }
      })
      .catch(() => {
        // Use defaults on load failure (e.g. in test/mock environment).
      })
      .finally(() => setLoaded(true));
  }, []);

  // ── Live validation (T1.3 / T1.4) ────────────────────────────────────────
  const runValidation = useCallback((parts: PatternPart[]) => {
    patternValidate(parts)
      .then((resp) => {
        setValidateResult({
          valid: resp.valid,
          warnings: resp.warnings,
          errorCode: resp.errorCode,
        });
      })
      .catch(() => {
        // Ignore validation errors in mock/offline environments.
      });
  }, []);

  // ── Live preview (T2.2 / T3.11) ─────────────────────────────────────────
  const runPreview = useCallback((parts: PatternPart[]) => {
    if (parts.length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    patternPreview(parts, SAMPLE_METADATA)
      .then((resp) => {
        setPreview(resp);
        setPreviewError(null);
      })
      .catch((err: unknown) => {
        setPreview(null);
        setPreviewError(typeof err === 'string' ? err : 'Preview unavailable');
      });
  }, []);

  // Run both when pattern changes, after initial load.
  useEffect(() => {
    if (!loaded) return;
    runValidation(pattern);
    runPreview(pattern);
  }, [pattern, loaded, runValidation, runPreview]);

  // ── Handle pattern change ─────────────────────────────────────────────────
  const handlePatternChange = (parts: PatternPart[]) => {
    setPattern(parts);
    // Persist immediately (spec 018 keys — noisy, no audit).
    save('naming', { pattern: parts, autoApplyPattern });
  };

  const handleAutoApplyChange = (checked: boolean) => {
    setAutoApplyPattern(checked);
    save('naming', { pattern, autoApplyPattern: checked });
  };

  const isValid = validateResult?.valid !== false;
  const canSave = isValid && pattern.length > 0;

  return (
    <>
      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Project Folder Pattern</div>
        <div className="alm-settings__row">
          <div className="alm-settings__row-content">
            <PatternChipsEditor
              pattern={pattern}
              onChange={handlePatternChange}
              errorCode={validateResult?.valid === false ? validateResult.errorCode : undefined}
              warnings={validateResult?.warnings ?? []}
            />
          </div>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__row">
          <label className="alm-settings__row-label">
            <input
              type="checkbox"
              checked={autoApplyPattern}
              onChange={(e) => handleAutoApplyChange(e.target.checked)}
              style={{ marginRight: 'var(--alm-sp-1)' }}
            />
            Auto-apply pattern to new projects without confirmation
          </label>
        </div>
      </div>

      <div className="alm-settings__group">
        <div className="alm-settings__group-title">Live Preview</div>
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-sp-1)' }}>
          Sample: NGC7000 / Ha / 2026-04-12 / light
        </div>
        {!canSave && (
          <div
            style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', fontStyle: 'italic' }}
          >
            — (invalid or empty pattern)
          </div>
        )}
        {previewError && (
          <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-error, #c0392b)' }}>
            {previewError}
          </div>
        )}
        {preview && canSave && (
          <div style={{ display: 'flex', gap: 'var(--alm-sp-3)', alignItems: 'baseline' }}>
            <code className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)' }}>
              {preview.missingTokens.length > 0 ? (
                // Render path with fallback segments dimmed.
                preview.resolvedPath
              ) : (
                preview.resolvedPath
              )}
            </code>
            {preview.missingTokens.length > 0 && (
              <span
                style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', fontStyle: 'italic' }}
              >
                (fallback used for: {preview.missingTokens.join(', ')})
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}
