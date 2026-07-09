# PlateVault Frontend — Comprehensive Design Review (2026-07-09)

Synthesis of three parallel reviews (`design-system-patterns`, `/impeccable` UX, and an
extraction/override sweep) of `apps/desktop/`, plus direct verification.

**Overall:** a genuinely professional, well-governed data tool — strong token system, 4-theme
infrastructure, and an excellent reviewable-mutation core (**UX health 28/40, Good**). The debt is
**accessibility + consistency + an under-exported design-system tier** — not aesthetics.

---

## 0. The Claude Design export was incomplete (the "layout" gap)

The design system is intentionally **two-tier**, but the first export only took Tier 1.

- **Tier 1 — `src/ui/`** (17 leaf primitives: Btn, Pill, Banner, Toggle, SegControl, RadioGroup,
  Table, Box, Section, EmptyState, CoverageBar, Lock, DirPicker, WizardShell, InfoTip,
  ToastContainer, KV). Exported.
- **Tier 2 — `src/components/`** (22 composite/layout scaffolds: `ListPageLayout`, `ListDetailLayout`,
  `PageShell`, `PageTopBar`, `TopActionBar`, `ListSidebar`, `DetailPanel`/`DetailPane`/`DetailHeader`,
  `DetailGrid`/`Rail`/`RailCard`, `Modal`, `ConfirmOverlay`, `SortHeader`, `FilterToolbar`, `ListItem`,
  `MetricLine`, `PropertyTable`, `Lifecycle`; `TargetSearch` is domain-specific). **Not exported.**

This is why Claude Design has "components but not layout." **Fix: re-sync with `src/components`
added to `componentSrcMap`.**

### Should `src/ui` and `src/components` be merged? — No.
- Strict directional layering: `src/components` → imports → `src/ui`; `src/ui` never imports
  `src/components` (no cycle).
- Deliberate, documented (spec 043): Tier 2 headers describe *shared, generalized, whole-app*
  scaffolds so "feature code never re-implements an overlay/header/layout."
- Merging flattens a real atoms-vs-layout boundary for no gain. **Keep both; formalize as the two DS
  tiers; export both.** Consolidate only genuine *intra-tier* overlap (see §3).

---

## 1. Design System foundation — strong, a few sharp edges
**Good:** correct semantic-token layering (themes re-declare only ~30 raw tokens, no leakage into
`primitives.css`); complete theming runtime (`theme.ts`: persistence, `system`/`prefers-color-scheme`
listener, `useSyncExternalStore`, Tauri native-chrome sync); above-average governance (hex/ms CI gate
`check-tokens.sh`, generated `AlmTokenName` union, `css-dup-sniff.mjs`, ESLint inline-style ban).

**Fixes:**
- **[P1]** Theme leak at component layer — `wizard-steps.css:736-741` special-cases two dark themes →
  introduce a semantic input token; themes touch only raw palette.
- **[P1]** Dead `:root` default palette duplicates `warm-slate`, never selected at runtime → remove or
  make `:root` the single source and have `warm-slate` reference it.
- **[P1]** No theme-completeness check → add CI check: every `[data-theme]` declares the same raw-token
  set as `:root`.
- **[P2]** `Btn` lacks `forwardRef`/default variant; degenerate one-member `BtnSize='sm'`.
- **[P2]** Two tooltip mechanisms (`Lock` base-ui vs `InfoTip` CSS `::after`) → one shared primitive.
- **[P2]** Vestigial density (`.density-*` toggles only `--alm-row-height`).
- Minor: `--alm-chip` aliases `--alm-bg3`; `EmptyState` redundant `desc`/`description`; `CoverageBar`
  hours-coupled.

## 2. UX / product design — 28/40
**Model surface:** `PlanReviewOverlay` (teaching banner, `aria-live` progress, protection-ack gate,
danger labels, close-blocked-while-busy); Archive typed-`DELETE` gate; Cmd+K / `?selected=` IA.

**Fixes:**
- **[P1]** List rows mouse-only (`Table.tsx:90-106`, Sessions/Projects tables) — add keyboard/roles;
  reuse `LogPanel.tsx:418-437` pattern.
- **[P1/P2]** Faint text `--alm-ink4` fails WCAG AA in all 4 themes (3.07–3.85:1) → retune to ≥4.5:1.
- **[P2]** `prefers-reduced-motion` nearly absent → global pass (spinner + `transition: width`).
- **[P2]** No skeleton loaders → add to primary surfaces (product register names them).
- **[P2]** Consistency drift: `Modal` vs `ConfirmOverlay`; five error patterns, one **silent** (Setup
  failures console-only, `SetupWizard.tsx:304-311,365-367`); dead/dup code in `ProjectDetail`
  (`:164,168` dup hook; `:420-422` unwired Reveal).
- Toast alert-stripe reads as banned border (`feature-lists.css:573-585`); guided coach hardcodes
  "Dismiss"/"Done" (`GuidedOverlay.tsx:112-115`).

## 3. Extraction & overrides
- **Promote:** `src/components` = the Tier-2 export (§0); `ProjectStatusTag` → shared `StatusTag`.
- **Override bug (High):** dead Tailwind classes (Tailwind not installed) in `SourceViewsSection.tsx`
  (11×) and `GenerateSourceViewDialog.tsx` (8×) → unstyled markup; replace with `.alm-*`/tokens.
- Fragile `className="mono"` (`CalibrationMatching.tsx:177-205`); undefined `tool-launches-accordion`
  (`ToolLaunchesAccordion.tsx:189`).
- Inline `style={{}}` (22) mostly legit dynamic values; no hardcoded hex/px in feature code.
- **Duplication:** dead `.alm-plan-overlay__*` Modal clone (24 rules, `merges-3.css:1268+`) → delete;
  depth-indent inline (`8 + depth*INDENT_PER_DEPTH`) cloned across 5 tables → shared `Table`; status
  indicators built 4 ways → unify; utility repetition (39× `muted+xs`) → `.alm-meta`/`.alm-stack`.
- No `.alm-*` defined under `src/features/**` — the mandate holds.

## 4. Cross-cutting
1. Formalize the **two-tier DS** (§0) — document tiers, export both, and unify only genuine intra-tier
   overlap (`ConfirmOverlay`→`Modal`, status widgets). This dissolves the "which overlay/status?" drift.
2. **Accessibility is the largest, cheapest debt** — keyboard operability (everywhere, not just tables),
   faint-text contrast, reduced-motion. Contradicts stated product principles.
3. **Close governance holes** — theme-completeness check + automated contrast test on the token-lint
   gate; sweep dead code (Tailwind classes, Modal clone, ProjectDetail dupes).

## 5. Prioritized actions
1. Re-sync Claude Design with `src/components` (Tier 2).
2. Retune `--alm-ink4` ≥4.5:1 across 4 themes (fixes AA everywhere).
3. Delete dead code (`.alm-plan-overlay__*`, ProjectDetail dupes) + fix dead Tailwind classes.
4. Keyboard-operable rows + all interactive elements; theme-completeness CI check; surface Setup
   failures; reduced-motion + skeletons; `ConfirmOverlay`→`Modal`; unify status widgets; `Btn` polish.
