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
import { m } from '@/lib/i18n';

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
        addToast({ message: m.projects_manifests_load_body_failed({ error: msg }), variant: 'error' });
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
        const msg = typeof err === 'string' ? err : (err as Error)?.message ?? m.projects_manifests_reveal_failed_fallback();
        addToast({ message: msg, variant: 'error' });
      } finally {
        setRevealWorking(null);
      }
    },
    [],
  );

  if (loading) {
    return (
      <Section title={m.projects_manifests_title()} defaultOpen={defaultOpen}>
        <div
          data-testid="manifests-loading"
          className="alm-manifests__status"
        >
          {m.common_loading()}
        </div>
      </Section>
    );
  }

  if (fetchError) {
    return (
      <Section title={m.projects_manifests_title()} defaultOpen={defaultOpen}>
        <div
          data-testid="manifests-error"
          className="alm-manifests__status--error"
        >
          {m.projects_manifests_load_error()}
        </div>
      </Section>
    );
  }

  return (
    <Section title={m.projects_manifests_title()} count={manifests.length} defaultOpen={defaultOpen}>
      {manifests.length === 0 ? (
        <div
          data-testid="manifests-empty"
          className="alm-manifests__status"
        >
          {m.projects_manifests_empty()}
        </div>
      ) : (
        <div data-testid="manifests-list">
          {manifests.map((manifest) => (
            <div
              key={manifest.id}
              className="alm-manifests__item"
            >
              {/* Row header */}
              <div className="alm-manifests__row-header">
                <button
                  data-testid={`manifest-row-${manifest.id}`}
                  onClick={() => void handleToggle(manifest.id)}
                  className="alm-manifests__toggle-btn"
                  aria-expanded={expandedId === manifest.id}
                >
                  <span className="alm-manifests__reason-label">{manifestReasonLabel(manifest.reason)}</span>
                  <span className="alm-manifests__timestamp">
                    {formatManifestTimestamp(manifest.timestamp)}
                  </span>
                </button>
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={revealWorking === manifest.id}
                  onClick={() => void handleReveal(manifest)}
                  data-testid={`manifest-reveal-${manifest.id}`}
                  title={m.projects_manifests_reveal_title()}
                >
                  {m.projects_manifests_reveal_btn()}
                </Btn>
              </div>

              {/* Expanded body */}
              {expandedId === manifest.id && (
                <div
                  data-testid={`manifest-body-${manifest.id}`}
                  className="alm-manifests__body-panel"
                >
                  {bodyLoading === manifest.id ? (
                    <span>{m.projects_manifests_body_loading()}</span>
                  ) : bodyMap[manifest.id] ? (
                    <div>
                      <div>
                        <strong>{m.projects_manifests_lifecycle_label()}</strong> {bodyMap[manifest.id].lifecycleState}
                      </div>
                      {bodyMap[manifest.id].workflowProfile && (
                        <div>
                          <strong>{m.projects_manifests_workflow_label()}</strong> {bodyMap[manifest.id].workflowProfile}
                        </div>
                      )}
                      {bodyMap[manifest.id].notes && (
                        <div className="alm-manifests__notes-block">
                          <strong>{m.projects_manifests_notes_label()}</strong>
                          <div className="alm-manifests__notes-content">
                            {bodyMap[manifest.id].notes}
                          </div>
                        </div>
                      )}
                      <div className="alm-manifests__path">
                        {manifest.path}
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
