// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ConeSearchSuggestions — Inbox confirm-gate target suggestion (spec 052 P3,
 * US3).
 *
 * Shown for a light-frameset: runs `target.cone_search.suggest` on mount
 * (`reason: "ingest"`) and on an explicit "Re-check" (`reason: "on_demand"`,
 * FR-017). Renders ranked suggestions with their explicit confidence; only
 * the high-confidence, non-excluded primary is pre-selected — every
 * suggestion still requires an explicit Confirm click (FR-014, constitution
 * II: never silently auto-apply). Offline/no-pointing states render an inert
 * note rather than an error banner.
 */

import { useState } from 'react';
import { m } from '@/lib/i18n';
import { errMessage } from '@/lib/errors';
import { Banner, Btn, Pill, Section } from '@/ui';
import type { PillVariant } from '@/ui';
import type {
  ConeSearchCandidateTarget,
  ConeSearchConfidence,
  ConeSearchSuggestion,
} from './store';
import { useConeSearchConfirm, useConeSearchSuggestions } from './store';

function confidenceVariant(c: ConeSearchConfidence): PillVariant {
  switch (c) {
    case 'high':
      return 'ok';
    case 'medium':
      return 'info';
    default:
      return 'neutral';
  }
}

function confidenceLabel(c: ConeSearchConfidence): string {
  switch (c) {
    case 'high':
      return m.inbox_cone_search_confidence_high();
    case 'medium':
      return m.inbox_cone_search_confidence_medium();
    default:
      return m.inbox_cone_search_confidence_low();
  }
}

function candidateLabel(candidate: ConeSearchCandidateTarget): string {
  return candidate.commonName
    ? `${candidate.primaryDesignation} (${candidate.commonName})`
    : candidate.primaryDesignation;
}

/**
 * Adaptive-unit separation label (#699): cone-search candidates live inside a
 * single frame's field of view (well under 1°), where `toFixed(2)` degrees
 * collapses every real separation to "0.00°". Step down to arcminutes, then
 * arcseconds, so sub-degree separations stay legible.
 */
function separationLabel(degrees: number): string {
  if (degrees >= 0.1) {
    return m.inbox_cone_search_separation({ degrees: degrees.toFixed(2) });
  }
  const arcminutes = degrees * 60;
  if (arcminutes >= 1) {
    return m.inbox_cone_search_separation_arcmin({
      arcminutes: arcminutes.toFixed(1),
    });
  }
  return m.inbox_cone_search_separation_arcsec({
    arcseconds: (degrees * 3600).toFixed(0),
  });
}

export interface ConeSearchSuggestionsProps {
  /** The light-frameset's inbox item id. */
  framesetId: string;
}

export function ConeSearchSuggestions({
  framesetId,
}: ConeSearchSuggestionsProps) {
  const [reason, setReason] = useState<'ingest' | 'on_demand'>('ingest');
  const { response, offline, loading, error, refetch } =
    useConeSearchSuggestions(framesetId, reason);
  const {
    confirm,
    loading: confirming,
    error: confirmError,
  } = useConeSearchConfirm(framesetId);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);

  const handleRecheck = () => {
    setReason('on_demand');
    void refetch();
  };

  const handleConfirm = async (suggestion: ConeSearchSuggestion) => {
    await confirm({
      canonicalTargetId: suggestion.candidate.canonicalTargetId ?? null,
      primaryDesignation: suggestion.candidate.primaryDesignation,
      simbadOid: null,
    });
    setConfirmedId(suggestion.candidate.primaryDesignation);
  };

  if (error) {
    return <Banner variant="danger">{errMessage(error)}</Banner>;
  }

  if (loading && !response) {
    return null;
  }

  if (offline) {
    return <Banner variant="info">{m.inbox_cone_search_offline()}</Banner>;
  }

  if (!response || response.pointing.source === 'none') {
    return <Banner variant="info">{m.inbox_cone_search_no_pointing()}</Banner>;
  }

  return (
    <Section
      title={m.inbox_cone_search_title()}
      count={response.suggestions.length}
      right={
        <Btn
          variant="ghost"
          size="sm"
          onClick={handleRecheck}
          disabled={loading}
        >
          {m.inbox_cone_search_recheck()}
        </Btn>
      }
    >
      {confirmedId ? (
        <Banner variant="info">
          {m.inbox_cone_search_confirmed()} ({confirmedId})
        </Banner>
      ) : null}
      {confirmError ? <Banner variant="danger">{confirmError}</Banner> : null}
      <ul className="pv-cone-search__list">
        {response.suggestions.map((s) => (
          <li
            key={`${s.candidate.primaryDesignation}-${s.separationDeg ?? 0}`}
            className="pv-cone-search__row"
          >
            <span className="pv-cone-search__name">
              {candidateLabel(s.candidate)}
            </span>
            <Pill variant={confidenceVariant(s.confidence)}>
              {confidenceLabel(s.confidence)}
            </Pill>
            {s.excluded ? (
              <Pill variant="warn">{m.inbox_cone_search_excluded()}</Pill>
            ) : null}
            {s.separationDeg != null ? (
              <span className="pv-meta-sm">
                {separationLabel(s.separationDeg)}
              </span>
            ) : null}
            <Btn
              variant={s.preselected ? 'primary' : 'ghost'}
              size="sm"
              disabled={confirming}
              onClick={() => void handleConfirm(s)}
            >
              {confirming
                ? m.inbox_cone_search_confirm_working()
                : m.inbox_cone_search_confirm()}
            </Btn>
          </li>
        ))}
      </ul>
    </Section>
  );
}
