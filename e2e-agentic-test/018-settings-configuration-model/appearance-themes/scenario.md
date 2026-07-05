# Verification — Settings › General (Appearance): 4 themes switchable + persisted, density, font size

> Two-stage verification plan. Stage 1 = agent on the real Windows app via the
> Tauri MCP bridge (real backend; mock mode forbidden). Stage 2 = human visual
> pass in Claude Desktop, only after Stage 1 passes.
> Shared mechanics: `e2e-agentic-test/AGENT-RUNNER.md`.

## Scope and spec references

- Spec 043 §2 "Theming system": 4 named themes + System, applied as a
  `data-theme` attribute on `<html>`, tokens.css defines one scope per theme.
- Spec 018 FR-004 (auto-save, no global Save button), FR-006 (density is an
  Appearance preference).
- Source of truth: `apps/desktop/src/data/theme.ts`,
  `apps/desktop/src/features/settings/General.tsx`.

Ground truth (from `theme.ts` / `General.tsx`):

| Swatch | ThemeId (`data-theme`) | Mode |
|---|---|---|
| System | resolves to `warm-slate` (light) / `observatory-dark` (dark) via `prefers-color-scheme` | auto |
| Warm Clay | `warm-clay` | light |
| Warm Slate | `warm-slate` | light |
| Observatory | `observatory-dark` | dark |
| Espresso | `espresso-dark` | dark |

- Persistence: localStorage key `alm.theme` holds the CHOICE (`system` or a
  ThemeId); `<html data-theme=...>` holds the RESOLVED theme.
- Swatch buttons carry `aria-pressed` reflecting the active choice; each swatch
  preview re-scopes tokens via its own `data-theme` so all previews show their
  own palette simultaneously.
- Density select (compact/comfortable/spacious) persists via AppPreferences and
  applies `density-*` classes.
- KNOWN GAP (report, don't fail): the Font size select is component-local
  `useState` only — it is NOT persisted and currently changes nothing outside
  the pane. Record its behavior as a note.

## Preconditions (both stages)

1. Branch deployed + app launched with bridge overlay per AGENT-RUNNER.md;
   `VITE_USE_MOCKS=false`; setup completed.
2. Start state: clear the stored choice so the run begins on System:
   `webview_execute_js`: `localStorage.removeItem('alm.theme'); location.reload()`.

## Stage 1 — Agent validation via Tauri MCP

### 1.1 All five choices render

1. Navigate Settings → General (Application group).
2. Enumerate `.alm-theme-swatch` buttons: expected exactly 5, with names
   System, Warm Clay, Warm Slate, Observatory, Espresso and a mode caption
   each (Light/Dark/Auto-variant). Exactly ONE has `aria-pressed="true"`
   (System, given the reset in preconditions).
3. Assert each swatch's `.alm-theme-swatch__prev` carries its own `data-theme`
   attribute matching the table (System's preview mirrors the resolved theme).
4. Screenshot checkpoint: `themes-pane.png`.

### 1.2 Each of the 4 explicit themes applies live

For EACH of `warm-clay`, `warm-slate`, `observatory-dark`, `espresso-dark`:

1. Click its swatch.
2. Assert via JS, with NO reload in between (live application):
   a. `document.documentElement.getAttribute('data-theme') === '<id>'`.
   b. `localStorage.getItem('alm.theme') === '<id>'`.
   c. The clicked swatch now has `aria-pressed="true"`; all others `"false"`.
   d. The page background actually changed: read
      `getComputedStyle(document.body).backgroundColor` and record it — the
      four values across the loop must NOT all be identical, and dark themes
      must yield visibly dark RGB values (each channel < 100) while light
      themes yield light ones (each channel > 200).
3. Screenshot checkpoint per theme: `theme-<id>.png` (4 screenshots).
4. FAIL if: attribute/localStorage/aria mismatch, or computed backgrounds do
   not differ between light and dark themes.

### 1.3 Persistence across full app restart

1. Select **Espresso**. Confirm `alm.theme = espresso-dark`.
2. Fully restart the app (kill `desktop_shell.exe` and relaunch per
   AGENT-RUNNER.md — a webview reload is NOT sufficient for this check).
3. After relaunch, before touching Settings: assert
   `document.documentElement.dataset.theme === 'espresso-dark'` and the
   Settings → General pane shows Espresso as the pressed swatch.
4. FAIL if the app comes back on any other theme.
5. Select **System** and assert `data-theme` resolves to `warm-slate` or
   `observatory-dark` matching the OS `prefers-color-scheme` (query it via
   `matchMedia('(prefers-color-scheme: dark)').matches`).

### 1.4 No Save button; auto-persistence (spec 018 FR-004)

1. Assert the General pane contains NO button labeled Save/Apply — theme and
   density commit immediately.
2. Change Density to `compact`: assert `<html>` classList gains
   `density-compact` and the preference survives a webview reload.
   Restore `comfortable`.
3. Exercise the Font size select once and record the observed (non-)effect as
   the known-gap note.

### 1.5 Log check

`mcp__tauri__read_logs`: no error-level entries produced by theme/density
switching.

Stage 1 verdict: PASS only if 1.1–1.5 pass (Font size recorded as note). Any
FAIL blocks Stage 2.

## Stage 2 — Final Claude Desktop pass

1. Cycle all four themes on real content (Sessions with data, Inbox, Settings):
   every surface re-skins completely — no stuck light-on-light or dark-on-dark
   text, no unthemed white flashes, no per-element leftovers from the previous
   theme.
2. Swatch previews look like miniature palettes of their own theme (bg /
   surface / accent stripes), not copies of the active theme.
3. Contrast judgment: body text, muted text, badges, and the active-nav state
   are comfortably readable in ALL four themes (spot-check the log panel and
   status bar too).
4. Density compact/comfortable/spacious visibly changes rhythm without
   breaking the 1100×720 layout.
5. Sign-off with one screenshot per theme at 1100×720.

Final verdict: PASS when both stages pass.
