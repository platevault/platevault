import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import clsx from 'clsx';
import { useAutoSave } from './useAutoSave';
import { DataSources } from './DataSources';
import { Equipment } from './Equipment';
import { Ingestion } from './Ingestion';
import { NamingStructure } from './NamingStructure';
import { ProcessingTools } from './ProcessingTools';
import { CalibrationMatching } from './CalibrationMatching';
import { Catalogs } from './Catalogs';
import { Cleanup } from './Cleanup';
import { General } from './General';
import { Advanced } from './Advanced';
import { AuditLog } from './AuditLog';

const PANES = [
  { id: 'sources', label: 'Data Sources' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'ingestion', label: 'Ingestion' },
  { id: 'naming', label: 'Naming & Structure' },
  { id: 'tools', label: 'Processing Tools' },
  { id: 'cal', label: 'Calibration Matching' },
  { id: 'catalogs', label: 'Target Catalogs' },
  { id: 'cleanup', label: 'Cleanup' },
  { id: 'general', label: 'General' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'audit', label: 'Audit Log' },
] as const;

type PaneId = (typeof PANES)[number]['id'];

const PANE_META: Record<PaneId, { title: string; sub?: string }> = {
  sources: {
    title: 'Data Sources',
    sub: 'Library roots the app indexes. Files are read in read-only mode; nothing is modified outside an approved plan.',
  },
  equipment: {
    title: 'Equipment',
    sub: 'Cameras, telescopes, optical trains, and filter libraries used across your sessions.',
  },
  ingestion: {
    title: 'Ingestion',
    sub: 'Controls how the app watches, scans, and groups newly discovered files.',
  },
  naming: {
    title: 'Naming & Structure',
    sub: 'Pattern used when files are confirmed from Inbox to Inventory.',
  },
  tools: {
    title: 'Processing Tools',
    sub: 'Configure executable paths and directory structure templates for each processing tool.',
  },
  cal: {
    title: 'Calibration Matching',
    sub: 'Tolerances and requirements for automatic calibration frame matching.',
  },
  catalogs: {
    title: 'Target Catalogs',
    sub: 'Deep-sky catalogs used for target identification and alias resolution.',
  },
  cleanup: {
    title: 'Cleanup',
    sub: 'Default actions for each data type when cleanup runs after processing.',
  },
  general: {
    title: 'General',
    sub: 'Theme, font size, and display density preferences.',
  },
  advanced: {
    title: 'Advanced',
    sub: 'Logging, diagnostics, and database information.',
  },
  audit: {
    title: 'Audit Log',
    sub: 'Searchable history of every state change, plan application, and system event.',
  },
};

function getPaneComponent(
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
      return <ProcessingTools save={save} />;
    case 'cal':
      return <CalibrationMatching save={save} />;
    case 'catalogs':
      return <Catalogs save={save} />;
    case 'cleanup':
      return <Cleanup />;
    case 'general':
      return <General />;
    case 'advanced':
      return <Advanced save={save} />;
    case 'audit':
      return <AuditLog />;
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
  const paneInfo = PANE_META[activePane];

  return (
    <div className="alm-settings" data-testid="SettingsPage">
      <nav
        className="alm-settings__rail"
        aria-label="Settings categories"
      >
        {PANES.map((pane) => (
          <button
            key={pane.id}
            type="button"
            className={clsx(
              'alm-settings__nav-item',
              activePane === pane.id && 'alm-settings__nav-item--active',
            )}
            onClick={() => setActivePane(pane.id)}
            aria-current={activePane === pane.id ? 'page' : undefined}
          >
            {pane.label}
          </button>
        ))}
      </nav>

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
