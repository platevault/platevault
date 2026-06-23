/**
 * Tool Launches accordion — spec 012 T023/T024/T025.
 *
 * Renders observed processing artifacts grouped by tool launch.
 * - Attributed groups show under the matching launch.
 * - Unattributed artifacts collect under an "Unattributed" group.
 * - Missing artifacts show a strikethrough + "Missing" badge + "Mark resolved" button.
 * - Manual-override artifacts show a "(manual)" indicator.
 *
 * Data flows: useArtifacts(projectId) → groupArtifactsByLaunch() → render.
 */

import { useCallback } from 'react';
import { basename } from 'pathe';
import { m } from '@/lib/i18n';
import type { ArtifactSummary } from '@/api/commands';
import {
  groupArtifactsByLaunch,
  useArtifacts,
  useArtifactMarkResolved,
  type ArtifactGroup,
} from './artifacts';

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  /** Optional ordered list of launch ids (newest first) for bucket ordering. */
  launchOrder?: string[];
}

// ── ArtifactRow ───────────────────────────────────────────────────────────────

interface ArtifactRowProps {
  artifact: ArtifactSummary;
  projectId: string;
  onResolved: () => void;
}

function ArtifactRow({ artifact, projectId, onResolved }: ArtifactRowProps) {
  const { working, markResolved } = useArtifactMarkResolved(onResolved);
  const isMissing = artifact.state === 'missing';
  const isManualOverride = artifact.classificationSource === 'manual_override';
  const isFallback = artifact.classificationSource === 'fallback';

  const handleMarkResolved = useCallback(() => {
    void markResolved(projectId, artifact.id);
  }, [markResolved, projectId, artifact.id]);

  // `pathe.basename` is cross-platform (handles both `/` and `\` separators),
  // unlike the prior forward-slash-only split. Falls back to the full path when
  // basename yields an empty string.
  const fileName = basename(artifact.path) || artifact.path;

  return (
    <div
      className="artifact-row alm-tool-launches__artifact-row"
      data-state={artifact.state}
      data-kind={artifact.kind}
    >
      {/* Kind badge */}
      <span
        className={`artifact-kind-badge artifact-kind-${artifact.kind} alm-tool-launches__kind-badge`}
        title={`${artifact.kind}${isFallback ? ' (low confidence)' : ''}`}
        // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional opacity for low-confidence fallback badge
        style={{ opacity: isFallback ? 0.6 : 1 }}
      >
        {artifact.kind}
      </span>

      {/* File name — strikethrough when missing */}
      <span
        className="artifact-file-name alm-tool-launches__file-name"
        // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional strikethrough + opacity for missing artifact
        style={{
          textDecoration: isMissing ? 'line-through' : 'none',
          opacity: isMissing ? 0.5 : 1,
        }}
        title={artifact.path}
      >
        {fileName}
      </span>

      {/* Status badges */}
      {isMissing && (
        <span className="artifact-badge artifact-badge-missing alm-tool-launches__badge-missing">
          {m.settings_tools_missing()}
        </span>
      )}

      {isManualOverride && (
        <span
          className="artifact-badge artifact-badge-manual alm-tool-launches__badge-manual"
          title={m.projects_artifacts_manual_override_title()}
        >
          {m.projects_artifacts_manual_badge()}
        </span>
      )}

      {/* Mark resolved affordance (T024) */}
      {isMissing && (
        <button
          type="button"
          className="artifact-mark-resolved-btn alm-tool-launches__resolve-btn"
          onClick={handleMarkResolved}
          disabled={working}
          aria-label={m.projects_mark_resolved_aria({ file: fileName })}
        >
          {working ? m.common_resolving() : m.projects_mark_resolved()}
        </button>
      )}
    </div>
  );
}

// ── ArtifactGroupSection ──────────────────────────────────────────────────────

interface GroupSectionProps {
  group: ArtifactGroup;
  projectId: string;
  onAction: () => void;
}

function ArtifactGroupSection({ group, projectId, onAction }: GroupSectionProps) {
  const label = group.toolLaunchId ? `Launch ${group.toolLaunchId.slice(0, 8)}…` : 'Unattributed';
  const counts = group.artifacts.reduce(
    (acc, a) => {
      acc[a.kind] = (acc[a.kind] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const countBadge = Object.entries(counts)
    .map(([kind, n]) => `${n} ${kind}`)
    .join(', ');

  return (
    <div className="artifact-group alm-tool-launches__group">
      <div className="artifact-group-header alm-tool-launches__group-header">
        <span className="alm-tool-launches__group-label">{label}</span>
        <span
          className="artifact-count-badge alm-tool-launches__count-badge"
          title={countBadge}
        >
          {group.artifacts.length}
        </span>
      </div>

      {group.artifacts.map((artifact) => (
        <ArtifactRow
          key={artifact.id}
          artifact={artifact}
          projectId={projectId}
          onResolved={onAction}
        />
      ))}
    </div>
  );
}

// ── ToolLaunchesAccordion ─────────────────────────────────────────────────────

/** Renders the "Tool Launches" accordion section of the project drawer (T023). */
export function ToolLaunchesAccordion({ projectId, launchOrder = [] }: Props) {
  const { artifacts, loading, error, reload } = useArtifacts(projectId);
  const groups = groupArtifactsByLaunch(artifacts, launchOrder);

  if (loading) {
    return <div className="tool-launches-loading alm-tool-launches__loading">{m.projects_artifacts_loading()}</div>;
  }

  if (error) {
    return (
      <div className="tool-launches-error alm-tool-launches__error">
        {m.projects_artifacts_load_error({ error })}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="tool-launches-empty alm-tool-launches__empty">
        {m.projects_artifacts_empty()}
      </div>
    );
  }

  return (
    <div className="tool-launches-accordion" data-testid="tool-launches-accordion">
      {groups.map((group, idx) => (
        <ArtifactGroupSection
          key={group.toolLaunchId ?? `unattributed-${idx}`}
          group={group}
          projectId={projectId}
          onAction={reload}
        />
      ))}
    </div>
  );
}
