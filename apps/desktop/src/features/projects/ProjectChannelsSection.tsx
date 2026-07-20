// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Channels palette section of the Project detail pane (#998, extracted from
 * ProjectDetail.tsx).
 *
 * `totalFrames`/`totalIntegS` are server-aggregated (P7 — `ProjectChannelDto`,
 * grouped by `filter_snapshot` over the project's linked sources). The only
 * client-derived field is `inSync`, added by `deriveChannels()`.
 *
 * Renders nothing when there are no channels — the caller does not need to
 * guard.
 */

import { m } from '@/lib/i18n';
import { CoverageBar, Pill, Section } from '@/ui';
import type { DerivedChannel } from './projectDetailHelpers';
import { fmtFrames, paletteName } from './projectDetailHelpers';
import { formatIntegration } from '@/lib/format';

export interface ProjectChannelsSectionProps {
  channels: DerivedChannel[];
}

export function ProjectChannelsSection({
  channels,
}: ProjectChannelsSectionProps) {
  if (channels.length === 0) return null;

  const paletteLabel = paletteName(channels);
  const allInSync = channels.length > 0 && channels.every((c) => c.inSync);
  const maxFrames = Math.max(...channels.map((c) => c.totalFrames), 1);

  return (
    <Section
      title={
        paletteLabel
          ? m.projects_channels_palette_title({
              channels: m.projects_edit_channels_label(),
              palette: paletteLabel,
            })
          : m.projects_edit_channels_label()
      }
      right={
        allInSync ? (
          <Pill variant="ghost">{m.projects_channels_in_sync()}</Pill>
        ) : undefined
      }
    >
      <div className="pv-project-detail__channels-section">
        {channels.map((ch) => (
          <div key={ch.label} className="pv-project-detail__channel-row">
            <span className="pv-project-detail__ch-letter">{ch.label[0]}</span>
            <span className="pv-project-detail__ch-filter">{ch.filter}</span>
            <div className="pv-project-detail__ch-coverage">
              <CoverageBar
                label=""
                value={ch.totalFrames}
                max={maxFrames}
                unit=""
              />
            </div>
            <span className="pv-project-detail__ch-subs">
              {fmtFrames(ch.totalFrames)}
            </span>
            <span className="pv-project-detail__ch-integ">
              {formatIntegration(ch.totalIntegS)}
            </span>
            <div className="pv-project-detail__ch-status">
              <Pill variant={ch.inSync ? 'ghost' : 'warn'}>
                {ch.inSync ? m.projects_channels_in_sync() : m.common_pending()}
              </Pill>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
