import { Link, useRouterState } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import { useQuery, createQueryStore } from '@/data/store';
import { getReviewQueue, listPlans } from '@/api/commands';

interface NavItem {
  /** Single-letter glyph shown in collapsed mode. */
  glyph: string;
  label: string;
  path: string;
  /** Whether this item can show a warn-colored count. */
  warn?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { glyph: 'R', label: 'Review queue', path: '/review', warn: true },
  { glyph: 'S', label: 'Sessions', path: '/sessions' },
  { glyph: 'C', label: 'Calibration', path: '/calibration' },
  { glyph: '⌖', label: 'Targets', path: '/targets' },
  { glyph: 'P', label: 'Projects', path: '/projects' },
  { glyph: '◇', label: 'Plans', path: '/plans', warn: true },
  { glyph: '◷', label: 'Audit log', path: '/audit' },
  { glyph: '⚙', label: 'Settings', path: '/settings' },
];

/** Mock counts matching the wireframe. Real data overrides review + plans. */
const MOCK_COUNTS: Record<string, number> = {
  '/review': 48,
  '/sessions': 247,
  '/calibration': 84,
  '/targets': 53,
  '/projects': 19,
  '/plans': 3,
};

const reviewStore = createQueryStore(() => getReviewQueue());
const plansStore = createQueryStore(() => listPlans());

export function Sidebar() {
  const [collapsed, setCollapsed] = usePreference('sidebarCollapsed');
  const location = useRouterState({ select: (s) => s.location });
  const reviewState = useQuery(reviewStore);
  const plansState = useQuery(plansStore);

  const reviewCount = reviewState.data?.length ?? 0;
  const pendingPlans =
    plansState.data?.filter(
      (p) => p.state === 'ready_for_review' || p.state === 'approved',
    ).length ?? 0;

  function getCount(item: NavItem): number | undefined {
    // Use real data when available, otherwise fall back to mock counts
    if (item.path === '/review' && reviewCount > 0) return reviewCount;
    if (item.path === '/plans' && pendingPlans > 0) return pendingPlans;
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

      {/* Footer: root stats + offline warning */}
      <div className="alm-sidebar__footer">
        <div className="alm-sidebar__roots">4 roots &middot; 2 online</div>
        <div className="alm-sidebar__offline-warn">
          &#x26A0; NAS-Astro offline
        </div>
      </div>
    </nav>
  );
}
