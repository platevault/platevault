import { Link, useRouterState } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import { useStatusSummary } from './useStatusSummary';

interface NavItem {
  glyph: string;
  label: string;
  path: string;
  warn?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { glyph: '⬇', label: 'Inbox', path: '/inbox', warn: true },
  { glyph: 'S', label: 'Sessions', path: '/sessions' },
  { glyph: 'C', label: 'Calibration', path: '/calibration' },
  { glyph: '⌖', label: 'Targets', path: '/targets' },
  { glyph: 'P', label: 'Projects', path: '/projects' },
  { glyph: '▣', label: 'Archive', path: '/archive' },
  { glyph: '⚙', label: 'Settings', path: '/settings' },
];

const MOCK_COUNTS: Record<string, number> = {
  '/inbox': 12,
  '/sessions': 247,
  '/calibration': 84,
  '/targets': 53,
  '/projects': 19,
};

export function Sidebar() {
  const [collapsed, setCollapsed] = usePreference('sidebarCollapsed');
  const location = useRouterState({ select: (s) => s.location });
  const status = useStatusSummary();

  const onlineRoots = status.roots.filter((r) => r.online);
  const offlineRoots = status.roots.filter((r) => !r.online);

  function getCount(item: NavItem): number | undefined {
    if (item.path === '/inbox' && status.inboxCount > 0) return status.inboxCount;
    return MOCK_COUNTS[item.path];
  }

  // --- Collapsed sidebar ---
  if (collapsed) {
    return (
      <nav
        className="alm-sidebar alm-sidebar--collapsed"
        aria-label="Main navigation"
      >
        {/* Collapsed header — icon placeholder */}
        <div
          className="alm-sidebar__collapsed-header"
          onClick={() => setCollapsed(false)}
          title="Expand sidebar"
        >
          <span className="alm-sidebar__logo-icon" />
        </div>

        {/* Nav items as centered glyphs */}
        <ul className="alm-sidebar__list">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname.startsWith(item.path);
            const count = getCount(item);
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={clsx(
                    'alm-sidebar__item alm-sidebar__item--glyph',
                    active && 'alm-sidebar__item--active',
                  )}
                  title={item.label}
                >
                  <span className="alm-sidebar__glyph">{item.glyph}</span>
                  {item.warn && count !== undefined && count > 0 && (
                    <span className="alm-sidebar__warn-dot" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Expand toggle */}
        <button
          type="button"
          className="alm-sidebar__toggle"
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
        >
          &raquo;
        </button>
      </nav>
    );
  }

  // --- Expanded sidebar ---
  return (
    <nav
      className="alm-sidebar"
      aria-label="Main navigation"
    >
      {/* Header: brand + collapse */}
      <div className="alm-sidebar__header">
        <div className="alm-sidebar__brand">
          <div className="alm-sidebar__brand-label">Astro Library</div>
          <div className="alm-sidebar__brand-version">
            Manager <span className="alm-sidebar__version-num">v0.4</span>
          </div>
        </div>
        <button
          type="button"
          className="alm-sidebar__collapse-btn"
          onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          &laquo;
        </button>
      </div>

      {/* Nav items */}
      <ul className="alm-sidebar__list">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.path);
          const count = getCount(item);
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                className={clsx(
                  'alm-sidebar__item',
                  active && 'alm-sidebar__item--active',
                )}
              >
                <span className="alm-sidebar__label">{item.label}</span>
                {count !== undefined && (
                  <span
                    className={clsx(
                      'alm-sidebar__count',
                      item.warn && 'alm-sidebar__count--warn',
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Footer: root health */}
      <div className="alm-sidebar__footer">
        <Link to="/settings/$pane" params={{ pane: 'data-sources' }} className="alm-sidebar__roots">
          <span
            className={clsx(
              'alm-sidebar__root-dot',
              offlineRoots.length > 0
                ? 'alm-sidebar__root-dot--warn'
                : 'alm-sidebar__root-dot--ok',
            )}
          />
          {status.roots.length} roots &middot; {onlineRoots.length} online
        </Link>
        {offlineRoots.length > 0 && (
          <div className="alm-sidebar__offline-warn">
            {offlineRoots.map((r) => r.path.split(/[\\/]/).pop()).join(', ')} offline
          </div>
        )}
      </div>
    </nav>
  );
}
