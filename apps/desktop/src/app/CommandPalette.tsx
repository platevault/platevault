import { useState, useEffect, useCallback } from 'react';
import { m } from '@/lib/i18n';
import { Dialog } from '@base-ui-components/react/dialog';
import { Command } from 'cmdk';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { openInNewWindow } from '@/lib/window';
import { useHotkeys } from '@/lib/useHotkeys';
import type { SearchResult } from '@/bindings/types';

// `label` is a render-time thunk so it re-reads the active locale (spec 046 #8).
const PAGES: Array<{ label: () => string; route: string }> = [
  { label: () => m.common_sessions(), route: '/sessions' },
  { label: () => m.cmdk_page_review_queue(), route: '/review' },
  { label: () => m.settings_datasources_category_calibration(), route: '/calibration' },
  { label: () => m.nav_targets(), route: '/targets' },
  { label: () => m.common_projects(), route: '/projects' },
  { label: () => m.cmdk_page_plans(), route: '/plans' },
  { label: () => m.cmdk_page_audit_log(), route: '/audit' },
  { label: () => m.settings_page_title(), route: '/settings' },
];

interface PaletteAction {
  /** Render-time thunk so the label re-reads the active locale (spec 046 #8). */
  label: () => string;
  /** Route path for simple navigation actions. */
  route?: string;
  /** Custom handler for actions that need search params or other side effects. */
  onSelect?: () => void;
}

const ACTIONS: Array<PaletteAction> = [
  { label: () => m.projects_create_title(), route: '/projects/new' },
];

/**
 * Developer-only palette entry (spec 021 T013).
 * Appended to the Pages group only when devMode is on.
 */
const DEV_PAGES: Array<{ label: () => string; route: string }> = [
  { label: () => m.cmdk_dev_contracts(), route: '/dev/contracts' },
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
    commands
      .settingsGet('advanced')
      .then(unwrap)
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

  // ⌘/Ctrl+K toggles the palette. `$mod` resolves to Cmd on macOS, Ctrl
  // elsewhere — matching the prior `metaKey || ctrlKey` check. We opt out of the
  // form-field guard so the shortcut still fires while focus is in an input.
  useHotkeys(
    {
      '$mod+KeyK': (e) => {
        e.preventDefault();
        setOpen((v) => !v);
      },
    },
    [],
    { ignoreFormFields: false },
  );

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    // Debounce search by 200ms to avoid excessive API calls
    const timeoutId = setTimeout(() => {
      void commands
        .searchGlobal(query)
        .then(unwrap)
        .then((r) => {
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
    { label: () => m.cmdk_action_show_ignored(), onSelect: showIgnoredAction },
  ];

  // All visible pages: standard pages + dev pages when devMode is on.
  const visiblePages = devMode ? [...PAGES, ...DEV_PAGES] : PAGES;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="alm-palette-backdrop" />
        <Dialog.Popup className="alm-palette" aria-label={m.cmdk_aria_label()}>
          <Command shouldFilter={false}>
            <Command.Input
              className="alm-palette__input"
              placeholder={m.cmdk_placeholder()}
              value={query}
              onValueChange={setQuery}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- command palette is a modal dialog summoned on demand; focusing its input is the expected behavior
              autoFocus
            />
            <Command.List className="alm-palette__list">
              {query.trim() && results.length === 0 && (
                <Command.Empty className="alm-palette__empty">
                  {m.cmdk_no_results({ query: query.trim() })}
                </Command.Empty>
              )}
              {results.length > 0 && (
                <Command.Group heading={m.cmdk_group_results()}>
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
              <Command.Group heading={m.cmdk_group_pages()}>
                {visiblePages.map((p) => (
                  <Command.Item
                    key={p.route}
                    className="alm-palette__item"
                    onSelect={() => select(p.route)}
                  >
                    <span className="alm-palette__item-label">{p.label()}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading={m.cmdk_group_actions()}>
                {ALL_ACTIONS.map((a) => (
                  <Command.Item
                    key={a.label()}
                    className="alm-palette__item"
                    onSelect={() => selectAction(a)}
                  >
                    <span className="alm-palette__item-label">{a.label()}</span>
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
                  <span className="alm-palette__item-label">{m.cmdk_open_new_window()}</span>
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
