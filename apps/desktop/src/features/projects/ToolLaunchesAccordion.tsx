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
import type { ArtifactSummary } from '@/api/commands';
import {
  groupArtifactsByLaunch,
  useArtifacts,
  useArtifactClassify,
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
    markResolved(projectId, artifact.id);
  }, [markResolved, projectId, artifact.id]);

  const fileName = artifact.path.split('/').pop() ?? artifact.path;

  return (
    <div
      className="artifact-row"
      data-state={artifact.state}
      data-kind={artifact.kind}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
    >
      {/* Kind badge */}
      <span
        className={`artifact-kind-badge artifact-kind-${artifact.kind}`}
        title={`${artifact.kind}${isFallback ? ' (low confidence)' : ''}`}
        style={{ fontSize: 11, opacity: isFallback ? 0.6 : 1 }}
      >
        {artifact.kind}
      </span>

      {/* File name — strikethrough when missing */}
      <span
        className="artifact-file-name"
        style={{
          textDecoration: isMissing ? 'line-through' : 'none',
          opacity: isMissing ? 0.5 : 1,
          fontFamily: 'monospace',
          fontSize: 12,
        }}
        title={artifact.path}
      >
        {fileName}
      </span>

      {/* Status badges */}
      {isMissing && (
        <span
          className="artifact-badge artifact-badge-missing"
          style={{ fontSize: 10, color: 'var(--mantine-color-red-6, #c92a2a)' }}
        >
          Missing
        </span>
      )}

      {isManualOverride && (
        <span
          className="artifact-badge artifact-badge-manual"
          style={{ fontSize: 10, color: 'var(--mantine-color-blue-6, #1971c2)' }}
          title="Classification manually overridden"
        >
          (manual)
        </span>
      )}

      {/* Mark resolved affordance (T024) */}
      {isMissing && (
        <button
          type="button"
          className="artifact-mark-resolved-btn"
          onClick={handleMarkResolved}
          disabled={working}
          style={{ fontSize: 11, marginLeft: 'auto', cursor: 'pointer' }}
          aria-label={`Mark ${fileName} as resolved`}
        >
          {working ? 'Resolving…' : 'Mark resolved'}
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
    <div className="artifact-group" style={{ marginBottom: 12 }}>
      <div
        className="artifact-group-header"
        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}
      >
        <span style={{ fontWeight: 600, fontSize: 12 }}>{label}</span>
        <span
          className="artifact-count-badge"
          style={{
            fontSize: 10,
            background: 'var(--mantine-color-gray-2, #e9ecef)',
            borderRadius: 4,
            padding: '1px 5px',
          }}
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
    return <div className="tool-launches-loading" style={{ fontSize: 12 }}>Loading artifacts…</div>;
  }

  if (error) {
    return (
      <div className="tool-launches-error" style={{ fontSize: 12, color: 'var(--mantine-color-red-6, #c92a2a)' }}>
        Failed to load artifacts: {error}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="tool-launches-empty" style={{ fontSize: 12, opacity: 0.6 }}>
        No processing artifacts observed yet.
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
