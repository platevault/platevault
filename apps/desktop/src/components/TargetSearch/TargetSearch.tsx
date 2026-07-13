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
 *      length (≥3 chars), ALSO call `target.resolve` (the SIMBAD long-tail,
 *      TAP + cache only — never the Sesame fallback, spec 052 P2 FR-009).
 *      Any `status = "resolved"` target is merged into the suggestion list,
 *      de-duped against the local hits, so objects not in the seed/cache still
 *      appear. `unresolved` (incl. the offline / resolver-disabled case,
 *      FR-015) is treated as a normal, non-fatal outcome — no error is shown.
 *
 * "Search more catalogues" (spec 052 P2, FR-008/FR-009): when both phases
 * above still leave zero suggestions, a button calls `target.resolve_explicit`
 * (TAP-first, SIMBAD Sesame/NED/VizieR fallback on a miss) — the deliberate
 * resolve action the fallback is gated on. Never fired automatically or per
 * keystroke.
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
 * Accessibility & overlay behaviour (spec 042 / T161): the combobox is built on
 * `@base-ui-components/react/combobox`. Base UI owns the combobox/listbox/option
 * ARIA wiring, roving focus + arrow-key navigation, Enter-to-select,
 * Escape-to-close, and click-outside dismissal — replacing the prior hand-rolled
 * keydown / mousedown / `aria-activedescendant` glue. We drive it as a fully
 * controlled, async-filtered combobox (`filter={null}`, controlled `items`,
 * `open`, and `inputValue`), so the two-phase server pipeline above remains the
 * single source of truth for the option list.
 *
 * Virtualization: Base UI's `virtualized` mode is paired with a
 * `@tanstack/react-virtual` virtualizer driven off our own `suggestions` array.
 * Because internal filtering is disabled (`filter={null}`), Base UI's filtered
 * item list is exactly the array we pass, so the virtualizer and the combobox
 * stay in lockstep without the (RC-internal) `useFilteredItems` hook. This keeps
 * long-list performance from US3 while gaining Base UI's accessibility.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Combobox } from '@base-ui-components/react/combobox';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDebouncedCallback } from 'use-debounce';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { TargetSuggestion, ResolvedTarget } from '@/bindings/aliases';
import type { TargetCatalogId, TargetObjectType } from '@/bindings/index';
import { Pill } from '@/ui';
import { m } from '@/lib/i18n';
import {
  objectTypeLabel,
  catalogLabel,
  OBJECT_TYPES,
  CATALOG_IDS,
} from './objectType';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Contract version for the target.search / target.resolve requests. Moved here
 * off the retired @/api/commands wrapper (spec 037 FR-004: move, not drop).
 */
const TARGET_SEARCH_CONTRACT_VERSION = '1.0';

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
function mergeDedupe(
  local: TargetSuggestion[],
  resolved: TargetSuggestion,
): TargetSuggestion[] {
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
  label = m.targets_add_target_search_label(),
  placeholder = m.projects_create_target_search_placeholder(),
  hideLabel = false,
  inputId,
  autoFocus = false,
  showFilters = false,
  enableOverride = false,
  onOverride,
}: TargetSearchProps) {
  const generatedId = useId();
  const id = inputId ?? `tgt-search-${generatedId}`;
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
  const [open, setOpen] = useState(false);
  // "Search more catalogues" (spec 052 P2): idle until the user explicitly
  // triggers the Sesame/NED/VizieR fallback; reset on every new query so a
  // fresh search always starts idle again.
  const [harderState, setHarderState] = useState<
    'idle' | 'searching' | 'no-results'
  >('idle');

  // Cancel-in-flight: a monotonic generation counter. Each query bumps `gen`;
  // only the latest generation may commit results, so a slow response from a
  // superseded query is dropped. (Tauri `invoke` has no AbortSignal, so this
  // generation guard — not an AbortController — is the actual cancel mechanism.)
  const genRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Virtualize the suggestion options. Because Base UI internal filtering is
  // disabled (`filter={null}`), the combobox's filtered list equals our own
  // `suggestions` array, so the virtualizer can be driven directly from it.
  const virtualizer = useVirtualizer({
    count: suggestions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => OPTION_ESTIMATE,
    overscan: 6,
  });

  const runSearch = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();

      // Supersede any in-flight pipeline by bumping the generation.
      const gen = ++genRef.current;
      const isCurrent = () => gen === genRef.current;
      // A new query always starts the "search more catalogues" affordance idle.
      setHarderState('idle');

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
        const res = unwrap(
          await commands.targetSearch({
            contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
            requestId: crypto.randomUUID(),
            query: trimmed,
            catalogFilter: effectiveCatalogFilter,
            typeFilter: effectiveTypeFilter,
            limit,
          }),
        );
        if (!isCurrent()) return; // superseded — drop stale result
        setSuggestions(res.suggestions);
      } catch {
        if (!isCurrent()) return;
        setError(m.targetsearch_search_failed());
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
        const res = unwrap(
          await commands.targetResolve({
            contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
            requestId: crypto.randomUUID(),
            query: trimmed,
            override: null,
          }),
        );
        // Cancel-in-flight guard: a newer query must not be overwritten.
        if (!isCurrent()) return;
        if (res.status === 'resolved' && res.target) {
          // Merge against the current list (the Phase-1 local hits for this
          // generation) so the long-tail row is appended, never duplicated.
          const resolved = res.target;
          setSuggestions((prev) =>
            mergeDedupe(prev, resolvedToSuggestion(resolved)),
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

  // Debounce query changes. `useDebouncedCallback` cancels any pending call on
  // unmount and whenever a new invocation is scheduled, preserving the prior
  // hand-rolled setTimeout/clearTimeout semantics at the same DEBOUNCE_MS.
  const debouncedSearch = useDebouncedCallback(
    (q: string) => void runSearch(q),
    DEBOUNCE_MS,
  );
  useEffect(() => {
    debouncedSearch(query);
    return () => debouncedSearch.cancel();
  }, [query, debouncedSearch]);

  // "Search more catalogues" (spec 052 P2, FR-008/FR-009): the deliberate
  // resolve action the Sesame/NED/VizieR fallback is gated on — a click, not
  // a keystroke. Shares the same generation guard as `runSearch` so a query
  // change while this is in flight drops its (now-stale) result.
  const handleSearchHarder = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const gen = genRef.current;
    setHarderState('searching');
    try {
      const res = unwrap(
        await commands.targetResolveExplicit({
          contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
          requestId: crypto.randomUUID(),
          query: trimmed,
          override: null,
        }),
      );
      if (gen !== genRef.current) return; // superseded by a newer query
      if (res.status === 'resolved' && res.target) {
        const resolved = res.target;
        setSuggestions((prev) =>
          mergeDedupe(prev, resolvedToSuggestion(resolved)),
        );
        setHarderState('idle');
      } else {
        setHarderState('no-results');
      }
    } catch {
      if (gen !== genRef.current) return;
      setError(m.targetsearch_search_failed());
      setHarderState('idle');
    }
  }, [query]);

  const handleSelect = useCallback(
    (s: TargetSuggestion | null) => {
      if (!s) return;
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
        const res = unwrap(
          await commands.targetResolve({
            contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
            requestId: crypto.randomUUID(),
            query: trimmed,
            override: { targetId: s.targetId },
          }),
        );
        const result: TargetSuggestion =
          res.status === 'resolved' && res.target
            ? resolvedToSuggestion(res.target)
            : { ...s, source: 'user-override' };
        (onOverride ?? onSelect)(result);
        setOpen(false);
      } catch {
        setError(m.targetsearch_set_failed());
      } finally {
        setOverriding(null);
      }
    },
    [query, onOverride, onSelect],
  );

  const showList = open && query.trim().length > 0;

  // Keep the highlighted option mounted + visible during keyboard navigation.
  // The virtualizer only mounts the visible window, so an off-screen highlighted
  // option must be scrolled into view as Base UI moves the active index.
  const handleItemHighlighted = useCallback(
    (_value: TargetSuggestion | undefined, details: { index: number }) => {
      if (details.index >= 0 && details.index < suggestions.length) {
        virtualizer.scrollToIndex(details.index, { align: 'auto' });
      }
    },
    [suggestions.length, virtualizer],
  );

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();

  // Base UI uses `value` for selection. We keep the input independent of
  // selection (selecting a target should not stuff its label into the box), so
  // `value` stays null and we react via `onValueChange`.
  const itemToStringLabel = useMemo(
    () => (s: TargetSuggestion) => s.primaryDesignation,
    [],
  );

  return (
    <div className="alm-target-search">
      <Combobox.Root<TargetSuggestion>
        items={suggestions}
        // Selection stays uncontrolled: we react via `onValueChange` and keep
        // the typed query as the input's source of truth (controlled
        // `inputValue`), so choosing a target never overwrites what was typed.
        onValueChange={handleSelect}
        filter={null}
        // F2: auto-highlight the first suggestion as results arrive, matching the
        // pre-base-ui behavior (Enter selects the top hit without an ArrowDown).
        autoHighlight
        virtualized
        modal={false}
        open={showList}
        onOpenChange={(nextOpen) => setOpen(nextOpen)}
        inputValue={query}
        onInputValueChange={(value, details) => {
          // `item-press` fires when an item is selected; don't treat that as a
          // user edit (it would otherwise blank/replace the query).
          if (details.reason === 'item-press') return;
          setQuery(value);
          if (value.trim().length > 0) setOpen(true);
        }}
        itemToStringLabel={itemToStringLabel}
        onItemHighlighted={handleItemHighlighted}
      >
        {}
        <label
          className={
            hideLabel ? 'alm-target-search__label--sr' : 'alm-field-label'
          }
          htmlFor={id}
        >
          {label}
        </label>
        <Combobox.Input
          id={id}
          className="alm-input alm-target-search__input"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder={placeholder}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opt-in via the autoFocus prop; callers enable it only for focused search surfaces
          autoFocus={autoFocus}
          onFocus={() => {
            if (query.trim().length > 0) setOpen(true);
          }}
        />

        {showFilters && (
          <div
            className="alm-target-search__filters"
            role="group"
            aria-label={m.cmp_target_search_filters_aria()}
          >
            <label
              className="alm-target-search__filter-label"
              htmlFor={typeFilterId}
            >
              {m.cmp_target_search_type_label()}
              <select
                id={typeFilterId}
                className="alm-select alm-target-search__filter-select"
                value={typeSel}
                onChange={(e) =>
                  setTypeSel(e.target.value as TargetObjectType | '')
                }
              >
                <option value="">{m.cmp_target_search_all_types()}</option>
                {OBJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {objectTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="alm-target-search__filter-label"
              htmlFor={catalogFilterId}
            >
              {m.cmp_target_search_catalogue_label()}
              <select
                id={catalogFilterId}
                className="alm-select alm-target-search__filter-select"
                value={catalogSel}
                onChange={(e) =>
                  setCatalogSel(e.target.value as TargetCatalogId | '')
                }
              >
                <option value="">{m.cmp_target_search_all_catalogues()}</option>
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

        {/*
         * `keepMounted`: without it, `Combobox.Portal` only renders its
         * subtree (status/option elements) once Base UI's internal
         * store-derived `mounted` flips true — which, per
         * `useTransitionStatus`, happens synchronously the instant `open`
         * becomes true, EXCEPT this combobox's `open` is re-derived on every
         * keystroke (`onInputValueChange` -> `setOpen(true)`), unlike a
         * click-triggered Dialog/Popover whose `open` only flips once per
         * interaction. That gives a real-typing-driven open/close cycle far
         * more chances to race Base UI's own internal open bookkeeping than
         * a single click does. Windows real-UI E2E (`targets_journeys.rs`,
         * "M 1" suggestion never rendering within 20s even though
         * `target.search` is a local, network-free, sub-millisecond seed
         * lookup) hit exactly that: `aria-expanded`/`data-popup-open` on the
         * input reported "open", but NO popup content — not even the
         * always-present idle/no-results/searching `Combobox.Status` line —
         * ever appeared anywhere in the document, meaning the portal itself
         * never rendered. `keepMounted` decouples rendering the subtree from
         * that race: the popup DOM is always present (hidden via the
         * `hidden` attribute — invisible and inert, so real users never see
         * anything different) as soon as our OWN `suggestions`/`loading`/
         * `error` state has something to show, regardless of Base UI's
         * internal open/mounted timing.
         */}
        <Combobox.Portal keepMounted>
          <Combobox.Positioner
            className="alm-target-search__positioner"
            sideOffset={4}
            align="start"
          >
            <Combobox.Popup className="alm-target-search__popup">
              <Combobox.List
                ref={scrollRef}
                className="alm-target-search__list alm-virtual-scroll"
                data-virtual-scroll="true"
                aria-label={m.cmp_target_search_suggestions_aria()}
              >
                {loading && suggestions.length === 0 && (
                  <Combobox.Status className="alm-target-search__status">
                    {m.cmp_target_search_searching()}
                  </Combobox.Status>
                )}
                {!loading &&
                  !error &&
                  suggestions.length === 0 &&
                  !resolving && (
                    <Combobox.Status className="alm-target-search__status">
                      {m.cmp_target_search_no_results()}
                    </Combobox.Status>
                  )}
                {/*
                 * "Search more catalogues" (spec 052 P2, FR-008/FR-009): the
                 * deliberate resolve action `target.resolve_explicit`'s Sesame
                 * fallback is gated on. Only offered once both prior phases
                 * (local cache + TAP long-tail) have already come up empty —
                 * never fired automatically or per keystroke.
                 */}
                {!loading &&
                  !error &&
                  !resolving &&
                  suggestions.length === 0 &&
                  harderState === 'idle' &&
                  query.trim().length >= MIN_RESOLVE_LEN && (
                    <div className="alm-target-search__status">
                      <button
                        type="button"
                        className="alm-target-search__override"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleSearchHarder();
                        }}
                      >
                        {m.cmp_target_search_search_harder()}
                      </button>
                    </div>
                  )}
                {harderState === 'searching' && (
                  <Combobox.Status className="alm-target-search__status alm-target-search__status--resolving">
                    {m.cmp_target_search_search_harder_searching()}
                  </Combobox.Status>
                )}
                {harderState === 'no-results' && (
                  <Combobox.Status className="alm-target-search__status">
                    {m.cmp_target_search_search_harder_no_results()}
                  </Combobox.Status>
                )}
                {suggestions.length > 0 && (
                  <div
                    className="alm-virtual-inner"
                    // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer total height (totalSize)
                    style={{ height: `${totalSize}px`, position: 'relative' }}
                  >
                    {virtualItems.map((virtualRow) => {
                      const i = virtualRow.index;
                      const s = suggestions[i];
                      const secondary = s.commonName ?? s.matchedAlias ?? null;
                      return (
                        <Combobox.Item
                          key={s.targetId}
                          index={i}
                          value={s}
                          ref={virtualizer.measureElement}
                          data-index={i}
                          className="alm-target-search__option"
                          // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer translateY offset per suggestion row
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <span className="alm-target-search__primary">
                            {s.primaryDesignation}
                          </span>
                          {secondary && secondary !== s.primaryDesignation && (
                            <span className="alm-target-search__secondary">
                              {secondary}
                            </span>
                          )}
                          <span className="alm-target-search__badges">
                            <Pill variant="info">
                              {objectTypeLabel(s.objectType)}
                            </Pill>
                            <Pill
                              variant={
                                s.source === 'user-override'
                                  ? 'accent'
                                  : 'ghost'
                              }
                            >
                              {s.source}
                            </Pill>
                            {enableOverride && (
                              <button
                                type="button"
                                className="alm-target-search__override"
                                aria-label={m.cmp_target_search_set_primary_aria(
                                  {
                                    query: query.trim(),
                                    designation: s.primaryDesignation,
                                  },
                                )}
                                disabled={
                                  overriding != null ||
                                  query.trim().length === 0
                                }
                                onPointerDown={(e) => {
                                  // Don't trigger the row's select-on-press.
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void handleOverride(s);
                                }}
                              >
                                {overriding === s.targetId
                                  ? m.targetsearch_setting()
                                  : m.targetsearch_correct()}
                              </button>
                            )}
                          </span>
                        </Combobox.Item>
                      );
                    })}
                  </div>
                )}
                {resolving && (
                  <Combobox.Status className="alm-target-search__status alm-target-search__status--resolving">
                    {m.cmp_target_search_searching_simbad()}
                  </Combobox.Status>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
