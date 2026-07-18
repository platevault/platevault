// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Icon-collapsed representation of the Getting-started section (spec 056, US2
 * T020; FR-011). A progress-ring button (`role="progressbar"`) opens the SAME
 * {@link ChecklistSection} as a NON-MODAL popover: no backdrop, no focus trap,
 * no `aria-modal` — the rest of the app stays fully interactive while it is
 * open. Reuses `checklist.css` (research R10); the ring is the only markup
 * unique to this host.
 */

import { useState } from 'react';
import { clsx } from 'clsx';
import { m } from '@/lib/i18n';
import {
  ChecklistSection,
  useVisibleOnboardingState,
} from './ChecklistSection';
import { useCompletionChoreography } from './choreography';

const RING_SIZE = 24;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function ChecklistPopover(): React.ReactElement | null {
  const state = useVisibleOnboardingState();
  const choreo = useCompletionChoreography(state);
  const [open, setOpen] = useState(false);

  if (!state) return null;

  const { done, total } = state.progress;
  const fraction = total > 0 ? done / total : 0;
  const progressText = m.onboarding_section_progress({ done, total });

  return (
    <div className="alm-onb-ring-wrap">
      <button
        type="button"
        className={clsx(
          'alm-onb-ring',
          choreo.pulseActive && 'alm-onb-ring--pulse',
        )}
        aria-label={progressText}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={progressText}
        >
          <svg width={RING_SIZE} height={RING_SIZE} aria-hidden>
            <circle
              className="alm-onb-ring__track"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
            />
            <circle
              className="alm-onb-ring__fill"
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </svg>
        </span>
      </button>
      {open && (
        <div
          className="alm-onb-popover"
          role="region"
          aria-label={progressText}
        >
          <ChecklistSection idPrefix="onb-pop" />
        </div>
      )}
    </div>
  );
}
