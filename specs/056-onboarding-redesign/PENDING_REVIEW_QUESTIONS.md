# Pending Review Questions — Spec 056 Onboarding Redesign

Questions the approved decision record (grill 2026-07-18) does not literally
answer. Each carries the provisional answer already encoded in the artifacts;
overturning one means editing the referenced artifact section, not re-running
the trail.

## PQ-001 — Initial seed derives from DB state (not only restore)

The record mandates that **restore** re-seeds automatic items from actual DB
state. It does not say what the very first seed does for a library that already
has confirmed inventory / projects / launches (e.g. an upgrading 0.x user).

**Provisional answer**: first activation uses the same recorded-state
derivation as restore — one seeding routine, no item ever lies about existing
work. Encoded in spec.md FR-014 and Clarifications.

## PQ-002 — Per-item undo — RESOLVED (owner directive 2026-07-19, OVERTURNED)

The record defines manual check-off and dismiss, plus the single section-level
restore/reset. It does not mention reverting one item.

**Superseded provisional answer** (rescoped by review fix 2026-07-18): no
per-item undo in v1; manual states permanent.

**Resolved answer** (owner directive 2026-07-19): completed items ARE
un-checkable. Review surfaced that "no undo" was stronger than it read —
`upsert_if_unsettled` was the only write path for item state and treated
settled states as terminal, so a single unconfirmed click permanently marked
an item done with no recovery path in the product at all. Since completed rows
are struck through and greyed rather than hidden, their tick looked clickable
and did nothing.

`repo::force_unchecked` is the single deliberate escape hatch; terminality
still holds for re-derivation, live ticks and repeat calls, which must never
*silently* downgrade a decision. Un-checking applies to AUTOMATIC rows too
(owner's call): it cannot make the checklist contradict the library, because
the item re-ticks on the next real event and an explicit restore re-derives it
from database state. Un-checking never runs the FR-031 settle path — it moves
an item away from settled.

Encoded in `crates/persistence/db/src/repositories/onboarding.rs`
(`force_unchecked` + 3 tests), `crates/app/core/src/onboarding.rs`
(`set_item_state`), `OnboardingManualState::Unchecked` in the contract,
`ChecklistSection.tsx` completed-area checkbox, mocks, and an e2e in
`onboarding_choreography.spec.ts`. PQ-001 accepted unchanged (owner note
2026-07-19: greenfield, no 0.x users — derivation over an empty DB is
identical to starting unchecked, and stays correct if a DB is ever rebuilt
against an existing library).

## PQ-003 — Find affordance across pages navigates first

The record defines the L3 spotlight on "the real control" and route change as a
dismissal trigger, but not what happens when the item belongs to a page other
than the current one.

**Provisional answer**: find navigates to the item's page, then spotlights;
route-change dismissal applies to navigations after the spotlight renders
(mirrors the prerequisite jump-link behavior). Encoded in spec.md FR-022.

## PQ-004 — Auto-hide at completion — RESOLVED (user directive 2026-07-18)

The record defines permanent remove and restore, but not end-state behavior
when every item is complete.

**Resolved answer** (supersedes the earlier provisional "never auto-hides"):
per the user's directive ("auto hides when completed for that page, can be
resurfaced/reset through settings") — a page group whose items are all
checked/dismissed collapses to its one-line header with a done checkmark;
when ALL groups are complete/dismissed the entire Getting started section
auto-hides; Settings → Advanced restore brings it back (and a restored,
still-complete section stays visible until a new settling transition).
Encoded in spec.md FR-031/US3 scenarios 6–7/US5, data-model.md
`section_hidden_at`, contracts `sectionHidden`, tasks T004/T021/T023/T030.

## PQ-005 — Recovery for missed milestone events — RESOLVED (owner directive 2026-07-19, OVERTURNED)

The record makes ticks backend-authoritative and restore-filtered, but does
not say what happens if the subscriber misses a live event entirely (published
before subscription during startup, or process killed between the action and
the tick write). Seed/restore would self-heal, but only when the user runs
restore.

**Superseded provisional answer**: accepted v1 limitation — the subscriber is
started before the UI can invoke use cases (ordering obligation noted in
tasks.md T006), and any residual miss is corrected by the next restore. No
startup reconciliation pass in v1 (it would duplicate the seed derivation for
marginal benefit). Documented in analysis.md U1.

**Resolved answer** (owner directive 2026-07-19): the "corrected by the next
restore" escape hatch is not one — nothing tells the user the checklist is
wrong, so they have no reason to run restore. Ticks are event-sourced, so any
missed event leaves an item permanently unchecked although the work really
happened.

`app_core::onboarding::reconcile_missed_events` runs once at startup, right
after `start_onboarding_subscriber` (`apps/desktop/src-tauri/src/lib.rs`), and
re-derives AUTOMATIC items through the existing `target_state_for` — no
duplicated derivation, which was the provisional answer's only stated cost.
It is narrowed to rows that are currently `unchecked` AND whose source is not
`user`:

- `unchecked` + `seed`/`event` = never ticked → eligible; this is the missed
  event being recovered.
- `unchecked` + `user` = a deliberate un-check (PQ-002). Never re-ticked, or
  the un-check would silently undo itself on every launch and read as broken.
- `manually_checked`/`dismissed` stay terminal exactly as everywhere else.

Items with no row yet are skipped, not seeded — `ensure_seeded` already
derives those correctly on the next `state.get`.

This does not violate FR-021 (backend-authoritative-via-subscriber-only). The
invariant that matters is that a mere READ must never auto-tick, which is why
`ensure_seeded` uses `insert_if_missing`; this is a distinct, explicit,
once-per-startup write path deriving from real recorded data, not a read side
effect. It does run the FR-031 settle path, because it stands in for the tick
that was lost and must settle as that tick would have. Failure is never fatal
to startup: it is logged and the app continues, leaving today's behaviour
(restore still repairs).

Encoded in `crates/app/core/src/onboarding.rs` (`reconcile_missed_events`),
the startup wiring in `apps/desktop/src-tauri/src/lib.rs`, and four tests in
`crates/app/core/tests/onboarding_seed_integration.rs` (miss recovered;
user-un-checked row left alone; settled rows untouched; manual items never
auto-ticked).

## Note — `.specify/feature.json` pointer (trail mechanics, not a question)

The speckit specify flow normally repoints `.specify/feature.json` to the new
feature. That flip was made locally in this worktree so the speckit
prerequisite scripts resolved specs/056 during trail authoring, but it was
REVERTED before merge (review fix 3, 2026-07-18): the pointer is shared
tooling state and concurrent lanes must not inherit a silent active-feature
switch. Whoever starts 056 implementation should set the pointer locally via
their own speckit flow.
