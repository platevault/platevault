// spec 015 — Token Pattern Builder: backend-wired resolver, validator, preview.
// spec 018 — pattern + autoApplyPattern keys persisted via settings transport.
// spec 041 (T051, FR-026b) — per-frame-type destination patterns.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Btn } from '@/ui';
import {
  getSettings,
  patternValidate,
  patternPreview,
  updateSettings,
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

// ── Per-frame-type destination patterns (spec 041 T051, FR-026b) ──────────────
//
// The backend stores these under ONE naming-scope key, `patterns_by_type`: a
// JSON object mapping a frame-type class name to a pattern string. The seven
// class names below are the exact strings the backend recognises. An absent key
// (or empty input) means "use the built-in default" — only overridden classes
// are persisted.

const FRAME_TYPE_CLASSES = [
  'light',
  'flat',
  'dark',
  'bias',
  'master_flat',
  'master_dark',
  'master_bias',
] as const;
type FrameTypeClass = (typeof FRAME_TYPE_CLASSES)[number];

const FRAME_TYPE_LABELS: Record<FrameTypeClass, string> = {
  light: 'Light',
  flat: 'Flat',
  dark: 'Dark',
  bias: 'Bias',
  master_flat: 'Master Flat',
  master_dark: 'Master Dark',
  master_bias: 'Master Bias',
};

// Built-in defaults shown as the placeholder / reset target per type.
const FRAME_TYPE_DEFAULT_PATTERNS: Record<FrameTypeClass, string> = {
  light: '{target}/{filter}/{date}/light/',
  flat: 'flats/{filter}/{date}/',
  dark: 'darks/{exposure}/',
  bias: 'bias/',
  master_flat: 'masters/flats/{filter}/',
  master_dark: 'masters/darks/{exposure}/',
  master_bias: 'masters/bias/',
};

// Valid `{token}` names (mirrors the backend token vocabulary). Literal path
// segments are allowed; only `{...}` tokens are validated.
const VALID_PATTERN_TOKENS = new Set(AVAILABLE_TOKENS);

/**
 * Client-side mirror of the backend token rule. Returns an error message when
 * the pattern references an unknown `{token}`, else `null`. An empty string is
 * NOT an error here — it means "use the built-in default". The backend
 * `value.invalid` result remains the source of truth on save.
 */
function validatePatternString(value: string): string | null {
  if (value.trim() === '') return null; // empty = use default
  const unknown: string[] = [];
  const re = /\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const token = m[1];
    if (!VALID_PATTERN_TOKENS.has(token as (typeof AVAILABLE_TOKENS)[number])) {
      unknown.push(token);
    }
  }
  if (unknown.length > 0) {
    return `Unknown token${unknown.length > 1 ? 's' : ''}: ${unknown.map((t) => `{${t}}`).join(', ')}`;
  }
  return null;
}

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
                borderRadius: 'var(--alm-radius-md)',
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
                borderRadius: 'var(--alm-radius-md)',
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
            color: 'var(--alm-danger)',
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

// ── PerTypeDestinationPatterns (spec 041 T051, FR-026b) ───────────────────────
//
// Self-contained editor for the `patterns_by_type` naming-scope key. It loads
// and saves directly (rather than via the parent `save` debounce) so it can
// surface the backend `value.invalid` rejection inline — the parent auto-save
// swallows write errors.

function PerTypeDestinationPatterns() {
  // Override map: class → pattern string. Absent class = built-in default.
  const [overrides, setOverrides] = useState<Partial<Record<FrameTypeClass, string>>>({});
  const [backendErrors, setBackendErrors] = useState<Partial<Record<FrameTypeClass, string>>>({});
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load saved overrides on mount ────────────────────────────────────────
  useEffect(() => {
    getSettings({ scope: 'naming' })
      .then((data) => {
        const vals = data.values as Record<string, unknown>;
        const raw = vals.patterns_by_type;
        if (raw && typeof raw === 'object') {
          const next: Partial<Record<FrameTypeClass, string>> = {};
          for (const cls of FRAME_TYPE_CLASSES) {
            const v = (raw as Record<string, unknown>)[cls];
            if (typeof v === 'string') next[cls] = v;
          }
          setOverrides(next);
        }
      })
      .catch(() => {
        // Use defaults on load failure (e.g. in test/mock environment).
      })
      .finally(() => setLoaded(true));
  }, []);

  // ── Persist the full override map (debounced, captures backend errors) ────
  const persist = useCallback((next: Partial<Record<FrameTypeClass, string>>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // Send only non-empty overrides; an empty/absent class means "default".
      const payload: Record<string, string> = {};
      for (const cls of FRAME_TYPE_CLASSES) {
        const v = next[cls];
        if (typeof v === 'string' && v.trim() !== '') payload[cls] = v;
      }
      void updateSettings({ scope: 'naming', values: { patterns_by_type: payload } }).then(
        () => {
          // Clear any stale backend errors on a successful save.
          setBackendErrors({});
        },
        (err: unknown) => {
          // Backend rejected at least one pattern (error code value.invalid).
          // We cannot tell which class from a single string; flag all classes
          // that currently fail client-side validation, falling back to a
          // generic banner keyed on the first overridden class.
          const message = typeof err === 'string' ? err : 'Invalid pattern';
          const errs: Partial<Record<FrameTypeClass, string>> = {};
          let attributed = false;
          for (const cls of FRAME_TYPE_CLASSES) {
            const v = next[cls];
            if (typeof v === 'string' && v.trim() !== '' && validatePatternString(v) !== null) {
              errs[cls] = message;
              attributed = true;
            }
          }
          if (!attributed) {
            const firstOverride = FRAME_TYPE_CLASSES.find(
              (cls) => typeof next[cls] === 'string' && next[cls]!.trim() !== '',
            );
            if (firstOverride) errs[firstOverride] = message;
          }
          setBackendErrors(errs);
        },
      );
    }, 300);
  }, []);

  const handleChange = (cls: FrameTypeClass, value: string) => {
    const next = { ...overrides };
    if (value.trim() === '') {
      delete next[cls];
    } else {
      next[cls] = value;
    }
    setOverrides(next);
    // Clear this class's backend error optimistically; re-validated on save.
    setBackendErrors((prev) => {
      if (!(cls in prev)) return prev;
      const { [cls]: _removed, ...rest } = prev;
      return rest;
    });
    persist(next);
  };

  const handleReset = (cls: FrameTypeClass) => {
    const next = { ...overrides };
    delete next[cls];
    setOverrides(next);
    setBackendErrors((prev) => {
      if (!(cls in prev)) return prev;
      const { [cls]: _removed, ...rest } = prev;
      return rest;
    });
    persist(next);
  };

  return (
    <div className="alm-settings__group">
      <div className="alm-settings__group-title">Per-Type Destination Patterns</div>
      <div className="alm-settings__row-desc" style={{ marginBottom: 'var(--alm-sp-2)' }}>
        Destination folder pattern per frame type, applied when confirming inbox
        items. Leave blank to use the built-in default.
      </div>
      {FRAME_TYPE_CLASSES.map((cls) => {
        const value = overrides[cls] ?? '';
        const clientError = loaded ? validatePatternString(value) : null;
        const error = backendErrors[cls] ?? clientError ?? undefined;
        const isOverridden = value.trim() !== '';
        const inputId = `naming-pattern-${cls}`;
        return (
          <div className="alm-settings__row" key={cls}>
            <label className="alm-settings__row-label" htmlFor={inputId}>
              {FRAME_TYPE_LABELS[cls]}
            </label>
            <div className="alm-settings__row-content">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}>
                <input
                  id={inputId}
                  type="text"
                  className="alm-input"
                  style={{ flex: 1, minWidth: 220, fontFamily: 'var(--alm-font-mono)' }}
                  value={value}
                  placeholder={FRAME_TYPE_DEFAULT_PATTERNS[cls]}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  data-testid={inputId}
                  onChange={(e) => handleChange(cls, e.target.value)}
                />
                <Btn
                  size="sm"
                  disabled={!isOverridden}
                  data-testid={`naming-pattern-reset-${cls}`}
                  onClick={() => handleReset(cls)}
                >
                  Reset to default
                </Btn>
              </div>
              {error && (
                <div
                  id={`${inputId}-error`}
                  role="alert"
                  style={{
                    marginTop: 'var(--alm-sp-1)',
                    fontSize: 'var(--alm-text-xs)',
                    color: 'var(--alm-danger)',
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          </div>
        );
      })}
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

      <PerTypeDestinationPatterns />

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
          <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-danger)' }}>
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
