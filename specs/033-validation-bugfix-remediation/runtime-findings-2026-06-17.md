# Runtime Findings — Interactive Run 2026-06-17

Findings from the user's interactive session against the Windows binary, triaged against current code
and a headless repro (`cargo test -p desktop_shell --test commands` → calibration/targets/projects
commands all pass). Each finding has a **disposition**: REAL (current-code gap, spec it) vs
STALE-BINARY (retest after rebuilding from `origin/033-validation-bugfix-remediation`).

> **Root-cause headline:** "Command `calibration.masters.list` not found" is **impossible** in current
> code — it is registered (`apps/desktop/src-tauri/src/lib.rs:156`, since spec 029) and its command test
> passes. The Windows binary was therefore running **stale code**. `pnpm install` does not recompile
> Rust; only `pnpm tauri dev` (cargo build) does. Several other failures share this cause and must be
> re-tested on a freshly-built binary before being treated as real.

## Disposition table

| # | Finding | Evidence (current code) | Disposition | Maps to |
|---|---------|--------------------------|-------------|---------|
| 2 | calibration: "Failed to load — Command `calibration.masters.list` not found" | Registered `lib.rs:156`; `stub_calibration_masters_list` passes | **STALE BINARY** — retest after rebuild | (US3 once real data lands) |
| 4 | targets: selecting a target → "Failed to load target." | `target.get`→`target_get` exists `target_identity.rs:108`, registered `lib.rs:167`; `stub_targets_get` passes | **STALE BINARY (likely)** — could also be real NotFound until `target_id` plumbed; retest after rebuild | US3 FR-014 / **FR-044** |
| 5 | targets: "new project doesn't do anything" | new-project action from target detail not wired to the create flow | **REAL (wiring)** + retest create after rebuild | **FR-043** |
| 7 | new-project window: spawns at bottom, no layout, create fails, no session/calibration selection | `projects_create` passes headless (so "create fails" ≈ stale); a full `features/projects/wizard/WizardPage.tsx` with calibration+session mapping EXISTS but the bare `create/CreateProjectDialog.tsx` modal is what renders; modal layout is broken in current CSS | **MIXED**: layout + wizard-not-wired + no-selection = REAL; "create fails" = retest after rebuild | **FR-043** |
| 1 | inbox: grouping is by "lane" (jargon = fits vs video); need multiple groupings (date, state, type) | `InboxList.tsx:35` `type GroupBy = 'none' \| 'lane'` | **REAL (UX gap)** | **FR-040** |
| 3 | targets: only group by type/constellation; sort by name/sessions/integration hours | current list options limited | **REAL (UX gap)** — expand/confirm options | **FR-041** |
| 6 | projects: only sort by name and updated | current list options limited | **REAL (UX gap)** | **FR-042** |

## New requirements added to spec 033 (the REAL items)

- **FR-040** (inbox grouping) — US8/US3
- **FR-041** (targets grouping/sort consistency) — US3
- **FR-042** (projects sort consistency) — US5/US8
- **FR-043** (new-project flow: in-window, laid-out, wired wizard with session+calibration selection, create succeeds) — US8/008
- **FR-044** (target detail loads without error for a real target) — US3 (strengthens FR-014)

## Stale-binary items — re-test protocol (do NOT spec as bugs until confirmed)

After the user rebuilds Windows from `origin/033-validation-bugfix-remediation` (full `pnpm tauri dev`
recompile, not `pnpm install`), re-run the same screens. Reopen #2 / #4 / #7-create **only if they still
reproduce** on the fresh binary. If they resolve, they were stale-binary artifacts and need no fix.

## Note on design-v4 boundary
Adding grouping/sort options (FR-040..042) and wiring the existing create wizard (FR-043) is
**enhancement + bugfix of existing surfaces**, not a design-v4 rebuild — consistent with the spec scope.
The wizard already exists; the work is making it the reachable, correctly-laid-out create flow.
