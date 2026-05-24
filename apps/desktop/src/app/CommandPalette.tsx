import { useState, useEffect, useCallback } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { Command } from 'cmdk';
import { useNavigate } from '@tanstack/react-router';
import { searchGlobal } from '@/api/commands';
import type { SearchResult } from '@/api/types';

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

const ACTIONS: Array<{ label: string; route: string }> = [
  { label: 'New project', route: '/projects/new' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const navigate = useNavigate();

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
      searchGlobal({ query }).then((r) => {
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
      navigate({ to: route });
    },
    [navigate],
  );

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
                        <span className="alm-palette__item-sub">
                          {r.sublabel}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Pages">
                {PAGES.map((p) => (
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
                {ACTIONS.map((a) => (
                  <Command.Item
                    key={a.route}
                    className="alm-palette__item"
                    onSelect={() => select(a.route)}
                  >
                    <span className="alm-palette__item-label">{a.label}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
