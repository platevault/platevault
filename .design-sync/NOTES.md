# design-sync notes — PlateVault

Repo-specific gotchas for future `/design-sync` runs. One bullet per quirk.

- **This is an app, not a published component library.** `@astro-plan/desktop` is a
  private Tauri app with no `main`/`module`/`exports`. The design-system entry is the
  barrel `apps/desktop/src/ui/index.ts` — run the converter in src-entry mode with
  `--entry ./apps/desktop/src/ui/index.ts` and `--node-modules apps/desktop/node_modules`.
- **Component surface** = the 15 primitives exported from `src/ui/index.ts` (Pill, Btn,
  Section, Box, KV, EmptyState, Table, Banner, Toggle, SegControl, RadioGroup, CoverageBar,
  Lock, DirPicker, WizardShell, ToastContainer, InfoTip). Feature-level components live in
  `src/features/*` and are intentionally NOT synced (app screens, not reusable primitives).
- **Theming**: tokens are `--alm-*` CSS custom properties in `src/styles/tokens.css`.
  `:root` = default (light); 4 named themes as `[data-theme="warm-slate"|"warm-clay"|
  "observatory-dark"|"espresso-dark"]` on `<html>`; density via `.density-compact`/
  `.density-spacious` on `<html>`. `.alm-*` component classes are BEM
  (`.alm-btn--primary`, `.alm-pill--ok`, …).

- **CSS must be pre-flattened (converter does NOT resolve `@import`).** `cfg.cssEntry`
  points at `apps/desktop/.ds-css/flattened.css` (gitignored, generated). Regenerate it
  BEFORE each `package-build.mjs` run — the converter copies it verbatim into
  `_ds_bundle.css`:
  ```
  # aggregate = reset + tokens + components (app load order)
  node --input-type=module -e "import e from './.ds-sync/node_modules/esbuild/lib/main.js'; \
    await e.build({entryPoints:['apps/desktop/.ds-css/_aggregate.css'],bundle:true, \
    outfile:'apps/desktop/.ds-css/flattened.css',loader:{'.css':'css'}})"
  ```
  esbuild inlines the relative `@import`s (incl. `components.css` → `components/*.css`
  partials, the `.alm-*` classes) and keeps the remote Google-Fonts `@import` external.
  `cfg.tokensGlob` is a NO-OP here (`copyTokens` only reads a `node_modules` `tokensPkg`),
  so tokens ride inside the flattened `cssEntry` instead. Aggregate + esbuild command are
  also captured in `.design-sync/rebuild-css.sh`.

- **KV is dropped from previews** (16/17 cards). `isComponentName` treats all-caps names
  (`^[A-Z][A-Z0-9_]+$`) as constants → `KV` is filtered from the card list. It is STILL in
  the importable bundle (`window.PlateVault.KV`, 17 exports) — just no preview card. Not
  worth forking `lib/dts.mjs` for one trivial key-value component.
- **Fonts are remote** — Inter + JetBrains Mono via a Google Fonts `@import url(...)` at the
  top of `tokens.css` → validate reports `[FONT_REMOTE]` (informational). Nothing to ship;
  cards render correctly online, fall back to system fonts offline.
- **Preview scope = floor cards** (first sync). User will author richer previews by driving
  the project in claude.ai/design. Every component still ships fully functional (importable
  bundle + `.d.ts` + `.prompt.md`).

## Known render warns (triaged clean — a warn NOT here is new)
- `[FONT_REMOTE]` Inter / JetBrains Mono / Cascadia Code — remote Google-Fonts `@import`,
  by design (see remote-fonts bullet).
- `[RENDER_BLANK]` on Banner, Box, Btn, CoverageBar, EmptyState, Pill, Section — these
  render the REAL component with empty default props (a childless button, an empty box),
  so the PNG is <5KB. Functional, just content-less until real props are supplied.
- Floor cards on RadioGroup, SegControl, Table, ToastContainer, WizardShell — these are
  data-driven (they `.map()` over `options`/`segments`/`columns`/`rows`/`steps`); default
  props give `undefined`, so the honest floor card shows. **Author these five first** when
  adding rich previews — they benefit most.

## Re-sync risks (watch-list for the next run)
- **CSS flatten step is mandatory and easy to forget** — if `flattened.css` is stale or
  missing, `_ds_bundle.css` silently loses the `.alm-*` classes. Always re-run
  `.design-sync/rebuild-css.sh` before `package-build.mjs`.
- Tauri/app-context primitives (`DirPicker`, `ToastContainer`) call `@tauri-apps/*` /
  app context that is absent in headless Chromium — they may floor-card even with an
  authored preview. Functional-but-placeholder, not broken. If wiring a provider, that's
  the place to look.
- The bundle is built from `src/ui` source (not a versioned dist), so any refactor of the
  barrel or a primitive's props changes the synced contract — rebuild on any `src/ui` change.
- Remote Google Fonts `@import` means the DS has no shipped `@font-face`; if the app ever
  self-hosts fonts, add them via `cfg.extraFonts`.
