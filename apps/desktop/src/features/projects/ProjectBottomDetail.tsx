// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ProjectBottomDetail — spec 043 task #104.
 *
 * The bottom panel in the dual side+bottom Projects layout. Renders the
 * secondary/operational project sections that benefit from the full-width
 * horizontal room the bottom strip offers — sections that were previously
 * collapsed by default in the narrow 420px side column.
 *
 * Sections rendered here (all open by default, horizontal grid):
 *   Notes          — project notes (editable unless archived)
 *   Manifests      — manifest files accordion
 *   Calibration    — calibration match panel for project sources
 *   Tool Launches  — observed processing artifacts grouped by launch (spec 012)
 *   Source views   — generated source view removal / regenerate (spec 026)
 *   Outputs        — accepted outputs verification (stub; spec 043 §4)
 *   Cleanup        — cleanup preview (stub; spec 043 §4)
 *
 * These were previously in ProjectDetail (the side panel) but are collapsed
 * there by default because the 420px column doesn't have room to show them
 * usefully. The bottom panel has ample horizontal space and gives each section
 * room to breathe.
 *
 * Calls useProjectDetail itself — avoids prop-drilling sourceIds / lifecycle
 * through ProjectsPage, which only has the lightweight ProjectSummaryDto.
 */

import { Banner, Skeleton } from '@/ui';
import { m } from '@/lib/i18n';
import { useProjectDetail } from './store';
import { ProjectNotesSection } from './ProjectNotesSection';
import { ManifestsAccordion } from './ManifestsAccordion';
import { CalibrationMatchPanel } from './CalibrationMatchPanel';
import { ToolLaunchesAccordion } from './ToolLaunchesAccordion';
import { SourceViewsSection } from './SourceViewsSection';
import { OutputsSection, CleanupSection } from './OutputsCleanupSections';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ProjectBottomDetailProps {
  projectId: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProjectBottomDetail({ projectId }: ProjectBottomDetailProps) {
  const { data: project, loading, error } = useProjectDetail(projectId);

  if (loading && !project) {
    return (
      <div className="pv-project-bottom__loading">
        <Skeleton count={4} label={m.common_loading()} />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="pv-project-bottom__error">
        <Banner variant="danger">{m.projects_bottom_load_error()}</Banner>
      </div>
    );
  }

  const lifecycle =
    typeof project.lifecycle === 'string'
      ? project.lifecycle
      : 'setup_incomplete';
  const sourceIds = project.sources.map((s) => s.inventoryId);

  return (
    <div className="pv-project-bottom">
      <div className="pv-project-bottom__grid">
        {/* ── Notes — widest: spans two columns on wider displays ───────── */}
        <div className="pv-project-bottom__cell pv-project-bottom__cell--notes">
          <ProjectNotesSection
            projectId={projectId}
            readOnly={lifecycle === 'archived'}
          />
        </div>

        {/* ── Calibration match panel ───────────────────────────────────── */}
        {sourceIds.length > 0 && (
          <div className="pv-project-bottom__cell">
            <CalibrationMatchPanel sessionIds={sourceIds} defaultOpen={true} />
          </div>
        )}

        {/* ── Manifests accordion ───────────────────────────────────────── */}
        <div className="pv-project-bottom__cell">
          <ManifestsAccordion projectId={projectId} defaultOpen={true} />
        </div>

        {/* ── Tool Launches — observed processing artifacts (spec 012 FR-009,
            #728: previously built and tested but never mounted) ──────────── */}
        <div className="pv-project-bottom__cell">
          <ToolLaunchesAccordion projectId={projectId} defaultOpen={true} />
        </div>

        {/* ── Generated source views (spec 026) ────────────────────────── */}
        <div className="pv-project-bottom__cell">
          <SourceViewsSection projectId={projectId} defaultOpen={true} />
        </div>

        {/* ── Outputs — stub; no backend data yet ──────────────────────── */}
        <div className="pv-project-bottom__cell">
          <OutputsSection defaultOpen={true} />
        </div>

        {/* ── Cleanup — live two-step scan → plan → review flow (017 WP-E) ── */}
        <div className="pv-project-bottom__cell">
          <CleanupSection projectId={projectId} defaultOpen={true} />
        </div>
      </div>
    </div>
  );
}
