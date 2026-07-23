---
status: applied
created: 2026-07-14
applied: 2026-07-14
change_request: "Introduce a framing layer (project -> framing -> session -> frames) per grilling decision Q27. A framing = the light sessions sharing target + optic-train + pointing + rotation within a tunable tolerance (never an exact key) — the co-registerable integration unit across filters and nights. Clustering is suggested and user-adjustable (merge/split/reassign), never authoritative. One target per project holds; a normal project is usually one framing. Mosaic mode = a minimal project flag (multiple framings inherit the project's declared target; per-frame OBJECT/coordinate resolution suppressed) — NO panel entity, NO OBJECT/panel-name string parsing anywhere. Incremental ingestion attribution runs at the Inbox confirm gate (same pre-ingest pass as Q22) suggesting add-to-framing / new-framing / flag-optic-difference / new-project; suggest-never-auto-merge, ranked candidates the user picks; honors Q25 (matching a completed project suggests add + reopen with revoke/warn). Per-framing source view (Q20) and per-framing manifest (Q10). §III boundary holds — the app groups and prepares framings but never stitches or integrates. The concept name is \"framing\", never \"supergroup\". Primary feature spec-008 owns the framing data model; cross-spec deltas recorded in spec-009 (lifecycle) and spec-006 (inventory/sessions)."
scope: "Feature-wide (new Framing entity + hierarchy layer; additive)"
---

## Change Summary

Introduce a **framing** layer between project and session (`project → framing →
session → frames`): a physically-defined co-registerable integration unit
(target + optic-train + pointing + rotation within a tunable tolerance),
suggested-and-adjustable never authoritative, with a minimal mosaic-mode project
flag (no panel entity, no OBJECT-string parsing) and an incremental
ingestion-attribution pass at the Inbox confirm gate that suggests routing new
light sessions into existing/new framings and projects.

## Implementation Progress

- **Tasks completed**: F-1..F-6, US1-1..US1-4, US1-6..US1-9, US1b-1..US1b-2,
  US1c-1..US1c-3, US3-1..US3-7, US4-1..US4-5, X-1, X-2, X-5 (`[x]`). Deferred
  (`[ ]`): US1-5 (source picker in Create dialog), US2-1..US2-7 (Onboard
  wizard), X-3 (spec-010 dedup), X-4 (spec-011 cache invalidation).
- **Current phase**: post-mockup implementation largely complete; this iteration
  opens a new additive **Phase F — Framing layer**.
- **Files changed on branch**: 0 (fresh branch `iterate/q27-framing-spec` off
  `origin/main@6a51dfd5`; this define run adds only `pending-iteration.md`).
- **Potential task completions to mark**: none.
- **Adhoc changes**: `.specify/feature.json` retargeted to spec-008 for this
  iteration (worktree-local; not a product change).

## Impact Assessment

| Artifact | Action | Details |
|----------|--------|---------|
| spec.md | Modify | Add US5 (framing grouping — suggested + adjustable), US6 (mosaic mode as a project flag), US7 (incremental ingestion attribution at Inbox confirm); add FR-013–FR-021; add Key Entities `Framing` + `Mosaic mode flag`; add SC entries; add an Iterations log entry |
| data-model.md | Modify | Add the `Framing` entity (id, projectId, targetId, opticTrainKey, pointing, rotation, tolerance snapshot, sessionIds, clustering provenance = suggested/user_adjusted); add `Project.isMosaic` flag + framing cardinality invariants; add per-framing source-view (Q20) + manifest (Q10) reference fields; note attribution is a suggestion surface, never an auto-merge |
| plan.md | Modify | Add a framing-clustering module boundary (`crates/sessions/` framing grouping over target + optic-train + pointing + rotation tolerance, consuming Q12 complete grouping attributes) + the Inbox-confirm attribution pass (composes with the Q22 pre-ingest sweep in `crates/app/inbox/src/confirm.rs`); constitution re-check (§III boundary — group/prepare only, never stitch); add Phase F |
| tasks.md | Add | Phase F: framing entity + migration, tolerance-based clustering (suggested), merge/split/reassign use cases, mosaic project flag + per-frame resolution suppression, Inbox-confirm attribution suggestions (ranked, user-picks, Q25 reopen), per-framing source view + manifest wiring, tests |
| research.md | Modify | Record the physical-not-textual attribution decision (NINA mosaic panels vary by vendor/user → no OBJECT/panel-name parsing), tolerance-not-exact-key rationale, suggest-never-auto-merge posture (Q22/Q26 alignment), and the §III boundary argument |
| contracts/ | Add | `framing.list` / `framing.merge` / `framing.split` / `framing.reassign` (user-driven adjustment); extend the Inbox confirm response with ranked framing/project attribution candidates; add `project.mosaic` flag to the project create/update surface |
| quickstart.md | Modify (or add) | Scenarios: multi-night same-framing data flows in; a mosaic project's night-2 panel-3 subs match panel-3; optic-train difference flags; matching a completed project suggests add + reopen; clustering suggestion is user-adjustable |

## Risk Checks

- [x] No completed tasks invalidated — Phase F is purely additive. The framing
  layer sits **between** the existing `Project` aggregate and sessions; it does
  not alter project identity, source-link, channel, or notes facets already
  shipped (F-1..F-6, US1/US1b/US1c/US3/US4). `Project.isMosaic` is a new nullable
  flag defaulting to non-mosaic, backward-compatible with existing rows.
- [x] No scope boundary violations — §III holds: the app **groups and prepares**
  framings (a Q20 source view per framing, a Q10 manifest per framing) but never
  stitches, registers, or integrates. Clustering is a suggestion; every merge is
  user-driven and reviewable (§II). The one-target-per-project rule is preserved.
- [x] No downstream dependency breaks — attribution reuses the **same pre-ingest
  sweep as Q22** (one pass does duplicate detection + framing/project
  attribution) and Q12's already-required grouping attributes; the Q25 reopen path
  is the existing `completed → processing` edge with its revoke/warn. Cross-spec
  deltas for the session→framing membership (spec-006) and the reopen-on-match
  interaction (spec-009) are recorded in those specs' iteration logs by the apply
  step; no contract already in production changes shape (new fields are additive).

## Planned Changes

### spec.md

- **US5 — Framing grouping (P2)**: as a user I see my project's light sessions
  grouped into **framings** — each framing being the sessions that share target +
  optic-train + pointing + rotation within a tolerance (all filters and nights of
  one co-registerable integration unit). The grouping is **suggested** and I can
  **merge, split, or reassign** framings; the app never treats its clustering as
  authoritative.
- **US6 — Mosaic mode (P3)**: as a user I can mark a project as a **mosaic**; a
  mosaic project holds **multiple framings (panels)** that all inherit the
  project's declared target, and per-frame OBJECT/coordinate resolution is
  suppressed (panels point away from target center). This is a **flag on the
  project**, not a panel entity, and involves no OBJECT/panel-name string parsing.
- **US7 — Incremental ingestion attribution (P2)**: as a user, when I confirm new
  light sessions at the Inbox gate, the app **suggests** where they belong —
  add-to-existing-framing / new-framing / same-project-but-flag-optic-difference /
  new-project — ranked by framing match, and I pick. Suggestions are never
  auto-applied. Matching a completed project suggests **add + reopen** (with the
  Q25 reopen revoke/warn).
- **FR-013**: A project's light sessions MUST be groupable into **framings**,
  where a framing is the set of light sessions sharing target + optic-train +
  pointing + rotation within a configured **tolerance** (never an exact key).
- **FR-014**: Framing tolerance (FOV-relative pointing offset; rotation drift in
  degrees) MUST be a tunable parameter with a sensible default; it MUST NOT be an
  exact-match key.
- **FR-015**: Framing clustering MUST be presented as a **suggestion** the user
  can adjust — **merge**, **split**, and **reassign** sessions between framings —
  and MUST NOT be treated as authoritative.
- **FR-016**: The one-target-per-project rule MUST hold. A normal (non-mosaic)
  project is usually a single framing (one framing, many filters/nights).
- **FR-017**: A project MUST carry a minimal **mosaic-mode flag**. A mosaic
  project MAY hold multiple framings that all **inherit the project's declared
  target**, and per-frame OBJECT/coordinate resolution MUST be **suppressed** for
  mosaic projects.
- **FR-018**: The system MUST NOT parse `OBJECT` values or panel-name strings for
  attribution anywhere; panel identity is derived only from the physical
  pointing+rotation clustering. There is **no panel entity** — panels are simply
  the framings of a mosaic project.
- **FR-019**: At the Inbox confirm gate, the system MUST run an **attribution
  pass** (the same pre-ingest sweep as Q22) that matches each new light session
  against existing framings/projects by target + optic-train + pointing+rotation
  (tolerance) and **suggests** one of: add-to-existing-framing, add-as-new-framing,
  add-to-project-but-flag-optic-difference, or new-project/unassigned. Multiple
  candidates MUST be **ranked by framing match** and the user picks
  (recommend-then-override).
- **FR-020**: Attribution suggestions MUST NOT auto-merge (§II reviewable). A
  suggestion that matches a **completed** project MUST offer add + reopen and
  honor the Q25 reopen revoke/warn (raw-subs-archived warning).
- **FR-021**: The app MUST support a **per-framing source view** (Q20 — one
  WBPP-ready folder per framing) and a **per-framing manifest** (Q10). It MUST
  NOT stitch, register, or integrate framings (§III boundary).
- **Key Entities**: add **Framing** (co-registerable integration unit: target +
  optic-train + pointing + rotation within tolerance; owns a set of light
  sessions; carries clustering provenance suggested vs user_adjusted) and
  **Mosaic-mode flag** (project-level boolean; suppresses per-frame resolution and
  permits multiple framings inheriting the declared target).
- **Success Criteria**: add SC entries — (a) a project's light sessions across ≥2
  nights and ≥2 filters collapse into one framing when target+optic-train+pointing+
  rotation match within tolerance; (b) the user can merge/split/reassign a framing
  and the change persists; (c) a mosaic project surfaces ≥2 framings all inheriting
  the declared target with no OBJECT parsing; (d) an Inbox confirm of a new session
  matching an existing framing surfaces that framing as the top-ranked suggestion
  and applies only on the user's pick; (e) a match against a completed project
  offers add + reopen.

### data-model.md

- Add the **Framing** entity:
  - `id: Uuid`
  - `projectId: Uuid` (framing belongs to exactly one project)
  - `targetId: Uuid | null` (the framing's target; equals the project's declared
    target for mosaic panels)
  - `opticTrainKey: String` (optic-train identity from Q12/Q17 grouping key)
  - `pointing: { ra, dec }` (representative FOV-relative pointing)
  - `rotation: f32` (representative rotation, degrees)
  - `tolerance: { pointing, rotation }` (snapshot of the tunable tolerance the
    clustering used; documents why these sessions grouped)
  - `sessionIds: Uuid[]` (member light sessions)
  - `clustering: "suggested" | "user_adjusted"` (provenance — never authoritative;
    user merge/split/reassign flips to `user_adjusted`)
  - `sourceViewId?: Uuid` (Q20 per-framing source view, reproducible projection)
  - `manifest?: FramingManifestRef` (Q10 per-framing manifest, rendered on demand)
- Add `Project.isMosaic: Boolean` (default false; backward-compatible nullable in
  storage). When true, per-frame OBJECT/coordinate resolution is suppressed and
  the project MAY hold multiple framings all inheriting `Project` target.
- Invariants: a framing belongs to exactly one project; a light session belongs to
  at most one framing; non-mosaic project ⇒ framings share the single project
  target; mosaic project ⇒ every framing inherits the declared target; framing
  membership derives from physical clustering, never from OBJECT/panel-name
  strings; clustering tolerance is a parameter, not an exact key.
- Note: framing is the **co-registerable integration unit** for lights only;
  calibration sessions are not framing members (they match by the Q18/Q26 rules).
  The attribution surface returns **ranked suggestions**; it never writes a merge.

### plan.md

- Add a **framing-clustering** boundary in `crates/sessions/`: group a project's
  light sessions by target + optic-train + pointing + rotation within tolerance,
  consuming Q12's complete grouping attributes (pointing/rotation are already
  required at confirm). Output is a suggested clustering the user can adjust.
- Add the **Inbox-confirm attribution pass** composing with the Q22 pre-ingest
  sweep in `crates/app/inbox/src/confirm.rs`: one pass emits both
  duplicate-detection and framing/project attribution suggestions (ranked). Uses
  the Q25 `completed → processing` reopen edge for a completed-project match.
- Add merge/split/reassign use cases (`crates/app/core/` framing adjustment) and
  the mosaic-mode flag handling in `project_setup.rs` (suppress per-frame
  resolution when `isMosaic`).
- Add per-framing source-view (Q20) + per-framing manifest (Q10) wiring as
  reproducible projections; never stitch/integrate.
- **Constitution Check**: §III (PixInsight boundary) — the app only groups and
  prepares framings (source view + manifest per framing); it never stitches,
  registers, or integrates. §II (reviewable mutation) — clustering is a suggestion;
  merges are user-driven. §I/§IV — physical (not textual) attribution and tunable
  tolerance are the documented research decision. Verdict: PASS, no amendment.
- Add **Phase F — Framing layer** to the phase list.

### tasks.md

- **Phase F — Framing layer** (new section, additive; task IDs continue the
  existing scheme, e.g. F-Framing-1..):
  - Framing entity + migration (`framing` table; `project.is_mosaic` column,
    default false). (FR-013/FR-016/FR-017)
  - Tolerance-based clustering in `crates/sessions/`: group light sessions by
    target + optic-train + pointing + rotation within a tunable tolerance; emit a
    **suggested** clustering. (FR-013/FR-014/FR-015)
  - Merge / split / reassign framing use cases + contracts (`framing.merge`,
    `framing.split`, `framing.reassign`); flip `clustering` to `user_adjusted`.
    (FR-015)
  - Mosaic-mode flag on project create/update; suppress per-frame OBJECT/coord
    resolution when `isMosaic`; no panel entity, no OBJECT parsing. (FR-017/FR-018)
  - Inbox-confirm attribution pass composed with the Q22 sweep: ranked
    add-to-framing / new-framing / flag-optic-difference / new-project suggestions;
    user picks; completed-project match → add + reopen (Q25 revoke/warn).
    (FR-019/FR-020)
  - Per-framing source view (Q20) + per-framing manifest (Q10) wiring; assert §III
    (no stitch/integrate). (FR-021)
  - Layer-1 tests: multi-night/multi-filter collapse into one framing;
    merge/split/reassign persistence; mosaic multi-framing inherit target;
    attribution ranking + user-pick-only apply; completed-project add+reopen.
  - Quickstart / Windows-E2E scenario for the framing grouping + attribution flow;
    update the spec-037 coverage matrix.

### research.md

- Record the Q27 decision basis: NINA mosaic panels are each their own Target
  named `[Base] Panel [N]` → `OBJECT`, with per-panel offset pointing AND rotation,
  user-overridable and vendor-specific (ASIAIR/SGP/APT/Ekos differ) — so OBJECT
  strings, per-panel coordinates, and rotation are unreliable for attribution. The
  model is **physical, not textual**: cluster by target + optic-train + pointing +
  rotation within a **tolerance** (never an exact key), suggest-never-auto-merge
  (Q22/Q26 posture), and hold the §III boundary (group/prepare, never integrate).
  Mosaic mode is a minimal project flag (inherit declared target; suppress
  per-frame resolution), not a panel entity.

### quickstart.md

- Add scenarios: (a) two nights of L/R/G/B on one target + optic-train + pointing
  collapse into a single framing; (b) a mosaic project's night-2 panel-3 subs match
  the existing panel-3 framing by pointing+rotation; (c) same target, different
  optic-train → suggested to the project but flagged; (d) a new session matching a
  completed project surfaces add + reopen with the raw-subs-archived warning; (e)
  the user splits a framing and the split persists as `user_adjusted`.
