# Quickstart: Project Create, Onboard, And Edit

**Spec**: 008-project-create-onboard-edit

This quickstart covers integration/test scenarios for the **framing layer**
(Q27, added 2026-07-14). Earlier create/onboard/edit flows are exercised by the
vitest + in-memory Rust tests referenced in `tasks.md`.

## Framing layer (Q27)

### Scenario F1 — Multi-night, multi-filter collapse

1. Create a project on target M31, optic-train "AP130 + ASI2600", one pointing.
2. Ingest L, R, G, B light sessions captured across two different nights, all at
   the same pointing and rotation (within tolerance).
3. **Expect**: the sessions collapse into a **single framing** spanning all four
   filters and both nights; `Framing.clustering == "suggested"`.

### Scenario F2 — Mosaic panel match

1. Mark a project as a **mosaic** (`isMosaic = true`) with declared target NGC 7000.
2. Ingest panel-1 and panel-3 subs (different pointing/rotation per panel).
3. On a later night, ingest more panel-3 subs at the same pointing/rotation.
4. **Expect**: two framings appear, each inheriting the declared target; night-2
   panel-3 subs match the existing panel-3 framing by pointing+rotation; no
   OBJECT/panel-name string is parsed and no panel entity is created.

### Scenario F3 — Optic-train difference flagged

1. Have an existing project on target M42 with optic-train "FRA400 + ASI2600".
2. Ingest a new session on M42 shot with optic-train "RASA8 + ASI6200".
3. **Expect**: attribution suggests the M42 project **with an optic-difference
   flag** (a separate framing), never a silent merge into the existing framing.

### Scenario F4 — Completed-project match: add + reopen

1. Have a **completed** project on target IC 1805.
2. Ingest a new light session matching that project's target + optic-train +
   pointing + rotation.
3. **Expect**: the attribution suggestion offers **add + reopen** and surfaces
   the raw-subs-archived reopen warning (Q25); nothing is merged until the user
   picks it.

### Scenario F5 — User adjusts the suggested clustering

1. With a project whose sessions were auto-grouped into two suggested framings,
   the user **merges** them (or **splits**/**reassigns** a session).
2. **Expect**: the adjustment persists, the affected framing is recorded as
   `clustering == "user_adjusted"`, and an audit event is written. Image files
   are untouched (§III).

### Scenario F6 — Ranked, user-pick-only attribution at Inbox confirm

1. Ingest a new session that partially matches two existing framings.
2. **Expect**: both candidates are surfaced **ranked by framing match**; the
   session is attributed only when the user picks a candidate
   (recommend-then-override); no candidate is auto-applied.
