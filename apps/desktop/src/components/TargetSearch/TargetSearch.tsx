/**
 * TargetSearch — spec 035 (SIMBAD Target Resolution), User Stories 1 + 3.
 *
 * Debounced as-you-type target search with a two-phase pipeline:
 *
 *   1. Local (US1, T013): `target.search` against the bundled seed + local
 *      cache — instant, no network. Renders ranked suggestions, each showing
 *      the primary designation prominently, the common name (if any) as a
 *      secondary line, and badges for object type and source / catalogue.
 *
 *   2. Long-tail (US3, T022): after the same debounce and a minimum query
 *      length (≥3 chars), ALSO call `target.resolve` (the SIMBAD long-tail).
 *      Any `status = "resolved"` target is merged into the suggestion list,
 *      de-duped against the local hits, so objects not in the seed/cache still
 *      appear. `unresolved` (incl. the offline / resolver-disabled case,
 *      FR-015) is treated as a normal, non-fatal outcome — no error is shown.
 *
 * Cancel-in-flight (US3 acceptance scenario #2): every query change bumps a
 * generation counter and aborts the previous AbortController. Both phases check
 * their captured generation before committing state, so a stale resolve can
 * never overwrite the current query's results.
 *
 * Selecting a suggestion (mouse or keyboard) invokes `onSelect(suggestion)`,
 * exposing the canonical `targetId` so the caller can associate it.
 *
 * Accessibility: combobox + listbox/option ARIA, arrow-key navigation, Enter to
 * select, Escape to close.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  searchTargets,
  resolveTarget,
  TARGET_SEARCH_CONTRACT_VERSION,
} from '@/api/commands';
import type { TargetSuggestion, ResolvedTarget } from '@/api/commands';
import type { TargetCatalogId, TargetObjectType } from '@/bindings/index';
import { Pill } from '@/ui';
import { objectTypeLabel } from './objectType';

// ── Constants ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 300;
const DEFAULT_LIMIT = 20;
/** Minimum query length before the SIMBAD long-tail phase fires (US3, T022). */
const MIN_RESOLVE_LEN = 3;

// ── Props ────────────────────────────────────────────────────────────────────

export interface TargetSearchProps {
  /** Called with the chosen suggestion (exposes the canonical `targetId`). */
  onSelect: (suggestion: TargetSuggestion) => void;
  /** Optional: restrict to catalogues (empty/absent = all). */
  catalogFilter?: TargetCatalogId[];
  /** Optional: restrict to object types (empty/absent = all). */
  typeFilter?: TargetObjectType[];
  /** Max suggestions to request (default 20). */
  limit?: number;
  /** Field label (visually hidden if `hideLabel`). */
  label?: string;
  /** Placeholder for the input. */
  placeholder?: string;
  /** Render the label as screen-reader-only. */
  hideLabel?: boolean;
  /** Optional id for the input (defaults to a generated id). */
  inputId?: string;
  /** Forwarded to the input for autofocus. */
  autoFocus?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Project a SIMBAD `ResolvedTarget` into the suggestion row shape. */
function resolvedToSuggestion(t: ResolvedTarget): TargetSuggestion {
  return {
    targetId: t.targetId,
    primaryDesignation: t.primaryDesignation,
    commonName: t.commonName ?? null,
    objectType: t.objectType,
    matchedAlias: null,
    source: t.source,
  };
}

/**
 * Merge a long-tail resolved suggestion into the local hits, de-duped.
 *
 * Dedupe keys: canonical `targetId` (primary), and — to catch the case where
 * the same physical object is already present from the seed/cache under a
 * different row id — a case-insensitive `primaryDesignation` match. Local hits
 * always win (they are kept; the resolved row is dropped when it collides).
 */
function mergeDedupe(local: TargetSuggestion[], resolved: TargetSuggestion): TargetSuggestion[] {
  const designation = resolved.primaryDesignation.trim().toLowerCase();
  const isDuplicate = local.some(
    (s) =>
      s.targetId === resolved.targetId ||
      s.primaryDesignation.trim().toLowerCase() === designation,
  );
  return isDuplicate ? local : [...local, resolved];
}

// ── Component ────────────────────────────────────────────────────────────────

export function TargetSearch({
  onSelect,
  catalogFilter,
  typeFilter,
  limit = DEFAULT_LIMIT,
  label = 'Search for a target',
  placeholder = 'e.g. M31, NGC 224, Andromeda',
  hideLabel = false,
  inputId,
  autoFocus = false,
}: TargetSearchProps) {
  const generatedId = useId();
  const id = inputId ?? `tgt-search-${generatedId}`;
  const listboxId = `${id}-listbox`;

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TargetSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);

  // Cancel-in-flight: a generation counter + AbortController per query. Only the
  // latest generation may commit results; superseded generations are aborted.
  const genRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();

      // Supersede any in-flight pipeline.
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const gen = ++genRef.current;
      const isCurrent = () => gen === genRef.current && !ac.signal.aborted;

      if (!trimmed) {
        setSuggestions([]);
        setLoading(false);
        setResolving(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      // ── Phase 1: local seed + cache (instant) ──────────────────────────────
      try {
        const res = await searchTargets({
          contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
          requestId: crypto.randomUUID(),
          query: trimmed,
          catalogFilter,
          typeFilter,
          limit,
        });
        if (!isCurrent()) return; // superseded — drop stale result
        setSuggestions(res.suggestions);
        setActiveIndex(res.suggestions.length > 0 ? 0 : -1);
      } catch (err: unknown) {
        if (!isCurrent()) return;
        const code = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
        setError(`Could not search targets (${code}).`);
        setSuggestions([]);
        setLoading(false);
        return;
      } finally {
        if (isCurrent()) setLoading(false);
      }

      // ── Phase 2: SIMBAD long-tail (debounced, min length) ──────────────────
      if (trimmed.length < MIN_RESOLVE_LEN) return;

      setResolving(true);
      try {
        const res = await resolveTarget({
          contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
          requestId: crypto.randomUUID(),
          query: trimmed,
          override: null,
        });
        // Cancel-in-flight guard: a newer query must not be overwritten.
        if (!isCurrent()) return;
        if (res.status === 'resolved' && res.target) {
          // Merge against the current list (the Phase-1 local hits for this
          // generation) so the long-tail row is appended, never duplicated.
          setSuggestions((prev) =>
            mergeDedupe(prev, resolvedToSuggestion(res.target as ResolvedTarget)),
          );
        }
        // `unresolved` (unknown / offline / resolver-disabled) is non-fatal:
        // leave the local hits untouched and surface no error (FR-011/FR-015).
      } catch {
        // Network/internal resolve failure is non-fatal for the typeahead;
        // the local hits already render. Swallow to avoid error spam.
        if (!isCurrent()) return;
      } finally {
        if (isCurrent()) setResolving(false);
      }
    },
    [catalogFilter, typeFilter, limit],
  );

  // Debounce query changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Abort any in-flight pipeline on unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const handleSelect = useCallback(
    (s: TargetSuggestion) => {
      onSelect(s);
      setOpen(false);
    },
    [onSelect],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setOpen(true);
        setActiveIndex((i) => (i + 1) % suggestions.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        break;
      case 'Enter':
        if (activeIndex >= 0 && activeIndex < suggestions.length) {
          e.preventDefault();
          handleSelect(suggestions[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setActiveIndex(-1);
        setOpen(false);
        break;
      default:
        break;
    }
  }

  const showList = open && query.trim().length > 0;
  const activeOptionId =
    activeIndex >= 0 && activeIndex < suggestions.length ? `${id}-opt-${activeIndex}` : undefined;

  return (
    <div className="alm-target-search">
      <label
        className={hideLabel ? 'alm-target-search__label--sr' : 'alm-field-label'}
        htmlFor={id}
      >
        {label}
      </label>
      <input
        id={id}
        className="alm-input alm-target-search__input"
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder={placeholder}
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {error && (
        <span id={`${id}-error`} role="alert" className="alm-field-error">
          {error}
        </span>
      )}

      {showList && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Target suggestions"
          className="alm-target-search__list"
        >
          {loading && suggestions.length === 0 && (
            <li className="alm-target-search__status" aria-live="polite">
              Searching…
            </li>
          )}
          {!loading && !error && suggestions.length === 0 && !resolving && (
            <li className="alm-target-search__status" aria-live="polite">
              No matching targets.
            </li>
          )}
          {suggestions.map((s, i) => {
            const secondary = s.commonName ?? s.matchedAlias ?? null;
            return (
              <li
                key={s.targetId}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={
                  i === activeIndex
                    ? 'alm-target-search__option alm-target-search__option--active'
                    : 'alm-target-search__option'
                }
                onMouseDown={(e) => {
                  // Prevent the input blur from closing the list before select.
                  e.preventDefault();
                  handleSelect(s);
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="alm-target-search__primary">{s.primaryDesignation}</span>
                {secondary && secondary !== s.primaryDesignation && (
                  <span className="alm-target-search__secondary">{secondary}</span>
                )}
                <span className="alm-target-search__badges">
                  <Pill variant="info">{objectTypeLabel(s.objectType)}</Pill>
                  <Pill variant="ghost">{s.source}</Pill>
                </span>
              </li>
            );
          })}
          {resolving && (
            <li
              className="alm-target-search__status alm-target-search__status--resolving"
              aria-live="polite"
            >
              Searching SIMBAD…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
