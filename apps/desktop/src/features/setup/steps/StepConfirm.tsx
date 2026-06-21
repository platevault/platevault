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
    <div className="alm-setup-confirm__section">
      <div className="alm-setup-confirm__section-title">
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
    <div className="alm-setup-confirm">
      <Section title={`Source folders (${totalFolders} folder${totalFolders !== 1 ? 's' : ''})`}>
        {kindsWithFolders.length > 0 ? (
          <div className="alm-setup-confirm__kind-list">
            {kindsWithFolders.map((kind) => (
              <div
                key={kind}
                className="alm-setup-confirm__kind-group"
              >
                <div className="alm-setup-confirm__kind-label">
                  {SOURCE_KIND_LABELS[kind]}
                </div>
                {getSourcesByKind(sources, kind).map((entry, j) => (
                  <div
                    key={j}
                    className="alm-setup-confirm__row"
                  >
                    <span
                      className="alm-mono alm-setup-confirm__path"
                    >
                      {entry.path}
                    </span>
                    <span className="alm-setup-confirm__scan-depth">
                      {entry.scanDepth === 'recursive' ? 'Recursive' : 'Single level'}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="alm-setup-confirm__empty">
            No folders configured (you can add them later in Settings).
          </div>
        )}
      </Section>

      <Section title={`Processing tools (${enabledTools.length} enabled)`}>
        {enabledTools.length > 0 ? (
          <div className="alm-setup-confirm__tool-list">
            {enabledTools.map((key) => (
              <div
                key={key}
                className="alm-setup-confirm__row"
              >
                <span className="alm-setup-confirm__tool-name">{TOOL_LABELS[key]}</span>
                {tools[key].path ? (
                  <span className="alm-setup-confirm__tool-path-wrap">
                    <span className="alm-mono alm-setup-confirm__tool-path">
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
          <div className="alm-setup-confirm__empty">
            No tools enabled.
          </div>
        )}
      </Section>

      <Section title="What happens next">
        <ul className="alm-setup-confirm__next-list">
          <li>Your selected folders are registered as library roots.</li>
          <li>An initial scan runs after setup, reading file headers to build the index.</li>
          <li>Light frames are grouped into acquisition sessions.</li>
        </ul>
        <div className="alm-setup-confirm__note">
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
        <div className="alm-setup-confirm__note">
          Registering roots and starting scan…
        </div>
      )}
    </div>
  );
}
