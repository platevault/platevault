import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { m } from '@/lib/i18n';
import { useAutoSave } from './useAutoSave';
import { DataSources } from './DataSources';
import { Equipment } from './Equipment';
import { Ingestion } from './Ingestion';
import { NamingStructure } from './NamingStructure';
import { ProcessingTools } from './ProcessingTools';
import { CalibrationMatching } from './CalibrationMatching';
import { ResolverSettings } from './ResolverSettings';
import { PlannerSettings } from './PlannerSettings';
import { Cleanup } from './Cleanup';
import { General } from './General';
import { Advanced } from './Advanced';
import { AuditLog } from './AuditLog';

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
  { id: 'cleanup', label: () => m.settings_nav_pane_cleanup() },
  { id: 'general', label: () => m.settings_nav_pane_general() },
  { id: 'advanced', label: () => m.settings_nav_pane_advanced() },
  { id: 'audit', label: () => m.settings_nav_pane_audit() },
] as const;

type PaneId = (typeof PANES)[number]['id'];

// Grouped sub-nav (Library / Processing / Application).
const NAV_GROUPS: { label: () => string; panes: PaneId[] }[] = [
  { label: () => m.settings_nav_group_library(), panes: ['sources', 'equipment', 'ingestion', 'naming', 'catalogs', 'planner'] },
  { label: () => m.settings_nav_group_processing(), panes: ['tools', 'cal', 'cleanup'] },
  { label: () => m.settings_nav_group_application(), panes: ['general', 'advanced', 'audit'] },
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
  cleanup: {
    title: () => m.settings_pane_cleanup_title(),
    desc: () => m.settings_pane_cleanup_desc(),
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
    case 'sources':   return <DataSources save={save} />;
    case 'equipment': return <Equipment save={save} />;
    case 'ingestion': return <Ingestion save={save} />;
    case 'naming':    return <NamingStructure save={save} />;
    case 'tools':     return <ProcessingTools />;
    case 'cal':       return <CalibrationMatching save={save} />;
    case 'catalogs':  return <ResolverSettings save={save} />;
    case 'planner':   return <PlannerSettings />;
    case 'cleanup':   return <Cleanup save={save} />;
    case 'general':   return <General />;
    case 'advanced':  return <Advanced save={save} />;
    case 'audit':     return <AuditLog />;
  }
}

export function SettingsPage() {
  const params = useParams({ strict: false });
  const initialPane = PANES.find((p) => p.id === params.pane)?.id ?? 'sources';
  const [activePane, setActivePane] = useState<PaneId>(initialPane);
  const { save, saved } = useAutoSave();
  const meta = PANE_META[activePane];

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
                  className="alm-settings__saved-indicator"
                  aria-live="polite"
                >
                  {m.settings_page_saved()}
                </span>
              )
            }
          />
        }
        list={
          <nav className="alm-settings__nav" aria-label={m.settings_page_nav_aria()}>
            {NAV_GROUPS.map((group) => (
              <div key={group.label()} className="alm-settings__nav-group">
                <div className="alm-settings__nav-group-label">{group.label()}</div>
                {group.panes.map((paneId) => {
                  const pane = PANES.find((p) => p.id === paneId);
                  if (!pane) return null;
                  return (
                    <button
                      key={pane.id}
                      type="button"
                      className={`alm-settings__nav-item${activePane === pane.id ? ' alm-settings__nav-item--active' : ''}`}
                      onClick={() => setActivePane(pane.id)}
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
          <div className="alm-settings__content" data-testid="SettingsPage">
            {renderPane(activePane, save)}
          </div>
        }
      />
    </PageShell>
  );
}
