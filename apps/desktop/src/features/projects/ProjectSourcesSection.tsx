// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sources section of the Project detail pane (#998, extracted from
 * ProjectDetail.tsx). Renders the project's linked source sessions as a table,
 * or an empty-state line when there are none.
 */

import { renderValue } from '@/components';
import { m } from '@/lib/i18n';
import { Pill, Section, Table } from '@/ui';
import type { ProjectSourceDto_Deserialize } from '@/bindings/index';
import {
  fmtFrames,
  parseExposureSeconds,
  sourceTypeVariant,
} from './projectDetailHelpers';
import { formatIntegration } from '@/lib/format';

export interface ProjectSourcesSectionProps {
  sources: ProjectSourceDto_Deserialize[];
  /** #663: resolves raw session UUIDs to the human names Sessions shows. */
  sessionNames: Map<string, string>;
}

export function ProjectSourcesSection({
  sources,
  sessionNames,
}: ProjectSourcesSectionProps) {
  const sourceColumns = [
    {
      key: 'role',
      label: m.projects_col_role(),
      className: 'pv-project-detail__role-cell',
    },
    { key: 'source', label: m.projects_col_source() },
    { key: 'filter', label: m.common_filter() },
    {
      key: 'subs',
      label: m.projects_col_subs(),
      className: 'pv-project-detail__num-cell',
    },
    {
      key: 'integ',
      label: m.projects_col_integ(),
      className: 'pv-project-detail__integ-cell',
    },
  ];

  const sourceRows = sources.map((src) => {
    // #663: prefer the DTO name, then the Sessions-derived human name; raw
    // UUID is the last resort (matches Sessions page fallback ordering).
    const displayName =
      src.name || sessionNames.get(src.inventoryId) || src.inventoryId;
    const integS = src.frames * parseExposureSeconds(src.exposure);
    return {
      role: (
        <span className="pv-project-detail__role-cell">
          {renderValue(src.role ?? null, { applicability: 'applicable' })}
        </span>
      ),
      source: (
        // #720 FR-006/SC-002: click through to the source's Inventory
        // (Sessions) entry instead of rendering inert text.
        <a
          className="pv-project-detail__source-name"
          href={`#/sessions?selected=${encodeURIComponent(src.inventoryId)}`}
          data-testid={`project-source-link-${src.inventoryId}`}
        >
          {displayName}
        </a>
      ),
      // Project sources are light sessions (filter is applicable, data-model.md
      // matrix) — a missing filter is unresolved, not the same blank marker a
      // not-applicable field would use (spec-030 Q16 / FR-135).
      filter: src.filter ? (
        <Pill variant={sourceTypeVariant(src.filter)}>{src.filter}</Pill>
      ) : (
        renderValue(null, { applicability: 'applicable' })
      ),
      subs: (
        <span className="pv-project-detail__num-cell">
          {fmtFrames(src.frames)}
        </span>
      ),
      integ: (
        <span className="pv-project-detail__integ-cell">
          {formatIntegration(integS)}
        </span>
      ),
    };
  });

  return (
    <Section title={m.common_sources()} count={sources.length}>
      {sources.length === 0 ? (
        <div className="pv-project-detail__sources-empty">
          {m.projects_sources_empty()}
        </div>
      ) : (
        <Table columns={sourceColumns} rows={sourceRows} />
      )}
    </Section>
  );
}
