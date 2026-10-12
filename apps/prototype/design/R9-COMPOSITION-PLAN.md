# PlateVault UI: rebuild as a composition system (round 9)

Bead astro-plan-blbjw · feeds decision astro-plan-42eka · 2026-10-12 · plan only, nothing built.

**Bases.** Prototype `ui-harness-v5` @ `edb05dbf`. Its `src/` matches the R9 audit base `44adaf33` except `features/v5/d-review/corners.tsx` (`git diff --stat 44adaf33..HEAD -- apps/prototype/src`). Original product `main` @ `94a3dc95`.
**Paths.** Relative to `apps/prototype/src/` unless prefixed. `D:` = `apps/desktop/src/` on main. Spec, `DESIGN.md` and `PRODUCT.md` paths are from the repo root.
**Evidence.**
- Source reads, cited `file:line`.
- The R9 audits, cited as A/B/C plus a row ID: `design/R9-UX-AUDIT-A.md`, `-B.md`, `-C.md`. Also `R9-PREV-PRODUCT-PATTERNS.md`, `R9-HOME-DEBATE.md`, `R9-ANSWERS.md` and `R9-PIXINSIGHT-STATS.md`. They were not redone.
- A **rendered census**: headless Chromium on `http://127.0.0.1:5505/`, 1440×900, en-GB, demo library loaded through Welcome › Load demo library. 35 routes. Per route it counted, in `#main`:
  - buttons by variant/size, read from class signatures;
  - DataTable vs raw tables, sortable header cells, visible `title=` attributes, glyph tips, and pills rendered as `<a>`/`<button>`.
- Static counts from a regex pass over `src/**/*.tsx`.
- Cited external sources (URLs in §2).

Unverified claims are marked [INFERENCE].
**Not readable.** `apm_modules/srobroek/agentic-packages/packages/steering-frontend` is linked from `AGENTS.md:70-80` but is not installed in the canonical checkout. I applied the installed design rules instead: `rule://design-no-slop`, `rule://design-token-discipline` and `rule://design-component-truth`.

## 0. Summary

- **The original product already chose composition, and v5 lost it.**
  - Spec 043: "Every primitive comes from the shared `ui/` (and `components/`) library. No page-local re-implementations — no exception." (`specs/043-ui-redesign-platevault/spec.md:16-17`)
  - `DESIGN.md:164`: "Implement them once; reuse everywhere."
  - v5 kept the leaf primitives (`components/ui`) and some composites (`components/app`). It lost the page templates (D: `PageTopBar`, `ListPageLayout`, `DetailPanel`), the filter toolbar, the sort header, the settings kit, the confirm modal footer and toast. So every slice built its own (C §1c lists 30+ look-alikes).
- **Five layers:**
  - L0 headless behaviour;
  - L1 styled primitives;
  - L2 composed patterns, including astro-specific visualisations;
  - L3 page templates;
  - L4 pages.

  Pages only fill template slots and pass data plus **Action descriptors**. The same descriptor renders as a header button, a named dropdown, a row ⋯ menu, a context menu and a palette command, so a button's style follows its role and never the page or the flow position.
- **Five templates.** Every route and dialog maps to one: `ListPage`, `DetailPage`, `StepPage`, `SettingsPage`, and the dialogs `FormDialog`/`ConfirmDialog`. Right-side fold-out sheets go away.
- **One staged-work flow.** `StepFlow` = StepStrip + StepFooter (Skip · Proceed). It drives setup, import, session intake (where review now lives, P-REV2), calibration processes, runs, run groups and Wrap up.
- **Enforcement uses what is installed** (core ESLint `no-restricted-syntax` / `no-restricted-imports`, the existing `/design-system` page as a registry-driven catalogue, a copy lint over `messages/en-GB.json`, and the rendered census as a budget). No new dependency.
- **Migration.** Five waves, plus a review round after Wave 4:
  - W0: land the four in-flight R9 fix branches, freeze shared files, write one contract file.
  - W1: foundation, 8+2 owned units.
  - W2: domain flows for P-REV2/P-REJ2, in parallel with W1.
  - W3: page migrations, 11 units in two batches.
  - W4: contract (remove deprecated APIs, lint warn→error).
- **Fourteen open decisions** (§9), each with options and a recommendation.

---

## 1. What the original product prescribed, and where v5 diverged

### 1a. Prescriptions and divergence

| Topic | Original prescription (source) | v5 today (evidence) | Divergence |
|---|---|---|---|
| Component tiers | Central components only, "no page-local re-implementations — no exception" (`specs/043…/spec.md:14-18`). Headless-library policy: Base UI, `cmdk`, `react-resizable-panels` and `@tanstack/react-table`, with primitives owning only the visual layer (`DESIGN.md:146-150`). Direction `components → ui` (`docs/design/frontend-design-review-2026-07-09.md:8-27`). | L1 `components/ui` (shadcn on Base UI) and L2 `components/app` exist. Features import `components/ui` 194× and `components/app` 293×. There are 45 cross-feature imports (d-review→t3 16, e-targets→t1 9, b-projects→t3 5, c-runs↔b-projects 7, …), from a static import scan. C §1c lists 30+ feature-local look-alikes. | Composites and templates are missing, so slices fill the gap locally. |
| Page shell | D: `PageTopBar` (title · summary · filters · right-aligned actions, Btn `sm`, ≤1 primary; `D:components/PageTopBar.tsx:4-25,31-40`). `ListPageLayout` owns the list + docked detail (`D:components/ListPageLayout.tsx:28-104`). Adaptive dock (`specs/054-adaptive-detail-dock/spec.md:43-80`). | `PageHeader` has `description`, `eyebrow`, `meta` and `actions`, but no filters slot and no detail slot (`components/app/page.tsx:34-108`). Header action sizes vary: `sm` on Home, Projects and Sessions; `default` on Calibration, Targets and Target detail. Calibration's header holds a ghost **Settings** navigation button (census; C C10). | There is no list template and no detail dock. Each page assembles its own header and body. |
| Detail panel | D: `DetailPanel` + `DetailHeader` (`D:components/DetailPanel.tsx:6-43`, `DetailHeader.tsx:12-52`); one scroll region; side or bottom by width (spec 054). | `ListDetail` (`page.tsx:146-173`) is used only by Settings. Details elsewhere are right Sheets (master 30rem `calibration.tsx:624-631`, location 30rem `t1/settings/locations-page.tsx:150-156`) or inline Boxes. | Side fold-outs replace the dock. |
| Buttons | D: one `Btn` with intent variants. The action bar is `sm`, right-aligned, with one primary (`D:ui/Btn.tsx:7-39`, `PageTopBar.tsx:17-24`); "Primary button = theme accent" (`spec 043:50-52`). | 6 variants × 8 sizes (`components/ui/button.tsx:14-51`). The census found up to 7 variant/size combinations on one product page (run Review step). The primary variant follows the current step (`wrap-up.tsx:218,232,354,410,495`, `prepare-step.tsx:118`; B S1). | Role does not decide the variant. |
| Row actions | D had per-surface ⋯ menus (`D:features/settings/RootCard.tsx:134-240`) but no universal contract. | 4 local `RowActions` copies (C §1c). Many lists are right-click only (B S4: `project-sections.tsx:142-177,298-342,482-498,721-832`). | New R9 standard; not inherited. |
| Tables | D: `Table` + `SortHeader` (`D:ui/Table.tsx:28-83,269-315`; `D:components/SortHeader.tsx:6-79`), sortable headers with `aria-sort`. | `DataTable` sorts only columns that define `sortValue` (`data-table.tsx:38-49`). 18 raw `<table>` sit in `src`, 14 of them in features (C §1c). Census sortable header cells: Project page 4 of 23, Calibration 0 of 20, run Results 1 of 4. | Tables are not one component, and sorting is opt-in. |
| Filters | D: `FilterToolbar` in the PageTopBar filters slot, controlled: search, single selects with "All", multi-select popovers, group/sort (`D:components/FilterToolbar.tsx:6-69`). | `TableToolbar` (`data-table.tsx:430-450`) plus per-page chip bars. Calibration renders filters as pill buttons (13 pills-as-controls on `/calibration`, census). Targets renders presets as chips (`targets.tsx:739-879`). | There is no filter pattern. |
| Forms, settings | D: `SettingsRow` (label column + control, help below) and `SettingsSection` (`D:features/settings/SettingsKit.tsx:12-106`; `spec 043:56-57`). "Never use a text input for a directory path" (`DESIGN.md:180,217`). | No SettingsRow; 7 hand-built rows (C §1c). Two form-field modules (`t3/fields.tsx:17-96`, `t1/components/form-field.tsx:32,72`). A text box for the results file path (B Results; user item 187). | Settings layout is local per page. |
| Dialogs | D: `Modal` + `ConfirmModal`: message, optional children, inline error; footer = ghost Cancel, then the typed action (`D:components/ConfirmModal.tsx:4-15,96-110`). | `ConfirmDialog` requires `description` and `changes: string[]`, with an Unchanged list (`components/app/confirm-dialog.tsx:27-49,115-141`). Some 20 dialogs hand-build their footer, so each call site decides the button order (`ui/dialog.tsx:116`, `ui/alert-dialog.tsx:94` only lay out children). There are 7 right-side Sheets (static count). | Dialog content and footer are per call site. |
| Filesystem plans | `DESIGN.md:300-307`: plan review as a table of operations, a summary bar, nothing moves until Approve, dry-run per item. | Destructive previews list counts, not files. The file data exists but is dropped: `TrashOffer.entries` (`b-projects/model.ts:96-123`), `ArchivePlan.rows[].moves` (B S6). | File-level review was lost. |
| Feedback | D: imperative toast mounted once in the shell (`D:shared/toast.ts:49-88`; `D:app/Shell.tsx:169-174`), `Banner` (`D:ui/Banner.tsx:5-34`), an error catalogue (`D:lib/error-messages.ts:7-54`). | No toast. Outcomes are inserted in the flow (`OutcomeNotice` `c-runs/parts.tsx:145-173`, `CommitOutcome` `b-projects/parts.tsx:55`, `AddedNotice` `a-home/parts.tsx:32`, `ReturnNotice`; A STD-NOTE; B S8). | Transient outcomes push content around. |
| Help, tooltips | "Vibe-coded page descriptions removed. Per-option help becomes on-demand ⓘ only where genuinely non-obvious" (`spec 043:58-61`). | 410 `title=` attributes, 25 `HelpTip`, 33 `NoteMarker` (static). The census found 88 visible `title`s on `/targets` and 70 on the run Review step. | Slop moved from text into tooltips (the user's words). |
| Pills, status | "One pill system with semantic variants" (`spec 043:62-66`; `DESIGN.md:172-177`). | `Pill` also renders a link or button (`components/app/pill.tsx:40-84`): 16 interactive call sites plus 2 `pillClass(…, true)`. 4 status vocabularies (A X5). | Pills are both a tag and a control. |
| Tokens, density, type | Token-only CSS (`DESIGN.md:124-158`). Density rescales spacing and row height (`DESIGN.md:105-107`; `D:data/theme.ts:319-362`). Bundled Inter (`specs/055-typography-rework/spec.md:44-145`). | Density sets only `--row-h` 24/26/32 px (`index.css:89-103`). No spacing, elevation, z or motion tokens. 121 arbitrary size utilities in `src` (static). System font stack (`index.css:21-23`). | Density does nothing outside rows (user item 256). |
| Navigation | "Collapsing the sidebar collapses, never hides" (`DESIGN.md:203`). | Hidden below 768 px. The in-flight branch `ui-v5r9-shellbugs` @ `a557a38e` restores the icon rail. | Being fixed. |
| Session review | The Review queue is **session-centric**; decisions persist as reviewed metadata (`DESIGN.md:219-227`). "Action-gated transitions… the confirm button is disabled and the missing field is named" (`DESIGN.md:243`). | Review is a run step (`domain/types.ts:604`) and also an optional session view (`a-home/session.tsx`). | P-REV2 brings back the original's session-centric model. |
| Calibration | Masters with fingerprint, provenance and usage; "masters older than 90 days are flagged ⚠" (`DESIGN.md:245-251`). | No age check (C C12). The masters table has no sortable column (C C5). | Lost. |
| Onboarding | A modal orientation walk and a Getting started checklist in the sidebar above Settings (`specs/056-onboarding-redesign/spec.md:19-44`; `D:app/Sidebar.tsx:235-260`). | The walk is non-modal (`app/onboarding.tsx:160,167`; C OB6). The checklist is a Box on Home (`a-home/home.tsx:126`; C OB7). | Regressed. |
| Enforcement | `alm/no-user-string`, `alm/no-js-plural`, `alm/require-root-testid`, a `style={}` ban (`apps/desktop/eslint.config.js:31-88,130-158`), `scripts/check-tokens.sh`, and component tests (Table, Modal, ListPageLayout, DetailPanel). There was no import-boundary rule and no Storybook. | ESLint carries only the two i18n rules (`apps/prototype/eslint.config.js:39-49`). No test script (`apps/prototype/package.json:8-18`). | Nothing stops look-alikes. |

### 1b. What to keep from v5 (do not rebuild)

- **Native-feeling dense chrome** from harness v4 (`HARNESS-V5-IA.md:3`): toolbar, source list, status bar.
- **`DataTable` internals** (`data-table.tsx:1-22`): keyboard row movement, grouping, pinned first column, selection with "outside filters" reporting.
- **`Box`** (`components/app/box.tsx:1-40`) and **`Section`**.
- **The `CommitResult` refusal channel**, already the single store contract: `{ ok: false, reason: "refused", reasons }` (`HARNESS-V5-IA.md:127`).
- **The i18n gate** (`eslint.config.js:39-49`).
- **The generated theme pipeline** (`scripts/themes.mjs`, which writes `themes.css` and a contrast report).
- **The status registry** (`components/app/status.tsx:61-273`).

---

## 2. Best practice for composition, and the rules PlateVault adopts

### 2a. Cited practice

| # | Practice | Source (accessed 2026-10-12) | Applied as |
|---|---|---|---|
| 1 | Templates are "page-level objects that place components into a layout and articulate the design's underlying content structure"; pages fill them with real content. | https://atomicdesign.bradfrost.com/chapter-2/ | L3 templates own layout; L4 pages fill slots. |
| 2 | "We're not designing pages, we're designing systems of components." | https://atomicdesign.bradfrost.com/chapter-1/ | No page-local components. |
| 3 | Atomic tiers are a mental model; whether something is a molecule or an organism is a recurring argument. | https://bradfrost.com/links/post/where-atomic-design-fell-short ; https://bradfrost.com/links/post/making-sense-of-atomic-design-molecules-and-organisms | Tiers are named by responsibility and import direction (L0–L4), not chemistry. [INFERENCE] |
| 4 | Component-driven: build bottom-up; the anti-pattern is page-based work where little effort goes into reusing elements across pages. | https://www.componentdriven.org/ | Rebuild order: tokens → primitives → patterns → templates → pages. |
| 5 | Compound components give an expressive API, like `<select>`/`<option>`, instead of configuration strings. | https://kentcdodds.com/blog/compound-components-with-react-hooks | Templates and DataTable take parts and slots. |
| 6 | Every added prop adds implementation and API complexity: the "apropcalypse". | https://kentcdodds.com/blog/inversion-of-control | No `variant="calibration"` style props. Pages compose; patterns stay generic. |
| 7 | Radix `asChild` and Base UI `render` compose behaviour onto your own component. | https://www.radix-ui.com/primitives/docs/guides/composition ; https://base-ui.com/react/handbook/composition | Every trigger renders the one `Button`. |
| 8 | Headless libraries supply logic and state but not markup or styles; shadcn is "how you build your component library", with open code you modify. | https://tanstack.com/table/v8/docs/introduction ; https://ui.shadcn.com/docs | Fix a primitive in `components/ui`; never wrap it per feature. |
| 9 | React Aria offers three escape levels: parts, contexts and hooks. | https://react-spectrum.adobe.com/react-aria/components.html | New L2 patterns compose L1 without forking it. |
| 10 | DTCG Format Module 2025.10 is a platform-agnostic token format with aliases `{group.token}` and types (`color`, `dimension`, `duration`, `shadow`, …). | https://www.designtokens.org/TR/2025.10/format/ | Token source in DTCG JSON, which survives the stack decision. |
| 11 | Material 3 has reference, system and component tokens; density is a numbered scale applied to padding and height. | https://m3.material.io/foundations/design-tokens/overview ; https://m3.material.io/foundations/layout/grids-spacing/density | ref/sys/comp tiers; one density switch. |
| 12 | Carbon: toolbar, batch bar and pagination heights "should always match the row height". | https://carbondesignsystem.com/components/data-table/style/ | `batchbar.h = toolbar.h`, so selection causes no layout shift. |
| 13 | Carbon: the batch action bar replaces the toolbar on selection, and row overflow menus are disabled while it is active. Use a row overflow menu when there are three or more actions. | https://carbondesignsystem.com/components/data-table/usage/ | SelectionBar and RowActions rules. |
| 14 | Shopify: "no more than one primary action and 3 secondary actions per page"; page actions only when relevant to the whole page. | https://shopify.dev/docs/api/app-home/web-components/layout-and-structure/page | ActionBar caps; the rest go to a named menu. |
| 15 | Shopify index table: checkboxes for bulk selection, row actions on hover, confirm destructive bulk actions, toast feedback. | https://shopify.dev/docs/api/app-home/patterns/compositions/index-table | Bulk flow. |
| 16 | Atlassian: no links or buttons in table headings; edit and delete go in the "more actions" menu. | https://atlassian.design/components/dynamic-table/usage | Headers only sort. |
| 17 | Apple: one prominent button per view; never make a destructive action primary. | https://developer.apple.com/design/human-interface-guidelines/buttons | `kind: destructive` is never primary. |
| 18 | Apple: "Always make context menu items available in the main interface, too." | https://developer.apple.com/design/human-interface-guidelines/context-menus | ⋯ and the context menu come from one list. |
| 19 | Apple and Windows: a pull-down or menu for grouped commands; frequent commands get their own button. | https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons ; https://learn.microsoft.com/en-us/windows/apps/design/controls/menus-and-context-menus | Named menus ("Run ▾", "Add ▾"). |
| 20 | Apple: popovers for a small amount of information, never a popover in a popover; a sheet is for a scoped task. | https://developer.apple.com/design/human-interface-guidelines/popovers | HoverCard for previews; Dialog for tasks; no side fold-outs. |
| 21 | Dialog button order differs: macOS puts the default button on the trailing side and Cancel on the leading side. Windows puts the do-it buttons left and the safe Close/Cancel right. GNOME puts Cancel first and never binds Return to an irreversible action. | https://developer.apple.com/design/human-interface-guidelines/alerts ; https://learn.microsoft.com/en-us/windows/apps/design/controls/dialogs-and-flyouts/dialogs ; https://developer.gnome.org/hig/patterns/feedback/dialogs.html | One `DialogFooter` owns the order (Q1). |
| 22 | Don't confirm common undoable actions; prefer undo; confirm serious consequences with specific verbs. | Apple alerts (above); https://www.nngroup.com/articles/confirmation-dialog/ ; https://learn.microsoft.com/en-us/windows/win32/uxguide/mess-confirm | Toast with Undo; ConfirmDialog only for irreversible moves. |
| 23 | Show errors close to their source, in human-readable language, with constructive advice. | https://www.nngroup.com/articles/error-message-guidelines/ ; https://learn.microsoft.com/en-us/windows/apps/design/style/writing-style | Refusal beside the control, naming cause and fix. |
| 24 | Tooltips: describe only the control and don't repeat its name (Apple). Don't use a tooltip for text already visible (Windows). If there's no helpful content, don't offer a tooltip (NN/g). | https://developer.apple.com/design/human-interface-guidelines/offering-help ; https://learn.microsoft.com/en-us/windows/apps/design/controls/tooltips ; https://www.nngroup.com/articles/tooltip-guidelines/ | §6 tooltip policy. |
| 25 | Progressive disclosure: defer rarely used detail; more than two disclosure levels hurts usability. | https://www.nngroup.com/articles/progressive-disclosure/ ; https://developer.apple.com/design/human-interface-guidelines/disclosure-controls | File lists fold out one level only. |
| 26 | Wizards suit infrequent tasks and enforce a clear sequential order; labels should say what happens next. | https://www.nngroup.com/articles/wizards/ | StepFlow for staged work; the order rule is in Q3. |
| 27 | Carbon progress indicator: for linear processes of three or more steps; labels of 1–2 words; states completed, current, not started, error, disabled. | https://carbondesignsystem.com/components/progress-indicator/usage/ | StepStrip states and names. |
| 28 | PatternFly wizard: Back, Next, Cancel; one primary in the footer; end with a review step; on the last step, replace Next with a specific verb. | https://www.patternfly.org/components/wizard/design-guidelines | StepFooter; the terminal verb ("Finish run…"). |
| 29 | Sentence case; button text is a verb plus object; plain English; a words-to-avoid list. | https://design-system.service.gov.uk/components/button/ ; https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide ; https://learn.microsoft.com/en-us/style-guide/capitalization ; https://developer.apple.com/design/human-interface-guidelines/writing | Copy lint (§6, §8). |
| 30 | Enforce with lint AST selectors and import restrictions; a catalogue as the single source of truth for components. | https://eslint.org/docs/latest/rules/no-restricted-syntax ; https://eslint.org/docs/latest/rules/no-restricted-imports ; https://storybook.js.org/docs/get-started/why-storybook | §8 rules with no new dependency. |
| 31 | Governance: default to the system; when a pattern is missing, ask the system owner whether it is a snowflake or part of the system. A "solitary" owner model is valid for a single team. | https://bradfrost.com/blog/post/a-design-system-governance-process/ ; https://nathanacurtis.substack.com/p/team-models-for-scaling-a-design-system-2cf9d03be6a0 | The lead owns L1–L3; workers compose. |
| 32 | Portability: Flutter widgets compose small widgets and theme through `ThemeData` + `ThemeExtension`. SwiftUI uses `ButtonStyle` / `ViewModifier`. WinUI uses implicit styles and `BasedOn`. | https://docs.flutter.dev/resources/architectural-overview ; https://api.flutter.dev/flutter/material/ThemeExtension-class.html ; https://developer.apple.com/documentation/swiftui/buttonstyle ; https://learn.microsoft.com/en-us/windows/apps/design/style/xaml-styles | Contracts and tokens survive a stack change; L1 code does not (§3.6). |

Not verified this round: the live Fluent 2 web Dialog and Tooltip pages (WinUI docs were used); the legacy Polaris React pages (current shopify.dev used); Material 3 text, which was read through a mirror. The full list is in `local://r9-comp-research.md`.

### 2b. PlateVault composition rules (normative)

- **C-1 Pages compose only.** A page (L4) renders L3 templates and L2 patterns, passing data and Action descriptors.
  - It never defines a styled component or renders an intrinsic interactive element (`button`, `table`, `input`, …).
  - It never sets visual `className` on L1/L2 components.
- **C-2 One home for unique UI.** Astro-specific visualisations go in `components/domain/` (L2-domain), owned and catalogued like any pattern: plate viewer, histogram, altitude spark, night timeline, Moon line, mosaic field, corner grid, filmstrip. "No custom components in a page" never means "no histogram". It means the histogram is not page-local.
- **C-3 Actions are data.** Every user action is an `Action`. Its variant comes from its `kind` (primary · standard · destructive), never from the flow position. One primary per view.
- **C-4 One table.** `DataTable` renders all tabular data, with sortable headers by default. `KeyValueList` renders label/value facts. Nothing else emits `<table>`.
- **C-5 One feedback route per situation** (table in §3.3 P7).
- **C-6 One flow for staged work.** `StepFlow` (StepStrip + StepFooter with Skip · Proceed), hosted by `StepPage`, or by `FormDialog` for short two-step tasks.
- **C-7 Menus are named.** Object menus ("Project ▾", "Run ▾"), add menus ("Add ▾") and view menus ("Display ▾", "Presets ▾"). `⋯` is reserved for row actions.
- **C-8 No side fold-outs.** Tasks open a centred Dialog; details open the docked DetailPanel; previews open a HoverCard; long flows are a StepPage route. The only Sheets left are the narrow-viewport navigation drawer and the Prototype simulation panel.
- **C-9 Pills and status badges are inert.** Navigation is a link button or tabs; actions are buttons.
- **C-10 Help on demand only** (§6).
- **C-11 Reuse before rebuild.** Search the catalogue first. A missing pattern goes to the owner (§8.7), not into the page.
- **C-12 Copy from the catalogue only**, passing the copy lint (§6). No borrowed keys (B S10).

## 3. Layered architecture

### 3.0 Layers and import direction

| Layer | Home | Owns | May import | Never |
|---|---|---|---|---|
| T tokens | `tokens/*.json` (DTCG, new) → generated `src/themes.css` + `@theme` in `src/index.css` | Colour, surface, space, control height, row height, radius, elevation, motion, z, dialog sizes | – | Literal values in components |
| L0 headless | `@base-ui/react` ^1.8.0 (`package.json:20`) | Behaviour, focus, ARIA, positioning | – | Imported outside L1 (true today: 0 direct imports in features) |
| L1 primitives | `components/ui/*` | Look of one control (cva variants) | L0, tokens, `lib/utils` | L2, L3, features, store |
| L2 patterns | `components/app/*`, `components/domain/*` (new) | Composition and behaviour contracts (Action, Refusal, StepFlow, Column, Facet) | L1, `domain` types, `app/preferences` (messages) | L0 directly, features |
| L3 templates | `components/templates/*` (new) | Page layout: header, toolbar, body, footer, detail dock, notice slot | L2, L1 | features, store writes |
| L4 pages | `features/<area>/*` | Data, actions, copy keys, slot filling | L3, L2, `domain`, `store`, `lib` | L1 (end state), L0, other feature areas, intrinsic interactive elements, visual classes |

### 3.1 Tokens

**Today.**
- `themes.css` is generated from palettes in `scripts/themes.mjs:99-106`, which also writes the contrast report (`themes.mjs:464-472`; header `themes.css:1-5`).
- `@theme` lives at `index.css:20-87`.
- Type scale 11/13/14/15/17/22 px (`index.css:24-36`).
- Radius: base 5 px (`index.css:89-93`) with derived steps (`index.css:82-86`).
- Density is `--row-h` only, 24/26/32 px (`index.css:89-103`). The density picker copy promises 28/32/40 (`t1/settings/appearance-page.tsx:23-26`), which conflicts.
- No spacing, elevation, z-index or motion tokens.
- Literal shadows in `ui/button.tsx:20-22`.
- 121 arbitrary size utilities in `src`. Sheet widths are literals: `w-[96vw]` `home.tsx:147`, `w-[50rem]` `import.tsx:124`, `w-[38rem]` `new-project.tsx:44`, `w-[30rem]` `start-run.tsx:34`.

**Target.**
- **Source in DTCG JSON.**
  - Extend the existing builder (`scripts/themes.mjs`) to read `tokens/*.json` and emit `themes.css`, the `@theme` block and the contrast report, so there is no second build authority.
  - The same JSON later generates Dart `ThemeExtension`, Swift or XAML resources, whichever stack wins (§3.6).
- **Tiers.**
  - `ref.*`: palettes.
  - `sys.*`: surface, text 1–4, border, accent, status, `space-0…7`, `control-h-sm/md`, `row-h`, `radius-*`, `elevation-0…3`, `motion-fast/base`, `z-*`.
  - `comp.*`: `table.row-h`, `toolbar.h = batchbar.h = table.row-h + space-2` (row 12 of §2a), `dialog.w-sm/md/lg`, `stepfooter.h`.
  - Features see only sys/comp through Tailwind utilities.
- **Density** is one sys switch rescaling `space-*`, `control-h-*` and `row-h`, as in the original (`D:data/theme.ts:319-362`; `DESIGN.md:105-107,151-152`). It is a new scale for the prototype, so it needs approval under `rule://design-token-discipline` (Q11).
- **Replaces:** the 121 arbitrary values, the four sheet widths (→ `dialog.w-*`), and the literal shadows (→ `elevation-*`).

### 3.2 L1 primitives: keep, trim, add

| Primitive | Change | Evidence |
|---|---|---|
| `button` | Variants become `default` (primary), `outline` (standard), `ghost` (quiet/icon), `destructive` (irreversible), and `link` (inline navigation only). Remove `secondary` (review Pick/Reject toggles become a `ToggleGroup`). Sizes: `sm` (chrome), `default` (dialog footer), `xs` (inside DataTable cells only) and `icon-sm` (icon-only). Remove `lg`, `icon`, `icon-xs` and `icon-lg` after W3. | `button.tsx:17-49`. The census found `secondary` on the Project page and the run Review step, `outline/default` and `default/default` in the Targets and Target headers, and `ghost/default` in the Calibration header. |
| `badge` | Base of `Pill`/`StatusBadge` only; no feature import. | `about-page.tsx:47`, `t4/badges.tsx:36` |
| `table` | Becomes the rendering parts of `DataTable` (one table look); no feature import. | Unused today (C §1a) |
| `hover-card` | **New**, on Base UI `preview-card`, which is already installed (A §11). | – |
| `toast` | **New**, on Base UI `toast`, which is already installed (A STD-NOTE). | – |
| `sheet` | Kept only for the narrow-viewport navigation drawer (`app/shell.tsx:334-364`) and the Prototype simulation panel (`app/simulation-panel.tsx:463-472`). | 7 `side="right"` uses (static) |
| `card`, `scroll-area`, `button-group` | Delete: no consumers, and `ToggleGroup` covers segmented controls. | C §1a row "card, breadcrumb, button-group, scroll-area: 0 consumers" |
| `breadcrumb` | Adopt for the `PageHeader` path slot (today `eyebrow`, `page.tsx:90-95`). | – |
| `field`, `input`, `select`, `combobox`, `checkbox`, `switch`, `radio-group`, `textarea`, `toggle-group`, `tabs` | Consumed through L2 Field components; no direct feature use in the end state. | 194 feature imports of `components/ui` |
| `dialog`, `alert-dialog` | Their footers are used only by L2 `DialogFooter`. | `dialog.tsx:100-119`, `alert-dialog.tsx:85-99` |

### 3.3 L2 composed patterns

Every pattern below gives its purpose, an API sketch, what it replaces (file:line), and the duplicates it deletes. The shared contract types (Action, MenuItem, Blocker, FlowStep, Facet, FileRow) go in one file, `components/app/contracts.ts`, written by the lead in W0, so W1 units build against one shape.

#### P1 Action model, ActionBar, ActionMenu — `components/app/actions.tsx`

**Purpose.** One descriptor per user action. It renders consistently as a header button, a named pull-down, a row ⋯ item, a context-menu item and a command-palette entry. Apple: context-menu items also in the main interface (row 18 of §2a).

```ts
type ActionKind = "primary" | "standard" | "destructive"      // destructive = irreversible; never primary
interface Action {
  id: string; label: string; icon?: LucideIcon; kind?: ActionKind   // default "standard"
  run: () => CommitResult | void | Promise<CommitResult | void>
  unavailable?: { action: string; reason: string; blockers: Blocker[] }  // focusable-disabled + BlockersPreview
  confirm?: ConfirmSpec          // opens ConfirmDialog (P8) before run
  shortcut?: string
  opensDialog?: boolean          // adds "…" (Apple menus)
}
type MenuItem = Action | { separator: true } | { heading: string } | { submenu: string; items: MenuItem[] }

<ActionBar actions={Action[]} overflow?={MenuItem[]} />   // ≤1 primary (trailing), ≤3 standard, rest → "More ▾"; size sm
<ActionMenu label="Run" items={MenuItem[]} />             // named pull-down "Run ▾", outline sm
useAction(action) → { run, refusal }                       // keeps a refusal beside its trigger (P7)
```

**Replaces.**
- `MenuEntry` (`components/app/row-menu.tsx:20-22`): becomes `MenuItem`, extended.
- Per-call-site variant/size choices in headers (census table in §4).
- Flow-dependent variants: `variant={current ? "default" : "outline"}` (`wrap-up.tsx:218,232,354,410,495`) and `variant={openable ? "outline" : "default"}` (`prepare-step.tsx:118`).
- Ad-hoc command lists in `useCommands` contributions (palette entries become registered Actions).

**Deletes.** `CompleteButton` (`c-runs/done-step.tsx:50`), `CreateProjectButton` (`a-home/parts.tsx:147`), `AddSiteButton` (`e-targets-plan-settings/parts.tsx:168`), `MoonLimitsButton` (`moon-limits.tsx:133`), `ExportCalendarButton` (`planned-tools.tsx:133`). `PrototypeMenu` (`c-runs/parts.tsx:205-229`) merges into the one toolbar Prototype menu.

#### P2 RowActions (⋯ + context menu) — `components/app/row-actions.tsx`, `DataTable.rowActions`

**Purpose.** Every row with actions shows a visible ⋯ (ghost `icon-sm`, accessible name "Actions for {row}"). The right-click menu holds the same list. At most one inline primary row action is shown as an `xs` outline button (Carbon: inline when fewer than three; row 13).

```tsx
<DataTable rowActions={(row) => MenuItem[]} primaryRowAction?={(row) => Action} … />
<RowActions label items />   // for the rare non-table list
```

**Replaces.**
- 4 local copies: `e-targets-plan-settings/targets.tsx:222-241`, `c-runs/parts.tsx:240-263`, `t1/components/row-menu.tsx:42-64` (`RowMenu` + `rowMenuColumn`), and inline `locations-page.tsx:366,370-385`.
- Right-click-only lists: `project-sections.tsx:142-177,298-342,482-498,721-832`, calibration masters (C C3), and Sessions and Home rows (A STD-ROW).
- Inline text buttons:
  - Make default: `sites-page.tsx:247`, `locations-page.tsx:386`.
  - Rescan: `locations-page.tsx:391`.
  - Equipment row actions: `settings-equipment.tsx:321,409,413-415`.
  - Template Delete: `settings-goal-templates.tsx:169`.
  - Rig Remove: `project-sections.tsx:835-851,867-911`.
  - Goal ×: `goals.tsx:135-137`.
  - Naming chip ×: `settings-naming.tsx:239-241`.

**Deletes.** `RowMenu`, `rowMenuColumn`, the two local `RowActions`, and the public `DataTable.contextMenu` prop. `RowContextMenu`/`ContextMenuArea` become internal.

#### P3 SelectionBar (batch bar) — inside `DataTable`

**Purpose.** While at least one row is selected, the toolbar row is replaced **in place, at the same height**: "{n} selected · {k} hidden by filters [Show] · actions… · ✕ Clear". Unavailable batch actions explain themselves in a HoverCard (A STD-BULK). Row ⋯ stays enabled for single-row work, a deliberate deviation from Carbon because the user acts on single rows while a selection exists [INFERENCE].

```tsx
<DataTable selection={{ selected, onChange, rowLabel, isSelectable }} batchActions={(rows) => Action[]} toolbar={…} />
```

**Replaces.**
- The in-flow `SelectionBar` (`data-table.tsx:458-518`) that pushes the table down (B S8; user items 33, 117).
  - The in-flight branch `a557a38e` moves it under the table as an interim fix; W1 supersedes that.
- Candidates "Start run…" / "Review frames" placement (`project-sections.tsx:503-539,556-588`; B §2 "four places").
- The review threshold and refusal rows above the table (`frame-review.tsx:898-942`).
- The Done step's selectable clean-up table (`done-step.tsx:231-305`).
- Per-row Accept in Results (`results-step.tsx:247-251`).
- Sessions bulk Archive / Move to Trash.

#### P4 DataTable (extended) — `components/app/data-table.tsx`

**API delta.**
- `columns[].sortValue` becomes **required** unless `static: true`. The header is a borderless sort button, with an arrow only on the active column (D `SortHeader`; Carbon). It stays a warning until W4, then becomes a type error.
- `rowActions`, `primaryRowAction`, `batchActions` (P2, P3).
- `toolbar?: { search?, facets?, presets?, actions?: Action[] }`, which renders `FilterBar` (P5) in the toolbar slot.
- `expand?: (row) => ReactNode`: an expandable row holding a nested DataTable. This is the one fold-out for file-level detail in Wrap up, Finish run and ConfirmDialog groups.
- States: `loading` (`TableSkeleton`), `empty` (EmptyState: one line plus one action), `error` (`ActionError` + Retry).
- Column visibility is bound to `DisplayMenu` (P13). Density comes from `comp.table.row-h`. No per-cell `className` from features (lint).
- Renders through `components/ui/table` parts.
- `virtual?` for 10k-frame lists is **deferred**. A virtualiser is a new dependency (`@tanstack/react-virtual`, or an in-house one), not decided here.

**Replaces.**
- `SimpleTable` (`project-sections.tsx:83-101`) and its four uses (`:778-832,867-911,963-1018,1055-1091`).
- Raw tables (C §1c):
  - `calibration.tsx:218` (Processes);
  - `settings-equipment.tsx:373` (rig filters);
  - `settings-goal-templates.tsx:143`;
  - `activity.tsx:272`;
  - `target.tsx:387,493,529`;
  - `targets.tsx:916`;
  - `moon-limits.tsx:97`;
  - `d-review/list.tsx:258` (frame table);
  - `t3/frame-preview.tsx:174,234` (value tables, which become KeyValueList);
  - `t3/import-dialog.tsx:129`;
  - `app/design-system-page.tsx:260` (which becomes KeyValueList).
- Missing `sortValue`: calibration masters (`calibration.tsx:471-508`; C C5), processes (C C6), sites (C O2), sensor (C E8), Results (only File sorts; B Results), and Project tables (census: 4 of 23 headers sortable).

**Deletes.** `SimpleTable`; every raw `<table>` in features; the public `TableToolbar`/`SelectionBar` exports (now internal).

#### P5 FilterBar with presets — `components/app/filter-bar.tsx`

**Purpose.** One controlled filter row (D `FilterToolbar`):
- clearable search (`/` focuses it);
- named facets (a single select with "All {label}" first, or a multi-select checkbox popover "Filter ▾ (2)");
- one **Presets ▾** menu (built-ins, saved custom presets, "Save current…", "Delete preset…");
- removable active-filter chips with match count and Clear.

No tooltips on filters (user item 21). The poor grade uses the danger tone (user item 15).

```tsx
<FilterBar search={{ value, onChange, label }} facets={Facet[]} presets?={{ items: Preset[], apply, save, remove }} matchCount />
interface Facet { id: string; label: string; kind: "single" | "multi"; options: { value: string; label: string; count?: number }[]; value: string | string[] }
```

**Replaces.**
- Calibration pill-button filters: `FilterChip` (`calibration.tsx:687-692,830-850`).
- The Targets filter bar with chip presets (`targets.tsx:739-879`; user item 9). The "Good tonight for" single select becomes a multi facet (user item 13).
- Sessions `FILTERS` (`sessions.tsx:46`).
- The candidate filter button group (`project-sections.tsx:503-539`).
- "Selected only" (`select-step.tsx:111-114,233-263`), which becomes the facet "In run: All · Selected".
- Activity filters.

**Deletes.** `FilterChip` (`calibration.tsx:687`) and `FilterPill` (`e-targets-plan-settings/parts.tsx:208`). The grade strip `FilterChips` (`parts.tsx:222`) is renamed `GradeBadges` (display only), which ends the name clash with `components/app/data.tsx:223` (C §1c).

#### P6 Field family, SettingsRow, SettingsSection — `components/app/fields.tsx`, `components/app/settings.tsx`

```tsx
<Field label description? error? required?>{control}</Field>
TextField · NumberField{unit,min,step} · SelectField{options} · ComboboxField{groups} · SegmentedField (ToggleGroup) · SwitchField
PathField{ mode: "folder" | "file" | "executable"; filters? }   // OS picker; never a text box (DESIGN.md:180)
TokenTemplateField{ tokens, preview }       // naming: text input + live preview + token table (user items 288-294)
ArgumentsField{ tokens: ["{folder}","{file}"] }   // inline error on unknown tokens (PREV A7)
<SettingsSection title actions?> <SettingsRow label help?>{control}</SettingsRow> </SettingsSection>   // D: SettingsKit.tsx:12-26
```

**Replaces.**
- `SelectField` and `NumberField` (`t3/fields.tsx:17-96`; 6 v5 importers).
- `TextField` and `FieldMessage` (`t1/components/form-field.tsx:32,72`).
- `MiniSelect` (`d-review/frame-review.tsx:103`).
- `RecordSelect` (`equipment-records.tsx:177`) and `CameraKindField` (`equipment-records.tsx:39-50`).
- `OptionCard` radio cards (`c-runs/parts.tsx:179-192`). Prepare's run view becomes a `SegmentedField` "Symlinks · Copies" (P-PREP3; user item 163).
- Hand-built rows: `appearance-page.tsx:83`, `target-lookup-page.tsx:148`, `about-page.tsx:79,85`, `app/shortcuts.tsx:114`, `d-review/shortcuts.tsx:72`, `t4/prototype-controls.tsx:14`.
- The Results attach path text box (`results-step.tsx:271-315`; user item 187), which becomes a file-mode PathField.
- Applications "Locate" (`t4/profile-parts.tsx:73-130`), which becomes an executable PathField plus a detected list (user item 306).
- Naming chips (`settings-naming.tsx:156-257`), which become TokenTemplateField.
- The full-width goal-template selector (`new-project.tsx:206-229`; user items 101-105), which becomes "From template ▾" in the Goals section header.

**Deletes.** `t3/fields.tsx`, `t1/components/form-field.tsx`, `MiniSelect`, `RecordSelect`, `CameraKindField`, `OptionCard`. Also the `folder_picker_description` default (`components/app/folder-picker.tsx:99`; C C7, which fixes 6 consumers).

#### P7 Feedback: Refusal, ActionError, toast, notice slot — `components/app/feedback.tsx`, `refusal.tsx`

| Situation | Component | Placement |
|---|---|---|
| Action unavailable now (standing) | Focusable-disabled button + `BlockersPreview` HoverCard: "Can't archive · 2 in a Project" with a table (Item · Where ▸) | On the button; nothing is inserted |
| Action refused on click | `Refusal` (`role=alert`), terse line, same HoverCard for blockers | Beside the control, never above a list |
| Field invalid | `ActionError` | Under the field |
| Operation finished with an off-screen effect (trash, archive, rescan, import) | `toast({ message, action?: Action /* Undo · Show */ })`, history in Activity | Bottom trailing, mounted once in `RootLayout` |
| Standing page state (offline location, closed project, read-only) | `Notice` | The template's `notice` slot, fixed under the header |
| App-wide problem | Issues hub, dismissable (P-ISS1) | Toolbar and status bar |

**Replaces.**
- The Refusal inline disclosure button and its Pill-link blocker chips (`refusal.tsx:49-71`; A X2).
- `OutcomeNotice` + `useOutcome` (`c-runs/parts.tsx:109-173`).
- `CommitOutcome`, `InlineError` and `useCommitError` (`b-projects/parts.tsx:34-75`).
- `AddedNotice` (`a-home/parts.tsx:32`).
- `ReturnNotice` (`settings-layout.tsx:91`; C S0b).
- `RetireReviewPanel` (`locations-page.tsx:219`).
- The unknown-filter Notice (`settings-equipment.tsx:291-312`), which moves to Issues.
- The calibration import outcome inserted at the top of the body (`calibration.tsx:795-800`; C C13), which becomes a toast.
- The duplicates warning row (`locations-page.tsx:428-435`), which moves to Issues.
- `title=` on disabled buttons ("Already at the defaults", `appearance-page.tsx:41-47`).

**Deletes.** `OutcomeNotice`, `useOutcome`, `CommitOutcome`, `InlineError`, `useCommitError` → one `useAction`.

#### P8 ConfirmDialog with fold-out file lists; DialogFooter; FormDialog — `components/app/confirm-dialog.tsx`, `form-dialog.tsx`

```tsx
<ConfirmDialog
  title="Move 14 files to Trash?"            // verb + object
  summary?="1.2 GB · 2 locations"             // optional; description no longer required
  groups={[{ label: "Unusable frames", rows: FileRow[], defaultOpen: false }]}   // Collapsible + DataTable
  confirm={{ label: "Move to Trash", kind: "destructive" }} onConfirm />
interface FileRow { file: string; from: string; to?: string; action: "trash" | "move" | "unlink" | "copy"; size: number; status?: { label: string; link?: StepLink } }
<DialogFooter cancel={…} confirm={Action} />   // owns order per platform (Q1); Enter never triggers a destructive confirm (GNOME)
<FormDialog title size="sm|md|lg" steps?={StepFlow}> fields </FormDialog>   // centred; hosts short two-step flows (P11)
```

**Rules.**
- Heading "Changes" (not "This will", `confirm_changes`). No Unchanged list unless something non-obvious stays (`HARNESS-V5-FEEDBACK-R1.md:10`).
- The Status column carries per-file refusals instead of chip lines:
  - "Linked by NGC 7000 OIII deep ▸" (P-TRASH2, `FEEDBACK-R1:302-304`);
  - "Read-only";
  - "Offline";
  - "Used by M 42 ▸".
- Destructive tone only for irreversible actions. Moves to the OS Trash are reversible, so they use the standard tone with a specific verb, and the toast offers Show in Trash [INFERENCE: the user may prefer destructive styling for Trash; see Q2].

**Replaces.**
- `changes: string[]` / `unchanged` (`confirm-dialog.tsx:27-49,115-141`) at 39 call sites.
- The dropped file data: `TrashOffer.entries` (`b-projects/model.ts:96-123`) and `ArchivePlan.rows[].moves` (B S6).
- Trash offer rows (`wrap-up.tsx:341-347,374`), the archive confirm (`wrap-up.tsx:415-418`), and the Complete confirm with default-on checkboxes (`done-step.tsx:59-60,92-93,116-121`).
- The Empty Trash dialog (`trash.tsx:220-229`).
- The duplicates review Sheet (`t1/components/duplicates-review.tsx:37-43`, 46rem), which becomes Issues › Duplicates as a `FormDialog lg` with a DataTable plus ConfirmDialog.
- About 20 hand-built Dialog footers:
  - `add-location-flow.tsx:107-120`, `locations-page.tsx:102-115`, `sites-page.tsx:80-93`;
  - `t3/import-dialog.tsx:87-92`, `t4/profile-parts.tsx:91-95`, `details-dialog.tsx:39-45`;
  - `calibrate-step.tsx:372-386`, `results-step.tsx:279-294,337-344`, `select-step.tsx:416-420`;
  - `equipment-records.tsx:92-97,152-157,254-258`, `settings-equipment.tsx:116-120,207-214`;
  - `settings-goal-templates.tsx:98-103`, `planned-tools.tsx:182-186`, `d-review/shortcuts.tsx:66-70`.

**Deletes.** The default `unchanged` rendering, the `confirm_changes` key, and every feature-level `SheetContent side="right"` (`new-project.tsx:43-47`, `start-run.tsx:33-43`, `import.tsx:124`, `home.tsx:146-153`, `duplicates-review.tsx`).

#### P9 HoverCard previews — `components/ui/hover-card.tsx` (L1), `components/app/previews.tsx` (L2)

**Purpose.** Small, data-bearing previews on hover **and** focus. The trigger is always also a real link or button to the full place, so nothing is hover-only. [INFERENCE: confirm Base UI `preview-card` focus-open behaviour before build; fall back to a click Popover.]

| Pattern | Use |
|---|---|
| `UsedByPreview` | "Used by 6 runs ▸" → list of links (FEEDBACK-R1 round 5 "Used by is a popover") |
| `BlockersPreview` | Refusal and disabled-action blockers as a table |
| `MasterPreview` | Calibrate step: recommended master with metadata and a search (user items 149-155) |
| `StatsPreview` | Histogram hover readout (`R9-PIXINSIGHT-STATS.md` §3b) |
| `SessionPreview` | Candidate rows and Up next |

**Replaces.**
- Used-by triggers styled with `pillClass(…, true)` (`calibration.tsx:403-407,447`; C C15-C16).
- Equipment "Used by" joined into one value (`settings-equipment.tsx:354`; C E4).
- Data in `title=`, e.g. the goal warning (`project-sections.tsx:673-690`).
- The calibration right-side frame menu (user item 151).

**Deletes.** The `interactive` parameter of `pillClass` (`pill.tsx:52-55`).

#### P10 StatusBadge, display-only Pill, CountBadge — `components/app/status.tsx`, `pill.tsx`

**API.**
- `<StatusBadge kind value />`, from the one STATUS registry (`status.tsx:61-273`): glyph + word.
- `<Pill tone>` is an inert tag (channel, band, kind).
- `<CountBadge>`.
- Pill loses `link` and `onClick` (`pill.tsx:40-84`): deprecated in W1, removed in W4.

**Replaces.**
- `T4Badge` (`t4/badges.tsx:36`) and the raw `Badge` (`about-page.tsx:47`).
- `GateLabel` (`app/run-ui.tsx:63`).
- The hand-rolled step pills (`done-step.tsx:220-225`) and the Wrap up state pills (`wrap-up.tsx:55-62,130-148`).
- The stage strip Pills (`project.tsx:143-149`), which become Tabs (§3.4).
- The "Wrap up" pill link (`results-step.tsx:42-50`, `done-step.tsx:239`).
- Add-channel chips (`goals.tsx:101-116`), which become "Add goal ▾".
- The mosaic panel pill inside a `<button>` (`project-sections.tsx:810-818`).

16 interactive Pill sites in all (static).

**Deletes.** `T4Badge`, `GateLabel`, and the public `pillClass`.

#### P11 StepFlow: StepStrip + StepFooter — `components/app/step-flow.tsx`

The contract is plain data (portable):

```ts
interface FlowStep { id: string; label: string; state: "todo" | "current" | "finished" | "skipped" | "blocked" | "redo"
                     optional?: boolean; gate?: { reason: string; blockers: Blocker[] } | null; summary?: string }
interface StepFlow { steps: FlowStep[]; current: string; ordered: boolean
                     proceed: Action /* label "Proceed" or the terminal verb */; skip?: Action /* optional steps only */
                     reopen?: (stepId: string) => Action; linkFor: (stepId: string) => StepLink }
<StepStrip flow />    // under the PageHeader: glyph + word per step, never truncated, aria-current; later steps viewable, read-only when ordered
<StepFooter flow />   // fixed at the bottom of the step pane: left = step summary; right = [Skip] ghost + [Proceed] primary
```

- An unmet gate makes Proceed focusable-disabled, with `BlockersPreview`: "Proceed blocked · 2 unresolved ▸". The original precedent is `DESIGN.md:243`.
- The toolbar **Next** (`app/shell.tsx:193-240`) becomes the ⌘↩ shortcut for the same Proceed. There is no second button.
- Step operations sit in the step table's toolbar or batch bar as standard (outline) actions, never primary.

**Replaces.**
- `StepBar` and its "Next" badge (`c-runs/parts.tsx:36-80`; `run_step_next`).
- `StepIndicator` (`page.tsx:175-210`).
- `StageStrip` (`project.tsx:132-159`).
- `StepBox` + `SettleButtons` (`wrap-up.tsx:130-181`).
- Calibration `ProcessSteps` glyphs with names only in tooltips (`calibration.tsx:102-105,218-245`; C C6).
- `SetupHeader` (`t1/setup/setup-pages.tsx:35-47`).
- The Select sticky footer (`select-step.tsx:305-321`) and the Review status-line Save (`frame-review.tsx:1039-1050`).
- The Done-step Box-header actions (`done-step.tsx:194-214,240-245`).
- Group step buttons scattered in Boxes (`group.tsx:323-328,507-559,635-672`).
- `NextActionButton` (`app/shell.tsx:193-240`).

**Deletes.** `StepBar`, `StepIndicator`, `StageStrip`, `StepBox`, `SettleButtons`, `SetupHeader`, `ProcessSteps`, `CompleteButton`.

#### P12 NightPicker, SitePicker, SiteLocationField, TargetPicker — `components/app/pickers.tsx`

**API.**
- `<NightPicker value onChange weekStep? />`: ‹ · date (calendar popover) · › · **Today**. The ‹ › buttons step a week when `weekStep` is set (user item 11). One planning context shared by Home and Targets (R9-HOME-DEBATE §3).
- `<SitePicker value onChange />`: a Select of sites with the default marked, plus "Manage sites…".
- `<SiteLocationField>`: lat/lon/elevation fields as the source of truth, plus an optional map (Q5).
- `<TargetPicker groups={["mine","catalogue","simbad"]} onPick />`: a ComboboxField; clicking a result performs its primary action (FEEDBACK-R1 round 5).

**Replaces.**
- The Targets night controls (`targets.tsx:204-212,708-712`) and the Home Tonight box copy of them (`home.tsx:576-697`). Home has no site or date control today (user items 3, 125).
- `SubjectSearch` (`b-projects/parts.tsx:146`) and `TargetSelect` (`a-home/parts.tsx:165`), which become TargetPicker.
- The numeric-only site form (`sites-page.tsx:32-155`; C O1).

**Moves.** `DarkLine`, `MoonLine` and `AltitudeSpark` (`e-targets-plan-settings/parts.tsx:70-101,117`) go to `components/domain/`.

#### P13 DisplayMenu — `components/app/display-menu.tsx`

```tsx
<DisplayMenu label="Display" groups={[
  { kind: "radio", label: "Stretch", value, options },
  { kind: "check", label: "Overlays", items: [{ id: "fwhm", label: "FWHM", checked }, { id: "ecc", label: "Eccentricity", checked }] },
  { kind: "columns", table: tableId } ]} />
```

**Used by** frame review (plate, compare, corners), the Targets column choice, and any DataTable with optional columns.

**Replaces.**
- The page-composed menu (`frame-review.tsx:839-887`; B "great, why not everywhere").
- Overlay toggles that exist only in Corners (`frame-review.tsx:145-147,580-592,638-645`; user item 47).
- The 2:1/Linear pan tooltip (`preview.tsx:602-603`; user item 135).

Mouse-wheel and click zoom (user item 49) belong to the `Plate` domain component, not the menu.

#### P14 Shell parts — `components/app/nav-list.tsx`, `checklist.tsx`, `issue-row.tsx`, `theme-picker.tsx`

- **NavList**: one source-list row for the sidebar and Settings. It replaces `SettingsMenu` (`settings-layout.tsx:16`) next to `NavLink` (`app/shell.tsx:114-142`), and fixes the highlight contrast (A SH2). Recent moves below Library with submenus for Projects, Sessions and Targets (user item 81; A SH3).
- **ChecklistRing** in the existing `SidebarFooter` slot (`app/shell.tsx:307-312`): a progress ring + Getting started popover, plus goals, above Activity/Settings. Source: spec 056; `D:app/Sidebar.tsx:235-260`; user item 316. It replaces the Home box (`home.tsx:126`).
- **IssueRow**: one row with Dismiss × (P-ISS1), reused by the Dismissed group. Today that group re-implements the row (`issues-hub.tsx:86-179`; A SH8).
- **ThemePicker**: Mode (Light · Dark · System) first, then the themes of that mode (user item 256; C A1). It replaces `app/appearance.tsx:46-69`, `ThemeItems` (`shell.tsx:367-380`) and `ThemeMenu` (`shell.tsx:396-413`).
- **Command palette**: generated from registered Actions, plus one "Theme…" entry. This removes the 15 "Theme: X" entries (A SH15).

#### P15 Layout and data primitives kept

`Box` (the only panel; never nested), `Section`, `KeyValueList` (`data.tsx:31-47`; the only fact grid), `EmptyState`, `PathText`, `EvidenceList`, `ChannelCoverage`.

**Deleted page-local panels.**
- `StepBox` (`wrap-up.tsx:130`), `Part` (`import.tsx:161`), `WorkGroup`/`WorkRow` (`home.tsx:380`).
- `LocationRow` blocks (`t1/components/location-row.tsx:79-137`), which become a Locations DataTable (C L3).
- The `RigBlock` panels (`settings-equipment.tsx`) and `TemplateBox` (`settings-goal-templates.tsx`), which become DataTables.

#### L2-domain — `components/domain/*`

Moved out of features, catalogued, one owner:
- `Plate`/`Preview`, `Histogram` (+ stats per `R9-PIXINSIGHT-STATS.md` §3a-3c), `CornerGrid`, `Filmstrip` (from `d-review/*`);
- `AltitudeSpark`, `DarkLine`, `MoonLine`, `NightTimeline` (from `e-targets-plan-settings/parts.tsx`, `planned-tools.tsx`);
- `MosaicField` (from `b-projects/mosaic-editor.tsx`);
- `ChannelCoverage` (from `components/app/data.tsx:150`).

They take data props and emit events. They hold no page layout and no buttons of their own: their controls come from DisplayMenu or Actions.

### 3.4 L3 templates — `components/templates/*`

| Template | Slots / API | Rules | Replaces (file:line) |
|---|---|---|---|
| **ListPage** | `title`, `summary` (count), `actions: Action[]`, `menu?: MenuItem[]` ("Calibration ▾"), `views?` (Tabs), `notice?`, `table` (DataTable with toolbar), `detail?: { open, title, actions, content }` (DetailPanel docked side or bottom, adaptive and persisted per page per spec 054) | No description caption. No navigation buttons in the header (C C10). The page body never scrolls; the table frame does. The detail opens from "Details" in row actions or a row click. | Header + toolbar assembly in `projects.tsx:153-208`, `sessions.tsx:229-`, `calibration.tsx:798-806`, `targets.tsx:683-738`, `activity.tsx:223-`, `trash.tsx:164-235`. Detail Sheets `calibration.tsx:624-631`, `locations-page.tsx:150-156`. |
| **DetailPage** | `path` (breadcrumb), `title`, `status` (StatusBadge), `actions` (≤1 primary + ≤3 standard), `menu` (object menu "Project ▾" / "Session ▾" / "Target ▾": Edit…, Reopen…, Move to Trash…), `views?` (Tabs), `notice?`, `sections: Section[]` (each a Box holding a DataTable or KeyValueList), `detail?` | One verb for editing: "Edit…" (Q2). Tabs are view switches, never pills. | `project.tsx:69-133` (StageStrip, ghost "Edit details…"), `session.tsx:80-129` (ToggleGroup view switch), `target.tsx:267-335` (3 raw tables; header in 3 sizes), `mosaic-editor.tsx:244-288` (no PageBody), `project.tsx:163-177` (candidate review page, removed by P-REV2) |
| **StepPage** | `path`, `title`, `status`, `menu` (object menu), `flow: StepFlow`, `notice?`, `step` (one region: a toolbar + DataTable or Field rows), StepFooter | §5. One host for every staged flow. | `run.tsx:54-109`, `group.tsx:80-132`, `wrap-up.tsx:101-148`, `SetupShell` + `setup-pages.tsx`, the Import sheet (`import.tsx:122-160`), calibration process rows (`calibration.tsx:95-`), session review (`session.tsx ?view=review`; `home.tsx:142-170` ReviewSheet 96vw) |
| **SettingsPage** | `title` (h2), `sections: (SettingsSection \| ListSection)[]`. A ListSection is a DataTable + rowActions + one "Add …" in the section header. | The Settings layout is `ListDetail` + `NavList`. No description; no ReturnNotice. | `settings-layout.tsx:16-62` and each child page (§4) |
| **FormDialog / ConfirmDialog** | P8 | Centred; sizes `sm/md/lg` from tokens; footer from `DialogFooter` | All Sheets and hand-built dialog footers (§4b) |

**Home** is not a sixth template. It is a `DetailPage` with sections only: Planning, Needs, Up next (Q8).

### 3.5 Named menus (C-7)

| Surface | Menu | Items |
|---|---|---|
| Project header | Project ▾ | Edit…, Reopen project…, Move to Trash… |
| Run header | Run ▾ | Edit…, Open in {app}, Reopen run…, Move to Trash… |
| Session header | Session ▾ | Edit…, Add to Project ▸ (submenu), Create Project…, Archive…, Move unusable frames to Trash… |
| Target header | Target ▾ | Add to Plan, Add to Project ▸, Star / Unstar |
| Master detail | Master ▾ | Replace…, Hide, Open raw session |
| Calibration header | Import ▾ | Masters…, Raw frames… (C C9) |
| Equipment section | Add ▾ | Camera…, Telescope…, Filter…, Rig… |
| Project Goals section | Add goal ▾ | bands of the rig set, From template ▸ |
| Targets toolbar | Presets ▾ | built-in, custom, Save current…, Delete preset… |
| Image and table views | Display ▾ | P13 |
| Toolbar | More ▾ | Prototype ▸ (simulation, platform, quit), Language ▸, Theme… |

### 3.6 Portability across the stack decision

| Layer | Tauri, web UI | Tauri with OS-native pieces (native menus and dialogs) | Flutter |
|---|---|---|---|
| Tokens (DTCG JSON) | CSS variables, as now | Same; native menus follow the OS theme | Generate `ThemeData` + `ThemeExtension` |
| Contracts (`Action`, `MenuItem`, `Blocker`, `StepFlow`, `Column`, `Facet`, `FileRow`) | Survive as TS | Survive. `MenuItem[]` can feed native context and app menus through Tauri's menu API, so ⋯ and right-click stay one list [INFERENCE: depends on spikes 29lpg/rfxtf] | Re-expressed as Dart classes of the same shape |
| L1 (Base UI + Tailwind + cva) | Survives | Survives for in-window controls | Rebuilt (Material/Cupertino or custom widgets) |
| L2 patterns | Survive | Survive. **Exceptions:** HoverCard has no native analogue (falls back to a click popover). Simple confirms could use the OS message dialog, which sets button order natively (Q1) [INFERENCE] | Rebuilt on the same contracts; Flutter's `DataTable` keyboard model differs [INFERENCE] |
| L3 templates | Survive | Survive. The window toolbar may become a native unified toolbar on macOS [INFERENCE] | Rebuilt as widgets with the same slots |
| What does not port | – | Tailwind utilities, cva variants, the Base UI `render` prop | All L1 code, DataTable internals and Base UI behaviour |

Keeping the contracts in `contracts.ts`, free of React types except `ReactNode` slots, is what makes the plan survive a stack change.

## 4. Layout inventory: every route and dialog mapped to a template

Census columns (rendered, 1440 px, `#main` only):
- **btn/c**: buttons / distinct variant×size combinations;
- **DT/raw**: DataTables / raw tables;
- **sort**: sortable header cells / all header cells with text;
- **ttl**: visible `title=` attributes;
- **tip**: glyph tips (HelpTip/NoteMarker);
- **pill**: pills rendered as a link or button.

The target budget for every product route after W3: raw 0 · pill 0 · ttl 0 (truncation excepted) · tip ≤ 1 with approval · c ≤ 4 · sort = all data columns.

### 4a. Routes (`routes.tsx:82-167`)

| Route | Page (file:line) | Template | Census today | Header today | Deviations to remove |
|---|---|---|---|---|---|
| `/welcome`, `/setup/locations`, `/setup/indexing` | `t1/setup/setup-pages.tsx:58,164,325` in `SetupShell` (`app/shell.tsx:642-665`) | **StepPage** (setup host, no sidebar) | not censused | local `SetupHeader` (`:35-47`) | Local header and footer per state. "Load demo" sits in a Notice. Copy W1-W17 (C §3.13). The footer varies per state (layout scout). |
| `/` | `v5/a-home/home.tsx:99-139` | **DetailPage** (Planning · Needs · Up next), Q8 | 24/5 · 2/0 · 6/9 · 32 · 0 · 0 | Plan tonight (outline sm), New Project… (outline sm), Import… (default sm) | Header buttons duplicate the toolbar Import (A SH5). `WorkGroup`/`WorkRow` (`:380`). The Tonight box copies the Targets controls with no site/date (`:576-697`; R9-HOME-DEBATE H4). The Getting started Box (`:126`). The ReviewSheet at 96vw (`:142-170`). |
| `/import` | `v5/a-home/import.tsx:122-160` (a Sheet over Home) | **StepPage** route: Source → Preview | (Home behind) | sheet footer | Right Sheet at 50rem. Local `Part` (`:161`). Notices in flow. Custom source buttons. |
| `/projects` | `v5/b-projects/projects.tsx:153-208` | **ListPage** | 4/2 · 1/0 · 4/5 · 6 · 0 · 0 | New Project (default sm) | Row actions only on right-click. The "Next" column name (→ "Up next"). The Show done switch (→ a State facet). |
| `/projects/$id` | `v5/b-projects/project.tsx:69-133` | **DetailPage**, Tabs **Runs · Wrap up** | 12/3 · 5/0 · 4/23 · 57 · 2 · 0 (Cygnus) | Edit details… (ghost sm) | StageStrip pills (`:132-159`). `SimpleTable`×4. Subjects/rigs right-click only, plus the rig "Remove" text. The Candidates SelectionBar in flow. Add-channel pills. The "Exposure mismatch" pill (R9-ANSWERS Q8). The closed project is still editable (B §2). |
| `/projects/$id?stage=wrap-up` | `v5/b-projects/wrap-up.tsx:101-148` | **StepPage** (Wrap up tab): Clean up runs → Trash → Archive → Close | M 31: 7/2 · 0/0 · – · 1 · 0 · 1 | Edit details… | `StepBox`; variant follows current (S1). "Mark Done" ×2. No file lists. Order not enforced (`:110`). A "Runs · 1" pill link. |
| `/projects/$id?candidates=…` | `project.tsx:163-177` | **removed** (P-REV2) | – | Candidates done (outline sm, navigation) | Review leaves runs and projects. The candidate list stays as a Project section. |
| `/projects/$id?mosaic=…` | `v5/b-projects/mosaic-editor.tsx:244-288` | **DetailPage** (MosaicField domain + panel DataTable) | not censused | Cancel / Start group | No PageBody. Local layout buttons. The Refusal takes a page slot. |
| `/projects/$id/trash` | `v5/b-projects/trash.tsx:164-235` | **ListPage** | 3/2 · 1/0 · 3/6 · 0 · 0 · 0 | Empty Trash… (destructive sm) | Restore appears both as a column button and a menu item (B Trash). The Empty dialog has an Unchanged list. |
| `/projects/$id/runs/$runId/$step` | `v5/c-runs/run.tsx:54-109` | **StepPage**: Select → Calibrate → Prepare → Results | Select 6/5 · Review 13/7, 70 ttl, 8 tip · Calibrate 4/3 · Prepare 5/4, 6 tip · Results 5/3, sort 1/4 · Done 4/3 | Complete… (outline sm), Rename… (ghost sm), Move to Trash (ghost sm); Complete moves into the body as default sm on Done | The StepBar "Next" badge; step-local footers; Complete changing place and variant (B §5); the Review step (P-REV2); the Done step. |
| `/projects/$id/groups/$gid/$step` | `v5/c-runs/group.tsx:80-132` | **StepPage** (per-panel column) | Select 1/1 · Prepare 4/2, 30 ttl, 6 tip | none | Actions are `default xs` inside different Boxes (`:323-328,507-559,635-672`). The hand-rolled "Place on panel" row button (`:299-311`). |
| `/targets` (My · Browse · Planned) | `v5/e-targets-plan-settings/targets.tsx:683-738` | **ListPage**, header Tabs; NightPicker + SitePicker + FilterBar in the toolbar | My 3/2 · 1/0 · 10/12 · 88 · 2 · 0 · 11 menus; Planned 3/2 · 1/7 · 19 | ‹ › (ghost icon-sm), Save preset (outline default) | Segmented control in `meta`. A second sticky header in Planned. Preset chips. Column tooltips. The raw table at `:916`. |
| `/targets/$id` | `v5/e-targets-plan-settings/target.tsx:267-335` | **DetailPage** | 4/3 · 0/3 · – · 9 · 4 | Add ★ (ghost xs), Add to Plan (outline default), New Project… (default default) | Three sizes in one header. Raw tables `:387,493,529`. |
| `/plan`, `/storage` | redirects (`routes.tsx:119-138`) | – | – | – | keep |
| `/sessions` | `v5/a-home/sessions.tsx:229-` | **ListPage** (facet "Needs review" = the intake queue, Q14) | 25/2 (24 × outline xs "Review") · 1/0 · 6/6 · 45 | Import… (outline sm) | A per-row Review button. Right-click-only menu. Notices in flow (A §4). |
| `/sessions/$id` | `v5/a-home/session.tsx:80-129` | **DetailPage** (facts) + **StepPage** intake `?step=target\|rig\|review` | 4/1 · 1/2 · 3/6 · 62 · 9 | Create Project (outline sm) | A ToggleGroup as view switch (`:146-152`). Local Target/Rig controls (`a-home/parts.tsx:209-330`). Raw tables. 62 titles. |
| `/sessions/$id?view=review` | `d-review/review.tsx` mounted from `session.tsx:157` | **StepPage** intake, step Review | 8/4 · 2/0 · 13/15 · 45 · 6 | none | 6 tips. Overlay toggles only in Corners. The "Library scope" slop (B Review). Save/Discard in a status line. |
| `/calibration` | `v5/e-targets-plan-settings/calibration.tsx:798-` | **ListPage**, Tabs **Masters · Processes**; master DetailPanel | 6/3 · 3/1 · 0/20 · 36 · 4 · **13** (17 hand-rolled) | Settings (ghost default, navigation), Import masters (outline default) | C C1-C16: Dismiss in the details panel, pill filters, no sortable column, glyph-only process steps, the import outcome inserted, the Used-by pill. |
| `/calibration/processes/$id/$step` (new) | from `calibration.tsx:95-` | **StepPage**: Stack → Detect → Import → Register → Raws | – | – | Today a glyph strip inside a table row. |
| `/activity` | `v5/e-targets-plan-settings/activity.tsx:223-` | **ListPage** (facets Operations · Transfers; rowActions Open project / Open session) | 8/1 · 0/1 · – · 5 | none | Raw table `:272`. Misaligned "Open…" buttons with an "open" header (user item 254). |
| `/settings` (layout) | `t1/settings/settings-layout.tsx:50-62` | **SettingsPage** layout (ListDetail + NavList) | – | – | `SettingsMenu` (`:16`) second nav. `ReturnNotice` (`:91`). |
| `/settings/appearance` | `t1/settings/appearance-page.tsx:40-108` | SettingsPage: ThemePicker, Language, Density | 1/1 · tip 1 | – | Hand-built row `:83`. Tooltip on disabled Restore (`:41-47`). The flat 13-theme grid. |
| `/settings/locations` | `t1/settings/locations-page.tsx:414-473` | SettingsPage, ListSection: Name · Role · State · Indexed · Frames · Size · Disk free | 18/2 (17 outline sm) · 9 menus | – | `LocationRow` blocks. The "Readable · Online · Complete scope" line. Rescan moving the menu. Duplicates (→ Issues). `RetireReviewPanel`. The "Activity" link (C L1-L9). |
| `/settings/equipment` | `v5/e-targets-plan-settings/settings-equipment.tsx:477-` | SettingsPage, ListSections Cameras · Telescopes · **Filters** · Rigs; FormDialog editors | 30/3 (18 ghost xs) · 2/3 · 9/10 | – | `RigBlock`. Raw filter table `:373`. Edit optics. A rig editing camera properties. Remove as text. "Used by" growing without bound (C E1-E8). |
| `/settings/goal-templates` | `settings-goal-templates.tsx:201-` | SettingsPage, ListSection + FormDialog | 7/3 · raw 1 | – | `TemplateBox`. Raw table `:143`. Delete as text. Hours AND frames semantics (Q7). |
| `/settings/naming` | `settings-naming.tsx:329-` | SettingsPage: one SettingsRow per frame type with TokenTemplateField + preview; static Tokens table | 15/3 · 16 hand-rolled chips · 11 ttl | – | The 11-button frame-type navigator (`:329-351`). Chip editor. Per-token tooltips. "No fallbacks" pill (C N1-N3). |
| `/settings/calibration` | `settings-calibration.tsx:41-` | **deleted** (C S-CAL1) | 0 buttons | – | Only real setting is Keep raws (→ the Calibration Processes view menu). |
| `/settings/sites` | `t1/settings/sites-page.tsx:221-` | SettingsPage, ListSection (sortable) + FormDialog with SiteLocationField | 2/2 · 1/0 · 3/8 | – | No map (C O1). Make default as `xs ghost` text. The no-default Notice. |
| `/settings/targets` | `t1/settings/target-lookup-page.tsx:135-` | SettingsPage rows | 1/1 · tip 1 | – | The "Local search" pill, HelpTip and "Fixture" text (C T1-T4). |
| `/settings/applications` | `t4/applications.tsx:152-` | SettingsPage, ListSection: Application · Path · Detected · Arguments; "Add application…" FormDialog (PathField executable + ArgumentsField + Detect) | 6/2 · tip 5 | – | The PrototypeControls Collapsible fold-out. "Input writes". Launch arguments only on the generic profile (C AP1-AP7). |
| `/settings/about` | `t1/settings/about-page.tsx:40-` | SettingsPage, KeyValueList: Version · Build · Data location · Licences | 14/2 | – | Raw Badge + three pills. Onboarding and Simulation sections (→ Help, Prototype menu) (C AB1-AB2). |
| `/settings/help` (new) | – | SettingsPage: Shortcuts DataTable, Tips, Guide, Restart walk | – | – | Absorbs `app/shortcuts.tsx` and `d-review/shortcuts.tsx` (C S0c). |
| `/design-system` | `app/design-system-page.tsx:219-` | **Catalogue** (registry-driven, §8.3) | 27/10 · 1/2 | – | Not exhaustive (C DS1-DS3). The raw z-index table `:260`. |
| `*` (404) | `app/shell.tsx:620-640` | EmptyState in the shell | – | – | "older prototype build" copy (A SH16). |

### 4b. Dialogs, sheets and popover panels

| Instance (file:line) | Today | Becomes | Change |
|---|---|---|---|
| New Project (`v5/b-projects/new-project.tsx:43-45`) | Sheet right 38rem, hand-built footer | **FormDialog lg** | TargetPicker for subjects, rigs, Goals editor always shown, "From template ▾" |
| Start run (`start-run.tsx:33-40`) | Sheet right 30rem | **FormDialog md** | Subject and rig Selects (not radio cards); profile Select; candidates limited to Ready sessions |
| Import (`a-home/import.tsx:123-149`) | Sheet right 50rem, Tabs Source/Folder | **StepPage** `/import` | Source → Preview; Proceed = "Import…" |
| Home session review (`home.tsx:146-153`) | Sheet right 96vw | route to the session intake Review step | – |
| Duplicates review (`t1/components/duplicates-review.tsx:39-93`) | Sheet right 46rem + nested ConfirmDialog | **FormDialog lg** opened from Issues › Duplicates | Groups DataTable (keeper preselected) + ConfirmDialog groups |
| Location details (`locations-page.tsx:150-156`) | Sheet 30rem | **DetailPanel** | – |
| Master details (`calibration.tsx:624-631`) | Sheet 30rem, Dismiss button in the body | **DetailPanel** + Master ▾ | Hide / Replace in the menu |
| Add location (`t1/components/add-location-flow.tsx:107-120`) | Dialog, hand footer | FormDialog + PathField | – |
| Edit location (`locations-page.tsx:102-115`) | Dialog, hand footer | FormDialog | – |
| Site editor (`sites-page.tsx:80-93,166-169`) | Dialog | FormDialog + SiteLocationField | Q5 |
| Import CSV (`t3/import-dialog.tsx:87-92,217-`) | Dialog, step-dependent footer, raw table | FormDialog with `steps` (Choose → Preview) | Preview as a DataTable |
| Import masters (`calibration.tsx:791`; C C8) | FolderPicker | FormDialog with `steps` (Choose folder → Preview match table) | Q9 |
| Locate application (`t4/profile-parts.tsx:91-95`) | Dialog, simulated chooser | FormDialog + executable PathField + detected list | – |
| Project details (`details-dialog.tsx:39-45`) | Dialog | FormDialog "Edit project" | Name and notes in one place (B §2) |
| Run rename (`run.tsx:186-191`, borrowed `equipment_rename_title`) | Dialog | FormDialog "Edit run" | Own keys (B S10) |
| Calibration exception (`calibrate-step.tsx:372-386`) | Dialog demanding a reason | **removed** | Row menu item "No calibration", no reason (user item 147) |
| Attach results (`results-step.tsx:279-294`) | Dialog with a text path | FormDialog + file PathField + kind/channel Selects | User items 187-189 |
| Use result (`results-step.tsx:337-344`) | Dialog | FormDialog | – |
| Add product inputs (`select-step.tsx:416-420`) | Dialog | FormDialog with a DataTable selection | – |
| Equipment camera / telescope / rig (`equipment-records.tsx:92-97,152-157,254-258`) | Dialogs, hand footers | FormDialog | The rig selects Camera, Telescope, Reducer and Filters (C E2) |
| Equipment rename (`settings-equipment.tsx:116-120`) | Dialog | merged into Edit FormDialog | – |
| Edit rig optics (`settings-equipment.tsx:207-214`) | Dialog | **removed** (C E1, E2) | – |
| Goal template editor (`settings-goal-templates.tsx:98-103`) | Dialog | FormDialog | Unit Select (Q7) |
| Calendar export (`planned-tools.tsx:182-186`) | Dialog | FormDialog | – |
| Moon limits editor (`moon-limits.tsx:136-143`) | Popover with a raw table | FormDialog md | Q6 model |
| Good-band filter (`targets.tsx:768-775`) | Popover | FilterBar multi facet | – |
| Review shortcuts (`d-review/shortcuts.tsx:66-70`), app shortcuts (`app/shortcuts.tsx:108-112`) | two Dialogs | one Shortcuts DataTable on Help + ⌘/ FormDialog sm reusing it | – |
| Issues hub (`app/issues-hub.tsx:190-197`), status-bar popouts (`app/status-bar.tsx:178-182,215-226,332-343`) | Popovers with lists | keep as Popovers with IssueRow (P14) | Dismiss ×, Dismissed (N) + Restore (P-ISS1) |
| Calibration Used by (`calibration.tsx:403-407`) | Popover on a pill trigger | `UsedByPreview` HoverCard | – |
| Onboarding walk (`app/onboarding.tsx:165-189`) | non-modal Popover | **modal** walk: scrim with cut-out, focus trap, Back · Next · Skip (spec 056 FR-001..005) | Copy rewrite (C OB1-OB5) |
| Navigation drawer (`app/shell.tsx:339-360`) | Sheet left | keep (narrow only) or delete once the icon rail always shows (`a557a38e`) | – |
| Simulation (`app/simulation-panel.tsx:463-472`) | Sheet right | keep (Prototype only, lint-exempt) | – |
| Command palette (`app/command-palette.tsx:132-135`) | Dialog on raw autocomplete (A SH13) | keep; built on `ui/combobox`; entries from Actions | – |
| ConfirmDialog sites needing file groups | `wrap-up.tsx:216,352,408`; `trash.tsx:216,225`; `done-step.tsx:88,293`; `sessions.tsx:338,354`; `duplicates-review.tsx:144`; `project-sections.tsx:315,327,629,1047`; `locations-page.tsx:510` | ConfirmDialog `groups` | File · From · To/Action · Size · Status |

## 5. One flow for staged work

### 5.1 Flow rules (all staged work)

- **F1 One advance control.** Proceed is the only primary button on a step page. It sits at the trailing end of the StepFooter. Its label is "Proceed" on every step except the last, which carries the flow's terminal verb ("Finish run…", "Close project…"). See Q4.
- **F2 What Proceed does depends on the step.**
  - In a **commit step**, the step's work is one operation (Prepare, a cleanup move, Archive, Import). Proceed opens the ConfirmDialog with file groups, runs the operation, records the step as Finished **when the operation succeeds**, then opens the next step. This fixes settle-on-start (B 8b.8).
  - In a **decision step**, the work is per-row choices (Select, Calibrate, Results, Review). Proceed records the step and opens the next. Row operations live in the table toolbar or batch bar.
- **F3 Gates.** An unmet gate makes Proceed focusable-disabled, with a `BlockersPreview` naming what is missing (`DESIGN.md:243`). Nothing else on the page is disabled for flow reasons.
- **F4 Skip.**
  - **Selection steps** have no Skip button: proceeding with nothing selected records the step as Skipped. This follows the user's ask for "selectors of what to trash and not to trash, then a button to proceed" (user item 91).
  - **Optional non-selection steps** show a ghost **Skip** beside Proceed.
- **F5 Order.** With `ordered: true`, later steps can be viewed but are read-only. An earlier step can be reopened from the StepStrip ("Reopen step") until the flow finishes. Reopening marks the steps after it **Redo**. Wrap up order is Q3.
- **F6 One place per job.** Finishing a run removes its view. Wrap up's Clean up step catches any view the user kept. No cleanup happens anywhere else (B 8b.7 lists three places today).
- **F7 Finished flows are read-only.** Reopen sits in the object menu (Run ▾, Project ▾), never in the footer.
- **F8 Operations are never primary.** Prepare, Accept, Assign, Trash and Archive are standard (outline) actions in the step table's toolbar. They are primary only as the Proceed of a commit step.
- **F9 Two hosts, one contract.** `StepPage` hosts flows with three or more steps or with persistent state. `FormDialog steps` hosts two-step choose-then-preview tasks (import CSV, import masters). Both render the same StepStrip and footer contract.

### 5.2 Flow catalogue

| Flow | Host / route | Steps | Optional | Terminal Proceed | Gates |
|---|---|---|---|---|---|
| Setup | StepPage (setup shell): `/welcome` → `/setup/locations` → `/setup/indexing` | Welcome → Locations → Indexing | Indexing can be deferred: Skip "Index later" | **Open library** | At least one capture location (`setup-pages.tsx:204-220`) |
| Import | StepPage `/import?step=` | Source → Preview | – | **Import…** | Preview has no blocking rows (held/unclassified are shown with their status) |
| **Session intake** (P-REV2) | StepPage on the session `/sessions/$id?step=target\|rig\|review` | Target → Rig → Review | – | **Finish review** | Target confirmed · rig confirmed · 0 Unreviewed frames (Q10) |
| Calibration process | StepPage `/calibration/processes/$id/$step` | Stack → Detect → Import → Register → Raws | Raws (Keep raws setting) | **Finish calibration** | Each step's existing gate (HARNESS-V5-FEEDBACK-R1 P-CAL3, lines 152-160) |
| Run | StepPage `/projects/$p/runs/$r/$step` | Select → Calibrate → Prepare → Results | – | **Finish run…** | §5.4 |
| Run group | StepPage `/projects/$p/groups/$g/$step` | the same, with a Panel column | – | **Finish all panels…** | Every panel passes |
| Wrap up | StepPage under the Project **Wrap up** tab | Clean up runs → Trash → Archive | every step, by empty selection | **Close project…** (on Archive) | Every run Finished or Trashed |

### 5.3 Session intake (new under P-REV2)

A session's frames must be fully reviewed before the session can join a Project or run (`HARNESS-V5-FEEDBACK-R1.md:310`).

| Step | Body | Toolbar / batch | Proceed gate | Replaces |
|---|---|---|---|---|
| Target | Pointing evidence (`EvidenceList`), a TargetPicker preselected from the pointing (P-IMP2), OBJECT shown as a label | "File into Target…" when Unclassified | Target confirmed | `ConfirmTargetControl`, `FileIntoTargetControl` (`a-home/parts.tsx:209-297`) |
| Rig | Rig Select with evidence; unknown filter values link to Equipment | – | Rig confirmed | `ConfirmRigControl` (`a-home/parts.tsx:299-330`) |
| Review | The review workspace (`d-review`) as the step body: frame DataTable + Plate/Compare/Corners (domain components), DisplayMenu, inspector. P/X/U set **library** quality (P-REJ2). | Batch: Usable · Unusable · Unreviewed; "Select by threshold…" | 0 Unreviewed | The run Review step (`run.tsx:113-117`), the Home ReviewSheet (`home.tsx:142-170`), the session `?view=review` toggle (`session.tsx:146-152`) |

After **Finish review**, the session becomes Ready and is a candidate wherever its Target and rig match. The Sessions list facet "Needs review" is the queue. Proceed on the last step opens the next session in that queue (Q14). Reopening review on a session that an unfinished run uses marks that run "Inputs changed · Refresh ▸" (a gate on its Prepare step).

### 5.4 Run steps under the new decisions

| Step | Body (one region) | Toolbar / batch operations (standard) | Proceed | Gate | Removed |
|---|---|---|---|---|---|
| **Select** | Candidate DataTable of **Ready** sessions for subject + rig. Selection = membership. Facets: Night, Channel, "In run". A toolbar link "3 sessions need review ▸" goes to Sessions filtered (no inserted Notice). | Add input…, Discard changes (only while a draft exists) | Proceed saves the revision and opens Calibrate | ≥1 member | Sticky Save/Discard footer (`select-step.tsx:305-321`); "Selected only" (`:111-114`) |
| **Calibrate** | DataTable rows Session × Kind. The Master cell is a ComboboxField (recommended first, `MasterPreview` HoverCard, search). Match columns (exposure, gain, offset, temperature, binning) are visible, not hidden in criteria (user items 151-155). | Batch: Assign ▾ (master for all selected), No calibration. Toolbar: Auto-assign switch. | Proceed | Every row has a master or No calibration | The reason dialog (`calibrate-step.tsx:365-398`); master chooser hidden in a row menu (`:238-261`); table collapsing when resolved (`:67-68,134-155`); Accept variant drift |
| **Prepare** | Field rows: Profile (SelectField, detected tools only; user item 161), Run view (SegmentedField **Symlinks · Copies**, P-PREP3; refused without Windows Developer Mode for Symlinks with "Use copies for this run"), Output folder (PathField). Inputs DataTable with footprint ("Linked · 0 B" / "N copied · X GB"). | Open in {app} (once prepared; also in Run ▾) | **Prepare…** (commit step): confirm the folder layout + footprint, run, then open Results when done | Saved membership, calibration resolved, profile set, inputs unchanged | The one-off Prepare button in a Box titled "Review" (`prepare-step.tsx:97-123`); radio cards; Corrected-metadata matrix (to intake, Q15); prototype sentences (`:107-112`) |
| **Results** | DataTable of discovered files: File · Kind (Select) · Channel (Select) · Revision · State. A watcher finds new files; "Still being written" shows in the State cell. | Batch: Accept, Ignore. Toolbar: Attach… (FormDialog + PathField), More ▾ Rescan. | **Finish run…** (terminal): ConfirmDialog groups **Products** (accepted) and **Run view** (links to remove / copies to Trash, preselected), plus the calibration handed off (frozen) | No file still being written | Accept-only rows (`results-step.tsx:181-190,247-251`); "Accept blocked · 1 blocker" far from its row; the "Wrap up" pill link (`:42-50`); the **Done** step (`done-step.tsx`); Complete in the header (`run.tsx:150-176`) |

A **Finished** run shows the StepPage read-only. The footer reads "Finished 12 Oct 2026" with no Proceed. Run ▾ offers Reopen run… and Open in {app}.

### 5.5 Wrap up (select, then Proceed)

Available when every run is Finished or Trashed. Before then, the Wrap up tab shows one line, "Finish every run first · 2 open ▸", as an EmptyState.

| Step | DataTable (checkbox selection, recommended rows preselected, rows expand to files) | Not selectable (Status cell) | Proceed (commit step) |
|---|---|---|---|
| **1 Clean up runs** | Runs whose view was kept: Run · View (Symlinks/Copies) · Items · Size | – | ConfirmDialog "Remove 10 links and move 10 copies (1.0 GB) to Trash?" → toast with Show. Nothing selected = Skipped. Nothing left = "Nothing to clean up", and Proceed records Finished. |
| **2 Trash** | Groups: **Unusable frames** (library-Unusable, in this Project's sessions), **Intermediates** (Results folders), **Duplicate copies** (the duplicates scan; keeper excluded). No "Project rejects" group (P-REJ2). | "Linked by {run} ▸" (P-TRASH2, `FEEDBACK-R1:302-304`), "Read-only", "Offline", "Used by {project} ▸" | ConfirmDialog with file groups → OS Trash → toast "Moved 214 files to Trash · Show" |
| **3 Archive** | Sessions: Session · From · To · Size. Destination Select in the toolbar (default archive location, P-ARC1). Expand → per-file from→to. | "Stays · used by {project} ▸" (whole-session rule, `wrapup_archive_description` made visible as data) | **Close project…**: ConfirmDialog lists the archive moves plus a summary of steps 1-2 (Finished or Skipped). It runs the transfer as a background operation in the status bar and closes the Project when the transfer succeeds ("Closing…" until then). |

The StepStrip shows each step as To do · Current · Finished · Skipped. An earlier step can be reopened until Close (F5). The Archive step is read-only until Trash is Finished or Skipped (Q3).

### 5.6 Closed-project behaviour

| Surface | Closed project |
|---|---|
| Header | StatusBadge **Closed** (or **Archived**). Project ▾ = Reopen project… only. Edit… is disabled, and its BlockersPreview reads "Project closed · Reopen ▸". |
| Runs | StepPages read-only. Run ▾: Open in {app} only. Reopen run needs the Project reopened first. |
| Wrap up tab | Read-only record of each step (Finished / Skipped, with date and moved bytes). |
| Review | Not reachable from the Project. Under P-REV2 review belongs to sessions. Library-wide marks stay editable from Sessions because frames are library-owned (P-REJ2). |
| Goals | Read-only. Figures computed live from the library [INFERENCE: whether to freeze them at Close is an open sub-question of Q7]. |
| Archive | Survives Reopen (`domain/types.ts:572-576`). |
| Projects list | Facet **State: Open · Closed · Archived** replaces "Show done" (`projects.tsx`; `slices.b.showDone`). |
| Fixes | B §2 row "Closed project still editable" (`project.tsx:53-54,157-178`; `store/actions/projects.ts:256-271`) |

### 5.7 Renames (Q2 confirms)

| Concept | Today (key / file) | Proposed | Why |
|---|---|---|---|
| Run's last step | "Done" (`stepName(done)`, `done-step.tsx:192`) | removed; finishing is Results' Proceed | "Done doesn't mean anything" (user item 211); an empty final step (user item 243) |
| Run action | "Complete" (`run_complete`) | **Finish run…** | A specific terminal verb (PatternFly, row 28) |
| Run state | "Complete" | **Finished** | Pairs with Finish |
| Run reopen | "Reopen" (`run_reopen`) | **Reopen run…** (Run ▾) | Names the object |
| Box titles | "Completion" (`run_completion`), "After Complete" (`run_after_complete`) | removed | B §6 |
| Wrap up step 1 | "Mark Done" (`wrapup_mark_done`, `wrap-up.tsx:231-235`) | removed: Proceed | Had two meanings (B 8b.1) |
| Wrap up final | "Mark Done" (`wrap-up.tsx:495-498`) | **Close project…** | – |
| Project state | "Done" (`status_done`) | **Closed**, then **Archived** | "Done" meant five things (B 8b.2) |
| Project stage strip | Open › Runs › Wrap up › Done (pills) | Tabs **Runs · Wrap up** + StatusBadge | Pills as navigation |
| Toolbar advance | "Next: {label}" (`shell_next`) | ⌘↩ = Proceed; no toolbar button | One advance control |
| Step bar | "Next" badge (`run_step_next`) | removed | – |
| Projects column | "Next" (`projects_col_next`) | **Up next** | "Next" meant four things (B 8b.3) |
| Step states | Borrowed "Next", "To do" (`calibration_step_todo`) | To do · Current · Finished · Skipped · Blocked · Redo | Own keys (B S10) |
| Hidden master | "Dismiss" (`run_dismiss`) | **Hide** / **Show hidden** / Restore | C C1. "Dismiss" stays for issues (P-ISS1) |
| Edit verbs | "Edit details…" / "Rename…" / "Edit optics" | **Edit…** | One verb (B §2, C E1) |
| Home planning box | "Tonight" | **Planning** | User item 125 |
| Targets preset | "Good tonight for" | **Best filter tonight** (multi-select) | User items 7, 13; R9-ANSWERS Q2 |
| Session readiness | "Unreviewed" | Needs Target · Needs rig · Needs review · **Ready** | P-REV2 |
| Intake terminal | – | **Finish review** | – |
| Calibrate exception | "Process without {kind}…" | **No calibration** | User item 147 |
| Results scan | "Look again" | **Rescan** (in More ▾; watcher by default) | User item 181 |
| About | "About this prototype" | **About** | User item 314 |

### 5.8 Domain changes the flows need (Wave 2 input)

| ID | Change | Where (today) |
|---|---|---|
| D1 | `RunStep` = select · calibrate · prepare · results. A `runFlow(world, run): StepFlow` builder sits alongside `runPipeline` until W4. The review gate and the done step go. | `domain/types.ts:604`; `derive.ts:823` (`runPipeline`), `:897-912` (advisory review gate), `:1081` (`nextFrom` becomes the Proceed target) |
| D2 | Session intake state and `sessionIntake(world, session): StepFlow`. Candidates exclude non-Ready sessions; `startRun` preselects only Ready ones. | `derive.ts` `projectCandidates`; `store/actions/runs.ts:94-121`; `domain/membership.ts:79-96` |
| D3 | P-REJ2: remove `Project.rejections` and the Project-only reject. | `types.ts:577-578`; `store/actions/projects.ts:256-271`; `review_reject_for_project` |
| D4 | Wrap up: settle on success, order (Q3), Close checks the steps. A `wrapUpFlow(world, project)` builder. | `wrap-up.tsx:110,201,422`; `store/actions/projects.ts:195-210,239-246` |
| D5 | Freeze calibration at Finish; fix the M 31 seed. | `derive.ts:918-949`; `seed.ts:956-967` (R9-ANSWERS Q7) |
| D6 | One dark/bias match per light session, not per kind × exposure (user item 87; B Calibrate row "domain change"). Confirm with the user. | `domain/calibration.ts` `KINDS` (B cites `:31,398-405`) |
| D7 | Goal unit and quality bar (Q7). | `derive.ts:519-528,576-602`; `domain/templates.ts:12-45` |
| D8 | Moon model (Q6), with Img time on the same rule. | `domain/planning.ts:71-78,376,407-433`; `good-tonight.ts:5-11,85-103`; `domain/labels.ts:94-102` |
| D9 | Master age (Q9b) and Replace master (Q9a). | `domain/calibration.ts:133-145,219-220` (C C11-C12) |
| D10 | Project status + tabs replace the stage derivations. | `derive.ts:1389` (`projectStage`), `:1470` (`projectStageStrip`) |
| D11 | Corrected metadata moves to intake (Q15). | `c-runs/model.ts:398-419` (B Prepare) |

## 6. Copy and tooltip policy

### 6.1 Copy rules

These extend `HARNESS-V5-FEEDBACK-R1.md:5-14`, which still stands, with the cited practice in §2a rows 22-24 and 29.

- **W1 Microcopy only.** Labels, values, status words and verbs. No sentence explains how the product works: the structure (columns, statuses, Changes lists) carries the meaning.
- **W2 Buttons are verb plus object, 1-3 words, sentence case** ("Move to Trash", "Finish run…"). Add "…" only when more input or a confirmation follows (Apple menus).
- **W3 Headings are 1-2 words and never restate the content below** (`rule://design-no-slop`).
- **W4 Refusals** read `<Action> blocked · <count> <reason> ▸` or `Can't <verb> · <reason> ▸`. The blockers go in a HoverCard table, never a chip line, a semicolon sentence or a repeated reason.
- **W5 Status words come from the STATUS registry.** One word per state, the same everywhere.
- **W6 Measured values** show the value plus a ① NoteMarker (method · basis · time). An absent value reads "–".
- **W7 Empty states** are one line plus one action.
- **W8 No borrowed keys.** Each feature owns its keys (B S10).
- **W9 No prototype words in product strings** ("prototype", "simulated", "fixture", "harness"), except keys under `prototype_*` and `simulation_*`.
- **W10 Plain English.** No "we", "please", "simply", "just", "easily", "seamlessly", "powerful", "leverage", "Note that", "This will" (the GOV.UK words-to-avoid list plus the R9 slop list).

### 6.2 Tooltip policy

| Allowed | Content | Mechanism |
|---|---|---|
| T1 Icon-only button | Its name + shortcut ("Previous night ⌥←") | `Tooltip` from the L2 `IconButton` role; the name is also `aria-label` |
| T2 Truncated text | The full text, only when it is actually truncated | `DataTable` `truncate` and `PathText truncate`, applied automatically |
| T3 Measured value ① | Method · basis · time rows | `NoteMarker` (`components/app/tips.tsx:71-105`) |
| T4 Non-obvious rule with consequences not shown elsewhere | One short sentence | `HelpTip`: ≤1 per page, lead approval, lint justification (§8) |

| Forbidden | Instead | Evidence |
|---|---|---|
| Tooltips on column headers (FWHM, Stars, ECC) | Nothing; definitions go on the Help page | User item 133; `d-review/list.tsx:45-61,288-292` (B Review) |
| Tooltips on filters, Fit, Type, Coordinates, stars | Nothing | User items 21, 29, 141 |
| A tooltip on a disabled button restating why | `BlockersPreview` HoverCard | `appearance-page.tsx:41-47` |
| A tooltip repeating visible text | Nothing (Windows "don't use a tooltip to display text already visible") | A SH6, SH12 |
| `title=` anywhere in features | T2 only | 410 static; up to 88 per route rendered |
| Data hidden in a tooltip (Used by, exposure mismatch, gate reasons) | HoverCard or an inline column | R9-ANSWERS Q8; C C15-C16 |
| Explanatory HelpTips ("Pan help", "Mark scope", "Auto-advance help") | Remove; the Help page lists shortcuts | `review_pan_help`/`review_pan_tip` (`en-GB.json:4909-4910`), `review_mark_scope_tip` (`:4685`) |

### 6.3 Examples (forbidden → allowed)

| Key (en-GB line) | Today | Becomes |
|---|---|---|
| `store_library_scope_detail` (6176) | "Library scope: every run and Target sees this decision." | removed; the mark's scope shows as the label "Library" |
| `folder_picker_description` (401) | "Prototype folder chooser: volumes and folders come from the simulated disk." | removed (6 FolderPicker consumers fixed at once, C C7) |
| `confirm_changes` / `confirm_unchanged` (425-426) | "This will" / "Unchanged" | "Changes"; Unchanged only when non-obvious |
| `wrapup_archive_description` (1965) | "Each session moves whole or stays." | removed; the moves table shows per session "Moves" or "Stays · used by M 42 ▸" |
| `wrapup_trash_offer_description` (1929) | "To the OS Trash only. Each item is re-verified first." | removed; the verb says "Move to Trash" |
| `wrapup_cant_trash` + `wrapup_reason_no_write` (6949-6950) as chips | "Can't trash 1 · no write permission" + repeated chips | Status cell "Read-only" on that file row |
| `goal_apply_description` (1540) | "Values are copied in and stay editable." | removed |
| `goal_warning_exposure` (1562) | "Exposure mismatch" pill with the reason in a tooltip | Calibration readiness row "No 60 s dark" (R9-ANSWERS Q8) |
| `run_cal_process_without` (2953) + reason dialog | "Process without {kind}…" | Menu item "No calibration" |
| `run_results_products_help` (3071) | "Never accepted by itself; Accept binds the current bytes." | removed |
| `run_results_basis_tool` / `run_results_basis_inferred` (3088, 7415) | "Tool evidence" / "No tool evidence · the revision current when the file appeared" | removed; the Revision column shows "rev 2" |
| `status_complete_scope` (262) on every healthy location | "Readable · Online · Complete scope" | a badge only for exceptions (C L2) |
| `apps_input_writes` (4347) | "Input writes" | removed (C AP2) |
| `settings_lookup_fixture` (4207) | "Fixture" | removed (C T3) |
| `settings_about` (48) | "About this prototype" | "About" |
| `setup_welcome_description` (4221) | a 30-word sentence | removed; the title stands alone (C W1) |
| `shell_not_found_description` (100) | "The link may come from an older prototype build." | removed; "This page does not exist" + "Go to Home" |
| `review_mark_scope_tip` (4685) | "P, X and U mark the library, in every Project. A Project reject stays in this Project." | removed (P-REJ2 makes it false anyway) |

Allowed patterns:
- "Can't remove rig · used by 6 runs ▸"
- "Move 14 files to Trash"
- "12 selected · 1.2 GB"
- "Proceed blocked · 2 unresolved ▸"
- "Linked by NGC 7000 OIII deep ▸"
- "No 60 s dark"
- "Indexed 4 Oct 2026, 12:00"
- "Finish run…"
- "Close project…"

### 6.4 Copy lint

`scripts/check-copy.mjs` runs inside `pnpm lint:i18n`, next to `check-i18n-catalog.mjs` (`package.json:16`). Over `messages/en-GB.json` it checks:
- the W10 word list and the W9 prototype words outside allowed prefixes;
- title case in labels;
- a trailing period on label keys (`*_title`, `*_label`, `verb_*`, `*_action`);
- button keys over 3 words;
- "…" used without a dialog (by key suffix convention `*_ellipsis`).

It reports in W0 and fails from W4.

---

## 7. Migration waves

### 7.0 Principles

- **Expand → migrate → contract.** W1 adds new APIs beside old ones, marking the old ones deprecated (lint warn). W3 moves pages. W4 deletes the old APIs. The build stays green between waves.
- **One owner per shared file per wave** (FO-2). Feature files are frozen during W1/W2. W3 units own whole feature directories.
- **Isolation.** Each concurrent unit gets its own linked worktree cut from the recorded base (FO-6). The lead integrates by merge and verifies once per wave in the lead branch (FO-7).
- **Workers run only focused checks** (their directory's ESLint, their catalogue entry). The lead runs `pnpm typecheck && pnpm lint` and the census after integration.
- **The lead owns** `routes.tsx`, `components/app/contracts.ts`, `app/catalogue/registry.ts` and the merge of `messages/*.json`. Units append keys in their own prefix block and never reorder.

### 7.1 Wave 0: land, freeze, contract (lead, serial)

| Step | Work | Why |
|---|---|---|
| W0.1 | Land the in-flight R9 fix branches. `ui-v5r9-shellbugs` @ `a557a38e` touches `data-table.tsx`, `shell.tsx`, `design-system-page.tsx`, `sessions.tsx`, `project-sections.tsx`, `targets.tsx`. `ui-v5r9-runsbugs`, `ui-v5r9-settingsbugs` and `ui-v5r9-statebugs` carry uncommitted changes across `data-table.tsx`, `status.tsx`, `shell.tsx`, `derive.ts`, `types.ts`, `seed.ts`, `operation-panel.tsx`, `onboarding.tsx` and about 20 feature files (`git status` in each worktree). | They overlap every foundation file. |
| W0.2 | Record the base commit. Freeze `components/**`, `app/shell.tsx`, `routes.tsx`, `domain/types.ts`, `messages/*.json` except for named owners. | FO-2, FO-6 |
| W0.3 | Write `components/app/contracts.ts`: `Action`, `MenuItem`, `Blocker`, `ConfirmSpec`, `FlowStep`, `StepFlow`, `Facet`, `Preset`, `FileRow`, `Column` (moved). Types only. | Lets W1 run in parallel against one shape. |
| W0.4 | Add the §8 lint rules as **warn**. Add `check-copy.mjs` and `check-catalogue.mjs` in report mode. Save the census baseline (the §4a numbers) to `design/R10-CENSUS-BASELINE.json`. | Measurable progress. |
| W0.5 | Add route stubs owned by the lead: `/import?step=`, `/sessions/$id?step=`, `/calibration/processes/$id/$step`, `/settings/help`. | Page units never edit `routes.tsx`. |

**Decisions needed before W1:** Q1 (footer order), Q4 (Proceed label), Q11 (density scale), Q5 (map dependency, for the SitePicker unit only), Q12.
**Verify:** `pnpm typecheck && pnpm lint && pnpm lint:i18n` green with the warnings counted; baseline JSON saved.

### 7.2 Wave 1: foundation (parallel; FO-3 caps a batch at 8)

**W1a (8 units, in parallel):**

| Unit | Agent | Files owned | Delivers | Needs |
|---|---|---|---|---|
| U1 Tokens | implementer | `tokens/*.json` (new), `scripts/themes.mjs`, `src/themes.css`, `src/index.css` | DTCG source; sys/comp tokens; density rescale; elevation, z and dialog-size tokens | Q11 |
| U2 Actions | **implementer-high** (cross-module contract) | `components/ui/button.tsx`, `components/app/actions.tsx` (new), `components/app/row-menu.tsx` → `row-actions.tsx` | Action rendering: ActionBar, ActionMenu, RowActions, `useAction`, IconButton role; button variant/size deprecations | W0.3 |
| U3 DataTable family | **implementer-high** (keyboard/selection invariants) | `components/app/data-table.tsx`, `components/ui/table.tsx`, `components/app/filter-bar.tsx` (new), `components/app/data.tsx` (FilterChips) | Sort-by-default (`static` flag), rowActions/primaryRowAction/batchActions, toolbar slot with FilterBar or SelectionBar at one height, `expand`, states | W0.3 |
| U4 Feedback & status | implementer | `refusal.tsx`, `feedback.tsx`, `pill.tsx`, `status.tsx`, `tips.tsx`, `components/ui/hover-card.tsx` (new), `components/ui/toast.tsx` (new), `components/app/previews.tsx` (new) | Refusal + BlockersPreview, toast, notice-slot contract, display-only Pill (deprecate link/onClick), STATUS kinds absorbing T4Badge/GateLabel | W0.3 |
| U5 Dialogs | implementer | `components/app/confirm-dialog.tsx`, `components/ui/dialog.tsx`, `components/ui/alert-dialog.tsx`, `components/app/form-dialog.tsx` (new) | DialogFooter (Q1 order), FormDialog (+ `steps` host), ConfirmDialog `groups` (old props deprecated) | W0.3, Q1 |
| U6 Fields & settings | implementer | `components/app/fields.tsx` (new), `components/app/settings.tsx` (new), `components/app/folder-picker.tsx` | Field family, PathField, TokenTemplateField, ArgumentsField, SettingsRow/Section | W0.3 |
| U7 StepFlow | **implementer-high** (state contract) | `components/app/step-flow.tsx` (new), `components/app/page.tsx` (StepIndicator only) | StepStrip, StepFooter, gate/redo/reopen rendering | W0.3, Q4 |
| U8 Pickers, DisplayMenu, domain visuals | implementer | `components/app/pickers.tsx`, `components/app/display-menu.tsx`, `components/domain/*` (new copies; originals stay until W3) | NightPicker, SitePicker, SiteLocationField, TargetPicker, DisplayMenu; Plate/Histogram/AltitudeSpark/DarkLine/MoonLine/MosaicField moved by copy | W0.3, Q5 |

**W1b (after U2, U4 and U7 merge):**

| Unit | Agent | Files owned | Delivers |
|---|---|---|---|
| U9 Templates | **implementer-high** (layout contracts used by every page) | `components/templates/*` (new), `components/app/page.tsx` (PageHeader: path/summary/notice slots; `description` deprecated), `components/app/box.tsx` | ListPage, DetailPage (+ DetailPanel adaptive dock per spec 054), StepPage, SettingsPage |
| U10 Shell parts | implementer | `components/app/nav-list.tsx`, `checklist.tsx`, `issue-row.tsx`, `theme-picker.tsx` (new) | NavList, ChecklistRing, IssueRow, ThemePicker (pages adopt them in W3 P1/P9) |

**Catalogue.** Each unit writes its own entry file `app/catalogue/<component>.tsx`, showing every variant × the nine states. The lead owns `app/catalogue/registry.ts` and `app/design-system-page.tsx`.

**Verify W1 (lead, once after W1b):**
- `pnpm typecheck && pnpm lint` (new rules warn).
- `/design-system` renders every new entry: one `ui-review` pass with ARIA snapshot, keyboard walk and 1440/768/375. It covers:
  - the ⋯ menu and Shift+F10;
  - SelectionBar with no shift (table top y identical before and after selecting);
  - StepFooter gate HoverCard reachable by keyboard;
  - DialogFooter order;
  - HoverCard opening on focus.
- Census on product routes unchanged, since no page has adopted anything yet.

### 7.3 Wave 2: domain flows (in parallel with W1; feature files untouched)

| Unit | Agent | Files owned | Delivers | Needs |
|---|---|---|---|---|
| U11 Flows & P-REV2/P-REJ2 | **implementer-high** (data integrity, cross-module contract) | `domain/types.ts`, `domain/derive.ts`, `domain/membership.ts`, `domain/calibration.ts`, `domain/seed.ts`, `store/actions/*`, `store/slices/*` | D1-D5, D9-D11 (§5.8) as **new** builders (`runFlow`, `sessionIntake`, `wrapUpFlow`, `calibrationFlow`) beside the old ones; `Project.rejections` marked for removal; settle-on-success | Q2, Q3, Q9, Q10, Q15 |
| U12 Planning & goals | implementer-high (numeric rules) | `domain/planning.ts`, `domain/labels.ts`, `domain/templates.ts`, `e-targets-plan-settings/good-tonight.ts` | D7, D8 | Q6, Q7 |

**Verify W2:**
- `pnpm typecheck`.
- The seed loads (Welcome › Load demo library) and every route still renders (census route list, 0 page errors).
- A **Flows** section in the catalogue renders each builder's StepFlow for the demo seed: setup, import, intake (a reviewed and an unreviewed session), calibration process, run (open, finished), group, and Wrap up (M 31). Names, states and gates are reviewed side by side.

### 7.4 Wave 3: page migrations (parallel; each unit owns its directory)

Each unit adopts L3/L2, deletes its local duplicates (the §3.3 delete lists), removes its tooltips per §6.2 and rewrites its keys per §6.

| Unit | Agent | Owns | Delivers | Needs |
|---|---|---|---|---|
| P1 Shell | implementer | `app/shell.tsx`, `status-bar.tsx`, `issues-hub.tsx`, `command-palette.tsx`, `onboarding.tsx`, `navigation.ts`, `shortcuts.tsx`, `history.tsx`, `appearance.tsx`, `run-ui.tsx` | NavList, Recent below Library, ChecklistRing, ⌘↩ = Proceed, IssueRow dismiss, modal walk + copy, palette from Actions, ThemeItems/ThemeMenu removed | U9, U10 |
| P3 Sessions, Import, Intake | implementer-high (new flow host) | `features/v5/a-home/{sessions,session,import,parts,session-model,import-*}.tsx/ts` | Sessions ListPage, Session DetailPage + intake StepPage, Import StepPage | U9, U11 |
| P4 Review | implementer | `features/v5/d-review/*`, `features/t3/{frame-preview,raster,measure,csv,actions,import-dialog}.*` | The review workspace as the intake Review step body; frame DataTable; DisplayMenu everywhere; histogram stats (R9-PIXINSIGHT-STATS §3); tooltip purge; `SessionReview` props contract agreed with P3 | U3, U8, U11 |
| P5 Projects | implementer-high (Wrap up commit steps) | `features/v5/b-projects/*` | Projects ListPage; Project DetailPage + Tabs; Wrap up StepPage; New Project / Start run / Edit FormDialogs; Trash ListPage; P-REJ2 consumers removed | U9, U11 |
| P6 Runs | implementer-high (step contract) | `features/v5/c-runs/*` | Run and Run group StepPages (§5.4); Finish run dialog; Done step deleted | U9, U11 |
| P7 Targets | implementer | `e-targets-plan-settings/{targets,target,planned-tools,moon-limits,targets-model,parts}.*` | Targets ListPage + Tabs + pickers + presets; Target DetailPage; Moon limits FormDialog | U8, U9, U12 |
| P8 Calibration | implementer | `e-targets-plan-settings/{calibration,settings-calibration,dialogs}.*` | Masters ListPage + DetailPanel; Processes StepPage; Import/Replace FormDialog; age badge; `/settings/calibration` deleted | U9, U11, Q9 |
| P9 Settings A | implementer | `features/t1/settings/*`, `features/t1/components/*`, `features/t4/*` | Appearance, Locations, Sites, Target lookup, Applications, About, **Help** | U6, U9, U10 |

W3b, after W3a merges:

| Unit | Agent | Owns | Delivers | Needs |
|---|---|---|---|---|
| P2 Home | implementer | `features/v5/a-home/home.tsx` | A1+ from standard parts (Q8) | P7 (pickers adopted), Q8 |
| P10 Settings B | implementer | `e-targets-plan-settings/{settings-equipment,equipment-records,settings-goal-templates,settings-naming}.tsx` | Equipment (Filters section, rig selects parts), Goal templates (unit), Naming (TokenTemplateField) | U6, U9, U12 |
| P11 Setup & Activity | implementer | `features/t1/setup/*`, `features/t1/lib/*`, `e-targets-plan-settings/activity.tsx` | Setup StepPage + copy; Activity ListPage | U7, U9 |

**Interfaces between W3 units:**
- **P3 ↔ P4.** `SessionReview({ sessionId, onFinished })` is the step body, and P3 owns the host. A change goes by message to the other owner.
- **P5 ↔ P6.** `b-projects/model.ts` is owned by P5. The 7 c-runs↔b-projects cross-imports become imports from `domain/` (moved by U11) or a P5 message.
- **P7 owns `e-targets-plan-settings/parts.tsx`.** P2 and P8 consume only the L2 replacements.

**Per-unit acceptance** (worker checks focused; the lead re-measures after merge), on every owned route:
- raw tables 0; pill-as-control 0; `title=` 0 except truncation; HelpTip ≤1 approved;
- header ≤1 primary + ≤3 standard + object menu;
- distinct variant×size combinations ≤4 (primary/sm, outline/sm, ghost/icon-sm, outline/xs in cells);
- every data header sortable or `static`;
- no layout shift on selection;
- no side Sheet;
- copy lint clean for the unit's keys;
- the unit's §3.3 delete list empty in its directory.

**Verify W3 (lead, per batch):**
- `pnpm typecheck && pnpm lint && pnpm lint:i18n`.
- The census against the budgets at 1440/1024/768.
- One `ui-review` walk per template instance type: Sessions as ListPage, Project as DetailPage, Run as StepPage, Locations as SettingsPage, New Project as FormDialog.
- `skill://journey-verify-changed` on the affected journeys (the journeys from PR #1788, `HARNESS-V5-FEEDBACK-R1.md:233`).

### 7.5 Wave 4: contract (lead + one operator)

- **Remove deprecated APIs:**
  - Pill `link`/`onClick` and public `pillClass`;
  - ConfirmDialog `changes`/`unchanged`/required `description`;
  - DataTable `contextMenu` and optional `sortValue` (now a type error);
  - `MenuEntry`;
  - `StepBar`, `StepIndicator`, `StageStrip`;
  - PageHeader `description`/`eyebrow`;
  - the old `runPipeline` review/done path and `Project.rejections`;
  - Button `secondary`/`lg`/`icon`/`icon-xs`/`icon-lg`.
- **Delete files:** `t1/components/row-menu.tsx`, `t1/components/form-field.tsx`, `t3/fields.tsx`, `t4/badges.tsx`, `t4/prototype-controls.tsx` (merged into the simulation panel), `ui/card.tsx`, `ui/scroll-area.tsx`, `ui/button-group.tsx`, the `settings-calibration.tsx` route.
- **Lint warn → error.** `check-copy` and `check-catalogue` fail the build. Zero `eslint-disable` without a `-- reason`; `reportUnusedDisableDirectives` is already `error` (`eslint.config.js:32`).
- **Verify:** the full lint/typecheck; the static regex counts (§1a) at 0 for raw `<table>` in features, interactive Pill, `side="right"` in features and `title=` in features; the final census against budgets.

### 7.6 Wave 5: review and user round

An independent reviewer runs `skill://code-review` on the integrated diff, plus `skill://ui-review` and `skill://accessibility-audit` on the five templates. Then the user walks the build. Decisions are recorded as Round 10 in `HARNESS-V5-FEEDBACK-R1.md`.

### 7.7 Shared component owners

| Component / file | W1 owner | Owner from W3 |
|---|---|---|
| Tokens, `themes.mjs`, `index.css`, `themes.css` | U1 | lead |
| `button.tsx`, `actions.tsx`, `row-actions.tsx` | U2 | lead |
| `data-table.tsx`, `ui/table.tsx`, `filter-bar.tsx`, `data.tsx` | U3 | lead |
| `refusal.tsx`, `feedback.tsx`, `pill.tsx`, `status.tsx`, `tips.tsx`, `hover-card.tsx`, `toast.tsx`, `previews.tsx` | U4 | lead |
| `confirm-dialog.tsx`, `form-dialog.tsx`, `ui/dialog.tsx`, `ui/alert-dialog.tsx` | U5 | lead |
| `fields.tsx`, `settings.tsx`, `folder-picker.tsx` | U6 | lead |
| `step-flow.tsx` | U7 | lead |
| `pickers.tsx`, `display-menu.tsx`, `components/domain/*` | U8 | lead (domain visuals: P4 for review visuals, P7 for planning visuals, by message) |
| `components/templates/*`, `page.tsx`, `box.tsx` | U9 | lead |
| `nav-list.tsx`, `checklist.tsx`, `issue-row.tsx`, `theme-picker.tsx` | U10 | P1 |
| `contracts.ts`, `routes.tsx`, `app/catalogue/registry.ts`, `messages/*.json` merge | lead | lead |
| `domain/*`, `store/*` | U11 / U12 | lead |

## 8. Enforcement

### 8.1 Lint rules (core ESLint, no new dependency)

ESLint 10 and the typescript-eslint parser are already configured (`apps/prototype/package.json:36,41`; `eslint.config.js:34-38`). Every rule below uses core `no-restricted-syntax` (https://eslint.org/docs/latest/rules/no-restricted-syntax) or `no-restricted-imports` (https://eslint.org/docs/latest/rules/no-restricted-imports). Files: `src/features/**`, plus `src/app/**` where noted. Stage: **warn** from W0, **error** from W4.

[INFERENCE: these selectors have not been run against the repo. The W0 lead validates each one against the baseline counts before enabling it.]

| # | Rule (message) | Selector | Today (static) |
|---|---|---|---|
| L1 | No raw interactive or table markup: "Use DataTable / Button / Field from @/components/app" | `JSXOpeningElement[name.name=/^(table\|thead\|tbody\|tr\|th\|td\|button\|select\|input\|textarea\|dialog\|details\|summary)$/]` | 14 tables, 29 buttons in features |
| L2 | Pills are display-only | `JSXOpeningElement[name.name='Pill'] > JSXAttribute[name.name=/^(onClick\|link\|href)$/]`; `CallExpression[callee.name='pillClass']` | 16 + 2 |
| L3 | No restyling shared components | `JSXOpeningElement[name.name=/^(Button\|Badge\|Pill\|StatusBadge\|DataTable\|Box\|PageHeader\|ConfirmDialog)$/] > JSXAttribute[name.name='className']` | 25 in features (49 in `src`) |
| L4 | Button roles only | `JSXOpeningElement[name.name='Button'] > JSXAttribute[name.name='variant'][value.value='secondary']`; `… > JSXAttribute[name.name='size'][value.value=/^(lg\|icon\|icon-xs\|icon-lg)$/]`. End state: features don't import Button (L9). | census: secondary on 2 routes |
| L5 | No side fold-outs | `JSXOpeningElement[name.name='SheetContent']` | 5 in features |
| L6 | No `title=` tooltips | `JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']` | 410 in src |
| L7 | HelpTip needs a reason | `JSXOpeningElement[name.name='HelpTip']`, always reported; allowed only with `// eslint-disable-next-line no-restricted-syntax -- help: <reason>` | 25 |
| L8 | No arbitrary sizes | `Literal[value=/(?:^\|\s)(?:min-\|max-)?(?:w\|h\|size\|text\|gap\|p[xytrbl]?\|m[xytrbl]?\|inset\|top\|left)-\[/]`, plus the same on `TemplateElement[value.raw=…]` | 121 in src |
| L9 | No inline style (as the original: `apps/desktop/eslint.config.js:130-158`) | `JSXAttribute[name.name='style']` | – |
| L10 | Layout belongs to templates: budget falls to 0 | `JSXOpeningElement[name.name=/^(div\|span\|section\|ul\|ol\|li\|p\|header\|footer\|nav\|aside)$/] > JSXAttribute[name.name='className']` | counted in W0 |

**Exempt:** `src/app/simulation-panel.tsx`, `src/app/catalogue/**`, the Prototype controls. These are the same as the i18n ignores at `eslint.config.js:17-25`.

### 8.2 Import boundaries (`no-restricted-imports`, one config block per glob)

| Files | Banned imports | Today |
|---|---|---|
| `src/components/ui/**` | `@/components/app/*`, `@/components/templates/*`, `@/features/*`, `@/store/*` | – |
| `src/components/app/**`, `src/components/domain/**` | `@base-ui/*` (go through `components/ui`), `@/features/*`, `@/components/templates/*` | – |
| `src/components/templates/**` | `@/features/*`, `@/store/actions/*` | – |
| `src/features/<area>/**` | `@base-ui/*`; `@/components/ui/*` (end state; warn until W4); `["@/features/**", "!@/features/<area>/**"]` (gitignore-style negation) | 0 base-ui; 194 ui; **45 cross-feature** (d-review→t3 16, e-targets→t1 9, b-projects→t3 5, c-runs→b-projects 4, b-projects→c-runs 3, a-home→b-projects 3, c-runs→t3 2, others 3) |

`t1`, `t3` and `t4` dissolve: their shared code goes to L2, and their pages to the owning area. Cross-feature imports then reach 0.

`eslint-plugin-boundaries` and `dependency-cruiser` would also catch orphans and cycles (https://github.com/javierbrea/eslint-plugin-boundaries ; https://github.com/sverweij/dependency-cruiser), but each is a new dependency. Not needed now.

### 8.3 The design-system page as a living catalogue

- **Registry.** `/design-system` (`routes.tsx:167`) renders from `app/catalogue/registry.ts`: one entry per export of `components/{ui,app,domain,templates}`. Each entry shows every variant × the nine states:
  - default, hover, focus-visible, active, disabled, loading, empty, error, selected (`skill://ui-review`).
- **Flows section.** Renders every StepFlow from the demo seed, so step names and gates are reviewed side by side (§7.3).
- **Check.** `scripts/check-catalogue.mjs` lists the exports with a regex on `export (function|const) [A-Z]` and fails when one lacks a registry entry. It runs in `pnpm lint` from W4.
- **Gaps today:** the page claims completeness but lacks Badge, Breadcrumb, Combobox, DropdownMenu, Field, Popover, Sheet, Table, Tabs, Tooltip, HelpTip, NoteMarker, Refusal, RowContextMenu and others (C DS1). It shows only `default` and `sm` sizes (C DS1).
- Storybook is the industry equivalent (https://storybook.js.org/docs/get-started/why-storybook), but it is a new dependency (Q12).

### 8.4 Copy lint

`scripts/check-copy.mjs`, as in §6.4, runs inside `pnpm lint:i18n`.

### 8.5 Rendered census (lead, after each wave)

- The census script from §4 is committed as `scripts/census.browser.js`: a page-evaluated snippet with no dependency, run through the lead's browser tool over the route list in `design/R10-CENSUS-BASELINE.json`.
- It records per route:
  - header action roles;
  - distinct variant×size combinations;
  - DataTable vs raw tables;
  - sortable header share;
  - pills as controls;
  - `title=` count, glyph tips, hand-rolled buttons;
  - document overflow.
- The budgets are those in §7.4. A route over budget blocks the wave.

### 8.6 Review checklist (reviewers, and workers before yielding)

1. The page renders only L3/L2; no new component or styled element in `features/`.
2. Actions are `Action` descriptors: one primary per view, ≤3 standard in the header, the rest in a named menu. The variant follows `kind`, never the flow position.
3. Every row with actions has ⋯, and the context menu comes from the same list.
4. Tabular data uses DataTable with sortable headers and empty, loading and error states. Facts use KeyValueList.
5. Selection swaps the toolbar for the batch bar at the same height; nothing moves.
6. Each feedback situation uses its P7 route; no Notice or Refusal is inserted above a list.
7. Irreversible actions use ConfirmDialog with file groups. Reversible actions run, then toast with Undo or Show.
8. Dialog footers come from DialogFooter. There are no side Sheets.
9. Staged work uses StepFlow: Proceed fixed at the trailing end of the footer, Skip only on optional non-selection steps, settle on success.
10. Copy passes `check-copy`, with no explanatory sentences and keys owned by the feature.
11. Tooltips only as T1-T4 (§6.2).
12. Tokens only: no arbitrary values, no literal colours or shadows.
13. A new or changed shared component has a catalogue entry with its states.
14. Keyboard: ⋯ and Shift+F10 open the same menu, Escape returns focus, and targets are ≥24 px (WCAG 2.5.8).
15. Template-level `ui-review` evidence (ARIA, computed style, widths) is attached for new templates.

### 8.7 Governance

- The lead is the single design-system owner: Curtis's "solitary" model, row 31 of §2a.
- A worker that needs a missing pattern stops and messages the lead. The lead extends an existing component, adds one to L2/L3, or rejects the need.
- There is no `one-offs/` folder. This is stricter than Frost's advice, because the user forbids custom components.

---

## 9. Open decisions (grill format: question, options, recommendation)

**Q1. What order do the confirm buttons take on each OS?**
- **A** Platform order, owned by `DialogFooter`. macOS and GNOME: `[Cancel] [Action]`, with the default on the trailing side. Windows: `[Action] [Cancel]`.
- **B** `[Cancel] [Action]` everywhere. This is the original `ConfirmModal` (`D:components/ConfirmModal.tsx:96-110`) and the prototype today.
- **C** Windows order everywhere.

**Recommended: A.** One component decides, so no page orders buttons. The prototype defaults to macOS order, with Prototype ▸ Platform to preview Windows. If the stack is Tauri with native message dialogs, simple confirms get the native order for free [INFERENCE]. Sources: Apple alerts, Windows dialogs, GNOME dialogs (§2a row 21). *Blocks U5.*

**Q2. Do you accept the renames in §5.7?**
The key items:
- (a) Complete → **Finish run**, with state **Finished**;
- (b) the run "Done" step is removed;
- (c) the final "Mark Done" → **Close project**, with state **Closed**;
- (d) Wrap up's first "Mark Done" is removed (Proceed takes its place);
- (e) masters "Dismiss" → **Hide / Show hidden** (issues keep Dismiss);
- (f) one **Edit…** verb;
- (g) Tonight → **Planning**;
- (h) "Good tonight for" → **Best filter tonight**;
- (i) **Up next** column;
- (j) Ready / Needs review session states;
- (k) "About this prototype" → **About**.

Also: should moving files to the OS Trash use the destructive red style? (A) no: Trash is recoverable, so standard tone with a specific verb; (B) yes.

**Recommended:** accept all; Trash as A. *Blocks U11 and the copy work in every W3 unit.*

**Q3. Is Wrap up order enforced?**
- **A** Strict: Clean up → Trash → Archive. Later steps are read-only until the earlier ones are Finished or Skipped. Earlier steps can be reopened until Close.
- **B** Free order, as today (`wrap-up.tsx:110` ignores `current`).
- **C** Strict, but Archive is allowed any time.

**Recommended: A.** Trashing before archiving avoids moving frames that are about to be trashed. It keeps the P-TRASH2 link checks valid and matches "one flow, stick with it". It also follows Carbon's linear progress indicator (§2a row 27). *Blocks U11 D4 and P5.*

**Q4. What does the Proceed button say?**
- **A** "Proceed" on every step except the last, which takes the terminal verb ("Finish run…", "Close project…", "Finish review").
- **B** A specific verb per step ("Continue to Calibrate").
- **C** "Next" / "Finish".

**Recommended: A.** You asked for "proceed". The StepStrip already names the next step, and a constant label keeps the footer identical across flows. NN/g prefers specific labels, which the terminal verb satisfies where it matters (§2a rows 26, 28). *Blocks U7.*

**Q5. Do we add Leaflet for the site map?**
- **A** Port the original `SiteLocationPicker`: Leaflet + OSM tiles, a lazy chunk, numeric fields stay the source of truth, and a "map unavailable" fallback (`D:shared/observing-sites/SiteLocationPicker.tsx:1-210`; PREV A8). This needs approval for a new dependency, network tile access and OSM attribution.
- **B** MapLibre GL: vector tiles, a heavier dependency.
- **C** No map: numeric fields, "Use this computer's location" and a place search.

**Recommended: A.** It is proven in the original and the smallest option. Leaflet is web-only: a Flutter stack would use `flutter_map` [INFERENCE]. *Blocks U8's SiteLocationField map part only.*

**Q6. Which Moon model?**
- **A** Keep the two independent limits per band, separation ≥ and illumination ≤ (`planning.ts:376,407-433`; defaults at `labels.ts:94-102`).
- **B** One Moon-avoidance curve per band, where the required separation falls as illumination falls: the Lorentzian model of ACP / N.I.N.A. Grades and Img time both use it.
- **C** Separation scaled linearly by illumination.

**Recommended: B** [INFERENCE: the ACP/N.I.N.A. convention was not verified against a source in R9 and must be checked before build]. Whichever is chosen, Img time must use the same rule; today it ignores the Moon (`planning.ts:71-78`; R9-ANSWERS Q2). *Blocks U12, P7.*

**Q7. What units and quality bar do goals use?**
- **A** One unit per goal, time **or** frames, chosen with a unit Select.
- **B** Both allowed, AND semantics, with both progress figures shown.
- **C** Both allowed, OR semantics.

Quality bar: under P-REV2 every frame in a usable session is reviewed, so "Usable" only means "not rejected". Options: (i) "All kept frames" (default) + "FWHM ≤ x″"; (ii) keep the four options and rename them (R9-ANSWERS Q6).

Should a closed Project's goals freeze at Close? (yes / no)

**Recommended:** A, (i), and freeze at Close. Today both set means AND, but progress shows only time: a bug (`derive.ts:576-602`). *Blocks U12, P5, P10.*

**Q8. Which Home?**
- **A1+:**
  - Planning is the main column: NightPicker + SitePicker, the night's plan as a DataTable, and a Needs DataTable with a 30-night horizon as columns.
  - An Up next rail: one line per open Project with its single next action.
  - Getting started moves to the sidebar ring.
  - The matrix is deferred.
- **A0** Keep the six boxes.
- **A3** No Home: start on Targets › Planned.

**Recommended: A1+**, built only from standard parts (R9-HOME-DEBATE §4-5, about 70 % confidence). The cost of the 30-night columns must be measured first (debate §7). *Blocks P2.*

**Q9. How do calibration imports, master replacement and age alerts work?**

(a) Import vs replace:
- **A** "Import masters…" is a two-step FormDialog. Step 1 chooses a folder. Step 2 is a preview DataTable: File · Kind · Camera · Gain/Offset · Temp · Exposure · Match (**New** / **Replaces {master}** / **Duplicate**). "Replace…" on a master row uses the same matching step. Runs that are not Finished are re-pointed after a ConfirmDialog listing them; Finished runs keep their frozen calibration (D5).
- **B** Import only; you replace by importing and hiding the old master yourself.

(b) Age alerts:
- **A** The Calibration list badges darks, bias and dark-flats older than N days as "Old · {n} d". The setting defaults to 90 days, matching `DESIGN.md:251`. Flats are exempt.
- **B** No alerts.
- **C** As A, plus an Issues-hub alert (dismissable, P-ISS1) **only** when an old master is assigned in an open Project's unfinished run, which answers "and only for projects?" (user item 75).

**Recommended:** (a) A, (b) C. *Blocks U11 D9, P8.*

**Q10. What does "fully reviewed" mean (P-REV2)?**
- **A** Every frame is Usable or Unusable (0 Unreviewed). Bulk actions: "Mark rest usable" and "Select by threshold…".
- **B** Threshold auto-marking counts as reviewed.
- **C** Review is required only to join a run, not a Project.

Also: what happens when review is reopened on a session that an unfinished run uses? (i) The run shows "Inputs changed · Refresh ▸" on Prepare; (ii) reopening is refused while the run is unfinished.

**Recommended:** A and (i). *Blocks U11 D2, P3, P4.*

**Q11. Does density rescale the whole app?**
- **A** App-wide rescale of `space-*`, `control-h-*` and `row-h`, like the original `applyDensity`. This is a new token scale, so it needs your approval (`rule://design-token-discipline`).
- **B** Remove the density setting; keep comfortable only.

**Recommended: A.** It answers "density only does something inside the appearance menu" (user item 256). *Blocks U1.*

**Q12. What verification tooling does the prototype get?**
- **A** No new dependency: lint, the catalogue and the lead-run rendered census.
- **B** Add Vitest + Testing Library (dev dependencies) for L2 contract tests: keyboard, focus return, footer order.
- **C** Add Storybook.

**Recommended:** A for the prototype; B in the production rebuild once the stack is decided (the original had shared component tests: `D:ui/Table.test.tsx`, `D:components/Modal.test.tsx`). *Blocks nothing if A.*

**Q13. Which typeface?**
- **A** The system UI stack, as now (`index.css:21-23`; native feel per harness v4).
- **B** Bundled Inter, as the original (spec 055).

**Recommended:** decide with the stack (astro-plan-42eka) and keep A until then. `rule://design-no-slop` requires the choice to be explicit, which both options satisfy. *Blocks nothing.*

**Q14. Where does session intake live?**
- **A** A StepPage on each session; Import ends by opening the first session that needs review.
- **B** A separate three-pane Review queue page, as the original `DESIGN.md:219-227`.
- **C** Both, merged: the Sessions list facet "Needs review" is the queue, the intake StepPage handles one session, and its terminal Proceed "Finish review" opens the next session in the queue.

**Recommended: C.** There is no extra page, the queue is a filter, and every session uses one flow. *Blocks P3.*

**Q15. Do metadata corrections move to intake?**
Today Prepare offers "Corrected metadata" with three radio modes per field (`prepare-step.tsx:316-362`; R9-ANSWERS Q4). You asked whether corrections belong at ingestion (user item 171).
- **A** Corrections move into intake (Target and Rig steps: a table of fields with recorded and corrected values). Prepare applies them automatically, with a Prepare check row "3 corrected values".
- **B** Keep them in Prepare, as a DataTable instead of radio cards.

**Recommended: A.** It fits P-REV2: everything about a session is settled before it is used. *Blocks U11 D11, P3, P6.*

---

## 10. Limits of this plan

- **Static and rendered.** Counts come from a regex pass (they can miss JSX spread across lines). Census numbers come from one width (1440) on the demo seed. The 1024 and 768 checks belong to W1 and W3 verification.
- **Not run.** The ESLint selectors in §8.1, Base UI preview-card focus behaviour, and the Lorentzian Moon convention are [INFERENCE] until checked.
- **Steering gap.** The frontend steering package linked from `AGENTS.md:70-80` is not installed, so its contents are not reflected here.
- **Moving target.** The four in-flight R9 fix branches change files this plan cites. W0.1 must land them before any line reference is re-used for edits.
- **No beads were created.** The dispatcher turns the units in §7 into beads with `execution_agent_type` as listed.
