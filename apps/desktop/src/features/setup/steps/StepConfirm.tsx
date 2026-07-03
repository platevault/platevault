import type { ReactNode } from 'react';
import { Pill } from '@/ui/Pill';
import { m } from '@/lib/i18n';
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

// Values are render-time thunks so labels re-read the active locale (spec 046 #8).
const TOOL_LABELS: Record<keyof ToolsState, () => string> = {
  pixinsight: () => m.setup_tools_pixinsight_name(),
  siril: () => m.setup_tools_siril_name(),
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
      <Section title={m.setup_confirm_source_folders_title({ count: totalFolders })}>
        {kindsWithFolders.length > 0 ? (
          <div className="alm-setup-confirm__kind-list">
            {kindsWithFolders.map((kind) => (
              <div
                key={kind}
                className="alm-setup-confirm__kind-group"
              >
                <div className="alm-setup-confirm__kind-label">
                  {SOURCE_KIND_LABELS[kind]()}
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
                      {entry.scanDepth === 'recursive'
                        ? m.setup_scan_recursive()
                        : m.setup_scan_single_level()}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="alm-setup-confirm__empty">
            {m.setup_confirm_no_folders()}
          </div>
        )}
      </Section>

      <Section title={m.setup_confirm_tools_enabled_title({ count: enabledTools.length })}>
        {enabledTools.length > 0 ? (
          <div className="alm-setup-confirm__tool-list">
            {enabledTools.map((key) => (
              <div
                key={key}
                className="alm-setup-confirm__row"
              >
                <span className="alm-setup-confirm__tool-name">{TOOL_LABELS[key]()}</span>
                {tools[key].path ? (
                  <span className="alm-setup-confirm__tool-path-wrap">
                    <span className="alm-mono alm-setup-confirm__tool-path">
                      {tools[key].path}
                    </span>
                    <Pill variant="ok">{m.setup_tools_ok()}</Pill>
                  </span>
                ) : (
                  <Pill variant="warn">{m.setup_tools_no_path()}</Pill>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="alm-setup-confirm__empty">
            {m.setup_confirm_no_tools()}
          </div>
        )}
      </Section>

      <Section title={m.setup_confirm_what_next_title()}>
        <ul className="alm-setup-confirm__next-list">
          <li>{m.setup_confirm_next_roots()}</li>
          <li>{m.setup_confirm_next_scan()}</li>
          <li>{m.setup_confirm_next_sessions()}</li>
        </ul>
        <div className="alm-setup-confirm__note">
          <strong>{m.setup_confirm_safe_bold()}</strong> {m.setup_confirm_safe_body()}
        </div>
      </Section>

      {missingKinds.length > 0 && (
        <div className="alm-step-confirm__blocked" role="alert">
          {m.setup_confirm_blocked({ kinds: missingKinds.map((k) => SOURCE_KIND_LABELS[k]()).join(', ') })}
        </div>
      )}

      {isSubmitting && (
        <div className="alm-setup-confirm__note">
          {m.setup_confirm_registering()}
        </div>
      )}
    </div>
  );
}
