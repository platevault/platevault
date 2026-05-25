import { useParams } from '@tanstack/react-router';
import { Tabs } from '@base-ui-components/react/tabs';
import { useAutoSave } from './useAutoSave';
import { DataSources } from './DataSources';
import { NamingStructure } from './NamingStructure';
import { SourceViewStrategy } from './SourceViewStrategy';
import { CleanupPolicy } from './CleanupPolicy';
import { RootRecovery } from './RootRecovery';
import { Equipment } from './Equipment';
import { Tools } from './Tools';
import { LogSettings } from './LogSettings';
import { Catalogs } from './Catalogs';
import { Protection } from './Protection';
import { DisplayPane } from './DisplayPane';

const PANES = [
  { id: 'data-sources', label: 'Data Sources' },
  { id: 'naming', label: 'Naming Structure' },
  { id: 'source-view', label: 'Source View Strategy' },
  { id: 'cleanup', label: 'Cleanup Policy' },
  { id: 'root-recovery', label: 'Root Recovery' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'tools', label: 'Tools' },
  { id: 'logs', label: 'Log Settings' },
  { id: 'catalogs', label: 'Catalogs' },
  { id: 'protection', label: 'Protection' },
  { id: 'display', label: 'Display' },
] as const;

type PaneId = (typeof PANES)[number]['id'];

function getPaneComponent(paneId: PaneId, save: (scope: string, values: Record<string, unknown>) => void) {
  switch (paneId) {
    case 'data-sources':
      return <DataSources save={save} />;
    case 'naming':
      return <NamingStructure save={save} />;
    case 'source-view':
      return <SourceViewStrategy save={save} />;
    case 'cleanup':
      return <CleanupPolicy save={save} />;
    case 'root-recovery':
      return <RootRecovery />;
    case 'equipment':
      return <Equipment save={save} />;
    case 'tools':
      return <Tools save={save} />;
    case 'logs':
      return <LogSettings save={save} />;
    case 'catalogs':
      return <Catalogs save={save} />;
    case 'protection':
      return <Protection save={save} />;
    case 'display':
      return <DisplayPane />;
  }
}

export function SettingsPage() {
  const params = useParams({ strict: false }) as { pane?: string };
  const initialPane = PANES.find((p) => p.id === params.pane)?.id ?? 'data-sources';
  const { save, saved } = useAutoSave();

  return (
    <Tabs.Root
      defaultValue={initialPane}
      orientation="vertical"
      className="alm-settings"
      data-testid="SettingsPage"
    >
      {/* Left rail */}
      <Tabs.List className="alm-settings__rail" aria-label="Settings categories">
        {PANES.map((pane) => (
          <Tabs.Tab
            key={pane.id}
            value={pane.id}
            className="alm-settings__nav-item"
          >
            {pane.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>

      {/* Right content */}
      <div className="alm-settings__content">
        <div className="alm-settings__header">
          {saved && (
            <span className="alm-settings__saved" aria-live="polite">
              Saved &#10003;
            </span>
          )}
        </div>
        {PANES.map((pane) => (
          <Tabs.Panel key={pane.id} value={pane.id} className="alm-settings__body">
            {getPaneComponent(pane.id, save)}
          </Tabs.Panel>
        ))}
      </div>
    </Tabs.Root>
  );
}
