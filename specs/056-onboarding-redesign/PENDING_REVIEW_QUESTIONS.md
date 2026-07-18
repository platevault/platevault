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

## PQ-002 — No per-item undo in v1

The record defines manual check-off and dismiss, plus the single section-level
restore/reset. It does not mention reverting one item.

**Provisional answer**: no per-item undo in v1; restore/reset is the only
revert path. Encoded in spec.md FR-017.

## PQ-003 — Find affordance across pages navigates first

The record defines the L3 spotlight on "the real control" and route change as a
dismissal trigger, but not what happens when the item belongs to a page other
than the current one.

**Provisional answer**: find navigates to the item's page, then spotlights;
route-change dismissal applies to navigations after the spotlight renders
(mirrors the prerequisite jump-link behavior). Encoded in spec.md FR-022.

## PQ-004 — Section never auto-hides at 100%

The record defines permanent remove and restore, but not end-state behavior
when every item is complete.

**Provisional answer**: the section shows a 100% complete state and never
auto-hides; only "Remove getting started" hides it. Encoded in spec.md FR-031.
