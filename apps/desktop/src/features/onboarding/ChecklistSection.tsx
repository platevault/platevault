// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The ONE parameterised Getting-started checklist (spec 056, US2 T017–T019;
 * research R10). Its sole host is the flyout in `ChecklistPopover.tsx`, which
 * `Sidebar.tsx` mounts at BOTH sidebar widths — only the trigger differs
 * (labelled row when expanded, bare progress ring when icon-collapsed).
 *
 * T018 originally specified an inline section in the expanded sidebar, with the
 * popover reserved for the collapsed width. That was dropped: rendered inline,
 * the list blended into the sidebar's own surface and read as navigation rather
 * than as a checklist. Both widths now use the flyout, which is portalled to
 * `<body>` because `.pv-sidebar` is `overflow: hidden` and was scissoring the
 * panel away. There is consequently NO inline host — anything asserting on this
 * component (tests included) must open the flyout first.
 *
 * One component, one `checklist.css` class family (tokens only) — never a
 * per-surface clone (`scripts/css-dup-sniff.mjs`).
 *
 * State is read straight from the onboarding store (backend-authoritative,
 * research R5): the component re-renders whenever the projection changes, so
 * prerequisite satisfaction clears live without a reload (FR-010) and auto-ticks
 * surface as soon as the store re-reads on `onboarding:state-changed`.
 *
 * Completion choreography (animation, completed-area move) is layered on by US3
 * T024/T025; this node renders the settled end-state (open items on top,
 * completed greyed at the bottom of their group) plus the manual check and
 * dismiss affordances required for non-event items (FR-017).
 */

import { useMemo, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  MoreHorizontal,
  Search,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { m } from '@/lib/i18n';
import { Tooltip } from '@/ui';
import type { OnboardingItemDto, OnboardingPage } from '@/bindings/index';
import './checklist.css';
import {
  setOnboardingItemState,
  setOnboardingSection,
  useVisibleOnboardingState,
} from './store';
// Re-export so existing imports from ChecklistSection still resolve.
export { useVisibleOnboardingState } from './store';
import { useCompletionChoreography } from './choreography';
import {
  FindSpotlight,
  clearFind,
  toggleFind,
  useActiveFindItem,
} from './FindSpotlight';
import {
  PAGE_ORDER,
  ONBOARDING_PAGE_PATHS,
  itemLabel,
  itemTooltip,
  prerequisiteReason,
  pageLabel,
  pagePath,
} from './onboarding-labels';

// Re-export the label/path helpers so existing callers (FindSpotlight, tests)
// are not broken — they import these from this module today.
export { ONBOARDING_PAGE_PATHS, itemLabel, itemTooltip, prerequisiteReason };

export function isChecklistGroupSettled(items: OnboardingItemDto[]): boolean {
  return items.length > 0 && items.every((item) => item.state !== 'unchecked');
}

export function completedChecklistItems(
  items: OnboardingItemDto[],
): OnboardingItemDto[] {
  return items.filter(
    (item) =>
      item.state === 'auto_checked' || item.state === 'manually_checked',
  );
}

function pageForPath(pathname: string): OnboardingPage | null {
  return PAGE_ORDER.find((p) => pathname.startsWith(pagePath(p))) ?? null;
}

interface ChecklistSectionProps {
  /** Disambiguates DOM ids when two hosts could ever mount at once. */
  idPrefix?: string;
}

/** The shared checklist body: overall progress line + per-page accordion. */
export function ChecklistSection({
  idPrefix = 'onb',
}: ChecklistSectionProps): React.ReactElement | null {
  const state = useVisibleOnboardingState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const choreo = useCompletionChoreography(state);
  // While a find spotlight is up, keep the checklist (and its toggle-off find
  // affordance) above the joyride overlay so the FR-023 toggle-dismiss stays
  // clickable — the overlay still dims the rest of the app.
  const spotlightActive = useActiveFindItem() != null;

  // Whole-section collapse (FR-012) is backend-persisted; per-group manual
  // toggles are session-local overrides on top of the route-driven default.
  const [groupOverrides, setGroupOverrides] = useState<
    Partial<Record<OnboardingPage, boolean>>
  >({});
  // Section-header remove menu (T029): menu → one-line confirm → hide forever.
  const [menuOpen, setMenuOpen] = useState(false);
  const [removeConfirming, setRemoveConfirming] = useState(false);

  const itemsByPage = useMemo(() => {
    const map = new Map<OnboardingPage, OnboardingItemDto[]>();
    if (state) {
      for (const item of state.items) {
        const list = map.get(item.page) ?? [];
        list.push(item);
        map.set(item.page, list);
      }
    }
    return map;
  }, [state]);

  if (!state) return null;

  const currentPage = pageForPath(pathname);
  const sectionExpanded = !state.flags.sidebarCollapsed;
  const { done, total } = state.progress;
  const progressText = m.onboarding_section_progress({ done, total });

  const groupProgress = (page: OnboardingPage) =>
    state.progress.perPage.find((p) => p.page === page) ?? {
      done: 0,
      total: 0,
    };

  const isGroupComplete = (page: OnboardingPage): boolean => {
    const items = itemsByPage.get(page) ?? [];
    return isChecklistGroupSettled(items);
  };

  // FR-007 auto-expand the current page's group; FR-031 takes precedence — a
  // complete group stays a one-line done header even on its own page. A manual
  // toggle (`groupOverrides`) always wins and never re-enables auto-expand.
  const isGroupExpanded = (page: OnboardingPage): boolean => {
    const override = groupOverrides[page];
    if (override !== undefined) return override;
    return page === currentPage && !isGroupComplete(page);
  };

  const toggleSection = () =>
    void setOnboardingSection({ sidebarCollapsed: sectionExpanded });

  const toggleGroup = (page: OnboardingPage) =>
    setGroupOverrides((prev) => ({ ...prev, [page]: !isGroupExpanded(page) }));

  // Explicit removal (FR-013): hide the section (and its ring) forever, and
  // drop any spotlight that was open over a now-hidden item (spec edge case).
  const handleRemove = () => {
    clearFind();
    setMenuOpen(false);
    setRemoveConfirming(false);
    void setOnboardingSection({ hidden: true });
  };

  return (
    <section
      className={clsx(
        'pv-onb-checklist',
        spotlightActive && 'pv-onb-checklist--spotlighting',
      )}
      aria-label={m.onboarding_section_title()}
    >
      <div className="pv-onb-checklist__head">
        <button
          type="button"
          className="pv-onb-checklist__section-toggle"
          aria-expanded={sectionExpanded}
          onClick={toggleSection}
        >
          {sectionExpanded ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronRight size={14} aria-hidden />
          )}
          <span className="pv-onb-checklist__title">
            {m.onboarding_section_title()}
          </span>
        </button>
        <div
          className={clsx(
            'pv-onb-checklist__progress',
            choreo.pulseActive && 'pv-onb-checklist__progress--pulse',
          )}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={progressText}
        >
          <span className="pv-onb-checklist__progress-text">
            {progressText}
          </span>
          <span className="pv-onb-checklist__progress-track" aria-hidden>
            <span
              className="pv-onb-checklist__progress-fill"
              // eslint-disable-next-line no-restricted-syntax -- dynamic: progress width tracks live done/total
              style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
            />
          </span>
        </div>

        {/* Header overflow menu (T029): the single "Remove getting started"
            action behind a one-line confirm (FR-013). */}
        <div className="pv-onb-checklist__menu-wrap">
          <button
            type="button"
            className="pv-onb-checklist__menu-btn"
            aria-label={m.onboarding_section_menu_aria()}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => {
              setMenuOpen((v) => !v);
              setRemoveConfirming(false);
            }}
          >
            <MoreHorizontal size={14} aria-hidden />
          </button>
          {menuOpen && (
            <div className="pv-onb-checklist__menu" role="menu">
              {removeConfirming ? (
                <div className="pv-onb-checklist__menu-confirm">
                  <p className="pv-onb-checklist__menu-confirm-text">
                    {m.onboarding_section_remove_confirm()}
                  </p>
                  <div className="pv-onb-checklist__menu-confirm-actions">
                    <button
                      type="button"
                      className="pv-onb-checklist__menu-confirm-yes"
                      onClick={handleRemove}
                    >
                      {m.common_remove()}
                    </button>
                    <button
                      type="button"
                      className="pv-onb-checklist__menu-confirm-no"
                      onClick={() => {
                        setRemoveConfirming(false);
                        setMenuOpen(false);
                      }}
                    >
                      {m.common_cancel()}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="pv-onb-checklist__menu-item"
                  onClick={() => setRemoveConfirming(true)}
                >
                  {m.onboarding_section_menu_remove()}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Polite per-tick announcement (T024, WCAG). Always rendered so AT reads
          each completion; text changes when the choreography detector reports a
          fresh unchecked→settled transition. */}
      <div className="pv-visually-hidden" role="status" aria-live="polite">
        {choreo.announceItemId
          ? m.onboarding_announcer_tick({
              item: itemLabel(choreo.announceItemId),
            })
          : ''}
      </div>

      {sectionExpanded && (
        <div className="pv-onb-checklist__groups">
          {PAGE_ORDER.filter((page) => itemsByPage.has(page)).map((page) => {
            const items = itemsByPage.get(page) ?? [];
            const completingHere = items.some((i) =>
              choreo.completingIds.has(i.itemId),
            );
            // A settling item stays in the OPEN list (animating in place) until
            // its completing window ends, then drops to the completed area.
            const open = items.filter(
              (i) =>
                i.state === 'unchecked' || choreo.completingIds.has(i.itemId),
            );
            const completed = completedChecklistItems(items).filter(
              (i) => !choreo.completingIds.has(i.itemId),
            );
            const g = groupProgress(page);
            const complete = isGroupComplete(page);
            // Keep the group open through the choreography before FR-031
            // collapses it to its one-line done header (AS-6).
            const expanded = isGroupExpanded(page) || completingHere;
            return (
              <div
                key={page}
                className={clsx(
                  'pv-onb-checklist__group',
                  complete && 'pv-onb-checklist__group--complete',
                )}
              >
                <button
                  type="button"
                  className="pv-onb-checklist__group-header"
                  aria-expanded={expanded}
                  onClick={() => toggleGroup(page)}
                >
                  {expanded ? (
                    <ChevronDown size={13} aria-hidden />
                  ) : (
                    <ChevronRight size={13} aria-hidden />
                  )}
                  <span className="pv-onb-checklist__group-label">
                    {pageLabel(page)}
                  </span>
                  {complete && (
                    <Check
                      size={13}
                      aria-hidden
                      className="pv-onb-checklist__group-done"
                    />
                  )}
                  <span className="pv-onb-checklist__group-count">
                    {g.done}/{g.total}
                  </span>
                </button>

                {expanded && (
                  <ul className="pv-onb-checklist__items">
                    {open.map((item) => (
                      <ChecklistItemRow
                        key={item.itemId}
                        item={item}
                        idPrefix={idPrefix}
                        completing={choreo.completingIds.has(item.itemId)}
                        onJump={(jumpPage) =>
                          void navigate({ to: pagePath(jumpPage) })
                        }
                      />
                    ))}
                    {completed.length > 0 && (
                      <li className="pv-onb-checklist__completed">
                        <ul className="pv-onb-checklist__items">
                          {completed.map((item) => {
                            const doneLabelId = `${idPrefix}-done-${item.itemId.replaceAll('.', '_')}`;
                            return (
                              <li
                                key={item.itemId}
                                className="pv-onb-checklist__item pv-onb-checklist__item--done"
                                data-item-id={item.itemId}
                                data-state={item.state}
                              >
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked
                                  aria-labelledby={doneLabelId}
                                  className="pv-onb-checklist__check pv-onb-checklist__check--done"
                                  onClick={() =>
                                    void setOnboardingItemState(
                                      item.itemId,
                                      'unchecked',
                                    )
                                  }
                                >
                                  <Check
                                    size={14}
                                    aria-hidden
                                    className="pv-onb-checklist__check-icon"
                                  />
                                </button>
                                <span
                                  id={doneLabelId}
                                  className="pv-onb-checklist__item-label"
                                >
                                  {itemLabel(item.itemId)}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* The single find-it spotlight for this (single) mounted checklist. */}
      <FindSpotlight />
    </section>
  );
}

interface ChecklistItemRowProps {
  item: OnboardingItemDto;
  idPrefix: string;
  /** True while the row plays its completion choreography before it drops to
   * the completed area (T024). */
  completing: boolean;
  onJump: (page: OnboardingPage) => void;
}

/** One open (unchecked) item row: label, hover/focus tooltip (WCAG 1.4.13),
 * a manual check affordance for non-auto items, and — when the upstream
 * milestone is missing — a prerequisite reason plus a jump link (FR-010). */
export function ChecklistItemRow({
  item,
  idPrefix,
  completing,
  onJump,
}: ChecklistItemRowProps): React.ReactElement {
  const safeId = item.itemId.replaceAll('.', '_');

  const labelId = `${idPrefix}-lbl-${safeId}`;
  const blocked = item.prerequisite != null && !item.prerequisite.met;
  const label = itemLabel(item.itemId);
  const findActive = useActiveFindItem()?.itemId === item.itemId;

  // Tooltip (FR-008 / WCAG 1.4.13) is the shared `Tooltip` primitive.
  //
  // It was a bespoke reveal twice over and both attempts were wrong. First pure
  // CSS (`:hover, :focus-within`), which pinned the tooltip open after any click
  // inside the row and could not honour Escape at all. Then hand-rolled hover +
  // :focus-visible + Escape state here, which fixed the pinning but still felt
  // clunky — no delay, no positioning, no collision handling. base-ui owns all
  // of that, and it is what every other tooltip in the app already uses.
  //
  // #1103: the shared Tooltip's trigger is a bare, NON-focusable span, so
  // delegating to it made the text pointer-only — keyboard and screen-reader
  // users got nothing, failing 1.4.13 and T017's "hover AND focus".
  //
  // The reveal is therefore owned by the row's CHECKBOX, which is already in the
  // tab order: focusing it opens the popup, blurring or Escape closes it, and it
  // carries `aria-describedby` so assistive tech reads the explanation without
  // depending on the visual popup at all. Driving it from the checkbox rather
  // than making the label span focusable keeps the tab order at one stop per
  // row — a focusable label would have added a second stop per item.
  //
  // Fully controlled, never partly: passing `open={x || undefined}` flips the
  // popup between controlled and uncontrolled, and base-ui then keeps its own
  // internal state — which silently broke Escape. One boolean owns it, with
  // base-ui reporting its hover transitions through `onOpenChange`, so hover
  // and keyboard both flow through the same state.
  const [tipOpen, setTipOpen] = useState(false);
  const tooltipId = `${idPrefix}-tt-${safeId}`;

  const check = () =>
    void setOnboardingItemState(item.itemId, 'manually_checked');
  const dismiss = () => void setOnboardingItemState(item.itemId, 'dismissed');

  // Settling in place (T024): a checked, emphasised row that has not yet
  // dropped to the completed area. Non-interactive during the animation.
  if (completing) {
    return (
      <li
        className="pv-onb-checklist__item pv-onb-checklist__item--completing"
        data-item-id={item.itemId}
        data-completing="true"
      >
        <Check size={14} aria-hidden className="pv-onb-checklist__check-icon" />
        <span className="pv-onb-checklist__item-main">
          <span className="pv-onb-checklist__item-label">{label}</span>
        </span>
      </li>
    );
  }

  return (
    <li
      className={clsx(
        'pv-onb-checklist__item',
        blocked && 'pv-onb-checklist__item--blocked',
      )}
      data-item-id={item.itemId}
      data-blocked={blocked ? 'true' : undefined}
      data-auto={item.hasAutoTick ? 'true' : undefined}
    >
      {item.hasAutoTick ? (
        <span className="pv-onb-checklist__auto-marker" aria-hidden />
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={false}
          aria-labelledby={labelId}
          aria-describedby={tooltipId}
          className="pv-onb-checklist__check"
          onClick={check}
          disabled={blocked}
          // #1103: this control owns the tooltip reveal for keyboard users.
          //
          // Reveals on ANY focus, deliberately not gated on `:focus-visible`.
          // Gating on it was tried first and is wrong here: `:focus-visible` does
          // not match focus moved programmatically after pointer input, which is
          // exactly how assistive tech and `element.focus()` arrive — so the
          // people this fix exists for were the ones it silently skipped. The
          // cost is that a pointer click also pops the tooltip briefly; that is
          // acceptable, since hovering to reach the checkbox already showed it.
          onFocus={() => setTipOpen(true)}
          onBlur={() => setTipOpen(false)}
          onKeyDown={(e) => {
            // 1.4.13 "dismissible". base-ui's own `useDismiss` handles Escape for
            // ITS trigger — but the reveal here is owned by this checkbox, which
            // is not that trigger, so Escape never reaches it. Verified by
            // removing this handler: the e2e Escape assertion fails.
            //
            // This is NOT a hand-rolled reveal: base-ui still owns the popup,
            // positioning, delays and hoverable safe-polygon. Only the dismiss
            // key is bridged from the control that owns the open state.
            if (e.key === 'Escape' && tipOpen) {
              e.stopPropagation();
              setTipOpen(false);
            }
          }}
        >
          <span className="pv-onb-checklist__checkbox" aria-hidden />
        </button>
      )}
      <span className="pv-onb-checklist__item-main">
        {/*
          Shared Tooltip (base-ui): portalled, positioned, with the app's
          standard open/close delays and dismissal. Replaces a bespoke
          CSS-plus-local-state reveal that felt clunky and had to hand-roll
          hover, keyboard focus and Escape itself.
        */}
        <Tooltip
          content={itemTooltip(item.itemId)}
          sideOffset={6}
          popupId={tooltipId}
          open={tipOpen}
          onOpenChange={setTipOpen}
        >
          <span id={labelId} className="pv-onb-checklist__item-label">
            {label}
          </span>
        </Tooltip>
        {blocked && item.prerequisite && (
          <span className="pv-onb-checklist__prereq">
            <Lock
              size={10}
              aria-hidden
              className="pv-onb-checklist__prereq-icon"
            />
            <span className="pv-onb-checklist__prereq-reason">
              {prerequisiteReason(item.prerequisite.reasonKey)}
            </span>
            <button
              type="button"
              className="pv-onb-checklist__prereq-jump"
              onClick={() =>
                item.prerequisite && onJump(item.prerequisite.jumpPage)
              }
            >
              {pageLabel(item.prerequisite.jumpPage)}
            </button>
          </span>
        )}
      </span>
      <span className="pv-onb-checklist__actions">
        {!item.hasAutoTick && (
          <button
            type="button"
            className="pv-onb-checklist__dismiss"
            aria-label={m.onboarding_item_dismiss_label({ item: label })}
            onClick={dismiss}
          >
            <X size={13} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="pv-onb-checklist__find"
          aria-label={m.onboarding_find_label({ item: label })}
          aria-pressed={findActive}
          aria-describedby={item.hasAutoTick ? tooltipId : undefined}
          onFocus={item.hasAutoTick ? () => setTipOpen(true) : undefined}
          onBlur={item.hasAutoTick ? () => setTipOpen(false) : undefined}
          onClick={() => toggleFind(item)}
        >
          <Search size={13} aria-hidden />
        </button>
      </span>
    </li>
  );
}
