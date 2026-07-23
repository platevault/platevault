# T078 `/speckit.sync.conflicts` — 041 iterate vs 045/006/035

Recorded 2026-07-09 (retroactive; the underlying edits landed 2026-06-23).

Markers verified present & mutually consistent: 045 SUPERSEDED (spec.md:3),
006 AMENDED (spec.md:3), 035 Extended (spec.md:11) — all cite 041
FR-051/SC-018/FR-052 as authority.

**PASS**: 041↔045 (clean supersession), 041↔035 (coordinate-NN +
name-resolution compose over shared target model).

**FAIL**: 041↔006 session review lifecycle. 041 FR-051 (spec.md:441) +
SC-018 (spec.md:487) mandate REMOVING the six-state review lifecycle and
Confirm/Re-open/Reject; 041's drop landed partially (migration 0050,
SessionsPage affordance removal), but a later 006 iteration (FR-010,
spec.md:89; shipped tasks T420/T421/T403; pending-iteration.md disposition
4) deliberately retained the `ignored` state and shipped Ignore/recover over
a live `review_session()` transition. Shared `SessionState` contract is
still six-state
(`packages/contracts/src/generated/{lifecycle.transition,inventory.session.review,inventory.list}.d.ts`);
spec 002 (enum owner) soft-warns only (spec.md:8).

**Resolution 2026-07-09**: reconciled toward the later shipped 006 decision;
041 FR-051/SC-018 annotated (amendment note in 041 spec.md). Product owner
may override.
