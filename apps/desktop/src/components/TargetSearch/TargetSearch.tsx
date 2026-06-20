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
 * monotonic generation counter. Both phases check their captured generation
 * before committing state, so a stale (superseded) response can never overwrite
 * the current query's results. (Tauri `invoke` exposes no AbortSignal, so this
 * generation guard is the cancel mechanism — no AbortController is involved.)
 *
 * Selecting a suggestion (mouse or keyboard) invokes `onSelect(suggestion)`,
 * exposing the canonical `targetId` so the caller can associate it.
 *
 * Accessibility: combobox + listbox/option ARIA, arrow-key navigation, Enter to
 * select, Escape to close.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  searchTargets,
  resolveTarget,
  TARGET_SEARCH_CONTRACT_VERSION,
} from '@/api/commands';
import type { TargetSuggestion, ResolvedTarget } from '@/api/commands';
import type { TargetCatalogId, TargetObjectType } from '@/bindings/index';
import { Pill } from '@/ui';
import {
  objectTypeLabel,
  catalogLabel,
  OBJECT_TYPES,
  CATALOG_IDS,
} from './objectType';

// ── Constants ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 300;
const DEFAULT_LIMIT = 20;
/** Minimum query length before the SIMBAD long-tail phase fires (US3, T022). */
const MIN_RESOLVE_LEN = 3;
/** Estimated suggestion-row height (px) for the virtualizer. */
const OPTION_ESTIMATE = 44;

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
  /**
   * Show the optional catalogue/type filter control (T029, US5). Default off.
   * The control seeds from `catalogFilter`/`typeFilter` and overrides them.
   */
  showFilters?: boolean;
  /**
   * Enable the per-row "Correct…" manual-override action (T032, US4/FR-014).
   * Binds the current query to the chosen target as `source=user-override`.
   */
  enableOverride?: boolean;
  /**
   * Called after a successful manual override with the user-override suggestion
   * (source = `user-override`). Defaults to `onSelect` when omitted.
   */
  onOverride?: (suggestion: TargetSuggestion) => void;
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
  showFilters = false,
  enableOverride = false,
  onOverride,
}: TargetSearchProps) {
  const generatedId = useId();
  const id = inputId ?? `tgt-search-${generatedId}`;
  const listboxId = `${id}-listbox`;
  const typeFilterId = `${id}-type-filter`;
  const catalogFilterId = `${id}-catalog-filter`;

  // Optional filter state (T029). Seeds from props; "all" = no filter.
  const [typeSel, setTypeSel] = useState<TargetObjectType | ''>(
    typeFilter && typeFilter.length === 1 ? typeFilter[0] : '',
  );
  const [catalogSel, setCatalogSel] = useState<TargetCatalogId | ''>(
    catalogFilter && catalogFilter.length === 1 ? catalogFilter[0] : '',
  );
  // Effective filters sent to the backend (internal control wins when shown).
  const effectiveTypeFilter = showFilters
    ? typeSel
      ? [typeSel]
      : undefined
    : typeFilter;
  const effectiveCatalogFilter = showFilters
    ? catalogSel
      ? [catalogSel]
      : undefined
    : catalogFilter;
  // Stable string keys so the search callback only re-creates on real changes.
  const typeFilterKey = (effectiveTypeFilter ?? []).join(',');
  const catalogFilterKey = (effectiveCatalogFilter ?? []).join(',');

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TargetSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);

  // Cancel-in-flight: a monotonic generation counter. Each query bumps `gen`;
  // only the latest generation may commit results, so a slow response from a
  // superseded query is dropped. (Tauri `invoke` has no AbortSignal, so this
  // generation guard — not an AbortController — is the actual cancel mechanism.)
  const genRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Virtualize the suggestion options. The `<ul role="listbox">` is the scroll
  // element (height-capped via CSS); only the visible option window mounts.
  const virtualizer = useVirtualizer({
    count: suggestions.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => OPTION_ESTIMATE,
    overscan: 6,
  });

  const runSearch = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();

      // Supersede any in-flight pipeline by bumping the generation.
      const gen = ++genRef.current;
      const isCurrent = () => gen === genRef.current;

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
          catalogFilter: effectiveCatalogFilter,
          typeFilter: effectiveTypeFilter,
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
    // Re-create when the effective filters change. `*FilterKey` are stable
    // string keys derived from the filter arrays; the arrays themselves are
    // read inside the callback (intentionally not listed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalogFilterKey, typeFilterKey, limit],
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

  const handleSelect = useCallback(
    (s: TargetSuggestion) => {
      onSelect(s);
      setOpen(false);
    },
    [onSelect],
  );

  // Manual override (T032, FR-014): bind the current query to the chosen target
  // as `source=user-override`. Persisted server-side and wins over future
  // SIMBAD/seed resolutions for that query.
  const [overriding, setOverriding] = useState<string | null>(null);
  const handleOverride = useCallback(
    async (s: TargetSuggestion) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setOverriding(s.targetId);
      setError(null);
      try {
        const res = await resolveTarget({
          contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
          requestId: crypto.randomUUID(),
          query: trimmed,
          override: { targetId: s.targetId },
        });
        const result: TargetSuggestion =
          res.status === 'resolved' && res.target
            ? resolvedToSuggestion(res.target)
            : { ...s, source: 'user-override' };
        (onOverride ?? onSelect)(result);
        setOpen(false);
      } catch (err: unknown) {
        const code = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
        setError(`Could not set target (${code}).`);
      } finally {
        setOverriding(null);
      }
    },
    [query, onOverride, onSelect],
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

  // Keep the active option mounted + visible during keyboard navigation. The
  // virtualizer only mounts the visible window, so an off-screen active option
  // (referenced by `aria-activedescendant`) must be scrolled into view.
  useEffect(() => {
    if (activeIndex >= 0 && activeIndex < suggestions.length) {
      virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
    }
  }, [activeIndex, suggestions.length, virtualizer]);

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

      {showFilters && (
        <div className="alm-target-search__filters" role="group" aria-label="Search filters">
          <label className="alm-target-search__filter-label" htmlFor={typeFilterId}>
            Type
            <select
              id={typeFilterId}
              className="alm-select alm-target-search__filter-select"
              value={typeSel}
              onChange={(e) => setTypeSel(e.target.value as TargetObjectType | '')}
            >
              <option value="">All types</option>
              {OBJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {objectTypeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="alm-target-search__filter-label" htmlFor={catalogFilterId}>
            Catalogue
            <select
              id={catalogFilterId}
              className="alm-select alm-target-search__filter-select"
              value={catalogSel}
              onChange={(e) => setCatalogSel(e.target.value as TargetCatalogId | '')}
            >
              <option value="">All catalogues</option>
              {CATALOG_IDS.map((c) => (
                <option key={c} value={c}>
                  {catalogLabel(c)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {error && (
        <span id={`${id}-error`} role="alert" className="alm-field-error">
          {error}
        </span>
      )}

      {showList && (
        <ul
          id={listboxId}
          ref={listRef}
          role="listbox"
          aria-label="Target suggestions"
          className="alm-target-search__list alm-virtual-scroll"
          data-virtual-scroll="true"
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
          {suggestions.length > 0 && (
            <div
              className="alm-virtual-inner"
              style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const i = virtualRow.index;
                const s = suggestions[i];
                const secondary = s.commonName ?? s.matchedAlias ?? null;
                return (
                  <li
                    key={s.targetId}
                    id={`${id}-opt-${i}`}
                    data-index={i}
                    ref={virtualizer.measureElement}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={
                      i === activeIndex
                        ? 'alm-target-search__option alm-target-search__option--active'
                        : 'alm-target-search__option'
                    }
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
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
                      <Pill variant={s.source === 'user-override' ? 'accent' : 'ghost'}>
                        {s.source}
                      </Pill>
                      {enableOverride && (
                        <button
                          type="button"
                          className="alm-target-search__override"
                          aria-label={`Set "${query.trim()}" to ${s.primaryDesignation}`}
                          disabled={overriding != null || query.trim().length === 0}
                          onMouseDown={(e) => {
                            // Don't trigger the row's select-on-mousedown.
                            e.preventDefault();
                            e.stopPropagation();
                            void handleOverride(s);
                          }}
                        >
                          {overriding === s.targetId ? 'Setting…' : 'Correct…'}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </div>
          )}
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
