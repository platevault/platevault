# Verification — Cross-cutting i18n: no raw Paraglide keys, translated error paths, localized audit-log detail

> Two-stage verification plan. Stage 1 = agent on the real Windows app via the
> Tauri MCP bridge (real backend; mock mode forbidden). Stage 2 = human visual
> pass in Claude Desktop, only after Stage 1 passes.
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.

## Convoy preconditions

- **Test 1.4 requires PR #410 merged** ("fix: Audit Log detail messages now
  translate instead of showing raw backend text", branch
  `fix-audit-detail-i18n`). If #410 is not yet on the branch under test, run
  1.1–1.3 and 1.5, and mark 1.4 BLOCKED (not FAIL).

## Scope and spec references (spec 046 i18n + error codes)

- FR-001: every user-facing string sourced from the single Paraglide catalog
  (`apps/desktop/messages/en.json`; only locale is `en`, hard-pinned — FR-004).
- FR-003: runtime interpolation.
- FR-008/FR-009: backend error codes translate to friendly catalog messages;
  raw error codes / raw backend exceptions must never render.
- FR-011: unknown code → safe generic fallback, never blank.
- FR-012: no developer status markers (TODO, FIXME, lorem, placeholder-y text)
  in user-facing strings.
- PR #410 (upgrade D23): `audit_log_entry` detail text localizes at DISPLAY
  time via `detailCode` + `detailParams` → `settings_auditlog_detail_*` keys;
  stored history stays byte-stable; rows without a code fall back to stored
  English.
- Source of truth: `apps/desktop/src/lib/error-messages.ts` (exhaustive
  `Record<ErrorCode, () => string>` → `m.err_*`),
  `apps/desktop/src/features/settings/AuditLog.tsx` (`detailText()` factory,
  entity-cell `title=` tooltip), `apps/desktop/src/lib/i18n.ts`.

Raw-key leak signature: Paraglide message ids are snake_case identifiers like
`settings_pane_sources_title`, `cmdk_no_results`, `err_path_not_exists`. A leak
renders that identifier as visible text (or an aria-label) instead of English.

## Preconditions (both stages)

1. Branch deployed + app launched with bridge overlay per AGENT-RUNNER.md;
   `VITE_USE_MOCKS=false`; setup completed with ≥1 source root.

## Stage 1 — Agent validation via Tauri MCP

### 1.1 Raw-key sweep across every primary surface

Visit each of: `/inbox`, `/sessions`, `/calibration`, `/targets`, `/projects`,
`/archive`, `/plans`, `/audit`, `/review`, Settings (ALL 12 panes), the command
palette (open), and the expanded log panel. On EACH surface run this DOM audit
via `webview_execute_js`:

```js
(() => {
  const rx = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/g; // snake_case >= 3 segments
  const hits = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const t = walk.currentNode.textContent;
    const m = t && t.match(rx);
    if (m) hits.push(...m);
  }
  for (const el of document.querySelectorAll('[aria-label],[title],[placeholder]')) {
    for (const a of ['aria-label','title','placeholder']) {
      const v = el.getAttribute(a);
      const m = v && v.match(rx);
      if (m) hits.push(...m);
    }
  }
  return [...new Set(hits)];
})()
```

- Expected: an EMPTY result on every surface, after excluding legitimate
  technical text (file paths, FITS keyword tables, pattern tokens like
  `{target_name}`, ids such as `aud:12`). Judgment rule: a hit is a leak only
  if it matches a key present in `apps/desktop/messages/en.json` or has an
  `err_` / `settings_` / `cmdk_` / `nav_` / `log_` / `common_` prefix shape.
- Also assert `document.documentElement.lang` is `en` (locale pinned, FR-004).
- FAIL if any leak is found; list surface + key(s) in the report.

### 1.2 Backend error path renders a translated message (FR-008/FR-009)

1. Go to Settings → Data Sources. Using the E2E path input (launch with
   `VITE_E2E=1`, testid `e2e-path-input-light_frames` +
   `e2e-add-path-btn-light_frames` — native pickers can't be driven), submit a
   nonexistent path: `C:\definitely\not\a\real\folder`.
2. Start `mcp__tauri__ipc_monitor` before submitting; after, `ipc_get_captured`:
   - Expected: the register/validate invoke returns `Err(ContractError)` with a
     code such as `path.not_exists`.
3. Assert the UI shows the CATALOG message for that code (English sentence from
   `m.err_path_not_exists`), and the visible text contains NEITHER the raw code
   string `path.not_exists` NOR a Rust error/backtrace fragment
   (`Err(`, `ContractError`, `at src/`).
4. Repeat with a duplicate registration (submit an ALREADY-registered path):
   expected code `path.already_registered`, again rendered as its friendly
   message.
5. Screenshot checkpoint: `error-translated.png`.
6. FAIL if the raw code, a raw exception, or a blank/undefined message renders.

### 1.3 Interpolation sanity (FR-003)

1. Open the command palette, type `zzqqxx`: the no-results line must embed the
   literal query (`zzqqxx`) inside a full English sentence — no `{query}`
   placeholder braces visible.
2. Sidebar footer roots line must show real numbers ("N roots" style), no
   `{total}` / `{online}` braces.
3. FAIL on any un-substituted `{param}` braces anywhere during the whole run.

### 1.4 Audit-log detail localization (PR #410 — requires #410 merged)

1. Generate a refusal audit row against the real backend: attempt a lifecycle
   transition the state table refuses (e.g. via
   `window.__TAURI__.core.invoke` call an apply/transition command with an
   illegal from→to for an existing entity; any UI flow known to refuse works
   too — a refused plan apply, an unauthorised actor path). Capture the invoke
   error to prove the backend refused.
2. Open Settings → Audit Log. Locate the newest `refused` row.
3. Read the entity cell's `title` tooltip attribute (that is where
   `detailText()` renders).
   - Expected: a full English sentence with entity type / from / to
     interpolated. When the row carries a `detailCode` (new rows written after
     #410), the sentence comes from a `settings_auditlog_detail_*` catalog key.
     At minimum assert the tooltip is not a raw code like `transition.refused`,
     not blank, and contains no `{param}` braces.
4. Fallback check: older rows (written before #410, or refusals that carry no
   params) must still show their stored English detail unchanged — no blank
   tooltips.
5. Trigger a target resolution (Targets → resolve a designation, e.g. `M42`):
   the resulting `target.resolved` audit row's detail must localize with the
   query interpolated.
6. FAIL if: a localizable row shows a raw code, a blank, or brace placeholders;
   BLOCKED (not FAIL) if #410 is absent from the branch.

### 1.5 Log check

`mcp__tauri__read_logs`: error paths exercised above MAY log errors with raw
codes (FR-010 allows codes internally) — that is expected. FAIL only on NEW
errors from surfaces that should not error (the sweep navigation itself).

Stage 1 verdict: PASS only if 1.1–1.3 + 1.5 pass and 1.4 passes or is BLOCKED
with #410 absent. Any FAIL blocks Stage 2.

## Stage 2 — Final Claude Desktop pass

1. Re-read every error message surfaced in Stage 1 as a user: friendly,
   actionable, correct English (FR-014 wording preserved); no double periods,
   no leaked technical nouns ("envelope", "DTO") — spec 046 FR-013 canonical
   vocabulary.
2. Spot-read 3 random surfaces per theme (one light, one dark) for stray
   English that looks hardcoded/dev-ish: dev markers (TODO/FIXME/lorem),
   inconsistent capitalization of the same concept (e.g. "Light frames" vs
   "light-frames"), untranslated tooltips on icon buttons.
3. Audit Log: tooltips read as sentences a user could act on; timestamps and
   outcome chips localized/legible.
4. Sign-off with screenshots of one translated error toast/inline message and
   one audit-log detail tooltip.

Final verdict: PASS when both stages pass (1.4 must be re-run after #410
merges if it was BLOCKED).
