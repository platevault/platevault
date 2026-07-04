# Verification — Global search / command palette (Ctrl+K): pages, live results, keyboard behavior

> Two-stage verification plan. Stage 1 = agent on the real Windows app via the
> Tauri MCP bridge (real backend; mock mode forbidden). Stage 2 = human visual
> pass in Claude Desktop, only after Stage 1 passes.
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md` (sibling lane
> `verify-plans-setup-sources`).

## Scope and spec references

- Spec 043 §3 (shared primitives) — the command palette is the shell's global
  search affordance.
- Spec 046 FR-001/FR-003 (catalog strings + interpolation: the "no results for
  {query}" message interpolates the query).
- Spec 037 (IPC migration): palette search goes through the generated binding
  for the global search command (`search_global` invoke; `searchGlobal` in
  `apps/desktop/src/app/CommandPalette.tsx`, debounced 200 ms).
- Source of truth: `apps/desktop/src/app/CommandPalette.tsx` (cmdk inside a
  Base-UI style `Dialog.Popup` with class `alm-palette`).

Ground truth:

- Opens with **Ctrl+K** (`$mod+K`; Ctrl on Windows). Toggle: Ctrl+K again
  closes.
- Popup: `.alm-palette`, `aria-label` set, an input with a translated
  placeholder.
- Groups: **Results** (live backend search results — targets etc.), **Pages**
  (static navigation entries incl. Review Queue `/review`, Plans `/plans`,
  Audit Log `/audit`), **Actions**.
- A `/dev/contracts` palette entry exists ONLY in dev-tools builds — the
  `dev-tools` cargo feature is compile-time gated OFF in release (spec 021).
  The dev loop (`cargo tauri dev`) is a debug build; whether the entry shows
  depends on the feature flags of the running build. Record presence/absence,
  do not fail on it.

## Preconditions (both stages)

1. Branch deployed on `C:\dev\astro-plan` per AGENT-RUNNER.md; app launched
   with the bridge overlay (`tauri.dev.conf.json`), `VITE_USE_MOCKS=false`.
2. First-run setup completed (app on the shell, not `/setup`).
3. At least one target exists in the DB so the Results group has something to
   find. If the library is empty, create one: navigate to Targets and add a
   target by resolving a well-known designation (e.g. `M31`) via the Targets
   page's add/resolve flow (SIMBAD resolver, spec 035; needs network), or use
   any existing seeded target. Record which target name you will search for —
   call it `<TARGET>` below.

## Stage 1 — Agent validation via Tauri MCP

### 1.1 Open / close and focus management

1. From `/sessions`, send Ctrl+K via `webview_keyboard`.
   - Expected: `.alm-palette` appears; `document.activeElement` is the palette
     input (verify with `webview_execute_js`).
   - FAIL if the palette opens without focusing its input.
2. Press Escape.
   - Expected: palette closes; focus returns into the app document (activeElement
     is not `<body>` detached inside a removed dialog; no focus trap left).
3. Press Ctrl+K, then Ctrl+K again.
   - Expected: toggles open then closed.
4. Screenshot checkpoint while open: `palette-open.png`.

### 1.2 Pages group navigates

1. Open the palette; type `audit`.
2. Assert the **Pages** group shows an "Audit Log" entry; activate it with
   ArrowDown/Enter (keyboard only — no mouse).
   - Expected: palette closes and the router navigates to `/audit`
     (assert `location.pathname`).
   - FAIL if activation requires a mouse click or the route does not change.
3. Repeat once more for "Plans" → `/plans` (proves it is not a one-off).
4. Record (do not assert) whether a "Contract diagnostics" `/dev/contracts`
   entry is visible; note the build's dev-tools state in the report.

### 1.3 Live Results group hits the real backend

1. Start `mcp__tauri__ipc_monitor`. Open the palette and type the first 3-4
   characters of `<TARGET>`.
2. `ipc_get_captured`:
   - Expected: exactly ONE `search_global` invoke fires after the ~200 ms
     debounce settles (not one per keystroke), with the typed query in its
     request payload, and it returns `Ok` with a result set containing
     `<TARGET>`.
   - FAIL if: no invoke (mock short-circuit — scenario-level FAIL), an invoke
     per keystroke (debounce broken), or an error response.
3. Assert the **Results** group in the DOM lists `<TARGET>`; select it with
   ArrowDown + Enter.
   - Expected: navigates to the target's detail surface (Targets page with the
     target selected).
4. No-results path: open the palette and type `zzqqxx`.
   - Expected: a translated empty-state message that INCLUDES the literal query
     text `zzqqxx` (interpolation, spec 046 FR-003) and contains no raw key
     text such as `cmdk_no_results`.

### 1.4 Log check

`mcp__tauri__read_logs`: no error-level entries from the palette interactions.

Stage 1 verdict: PASS only if 1.1–1.4 all pass. Any FAIL blocks Stage 2.

## Stage 2 — Final Claude Desktop pass

1. Open the palette over a busy page (Sessions with data) in one light theme
   and one dark theme: the popup must read clearly against the scrim; the
   highlighted row must be obvious; text contrast comfortable.
2. Type quickly and erratically; results should feel responsive (debounce not
   laggy), no flicker of the "no results" state between keystrokes.
3. Keyboard-only round trip feels natural: Ctrl+K → type → arrows → Enter →
   landed on the right page with focus somewhere sensible.
4. Copy check: placeholder, group headings ("Results", "Pages", "Actions"),
   and the no-results message read as natural English.
5. Sign-off with screenshots (palette open, results visible) at 1100×720.

Final verdict: PASS when both stages pass.
