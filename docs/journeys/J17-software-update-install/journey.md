---
id: J17
title: Learn about, install, and restart into a signed software update
version: 1
status: active
last_reviewed: 2026-07-14
actors: [astrophotographer]
surfaces: [settings]
interfaces: [desktop-ui]
trace:
  - docs/product/journeys/J17-software-update-install/journey.md @ 66026463
  - specs/051-tauri-shell-integration/spec.md US10 (FR-029..FR-032, SC-009)
  - GitHub #845 (open — running version never displayed)
  - GitHub #762 (open — tamper-rejection test coverage gap)
---

## Goal
The user learns a newer PlateVault release exists, installs it through a
signature-verified download, and ends up running the new version — without
the background check ever interrupting library work, and without an
unverifiable package ever getting installed. Done means: Settings → Advanced
reads "up to date" again after a successful install-and-relaunch, and every
failure branch (unreachable feed, bad signature, bad download) leaves the
previously running install completely untouched.

## Preconditions
- P1: A bundled/packaged PlateVault build. The updater plugin reports itself
  unavailable in an unbundled dev run, and the frontend subscription/install
  path is a no-op in mock mode (`VITE_USE_MOCKS=true`) — neither exercises
  this journey.
- P2: The configured update endpoint (GitHub Releases `latest.json`) is
  reachable, or deliberately unreachable to exercise the failure branch.
- P3: For S2, a genuinely newer release signed with the app's release
  keypair is published at that endpoint; for the negative branch in S3, a
  tampered or unsigned artifact is placed there instead.

## Steps
### S1 — Learn the update state {#S1}
- **Do:** Open Settings → Advanced and locate the Software Update section.
- **Expect:** The section reads either "You're running the latest version."
  or "Update available: version {version}", reflecting a single background
  check performed automatically once at app startup; the check never blocks
  the UI, never repeats later in the session, and never interrupts
  in-progress library work.
- **Expect (negative):** The section never displays the currently running
  app version number, in either state (open issue #845 — the value is
  available to the app at runtime but nothing renders it). A check that
  fails (unreachable feed, network error) is not surfaced as a distinct
  state either — it falls back to the same "up to date" text as a genuine
  no-update result, so a failed check is indistinguishable from a real one
  from this screen alone.

### S2 — Install an available update {#S2}
- **Do:** With "Update available" shown, choose Install & Restart.
- **Expect:** The app downloads the release artifact and verifies its
  signature against the app's embedded public key; only after verification
  succeeds does it install the update and relaunch into the new version.
  This is a single atomic, explicitly user-initiated action — nothing is
  ever downloaded, staged, or installed as a side effect of the passive
  startup check.
- **Expect (negative):** An artifact whose signature does not verify
  against the embedded key is never installed and never triggers a
  relaunch; the currently running version keeps executing, completely
  unchanged, and no partial install is left on disk.

### S3 — Recover from a failed check or failed install {#S3}
- **Do:** Attempt to install while the update endpoint is unreachable, or
  with a tampered/unsigned artifact at the endpoint.
- **Expect:** The failure is reported inline in the Software Update section
  as "Update failed: {message}", carrying the specific underlying error
  rather than a bare generic phrase; the Install action stays available to
  retry.
- **Expect (negative):** No crash and no partial or corrupted install
  results from any failure branch; the previously running install is left
  fully usable and unchanged, and the next app launch's background check
  still runs normally regardless of the prior failure.

### S4 — Confirm the new version after restart {#S4}
- **Do:** After a successful install-and-relaunch, reopen Settings →
  Advanced.
- **Expect:** The Software Update section reads "You're running the latest
  version." again, reflecting the freshly-installed release; no
  update-available prompt reappears for that same release.

## Success criteria
- SC1: The Software Update section always shows exactly one of the two
  defined states, and the startup check that produces it never blocks or
  interrupts any in-progress library action (S1).
- SC2: 100% of tampered or unsigned artifacts placed at the update endpoint
  are rejected before install; a genuinely newer signed release is
  detected and installable end-to-end (S2) — mirrors spec 051 SC-009.
- SC3: Every failure branch (unreachable feed, failed signature, failed
  download) surfaces its specific underlying error inline and leaves the
  previously running install completely unchanged (S3).
- SC4: After a successful install, the section reads "up to date" with no
  repeat prompt for that release (S4).

## Known gaps
- G1: The running app version number is never displayed anywhere in
  Settings → Advanced, or elsewhere in the UI, independent of update state
  — confirmed via `Advanced.tsx` and the message catalog; `getVersion()` is
  available but unused. Open issue: #845.
- G2: A failed background update check is not surfaced as its own state;
  the UI falls back to the same "up to date" text as a genuine no-update
  result (confirmed in `check_for_app_update`, which only logs on `Err` and
  emits no frontend event). No issue currently tracks this distinctly from
  #845.
- G3: In-repo test coverage for tamper/unsigned-artifact rejection
  (SC-009) is still missing even though the real minisign keypair and
  signing pipeline now exist in this repo; surviving code comments still
  describe the pubkey as a placeholder. Open issue: #762.
- G4: There is no staged "download/verify now, restart later" flow —
  Install & Restart is one atomic action. A user cannot verify an update
  and defer the actual restart to a more convenient moment. (The
  pre-migration doc described a staged/decline flow; current code and
  spec 051 US10 do not implement or require one.)
- G5: No automated scenario/e2e coverage exists yet for this journey
  (carried from the pre-migration doc, which flagged the same gap).

## Delta log
