# Tasks: Typography Rework (spec 055)

Phases are independently shippable PRs; each phase gates the next.
Dependency graph: P1 → P2 → P3; P4 after spec 054 (or capped 125%).

## Phase 1 — Font assets (FR-001; SC-001/002/005/008)

- [x] T001 Download Inter-4.1.zip (pinned release), extract the six hinted
      woff2s (`extras/woff-hinted/Inter-{Regular,Italic,Medium,MediumItalic,SemiBold,SemiBoldItalic}.woff2`)
      into `apps/desktop/src/assets/fonts/` with `LICENSE.txt` and a `FONTS.md`
      recording release URL + per-file SHA-256.
- [x] T002 Replace the CDN `@import` (tokens.css:1) with six `@font-face`
      blocks (`font-display: swap`); removes the JetBrains Mono CDN load too.
      `--alm-font-sans` unchanged; keep `'tnum' 1`, add `'calt' 1` (reset.css).
- [x] T003 [depends T002] E2E assertions: zero requests to
      fonts.googleapis.com/fonts.gstatic.com; `document.fonts` has the six
      faces; computed body family = Inter (SC-001/002).
- [x] T004 [depends T002] `verify-on-windows` A/B scenario (DPR 1.5, dark,
      Targets page) — gates Phase 2 (SC-008).

## Phase 2 — Token layer + dial (FR-002/003; SC-003/004)

- [x] T010 Re-derive scale in rem: 14px base, even-px preference, 11px floor,
      top ~24px; retire 10px token; map every existing token.
- [x] T011 [depends T010] theme.ts: delete 0.9/1.0/1.15 per-token scaler;
      setting writes integer `html{font-size:12|14|16px}`; per-token rounding
      guard so no dial stop computes fractional or sub-11px.
- [x] T012 Tokenize the 11 hardcoded px sizes (sidebar/settings labels 9.5px,
      wizard titles/fine print, planner SVG axis 9px, toast glyph).
- [x] T013 Consolidate uppercase micro-label sizes to one token; add
      letter-spacing tokens replacing the 8 divergent values.
- [x] T014 [depends T011] CI computed-style sweep: integer root at all stops,
      nothing fractional, nothing below 11px (SC-003); all text scales with the
      dial (SC-004).
- [x] T015 J10 journey delta for the new dial semantics.

## Phase 3 — Semantic base layer + mono (FR-004/005; SC-005/006)

- [x] T020 Semantic base layer: `strong,b`→semibold token; `em,i`→real italic
      faces; `code,pre,kbd`→mono stack; define-or-delete `font-mono`.
- [x] T021 [depends T020] Replace the `* { font-family !important }` blanket
      with base layer + explicit stacks; re-add stripped mono declarations by
      hand (template: feature-lists.css:783).
- [x] T022 [depends T021] Mono restoration surfaces: filesystem paths,
      source-view IDs, manifest paths, dev-tools contract names, RA/Dec
      coordinate values. Default `ui-monospace,'Cascadia Code',monospace`.
- [x] T023 [depends T022] Windows pass: verify mono stack acceptability
      (escalate to bundled JetBrains Mono only on failure); evaluate
      `'zero' 1`/`'case' 1` on coordinate surfaces.
- [x] T024 E2E: no synthetic bold/italic (loaded-face check, SC-005); mono
      surfaces computed-family assertion (SC-006).

## Phase 4 — Engine zoom (FR-006; SC-007) — max 150% (054 tracked separately, PR #937; see spec FR-006 envelope)

- [x] T030 Capability `core:webview:allow-set-webview-zoom`; `setZoom` wired to
      app-owned Ctrl+=/−/0; persistence mirrors fontSize setting.
- [x] T031 ~~One-line clarification into spec 054~~ DROPPED 2026-07-17: spec 054
      is tracked separately (PR #937) and was not adopted into this spec's
      pipeline, so no cross-edit was made; Phase 4 ships at 150% with the
      FR-006 degradation envelope documented in this spec instead.
- [x] T032 [depends T030] CI pin: min window 1100×720 × max zoom — layout
      intact (with 054: dock bottom mode) (SC-007).
- [x] T033 [depends T030] J10 journey delta amendment (zoom);
      `verify-on-windows` zoom scenario.

> **Phase 1 verification record (2026-07-17)**: T001–T003 merged via PR #947
> (`f19eb1ad`). T004/SC-008 executed live on the user's Windows machine (DPR
> 1.5, dark theme) via the Tauri MCP bridge instead of a written scenario:
> all 7 pages (Targets, Sessions, Calibration, Inbox, Projects, Archive,
> Settings) confirmed **crisper** by the user; specimen overlay of all six
> faces at 11–16px incl. coordinates/Greek glyphs confirmed good; runtime
> probes: 6 bundled faces registered, 0 CDN requests, only weights
> 400/500/600 in use. **Phase 2 gate: OPEN.**

> **Completion record (2026-07-17)**: Phase 2 merged via PR #957 (integer dial
> 12/14/16, all hardcoded sizes tokenized, letter-spacing tokens, J10 Δ6);
> Phase 3 via PR #956 (semantic base layer, blanket removal, mono restoration
> incl. RA/Dec split on user request, `.alm-mono` resurrection); Phase 4 via
> PR #958 (`532f11d6` — zoom 90–150%, Ctrl+=/−/0, FR-006 envelope pins, J10
> Δ7). T023 executed live on Windows 2026-07-17: mono surfaces + RA/Dec
> confirmed by the user ("amazing" on zoom); system mono stack accepted, no
> JetBrains Mono bundle needed. Follow-ups: PR #963 (pills stay sans in mono
> cells), issue #962 (title-bar truncation, spec:043). Spec 055: COMPLETE.
