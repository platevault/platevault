import { Pill } from '@/ui/Pill';
import { Box } from '@/ui/Box';
import type { SourcesState, SourceKind } from '../sources-store';
import { SOURCE_KIND_LABELS, getMissingRequiredKinds, getSourcesByKind, ALL_SOURCE_KINDS } from '../sources-store';
import type { CatalogSettings } from './StepCatalogs';
import type { ToolsState } from './StepTools';

export interface StepConfirmProps {
  sources: SourcesState;
  catalogSettings: CatalogSettings;
  tools: ToolsState;
  isSubmitting: boolean;
}

const CATALOG_LABELS: Record<keyof CatalogSettings, string> = {
  messier: 'Messier',
  ngcIc: 'NGC / IC',
  caldwell: 'Caldwell',
  sharpless: 'Sharpless',
  abell: 'Abell',
};

const TOOL_LABELS: Record<keyof ToolsState, string> = {
  pixinsight: 'PixInsight',
  siril: 'Siril',
};

/**
 * Step 4 -- Confirm.
 * Summary of all configuration with blocked-finish logic when required
 * folders are missing.
 */
export function StepConfirm({
  sources,
  catalogSettings,
  tools,
  isSubmitting,
}: StepConfirmProps) {
  const missingKinds = getMissingRequiredKinds(sources);
  const totalFolders = sources.length;

  const enabledCatalogs = (Object.keys(CATALOG_LABELS) as Array<keyof CatalogSettings>)
    .filter((key) => catalogSettings[key]);

  const enabledTools = (Object.keys(TOOL_LABELS) as Array<keyof ToolsState>)
    .filter((key) => tools[key].enabled);

  // Group sources by kind for display
  const kindsWithFolders = ALL_SOURCE_KINDS.filter(
    (kind) => getSourcesByKind(sources, kind).length > 0,
  );

  return (
    <div className="alm-step-confirm">
      {/* Sources summary */}
      <Box heading={`Library sources (${totalFolders} folder${totalFolders !== 1 ? 's' : ''})`}>
        <div className="alm-step-confirm__sources">
          {kindsWithFolders.map((kind) => {
            const kindEntries = getSourcesByKind(sources, kind);
            return (
              <div key={kind} className="alm-step-confirm__source-group">
                <div className="alm-step-confirm__source-kind">
                  {SOURCE_KIND_LABELS[kind]}
                </div>
                {kindEntries.map((entry, j) => (
                  <div key={j} className="alm-step-confirm__source-entry">
                    <span className="alm-step-confirm__source-path">
                      {entry.path}
                    </span>
                    <Pill label="Not scanned" variant="neutral" size="sm" />
                    <span className="alm-step-confirm__source-depth">
                      {entry.scanDepth === 'recursive' ? 'Recursive' : 'Single level'}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          {kindsWithFolders.length === 0 && (
            <div className="alm-step-confirm__empty">
              No folders configured (you can add them later in Settings)
            </div>
          )}
        </div>
      </Box>

      {/* Tools summary */}
      <Box heading={`Processing tools (${enabledTools.length} enabled)`}>
        <div className="alm-step-confirm__tools">
          {enabledTools.length > 0 ? (
            enabledTools.map((key) => (
              <div key={key} className="alm-step-confirm__tool-entry">
                <span className="alm-step-confirm__tool-name">{TOOL_LABELS[key]}</span>
                {tools[key].path ? (
                  <>
                    <span className="alm-step-confirm__tool-path">{tools[key].path}</span>
                    <Pill label="OK" variant="ok" size="sm" />
                  </>
                ) : (
                  <Pill label="No path set" variant="warn" size="sm" />
                )}
              </div>
            ))
          ) : (
            <span className="alm-step-confirm__muted">No tools enabled</span>
          )}
        </div>
      </Box>

      {/* Catalogs summary */}
      <Box heading={`Target catalogs (${enabledCatalogs.length} enabled)`}>
        <div className="alm-step-confirm__catalogs">
          {enabledCatalogs.length > 0
            ? enabledCatalogs.map((k) => CATALOG_LABELS[k]).join(', ')
            : 'No catalogs selected'}
        </div>
      </Box>

      {/* What happens next */}
      <Box heading="What happens next">
        <div className="alm-step-confirm__next">
          <p>When you complete setup, the app will:</p>
          <ul className="alm-step-confirm__next-list">
            <li>Register all selected folders as library roots</li>
            <li>Initial scan will begin after setup</li>
            <li>Extract metadata from every file header</li>
            <li>Group light frames into acquisition sessions</li>
          </ul>
          <div className="alm-step-confirm__safety-note">
            <strong>Nothing is moved or modified.</strong> The scan only reads file
            headers and builds an index. Your files stay exactly where they are.
          </div>
        </div>
      </Box>

      {/* Blocked-finish warning */}
      {missingKinds.length > 0 && (
        <div className="alm-step-confirm__blocked">
          Cannot complete setup: missing required folder types —{' '}
          {missingKinds.map((k) => SOURCE_KIND_LABELS[k]).join(', ')}.
          Go back to Step 1 to add them.
        </div>
      )}

      {isSubmitting && (
        <div className="alm-step-confirm__submitting">
          Registering roots and starting scan...
        </div>
      )}
    </div>
  );
}
