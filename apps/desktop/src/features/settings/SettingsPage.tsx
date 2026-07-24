// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useParams, useNavigate } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { m } from '@/lib/i18n';
import {
  LocaleProvider,
  registerLocaleStrategy,
  useLocale,
} from '@/data/locale';
import { useAutoSave } from './useAutoSave';
import { DataSources } from './DataSources';
import { Equipment } from './Equipment';
import { Ingestion } from './Ingestion';
import { NamingStructure } from './NamingStructure';
import { ProcessingTools } from './ProcessingTools';
import { CalibrationMatching } from './CalibrationMatching';
import { ResolverSettings } from './ResolverSettings';
import { PlannerSettings } from './PlannerSettings';
import { Framing } from './Framing';
import { Cleanup } from './Cleanup';
import { SourceViews } from './SourceViews';
import { General } from './General';
import { Advanced } from './Advanced';
import { AuditLog } from './AuditLog';

// Registers the locale runtime's "custom-almSettings" Paraglide strategy
// (spec 061 T007) so the language control below (General.tsx) can actually
// persist a choice. `getLocale()` re-walks the full strategy chain on every
// call (no memoization beyond a one-time bootstrap self-persist), so it is
// enough for this to run before Settings mounts — it does not need to race
// app boot. The ideal home is main.tsx, next to `initAppearance()`, so a
// previously-saved language also applies to chrome rendered before the user
// ever opens Settings (route-lazy chunk, spec 061 US1/app-boot wiring, not
// yet landed); registering it here at minimum keeps the Settings surface
// itself (this pane's own nav/content) correct regardless of that gap.
registerLocaleStrategy();

// `label` is a render-time thunk so it re-reads the active locale (spec 046 #8).
const PANES = [
  { id: 'sources', label: () => m.settings_nav_pane_sources() },
  { id: 'equipment', label: () => m.settings_nav_pane_equipment() },
  { id: 'ingestion', label: () => m.settings_nav_pane_ingestion() },
  { id: 'naming', label: () => m.settings_nav_pane_naming() },
  { id: 'tools', label: () => m.settings_nav_pane_tools() },
  { id: 'cal', label: () => m.settings_nav_pane_cal() },
  { id: 'catalogs', label: () => m.settings_nav_pane_catalogs() },
  { id: 'planner', label: () => m.settings_nav_pane_planner() },
  { id: 'framing', label: () => m.settings_nav_pane_framing() },
  { id: 'cleanup', label: () => m.settings_nav_pane_cleanup() },
  { id: 'source-views', label: () => m.settings_nav_pane_source_views() },
  { id: 'general', label: () => m.settings_nav_pane_general() },
  { id: 'advanced', label: () => m.settings_nav_pane_advanced() },
  { id: 'audit', label: () => m.settings_nav_pane_audit() },
] as const;

type PaneId = (typeof PANES)[number]['id'];

// Grouped sub-nav (Library / Processing / Application).
const NAV_GROUPS: { label: () => string; panes: PaneId[] }[] = [
  {
    label: () => m.settings_nav_group_library(),
    panes: [
      'sources',
      'equipment',
      'ingestion',
      'naming',
      'catalogs',
      'planner',
      'framing',
    ],
  },
  {
    label: () => m.settings_nav_group_processing(),
    panes: ['tools', 'cal', 'cleanup', 'source-views'],
  },
  {
    label: () => m.settings_nav_group_application(),
    panes: ['general', 'advanced', 'audit'],
  },
];

// Render-time thunks so pane titles/descriptions re-read the active locale (spec 046 #8).
const PANE_META: Record<PaneId, { title: () => string; desc: () => string }> = {
  sources: {
    title: () => m.settings_pane_sources_title(),
    desc: () => m.settings_pane_sources_desc(),
  },
  equipment: {
    title: () => m.settings_pane_equipment_title(),
    desc: () => m.settings_pane_equipment_desc(),
  },
  ingestion: {
    title: () => m.settings_pane_ingestion_title(),
    desc: () => m.settings_pane_ingestion_desc(),
  },
  naming: {
    title: () => m.settings_pane_naming_title(),
    desc: () => m.settings_pane_naming_desc(),
  },
  tools: {
    title: () => m.settings_pane_tools_title(),
    desc: () => m.settings_pane_tools_desc(),
  },
  cal: {
    title: () => m.settings_pane_cal_title(),
    desc: () => m.settings_pane_cal_desc(),
  },
  catalogs: {
    title: () => m.settings_pane_catalogs_title(),
    desc: () => m.settings_pane_catalogs_desc(),
  },
  planner: {
    title: () => m.settings_pane_planner_title(),
    desc: () => m.settings_pane_planner_desc(),
  },
  framing: {
    title: () => m.settings_pane_framing_title(),
    desc: () => m.settings_pane_framing_desc(),
  },
  cleanup: {
    title: () => m.settings_pane_cleanup_title(),
    desc: () => m.settings_pane_cleanup_desc(),
  },
  'source-views': {
    title: () => m.settings_pane_source_views_title(),
    desc: () => m.settings_pane_source_views_desc(),
  },
  general: {
    title: () => m.settings_pane_general_title(),
    desc: () => m.settings_pane_general_desc(),
  },
  advanced: {
    title: () => m.settings_pane_advanced_title(),
    desc: () => m.settings_pane_advanced_desc(),
  },
  audit: {
    title: () => m.settings_pane_audit_title(),
    desc: () => m.settings_pane_audit_desc(),
  },
};

function renderPane(
  paneId: PaneId,
  save: (scope: string, values: Record<string, unknown>) => void,
) {
  switch (paneId) {
    case 'sources':
      return <DataSources save={save} />;
    case 'equipment':
      return <Equipment save={save} />;
    case 'ingestion':
      return <Ingestion save={save} />;
    case 'naming':
      return <NamingStructure save={save} />;
    case 'tools':
      return <ProcessingTools />;
    case 'cal':
      return <CalibrationMatching save={save} />;
    case 'catalogs':
      return <ResolverSettings save={save} />;
    case 'planner':
      return <PlannerSettings />;
    case 'framing':
      return <Framing save={save} />;
    case 'cleanup':
      return <Cleanup save={save} />;
    case 'source-views':
      return <SourceViews save={save} />;
    case 'general':
      return <General />;
    case 'advanced':
      return <Advanced save={save} />;
    case 'audit':
      return <AuditLog />;
  }
}

// Owns the Settings surface's `LocaleProvider` (spec 061 T013): every pane's
// nav label/title/content is a descendant of `SettingsPageBody`, so wrapping
// there — rather than requiring a global app-root provider that doesn't
// exist yet — is enough for a language change made in Appearance (General.tsx)
// to re-render the whole pane live.
export function SettingsPage() {
  return (
    <LocaleProvider>
      <SettingsPageBody />
    </LocaleProvider>
  );
}

function SettingsPageBody() {
  // Subscribing here (not just inside General.tsx) is load-bearing, not
  // decorative: React only force-updates fibers that actually consume a
  // changed context, piercing past components that merely receive the same
  // `children` reference. Calling the hook makes THIS component itself a
  // consumer, so on `changeLocale()` it re-renders and freshly recreates its
  // nav items/pane content — which is what makes their `m.*()` calls
  // re-evaluate — rather than only the language control itself updating.
  useLocale();

  const params = useParams({ strict: false });
  // #799: the active pane is derived from the `/settings/$pane` URL param
  // rather than tracked in local state, so deep links and the address bar
  // stay in sync with the pane shown; nav clicks push a new `$pane` param.
  const activePane: PaneId =
    PANES.find((p) => p.id === params.pane)?.id ?? 'sources';
  const navigate = useNavigate();
  const { save, saved } = useAutoSave();
  const meta = PANE_META[activePane];

  const selectPane = (id: PaneId) => {
    void navigate({ to: '/settings/$pane', params: { pane: id } });
  };

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title={m.settings_page_title()}
            subtitle={meta.title()}
            right={
              saved && (
                <span
                  className="pv-settings__saved-indicator"
                  aria-live="polite"
                >
                  {m.settings_page_saved()}
                </span>
              )
            }
          />
        }
        list={
          <nav
            className="pv-settings__nav"
            aria-label={m.settings_page_nav_aria()}
          >
            {NAV_GROUPS.map((group) => (
              <div key={group.label()} className="pv-settings__nav-group">
                <div className="pv-settings__nav-group-label">
                  {group.label()}
                </div>
                {group.panes.map((paneId) => {
                  const pane = PANES.find((p) => p.id === paneId);
                  if (!pane) return null;
                  return (
                    <button
                      key={pane.id}
                      type="button"
                      className={`pv-settings__nav-item${activePane === pane.id ? ' pv-settings__nav-item--active' : ''}`}
                      data-testid="settings-nav-item"
                      onClick={() => selectPane(pane.id)}
                      aria-current={activePane === pane.id ? 'page' : undefined}
                    >
                      {pane.label()}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        }
        detail={
          <div className="pv-settings__content" data-testid="SettingsPage">
            {renderPane(activePane, save)}
          </div>
        }
      />
    </PageShell>
  );
}
