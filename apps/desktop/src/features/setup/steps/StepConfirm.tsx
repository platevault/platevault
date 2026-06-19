import type { ReactNode } from 'react';
import { Pill } from '@/ui/Pill';
import type { SourcesState } from '../sources-store';
import { SOURCE_KIND_LABELS, getMissingRequiredKinds, getSourcesByKind, ALL_SOURCE_KINDS } from '../sources-store';
import type { CatalogSettings } from './StepCatalogs';
import type { ToolsState } from './StepTools';

export interface StepConfirmProps {
  sources: SourcesState;
  /** Retained for wizard-state compatibility; not shown on Confirm. */
  catalogSettings: CatalogSettings;
  tools: ToolsState;
  isSubmitting: boolean;
}

const TOOL_LABELS: Record<keyof ToolsState, string> = {
  pixinsight: 'PixInsight',
  siril: 'Siril',
};

// A titled section, matching the Configuration step's layout (no card chrome).
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-3)' }}>
      <div
        style={{
          fontWeight: 'var(--alm-weight-semibold)',
          fontSize: 'var(--alm-text-sm)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Step 4 — Confirm.
 *
 * Summary of what setup will register (source folders + processing tools) and
 * what happens next, with blocked-finish when required folders are missing.
 * System settings (e.g. target resolution) are NOT shown here — they live in the
 * Configuration step / Settings.
 */
export function StepConfirm({
  sources,
  catalogSettings: _catalogSettings,
  tools,
  isSubmitting,
}: StepConfirmProps) {
  const missingKinds = getMissingRequiredKinds(sources);
  const totalFolders = sources.length;

  const enabledTools = (Object.keys(TOOL_LABELS) as Array<keyof ToolsState>).filter(
    (key) => tools[key].enabled,
  );

  const kindsWithFolders = ALL_SOURCE_KINDS.filter(
    (kind) => getSourcesByKind(sources, kind).length > 0,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-5)' }}>
      <Section title={`Source folders (${totalFolders} folder${totalFolders !== 1 ? 's' : ''})`}>
        {kindsWithFolders.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-4)' }}>
            {kindsWithFolders.map((kind) => (
              <div
                key={kind}
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)' }}
              >
                <div
                  style={{
                    fontSize: 'var(--alm-text-2xs)',
                    fontWeight: 'var(--alm-weight-semibold)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'var(--alm-text-muted)',
                  }}
                >
                  {SOURCE_KIND_LABELS[kind]}
                </div>
                {getSourcesByKind(sources, kind).map((entry, j) => (
                  <div
                    key={j}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--alm-sp-3)',
                    }}
                  >
                    <span
                      className="alm-mono"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 'var(--alm-text-sm)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.path}
                    </span>
                    <span
                      style={{
                        whiteSpace: 'nowrap',
                        fontSize: 'var(--alm-text-xs)',
                        color: 'var(--alm-text-muted)',
                      }}
                    >
                      {entry.scanDepth === 'recursive' ? 'Recursive' : 'Single level'}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
            No folders configured (you can add them later in Settings).
          </div>
        )}
      </Section>

      <Section title={`Processing tools (${enabledTools.length} enabled)`}>
        {enabledTools.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-2)' }}>
            {enabledTools.map((key) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--alm-sp-3)',
                }}
              >
                <span style={{ fontWeight: 'var(--alm-weight-semibold)' }}>{TOOL_LABELS[key]}</span>
                {tools[key].path ? (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--alm-sp-2)',
                      minWidth: 0,
                    }}
                  >
                    <span
                      className="alm-mono"
                      style={{
                        fontSize: 'var(--alm-text-xs)',
                        color: 'var(--alm-text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tools[key].path}
                    </span>
                    <Pill variant="ok">OK</Pill>
                  </span>
                ) : (
                  <Pill variant="warn">No path set</Pill>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
            No tools enabled.
          </div>
        )}
      </Section>

      <Section title="What happens next">
        <ul
          style={{
            margin: 0,
            paddingLeft: 'var(--alm-sp-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--alm-sp-1)',
            fontSize: 'var(--alm-text-sm)',
          }}
        >
          <li>Your selected folders are registered as library roots.</li>
          <li>An initial scan runs after setup, reading file headers to build the index.</li>
          <li>Light frames are grouped into acquisition sessions.</li>
        </ul>
        <div
          style={{
            fontSize: 'var(--alm-text-sm)',
            color: 'var(--alm-text-muted)',
          }}
        >
          <strong>Nothing is moved or modified.</strong> The scan only reads file headers and
          builds an index — your files stay exactly where they are.
        </div>
      </Section>

      {missingKinds.length > 0 && (
        <div className="alm-step-confirm__blocked" role="alert">
          Cannot complete setup: missing required folder types —{' '}
          {missingKinds.map((k) => SOURCE_KIND_LABELS[k]).join(', ')}. Go back to Step 1 to add
          them.
        </div>
      )}

      {isSubmitting && (
        <div style={{ color: 'var(--alm-text-muted)', fontSize: 'var(--alm-text-sm)' }}>
          Registering roots and starting scan…
        </div>
      )}
    </div>
  );
}
