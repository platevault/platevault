import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useAutoSave } from './useAutoSave';
import { DataSources } from './DataSources';
import { NamingStructure } from './NamingStructure';
import { SourceViewStrategy } from './SourceViewStrategy';
import { CleanupPolicy } from './CleanupPolicy';
import { Equipment } from './Equipment';
import { Tools } from './Tools';
import { LogSettings } from './LogSettings';
import { Catalogs } from './Catalogs';
import { Protection } from './Protection';
import { DisplayPane } from './DisplayPane';

const PANES = [
  { id: 'sources', label: 'Data sources' },
  { id: 'ingest', label: 'Ingestion & review' },
  { id: 'naming', label: 'Naming & structure' },
  { id: 'views', label: 'Source view strategy' },
  { id: 'cal', label: 'Calibration matching' },
  { id: 'tools', label: 'Tool workflows' },
  { id: 'catalogs', label: 'Target catalogs' },
  { id: 'protect', label: 'Source protection' },
  { id: 'cleanup', label: 'Cleanup & archive' },
  { id: 'log', label: 'Application log' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'adv', label: 'Advanced / developer' },
] as const;

type PaneId = (typeof PANES)[number]['id'];

const PANE_TITLES: Record<PaneId, { title: string; sub?: string }> = {
  sources: {
    title: 'Data sources',
    sub: 'Library roots the app indexes. Files are read in read-only mode; nothing is modified outside an approved plan.',
  },
  ingest: { title: 'Ingestion & review' },
  naming: {
    title: 'Naming & Structure',
    sub: 'Pattern used when files are confirmed from Inbox to Inventory.',
  },
  views: {
    title: 'Source view strategy',
    sub: 'How the app generates tool-friendly projections of your source map. Picked per project at creation, with this as the default.',
  },
  cal: { title: 'Calibration matching' },
  tools: { title: 'Tool workflows' },
  catalogs: { title: 'Target catalogs' },
  protect: { title: 'Source protection' },
  cleanup: {
    title: 'Cleanup & archive policy',
    sub: 'What happens to each kind of data when cleanup runs. Policies vary by processing tool because different tools produce different intermediates.',
  },
  log: { title: 'Application log' },
  appearance: { title: 'Appearance' },
  adv: { title: 'Advanced / developer' },
};

function getPaneComponent(
  paneId: PaneId,
  save: (scope: string, values: Record<string, unknown>) => void,
) {
  switch (paneId) {
    case 'sources':
      return <DataSources save={save} />;
    case 'naming':
      return <NamingStructure save={save} />;
    case 'views':
      return <SourceViewStrategy save={save} />;
    case 'cleanup':
      return <CleanupPolicy save={save} />;
    case 'cal':
      return <Equipment save={save} />;
    case 'tools':
      return <Tools save={save} />;
    case 'log':
      return <LogSettings save={save} />;
    case 'catalogs':
      return <Catalogs save={save} />;
    case 'protect':
      return <Protection save={save} />;
    case 'appearance':
      return <DisplayPane />;
    default:
      return (
        <div className="alm-empty">
          This pane is not yet implemented.
        </div>
      );
  }
}

export function SettingsPage() {
  const params = useParams({ strict: false }) as { pane?: string };
  const initialPane =
    PANES.find((p) => p.id === params.pane)?.id ?? 'sources';
  const [activePane, setActivePane] = useState<PaneId>(initialPane);
  const { save, saved } = useAutoSave();
  const paneInfo = PANE_TITLES[activePane];

  return (
    <div className="alm-settings" data-testid="SettingsPage">
      {/* Left rail nav */}
      <nav
        className="alm-settings__rail"
        aria-label="Settings categories"
      >
        {PANES.map((pane) => (
          <button
            key={pane.id}
            type="button"
            className={`alm-settings__nav-item${activePane === pane.id ? ' alm-settings__nav-item--active' : ''}`}
            onClick={() => setActivePane(pane.id)}
            aria-current={activePane === pane.id ? 'page' : undefined}
          >
            {pane.label}
          </button>
        ))}
      </nav>

      {/* Right content pane */}
      <div className="alm-settings__content">
        <div className="alm-settings__pane-header">
          <h2 className="alm-settings__pane-title">{paneInfo.title}</h2>
          {saved && (
            <span className="alm-settings__saved" aria-live="polite">
              Saved &#10003;
            </span>
          )}
        </div>
        {paneInfo.sub && (
          <p className="alm-settings__pane-sub">{paneInfo.sub}</p>
        )}
        <div className="alm-settings__pane-body">
          {getPaneComponent(activePane, save)}
        </div>
      </div>
    </div>
  );
}
