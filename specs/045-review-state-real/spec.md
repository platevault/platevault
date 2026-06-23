# Spec 045 — Review-State Real (session + calibration provenance gate)

Status: **draft** (Phase 1 — not yet plan/research/tasks ready).
Branch: TBD (depends on spec 041 plan-listener and spec 035 ingest paths
being fully landed on `main` before implementation begins).

---

## 1. Goal

Make the per-session review-state a living, data-driven gate rather than dead
UI. Today every session row is born `confirmed` — or never created at all
(light frames). This spec wires three things together:

1. **Provenance recording at ingestion** — a per-field source annotation
   (`header_authoritative | inferred | unknown`) persisted alongside extracted
   metadata so downstream decisions are grounded in evidence, not guesswork.
2. **Light-frame session creation at plan-apply** — the missing production path
   that populates `acquisition_session`, created at `confirmed` or
   `needs_review` depending on inferred-field presence.
3. **Type-aware review predicates** — a per-frame-type rule that trips
   `needs_review` only when a field is *both* relevant to that frame type *and*
   was inferred or unknown (no false positives from irrelevant absent fields).

The result: the Sessions "Confirm" action becomes meaningful, the spec 006 US2
AC2 project-selection gate ("session must be confirmed before feeding a
project") can be enforced, and the Inbox surfaces a pre-commit warning when
inferred fields could be corrected before the move.

---

## 2. Background and findings

Analysis in `docs/development/102-session-review-state-analysis.md` establishes:

- **No production path creates `acquisition_session` rows.** The two
  non-test `INSERT INTO acquisition_session` statements are both inside
  `#[cfg(test)]` blocks (`crates/app/calibration/src/matching.rs:1005`,
  `crates/app/core/src/search.rs:383`).
- **Calibration sessions are born `confirmed`** — `plan_listener.rs`
  (`register_master_if_applicable`) hard-codes `state = 'confirmed'` at apply
  time, bypassing `needs_review` entirely.
- **The Confirm / Re-open / Reject actions on the Sessions page are dead
  affordances** — they operate on rows that are absent (lights) or already
  confirmed (calibration).
- **The spec 006 US2 AC2 gate** ("Inventory item not confirmed → offered for
  project selection with review-needed indicator") is un-enforced. The relevant
  TODO is already in `crates/app/projects/src/project_setup.rs:588`.
- **`RawFileMetadata`** (`crates/metadata/core/src/lib.rs`) carries all
  header fields as `Option<String>` with no source annotation. Confidence
  exists only in calibration-matching (`crates/calibration/core`), not
  ingestion.
- **`EvidenceSource`** (`metadata_core::EvidenceSource`) tracks how the
  *frame type* was determined (`imagetyp_header | xisf_property |
  manual_override | none`) but does not cover other fields (filter, target,
  exposure, gain, etc.).

---

## 3. Provenance model

### 3.1 Per-field source annotation

Each extracted metadata field carries a source tag indicating how the value
was determined:

| Source | Meaning |
|---|---|
| `header_authoritative` | Present verbatim in the file header (FITS keyword or XISF property). Value can be trusted without review. |
| `inferred` | Derived by the app (e.g. filter guessed from folder name, target from OBJECT keyword when unresolvable, exposure from filename pattern). Value is plausible but unverified. |
| `unknown` | Field is absent from the header and could not be inferred. Review is needed if the field is type-relevant. |

The confidence scalar used in calibration matching is a separate, orthogonal
concept (match quality between two known values); it is NOT the same as field
provenance and is NOT stored here.

### 3.2 Fields covered

At minimum, provenance is tracked for the fields that drive the type-aware
review predicate (§4):

| Field | DB column target | Notes |
|---|---|---|
| `frame_type` | existing `evidence_source` on inbox evidence rows | Already partially tracked via `EvidenceSource`; extend to include `inferred`. |
| `target` / OBJECT | new per-field annotation | Light frames only; may be inferred from folder structure. |
| `filter` | new per-field annotation | Light + flat frames. |
| `exposure_s` | new per-field annotation | Light + dark frames. |
| `gain` | new per-field annotation | All frame types. |
| `offset` (bias level) | new per-field annotation | Dark + bias frames (where offset-matching is enabled). |
| `binning` | new per-field annotation | All frame types. |
| `temp_c` | new per-field annotation | Dark frames primarily. |
| `camera` / INSTRUME | new per-field annotation | All frame types. |

### 3.3 Where provenance is recorded

Provenance is determined and stored **at ingestion** — when the extractor reads
headers and the classify/confirm pipeline resolves field values. This is the
correct place because:

- Inference happens here (folder-name parsing, filename pattern matching,
  fallback rules).
- The original header bytes are available; after the move they may be on a
  different root.
- Subsequent reads of the DB row carry the provenance without re-running
  extraction.

Provenance is then **carried forward** to the created `acquisition_session` or
`calibration_session` row. The session row does not re-derive it; it inherits
the worst-case provenance across its constituent frames (e.g. if any frame has
`unknown` target, the session's target provenance is `unknown`).

### 3.4 Storage

Options considered:

| Option | Tradeoff |
|---|---|
| Separate `field_provenance` table (one row per field per inbox item) | Maximally queryable; adds a join on every read; schema migration required. |
| JSON column on `inbox_evidence` / `inbox_item` | Flexible; no new table; less queryable; acceptable for v1 since review predicate runs at session-creation time, not query time. |
| Extend `calibration_fingerprint` / new `acquisition_fingerprint` table with nullable source columns | Closest to the existing calibration model; natural fit for session rows; adds columns but keeps the fingerprint concept. |

**Decided approach**: JSON column on `inbox_evidence` carrying a
`field_sources` map (`{field: source_tag}`) for light and calibration frames,
plus corresponding nullable source columns on `acquisition_fingerprint` (to be
created) and `calibration_fingerprint` (extend). This avoids a separate table
while keeping session-level provenance queryable without parsing JSON.

**Research gate**: Before finalizing the storage shape, the plan phase MUST
evaluate whether a `field_provenance` table is preferable for future editability
(e.g. user corrects a field → provenance becomes `user_corrected`, stored per
correction, not overwritten).

---

## 4. Type-aware review predicate

A field trips `needs_review` only when two conditions are both true:

1. The field is **type-relevant** for that frame type.
2. The field's provenance is `inferred` or `unknown`.

### 4.1 Type-relevance matrix

| Field | Light | Dark | Bias | Flat |
|---|---|---|---|---|
| target / OBJECT | required | — | — | — |
| filter | required | — | — | required |
| exposure_s | required | required | — | — |
| gain | required | required | required | required |
| offset | — | required* | required* | — |
| binning | required | required | required | required |
| temp_c | — | required | — | — |
| camera / INSTRUME | required | required | required | required |

`*` offset is type-relevant for dark and bias only when the calibration
matching setting `require_same_offset` is enabled (default ON per spec 043).
When the setting is OFF, an unknown offset does not trip review for darks/bias.

### 4.2 Evaluation rule

```
needs_review = any(
    field_source[f] in {inferred, unknown}
    for f in type_relevant_fields(frame_type)
)
```

If the frame type itself was inferred (`EvidenceSource::None` or a folder-name
heuristic), `needs_review` is always true regardless of other fields — the
type determination is the most critical inference.

### 4.3 Calibration masters

Calibration masters are currently born `confirmed`. With this spec, the
predicate is also applied to masters at apply time. A master with inferred
gain or unknown temp triggers `needs_review` before confirmation. This makes
the Calibration page's existing Confirm action genuinely useful.

---

## 5. Hybrid timing: detect → surface → confirm

The decided approach combines two detection points:

### 5.1 Ingestion-time detection (Inbox, pre-move)

When the Inbox classify/confirm pipeline resolves field values for an item, it
evaluates the type-aware predicate and annotates the inbox item with a
`review_hint` flag and the set of fields that triggered it.

**Inbox surface**: Before the user confirms the move plan, the Inbox detail
pane shows an inline alert for items where `review_hint` is set:

> "Some metadata was inferred — you can correct it before confirming."
> [List of flagged fields with current inferred values]

The user can either correct the fields (via a future metadata-edit path, out of
scope for v1 — see §9) or confirm as-is. Confirming as-is does not block the
move; it means the session will be born `needs_review`.

**Rationale for pre-move surface**: The user has the original files in hand and
can check headers. Post-move, the files may be on a remote drive. This is the
lowest-cost correction point.

### 5.2 Session-creation time (plan-apply, post-move)

At plan-apply completion (in `plan_listener.rs`, after `register_master_if_applicable`
for calibration, or in the new light-frame path described in §6), the predicate
is evaluated against the persisted provenance and the initial `state` is set:

- All type-relevant fields have `header_authoritative` provenance → `state = 'confirmed'`
- Any type-relevant field is `inferred` or `unknown` → `state = 'needs_review'`

**Rationale for session-creation gate**: Even if the user ignores the Inbox
hint, the session state is correct when it lands in the Sessions ledger.
Post-creation correction (Confirm action on the Sessions page) is the
second-chance path.

### 5.3 Timing tradeoff summary

| Criterion | Ingestion-time only | Creation-time only | Hybrid (decided) |
|---|---|---|---|
| User can fix before move | yes | no | yes |
| Session state is always correct | no (state set later) | yes | yes |
| Two surfaces to maintain | no | no | yes |
| Blocking moves on unresolved fields | could be, but shouldn't | n/a | no — hint only |

The hybrid approach is chosen because it surfaces the review need at the lowest
correction cost (Inbox, pre-move) while guaranteeing the session state is
correct regardless of what the user does at that point.

---

## 6. Light-frame session creation (the missing path)

### 6.1 Current state

No production code creates `acquisition_session` rows. The
`crates/app/core/src/plan_apply.rs` apply path handles file moves but does not
insert any session row. The `plan_listener.rs` only inserts
`calibration_session` rows for detected masters.

### 6.2 Required new path

At plan-apply completion, for each inbox item that is NOT a master
(`is_master_item == 0`) and whose frame type is `light`:

1. Group the item's constituent frame files by their session key (target +
   filter + night date + camera + binning, matching the existing grouping logic
   in the inbox classification pipeline).
2. For each session group, insert one `acquisition_session` row with:
   - `id`: new UUID
   - `session_key`: derived key string
   - `frame_ids`: JSON array of the constituent file IDs
   - `state`: `'confirmed'` or `'needs_review'` per the type-aware predicate
   - `source_inbox_item_id`: the inbox item ID (idempotency guard, same
     pattern as calibration masters)
   - `root_id`: the library root the files were moved to (or their source root
     if catalogued-in-place)
   - `created_at`: `datetime('now')`
3. Insert one `acquisition_fingerprint` row per session group with field
   values and their source annotations.

**Session key definition** (research gate — see §9): The exact fields that
constitute a grouping session key for light frames must be researched and
decided. The existing `session_key` string in `calibration_session` uses
`{kind}-{frame_type}`; for acquisition sessions, it must encode target +
filter + night + camera + binning. A separate research decision is required
before the plan phase.

### 6.3 Idempotency

The `source_inbox_item_id` column serves as the idempotency guard, identical to
the calibration master path. A plan reaches `applied` exactly once per link;
the plan link is deleted on transition.

### 6.4 Non-light frames in the Inbox

Dark, bias, and flat frames that are not detected masters (i.e. individual raw
calibration frames rather than stacked masters) do NOT create
`calibration_session` rows — they are still individual files in the library.
The spec 040 master-detection path already handles the stacked-master case.
The question of whether to group raw calibration frames into sessions is deferred
(see §9, open question R-3).

---

## 7. Lifecycle wiring

### 7.1 Transitions

The existing six-state `SessionState` lifecycle and the
`crates/app/lifecycle/src/transition_use_case.rs` machinery are kept
unchanged. This spec adds no new states and no new transitions. The affected
transitions are:

- `needs_review → confirmed` (existing): triggered by the user clicking Confirm
  in the Sessions page detail header. Now meaningful for both acquisition and
  calibration sessions.
- `confirmed → needs_review` (Re-open): existing; available when state is not
  `needs_review`.

### 7.2 Sessions page surface

With `needs_review` sessions now real, the Sessions page UI (currently
half-hidden per spec 043 §5b) is un-gated:

- The **Confirm** action in the top action bar is shown whenever `state ==
  needs_review`. (Already implemented in the UI; previously dead.)
- The **Re-open** overflow action is shown whenever `state != needs_review`.
- The **reviewFilter** Select and URL param (`reviewFilter=needs_review /
  confirmed / rejected`) now filter real data.
- The "Needs review" pill (currently unified in spec 043) now reflects actual
  unreviewed sessions.

### 7.3 Project-selection gate (spec 006 US2 AC2)

`crates/app/projects/src/project_setup.rs:588` contains the TODO:

> "when spec 003 lands, verify `acquisition_sessions.state == 'confirmed'`"

This spec replaces that TODO. When a user attempts to add a session to a project:

- If `acquisition_session.state != 'confirmed'` → the command returns a typed
  error `session_needs_review` with the session ID and the list of flagged
  fields.
- The UI surfaces this as an inline alert on the project source-selection step:
  "Session needs review before it can be added to a project. [Review in
  Sessions]" with a link.
- Confirmed sessions are unblocked.

**Calibration masters**: Calibration sessions that are `needs_review` follow
the same gate — a project cannot use an unconfirmed master.

### 7.4 Inbox hint surface (pre-move)

The Inbox detail pane for a classified item shows, above the confirm CTA:

```
! Some metadata was inferred and may need review
  Target: inferred from folder name ("Andromeda Galaxy")
  Filter: unknown
  [Confirm anyway]  [Edit metadata] (stub — v1 deferred)
```

The "Edit metadata" action is a stub in v1 (see §9). Confirm anyway proceeds
normally; the resulting session will be `needs_review`.

---

## 8. User stories and acceptance criteria

### US1 — Provenance-aware ingestion

**As a user**, when I classify and confirm an Inbox item, I want to see which
metadata fields were inferred so I can decide whether to correct them before
moving.

**AC1**: When the Inbox classify pipeline infers any type-relevant field for a
light frame, the detail pane shows an alert listing the inferred fields before
the Confirm CTA.

**AC2**: When all type-relevant fields are header-authoritative, no alert is
shown (no false positives).

**AC3**: The alert for calibration masters follows the same rule with calibration
type-relevant fields (gain, temp, camera, binning — plus exposure for darks).

### US2 — Sessions born with correct review state

**As a user**, when I open the Sessions page after confirming an Inbox item, I
want the resulting session row to show "Needs review" when inferred metadata was
present, and "Confirmed" when all metadata was authoritative, without any manual
action.

**AC1**: A light-frame inbox item confirmed to the library creates one
`acquisition_session` row per session group.

**AC2**: If any type-relevant field was inferred or unknown, the session's
initial state is `needs_review`.

**AC3**: If all type-relevant fields were header-authoritative, the session's
initial state is `confirmed`.

**AC4**: Calibration masters with inferred type-relevant fields are born
`needs_review` (not auto-`confirmed` as today).

### US3 — Review workflow is functional

**As a user**, I can open a `needs_review` session, inspect which fields were
inferred, correct them (v2 scope), and click Confirm to advance the session to
`confirmed`.

**AC1**: The Sessions page shows a "Needs review" pill for sessions with state
`needs_review` (already implemented; now backed by real data).

**AC2**: The Confirm action in the top action bar is enabled and functional for
`needs_review` sessions.

**AC3**: The `reviewFilter` Select on the Sessions page filters to real
`needs_review` rows.

**AC4**: After the user clicks Confirm, the session state transitions to
`confirmed` and the "Needs review" pill disappears.

### US4 — Project gate enforced

**As a user**, if I attempt to add an unconfirmed session to a project, I see
a clear explanation rather than a silent failure or a confirmed-but-wrong result.

**AC1**: `project.sources.add` (or equivalent command) returns
`session_needs_review` error when the target session is not `confirmed`.

**AC2**: The project source-selection UI shows an inline alert with a link to
the Sessions page for the flagged session.

**AC3**: Confirmed sessions are accepted without restriction.

---

## 9. Open research questions

| ID | Question | Blocks |
|---|---|---|
| R-1 | **Session key definition for light frames**: what fields constitute a grouping key? (target + filter + night + camera + binning? Just night + filter?) Variations between NINA/APT/SGP multi-target sequences affect how session boundaries are drawn. | US2 AC1, plan phase |
| R-2 | **Storage shape for field provenance**: `field_provenance` table vs JSON column vs fingerprint column extension. Evaluate editability (user correction → `user_corrected` provenance), query patterns, and migration cost. | §3.4, plan phase |
| R-3 | **Raw calibration frames (non-masters)**: should individual dark/bias/flat frames create `calibration_session` rows as a group, or remain individual files with no session anchor? | §6.4, deferred or plan phase |
| R-4 | **Metadata edit path (v1 vs v2)**: what fields can the user correct in-app (target, filter, exposure) and at what point (pre-move in Inbox, post-move in Sessions)? The "Edit metadata" action in the Inbox hint is a stub; this question decides when it becomes real. | US3, likely v2 |
| R-5 | **`require_same_offset` interaction**: the offset-relevance rule in §4.1 depends on the calibration matching setting. Does the session review predicate read the live setting at creation time, or is it baked in? | §4.1, plan phase |
| R-6 | **Calibration master review UX**: should a master that is `needs_review` block calibration suggestion (the match engine returns it as a candidate but the UI warns), or block at project-source time? | §7.3, design phase |

---

## 10. Dependencies

| Dep | Direction | Status |
|---|---|---|
| Spec 041 — Inbox plan surface | Must be fully landed; `plan_listener.rs` is the integration point for session creation at apply time. | Landed on `main` |
| Spec 040 — Calibration masters detection | `is_master_item` flag and `calibration_session` insert are the reference pattern for the new light-frame path. | Landed on `main` |
| Spec 006 — Inventory lifecycle | Defines the six-state `SessionState` model this spec populates. The US2 AC2 project gate TODO (`project_setup.rs:588`) is what §7.3 closes. | Landed, gate un-enforced |
| Spec 035 — SIMBAD target resolution | Determines whether OBJECT headers can be resolved to a canonical target or remain `inferred`. Affects how many light-frame sessions are born `needs_review`. | Landed on `main` |
| Task #77 / Spec 045 dependency | Light-frame session creation (§6) is the path that populates `acquisition_session` rows that spec metadata (filter, target, integration) depends on. This spec is a blocker for the Sessions metadata richness work. | This spec |

---

## 11. Out of scope

- **Metadata editing** — correcting inferred fields in-app (pre-move or post-move).
  Deferred to a future spec; the Inbox hint renders the edit CTA as a stub.
- **Retroactive re-evaluation** — running the review predicate over existing
  sessions that were born `confirmed` under the old auto-confirm policy.
  Would require re-running extraction or storing provenance retroactively;
  cost exceeds v1 value.
- **Confidence scalar** — the `[0.0, 1.0]` confidence used by calibration
  matching is NOT stored at ingestion. The provenance tag (`header_authoritative
  | inferred | unknown`) is sufficient for the review predicate.
- **Frame-level review** — review operates at the session level, not per-frame.
  Individual frames with different inferred fields roll up to the session.
- **Re-processing trigger** — confirming a session does NOT re-run calibration
  matching. It only advances the state; any downstream recalculation is
  user-initiated.

---

## 12. Relation to existing specs and code

| Item | File / location | Relation |
|---|---|---|
| `SessionState` enum | `crates/contracts/core/src/lifecycle.rs:86` | Unchanged; this spec populates it with real data |
| `register_master_if_applicable` | `crates/app/inbox/src/plan_listener.rs` | Extended to evaluate review predicate before inserting `state` |
| `acquisition_session` INSERT paths | `crates/app/calibration/src/matching.rs:1005`, `crates/app/core/src/search.rs:383` (both `#[cfg(test)]`) | New production path added in `plan_listener.rs` |
| Project gate TODO | `crates/app/projects/src/project_setup.rs:588, 631` | Closed by §7.3 |
| `EvidenceSource` | `crates/metadata/core/src/lib.rs` | Extended or supplemented to cover fields beyond frame type |
| `RawFileMetadata` | `crates/metadata/core/src/lib.rs` | May gain a parallel `field_sources` map or the annotation lives in the inbox classify layer |
| Sessions UI | `apps/desktop/src/features/sessions/` | Already implemented; un-gated by real data |
| Inbox detail pane | `apps/desktop/src/features/inbox/InboxDetail.tsx` | Gets a new review-hint alert section |
