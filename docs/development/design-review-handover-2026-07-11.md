# Handover — design review session 2026-07-11

State of the unattended UX/design review + follow-up campaign at handover
time. Branch: `worktree-effervescent-wondering-dove` (PR **#598**, open).

## Done and delivered

- **Report**: `docs/development/design-review-2026-07-11.md` — full review
  (19/40 verdict; heuristics table; 6 topic sections with numbered
  recommendations; persona flags; sequencing) **plus addendum**: AI-slop
  signal review (pill inflation, em-dash-as-universal-placeholder,
  regenerate-not-reuse duplicates, button-placement drift, raw-data leaks)
  and the viewport strategy (Phase 0 economy → adaptive side/bottom dock →
  pop-out Activity/plan windows → no generalized multi-window).
- **Critique snapshot**: `.impeccable/critique/2026-07-11T16-59-16Z__apps-desktop-src.md`
  (slug `apps-desktop-src`, score 19, p0=4, p1=14 — first run, no trend).
  `$impeccable polish` will pick this up as its backlog.
- **Issues**: #599–#631 (28 new, all labeled `spec-030`) + epic **#632**
  with a full checklist; root-cause comments posted on #581 (palette CSS
  missing entirely), #587 (density token consumed only by Targets table),
  #556 ("(root)" fallback at `InboxList.tsx:362`).
- **Journeys doc**: `docs/product/user-journeys.md` reworked — a
  "Touch & validate" coverage contract added to every existing journey
  (1–10), plus six new journeys: 11 mistake recovery, 12 failure & refusal
  handling, 13 audit investigation, 14 target-first project start,
  15 equipment & observing-site setup, 16 keyboard-first navigation &
  windows. New product rule in the preamble: "Every action answers back."
  NOTE: journeys are coverage definitions only — defects live in GitHub
  issues, never in this doc (explicit owner instruction).
- **Memories**: `design-review-2026-07-11` (outcomes + artifact locations)
  and `tauri-bridge-driving-quirks` (bridge timeouts, zombie script loops,
  the modifier-combo freeze, recovery procedure) in project auto-memory.

## In flight / remaining

1. **Discovery sweeps of untouched controls** (serial — one app driver at a
   time):
   - Sweep-A (RUNNING at handover): Settings-wide interactive sweep — every
     button/dialog/form across the 12 panes; screenshots `shots/s1-*.png`;
     told to verify #558 (Disable no-op) and NOT to complete
     "Restart first-run setup".
   - Sweep-B (NOT launched): Inbox/Sessions/Calibration untouched controls —
     filters, group/then sorts, sort headers, Rescan, destination-root
     select, Files popover + FileInspector, reveal buttons, calibration
     "Use in project".
   - Sweep-C (NOT launched): Targets/Projects detail controls + palette
     actions ("New project", "Open view in new window"), log-panel chips /
     follow / export / cross-links, project Edit / manifests / source-view
     dialog / notes. Do NOT launch PixInsight ("Open in PixInsight" spawns
     the real app).
2. **Fold sweep findings** into a short report section (append to the
   report addendum) and file any NEW bugs as issues (same format, label
   `spec-030`, link epic #632). Check against #599–#631 + the manual
   campaign issues before filing to avoid dupes.
3. **Closing summary** to the owner: sweep discoveries + pointers to
   report/addendum/issues/journeys.

## How to drive the app (hard-won mechanics)

- Bridge: `driver_session start host=172.20.10.1 port=9223` (WSL→Windows
  NAT). Navigate via `webview_execute_js` setting `location.hash`; wait
  ~1.5s; then probe/screenshot in a SEPARATE call (promises >~800ms time
  out but keep running in-page — never chain multi-route loops in one
  script).
- **Never** send modifier-key combos via `webview_keyboard` — a real Ctrl+K
  with an overlay open hard-froze the renderer (once; likely interacts with
  #557). Synthetic `dispatchEvent(new KeyboardEvent(...))` is safe for
  hotkeys. Plain Escape keypress is fine.
- Freeze recovery: `powershell.exe Stop-Process` the `desktop_shell` PID →
  `Start-Process 'C:\dev\astro-plan\run-dev-mcp.bat' -WorkingDirectory
  'C:\dev\astro-plan'` → poll ~2 min → `driver_session` stop + start.
- App/test state (disposable, per owner): project "IC 10 Test HOO"
  (lifecycle Completed, sources are stub sessions with no files — archive
  plans for it are legitimately empty), target M 31 added + favorited,
  1 bias master registered, several `refused` audit rows from
  Prepare/Archive attempts. Window ~1440×900. Theme Espresso.
  Test library: `D:\Astrophotography\ALM test`.

## Verification discipline (owner mandate)

Verify every subagent claim against source or live evidence before it
enters a report or an issue. This session refuted three plausible claims
(MatchCandidatesPanel "unmounted" — it is mounted; "masterBiass" naming bug
— test-data folder name; raw `observer_location_missing` code shown — it is
translated). Screenshots for all evidence are in the session scratchpad
`shots/` dir (01-*, 14-*, j1-*..j4-*, s1-*); the scratchpad is
session-scoped, so anything worth keeping must be copied into the repo or
an issue before the session ends.

## Key open questions for the owner

- Wizard mock steps (#599): fix-with-real-data vs collapse-the-wizard —
  the report recommends collapsing if real data is far.
- Audit coverage (#—, see report Topic 1/J13): plan applies were not
  visible in the Audit Log during testing while lifecycle refusals were —
  needs a backend answer on intended audit scope before the UI story can be
  finished.
- Score context: 19/40 is flow-weighted; the visual foundation is solid.
  The sequencing section in the report proposes trust → feedback →
  consistency → panels → settings.
