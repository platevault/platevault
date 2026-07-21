# Spec 058 — SC-009 boundary verification (T043)

**Date**: 2026-07-20
**Task**: T043
**Verdict**: **SC-009 is NOT satisfied by spec 058, and must not be ticked.**

Filename note: the repo's only prior verification-report precedent is
`specs/002-data-lifecycle-state-model/verify-2026-05-23.md`, a whole-spec
speckit-verify report. This is a different artifact — a single-criterion
boundary record — so it is filed under the name T043 names rather than
impersonating a full verify pass. No verification report exists in
`specs/058-inbox-drop-parent-items/` to append to.

## The finding, stated plainly

SC-009 reads, in `spec.md:619-627`:

> When re-derivation removes an item that had an open plan, that item is marked
> superseded, its plan is blocked from application pending the user's decision,
> and the user receives an explicit superseded signal — zero cases of a silently
> discarded or silently retained plan (D-005).

**No part of that mechanism ships in spec 058.** Not partially, not behind a
flag, not in a degraded form. The three functional requirements that would have
built it — FR-020 (plan invalidation on supersession), FR-021 (the user-facing
supersession signal), FR-022 (removal of the folder-wide reclassify block) —
were moved out of this feature and their numbers retired rather than reused
(`spec.md:549-562`). The mechanism is delivered by the follow-on micro-spec
`specs/tiny/reclassify-split-per-item-and-rederivation.md` (PR #1097).

**D-005 itself is not withdrawn.** It remains a recorded decision of this
specification (`spec.md:122-146`): a superseded sibling is invalidated, not
preserved; refined by Q-6 to *supersede and surface, never silently cancel*.
What is descoped is its mechanism, not its standing as a decision. A reader who
sees D-005 in the decisions list and infers that 058 implements it has drawn
the wrong conclusion; that inference is the exact failure mode this record
exists to prevent.

## Why this record exists at all

A previous session found SC-009's own text in `spec.md` reading as a live exit
criterion while its descoping was recorded two sections away. That is precisely
the setup for a completion sweep ticking it by mistake: the criterion is
well-formed, measurable, and adjacent to eleven criteria that genuinely are the
exit bar. Nothing in its own sentence said "not this feature".

That text has since been corrected — `spec.md:619` now carries the inline
`(**NOT met by this feature — do not tick.** ...)` qualifier, and
`tasks.md:233-236` repeats the warning. This file is the third and independent
copy of the same statement, so that the record survives any one of the three
being edited.

## The real exit bar

**Eleven criteria, not twelve.** SC-001, SC-002, SC-002b, SC-003, SC-004,
SC-005, SC-006, SC-007, SC-008, SC-010, SC-011.

SC-005 (the three Real-UI journeys that regressed under #1038 —
catalogue-in-place zero-moves, confirm-then-apply-to-shown-destination,
bulk-reclassify-unblocks-confirm) is the gate that has caught every regression
on this surface so far, per `tasks.md:235-236`.

## Corroborating evidence

Every claim above is a documentation-consistency claim about recorded
decisions, checked by reading the artifacts, not by executing code — there is
no runnable behaviour to control against, because the assertion *is* that the
behaviour does not exist.

| Claim | Where it is recorded |
|---|---|
| SC-009 explicitly not met; do not tick | `spec.md:619-627` |
| D-005 stands as a decision; only its mechanism is descoped | `spec.md:144-146`, `spec.md:555-556` |
| FR-020/021/022 moved out, numbers retired not reused | `spec.md:549-562` |
| Follow-on owner | `specs/tiny/reclassify-split-per-item-and-rederivation.md` (PR #1097) |
| The eleven-criteria exit bar | `tasks.md:233-236` |
| Removing either PG-3 interlock without D-005's mechanism yields an open plan with nothing on disk behind it — the "keep and show" outcome D-005 rejects | `data-model.md:282-284`, `plan.md:141-142`, `spec.md:252` |

The last row is the substantive engineering consequence, and it is why the
descoping is safe rather than merely convenient: both PG-3 interlocks
(`crates/app/inbox/src/reclassify.rs:346-362` and `classify.rs:433`) stay in
place for the duration of 058 (T044). The folder-wide refusal they impose is a
knowingly-surviving coupling (`plan.md:237`), not an oversight. Removing one
without the other would leave the follow-on's requirement unmet while appearing
done — the same shape of error as ticking SC-009.

## Instruction to any later completion sweep

If you are reconciling `spec.md`'s success criteria against a checklist and
SC-009 is unticked, that is correct and deliberate. Leave it. It is closed by
`specs/tiny/reclassify-split-per-item-and-rederivation.md`, not here.
