import { Link, useRouterState } from '@tanstack/react-router';
import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import { useQuery, createQueryStore } from '@/data/store';
import { getReviewQueue, listPlans } from '@/api/commands';

interface NavItem {
  glyph: string;
  label: string;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { glyph: 'R', label: 'Review queue', path: '/review' },
  { glyph: 'S', label: 'Sessions', path: '/sessions' },
  { glyph: 'C', label: 'Calibration', path: '/calibration' },
  { glyph: 'T', label: 'Targets', path: '/targets' },
  { glyph: 'P', label: 'Projects', path: '/projects' },
  { glyph: 'L', label: 'Plans', path: '/plans' },
  { glyph: 'A', label: 'Audit log', path: '/audit' },
  { glyph: '⚙', label: 'Settings', path: '/settings' },
];

const reviewStore = createQueryStore(() => getReviewQueue());
const plansStore = createQueryStore(() => listPlans());

export function Sidebar() {
  const [collapsed, setCollapsed] = usePreference('sidebarCollapsed');
  const location = useRouterState({ select: (s) => s.location });
  const reviewState = useQuery(reviewStore);
  const plansState = useQuery(plansStore);

  const reviewCount = reviewState.data?.length ?? 0;
  const pendingPlans = plansState.data?.filter(
    (p) => p.state === 'ready_for_review' || p.state === 'approved',
  ).length ?? 0;

  function getBadge(item: NavItem): number | undefined {
    if (item.path === '/review' && reviewCount > 0) return reviewCount;
    if (item.path === '/plans' && pendingPlans > 0) return pendingPlans;
    return undefined;
  }

  return (
    <nav
      className={clsx('alm-sidebar', collapsed && 'alm-sidebar--collapsed')}
      aria-label="Main navigation"
    >
      <ul className="alm-sidebar__list">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.path);
          const badge = getBadge(item);
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                className={clsx(
                  'alm-sidebar__item',
                  active && 'alm-sidebar__item--active',
                )}
                title={collapsed ? item.label : undefined}
              >
                <span className="alm-sidebar__glyph">{item.glyph}</span>
                {!collapsed && (
                  <span className="alm-sidebar__label">{item.label}</span>
                )}
                {badge !== undefined && (
                  <span className="alm-sidebar__badge">{badge}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="alm-sidebar__toggle"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '»' : '«'}
      </button>
    </nav>
  );
}
