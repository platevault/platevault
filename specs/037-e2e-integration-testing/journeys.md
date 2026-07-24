# Spec 037 — Real-UI E2E Journey Catalog (US3 / Layer-2)

This catalogues every **real-UI end-to-end journey** that Spec 037's Layer-2
(US3) must implement. Each journey drives the *real* built Tauri app through
WebdriverIO + tauri-driver (research D3) and asserts against the *real* backend
over IPC — no mocks except the SIMBAD HTTP boundary (wiremock, area #14).

This document is the planning surface. It does **not** implement the tests; it
defines what each journey covers, its steps, what it must assert, and status.

## Mechanism (shared by all journeys)

- Harness: `apps/desktop/e2e/wdio/harness.mjs` — `freshDb()` + `startHarness()`
  (vite preview serves built `dist` at :5173; `tauri-driver` drives the real
  webview; `remote()` session).
- Runner: `apps/desktop/e2e/wdio/run-all.mjs` (`pnpm test:e2e:wdio`), executed by
  `.github/workflows/e2e.yml` with `VITE_E2E=1`.
- Round-trip reads: `window.__PV_E2E__.invoke(<command>)` — a `VITE_E2E`-gated
  bridge in `main.tsx` (tree-shaken from prod; `withGlobalTauri` is off).
- Each journey owns its lifecycle: `freshDb()` → fresh first-run state; mutating
  journeys operate only inside disposable temp dirs (FR-016).
- CI/local cannot run the webview in WSL — verify via `e2e.yml` or a real
  desktop (FR-013: macOS UI driving is best-effort).

## Required proofs (spec acceptance)

| Proof | FR | Satisfied by |
| --- | --- | --- |
| UI→backend round-trip | FR-008 | J1 (areas #1), J6 (#7), J7 (#12/#14) |
| Filesystem mutation + durable audit | FR-009, FR-016 | J3 (#18/#22) |
| Every top-level screen loads | FR-007 | J2 (#21) |

## Journeys

Status: ✅ implemented & CI-green · 🔭 to implement · ⛔ blocked (see note).
Coverage `#` refer to `contracts/coverage-matrix.md` areas.

### J1 — First-run setup & source registration ✅
- File: `e2e/wdio/journeys/us1-first-run.mjs` · Areas #1, #2, #16 · Task T024 (leg 1)
- Steps: fresh DB → first-run wizard `StepSourceFolders` → add a `light_frames`
  and a `project` source via the `VITE_E2E` path override → advance Tools →
  Configuration → Confirm → "Start scan" (registers via `roots.register.batch`).
- Assert (FR-008): `roots_list` returns both registered folders.
- Status: implemented, CI-green (run 27867137795).

### J2 — All top-level screens load smoke 🔭
- File: `e2e/wdio/journeys/screens-load.mjs` · Area #21 · Task T026
- Steps: from a seeded-or-empty DB, navigate to every top-level route in the
  shell (Inbox, Inventory, Calibration, Sessions, Projects, Targets, Tools,
  Settings, Logs, and any others in `app/router`).
- Assert (FR-007): each screen mounts without console error / error boundary.
- Status: to implement. Cheapest broad coverage — do early.

### J3 — Filesystem plan review → apply (mutation + audit) 🔭
- File: `e2e/wdio/journeys/plan-apply.mjs` · Areas #17, #18, #22 · Task T025
- Steps: seed disposable temp dirs with files → generate a cleanup/archive plan →
  review it in the UI → apply.
- Assert (FR-009/FR-016): the real filesystem side effect occurred (file
  moved/archived under the temp sandbox) **and** a durable audit record exists
  via `audit_list`.
- Status: to implement. Required proof — second-highest priority after J2.

### J4 — Inbox mixed-folder classify & split 🔭
- File: `e2e/wdio/journeys/inbox-split.mjs` · Areas #3, #4
- Steps: register a mixed-content source → open Inbox → classify items → confirm
  the split into lights/calibration/etc.
- Assert: classified items persist; inventory/ledger state reflects the split
  (read via inbox/inventory list IPCs).
- Status: to implement.

### J5 — Calibration suggest & assign 🔭 ⛔
- File: `e2e/wdio/journeys/calibration.mjs` · Area #5
- Steps: with light + calibration sources → open Calibration → view master
  suggestions → assign a master.
- Assert: assignment persists via `calibration_masters_list`.
- Status: blocked — depends on the `calibration.masters` backend being real
  (handover: some backends are still stubs). Unblock before authoring.

### J6 — Project create / onboard / edit + lifecycle + manifests 🔭
- File: `e2e/wdio/journeys/projects.mjs` · Areas #7, #8, #9 · Task T024 (leg 3)
- Steps: create a project (onboard wizard) → edit metadata → add a note / view
  manifest → drive a lifecycle transition (blocked → ready).
- Assert (FR-008): project + note/manifest + lifecycle state round-trip via the
  projects read IPCs.
- Status: to implement (completes the FR-008 project round-trip).

### J7 — Target lookup, identity & SIMBAD resolution 🔭
- File: `e2e/wdio/journeys/targets.mjs` · Areas #12, #13, #14 · Task T024 (leg 2)
- Steps: resolve a target from a FITS `OBJECT` value → trigger SIMBAD resolution
  (HTTP boundary mocked via wiremock) → view target identity / add a note.
- Assert (FR-008): canonical target + identity/notes round-trip via target read
  IPCs; SIMBAD result mapped to canonical name.
- Status: to implement (completes the FR-008 target round-trip).

### J8 — Sessions list / merge / split / transition 🔭 ⛔
- File: `e2e/wdio/journeys/sessions.mjs` · Area #6
- Steps: open Sessions → list → merge/split → transition state.
- Assert: results persist via `sessions_list`.
- Status: blocked — depends on the `sessions` backend being real (handover stub).

### J9 — Processing tool launch wiring + artifact observation 🔭
- File: `e2e/wdio/journeys/tools-artifacts.mjs` · Areas #10 (smoke), #11
- Steps: open Tools → exercise launch *wiring only* (no real PixInsight launch —
  PixInsight boundary) → observe a seeded processing artifact.
- Assert: artifact detection surfaces in the UI / via artifact read IPC.
- Status: to implement.

### J10 — Token pattern builder 🔭
- File: `e2e/wdio/journeys/token-pattern.mjs` · Area #15
- Steps: open the token pattern builder → enter a pattern → preview parse/resolve.
- Assert: resolved tokens render correctly (UI-level, backed by `patterns`).
- Status: to implement.

### J11 — Settings persist & reload 🔭
- File: `e2e/wdio/journeys/settings.mjs` · Area #19
- Steps: change a setting → reload the app/route → confirm it persisted.
- Assert: setting round-trips via the settings read IPC.
- Status: to implement.

### J12 — Bottom log viewer render 🔭
- File: `e2e/wdio/journeys/log-viewer.mjs` · Area #20
- Steps: trigger activity that logs → open the bottom log viewer.
- Assert: log entries render in the stream.
- Status: to implement. Largely covered by J2 screen-load; thin standalone value.

### J13 — Spec 033 carry-over journeys (subscriber startup / ingestion / lifecycle integrity) 🔭
- File: `e2e/wdio/journeys/us{2,3,5}-*.mjs` · Task T027
- Action: complete the 033 journey skeletons, **or** convert each to an explicit,
  documented not-applicable if superseded by J1–J12 above. Resolve per skeleton.
- Status: to triage + implement/retire.

## Notes / dependencies

- **Stub-blocked journeys** (J5, J8, and parts of others): the handover records
  `search.global`, `sessions`, and `calibration.masters` as still-stubbed
  backends. Those journeys must wait until the real backend lands, else they
  assert stub data.
- **No `better-sqlite3`**: all persistence assertions go through read IPCs
  (`roots_list`, `audit_list`, `sessions_list`, `calibration_masters_list`, …),
  not a direct DB reader (decision in research/handover).
- **Suggested order**: J2 (screens-load, broad + cheap) → J3 (required
  mutation+audit) → J6/J7 (complete FR-008 round-trips) → J4/J9/J10/J11 →
  unblock + J5/J8 → J13 triage.
