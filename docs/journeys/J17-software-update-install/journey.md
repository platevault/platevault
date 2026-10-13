---
id: J17
title: Learn about, install, and restart into a signed software update
version: 3
status: active
last_reviewed: 2026-10-13
actors: [astrophotographer]
surfaces: [shell, settings]
interfaces: [desktop-ui, desktop-ui-macos]
trace:
  - pre-migration journey.md @ git 42c596d6
  - specs/051-tauri-shell-integration/spec.md US10 (FR-029..FR-032, SC-009)
  - GitHub #845 (open — running version never displayed)
  - GitHub #762 (open — tamper-rejection test coverage gap)
  - docs/development/journey-run-2026-07-14.md (2026-07-14 Windows validation pass)
  - astro-plan-mkkgi (owner decision 2026-10-12: install only on the user's choice)
  - apps/prototype/design/R9-UPDATER-OPTIONS.md §1 D1 (ui-harness-v5)
---

## Goal
The user learns a newer PlateVault release exists, chooses when to install
it — now, or when they next quit — through a signature-verified download, and
ends up running the new version. The background check never downloads,
installs or asks for elevation on its own, never interrupts library work,
and never lets an unverifiable package get installed. Done means: Settings →
Advanced reads "up to date" again after a successful install, and every
failure branch (unreachable feed, bad signature, bad download, failed
install) leaves the previously running install completely untouched.

## Preconditions
- P1: A PlateVault build with the updater plugin registered. The frontend
  subscription/install path is a no-op in mock mode (`VITE_USE_MOCKS=true`)
  — that mode cannot exercise the download or install steps. The passive
  check (S1) does not require an installed/packaged build: the 2026-07-14
  Windows validation run exercised it against an unbundled
  `run-dev-mcp.bat` dev build and observed `window.__TAURI__.updater.check()`
  completing normally (docs/development/journey-run-2026-07-14.md).
  Completing an install (S2, S3) needs a genuinely installed build, since the
  install step replaces the running executable.
  Mock-mode coverage for the UI phases (up-to-date, available, check-failed)
  is available via `window.__PV_TEST__.updateState` — set by the Playwright
  spec `tests/e2e/settings_update_check.spec.ts` before navigation so
  `startUpdateSubscription()` seeds the requested phase without a real Tauri
  host. The download/install sequence is covered by
  `apps/desktop/src/data/updateSubscription.test.ts`.
- P2: The configured update endpoint (GitHub Releases `latest.json`) is
  reachable at startup. To exercise S4's network-failure branch, the
  download endpoint must go unreachable after the startup check has surfaced
  an available update and before the user chooses to install (the install
  choice downloads the update the check found).
- P3: For S2/S3, a genuinely newer release signed with the app's release
  keypair is published at that endpoint; for the signature-failure branch
  in S4, a tampered or unsigned artifact is placed there instead (the
  startup check must still detect *an* update so the install choices
  render — the tampering is only caught during the download/verify step).

## Steps
### S1 — Learn that an update is available {#S1}
- **Do:** Launch the app with a newer release published, then look at the
  update notice at the top of the main area; or open Settings → Advanced and
  locate the Software Update section.
- **Expect:** A single background check runs automatically once at app
  startup. When it finds a newer release, an in-app notice reads "Update
  {version} is available." with that release's notes and offers
  **Install now**, **Install on quit** and **Later**; the Software Update
  section reads the same and offers the same two install choices. Otherwise
  the section reads "You're running the latest version." The check never
  blocks the UI, never repeats later in the session, and never interrupts
  in-progress library work.
- **Expect (negative):** The check alone never downloads, stages, installs,
  relaunches or asks for elevation: no installer runs and the app does not
  quit on Windows, and no pkexec/polkit prompt appears on deb/rpm, until the
  user picks Install now or Install on quit. **Later** hides the notice for
  that version for the session and installs nothing. The offer is shown
  in-app only for now. A check that fails (unreachable feed, network error)
  is a distinct "check failed" state (#873) surfaced with the specific error
  message in the Software Update section — never conflated with "up to
  date". The section displays the currently running app version (#845).
- **Planned:** a system notification carrying both Install now and Install
  on quit (owner, 2026-10-13), built per OS in the shared Rust updater and
  tracked separately (astro-plan-c72oo); the in-app notice is the interim.

### S2 — Install now {#S2}
- **Do:** With "Update available" shown, choose **Install now**.
- **Expect:** The app downloads the release artifact and verifies its
  signature against the app's embedded public key; only after verification
  succeeds does it install the update, then relaunch into the new version
  (on Windows the installer takes over and the app quits).
- **Expect (negative):** An artifact whose signature does not verify
  against the embedded key is never installed and never triggers a
  relaunch; the currently running version keeps executing, completely
  unchanged, and no partial install is left on disk. If the update installs
  but the relaunch fails, the section reads "Update installed — restart the
  app manually to finish." (#869), never "update failed".

### S3 — Install on quit {#S3}
- **Do:** With "Update available" shown, choose **Install on quit**, keep
  working, then quit PlateVault (the app menu's Quit PlateVault or
  Cmd/Ctrl+Q, or close the main window).
- **Expect:** The click downloads and signature-verifies the update; the
  notice and section then read "Update {version} will install when you quit
  PlateVault." and still offer Install now. Nothing is installed and nothing
  asks for elevation while the app keeps running. On quit, the app installs
  the verified update and then exits; the next launch runs the new version.
  While the install runs (for example during a deb/rpm password prompt),
  further quit attempts are held so the install is not cut short; after
  five minutes the app exits regardless.
- **Expect (negative):** A failed download or verification leaves nothing
  staged and reports the failure (S4). If the install at quit fails, the app
  still exits, the previous version stays installed, and the next launch's
  check offers the update again. If the app does not start installing within
  a few seconds of the quit, it exits without installing, and a second quit
  before then exits at once. A quit from outside the app exits without
  installing: the macOS Dock or app-switcher Quit, signing out or shutting
  down on any OS (Windows `WM_ENDSESSION`, a Linux session's SIGTERM), a
  force quit, or a crash. Nothing about the update, the Install on quit
  choice or **Later** is saved between launches, so the next launch's
  startup check shows the update notice again. It is never installed at
  launch.

### S4 — Recover from a failed download or install {#S4}
- **Do:** Choose Install now or Install on quit after the update endpoint
  has gone unreachable since detection (network-failure branch), or while a
  tampered/unsigned artifact is present at the endpoint (signature-failure
  branch).
- **Expect:** The failure is reported inline in the notice and the Software
  Update section as "Could not download update: {message}" (or "Could not
  install update: {message}" when the install step fails), carrying the
  specific underlying error rather than a bare generic phrase; both install
  choices stay available to retry.
- **Expect (negative):** No crash and no partial or corrupted install
  results from any failure branch; the previously running install is left
  fully usable and unchanged, and the next app launch's background check
  still runs normally regardless of the prior failure.

### S5 — Confirm the new version after restart {#S5}
- **Do:** After a successful install and restart, reopen Settings →
  Advanced.
- **Expect:** The Software Update section reads "You're running the latest
  version." again, reflecting the freshly-installed release; no
  update-available notice reappears for that same release.

## Success criteria
- SC1: The startup check produces exactly one of up to date, update
  available, or check failed, never blocks or interrupts any in-progress
  library action, and never downloads, installs or elevates on its own (S1).
- SC2: 100% of tampered or unsigned artifacts placed at the update endpoint
  are rejected before install; a genuinely newer signed release is
  detected and installable end-to-end through Install now (S2) and Install
  on quit (S3) — mirrors spec 051 SC-009.
- SC3: Every failure branch (unreachable feed, failed signature, failed
  download, failed install) surfaces its specific underlying error inline and
  leaves the previously running install completely unchanged (S4).
- SC4: After a successful install, the section reads "up to date" with no
  repeat prompt for that release (S5).

## Known gaps
- G1: (dissolved 2026-07-15) — tracked as issue #845; running app version never displayed.
- G2: (dissolved 2026-07-15) — tracked as issue #873; failed update check not surfaced distinctly.
- G3: (dissolved 2026-07-15) — tracked as issue #762; missing tamper/unsigned-artifact test coverage.
- G4: (dissolved 2026-07-15) — tracked as issue #888; owner decided: build staged flow. Superseded 2026-10-12 by the owner's install-on-choice decision (astro-plan-mkkgi): nothing downloads until the user picks Install now or Install on quit.
- G5: (dissolved 2026-07-15) — tracked as issue #881; validation-campaign coverage tracker.

## Delta log
- 2026-07-24 (v2): Status promoted to active. Added `window.__PV_TEST__.updateState`
  injection hook to `updateSubscription.ts` for mock-mode coverage. Added
  `PV_E2E_VERSION_OVERRIDE` dev-tools-gated Rust hook so a test run can spoof a
  lower current version against a fixture endpoint. New e2e spec
  `tests/e2e/settings_update_check.spec.ts` covers up-to-date, ready, and
  check-failed UI phases (spec 051). S1 "negative" updated: failed checks are now
  a distinct `check-failed` state (resolved gap G2 / #873).
- 2026-10-13 (v3): Owner decision 2026-10-12 (astro-plan-mkkgi) replaces the
  #888 download-first flow, which installed at launch (the Windows installer
  quit the app; deb/rpm raised a pkexec prompt). The check now only reports;
  an in-app notice and Settings → Advanced offer Install now and Install on
  quit. S1 rewritten, S2 is Install now, new S3 Install on quit, old S3/S4
  renumbered S4/S5, SC1–SC4 and P1–P3 updated, `shell` surface added. S3
  records which quit routes install (app-menu Quit, Cmd/Ctrl+Q, closing the
  main window), the hold while installing, and the quits from outside the
  app (Dock, sign-out, shutdown, force quit, crash) that exit without
  installing.
