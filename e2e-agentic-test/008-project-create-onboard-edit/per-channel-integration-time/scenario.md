# Two-stage verification — Project detail: real per-channel integration time

> Area: PROJECTS · Package P7 (channel aggregation, spec 008 detail surface)
> PR #396 (OPEN at authoring time) — **PRECONDITION: requires PR #396 merged**
> into the branch under test (`impl-p7-channel-aggregation` →
> `redesign-ui-platevault`). If `projects_get`'s channel rows lack
> `subFrames`/`totalIntegrationS`, STOP and report "blocked on #396".
> Shared runner mechanics: see `e2e-agentic-test/AGENT-RUNNER.md`.
> Stage 1 MUST fully pass before Stage 2.

## Change facts (context)

- PR #396 `feat: show real per-channel integration time in project detail`.
- Touches Rust backend? YES (`crates/app/projects/src/project_setup.rs`,
  `crates/contracts/core/src/projects_v2.rs`) — the RECOMPILE TRAP applies:
  after `git reset --hard`, touch the changed `.rs` files and relaunch
  `cargo tauri dev` (see AGENT-RUNNER.md).
- Contract: `ProjectChannelDto` gains `subFrames: number` and
  `totalIntegrationS: number`, computed server-side by grouping the project's
  linked sources by `filter_snapshot` (sum `frames_snapshot`, sum
  `frames_snapshot × parse(exposure_snapshot)`); `"300s"`-style exposure
  strings parsed at read time; unparseable/missing → 0 with a debug log
  (never a panic).
- Frontend: `deriveChannels()` in `ProjectDetail.tsx` now maps server totals
  1:1; only the presentational `inSync` flag stays client-derived.
  Formatting (`fmtIntegS`): `0`/null → "—"; ≥1h → one decimal + "h"
  (e.g. "1.8h"); <1h → whole minutes + "m" (e.g. "25m").
- Bug fixed: the Sources · Channels palette previously always showed "—" for
  every channel's integration time.

## Preconditions — setup / reset + fixture recipe

1. Deploy the post-merge branch; because Rust changed, force the rebuild
   (touch `crates/app/projects/src/project_setup.rs` and
   `crates/contracts/core/src/projects_v2.rs` after reset), relaunch, and
   verify the binary is fresh (stale binary symptom: channel rows still show
   "—" everywhere or the fields are absent from `projects_get`).
2. Fixture: a project whose sources have KNOWN frames × exposure:
   a. Fresh DB; register Light-frames + Inbox + Projects folders.
   b. Seed inbox with fixture lights covering ≥2 filters, e.g.
      `tests\fixtures\mock-fits-library\light\poseidon-nina\` (Ha + Lum).
      If you need exact arithmetic, generate frames with
      `python scripts\gen-mock-fits.py` and record each session's frame count
      and exposure (e.g. 12 × 300 s Ha = 3600 s = "1.0h"; 6 × 60 s Lum =
      360 s = "6m").
   c. Inbox-confirm the items into sessions; create project
     `Channel Agg Test` linking both sessions.
3. Window 1100×720; real backend (`VITE_USE_MOCKS=false`) — mock mode is
   forbidden and would fabricate exactly the numbers under test.

## Stage 1 — Agent validation via Tauri MCP

### Test 1.1 — Contract carries real aggregates
1. `ipc_monitor` on; open the project detail for `Channel Agg Test`.
2. Inspect the captured `projects_get` response: every entry in `channels[]`
   MUST have numeric `subFrames` and `totalIntegrationS`.
3. Cross-check the arithmetic against the fixture recipe (e.g. Ha:
   `subFrames = 12`, `totalIntegrationS = 3600`).
4. FAIL if: fields absent (→ blocked on #396 / stale binary), values are 0
   despite known non-zero fixtures, or values disagree with
   frames × exposure.

### Test 1.2 — Channel palette renders the values
1. `webview_dom_snapshot` of the Sources · Channels section.
2. Expected: one row per filter; the integration column shows the formatted
   value ("1.0h" for 3600 s; "6m" for 360 s — per `fmtIntegS` rules), and the
   sub-frame count column matches `subFrames`. No channel with linked frames
   shows "—".
3. The header metric line's total integration equals the sum of channel
   values (formatted by the same rule).
4. Screenshot: `s1-channel-palette.png`.
5. FAIL if: any populated channel shows "—"; formatting deviates (e.g. raw
   seconds, "1.80h"); counts mismatch the IPC payload.

### Test 1.3 — Degrade path: unparseable exposure → 0, no crash
1. Add (via inbox) a session whose FITS carry no usable exposure, or — if not
   feasible with fixtures — verify via `read_logs` after Test 1.1 that no
   error/panic was logged for exposure parsing.
2. Expected: channels backed only by unparseable exposures show "—" (0), the
   app logs at debug level at most, and `projects_get` still succeeds.
3. FAIL if: a parse problem produces an error toast, a panic, or a rejected
   `projects_get`.

### Test 1.4 — Consistency after source edits
1. Via the Edit pane (see edit-project-sources scenario) remove one linked
   session, return to detail.
2. Expected: a fresh `projects_get` is issued; the affected channel's
   integration time and sub-frames drop accordingly (or the channel row
   disappears if it was the only source for that filter and channels are
   re-derived) — the UI must NOT show stale totals.
3. FAIL if: totals do not change after the refetch.

### Test 1.5 — Logs & layout
1. `read_logs`: no panics/uncaught errors.
2. 1100×720: the detail top action bar stays pinned; the channels section
   scrolls with content only.

Stage 1 verdict: PASS requires 1.1, 1.2, 1.5 green; 1.3 may downgrade to a
log-only check; 1.4 FAIL blocks. Report captured payload numbers verbatim.

## Stage 2 — Final Claude Desktop pass (human judgment)

1. Eyeball the palette against the fixture math (bring the recipe numbers);
   values must be plausible and units readable ("1.0h", not "3600").
2. Verify the "—" placeholder still reads as intentional for empty channels
   (not as a rendering bug).
3. Themes: check the channels table in `warm-slate` and `observatory-dark` —
   in-sync/out-of-sync channel styling must remain distinguishable.
4. Layout 1100×720: no column truncation that hides the integration value;
   only content scrolls.
5. Sign-off PASS/FAIL + screenshots.
