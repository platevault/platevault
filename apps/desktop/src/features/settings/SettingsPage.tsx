import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
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

const PANE_META: Record<PaneId, { title: string; desc: string }> = {
  sources: {
    title: 'Data Sources',
    desc: 'Library roots the app indexes. Files are read in read-only mode; nothing is modified outside an approved plan.',
  },
  equipment: {
    title: 'Equipment',
    desc: 'Cameras, telescopes, and optical trains used across your sessions.',
  },
  ingestion: {
    title: 'Ingestion',
    desc: 'Controls how the app scans source folders and groups newly discovered files.',
  },
  naming: {
    title: 'Naming & Structure',
    desc: 'Token patterns used when files are confirmed from Inbox to Inventory.',
  },
  tools: {
    title: 'Processing Tools',
    desc: 'Configure executable paths and directory templates for each processing tool.',
  },
  cal: {
    title: 'Calibration Matching',
    desc: 'Tolerances and requirements for automatic calibration frame matching.',
  },
  catalogs: {
    title: 'Target Catalogs',
    desc: 'Deep-sky catalogs used for target identification and alias resolution.',
  },
  cleanup: {
    title: 'Cleanup',
    desc: 'Default actions for each data type when a cleanup plan is generated after processing.',
  },
  general: {
    title: 'General',
    desc: 'Theme, font size, and display density preferences.',
  },
  advanced: {
    title: 'Advanced',
    desc: 'Logging level, database information, and reset options.',
  },
  audit: {
    title: 'Audit Log',
    desc: 'Searchable history of every state change, plan application, and system event.',
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
    case 'tools':     return <ProcessingTools save={save} />;
    case 'cal':       return <CalibrationMatching save={save} />;
    case 'catalogs':  return <Catalogs save={save} />;
    case 'cleanup':   return <Cleanup save={save} />;
    case 'general':   return <General />;
    case 'advanced':  return <Advanced save={save} />;
    case 'audit':     return <AuditLog />;
  }
}

export function SettingsPage() {
  const params = useParams({ strict: false }) as { pane?: string };
  const initialPane = PANES.find((p) => p.id === params.pane)?.id ?? 'sources';
  const [activePane, setActivePane] = useState<PaneId>(initialPane);
  const { save, saved } = useAutoSave();
  const meta = PANE_META[activePane];

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Settings"
            subtitle={meta.title}
            right={
              saved && (
                <span
                  style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-ok)' }}
                  aria-live="polite"
                >
                  Saved &#10003;
                </span>
              )
            }
          />
        }
        list={
          <nav className="alm-settings__nav" aria-label="Settings categories">
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
        }
        detail={
          <div className="alm-settings__content" data-testid="SettingsPage">
            <p className="alm-settings__desc">{meta.desc}</p>
            {renderPane(activePane, save)}
          </div>
        }
      />
    </PageShell>
  );
}
