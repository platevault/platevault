# Target identity detail — identity table, display label, aliases, notes

> Two-stage verification plan for the target detail pane (TargetDetailV2).
> Stage 1: agent via Tauri MCP bridge, real backend. Stage 2: Claude Desktop
> human pass after Stage 1 PASS. Shared mechanics:
> `e2e-agentic-test/AGENT-RUNNER.md`.

## Feature facts (context)

- Specs: 023 target identity/history/notes (US2 linked sessions, US3 linked
  projects, US4 observing notes), 036 gen-3 detail (FR-012 display alias +
  actions), 035 FR-014 (manual identity correction via user aliases takes
  precedence), 043 §4 Targets detail redesign.
- Surface: `apps/desktop/src/features/targets/TargetDetailV2.tsx`, mounted in
  the right-side detail pane when `?selected=<uuid>` is set on `/targets`.
- IPC:
  - `target_get` `{ req: { targetId } }` → `TargetDetailV3` (aliases with
    `kind` ∈ designation | common_name | user, `displayAlias`, `raDeg`,
    `decDeg`, `source`, `simbadOid`).
  - `target_alias_add` `{ req: { targetId, alias } }` — errors:
    `alias.blank`, `target.not_found`.
  - `target_alias_remove` `{ req: { targetId, aliasId } }` — errors include
    `alias.not_removable` (non-user aliases are protected).
  - `target_display_alias_set` / `target_display_alias_clear`.
  - `target_note_get` / `target_note_update` `{ req: { targetId, notes } }` —
    error `note.content_too_large` (frontend caps textarea at 16384 chars).
- Known STUBS inside this pane (expected, NOT failures — but they must LOOK
  like stubs, see the 044 stub-honesty scenario): altitude graph is an
  approximate model with a fixed placeholder latitude (~52°, shown in the
  graph title), Coverage renders a no-coverage stub note, Transit has no
  precise time.
- Testids: `target-notes-textarea`, `target-notes-body`,
  `target-notes-empty`.

## Preconditions

1. Branch `redesign-ui-platevault`, fresh DB, setup completed
   (AGENT-RUNNER.md). Bridge connected, IPC capture on.
2. At least one canonical target exists: on Targets, use **Add target** to
   add `M 42` (see the sibling `simbad-resolve-on-demand` scenario, Test 2).
   Select it so the detail pane is open.

## Stage 1 — Agent validation via Tauri MCP

### Test 1 — Identity renders real gen-3 data

1. With M 42 selected, read the detail pane.
Expected:
- Header: effective label (M 42) with the common name as subtitle when
  known; object-type pill + up to 4 catalog-designation pills.
- Identity table shows Designation `M 42`, Type, RA/Dec formatted
  sexagesimal (`05hXXmXXs / −05°XX′XX″` for M 42 — verify RA starts `05h`
  and Dec is negative ~−5°), Source, and (if resolved online) SIMBAD OID.
- Absent values render `—`, not `null`/`undefined`.
- 📸 checkpoint.
FAIL if: `target_get` errors, RA/Dec are wildly wrong for M 42 (e.g.
positive Dec > +20°), or raw enum strings with underscores leak into the
type label unprocessed.

### Test 2 — Add and remove a USER alias

1. In the Aliases section, type `my-orion-test` in the alias input, press
   Enter.
2. Assert IPC `target_alias_add` fired with that alias; the alias list now
   shows `[user] my-orion-test` as an accent pill WITH a remove (×) button.
3. Confirm non-user aliases (kind designation/common_name) have NO remove
   button.
4. Click the × on `my-orion-test`; assert `target_alias_remove` fired and
   the pill disappears.
5. Error path: submit an empty/whitespace alias.
Expected: steps as inline; step 5 shows the "blank alias" danger banner
(`alias.blank` mapped to i18n copy), no IPC mutation is persisted (the UI
guards blank input client-side — either no call or a rejected call with the
banner is acceptable; report which).
FAIL if: user alias not removable, protected alias shows a remove control,
or the blank submit crashes/persists.

### Test 3 — Alias affects search (FR-014 user precedence)

1. Re-add alias `my-orion-test` (leave it in place).
2. Clear selection (close detail), type `my-orion-test` into the Targets
   top-bar search.
Expected: M 42 appears in the filtered list — the list payload's `aliases`
include the new user alias after reload. (If the row only matches after a
page reload, report the staleness as a FINDING: expected behavior is that
the search works once the list refetches.)
FAIL if: the user alias never resolves in search even after a manual
reload.

### Test 4 — Display label set / clear

1. Reselect M 42. In "Display label", click Set/Edit, type `Orion Test
   Label`, press Enter.
2. Assert `target_display_alias_set` fired; the pane header and the list
   row's effective label BOTH now read `Orion Test Label` (list may refetch).
3. Click Edit → **Clear**.
Expected: `target_display_alias_clear` fires; label reverts to the primary
designation; the "not set" placeholder copy returns.
FAIL if: label does not propagate to the list row, or clear leaves the old
label.

### Test 5 — Observing notes save / cancel / persistence

1. In Notes, click Edit; assert `target-notes-textarea` exists. Type
   `Test note: shoot Ha first.` and Save.
2. Assert `target_note_update` fired; view mode shows the text in
   `target-notes-body` plus a saved indicator.
3. Click Edit, change the text, then **Cancel**.
4. Navigate away (Sessions) and back to the same target.
Expected: cancel reverts to the saved text (step 1's), NOT the abandoned
draft; after navigation the note persists (served by `target_note_get`, DB
durable).
FAIL if: cancel commits the draft, or the note is gone after navigation
(would mean it never hit SQLite).

### Test 6 — Linked sessions / projects sections behave

1. Read the mid-pane Sessions and Projects link columns.
Expected: with a fresh library both show their EMPTY-state copy (loading →
empty, no spinner stuck, no error). `target_sessions_list` /
`target_projects_list` calls resolve Ok. (Populated-path coverage lives in
the calibration journey scenario, which creates real sessions.)
FAIL if: either section shows a raw error or hangs in "Loading" > 5 s.

**Stage 1 verdict**: PASS = Tests 1–6 green + no new ERROR log entries
(`read_logs`).

## Stage 2 — Final Claude Desktop pass (only after Stage 1 PASS)

Window 1100×720.

1. **Pane layout**: the detail pane scrolls independently; the Targets list
   and top bar stay put; the pane close affordance is reachable without
   scrolling.
2. **Identity legibility**: two identity columns + Tonight column pack
   left-aligned without overlap at 1100×720; the altitude graph is legible
   and its title honestly names the placeholder latitude.
3. **Alias pills**: user vs catalog aliases are visually distinct (accent vs
   ghost); the kind tag (`[user]`, `[designation]`) is readable in Warm Slate
   AND Observatory themes; remove buttons have visible focus states.
4. **Notes**: textarea resizing/scrolling stays inside the pane; saved
   indicator is subtle but noticeable.
5. **Error banners**: trigger the blank-alias banner — judge tone and
   placement (danger banner near the form, not a toast on the other side of
   the screen).
6. **i18n**: no raw keys anywhere in the pane.
7. Sign-off with screenshots (both themes, detail pane fully scrolled
   through).

## Verdict rubric

- **PASS**: all Stage 1 tests green, Stage 2 signed off.
- **FAIL**: alias/notes mutations not persisted to the real DB, protected
  aliases removable, cancel committing drafts, layout/i18n violations.
- Report per test PASS/FAIL + verbatim IPC request/response for Tests 2, 4,
  5.
