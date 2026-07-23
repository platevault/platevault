# Research: Typography Rework (spec 055)

Condensed record of the five completed investigation lanes (2026-07-17). Full
receipts inline in `spec.md`/`plan.md`.

## Lane 1 — Live rendering probe (user's Windows machine, real app)

DPR 1.5 (150% scaling), observatory-dark theme. Inter genuinely painting (no
Segoe fallback); font-size setting unset (root integer 16px — fractional-scaler
bug real but dormant); dominant sizes on Targets: 12px ×106, 10px ×48, 13px
×46, 11px ×28; family perfectly consistent at runtime. Evidence screenshot:
`targets-font-diagnostic.png` (session scratchpad).

## Lane 2 — Repo-wide typography audit

97.4% of font-size declarations token-based (485/498); zero feature-local CSS.
Debt: 11 hardcoded px sizes immune to the size setting; global
`* { font-family … !important }` (reset.css:26-28) strips all mono (one live
deviation left: `.alm-source-views__id`, feature-lists.css:783; other mono
intents deleted to comments); uppercase micro-labels use 3 sizes for one role;
letter-spacing untokenized (8 values, 13 files); 21 `<strong>` rely on browser
700 → synthetic-bold trap; `--alm-leading-relaxed` dead; `font-mono` class
undefined.

## Lane 3 — Industry research (fonts + size settings)

Brand-forward apps bundle (Figma/Linear bundle Inter; Discord gg sans; Slack
Lato); OS-native apps use system stacks (VS Code, 13px default). Nobody
hybridizes. Dominant size-setting pattern is whole-surface zoom (VS Code/Slack/
Notion). Google CDN serves instanced statics with hinting stripped
(google/fonts#7007). Fractional px font sizes documented backend-inconsistent.

## Lane 4 — Engine zoom evaluation

Tauri v2 `setZoom` = true layout zoom on all three engines (WebView2
ZoomFactor / WKWebView pageZoom / WebKitGTK zoom-level); Linux confidence
medium (Wayland blur reports). CSS `zoom` rejected (contaminates viewport
math). Verdict: add zoom **alongside** the font dial (VS Code split). Composes
with spec 054 (zoom shrinks CSS viewport → dock bottom mode). Constraint: 150%
zoom at 1100×720 → 733px viewport → ship after 054 or cap 125%. Shortcuts must
be app-owned (WebView2 has no zoom-change event). Permission:
`core:webview:allow-set-webview-zoom`.

## Lane 5 — Font selection deep dive (binary probes)

**"Hinted InterVariable" does not exist**: `InterVariable.ttf` in Inter-4.1.zip
has zero hint tables (no fpgm/prep/cvt, 0 instructed glyphs); hinted assets are
the static woff2s in `extras/woff-hinted/` (1,965/2,937 glyphs instructed;
fontTools probe). Ranked: 1. Inter hinted statics; 2. IBM Plex Sans Var (only
candidate with real variable TT hints — loses on migration cost for zero
rendering gain); Source Sans 3 (TTFs explicitly unhinted), Geist (italics
alpha-only), Roboto Flex (no italic, slnt only) disqualified. `tnum` verified
in the hinted statics (load-bearing for reset.css:16); `calt`/`case`/`zero`
available. Assets: 6 woff2s ≈ 858KB, OFL 1.1, pin v4.1 (2024-11-15).

## Decisions closed by this research

| Question | Decision |
|---|---|
| Font | Keep Inter; bundle 6 hinted static woff2s; delete both CDN loads |
| Token architecture | rem + integer root dial 12/14/16 (user); per-token rounding guard |
| Floor / base | 11px floor, base 13→14, retire 10px token |
| Mono | Restore (paths, IDs, contracts, RA/Dec — user); system mono stack default, JetBrains Mono bundle as fallback |
| Size mechanism | Dial AND engine zoom (user + Lane 4); zoom after 054 or capped |
| Device-pixel rounding | Rejected (per-DPR tables); prefer even px sizes instead |
