/**
 * TargetSearch — spec 035 (SIMBAD Target Resolution), User Story 1, task T013.
 *
 * Debounced as-you-type target search. Calls `target.search` (local seed +
 * cache only — no network) and renders ranked suggestions, each showing the
 * primary designation prominently, the common name (if any) as a secondary
 * line, and badges for the object type and source / catalogue.
 *
 * Selecting a suggestion (mouse or keyboard) invokes `onSelect(suggestion)`,
 * exposing the canonical `targetId` so the caller can associate it.
 *
 * Scope notes:
 *   - This is the US1 typeahead. Full cancel-in-flight / min-length long-tail
 *     SIMBAD enrichment is US3 (task T022); here we use a basic ~300 ms debounce
 *     plus render-latest (stale responses are dropped via a request sequence).
 *   - Accessibility: combobox + listbox/option ARIA, arrow-key navigation,
 *     Enter to select, Escape to clear the active option.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { searchTargets } from '@/api/commands';
import type { TargetSuggestion } from '@/api/commands';
import { TARGET_SEARCH_CONTRACT_VERSION } from '@/api/commands';
import type { TargetCatalogId, TargetObjectType } from '@/bindings/index';
import { Pill } from '@/ui';
import { objectTypeLabel } from './objectType';

// ── Constants ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 300;
const DEFAULT_LIMIT = 20;

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
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);

  // Render-latest guard: drop responses that are not the most recent request.
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setSuggestions([]);
        setLoading(false);
        setError(null);
        return;
      }
      const seq = ++seqRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await searchTargets({
          contractVersion: TARGET_SEARCH_CONTRACT_VERSION,
          requestId: crypto.randomUUID(),
          query: trimmed,
          catalogFilter,
          typeFilter,
          limit,
        });
        if (seq !== seqRef.current) return; // superseded — drop stale result
        setSuggestions(res.suggestions);
        setActiveIndex(res.suggestions.length > 0 ? 0 : -1);
      } catch (err: unknown) {
        if (seq !== seqRef.current) return;
        const code = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
        setError(`Could not search targets (${code}).`);
        setSuggestions([]);
      } finally {
        if (seq === seqRef.current) setLoading(false);
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
          {!loading && !error && suggestions.length === 0 && (
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
        </ul>
      )}
    </div>
  );
}
