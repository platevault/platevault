# Orchestration log — 2026-07-09 (release-finish campaign)

Run id: `run-20260709-release`. Mission: drive PlateVault to a
release-finished state (backend tails closed, docs reconciled, stale issues
verified/closed, Windows validation clean) without touching the release
mechanism itself.

## Lane map

| Node | Scope |
|---|---|
| 0a | docs-networking (Windows/WSL bridge docs, mirrored networking) |
| 0b | CI wins (quick, safe CI fixes) |
| A | workspace-red (fix red `cargo test --workspace` / lint baseline) |
| B | spec044 (targets-planner-astronomy, Track B) |
| C | spec017 (cleanup-archive-review-plans remainder) |
| D | spec048 (per-frame-inventory) |
| E | spec037 (e2e-integration-testing tail) |
| F | spec049 (source-view-generation) |
| G | spec026 (generated-source-view-removal decision) |
| H1 | 033-tail (validation-bugfix-remediation remainder) |
| H2 | 025/012/008/021 tails |
| I | bookkeeping (this lane): orchestration log, SPEC_STATUS.md, stale-issue closure |
| J | Windows validation |
| K | hand-off |

## Recorded decisions

- **(a) Journey-doc lanes serialized behind 0a.** Docs touching the
  Windows/WSL bridge mechanics wait for 0a to land first to avoid rebase
  churn on the same doc files.
- **(b) Backend tail serialized D → F → G → H1 → H2** to avoid scope
  collisions across specs 048/049/026/033/025/012/008/021 that touch
  overlapping crates and UI surfaces.
- **(c) `tasks.md` ticks land as surgical edits, with mandatory independent
  `speckit-verify` audits**, because SpecKit skill invocations are
  cwd-pinned to the primary checkout and single-active-feature — unsafe to
  run concurrently across parallel worktree lanes. Coders tick their own
  tasks by hand; a separate audit lane re-verifies against code before any
  status is trusted.
- **(d) macOS Real-UI E2E is under active investigation.** The merge bar
  (Integration + mock-mode CI green, plus ubuntu/windows Real-UI green) may
  be tightened once macOS is fixed; until then macOS Real-UI stays
  best-effort/non-blocking (carried from the 2026-07-06 campaign, D6).
- **(e) Versioning is reset to 0.x** (see `cbd91378`); the release lane is
  owned elsewhere in this campaign. This lane and all bookkeeping work MUST
  NOT touch `.github/workflows/**`, tags, versions, or release PRs.

## Updates

- **Real-UI E2E audit (2026-07-09).** macOS leg is hard-broken upstream in
  `tauri-plugin-webdriver` 0.2.1 (embedded `:4445` server never starts on
  macOS runners; upstream's own CI is red on macOS, issue tracker disabled,
  no newer release; no `safaridriver` path for embedded WKWebView). ubuntu/
  windows legs verified reliable (only true product bugs caught in the last
  ~15 runs). **Decision:** new lane `nM` removes macOS from the PR matrix →
  `workflow_dispatch`-only, without `continue-on-error` (true signal for
  future upstream re-tests), adds job-level `timeout-minutes`, and adds
  `desktop_shell` stdout/stderr capture on launch failure in the e2e harness.
  Merge bar unchanged: Integration + mock + Real-UI ubuntu+windows required.
  Re-check `tauri-plugin-webdriver` releases periodically.
- **Pre-push typos hook false-positives (2026-07-09).** First push of any new
  branch trips a full-scan fallback that flags commit-hash substrings in
  release-please-generated `CHANGELOG.md`. **Decision:** surgical
  `SKIP=typos` authorized once for lane `n0b`; durable fix is excluding
  `CHANGELOG.md` from the typos config, landing in the `n0b` PR.
- **macOS Real-UI, no viable alternative found (2026-07-09).** Internal issue
  #489 filed ("Real-UI E2E: macOS leg blocked — tauri-plugin-webdriver
  upstream failure", labels `bug`/`spec:037`). A project-history search found
  no viable alternative: 037 `research.md` D4 already surveyed the field (the
  `danielraffel` webdriver-automation plugin was never adopted; CrabNebula
  Cloud rejected as paid; `safaridriver`/AXUI/CDP never explored); the
  `tauri-plugin-mcp-bridge` is architecturally macOS-capable but non-WebDriver,
  dev-only per D4, and unvalidated headless — a future spike, not a fix.
  **Owner directive applied:** lane `nM` disables the macOS Real-UI leg on
  PRs, keeping a `workflow_dispatch` re-test path without
  `continue-on-error`; macOS coverage relies on unit + integration + mock
  suites. Watch item: `tauri-plugin-webdriver` releases + the mcp-bridge
  spike idea live in #489.
- **Lane ownership clarification (2026-07-09).** Lanes J (Windows validation)
  and K (final hand-off) are externally owned by the campaign session, not
  by any coder lane in this run — feature-PR lanes author verify-on-windows
  scenario text but never execute it on Windows themselves.
- **041 verify-then-close outcome (2026-07-09, this lane).** Zero phantom
  completions found. Inverse drift instead: 6 tasks (T071/T072/T073/T076/
  T077/T081) were implemented-and-tested on `main` but left unticked in
  `tasks.md`; all 21 open issues in the #320–#340 range were stale-open
  (code already shipped). T078 (sync-conflicts record) and T079 (Windows
  E2E) remain genuinely open — left unticked, issues #339/#340 left open.
