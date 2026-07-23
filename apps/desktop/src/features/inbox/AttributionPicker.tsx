// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useState } from 'react';
import type {
  ChosenAttributionDto_Deserialize as ChosenAttributionRequest,
  IngestionAttributionCandidateDto,
} from '../../bindings';
import { Btn } from '../../ui/Btn';
import { RadioGroup } from '../../ui/RadioGroup';
import { Section } from '../../ui/Section';
import * as m from '../../paraglide/messages';

export interface AttributionPickerProps {
  candidates: IngestionAttributionCandidateDto[];
  /** `projectId` → display name, joined client-side (the candidate DTO carries ids only). */
  projectNames: Record<string, string>;
  busy?: boolean;
  onPick: (chosen: ChosenAttributionRequest) => void;
  onCancel: () => void;
}

/** Stable option value for a candidate — kind plus whichever id it carries. */
function optionValue(
  c: IngestionAttributionCandidateDto,
  index: number,
): string {
  return `${index}:${c.kind}:${c.framingId ?? c.projectId ?? ''}`;
}

function candidateLabel(
  c: IngestionAttributionCandidateDto,
  projectNames: Record<string, string>,
): string {
  const project = c.projectId
    ? (projectNames[c.projectId] ?? c.projectId)
    : null;
  switch (c.kind) {
    case 'add_to_framing':
      return m.inbox_attribution_add_to_framing({ project: project ?? '' });
    case 'new_framing':
      return m.inbox_attribution_new_framing({ project: project ?? '' });
    case 'flag_optic_difference':
      return m.inbox_attribution_flag_optic_difference({
        project: project ?? '',
      });
    case 'new_project':
      return m.inbox_attribution_new_project();
    default:
      return c.kind;
  }
}

function candidateDesc(
  c: IngestionAttributionCandidateDto,
): string | undefined {
  const parts: string[] = [];
  if (c.matchScore != null) {
    parts.push(
      m.inbox_attribution_match_score({
        score: String(Math.round(c.matchScore * 100)),
      }),
    );
  }
  if (c.reopen) parts.push(m.inbox_attribution_reopen_warning());
  if (c.opticMismatch) parts.push(m.inbox_attribution_optic_mismatch());
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * Ranked attribution suggestions for a light-frame Inbox item (spec 008 US7,
 * FR-019/FR-020/FR-022).
 *
 * Suggest-never-auto-merge: nothing is preselected, so a confirm can only
 * carry an attribution the user explicitly picked. The pick rides the single
 * `inbox.confirm` call — confirming first and attributing after is impossible,
 * because that confirm's plan blocks any second confirm on the item (#943).
 */
export function AttributionPicker({
  candidates,
  projectNames,
  busy = false,
  onPick,
  onCancel,
}: AttributionPickerProps) {
  const [selected, setSelected] = useState('');

  const UNASSIGNED = 'unassigned';
  const options = [
    ...candidates.map((c, i) => ({
      value: optionValue(c, i),
      label: candidateLabel(c, projectNames),
      desc: candidateDesc(c),
    })),
    {
      value: UNASSIGNED,
      label: m.inbox_attribution_unassigned(),
      desc: m.inbox_attribution_unassigned_desc(),
      // Stable automation hook (real-UI journeys): the only option whose
      // value never varies with backend-suggested candidates.
      testId: 'inbox-attribution-option-unassigned',
    },
  ];

  const submit = () => {
    if (selected === UNASSIGNED) {
      onPick({ kind: 'unassigned', projectId: null, framingId: null });
      return;
    }
    const index = Number(selected.split(':')[0]);
    const c = candidates[index];
    if (!c) return;
    onPick({
      kind: c.kind,
      projectId: c.projectId ?? null,
      framingId: c.framingId ?? null,
    });
  };

  return (
    <Section
      title={m.inbox_attribution_title()}
      count={candidates.length}
      data-testid="inbox-attribution-picker"
    >
      <RadioGroup
        options={options}
        value={selected}
        onChange={setSelected}
        aria-label={m.inbox_attribution_title()}
      />
      <Btn
        variant="primary"
        disabled={busy || selected === ''}
        onClick={submit}
        data-testid="inbox-attribution-confirm"
      >
        {m.inbox_attribution_confirm()}
      </Btn>
      <Btn variant="ghost" disabled={busy} onClick={onCancel}>
        {m.inbox_attribution_cancel()}
      </Btn>
    </Section>
  );
}
