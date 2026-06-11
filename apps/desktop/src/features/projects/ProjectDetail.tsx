/**
 * ProjectDetail — spec 008 wired.
 *
 * Loads project detail via useProjectDetail(id) from the real DB.
 * Renders sources, channels (with drift banner), and basic metadata.
 * Edit entry point opens EditProjectPane.
 */

import { useState } from 'react';
import {
  DetailHeader,
  DetailPane,
  MetricLine,
  DetailGrid,
  Rail,
  RailCard,
  Lifecycle,
} from '@/components';
import { Pill, Btn, Section, Banner } from '@/ui';
import type { PillVariant } from '@/ui';
import { projectStateLabel, projectStateVariant } from '@/lib/lifecycle';
import { useProjectDetail, useDismissChannelDrift, useReinferChannels } from './store';
import { EditProjectPane } from './edit/EditProjectPane';
import { addToast } from '@/shared/toast';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sourceTypeVariant(filter: string): PillVariant {
  const lower = filter.toLowerCase();
  if (lower === 'ha') return 'danger';
  if (lower === 'oiii') return 'info';
  if (lower === 'sii') return 'warn';
  if (lower === 'l' || lower === 'lum') return 'neutral';
  return 'ghost';
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface ProjectDetailContentProps {
  projectId: string;
}

/** Alias export for backward compatibility (smoke tests, index.ts). */
export { ProjectDetailContent as ProjectDetail };

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectDetailContent({ projectId }: ProjectDetailContentProps) {
  const { data: project, loading, error } = useProjectDetail(projectId);
  const [editOpen, setEditOpen] = useState(false);
  const [channelWorking, setChannelWorking] = useState(false);

  if (loading && !project) {
    return (
      <DetailPane fill>
        <div style={{ padding: 'var(--alm-sp-4)', color: 'var(--alm-color-muted)' }}>
          Loading project…
        </div>
      </DetailPane>
    );
  }

  if (error || !project) {
    return (
      <DetailPane fill>
        <Banner variant="danger">Could not load project.</Banner>
      </DetailPane>
    );
  }

  const toolLabel =
    typeof project.tool === 'string' ? project.tool : 'Unknown tool';
  const lifecycle =
    typeof project.lifecycle === 'string' ? project.lifecycle : 'setup_incomplete';

  const handleReinfer = async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await useReinferChannels({ requestId: crypto.randomUUID(), projectId });
    } catch {
      addToast({ message: 'Re-infer failed.', variant: 'error' });
    } finally {
      setChannelWorking(false);
    }
  };

  const handleDismissDrift = async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await useDismissChannelDrift({ requestId: crypto.randomUUID(), projectId });
    } catch {
      addToast({ message: 'Dismiss failed.', variant: 'error' });
    } finally {
      setChannelWorking(false);
    }
  };

  return (
    <DetailPane fill>
      <DetailHeader
        title={project.name}
        titleExtra={
          <Pill variant={projectStateVariant(lifecycle)}>
            {projectStateLabel(lifecycle)}
          </Pill>
        }
        subtitle={project.path}
        actions={
          lifecycle !== 'archived' && (
            <Btn size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
              Edit
            </Btn>
          )
        }
      />

      {/* Channel drift banner (US1c / US4) */}
      {project.channelDrift?.hasNewSources && (
        <Banner variant="warn" role="status" aria-live="polite">
          <span>New sources added since last channel review.</span>
          <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', marginTop: 'var(--alm-sp-2)' }}>
            <Btn size="sm" variant="primary" onClick={handleReinfer} disabled={channelWorking}>
              Re-infer channels
            </Btn>
            <Btn size="sm" variant="ghost" onClick={handleDismissDrift} disabled={channelWorking}>
              Dismiss
            </Btn>
          </div>
        </Banner>
      )}

      <MetricLine
        metrics={[
          { value: project.sources.length, label: 'sources' },
          { value: project.channels?.length ?? 0, label: 'channels' },
          { value: toolLabel, label: 'tool' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title="Lifecycle">
              <Lifecycle state={lifecycle} />
            </RailCard>
            {project.channels && project.channels.length > 0 && (
              <RailCard title="Channels">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--alm-sp-1)' }}>
                  {project.channels.map((ch) => (
                    <span
                      key={ch.label}
                      title={ch.source === 'inferred' ? 'Auto-inferred' : 'Manually added'}
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 'var(--alm-text-xs)',
                        background: ch.source === 'inferred'
                          ? 'var(--alm-color-muted-bg)'
                          : 'var(--alm-color-accent-bg)',
                      }}
                    >
                      {ch.label}
                      {ch.source === 'inferred' && (
                        <span style={{ marginLeft: 4, opacity: 0.6, fontSize: '0.75em' }}>Auto</span>
                      )}
                    </span>
                  ))}
                </div>
              </RailCard>
            )}
          </Rail>
        }
      >
        {/* Sources section */}
        <Section title="Sources" count={project.sources.length}>
          {project.sources.length === 0 ? (
            <div style={{ padding: 'var(--alm-sp-2)', color: 'var(--alm-color-muted)' }}>
              No sources linked yet.
            </div>
          ) : (
            project.sources.map((src) => (
              <div
                key={src.inventoryId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--alm-sp-2)',
                  padding: 'var(--alm-sp-1) 0',
                  borderBottom: '1px solid var(--alm-border)',
                }}
              >
                {src.filter && (
                  <Pill variant={sourceTypeVariant(src.filter)}>{src.filter}</Pill>
                )}
                <span style={{ flex: 1 }}>{src.name || src.inventoryId}</span>
                {src.frames > 0 && (
                  <span style={{ color: 'var(--alm-color-muted)', fontSize: 'var(--alm-text-xs)' }}>
                    {src.frames} frames
                  </span>
                )}
              </div>
            ))
          )}
        </Section>

        {/* Notes section */}
        {project.notes && (
          <Section title="Notes">
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--alm-text-sm)' }}>
              {project.notes}
            </div>
          </Section>
        )}
      </DetailGrid>

      {/* Edit pane overlay */}
      {editOpen && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--alm-surface)',
            zIndex: 10,
            overflow: 'auto',
          }}
        >
          <EditProjectPane project={project} onClose={() => setEditOpen(false)} />
        </div>
      )}
    </DetailPane>
  );
}
