# PlateVault user journeys

This document describes the complete set of user journeys through PlateVault
(formerly Astro Library Manager) at product level — for product review,
manual testers, and onboarding. It is written for humans; for the exact
click-by-click, testid-level, IPC-verified version of each journey, follow the
linked scenario file(s) under `e2e-agentic-test/`.

Ground truth for this document is the five `verify-plans-*` scenario branches
(PRs #416–#420) plus `PRODUCT.md`, `docs/development/orchestrator-handover-2026-07-03.md`,
and the merged code on `redesign-ui-platevault`. Every gap called out below is
sourced from an explicit note in a scenario file or a decision recorded in the
orchestrator handover — nothing here is invented.

## How to read this document

Each journey lists:

- **Goal** — what the user is trying to accomplish.
- **Preconditions** — what state the app/library needs to be in.
- **Narrative flow** — numbered, UI-surface-level steps (not click-by-click).
- **Safety & trust notes** — where the constitution's reviewable-plan and
  no-silent-overwrite guarantees show up in this journey.
- **Scenario files** — the executable, click-by-click version(s).
- **Known gaps** — what's stubbed, deferred, or not yet wired, as of
  2026-07-04.

Two product rules run through almost every journey and are called out once
here instead of being repeated ten times:

- **Reviewable filesystem mutation.** Every move, copy, archive, or delete is
  proposed as a plan first. Confirming an inbox item, generating a cleanup
  plan, or requesting an archive never moves a file by itself — only
  approving and applying a plan does, and every applied action gets an audit
  record.
- **Custody, not conversion.** Cataloguing a source "in place" (an
  already-organized folder) never moves or rewrites files; it only teaches the
  database about them.

---

## Journey 1 — First-run setup → data sources

**Goal:** get a fresh install from an empty database to a working library:
register the folders that hold raw lights, calibration frames, project
outputs, and the inbox drop zone, then keep managing those folders over time
(rename/move a drive, temporarily disable a folder, retire one).

**Preconditions:** empty database (first launch, or after "Restart first-run
setup").

**Narrative flow:**

1. On first launch — or after choosing **Settings → Advanced → Restart
   first-run setup** (a confirm-gated control distinct from the guided-tour
   "Restart guided flow" button) — the app opens the setup wizard
   ("Setup · Step 1 of 5"). If this is a restart, the previously-registered
   folders are pre-filled; nothing is deleted.
2. **Step 1 — Source Folders.** One page presents four folder categories as
   compact cards: Light frames (required), Calibration, Project outputs, and
   Inbox (all optional). For each folder the user adds, they choose whether
   it is **organized** (already sorted into a structure PlateVault should
   respect) or **unorganized** (PlateVault should propose where files belong).
   The inbox category has no such choice — an inbox is unorganized by
   definition. Duplicate or invalid paths are rejected inline; nothing is
   registered with the backend yet (this is a working buffer you can still
   edit).
3. **Steps 2–3 — Processing Tools, Configuration.** The user points at
   PixInsight/WBPP (or another supported tool) and confirms basic
   configuration; both can be skipped/defaulted.
4. **Step 4 — Confirm.** A summary of all four source categories. Only here
   does the wizard actually register the sources and kick off a scan.
5. **Step 5 — Scan.** Each registered folder is scanned; the step completes
   once every source's scan reaches a terminal state (including "0 items" for
   an empty folder). Finish is only enabled once everything is done.
6. Finishing marks setup complete and lands on the Inbox. The completion flag
   sticks — reopening the app goes straight past `/setup`.
7. **Ongoing management (Settings → Data Sources):** each registered root
   shows as a card. From here the user can:
   - **Rescan** a folder to pick up new files.
   - **Remap** a folder whose drive moved: paste the new path, **Verify**
     samples the files at that path (no mutation), and only once verified
     does **Apply remap** persist the new path — PlateVault never moves files
     to follow a remap, it just re-points its own record.
   - **Disable** a source temporarily (reversible, no confirm needed to
     re-enable) — a disabled source drops out of scan/ingest but its history
     stays visible.
   - **Delete** (un-register) an **offline** source permanently — this only
     removes PlateVault's registration; files on disk are never touched, and
     the button is blocked if other records still depend on that root.

**Safety & trust notes:** remap is preview-then-apply and never touches
files; delete is registration-only and blocked when dependents exist; native
folder pickers and "Show in File Explorer" reveal use OS-native affordances
rather than ad-hoc dialogs.

**Scenario files:**
`e2e-agentic-test/003-first-run-source-setup/wizard-fresh-db-journey/scenario.md`,
`.../restart-first-run/scenario.md`,
`.../data-sources-remap-rescan/scenario.md`,
`.../data-sources-disable-delete/scenario.md`,
`e2e-agentic-test/004-native-filesystem-controls/picker-reveal-controls/scenario.md`,
`e2e-agentic-test/016-source-protection-defaults/protection-defaults-take-effect/scenario.md`.

**Known gaps (2026-07-04):**
- Disable/Delete on Data Sources cards require **PR #404** (open) — pre-#404
  these buttons are `console.log` stubs.
- The spec's aspirational 8-step wizard (Welcome → Raw → Calibration →
  Project → Inbox → Detect Tools → Download Catalogs → Finish) never
  shipped; the real wizard is 5 steps as described above.
- Global source-protection defaults (Settings → Cleanup) only started
  actually gating plan-safety checks after PR #405 (now merged) — before that
  it was a silent no-op.

---

## Journey 2 — Ingest → review/reclassify → confirm (move mode)

**Goal:** take files sitting in an inbox drop folder (unorganized) and get
them safely into the registered light-frames library, with any missing
metadata resolved along the way.

**Preconditions:** an inbox root and at least one registered light-frames
root are set up; files exist under the inbox.

**Narrative flow:**

1. On **Inbox**, **Rescan** picks up new folders. Selecting a folder classifies
   it: a folder mixing frame types (e.g. lights and darks together) is never
   shown as one ambiguous "mixed" item — it materializes as several
   single-type items (e.g. `light · Ha · 300s`, `light · Ha · 120s`,
   `dark · 300s`), each still visibly grouped back to its shared source
   folder. Grouping the list by target/frame-type nests correctly, and a
   status-bar breakdown always matches the queue's real contents.
2. If a file is missing a mandatory piece of metadata for its frame type
   (most commonly filter for lights, or target when there's no filter and no
   coordinates), the item surfaces a **needs-review** state: a danger banner
   names exactly what's missing, affected rows get "needs `<attribute>`"
   badges, and **Confirm** is disabled — both in the UI and if you try to
   invoke confirm directly, the backend independently rejects with a typed
   `inbox.missing_path_attributes` error.
3. The user resolves it with the **bulk reclassify** control: select the
   affected files, set the missing value (frame type, filter, exposure, or
   binning), and apply to the selection. This only ever rewrites PlateVault's
   own index — file bytes are never touched, and the override survives a
   rescan. Once resolved, the item automatically re-partitions into a clean
   single-type item and Confirm re-enables.
4. **Confirm** turns a classified item into a plan (never a file move by
   itself). If more than one destination library root is registered for that
   frame type, the user is forced to pick one via a root picker before a plan
   is generated; with exactly one valid root, it's chosen automatically. The
   confirmed item stays visible in the queue, now marked "planned" — it does
   not disappear.
5. Files only move when a plan is **applied** (see Journey 3's review/apply
   step, which is shared with catalogue-mode plans) — the plan's destination
   path is resolved from the per-frame-type folder pattern (e.g.
   `{target}/{filter}/{date}/light/`) and shown in full before anything
   happens.

**Safety & trust notes:** confirming never moves a file — only a plan
application does; a stale plan (source file changed on disk after confirm)
refuses to apply rather than silently applying an outdated action list; a
destination collision is refused rather than silently overwritten, and the
refusal itself gets an audit record.

**Scenario files:**
`e2e-agentic-test/041-inbox-plan-surface/mixed-folder-single-type-subitems/scenario.md`,
`.../missing-mandatory-gate/scenario.md`,
`.../reclassify-field-agnostic/scenario.md`,
`.../confirm-move-vs-catalogue/scenario.md`,
`.../plan-overlay-apply-audit/scenario.md`,
`e2e-agentic-test/025-filesystem-plan-application/plan-overlap-guard/scenario.md`,
`e2e-agentic-test/journeys/grand-inbox-journey/scenario.md` (canonical
end-to-end version of Journeys 2–4).

**Known gaps (2026-07-04):**
- The generic, registry-driven per-property reclassify editor exists at the
  IPC level (`inbox_property_registry` / `inbox_reclassify_v2`); the shipped
  UI only exposes the common fields (frame type, filter, exposure, binning).
- Cross-plan overlap protection (two plans racing to touch the same files)
  requires **PR #408** (open).

---

## Journey 3 — Ingest → confirm (catalogue-in-place)

**Goal:** teach PlateVault about a folder of files that is *already*
organized the way the user wants, without moving a single byte.

**Preconditions:** a light-frames (or similar) root registered with
organization state **organized**, containing already-sorted files.

**Narrative flow:**

1. Files under an organized root are ingested and classified exactly like
   Journey 2 — the same needs-review gate applies if metadata is missing.
2. The deciding factor for move-vs-catalogue is the root's **organization
   state**, not the frame type and not the file's kind. Confirming an item
   that came from an organized root produces a plan whose actions are all
   "catalogue in place": the response reports a move count of zero and a
   catalogue count matching the file count, and no destination-root picker
   is ever shown (there's nothing to pick — the files are staying put).
3. Reviewing the plan (same overlay as Journey 2) shows catalogue actions
   instead of move actions, with the same destructive-destination control
   present (Archive vs System Trash) even though these actions don't need it.
4. Applying the plan writes the files' identity and metadata into the
   library's index. On disk, the file set and content hashes are unchanged
   byte-for-byte — the only thing that happened is the database now knows
   about these files, and they become visible in derived views like Sessions.

**Safety & trust notes:** "organized" is an explicit, per-root choice made in
the setup wizard (or when registering a source), and its consequence (move
vs. leave-in-place) is documented at the point of choice.

**Scenario files:**
`e2e-agentic-test/041-inbox-plan-surface/confirm-move-vs-catalogue/scenario.md`
(Part B), `e2e-agentic-test/journeys/grand-inbox-journey/scenario.md`.

**Known gaps:** none specific to catalogue-mode beyond those noted in
Journey 2 (shared confirm/plan pipeline).

---

## Journey 4 — Sessions review (derived groupings, live membership)

**Goal:** see acquisition sessions (a night's worth of a target/filter
combination) as a read-only, always-current view — without a separate
review/approve step.

**Preconditions:** at least one inbox item has been confirmed and its plan
applied (Journey 2 or 3).

**Narrative flow:**

1. Before anything is confirmed and applied, **Sessions** shows nothing for
   that data — sessions are derived from already-confirmed inventory, never
   from raw, unreviewed scans.
2. Once a plan applies, the corresponding acquisition session(s) appear
   automatically, with counts matching what was actually moved/catalogued.
   There is no additional "review this session" step — the confirm gate the
   user already passed in the Inbox is the only gate.
3. The Sessions list and detail deliberately have **no** Confirm, Re-open,
   Reject, or Ignore controls, and no "review-state" pills (e.g.
   needs-review/candidate) — a prior, now-removed session-lifecycle
   state machine was intentionally dropped in favor of this simpler
   derived-view model.
4. Session metadata (e.g. notes) can still be edited post-hoc; editing does
   not require reopening or re-confirming anything, and doesn't trigger any
   lifecycle transition.
5. Rescanning the inbox does not resurrect a review state or duplicate
   sessions — the view is deterministic over confirmed metadata.

**Safety & trust notes:** this journey is intentionally "boring" — it's a
read view over already-reviewed, already-applied data, and its absence of
review controls is a deliberate simplification, not a missing feature.

**Scenario files:**
`e2e-agentic-test/041-inbox-plan-surface/sessions-derived-inventory/scenario.md`,
`e2e-agentic-test/043-sessions-parity/sessions-inbox-parity/scenario.md`
(Inbox-level interaction parity — filter/camera dropdowns, grouping, virtualized
list, sort).

**Known gaps (2026-07-04):**
- Inbox-level interaction parity (dropdowns, grouping hint footer, `aria-sort`)
  requires **PR #415** (open); without it the Sessions list is functionally
  complete but visually/interaction-behind the Inbox.

---

## Journey 5 — Project lifecycle: create → attach sources → manifests/notes → tool launch → artifacts

**Goal:** create a project, link the acquisition data it should use, document
it (manifests/notes), launch a processing tool against it, and track the
outputs that tool produces.

**Preconditions:** at least one confirmed session exists to attach (from
Journey 2/3); a processing tool (e.g. PixInsight) configured with an
executable path is useful but not required to exercise creation.

**Narrative flow:**

1. **Create** (`/projects/new`): name the project, optionally pick a
   processing-tool profile and initial sources. Typing a name that already
   exists (case-insensitively) surfaces an inline field error immediately,
   not a generic toast, and creation is blocked from that step. On success,
   a plain toast confirms creation and the project's on-disk folder
   structure (e.g. `lights/`, `darks/`, `flats/`) is created automatically —
   this "mkdir-only" plan auto-applies (see Known gaps for why that's safe)
   while still leaving an audit record and a reviewable plan row behind it.
   If a file already occupies where a folder should go, creation still
   succeeds but the toast says so and the folder plan stays available for
   review instead of being silently skipped.
2. **Attach sources** (Edit pane): "Add sources" opens a picker pre-filtered
   to unlinked, already-confirmed sessions only — you cannot attach
   not-yet-confirmed inbox data. Removing a source is immediate except for
   the *last* remaining source, which requires an inline confirmation
   ("You can't remove the last confirmed source.") because removing it drops
   the project back to an incomplete-setup state. A project in a locked
   lifecycle state (e.g. archived) refuses edits with a clear message instead
   of silently no-op-ing.
3. **Review the real numbers**: the project detail's per-channel (per-filter)
   breakdown shows actual sub-frame counts and total integration time
   computed from the attached sessions, formatted as hours/minutes — not a
   placeholder dash.
4. **Manifests & notes**: every lifecycle-relevant change (creation, source
   change, later a completed cleanup/archive) appends a new manifest
   snapshot — manifests are generated documentation, never overwritten, so
   the history of "what did this project look like at each point" is
   preserved. Notes are freehand, auto-saved a few seconds after typing
   stops, with a live byte counter and a hard size cap.
5. **Launch a tool**: with an executable configured, "Open in {tool}" spawns
   the process without touching the project's lifecycle state, refuses to
   launch if the project's working directory would resolve outside every
   registered root (a containment safety check), and if the OS itself fails
   to spawn the process, that failure is reported plainly rather than
   silently swallowed.
6. **Observe outputs**: while the project is open, a per-project watcher
   attaches to its output folder only (not the whole library) and records
   new files as artifacts with a kind (intermediate/master/final) and
   confidence; artifacts written while the project was closed are picked up
   the next time it's reopened. PlateVault never modifies or deletes an
   artifact file itself.

**Safety & trust notes:** mkdir-only project scaffolding auto-applies
because every action in that plan is a folder creation (never a move/copy/
delete of user files) — anything beyond that still requires explicit review;
tool launches are contained to registered roots; manifests are an
append-only audit trail, not a mutable summary.

**Scenario files:**
`e2e-agentic-test/008-project-create-onboard-edit/create-wizard-field-errors/scenario.md`,
`.../edit-project-sources/scenario.md`,
`.../per-channel-integration-time/scenario.md`,
`.../project-mkdir-auto-apply/scenario.md`,
`.../project-path-root-anchoring/scenario.md`,
`e2e-agentic-test/024-project-manifests-and-notes/manifests-notes-reveal-labels/scenario.md`,
`e2e-agentic-test/011-processing-tool-launch/tool-launch-containment/scenario.md`,
`e2e-agentic-test/012-processing-artifact-observation/artifact-attribution/scenario.md`,
`e2e-agentic-test/journeys/full-project-lifecycle/scenario.md` (canonical
end-to-end version of Journeys 5–7; this is the release gate for the
projects area).

**Known gaps (2026-07-04):**
- Project folders were only actually created on disk starting with **PR
  #411** (merged). A related bug — folders landing under the app's working
  directory instead of the user's registered project library — is fixed by
  **PR #414** (open); until it merges, new project folders can land in the
  wrong place.
- Rejecting an unconfirmed session as a project source is enforced by the
  backend but has no dedicated UI path to trigger it today.
- The flagship `CreateProjectDialog` component (with polished per-field
  error mapping) is built and tested but not actually mounted by the router
  — the real create flow goes through the setup-style wizard instead. This
  is a product decision, not a bug, but is worth knowing if you go looking
  for the "other" creation UI.

---

## Journey 6 — Cleanup: scan → review → apply

**Goal:** find and safely reclaim disk space from intermediate/redundant
processing outputs a project no longer needs, without ever deleting
protected files or moving anything without review.

**Preconditions:** a project with processing outputs of mixed kind
(intermediate/master/final).

**Narrative flow:**

1. From a project's Outputs/Cleanup section, **Scan for cleanup candidates**
   runs a read-only preview — no plan is created yet. It groups candidates by
   kind (Intermediates/Masters/Finals), marks protected items as locked and
   unselectable, and totals the reclaimable size. Nothing on disk is touched
   by scanning.
2. The user chooses a destructive destination — **Archive folder** (default)
   or **System trash** — and clicks **Generate cleanup plan**. This is the
   point a real, reviewable plan is created; the destination is fixed at this
   point and shown read-only in the review overlay from here on.
3. The review overlay lists every affected item 1:1 with the plan; if any
   protected item is included, its protection must be explicitly
   acknowledged before **Approve & apply** becomes clickable. The user can
   discard the plan instead — disk stays untouched either way until apply.
4. Applying shows live per-item progress ("Applying N of M…"); files move to
   the chosen destructive destination (never deleted outright when the
   destination is Archive), and re-scanning afterward shows them gone from
   the candidate list. An empty plan (nothing selected) cannot be approved.

**Safety & trust notes:** two-step generation (preview, then a separate
"generate" action) means a scan alone can never turn into a mutation; the
per-item protection-acknowledgement gate means a user cannot approve-and-miss
a protected file by accident.

**Scenario files:**
`e2e-agentic-test/017-cleanup-archive-review-plans/cleanup-scan-review-apply/scenario.md`,
`e2e-agentic-test/journeys/full-project-lifecycle/scenario.md` (Phase E).

**Known gaps (2026-07-04):**
- The cleanup review UI itself requires **PR #413** (open) — pre-#413 the
  project detail's Cleanup section has no "Scan for cleanup candidates"
  button at all.
- A pre-flight free-space check (would this cleanup even fit at the
  destination) is not implemented; every generator currently reports a
  hardcoded zero for required bytes.

---

## Journey 7 — Archive → (delete from archive)

**Goal:** move a finished project's files out of the active library into an
archive location, as a deliberate, plan-gated, reviewable step, and — later
— permanently remove archived files if desired.

**Preconditions:** a project in a `completed` lifecycle state.

**Narrative flow:**

1. Clicking "Archive" on a completed project is **refused** unless a
   filesystem plan for the archive already exists and has been applied —
   the app never silently flips a project's lifecycle state.
2. Generating the archive plan, reviewing it (protected items must be
   acknowledged, same as cleanup), approving, and applying moves the
   project's files into an app-managed archive folder
   (`.astro-plan-archive/<planId>/`) and only *then* does the project's
   lifecycle actually flip to `archived`. The project's Edit pane becomes
   read-only at that point.
3. The **Archive** page lists archived projects with their real audit
   history (not placeholder rows) — but scope is deliberately narrower than
   you might expect (see Known gaps: no Masters/Targets tabs, no Sessions
   tab, no working Restore button yet).
4. From the Archive page, the user can **Send to trash** (moves to the OS
   Recycle Bin) or **Delete permanently**, which requires typing the literal
   word `DELETE` to confirm — a half-typed or lowercase confirmation leaves
   the button disabled. "Reveal" uses the platform-native label ("Show in
   File Explorer" on Windows) and is disabled when there's nothing to reveal.

**Safety & trust notes:** archiving is the one and only legitimate way a
project's lifecycle reaches `archived` — every other edge into that state
requires the same plan-gate; permanent deletion requires a literal typed
word, not just a click-through confirm.

**Scenario files:**
`e2e-agentic-test/017-cleanup-archive-review-plans/archive-lifecycle/scenario.md`,
`e2e-agentic-test/journeys/full-project-lifecycle/scenario.md` (Phase F).

**Known gaps (2026-07-04) — read before testing or demoing this journey:**
- **There is no shipped UI button that generates an archive plan yet.**
  Archive-plan generation is currently only reachable by invoking the
  backend command directly; the "Archive" action in the UI only refuses the
  transition until a plan exists. This is the single most important gap in
  this journey.
- **Restore (un-archive) is deferred by design (decision D15).** It would be
  a filesystem mutation (moving files back), so it needs its own reviewable
  plan generator, which doesn't exist yet — the Restore control ships
  hidden/disabled rather than pretending to work.
- **No Master/Target archival concept exists** (decision D7) — the Archive
  page only covers Projects (plus Sessions/Plans-as-rows were considered and
  rejected). No Sessions tab either (decision D14) — sessions don't have a
  lifecycle to archive since Journey 4's derived-inventory redesign.
- Archive destination and layout polish (single-column page, richer list,
  native reveal labels) requires **PR #415** (open) for parts of the page;
  the core plan-gated archive/trash/delete flow works without it.
- Archive plans move files to an app-managed folder rather than the
  originally-specced token-pattern destination (documented deviation, PR
  #401 / decision D24) so that trash/delete can key off the plan id.

---

## Journey 8 — Calibration: ingest cal frames → masters → matching

**Goal:** get calibration master frames (darks/flats/bias) into the library
as individually tracked items, and match them against acquisition sessions
that need calibration.

**Preconditions:** a calibration root registered; master and light frames
available to ingest.

**Narrative flow:**

1. Master calibration files ingest through the same Inbox pipeline as lights
   (Journey 2): a folder containing several master files (e.g. two darks, a
   flat, a bias) classifies as separate individual items, not one folder-level
   aggregate — each carries its own type and fingerprint (gain, temperature,
   binning, filter where relevant).
2. Confirming and applying registers each master into the calibration store.
   The **Calibration** page shows one row per master file, with
   kind-conditional fingerprint columns (a dark's temperature/gain columns
   don't apply to a bias, and show as a dash by design, not a bug) — master
   *light* frames never appear here.
3. On a project (or the Calibration page's matching view), selecting a
   master surfaces ranked candidate sessions to calibrate, each showing real
   context (target, filter, night, frame count) rather than opaque ids.
   Sessions whose fingerprint doesn't match a hard rule (e.g. wrong gain) are
   shown with a mismatch indicator rather than silently hidden.
4. Assigning a master to a session is advisory and confirmable — cancelling
   fires no backend call; confirming records the assignment and its usage
   count.
5. An "Offset tolerance" setting (Settings → Calibration) controls whether
   sessions with a different sensor offset can match; it persists across
   restarts and immediately changes what the matching engine considers a
   clean candidate.

**Safety & trust notes:** matching never auto-applies a calibration
assignment — every match is proposed with confidence and must be confirmed;
hard-rule mismatches are surfaced, not hidden, so a user doesn't accidentally
calibrate with the wrong dark.

**Scenario files:**
`e2e-agentic-test/040-calibration-masters/masters-detection-individual-items/scenario.md`,
`e2e-agentic-test/007-calibration-matching/match-suggest-assign-tolerances/scenario.md`,
`e2e-agentic-test/journeys/calibration-journey-ingest-to-match/scenario.md`
(canonical end-to-end version of Journey 8 — also the data source that
Journeys 4's `043-sessions-parity` and Journey 9's matching-adjacent checks
build on).

**Known gaps:** none beyond the general "Calibration page shows only
dark/flat/bias columns; `dark_flat`/`bad_pixel_map` kinds never surface in
v1" — this is by design, not a defect.

---

## Journey 9 — Targets & planning (what's real today vs. 044/047-pending)

**Goal:** browse the target catalog, resolve new targets against SIMBAD, and
review per-target identity/aliases/notes — while understanding which parts of
the "planner" view are real astronomy today and which are still placeholders.

**Preconditions:** a bundled seed catalog (loaded automatically) and,
optionally, a network connection for SIMBAD lookups.

**Narrative flow (real today):**

1. **Targets** lists the seeded catalog (thousands of rows, virtualized for
   smooth scrolling), searchable by name or known alias (e.g. searching
   "M31" or "Andromeda" both find the same row), sortable by any column with
   a single active sort indicator, and optionally groupable (e.g. by
   catalogue).
2. **Add target** offers local, offline typeahead first; confirming a local
   match persists exactly one canonical target row (re-adding the same
   target never creates a duplicate). For a target not in the local seed,
   PlateVault resolves it on demand against SIMBAD and caches the result for
   next time; if SIMBAD is unreachable or the name doesn't resolve, the
   dialog says so inline rather than fabricating a row.
3. **Target detail** shows real identity data (designation, type,
   coordinates, source, optional catalog id), lets the user add/remove their
   own aliases (catalog-provided aliases can't be removed) — and a
   user-added alias immediately becomes searchable too — set or clear a
   display label (which propagates to the list), and write/save observing
   notes.

**Narrative flow (stubbed/pending — 044 Track B / 047 Track A):**

4. The Targets table's astronomy-shaped columns — Max altitude, Tonight's
   sparkline, Visible-tonight, Opposition, Lunar separation, recommended
   Filters, and Image time — are **not** computed from real coordinates,
   date, or observer location yet. They are deterministic placeholders
   derived from a hash of the target's designation, so they look stable
   across reloads but are not astronomically meaningful. Opposition and
   Sessions columns always render as a dash today (Sessions awaits a
   session-linkage backend feature; Opposition awaits an ephemeris engine).
   The target detail's altitude graph uses a fixed placeholder observer
   latitude (disclosed in the graph's own title), and its Coverage/Transit
   sections are explicit stub notes rather than real data.
5. "Favourites"/"My Targets" is currently a browser-local (`localStorage`)
   preference only — it is not backed by the database yet, so it won't
   follow the user across machines or survive certain resets.

**Safety & trust notes:** this journey is the one place in the product where
the honesty of a stub matters as much as its function — the design intent is
that a stub must never be mistaken for real astronomical data (hover
tooltips disclose "approximate" wording and the placeholder latitude), and
the project's own verification plan treats a *concrete-looking fabricated
value* as a failure, even though the column itself is allowed to be a stub.

**Scenario files:**
`e2e-agentic-test/035-targets-catalog/list-search-aliases-sort/scenario.md`,
`.../simbad-resolve-on-demand/scenario.md`,
`e2e-agentic-test/023-target-identity/detail-identity-aliases-notes/scenario.md`,
`e2e-agentic-test/044-planner-stubs/planner-columns-visibly-stubs/scenario.md`
(the authority on the real-vs-stub boundary — read this one first if you're
unsure whether a planner number is real).

**Known gaps (2026-07-04):** everything in the "stubbed/pending" section
above. Real astronomy for these columns is planned under specs 044 (Track B
— astronomy-engine unification, Lorentzian filter model) and 047 (Track A —
Moon/filters), gated on an ephemeris/observer backend; session-linkage and
favourites-persistence are separate, smaller backend gaps. `aria-sort` on the
Targets table's active sortable column requires **PR #415** (open).

---

## Journey 10 — Settings, appearance, and i18n

**Goal:** configure the app's look and feel, per-library behavior defaults,
and confirm the app is fully localized with no raw technical strings leaking
to the user.

**Preconditions:** setup completed with at least one registered source.

**Narrative flow:**

1. **Settings** groups 12 panes into three sections — Library (Data Sources,
   Equipment, Ingestion, Naming, Catalogs, Planner), Processing (Tools,
   Calibration, Cleanup), and Application (General, Advanced, Audit Log).
   Every pane auto-saves; there is no global "Save" button anywhere.
2. **Appearance** (General pane) offers four named themes plus a
   "System"-follows-OS option; switching applies live (no reload needed) and
   survives a full app restart. Density and font-size preferences live here
   too, though font-size is currently visual-only and not yet wired to
   anything outside the pane (see Known gaps).
3. **Ingestion** settings (symlink-following, hashing eagerness) persist
   through a dedicated backend round-trip and survive a restart, though no
   scan pipeline reads them yet.
4. **Target Planner** exposes a single "usable altitude" threshold
   (0–90°, default 30°) that clamps out-of-range input and immediately
   affects the (currently stub) Targets planner view.
5. The **bottom log panel** (collapsible strip) is a layout participant, not
   an overlay — expanding it shrinks the main content area rather than
   covering it. It filters by severity (chips for Error/Warn/Info/Debug),
   restricts sources to a fixed, known set, only shows deep diagnostics once
   the log level is turned down to Debug, and exports the visible log window
   as JSON only.
6. Cross-cutting to every page: a left sidebar groups Capture/Library/Work
   destinations plus a pinned Settings entry, with route-driven active
   states and a collapse/expand that persists; a global command palette
   (Ctrl+K) jumps to pages or live-searches the backend for targets/sessions/
   etc.; every page keeps its header/action bar pinned while only its content
   scrolls, at a minimum supported window size of 1100×720; and every
   user-facing string — including backend error codes and audit-log detail
   text — routes through the translation catalog rather than leaking a raw
   key or an English-only backend string.

**Safety & trust notes:** none of this journey involves filesystem mutation,
but its correctness (i18n coverage, layout convention, focus management)
underpins how trustworthy every other journey *feels* — a raw error code or a
broken layout during a destructive-plan review undermines the safety story
the rest of the app is built on.

**Scenario files:**
`e2e-agentic-test/018-settings-configuration-model/appearance-themes/scenario.md`,
`.../panes-and-persistence/scenario.md`,
`e2e-agentic-test/019-bottom-log-viewer/severity-filter-and-sources/scenario.md`,
`.../event-source-class/scenario.md`,
`e2e-agentic-test/043-ui-redesign-platevault/shell-left-nav/scenario.md`,
`.../global-search-command-palette/scenario.md`,
`.../layout-convention-1100x720/scenario.md`,
`.../a11y-keyboard-and-aria-sort/scenario.md`,
`e2e-agentic-test/046-i18n-error-codes/no-raw-keys-and-translated-errors/scenario.md`.

**Known gaps (2026-07-04):**
- Appearance's **Font size** control is component-local state only — it
  changes nothing outside the settings pane it lives in.
- The Ingestion settings pane persists values no scan pipeline currently
  consumes.
- Audit-log detail text now localizes correctly for the standard case (PR
  #410, merged) — but only for events emitted after that fix; historical
  rows fall back to their originally stored English text (documented as
  intentional, decision D23).
- `aria-sort` announcements across the app's six sortable tables require
  **PR #415** (open); pre-#415, `aria-sort` is deliberately unset anywhere.
- A `/dev/contracts` command-palette entry exists only in developer-mode
  builds (compile-time gated off in release, per spec 021) — its absence in
  a release build is expected, not a bug.

---

## Cross-journey index

| # | Journey | Canonical scenario |
|---|---|---|
| 1 | First-run setup → data sources | `003-first-run-source-setup/wizard-fresh-db-journey` |
| 2 | Ingest → review/reclassify → confirm (move) | `journeys/grand-inbox-journey` |
| 3 | Ingest → confirm (catalogue-in-place) | `journeys/grand-inbox-journey` |
| 4 | Sessions review (derived) | `041-inbox-plan-surface/sessions-derived-inventory` |
| 5 | Project lifecycle create→artifacts | `journeys/full-project-lifecycle` |
| 6 | Cleanup: scan→review→apply | `017-cleanup-archive-review-plans/cleanup-scan-review-apply` |
| 7 | Archive → delete from archive | `017-cleanup-archive-review-plans/archive-lifecycle` |
| 8 | Calibration: ingest→masters→matching | `journeys/calibration-journey-ingest-to-match` |
| 9 | Targets & planning (real vs. stub) | `044-planner-stubs/planner-columns-visibly-stubs` |
| 10 | Settings/appearance/i18n | `018-settings-configuration-model/panes-and-persistence` |

For execution order, PR-gating, and shared test-data continuity across all
of the above, see `e2e-agentic-test/MASTER-PLAN.md`.
