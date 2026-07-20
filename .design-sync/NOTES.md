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
- **Theming**: tokens are `--pv-*` CSS custom properties in `src/styles/tokens.css`, which
  `@import`s the shared type/space/radius scale from `packages/tokens/foundation.css`.
  `:root` = default (light); 6 named themes as `[data-theme="warm-slate"|"warm-clay"|
  "observatory-cool-light"|"observatory-cool"|"observatory-dark"|"espresso-dark"]` on
  `<html>` (`observatory-cool` is the canonical dark and the app's dark default); density
  via `.density-compact`/`.density-spacious` on `<html>`. `.pv-*` component classes are BEM
  (`.pv-btn--primary`, `.pv-pill--ok`, …).

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
  esbuild inlines the relative `@import`s — `components.css` → `components/*.css` partials
  (the `.pv-*` classes) and `tokens.css` → `packages/tokens/foundation.css`, which sits
  OUTSIDE `apps/desktop`, so the aggregate must be built from a root that can reach it.
  **`external: ['*.woff2']` is required**: since spec 055 bundled the fonts, `tokens.css`
  carries six `@font-face` rules, and esbuild hard-fails the entire flatten with *no loader
  is configured for ".woff2"* without it. External is also the behaviour we want — the DS
  project serves its own copies from `fonts/`, so those `url()`s are rewritten on upload
  rather than inlined or hashed here.
  `cfg.tokensGlob` is a NO-OP here (`copyTokens` only reads a `node_modules` `tokensPkg`),
  so tokens ride inside the flattened `cssEntry` instead. Aggregate + esbuild command are
  also captured in `.design-sync/rebuild-css.sh`.

- **KV is dropped from previews** (16/17 cards). `isComponentName` treats all-caps names
  (`^[A-Z][A-Z0-9_]+$`) as constants → `KV` is filtered from the card list. It is STILL in
  the importable bundle (`window.PlateVault.KV`, 17 exports) — just no preview card. Not
  worth forking `lib/dts.mjs` for one trivial key-value component.
- **Fonts are bundled locally, not remote** (changed by spec 055). `tokens.css` declares
  `@font-face` rules over the six Inter `.woff2` files in `apps/desktop/src/assets/fonts/`;
  the Google Fonts CDN `@import` is gone. The DS project serves its own copies from
  `fonts/`, so the bundle's `src:` URLs are rewritten on upload rather than inlined. Expect
  `[FONT_REMOTE]` to no longer fire — if it does, something re-introduced a CDN import.
- **Preview scope = floor cards** (first sync). User will author richer previews by driving
  the project in claude.ai/design. Every component still ships fully functional (importable
  bundle + `.d.ts` + `.prompt.md`).

## Known render warns (triaged clean — a warn NOT here is new)

> **Stale — re-triage on the next run.** The list below records the FIRST sync's results.
> Since then the `--alm-*` → `--pv-*` rename, the six-theme consolidation, the destructive
> token, the local-font switch, and the `ConfirmOverlay` → `Modal` merge all landed without
> a re-sync. Treat these as a starting hypothesis, not a clean baseline.

- `[RENDER_BLANK]` on Banner, Box, Btn, CoverageBar, EmptyState, Pill, Section — these
  render the REAL component with empty default props (a childless button, an empty box),
  so the PNG is <5KB. Functional, just content-less until real props are supplied.
- Floor cards on RadioGroup, SegControl, Table, ToastContainer, WizardShell — these are
  data-driven (they `.map()` over `options`/`segments`/`columns`/`rows`/`steps`); default
  props give `undefined`, so the honest floor card shows. **Author these five first** when
  adding rich previews — they benefit most.

## Re-sync risks (watch-list for the next run)
- **CSS flatten step is mandatory and easy to forget** — if `flattened.css` is stale or
  missing, `_ds_bundle.css` silently loses the `.pv-*` classes. Always re-run
  `.design-sync/rebuild-css.sh` before `package-build.mjs`.
- Tauri/app-context primitives (`DirPicker`, `ToastContainer`) call `@tauri-apps/*` /
  app context that is absent in headless Chromium — they may floor-card even with an
  authored preview. Functional-but-placeholder, not broken. If wiring a provider, that's
  the place to look.
- The bundle is built from `src/ui` source (not a versioned dist), so any refactor of the
  barrel or a primitive's props changes the synced contract — rebuild on any `src/ui` change.
- **`componentSrcMap` rots silently.** It maps names to source paths; when a component is
  deleted or merged away, the next build hits a missing source. `ConfirmOverlay` (merged
  into `Modal`) and the `ProjectStatusTag` alias were both retired this way. Re-check the
  map against `src/ui` + `src/components` whenever a component is removed or renamed.
- **Palette cards are generated — never hand-edit them.** Run
  `node .design-sync/generate-palette-cards.mjs` to rebuild the whole set from
  `tokens.css` (per-theme values) and the `THEMES` registry (id/label/mode). The cards were
  hand-authored once and drifted badly: no destructive family, a pre-correction Warm Clay
  red, and only four of six themes. The generator exits 1 if the card count and theme count
  disagree, so a theme added to the registry but not to `tokens.css` fails loudly instead of
  producing a quietly short set.
