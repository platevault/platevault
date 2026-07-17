# Implementation Plan: Typography Rework (spec 055)

**Spec**: `specs/055-typography-rework/spec.md` | **Created**: 2026-07-17

Four phases, each independently shippable and verified before the next. Phase 1
is deliberately isolated so the crispness win (the user's actual pain) lands and
is A/B-verified before any token arithmetic changes.

## Phase 1 — Font assets (FR-001, SC-001/002/005/008)

1. Add `apps/desktop/src/assets/fonts/`: the six hinted woff2s from
   `https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip`
   (`extras/woff-hinted/Inter-{Regular,Italic,Medium,MediumItalic,SemiBold,SemiBoldItalic}.woff2`)
   + `LICENSE.txt` + a `FONTS.md` recording release URL and SHA-256 per file.
2. Replace the `@import` at `apps/desktop/src/styles/tokens.css:1` with six
   `@font-face` blocks (`font-display: swap`). This also deletes the JetBrains
   Mono CDN load.
3. Keep `--alm-font-sans` (tokens.css:20) unchanged; keep
   `font-feature-settings: 'tnum' 1` (reset.css:16); add `'calt' 1`.
4. E2E assertions: no `fonts.g*` network requests; `document.fonts` contains
   the six faces; computed family on body text is Inter.
5. `verify-on-windows` scenario: A/B screenshots at DPR 1.5, dark theme,
   Targets page (the 12px-dominant surface). Gate Phase 2 on this.

Registering italic faces automatically ends synthetic italics at the ~10
existing `font-style: italic` sites — no CSS edits needed there.

## Phase 2 — Token layer + dial (FR-002/003, SC-003/004)

1. Re-derive the scale in rem from a 14px root, even-px preference, 11px floor,
   top ~24px. Retire the 10px token.
2. `theme.ts:112-129`: delete the 0.9/1.0/1.15 per-token scaler; the setting
   writes integer `html { font-size: 12|14|16px }`. Add the sane-computed-size
   guard: if any token × any dial stop computes fractional, round per token.
3. Tokenize the 11 hardcoded px sizes (sidebar/settings labels 9.5px, wizard
   titles/fine print, planner SVG axis 9px, toast glyph); consolidate the
   uppercase micro-label sizes to one token; add letter-spacing tokens (replace
   the 8 divergent values).
4. CI computed-style sweep (SC-003): integer root at all stops, nothing below
   11px, nothing fractional.
5. **J10 journey delta** for the changed dial semantics.

## Phase 3 — Semantic base layer + mono (FR-004/005, SC-005/006)

1. Base layer in `reset.css`/`primitives.css`: `strong,b` → semibold token;
   `em,i` → italic faces; `code,pre,kbd` → mono stack; define-or-delete
   `font-mono`.
2. Replace the `* { font-family !important }` blanket with the base layer +
   explicit stacks; re-add the stripped mono declarations (source-view IDs at
   `feature-lists.css:783` is the template; the other intents survive only as
   comments and must be re-added by hand).
3. Mono restoration surfaces: filesystem paths, source-view IDs, manifest
   paths, dev-tools contract names, RA/Dec coordinate values. Default face
   `ui-monospace, 'Cascadia Code', monospace`; escalate to bundled JetBrains
   Mono only if Windows verification rejects the system stack.
4. Evaluate `'zero' 1` / `'case' 1` on coordinate surfaces during the same
   Windows pass.

## Phase 4 — Engine zoom (FR-006, SC-007) — max 150% (054 is a separate, since-shipped feature; see spec FR-006 envelope)

1. Capability `core:webview:allow-set-webview-zoom`; `setZoom` wired to
   app-owned Ctrl+= / Ctrl+− / Ctrl+0; persistence mirrors the fontSize
   setting.
2. Zoom steps 90/100/110/125/150; Ctrl+0 resets to 100.
3. CI pins (two): layout intact at minimum window (1100×720) × 125%, and at
   1320×864 × 150%. Beyond that envelope (min window × 150% → 733px viewport)
   layout degradation is documented and accepted, not guarded.
4. J10 journey delta amendment for zoom; `verify-on-windows` scenario.

## Risks

- **Phase 3 changes visible rendering on purpose** (code/pre/mono surfaces) —
  ship with before/after screenshots in the PR.
- **Blanket removal** may expose latent family declarations; the audit found
  only one live deviation, but the computed-style CI sweep is the regression
  net.
- **Dial rounding**: 12/16 roots make rem tokens compute fractional
  (× 12/14, × 16/14); the per-token rounding guard is mandatory, not optional.
