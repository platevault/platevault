# Audit Log — detail messages localize (detailCode/detailParams, PR #410)

> Two-stage verification plan. Stage 1: agent via Tauri MCP bridge; Stage 2:
> Claude Desktop human pass, only after Stage 1 passes.
> Runner mechanics: `../../AGENT-RUNNER.md`. Fixtures:
> `../../041-inbox-plan-surface/FIXTURES.md`.

## Coverage

| Requirement | Assertion in this scenario |
|---|---|
| PR #410 (decision D23) | `audit.list` entries expose optional `detailCode` + `detailParams`; the Audit Log screen renders detail text from `settings_auditlog_detail_*` catalog keys instead of raw backend English |
| PR #410 | Stored history is byte-stable: rows without a code (old/free-form) fall back to the stored `detail` unchanged; `audit.export` NDJSON unchanged for old rows |
| PR #410 | Target-resolution rows derive `detailCode = target.resolved / target.user_override` + `{ query }` from the existing payload |
| Spec 046 #8b | Detail text is a render-time factory (re-reads locale) |

**Convoy precondition: requires PR #410 merged** (`fix: Audit Log detail
messages now translate instead of showing raw backend text`). Verify at the
deployed commit that `apps/desktop/messages/en.json` contains
`settings_auditlog_detail_*` keys (e.g.
`Select-String settings_auditlog_detail C:\dev\astro-plan\apps\desktop\messages\en.json`).
If absent: report BLOCKED.

Locale note: the app currently ships a single `en` catalog, so "localizes"
is asserted structurally — the rendered detail text must equal the CATALOG
template rendered with `detailParams`, proven by the code+params round-trip
below (not by switching language).

## Preconditions

1. Deploy the branch containing PR #410; **Rust changed** (audit read/write
   path) → force recompile after reset (AGENT-RUNNER.md recompile trap).
2. Clean DB; generate **RECIPE-MIXED** + **RECIPE-DEST**; launch with
   bridge + `VITE_E2E=1`; window 1100×720; real backend.
3. Wizard: inbox root + single light root (organized). Finish.

## Stage 1 — Agent validation via Tauri MCP

1. **Seed audit rows of multiple detail classes.**
   a. Refusal row: via `webview_execute_js`, invoke a lifecycle transition
      against a nonexistent entity —
      `invoke('lifecycle_transition_apply', { req: { …entityId:
      '00000000-0000-0000-0000-000000000000'… } })` (read the exact request
      shape from the bindings; paste the call used). Expect it to reject —
      the refusal is recorded (`entity.not_found` detail class).
   b. Target-resolution row: run the normal ingest path — Rescan, select a
      light sub-item so classification + coordinate target resolution runs
      (fixtures point at NGC 7000), which records a `target.resolved` (or
      `target.user_override` if you pick manually) audit row.
   c. Apply rows: confirm + apply one light sub-item (see
      `041-inbox-plan-surface/plan-overlay-apply-audit`).
   - Expected: three classes of entries now exist.
   - FAIL if: none of these operations produce audit entries at all.
2. **IPC: detailCode/detailParams present (PR #410 read path).** Invoke
   `audit_list` (limit 50).
   - Expected: the refusal entry from 1a carries `detailCode`
     (`entity.not_found`) + `detailParams` (`{ entityId: … }`); the
     resolution entry from 1b carries `detailCode`
     `target.resolved`/`target.user_override` + `{ query: … }`. Paste both
     entries verbatim.
   - Expected: entries are OPTIONAL fields — rows with no matching template
     (free-form refusal reasons) simply omit them (skip-serializing), and
     that is not a failure.
   - FAIL if: `detailCode` is absent on BOTH seeded classes, or params
     don't identify the template (e.g. missing `query`).
3. **UI renders the catalog template.** Navigate to `/settings/audit`
   ("Audit Events"). Locate the rows from step 1 (use the search box, e.g.
   search the entity id / query). Read the entity cell's `title` attribute
   (the detail tooltip) via `webview_execute_js` on
   `.alm-audit-log__entity`.
   - Expected: for the coded rows, the tooltip text equals the
     corresponding `settings_auditlog_detail_*` catalog message rendered
     with the row's `detailParams` (compare against the literal template in
     `messages/en.json` at the deployed commit — paste both strings).
   - Expected: it does NOT equal the raw stored backend `detail` when the
     template differs, and NEVER shows a raw key like
     `settings_auditlog_detail_entity_not_found` or a raw code like
     `entity.not_found` standing alone as the whole tooltip.
   - FAIL if: coded rows still show raw backend-composed English when a
     template exists, or a raw i18n key leaks.
4. **Fallback for un-coded rows (byte-stable history).** Find (or create)
   an entry without `detailCode` (per PR #410, free-form refusals such as
   wrapped persistence errors carry none; any pre-existing row from before
   the feature also qualifies).
   - Expected: its tooltip shows the stored English `detail` unchanged —
     the fallback path renders old rows exactly as before.
   - FAIL if: un-coded rows render blank or error.
5. **Export unchanged for old rows.** Click Export (or invoke
   `audit_export` with `filter: null`); parse the NDJSON.
   - Expected: each line is valid JSON; rows WITHOUT a code contain no
     `detailCode`/`detailParams` keys (skip-serializing — old-row export
     byte-shape preserved); rows with a code round-trip the same
     code/params seen in step 2.
   - FAIL if: export injects nulls/empty fields into old rows or fails to
     parse.
6. **Log check.** `read_logs`: no ERROR entries from `audit_list` /
   `audit_export`; the deliberate refusal of step 1a logged as structured.

Screenshot checkpoints: `S1-audit-01` (audit page with the seeded rows),
`S1-audit-02` (tooltip visible on a coded row — use a hover/devtools
capture or dump the title attribute alongside the screenshot).

### Stage 1 verdict

PASS = steps 1–6 pass, with the template-vs-stored-text comparison in step 3
documented verbatim. FAIL otherwise with entries, tooltip strings, and
NDJSON excerpts.

## Stage 2 — Final Claude Desktop pass

1. Read the Audit Events page as a user auditing yesterday's apply. Judge:
   do the detail tooltips read as natural sentences (not developer codes)?
   Are outcome pills (`applied`/`refused`/`failed`) consistent with the
   detail text?
2. Filter UX: search for the entity id and by date range; judge
   responsiveness and empty-state wording.
3. Discoverability: the detail lives in a hover tooltip on the entity cell
   — judge whether that is findable; note (don't fail) a polish issue if
   the detail deserves a visible expansion affordance.
4. Theme pass: outcome pills + table in **Warm Clay** and **Observatory**;
   pill contrast in dark themes.
5. i18n: column headers, pagination ("Page X of Y"), outcome labels, and
   detail templates all catalog-sourced; pluralized event count correct.
6. Layout at 1100×720: settings pane scrolls internally; the table does not
   overflow horizontally; pagination controls remain reachable.
7. Sign-off: PASS/FAIL per point + screenshots (both themes). Overall PASS
   requires Stage 1 PASS and no unresolved defect.
