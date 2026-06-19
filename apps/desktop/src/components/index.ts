export { ListDetailLayout } from './ListDetailLayout';
export type { ListDetailLayoutProps } from './ListDetailLayout';
export { PageShell } from './PageShell';
export type { PageShellProps } from './PageShell';
export { ListSidebar } from './ListSidebar';
export type { ListSidebarProps } from './ListSidebar';
export { ListItem } from './ListItem';
export type { ListItemProps } from './ListItem';
export { TopActionBar } from './TopActionBar';
export type { TopActionBarProps } from './TopActionBar';
export { DetailHeader } from './DetailHeader';
export type { DetailHeaderProps } from './DetailHeader';
export { DetailPane } from './DetailPane';
export type { DetailPaneProps } from './DetailPane';

// Design v4 detail standard: identity header → metric line → dashboard grid
// (primary column + unified rail panel), plus the centralized lifecycle.
export { MetricLine } from './MetricLine';
export type { Metric, MetricLineProps } from './MetricLine';
export { DetailGrid, Rail, RailCard } from './DetailGrid';
export type { DetailGridProps, RailProps, RailCardProps } from './DetailGrid';
export { Lifecycle } from './Lifecycle';
export type { LifecycleProps } from './Lifecycle';

export { ConfirmOverlay } from './ConfirmOverlay';
export type { ConfirmOverlayProps } from './ConfirmOverlay';

// spec 035: SIMBAD target resolution — project-creation target typeahead.
export { TargetSearch } from './TargetSearch';
export type { TargetSearchProps } from './TargetSearch';

// PropertyTable is retained for feature files that still import it directly.
// Migrate callers to inline prop-table markup with alm-* CSS classes over time.
export { PropertyTable } from './PropertyTable';
export type { PropertyDef, PropertyTableProps } from './PropertyTable';

// Legacy ListSidebar types re-exported for feature files pending migration.
export type { SelectOption, FilterPill, DropdownDef, ActionDef } from './legacy-types';
