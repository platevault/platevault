/**
 * ManifestsAccordion — spec 024 T1.7 / T2.2 / T2.3 / T3.4.
 *
 * Renders the "Manifests" accordion section in the project detail drawer.
 *
 * Behaviour:
 * - Loads manifest summaries via `project.manifest.list` on mount.
 * - Empty state when the project has no manifests yet.
 * - Each row shows reason label + formatted timestamp. Clicking a row loads
 *   the full body via `project.manifest.get` and shows an expandable panel.
 * - "Reveal in OS" button on each row calls `project.manifest.reveal_in_os`
 *   and shows an error toast on failure.
 */

import { useState, useEffect, useCallback } from 'react';
import { Section, Btn } from '@/ui';
import { addToast } from '@/shared/toast';
import {
  listManifests,
  getManifest,
  revealManifestInOs,
  manifestReasonLabel,
  formatManifestTimestamp,
} from './manifests';
import type { ManifestSummaryDto } from './manifests';
import type { ManifestBodyDto_Serialize as ManifestBodyDto } from '@/bindings/index';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ManifestsAccordionProps {
  projectId: string;
  /** Whether the collapsible section starts open. Default true. */
  defaultOpen?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ManifestsAccordion({ projectId, defaultOpen = true }: ManifestsAccordionProps) {
  const [manifests, setManifests] = useState<ManifestSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [bodyMap, setBodyMap] = useState<Record<string, ManifestBodyDto>>({});
  const [bodyLoading, setBodyLoading] = useState<string | null>(null);
  const [revealWorking, setRevealWorking] = useState<string | null>(null);

  // Load manifest list on mount / when projectId changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    listManifests({ projectId, limit: 50 })
      .then((resp) => {
        if (!cancelled) setManifests(resp.manifests ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
          setFetchError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Toggle expanded row; load body on first expand.
  const handleToggle = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
      if (bodyMap[id]) return; // already loaded
      setBodyLoading(id);
      try {
        const resp = await getManifest({ manifestId: id });
        setBodyMap((prev) => ({ ...prev, [id]: resp.manifest.body }));
      } catch (err: unknown) {
        const msg = typeof err === 'string' ? err : (err as Error)?.message ?? 'unknown';
        addToast({ message: `Failed to load manifest: ${msg}`, variant: 'error' });
      } finally {
        setBodyLoading(null);
      }
    },
    [expandedId, bodyMap],
  );

  // Reveal manifest file in OS file manager.
  const handleReveal = useCallback(
    async (manifest: ManifestSummaryDto) => {
      setRevealWorking(manifest.id);
      try {
        await revealManifestInOs({ path: manifest.path });
      } catch (err: unknown) {
        const msg = typeof err === 'string' ? err : (err as Error)?.message ?? 'Reveal failed.';
        addToast({ message: msg, variant: 'error' });
      } finally {
        setRevealWorking(null);
      }
    },
    [],
  );

  if (loading) {
    return (
      <Section title="Manifests" defaultOpen={defaultOpen}>
        <div
          data-testid="manifests-loading"
          className="alm-manifests__status"
        >
          Loading…
        </div>
      </Section>
    );
  }

  if (fetchError) {
    return (
      <Section title="Manifests" defaultOpen={defaultOpen}>
        <div
          data-testid="manifests-error"
          className="alm-manifests__status--error"
        >
          Could not load manifests.
        </div>
      </Section>
    );
  }

  return (
    <Section title="Manifests" count={manifests.length} defaultOpen={defaultOpen}>
      {manifests.length === 0 ? (
        <div
          data-testid="manifests-empty"
          className="alm-manifests__status"
        >
          No manifests yet. Manifests are generated automatically at lifecycle
          checkpoints.
        </div>
      ) : (
        <div data-testid="manifests-list">
          {manifests.map((m) => (
            <div
              key={m.id}
              className="alm-manifests__item"
            >
              {/* Row header */}
              <div className="alm-manifests__row-header">
                <button
                  data-testid={`manifest-row-${m.id}`}
                  onClick={() => void handleToggle(m.id)}
                  className="alm-manifests__toggle-btn"
                  aria-expanded={expandedId === m.id}
                >
                  <span className="alm-manifests__reason-label">{manifestReasonLabel(m.reason)}</span>
                  <span className="alm-manifests__timestamp">
                    {formatManifestTimestamp(m.timestamp)}
                  </span>
                </button>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={revealWorking === m.id}
                  onClick={() => void handleReveal(m)}
                  data-testid={`manifest-reveal-${m.id}`}
                  title="Reveal in file manager"
                >
                  Reveal
                </Btn>
              </div>

              {/* Expanded body */}
              {expandedId === m.id && (
                <div
                  data-testid={`manifest-body-${m.id}`}
                  className="alm-manifests__body-panel"
                >
                  {bodyLoading === m.id ? (
                    <span>Loading body…</span>
                  ) : bodyMap[m.id] ? (
                    <div>
                      <div>
                        <strong>Lifecycle:</strong> {bodyMap[m.id].lifecycleState}
                      </div>
                      {bodyMap[m.id].workflowProfile && (
                        <div>
                          <strong>Workflow:</strong> {bodyMap[m.id].workflowProfile}
                        </div>
                      )}
                      {bodyMap[m.id].notes && (
                        <div className="alm-manifests__notes-block">
                          <strong>Notes snapshot:</strong>
                          <div className="alm-manifests__notes-content">
                            {bodyMap[m.id].notes}
                          </div>
                        </div>
                      )}
                      <div className="alm-manifests__path">
                        {m.path}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
