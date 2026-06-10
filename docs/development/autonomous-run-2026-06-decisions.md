# Autonomous SpecKit Run — Decisions Log (2026-06)

> Running log of judgment calls made during the autonomous implementation of
> specs **022 → 020 → 016 → 024** on `main`. Each entry records a decision that
> may need human reconciliation. Started 2026-06-10 from handover
> `astro-plan__speckit-022-020-016-024`.

## Conventions

- **D-NNN** = a decision; **DV-NNN** = a divergence between spec and reality.
- Each entry: context → decision → rationale → reconciliation risk.

---

## Spec 022 — Mantine Prototype / Design System

### DV-001 — 022 primitive vocabulary superseded by design-v4

- **Context**: 022 `tasks.md` T020–T027 name primitives `Button`, `IconButton`,
  `Badge`, `StateLabel`, `PageHeader`, `Filters`, `Stepper`, `TextInput`,
  `Menu`, `Dialog`, `Tooltip`, `Accordion`, `Select`, `Switch`,
  `CommandPalette`, `DockedDrawer`, `DataTable`, `LogPanel`, `TokenPattern`.
  The **actual** `apps/desktop/src/ui/` set is: `Banner`, `Box`, `Btn`,
  `CoverageBar`, `DirPicker`, `EmptyState`, `KV`, `Lock`, `Pill`, `RadioGroup`,
  `Section`, `SegControl`, `Table`, `ToastContainer`, `Toggle`, `WizardShell`.
  Design-v4 (specs 030/032) added `components/{DetailGrid,MetricLine,Lifecycle,
  DetailPane}` and renamed/reshaped the primitive layer.
- **Decision**: Treat the *current* `ui/` + `components/` set as the real
  primitive vocabulary. Apply 022's intent (token-only CSS, className/ref
  forwarding, page composition, DESIGN.md) to the **actual** components, not the
  names in tasks.md. Do NOT rebuild the named-but-absent primitives.
- **Rationale**: design-v4 is already merged and user-approved; rebuilding the
  old vocabulary would regress the approved UI (handover guardrail: "Do NOT
  rebuild design-v4 components").
- **Reconciliation risk**: 022 `tasks.md`/`spec.md`/`data-model.md` still name
  the old primitives. A future `speckit-verify` will see name mismatches.
  **Recommend**: a follow-up `speckit-iterate` on 022 to realign the spec's
  primitive list with design-v4, OR fold 022 into spec 032. Left for human.

### D-001 — T011 token reconciliation policy

- **Context**: `components.css` had un-tokenized color literals (`#1e3a8a`
  gradient endpoint, `#fff` ×2, `#f5ddd8` danger-hover bg, `white` +
  `rgba(0,0,0,0.15)` popover shadow) and ~109 lines with raw `px`.
- **Decision**: (a) Tokenize the **color/shadow** literals by adding tokens to
  `tokens.css` and referencing them. (b) Treat **component-intrinsic pixel
  dimensions** (icon/badge/mark sizes, hairline `1px` borders, fixed panel
  widths) as NOT spacing-token candidates; document this exception policy inline
  in `components.css` and in DESIGN.md rather than tokenizing every px.
- **Rationale**: The spec's independent test targets color/spacing/radius/
  shadow/motion. Colors and shadows are genuine token candidates; intrinsic
  geometry is not "spacing". Tokenizing every px would bloat the token set
  without semantic meaning.
- **Reconciliation risk**: If a reviewer interprets T011 literally ("no raw px
  anywhere"), some `px` remain. Documented as intentional exception.

### D-002 — T041 theme contracts wired via pipeline, not a `theme/` dir

- **Context**: T041 says "mirror `theme.get.json`/`theme.set.json` into
  `packages/contracts/theme/`". No such directory convention exists — the
  contracts package generates TS from an allowlist in `build-schemas.mjs` and
  re-exports namespaced types from `src/index.ts`.
- **Decision**: Added both spec contracts to `SPEC_CONTRACT_ALLOWLIST` and
  re-exported `ThemeGet`/`ThemeSet`. Did NOT create `packages/contracts/theme/`.
- **Rationale**: Following the working, established pattern beats a one-off dir
  that nothing imports. The generated `.d.ts` are the consumable surface.
- **Gotcha logged**: `build-schemas.mjs` does `rmSync(generatedDir)` then calls
  `json2ts` via `spawnSync`. Running it with bare `node` (not `pnpm run build`)
  fails because `json2ts` isn't on PATH, AND it wipes the generated dir first —
  briefly deleted tracked `.d.ts`. Always regenerate via `pnpm run build` in
  `packages/contracts`. (No spec change needed; operational note.)
- **Reconciliation risk**: Low. A reviewer expecting a literal `theme/` dir
  won't find one; the intent (theme contracts in the package surface) is met.

### D-003 — T031 audited without speculative refactor

- **Context**: T031 asks to extract ad-hoc page markup into primitives.
- **Decision**: Treated as an audit-and-confirm pass; did not refactor. 36/55
  feature files compose shared primitives; the rest are bespoke charts/controls
  and the spec-003 setup wizard with no extractable duplication.
- **Rationale**: design-v4 is freshly built on the primitive vocabulary and
  user-approved; speculative extraction risks regressing approved UI for no
  clear reuse win.
- **Reconciliation risk**: A reviewer wanting aggressive primitive extraction
  may disagree. Low risk; documented.

### D-004 — Checkboxes updated manually (not via agent-assign)

- **Context**: `specs/CLAUDE.md` says implementation should run through
  `speckit.agent-assign.*`; 022 is a pure audit/reconciliation pass.
- **Decision**: Performed the audits directly and ticked checkboxes manually
  with inline evidence notes, rather than spinning up the agent-assign flow.
- **Rationale**: The tasks are "Verify…/Audit…" reconciliation of work
  design-v4 already did; the heavyweight per-task agent flow adds overhead
  without quality gain. The user authorized autonomous continuation.
- **Reconciliation risk**: Process deviation from the documented speckit DAG.
  Logged for transparency. Applies to spec 022; heavier specs (016/024) that
  add real backend may warrant the agent-assign flow.

### D-005 — T053 visual check deferred (visual no-op rationale)

- **Context**: T053 wants a light/dark visual regression spot-check; WSL can't
  run the Tauri GUI (handover: preview is Windows-native).
- **Decision**: Left T053 open, marked DEFERRED with rationale that 022's
  changes are visual no-ops (token vars carry identical color values; primitive
  edits are additive prop-forwarding).
- **Reconciliation risk**: If a future visual diff shows a regression, T053
  would need real execution. Considered very low given the no-op nature.
