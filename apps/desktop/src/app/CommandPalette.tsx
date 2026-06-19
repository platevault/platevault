import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { Command } from 'cmdk';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { searchGlobal, getSettings } from '@/api/commands';
import { openInNewWindow } from '@/lib/window';
import type { SearchResult } from '@/bindings/types';

const PAGES: Array<{ label: string; route: string }> = [
  { label: 'Sessions', route: '/sessions' },
  { label: 'Review queue', route: '/review' },
  { label: 'Calibration', route: '/calibration' },
  { label: 'Targets', route: '/targets' },
  { label: 'Projects', route: '/projects' },
  { label: 'Plans', route: '/plans' },
  { label: 'Audit log', route: '/audit' },
  { label: 'Settings', route: '/settings' },
];

interface PaletteAction {
  label: string;
  /** Route path for simple navigation actions. */
  route?: string;
  /** Custom handler for actions that need search params or other side effects. */
  onSelect?: () => void;
}

const ACTIONS: Array<PaletteAction> = [
  { label: 'New project', route: '/projects/new' },
];

/**
 * Developer-only palette entry (spec 021 T013).
 * Appended to the Pages group only when devMode is on.
 */
const DEV_PAGES: Array<{ label: string; route: string }> = [
  { label: 'Developer / Contracts', route: '/dev/contracts' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [devMode, setDevMode] = useState(false);
  const navigate = useNavigate();
  const currentHref = useRouterState({ select: (s) => s.location.href });

  // Load devMode from backend settings on mount (spec 021 T013).
  useEffect(() => {
    let cancelled = false;
    getSettings({ scope: 'advanced' })
      .then((data) => {
        if (cancelled) return;
        const vals = data.values as Record<string, unknown>;
        setDevMode(vals?.devMode === true);
      })
      .catch(() => {
        // Backend unavailable — stay with default false.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    // Debounce search by 200ms to avoid excessive API calls
    const timeoutId = setTimeout(() => {
      void searchGlobal({ query }).then((r) => {
        if (!controller.signal.aborted) setResults(r);
      });
    }, 200);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [query]);

  const select = useCallback(
    (route: string) => {
      setOpen(false);
      setQuery('');
      void navigate({ to: route });
    },
    [navigate],
  );

  const selectAction = useCallback(
    (action: PaletteAction) => {
      setOpen(false);
      setQuery('');
      if (action.onSelect) {
        action.onSelect();
      } else if (action.route) {
        void navigate({ to: action.route });
      }
    },
    [navigate],
  );

  // FR-033 / T077: "Show ignored items" navigates to sessions with ignored review filter.
  const showIgnoredAction = useCallback(() => {
    setOpen(false);
    setQuery('');
    // Cast needed: TanStack Router search types are route-specific; reviewFilter
    // is a valid sessions-route param (route-contract.ts REVIEW_FILTERS).
    void navigate({ to: '/sessions', search: { reviewFilter: 'ignored' } as never });
  }, [navigate]);

  const ALL_ACTIONS: Array<PaletteAction> = [
    ...ACTIONS,
    { label: 'Show ignored items', onSelect: showIgnoredAction },
  ];

  // All visible pages: standard pages + dev pages when devMode is on.
  const visiblePages = devMode ? [...PAGES, ...DEV_PAGES] : PAGES;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="alm-palette-backdrop" />
        <Dialog.Popup className="alm-palette" aria-label="Command palette">
          <Command shouldFilter={false}>
            <Command.Input
              className="alm-palette__input"
              placeholder="Search sessions, targets, projects..."
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
            <Command.List className="alm-palette__list">
              {query.trim() && results.length === 0 && (
                <Command.Empty className="alm-palette__empty">
                  No results for &ldquo;{query.trim()}&rdquo;. Try a different search term.
                </Command.Empty>
              )}
              {results.length > 0 && (
                <Command.Group heading="Results">
                  {results.map((r) => (
                    <Command.Item
                      key={r.id}
                      className="alm-palette__item"
                      onSelect={() => select(r.route)}
                    >
                      <span className="alm-palette__item-kind">{r.kind}</span>
                      <span className="alm-palette__item-label">{r.label}</span>
                      {r.sublabel && (
                        <span className="alm-palette__item-sub">{r.sublabel}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Pages">
                {visiblePages.map((p) => (
                  <Command.Item
                    key={p.route}
                    className="alm-palette__item"
                    onSelect={() => select(p.route)}
                  >
                    <span className="alm-palette__item-label">{p.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions">
                {ALL_ACTIONS.map((a) => (
                  <Command.Item
                    key={a.label}
                    className="alm-palette__item"
                    onSelect={() => selectAction(a)}
                  >
                    <span className="alm-palette__item-label">{a.label}</span>
                  </Command.Item>
                ))}
                <Command.Item
                  className="alm-palette__item"
                  onSelect={() => {
                    setOpen(false);
                    setQuery('');
                    void openInNewWindow(currentHref);
                  }}
                >
                  <span className="alm-palette__item-label">Open view in new window</span>
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
