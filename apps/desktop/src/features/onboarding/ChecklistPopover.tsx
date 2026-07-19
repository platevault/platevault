// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Getting-started flyout (spec 056, US2 T020; FR-011).
 *
 * A progress-ring trigger in the sidebar opens the {@link ChecklistSection} as
 * a NON-MODAL popover to the RIGHT of the sidebar: no backdrop, no focus trap,
 * no `aria-modal` — the rest of the app stays fully interactive while it is
 * open. Reuses `checklist.css` (research R10).
 *
 * This is now the ONLY presentation, in both sidebar widths — `labelled`
 * only controls whether the trigger shows its text and count alongside the
 * ring, or the bare ring when the sidebar is icon-collapsed.
 *
 * WHY NOT INLINE: the section used to render directly into the expanded
 * sidebar with nothing but a hairline `border-top`, on the sidebar's own
 * background. Expanding it read as "more sidebar" rather than as a distinct
 * panel. Floating it onto the raised popover surface (border + shadow, off the
 * sidebar's background) makes it legible as its own thing by construction,
 * and keeps the sidebar's vertical space for navigation.
 */

import { useEffect, useId, useRef, useState } from 'react';
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

export interface ChecklistPopoverProps {
  /** Show the trigger's text + count (expanded sidebar). Bare ring when false. */
  labelled?: boolean;
}

export function ChecklistPopover({
  labelled = false,
}: ChecklistPopoverProps = {}): React.ReactElement | null {
  const state = useVisibleOnboardingState();
  const choreo = useCompletionChoreography(state);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gradientId = `onb-ring-grad-${useId().replaceAll(':', '')}`;

  // Dismiss on Escape and on a click outside the flyout (WCAG 1.4.13
  // dismissable; also the plain expectation for any popover). Registered only
  // while open so a closed flyout costs nothing. Escape restores focus to the
  // trigger — otherwise focus would be stranded on a removed subtree.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      wrapRef.current?.querySelector('button')?.focus();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (!state) return null;

  const { done, total } = state.progress;
  const fraction = total > 0 ? done / total : 0;
  const progressText = m.onboarding_section_progress({ done, total });

  return (
    <div className="alm-onb-ring-wrap" ref={wrapRef}>
      <button
        type="button"
        className={clsx(
          'alm-onb-ring',
          labelled && 'alm-onb-ring--labelled',
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
            {/*
              Progress gradient: the donut's stroke runs from the deep accent
              into the bright accent as completion advances, so the arc reads as
              "warming up" rather than as a flat band. The id is instance-scoped
              because the expanded and icon-collapsed hosts can both be mounted
              in the same document, and duplicate SVG gradient ids would make
              one silently adopt the other's stops.
            */}
            <defs>
              <linearGradient
                id={gradientId}
                x1="0%"
                y1="100%"
                x2="100%"
                y2="0%"
              >
                <stop offset="0%" className="alm-onb-ring__grad-from" />
                <stop offset="100%" className="alm-onb-ring__grad-to" />
              </linearGradient>
            </defs>
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
              stroke={`url(#${gradientId})`}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
              transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            />
          </svg>
        </span>
        {labelled && (
          <>
            <span className="alm-onb-ring__label">
              {m.onboarding_section_title()}
            </span>
            <span className="alm-onb-ring__count" aria-hidden>
              {done}/{total}
            </span>
          </>
        )}
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
