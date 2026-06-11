/**
 * GuidedOverlay — non-blocking coach hint overlay (spec 010, US1–US4).
 *
 * Renders a dismissible tooltip anchored to a DOM element identified by
 * `data-guide-anchor="<anchorId>"`.  If the anchor element is absent on the
 * current route the hint is deferred (hidden) per FR-007.
 *
 * Reduced-motion: when `prefers-reduced-motion: reduce` is active, all
 * CSS transitions are disabled.
 *
 * Non-blocking: `pointer-events: none` on the backdrop; only the hint card
 * itself is interactive.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GUIDE_ANCHOR_ATTR } from './anchors';
import type { GuidedFlowStateDto } from './store';
import { STEP_HINT_TEXT, STEP_ORDER } from './store';

// ── Style constants ───────────────────────────────────────────────────────────

const HINT_OFFSET_PX = 12;

interface Position {
  top: number;
  left: number;
}

// ── Hook: anchor resolution ───────────────────────────────────────────────────

/**
 * Resolve the DOM element for the given anchor id on the current page.
 * Re-runs when the DOM changes (MutationObserver).
 */
function useAnchorElement(anchorId: string | null): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!anchorId) {
      setEl(null);
      return;
    }

    const find = () =>
      document.querySelector<HTMLElement>(
        `[${GUIDE_ANCHOR_ATTR}="${CSS.escape(anchorId)}"]`,
      ) ?? null;

    setEl(find());

    const observer = new MutationObserver(() => setEl(find()));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [anchorId]);

  return el;
}

// ── Hook: floating position ───────────────────────────────────────────────────

/**
 * Compute the top-left position for the hint card, placed below the anchor.
 * Re-computes on scroll and resize.
 */
function useHintPosition(anchorEl: HTMLElement | null): Position | null {
  const [pos, setPos] = useState<Position | null>(null);

  const compute = useCallback(() => {
    if (!anchorEl) {
      setPos(null);
      return;
    }
    const rect = anchorEl.getBoundingClientRect();
    setPos({
      top: rect.bottom + window.scrollY + HINT_OFFSET_PX,
      left: rect.left + window.scrollX,
    });
  }, [anchorEl]);

  useEffect(() => {
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [compute]);

  return pos;
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface GuidedOverlayProps {
  /** Current coach state. Pass null to hide the overlay. */
  guidedState: GuidedFlowStateDto | null;
  /** Called when the user clicks "Dismiss". */
  onDismiss: () => void;
}

// ── Step → anchor id mapping ─────────────────────────────────────────────────

import {
  ANCHOR_INBOX_CONFIRM_ROW,
  ANCHOR_PROJECTS_CREATE_CTA,
  ANCHOR_PROJECT_OPEN_IN_TOOL,
} from './anchors';

const STEP_ANCHOR: Record<string, string> = {
  'inbox.confirm_first': ANCHOR_INBOX_CONFIRM_ROW,
  'project.create_first': ANCHOR_PROJECTS_CREATE_CTA,
  'tool.open_first': ANCHOR_PROJECT_OPEN_IN_TOOL,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function GuidedOverlay({ guidedState, onDismiss }: GuidedOverlayProps) {
  const dismissBtnRef = useRef<HTMLButtonElement>(null);

  const currentStep = guidedState?.currentStep ?? null;
  const isDismissed = guidedState?.dismissed ?? true;

  // Derive anchor id for the current step.
  const anchorId = currentStep ? (STEP_ANCHOR[currentStep] ?? null) : null;
  const anchorEl = useAnchorElement(anchorId);
  const pos = useHintPosition(anchorEl);

  const hint = currentStep ? STEP_HINT_TEXT[currentStep] : null;

  // Keyboard: Escape dismisses the overlay when it is focused.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && currentStep && !isDismissed) {
        onDismiss();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [currentStep, isDismissed, onDismiss]);

  // Don't render when: dismissed, no active step, or all done (no currentStep).
  if (isDismissed || !currentStep || !hint) return null;

  // Deferred: anchor not found on this route — show nothing (FR-007).
  if (!anchorEl || !pos) return null;

  const allDone = guidedState
    ? STEP_ORDER.every((id) => guidedState.completedSteps.includes(id))
    : false;
  if (allDone) return null;

  const stepIndex = STEP_ORDER.indexOf(currentStep as (typeof STEP_ORDER)[number]);
  const totalSteps = STEP_ORDER.length;

  return createPortal(
    /* Backdrop: pointer-events none so it never traps clicks (FR-002). */
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9000,
      }}
    >
      {/* Hint card — pointer-events auto so dismiss is clickable */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`Coach hint: ${hint.title}`}
        data-testid="guided-hint-card"
        style={{
          position: 'absolute',
          top: pos.top,
          left: pos.left,
          maxWidth: 320,
          pointerEvents: 'auto',
          background: 'var(--alm-surface, #1e1e2e)',
          border: '1px solid var(--alm-border, #3a3a5c)',
          borderRadius: 'var(--alm-radius, 6px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          padding: 'var(--alm-sp-4, 16px)',
          zIndex: 9001,
          /* Respect prefers-reduced-motion */
          '@media (prefers-reduced-motion: no-preference)': {
            transition: 'opacity 0.15s ease',
          },
        } as React.CSSProperties}
      >
        {/* Step progress */}
        <div
          style={{
            fontSize: 'var(--alm-text-xs, 11px)',
            color: 'var(--alm-text-muted, #888)',
            marginBottom: 'var(--alm-sp-1, 4px)',
          }}
        >
          Step {stepIndex + 1} of {totalSteps}
        </div>

        {/* Title */}
        <strong
          style={{
            display: 'block',
            fontSize: 'var(--alm-text-sm, 13px)',
            marginBottom: 'var(--alm-sp-2, 8px)',
            color: 'var(--alm-text, #e2e2f0)',
          }}
        >
          {hint.title}
        </strong>

        {/* Body */}
        <p
          style={{
            fontSize: 'var(--alm-text-xs, 11px)',
            color: 'var(--alm-text-muted, #aaa)',
            margin: 0,
            marginBottom: 'var(--alm-sp-3, 12px)',
            lineHeight: 1.5,
          }}
        >
          {hint.body}
        </p>

        {/* Dismiss button */}
        <button
          ref={dismissBtnRef}
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss guided coach"
          data-testid="guided-dismiss-btn"
          style={{
            background: 'transparent',
            border: '1px solid var(--alm-border, #3a3a5c)',
            borderRadius: 'var(--alm-radius, 4px)',
            color: 'var(--alm-text-muted, #aaa)',
            cursor: 'pointer',
            fontSize: 'var(--alm-text-xs, 11px)',
            padding: '4px 10px',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>,
    document.body,
  );
}
