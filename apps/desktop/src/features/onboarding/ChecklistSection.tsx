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
 * `<body>` because `.alm-sidebar` is `overflow: hidden` and was scissoring the
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
 * completed greyed at the bottom of their group) plus the manual check
 * affordance the group-collapse behaviour (FR-031) needs. The per-row dismiss
 * control was removed: the round checkbox writes `manually_checked` and nothing
 * else, and `dismissed` is deliberately unreachable from the UI (the backend
 * still supports it, so a row menu can restore it later without a migration).
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
  MoreHorizontal,
  Search,
} from 'lucide-react';
import { clsx } from 'clsx';
import { m } from '@/lib/i18n';
import { Tooltip } from '@/ui';
import type {
  OnboardingItemDto,
  OnboardingPage,
  OnboardingStateDto,
} from '@/bindings/index';
import './checklist.css';
import {
  isOnboardingSuppressed,
  setOnboardingItemState,
  setOnboardingSection,
  startOnboardingStateSync,
  useOnboardingState,
} from './store';
import { useCompletionChoreography } from './choreography';
import {
  FindSpotlight,
  canFindItem,
  clearFind,
  toggleFind,
  useActiveFindItem,
} from './FindSpotlight';

/** Workflow-stage order (matches the sidebar nav); labels reuse existing nav
 * catalog keys so the checklist adds no new group strings. */
const PAGE_META: Record<OnboardingPage, { path: string; label: () => string }> =
  {
    inbox: {
      path: '/inbox',
      label: () => m.settings_datasources_category_inbox(),
    },
    sessions: { path: '/sessions', label: () => m.common_sessions() },
    calibration: {
      path: '/calibration',
      label: () => m.settings_datasources_category_calibration(),
    },
    targets: { path: '/targets', label: () => m.nav_targets() },
    projects: { path: '/projects', label: () => m.common_projects() },
  };

const PAGE_ORDER: OnboardingPage[] = [
  'inbox',
  'sessions',
  'calibration',
  'targets',
  'projects',
];

/** Route path per page — consumed by the find spotlight to navigate first. */
export const ONBOARDING_PAGE_PATHS = Object.fromEntries(
  PAGE_ORDER.map((p) => [p, PAGE_META[p].path]),
) as Record<OnboardingPage, string>;

/** Dynamic catalog access for registry-keyed item/prerequisite strings. The
 * keys are all present in `messages/en.json` (seeded T011); the itemId → key
 * mapping is `onboarding_item_<id-with-underscores>_<label|tooltip>`. */
const catalog = m as unknown as Record<
  string,
  (args?: Record<string, unknown>) => string
>;
export const itemLabel = (id: string): string =>
  catalog[`onboarding_item_${id.replaceAll('.', '_')}_label`]();
export const itemTooltip = (id: string): string =>
  catalog[`onboarding_item_${id.replaceAll('.', '_')}_tooltip`]();
// The backend sends dotted registry reason keys (e.g.
// `onboarding.prerequisite.inbox.confirm_first`); Paraglide message functions
// are underscore-keyed, so convert before lookup exactly as the item strings do
// — a raw dotted key resolves to `undefined()` and crashes the whole shell into
// the error boundary (only the real backend populates prerequisites, so mocks
// with `prerequisite: null` never reach this path).
export const prerequisiteReason = (reasonKey: string): string =>
  catalog[reasonKey.replaceAll('.', '_')]();

function pageForPath(pathname: string): OnboardingPage | null {
  return PAGE_ORDER.find((p) => pathname.startsWith(PAGE_META[p].path)) ?? null;
}

/**
 * Shared visibility gate for every onboarding surface: honours the
 * deterministic suppression flag (FR-030) and the backend `sectionHidden` flag
 * (explicit removal FR-013 / completion auto-hide FR-031). Returns `null` when
 * the section (and its progress-ring icon) must not render at all.
 */
export function useVisibleOnboardingState(): OnboardingStateDto | null {
  const state = useOnboardingState();
  useEffect(() => {
    void startOnboardingStateSync();
  }, []);
  if (isOnboardingSuppressed()) return null;
  if (!state || state.flags.sectionHidden) return null;
  return state;
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
    const g = groupProgress(page);
    return g.total > 0 && g.done === g.total;
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
        'alm-onb-checklist',
        spotlightActive && 'alm-onb-checklist--spotlighting',
      )}
      aria-label={m.onboarding_section_title()}
    >
      <div className="alm-onb-checklist__head">
        <button
          type="button"
          className="alm-onb-checklist__section-toggle"
          aria-expanded={sectionExpanded}
          onClick={toggleSection}
        >
          {sectionExpanded ? (
            <ChevronDown size={14} aria-hidden />
          ) : (
            <ChevronRight size={14} aria-hidden />
          )}
          <span className="alm-onb-checklist__title">
            {m.onboarding_section_title()}
          </span>
        </button>
        <div
          className={clsx(
            'alm-onb-checklist__progress',
            choreo.pulseActive && 'alm-onb-checklist__progress--pulse',
          )}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={progressText}
        >
          <span className="alm-onb-checklist__progress-text">
            {progressText}
          </span>
          <span className="alm-onb-checklist__progress-track" aria-hidden>
            <span
              className="alm-onb-checklist__progress-fill"
              // eslint-disable-next-line no-restricted-syntax -- dynamic: progress width tracks live done/total
              style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
            />
          </span>
        </div>

        {/* Header overflow menu (T029): the single "Remove getting started"
            action behind a one-line confirm (FR-013). */}
        <div className="alm-onb-checklist__menu-wrap">
          <button
            type="button"
            className="alm-onb-checklist__menu-btn"
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
            <div className="alm-onb-checklist__menu" role="menu">
              {removeConfirming ? (
                <div className="alm-onb-checklist__menu-confirm">
                  <p className="alm-onb-checklist__menu-confirm-text">
                    {m.onboarding_section_remove_confirm()}
                  </p>
                  <div className="alm-onb-checklist__menu-confirm-actions">
                    <button
                      type="button"
                      className="alm-onb-checklist__menu-confirm-yes"
                      onClick={handleRemove}
                    >
                      {m.common_remove()}
                    </button>
                    <button
                      type="button"
                      className="alm-onb-checklist__menu-confirm-no"
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
                  className="alm-onb-checklist__menu-item"
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
      <div className="alm-visually-hidden" role="status" aria-live="polite">
        {choreo.announceItemId
          ? m.onboarding_announcer_tick({
              item: itemLabel(choreo.announceItemId),
            })
          : ''}
      </div>

      {sectionExpanded && (
        <div className="alm-onb-checklist__groups">
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
            const completed = items.filter(
              (i) =>
                i.state !== 'unchecked' && !choreo.completingIds.has(i.itemId),
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
                  'alm-onb-checklist__group',
                  complete && 'alm-onb-checklist__group--complete',
                )}
              >
                <button
                  type="button"
                  className="alm-onb-checklist__group-header"
                  aria-expanded={expanded}
                  onClick={() => toggleGroup(page)}
                >
                  {expanded ? (
                    <ChevronDown size={13} aria-hidden />
                  ) : (
                    <ChevronRight size={13} aria-hidden />
                  )}
                  <span className="alm-onb-checklist__group-label">
                    {PAGE_META[page].label()}
                  </span>
                  {complete && (
                    <Check
                      size={13}
                      aria-hidden
                      className="alm-onb-checklist__group-done"
                    />
                  )}
                  <span className="alm-onb-checklist__group-count">
                    {g.done}/{g.total}
                  </span>
                </button>

                {expanded && (
                  <ul className="alm-onb-checklist__items">
                    {open.map((item) => (
                      <ChecklistItemRow
                        key={item.itemId}
                        item={item}
                        idPrefix={idPrefix}
                        completing={choreo.completingIds.has(item.itemId)}
                        onJump={(jumpPage) =>
                          void navigate({ to: PAGE_META[jumpPage].path })
                        }
                      />
                    ))}
                    {completed.length > 0 && (
                      <li className="alm-onb-checklist__completed">
                        <ul className="alm-onb-checklist__items">
                          {completed.map((item) => (
                            <li
                              key={item.itemId}
                              className="alm-onb-checklist__item alm-onb-checklist__item--done"
                              data-item-id={item.itemId}
                              data-state={item.state}
                            >
                              <Check
                                size={14}
                                aria-hidden
                                className="alm-onb-checklist__check-icon"
                              />
                              <span className="alm-onb-checklist__item-label">
                                {itemLabel(item.itemId)}
                              </span>
                            </li>
                          ))}
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
function ChecklistItemRow({
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

  // Only offer "point me at it" when the spotlight can actually deliver: the
  // item needs a resolvable anchor AND must not be blocked (a blocked item's
  // control does not exist yet by definition — there is no plan row to point
  // at before a plan exists). Everything else relies on the prerequisite line
  // below, which states what to do first and links straight to it.
  const findable = canFindItem(item.itemId) && !blocked;

  // Tooltip (FR-008 / WCAG 1.4.13) is the shared `Tooltip` primitive.
  //
  // It was a bespoke reveal twice over and both attempts were wrong. First pure
  // CSS (`:hover, :focus-within`), which pinned the tooltip open after any click
  // inside the row and could not honour Escape at all. Then hand-rolled hover +
  // :focus-visible + Escape state here, which fixed the pinning but still felt
  // clunky — no delay, no positioning, no collision handling. base-ui owns all
  // of that, and it is what every other tooltip in the app already uses.

  const check = () =>
    void setOnboardingItemState(item.itemId, 'manually_checked');

  // Settling in place (T024): a checked, emphasised row that has not yet
  // dropped to the completed area. Non-interactive during the animation.
  if (completing) {
    return (
      <li
        className="alm-onb-checklist__item alm-onb-checklist__item--completing"
        data-item-id={item.itemId}
        data-completing="true"
      >
        <Check
          size={14}
          aria-hidden
          className="alm-onb-checklist__check-icon"
        />
        <span className="alm-onb-checklist__item-main">
          <span className="alm-onb-checklist__item-label">{label}</span>
        </span>
      </li>
    );
  }

  return (
    <li
      className={clsx(
        'alm-onb-checklist__item',
        blocked && 'alm-onb-checklist__item--blocked',
      )}
      data-item-id={item.itemId}
      data-blocked={blocked ? 'true' : undefined}
      data-auto={item.hasAutoTick ? 'true' : undefined}
    >
      {/*
        EVERY item gets a real, clickable checkbox — including auto-tick ones,
        which used to render an inert bullet. `set_item_state` accepts a manual
        check on any registry item (it does not special-case automatic ones), so
        the inert bullet was a UI-only gap: the row looked actionable, described
        a task, and could not be crossed off. Auto items still tick themselves
        from real work; this just stops the checklist from refusing a check the
        backend would happily accept.
      */}
      <button
        type="button"
        role="checkbox"
        aria-checked={false}
        aria-labelledby={labelId}
        className="alm-onb-checklist__check"
        onClick={check}
        disabled={blocked}
      >
        <span className="alm-onb-checklist__checkbox" aria-hidden />
      </button>
      <span className="alm-onb-checklist__item-main">
        {/*
          Shared Tooltip (base-ui): portalled, positioned, with the app's
          standard open/close delays and dismissal. Replaces a bespoke
          CSS-plus-local-state reveal that felt clunky and had to hand-roll
          hover, keyboard focus and Escape itself.
        */}
        <Tooltip content={itemTooltip(item.itemId)} sideOffset={6}>
          <span id={labelId} className="alm-onb-checklist__item-label">
            {label}
          </span>
        </Tooltip>
        {blocked && item.prerequisite && (
          <span className="alm-onb-checklist__prereq">
            <Lock
              size={10}
              aria-hidden
              className="alm-onb-checklist__prereq-icon"
            />
            <span className="alm-onb-checklist__prereq-reason">
              {prerequisiteReason(item.prerequisite.reasonKey)}
            </span>
            <button
              type="button"
              className="alm-onb-checklist__prereq-jump"
              onClick={() =>
                item.prerequisite && onJump(item.prerequisite.jumpPage)
              }
            >
              {PAGE_META[item.prerequisite.jumpPage].label()}
            </button>
          </span>
        )}
      </span>
      {/*
        No per-row dismiss (X). The round checkbox is the single completion
        affordance; a second destructive-looking control on every row was noise,
        and "remove this one forever" is a rarer intent than "tick it off".
        Whole-section removal still exists in the section header's ··· menu
        (FR-013). The backend `dismissed` state is untouched and still settles
        rows, so a per-item dismiss can return (e.g. behind a row menu) without
        a migration.
      */}
      <span className="alm-onb-checklist__actions">
        {findable && (
          <button
            type="button"
            className="alm-onb-checklist__find"
            aria-label={m.onboarding_find_label({ item: label })}
            aria-pressed={findActive}
            onClick={() => toggleFind(item)}
          >
            <Search size={13} aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}
