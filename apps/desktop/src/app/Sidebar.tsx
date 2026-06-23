import { Link, useRouterState } from '@tanstack/react-router';
import { m } from '@/lib/i18n';
import {
  Inbox,
  Camera,
  Crosshair,
  Target,
  FolderOpen,
  Archive,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { usePreference } from '@/data/preferences';
import { useStatusSummary, type StatusSummary } from './useStatusSummary';

interface NavItem {
  id: string;
  icon: React.ElementType;
  /** Render-time thunk so the label re-reads the active locale (see spec 046 #8). */
  label: () => string;
  path: string;
}

interface NavGroup {
  /** Render-time thunk so the label re-reads the active locale (see spec 046 #8). */
  label: () => string;
  items: NavItem[];
}

// Grouped by workflow stage: capture → organize → work on.
const NAV_GROUPS: NavGroup[] = [
  {
    label: () => m.nav_group_capture(),
    items: [{ id: 'inbox', icon: Inbox, label: () => m.settings_datasources_category_inbox(), path: '/inbox' }],
  },
  {
    label: () => m.nav_group_library(),
    items: [
      { id: 'sessions', icon: Camera, label: () => m.common_sessions(), path: '/sessions' },
      { id: 'calibration', icon: Crosshair, label: () => m.settings_datasources_category_calibration(), path: '/calibration' },
      { id: 'targets', icon: Target, label: () => m.nav_targets(), path: '/targets' },
    ],
  },
  {
    label: () => m.nav_group_work(),
    items: [
      { id: 'projects', icon: FolderOpen, label: () => m.common_projects(), path: '/projects' },
      { id: 'archive', icon: Archive, label: () => m.verb_archive(), path: '/archive' },
    ],
  },
];

const SETTINGS_ITEM: NavItem = { id: 'settings', icon: Settings, label: () => m.settings_page_title(), path: '/settings' };

function badgeFor(id: string, status: StatusSummary): number {
  switch (id) {
    case 'inbox':
      return status.inboxCount;
    case 'sessions':
      return status.sessionCount;
    case 'calibration':
      return status.calibrationCount;
    case 'targets':
      return status.targetCount;
    case 'projects':
      return status.projectCount;
    default:
      return 0;
  }
}

export function Sidebar() {
  const [collapsed, setCollapsed] = usePreference('sidebarCollapsed');
  const location = useRouterState({ select: (s) => s.location });
  const status = useStatusSummary();

  const onlineRoots = status.roots.filter((r) => r.online);
  const offlineRoots = status.roots.filter((r) => !r.online);

  function renderItem(item: NavItem) {
    const active = location.pathname.startsWith(item.path);
    const count = badgeFor(item.id, status);
    const Icon = item.icon;
    return (
      <Link
        key={item.id}
        to={item.path}
        className={clsx('alm-sidebar__item', active && 'alm-sidebar__item--active')}
        aria-label={item.label()}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label() : undefined}
      >
        <span className="alm-sidebar__item-icon">
          <Icon size={18} />
        </span>
        {!collapsed && <span className="alm-sidebar__item-label">{item.label()}</span>}
        {!collapsed && count > 0 && (
          <span
            className={clsx(
              'alm-sidebar__item-badge',
              item.id === 'inbox' && 'alm-sidebar__item-badge--alert',
            )}
          >
            {count}
          </span>
        )}
      </Link>
    );
  }

  return (
    <nav
      className={clsx('alm-sidebar', collapsed && 'alm-sidebar--collapsed')}
      aria-label={m.nav_aria_label()}
    >
      {/* Header: brand mark + collapse, single line */}
      <div className="alm-sidebar__header">
        {/* eslint-disable-next-line alm/no-user-string -- decorative brand glyph, not translatable content */}
        {!collapsed && <div className="alm-sidebar__mark">P</div>}
        {!collapsed && <span className="alm-sidebar__brand-name">{m.shell_brand_name()}</span>}
        {!collapsed && <span className="alm-sidebar__version">{m.shell_version()}</span>}
        <button
          type="button"
          className="alm-sidebar__collapse"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? m.nav_expand_sidebar_aria() : m.nav_collapse_sidebar_aria()}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Grouped nav */}
      <div className="alm-sidebar__nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.label()} className="alm-sidebar__group">
            {!collapsed && <div className="alm-sidebar__group-label">{group.label()}</div>}
            {group.items.map(renderItem)}
          </div>
        ))}
      </div>

      {/* Settings pinned at the bottom, separated from the workflow nav */}
      <div className="alm-sidebar__settings">{renderItem(SETTINGS_ITEM)}</div>

      {/* Footer: root health (hidden when collapsed) */}
      {!collapsed && (
        <div className="alm-sidebar__footer">
          <Link
            to="/settings/$pane"
            params={{ pane: 'data-sources' }}
            className="alm-sidebar__roots"
          >
            <span
              className={clsx(
                'alm-sidebar__root-dot',
                offlineRoots.length > 0
                  ? 'alm-sidebar__root-dot--warn'
                  : 'alm-sidebar__root-dot--ok',
              )}
            />
            {m.nav_roots_summary({ total: status.roots.length, online: onlineRoots.length })}
          </Link>
          {offlineRoots.length > 0 && (
            <div className="alm-sidebar__offline-warn">
              {offlineRoots.map((r) => r.path.split(/[\\/]/).pop()).join(', ')} {m.nav_roots_offline_suffix()}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
