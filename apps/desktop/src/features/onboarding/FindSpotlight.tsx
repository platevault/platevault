// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Find-It spotlight (spec 056, US4 T026; FR-022/FR-023; research R11).
 *
 * A single-step, NON-modal joyride run through the T009 adapter. Activating a
 * checklist row's find affordance points a spotlight at the real control on the
 * real page the item is about:
 *   - resolves the item's `data-guide-anchor` (the deterministic single anchor,
 *     spec edge case "two candidate anchors"),
 *   - navigates to the item's page first when needed (FR-022),
 *   - pulses the outline for the first seconds, then settles to a static
 *     outline (`prefers-reduced-motion` ⇒ no pulse),
 *   - stays up until dismissed — NEVER on a timer (FR-023). Dismissal paths:
 *     click the target, click the dimmed overlay, Escape, toggle the affordance
 *     again, or change pages.
 *   - when the control is not on screen (empty state / hidden panel / an anchor
 *     that lives on a per-record page) it explains why instead of spotlighting
 *     nothing (spec edge case).
 *
 * The affordance is a toggle held in a tiny module store so the SINGLE mounted
 * `ChecklistSection` (expanded sidebar OR open popover — never both) owns one
 * spotlight. Removing the section (T029) clears it via {@link clearFind}.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { EventData } from 'react-joyride';
import type { OnboardingItemDto } from '@/bindings/index';
import { m } from '@/lib/i18n';
import { OnboardingJoyride, type OnboardingStep } from './joyrideAdapter';
import { prefersReducedMotion } from './choreography';
import {
  ONBOARDING_PAGE_PATHS,
  itemLabel,
  itemTooltip,
} from './ChecklistSection';

/**
 * The three items whose real control carries a resolvable page-level anchor.
 * The other eight items have no on-page control to spotlight yet, so the find
 * affordance shows the unavailable-target explanation (spec edge case). Values
 * match the `data-guide-anchor` attributes wired on the real pages.
 */
const ITEM_ANCHORS: Record<string, string> = {
  'inbox.confirm_first': 'inbox.confirm-row',
  'projects.create_first': 'projects.create-cta',
  'projects.launch_tool': 'project.open-in-tool',
};

// ── Find toggle store ─────────────────────────────────────────────────────────

let activeItem: OnboardingItemDto | null = null;
const findSubs = new Set<() => void>();

function findEmit(): void {
  for (const fn of findSubs) fn();
}

/** Toggle the find spotlight for `item` (pressed-state semantics, T027). */
export function toggleFind(item: OnboardingItemDto): void {
  activeItem = activeItem?.itemId === item.itemId ? null : item;
  findEmit();
}

/** Dismiss any active spotlight (Escape/overlay/route/target/section-remove). */
export function clearFind(): void {
  if (activeItem === null) return;
  activeItem = null;
  findEmit();
}

function findSubscribe(fn: () => void): () => void {
  findSubs.add(fn);
  return () => findSubs.delete(fn);
}

function findSnapshot(): OnboardingItemDto | null {
  return activeItem;
}

/** The item whose find affordance is currently pressed (or `null`). */
export function useActiveFindItem(): OnboardingItemDto | null {
  return useSyncExternalStore(findSubscribe, findSnapshot, findSnapshot);
}

// ── Spotlight ─────────────────────────────────────────────────────────────────

const PULSE_MS = 2500;
const RESOLVE_TIMEOUT_MS = 1500;
const RESOLVE_POLL_MS = 60;

// react-joyride wire strings (enum imports stay in the adapter — mirrored here).
const DISMISS_ACTIONS = new Set(['close', 'skip']);
const DISMISS_STATUSES = new Set(['finished', 'skipped']);

/** Mounted once by `ChecklistSection`; renders the active item's spotlight. */
export function FindSpotlight(): React.ReactElement | null {
  const item = useActiveFindItem();
  if (!item) return null;
  // Key by item id so a fresh find fully resets the resolve/navigate machine.
  return <SpotlightFor key={item.itemId} item={item} />;
}

type ResolveStatus = 'pending' | 'found' | 'missing';

function SpotlightFor({
  item,
}: {
  item: OnboardingItemDto;
}): React.ReactElement | null {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const anchor = ITEM_ANCHORS[item.itemId];
  const selector = anchor ? `[data-guide-anchor="${anchor}"]` : null;
  const targetPath = ONBOARDING_PAGE_PATHS[item.page];
  const [status, setStatus] = useState<ResolveStatus>('pending');
  const arrivedRef = useRef(false);

  // Navigate to the item's page once (FR-022). Absent-anchor items skip this
  // and fall straight to the unavailable state.
  useEffect(() => {
    if (!selector) return;
    if (!pathname.startsWith(targetPath)) void navigate({ to: targetPath });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot on mount
  }, []);

  // Resolve the (single, deterministic) target once we are on its page.
  useEffect(() => {
    if (!selector) {
      setStatus('missing');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + RESOLVE_TIMEOUT_MS;
    const tick = () => {
      if (cancelled) return;
      if (document.querySelector(selector)) {
        setStatus('found');
        return;
      }
      if (Date.now() > deadline) {
        setStatus('missing');
        return;
      }
      timer = setTimeout(tick, RESOLVE_POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selector]);

  // Dismiss on navigation AWAY from the target page (FR-023). Arriving at the
  // target page is not a dismissal; leaving it after arrival is.
  useEffect(() => {
    if (pathname.startsWith(targetPath)) {
      arrivedRef.current = true;
    } else if (arrivedRef.current) {
      clearFind();
    }
  }, [pathname, targetPath]);

  // Pulse the outline for the first seconds, then static (FR-022). Signalled via
  // a root data-attribute the spotlight CSS keys off — portal-safe and
  // deterministic for tests. Reduced motion never pulses (VC-002 assertion).
  useEffect(() => {
    if (status !== 'found' || prefersReducedMotion()) return;
    const root = document.documentElement;
    root.dataset.onbSpotlightPulse = 'on';
    const t = setTimeout(() => {
      delete root.dataset.onbSpotlightPulse;
    }, PULSE_MS);
    return () => {
      clearTimeout(t);
      delete root.dataset.onbSpotlightPulse;
    };
  }, [status]);

  // Dismiss on clicking the real control (FR-023). The control stays
  // interactive (blockTargetInteraction=false), so this rides its click.
  useEffect(() => {
    if (status !== 'found' || !selector) return;
    const el = document.querySelector(selector);
    if (!el) return;
    const onClick = () => clearFind();
    el.addEventListener('click', onClick, { once: true, capture: true });
    return () => el.removeEventListener('click', onClick, { capture: true });
  }, [status, selector]);

  if (!selector || status === 'missing') {
    return (
      <div className="alm-onb-spotlight-unavailable" role="status">
        <span>
          {m.onboarding_find_unavailable({ item: itemLabel(item.itemId) })}
        </span>
        <button
          type="button"
          className="alm-onb-spotlight-unavailable__close"
          onClick={() => clearFind()}
        >
          {m.common_close()}
        </button>
      </div>
    );
  }

  if (status !== 'found') return null;

  const step: OnboardingStep = {
    target: selector,
    title: itemLabel(item.itemId),
    content: itemTooltip(item.itemId),
    placement: 'auto',
    // Open immediately on activation — a single-step tour would otherwise wait
    // on joyride's click-to-open beacon.
    skipBeacon: true,
  };

  const onEvent = (data: EventData) => {
    if (
      DISMISS_ACTIONS.has(data.action) ||
      DISMISS_STATUSES.has(data.status) ||
      data.type === 'tour:end'
    ) {
      clearFind();
    }
  };

  return (
    <OnboardingJoyride
      steps={[step]}
      continuous={false}
      disableFocusTrap
      overlayClickAction="close"
      blockTargetInteraction={false}
      spotlightStyle={{ stroke: 'var(--alm-accent)', strokeWidth: 3 }}
      onEvent={onEvent}
    />
  );
}
