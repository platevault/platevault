# PlateVault UX/Design Review — 2026-07-11

Method: dual-agent impeccable critique (Assessment A: isolated design review · Assessment B: deterministic detector) + 4 static audits (journeys, settings, panels, consistency) + live capture at 1440×900 and 1100×720 + 4 live journey walkthroughs on the real Windows app (Tauri MCP bridge) with real mutations on disposable data + computed-style measurement across all pages + cross-reference against the manual-journey GitHub issue campaign (epics #518–#527). Every load-bearing agent claim was verified against source or live evidence before inclusion; refuted claims (3) were dropped.

Verdict band: **19/40 — the visual system is good; the workflow layer is broken.** PlateVault looks like the calm, precise expert workbench it wants to be — restrained dark themes, one accent, real semantic tokens, a disciplined shared page skeleton. But driving it end-to-end reveals that several core surfaces are prototypes wearing production clothes (the wizard's calibration and review steps are hardcoded mock data; the Advanced pane fabricates database stats; the command palette ships with zero CSS), and nearly every completed action ends in silence: no toast, no navigation, no explanation for refusals or empty plans. The app currently under-communicates at exactly the moments its constitution says it must over-communicate.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 2 | Zero feedback after apply/confirm/create; lifecycle refusals invisible (audit says `refused`, UI says nothing) |
| 2 | Match system / real world | 3 | Domain vocabulary excellent; unnormalized IMAGETYP leaks ("Dark_flat" + "Darkflat" as separate categories) |
| 3 | User control & freedom | 2 | Bulk reclassify has no undo and permanently strands calibration frames; Escape/cancel otherwise good |
| 4 | Consistency & standards | 2 | Measured drift: 4 control heights, 3 table row heights, 3 top-bar heights; two plan-overlay implementations; 3 filter-toolbar vocabularies |
| 5 | Error prevention | 2 | Footprint card + protection gates are excellent; mock review step and no-warning bulk override undermine them |
| 6 | Recognition rather than recall | 2 | "(root)" in the primary scan column ×150 rows; hidden two-stage confirm→apply; unlabeled 13073-vs-11390 counts |
| 7 | Flexibility & efficiency | 1 | Palette unstyled + 3 dead routes; no list-level multi-select; "Confirm all" is the lone accelerator |
| 8 | Aesthetic & minimalist design | 3 | Restrained and systemized; noise from chip stacks, duplicate facts, and dead columns |
| 9 | Error recovery | 1 | "Apply failed after 0 applied, 0 failed"; per-item failures discarded; refusals carry no reason anywhere |
| 10 | Help & documentation | 1 | No contextual help (#497); empty states instruct actions that don't exist on the page |
| **Total** | | **19/40** | Poor band — flows need an overhaul; the visual foundation does not |

Impeccable detector (Assessment B): 8 findings — 4 toast left-stripe accents (`feature-lists.css:573-585`, ban per skill; use full border/tint), 3 layout-property transitions (`app-shell.css:73`, `primitives.css:263`, `wizard-base.css:63`), Inter-everywhere note (acceptable for product register). No gradient/card-grid/eyebrow slop. Browser overlay skipped (Tauri webview). The product-slop verdict: this does *not* read AI-generated; it reads *unfinished in specific, fixable places*.

---

## Topic 1 — User journeys (analysed each; live evidence)

State of each journey as actually driven:

| Journey | Live result |
|---|---|
| First-run setup | Not re-run (wipes DB); 14 open issues from manual campaign (#491–#516) already cover it |
| Inbox ingest (move) | Works, but two-stage confirm→apply is hidden; zero post-apply feedback |
| Inbox catalogue-in-place | Works (applied live); same feedback gaps |
| Sessions review | Renders, but Target/Filter never populate (#564) and all rows share one name |
| Project create → tool launch | Wizard completes, but steps 3/6 are mock data; post-create silence; "Prepare" refused silently |
| Cleanup scan→review→apply | Scan honest and fast; full apply untested (no candidates on test project) |
| Archive → trash/delete | **Blocked**: plan generator returns 0 items, Approve disabled, no explanation |
| Calibration ingest→masters→matching | Master registered and listed; unassigned master shows empty state, no candidate table; project-side matching all "needs location" |
| Targets & planning | Add/search/favorite/group work well; "Add to plan" is a disabled placeholder; planner columns stubbed (#579) |
| Settings/appearance/i18n | Panes work; Appearance has a dead control; Advanced has two no-op buttons + fabricated stats |

Recommendations:

1. **[P0] Replace the wizard's mock steps with real data or remove them.** `StepCalibration.tsx:34-80` (`MOCK_FLAT_ROWS`, `projects_wizard_mock_*` keys) and `StepReview.tsx:17-37` (hardcoded `NGC7000_HOO/` plan + static disk tree) render fixtures regardless of the actual project. A user "reviewing the plan before create" reviews fiction — a direct Constitution-II violation and the single most trust-destroying thing in the app. If real per-step data isn't ready, collapse the wizard to Name→Sources→Create and let project detail handle calibration/views (which use real matchers).
2. **[P0] Surface refusals.** Prepare and Archive transitions are refused by the backend and *audited as refused* — but the UI shows nothing (verified: 5 refused events, zero UI response). Wire the refusal reason into a banner/toast near the button, and disable-with-reason where the state machine forbids a transition.
3. **[P1] Explain empty plans.** The archive flow produced "0 items · Approve & apply disabled" three times with no hint why (sources had no resolvable files). An empty plan needs a diagnostic sentence ("No files are linked to this project's sources — nothing to archive"), not a disabled button.
4. **[P1] Fix the target→wizard handoff.** "+ New project here" navigates with no target parameter (`TargetDetailV2.tsx:593`); the wizard's "From target context:" chip is derived by splitting the typed *name* (`WizardPage.tsx:408`). Pass the target id, prefill the name, persist the association (post-create Target column currently shows "—").
5. **[P1] Remove or implement "Add to plan".** It is a permanently `disabled` button (`TargetDetailV2.tsx:598`) for a feature with no destination page. Shipping a disabled primary-position CTA for a nonexistent surface confuses everyone (the test agent clicked it twice without realizing it was disabled — see suggestion T2-8 on disabled styling).
6. **[P1] Close the ingest loop with navigation offers.** After an inbox apply, the item vanishes, the detail silently selects the *adjacent* item, and new sessions/masters appear elsewhere unannounced. Offer "View session" / "View master" in a success toast (see Topic 3).
7. **[P2] Make session identity survive missing metadata.** Three sessions named "Session — 2026-07-11" with Target/Filter "—" are indistinguishable (#564). Fall back to source folder name + frame-type mix in the session title.
8. **[P2] Give the calibration page a candidates surface for unassigned masters.** An unassigned master currently shows a plain empty state — the ranked-candidates table (which exists in `MatchCandidatesPanel`, mounted in MasterDetail) only appears when already assigned. Inverting that (suggest candidates *before* assignment) is the entire value of matching.

## Topic 2 — UI elements, layout, structure, duplication (measured)

Measured on the live app at 1440×900:

- Top bars: 44px (Sessions/Inbox/Calibration/Projects) vs **97px** (Targets, two stacked rows) vs **40px** (Settings, and 16px left padding vs 12px elsewhere).
- Table rows: Sessions **27px**, Inbox **35px**, Targets **48px**; header cells 23/31/23px.
- Adjacent controls in one toolbar: input **27px** next to select **25px**; buttons **24px**; Settings selects **28px**. Four control heights in one chrome.
- Primary CTA buttons render **10px** type; sidebar group labels 9.5px/600 — plus hardcoded 9/9.5/10.5px in `settings.css:27`, `app-shell.css:149`, `target-search.css:225`, `wizard-steps.css:144,908`, `redesign-detail.css:516,521` — all below the app's own 10px token floor.
- Density setting maps to `--alm-row-height`, but only `.alm-targets-table` and wizard rows consume it (`merges-1.css:556`) — Sessions/Inbox ignore it entirely (root cause of #587).

Recommendations:

1. **[P1] Adopt one control-metrics scale.** Define `--alm-control-h` (e.g. 26px) + one sm variant, apply to `.alm-btn`, `.alm-input`, selects, SegControl. The 24/25/27/28 drift is exactly what "pixel-perfect" means to fix, and it's a token change, not a redesign.
2. **[P1] Unify row rhythm on the density token.** Key *all* table/list row heights off `--alm-row-height` (27/35/48 today). This simultaneously fixes #587 (density does nothing) and makes Sessions/Inbox/Targets feel like one product.
3. **[P1] Restyle the command palette and fix its routes.** `alm-palette*` classes have **no CSS anywhere** (verified by grep; the palette renders as raw HTML at document bottom — root cause for #581), and `CommandPalette.tsx:17-22` offers `/review`, `/plans`, `/audit` which don't exist (silent redirect to Sessions). Restore the stylesheet, delete the 3 dead entries, add a test asserting every palette route exists in the route tree.
4. **[P1] Normalize the Targets top area.** Three stacked bands (toolbar + moon row + header) cost 97px+ before data. Fold the moon widget into the table header zone or the detail rail; promote "Add target" to `variant="primary"` at the bar's right edge (it's the page CTA and currently a mid-bar neutral button).
5. **[P2] Merge the two filter-toolbar vocabularies.** Sessions says "Filter [All] · Camera [All]"; Inbox says "File type · Kind"; Targets says "Show · Catalogues · Filters [None]". Same concept, three grammars — pick label-outside + select, reuse everywhere. And hide the "Group: none · then: — · then: —" chain behind one "Sort & group" popover; today it reads as debug UI and shows even on pages with 0–3 rows.
6. **[P2] Delete the duplicated count chrome.** Sidebar badges (sessions/projects/calibration) repeat the status-bar center; the Targets badge shows the seed catalog (13073) while the page footer says 11390 with no labels distinguishing them (#574). Keep sidebar badges for actionable counts only (Inbox), drop the rest or label them ("Library: 11,390 · Catalog: 13,073").
7. **[P2] Kill `accent` as a Btn variant.** It's byte-identical to `primary` in CSS (`primitives.css:33-39`) and its existence lets pages break the documented one-CTA rule (Inbox shows two accent CTAs; Targets' CTA is neutral). Enum-level deletion + 3 call-site edits.
8. **[P2] Make disabled buttons look disabled.** Two independent journey agents failed to distinguish disabled from enabled ("Confirm to inventory", "Add to plan"). Drop disabled opacity to ~0.35 and remove the accent fill from disabled primary buttons.
9. **[P2] Fix the focus story.** `.alm-input` uses `outline:none` + 1px border tint (`target-search.css:24-30`) while a proper `--alm-focus-ring` exists and is used elsewhere. Apply the ring to inputs/selects.
10. **[P3] Replace the 4 toast left-stripes** (`feature-lists.css:573-585`) with full hairline borders + background tints (detector finding; also the skill's hard ban), and move the 3 width/height transitions to transform/opacity.
11. **[P3] Purge dead components.** `TargetList.tsx`, `MastersList.tsx` (+`ListSidebar`/`ListItem`) have zero non-test importers; the CSS clones (`.alm-listpage__panel-bar` ≡ `__detail-bar`, modal vs plan-overlay headers, wizard input twins, sr-only clone) violate the house one-component rule. Run `knip`, delete, consolidate.

## Topic 3 — Flow efficiency (the "what happens next" layer)

This is the weakest layer of the product, and the user's instinct in the brief is exactly right: nothing offers a next step.

1. **[P0] Add a success toast with a navigation affordance to every mutating action.** Apply plan → "12 files catalogued · **View session**"; register master → "Master bias added · **View in Calibration**"; create project → "IC 10 Test HOO created · **Open project**". Today all three end in silence (verified live; the only signal is a badge quietly changing). This single pattern fixes the majority of dead-ends found across J1–J3.
2. **[P1] After project create, land *in* the project, not on the list.** The wizard returns to `/projects` without selecting the new row. The natural next stage (link calibration, generate source views, launch tool) all lives in project detail — take the user there, optionally with a "next steps" strip (the per-state guidance copy in the lifecycle stepper is already good; surface it once on arrival).
3. **[P1] Make confirm→apply one visible pipeline.** "Confirm to inventory" secretly creates a plan that must be found via "Review plans (N)" and applied. Either apply-with-review inline (single overlay: review → approve → progress → done) or show a pending-plan chip on the item row. The current split reads as "my confirm did nothing."
4. **[P1] Unify the two plan overlays and show from→to.** `PlanApprovalOverlay` (inbox) shows DESTINATION but no source; `PlanReviewOverlay` (projects/archive) shows SOURCE PATH but no destination; they also clone each other's CSS (`merges-3.css:1117-1283`). One overlay component, columns Item · Action · From → To · Protection, plus per-item post-apply state and failure reason (`usePlanApplyProgress.ts:74-76` currently discards the `item_failed` payload — "3 failed" with no way to know which 3).
5. **[P1] Guard the bulk frame-type override.** It applied "light" to 5 heterogeneous files instantly, persisted, no undo, and stranded them behind metadata they can't have. Add a mismatch warning when the selection spans differing detected types, and an undo (or a "reset to detected" action).
6. **[P2] Explain "Apply failed after 0 applied, 0 failed."** The per-row Apply failed twice with that copy while "Apply all" succeeded on the same plan. Two code paths, one broken, neither explains itself. Route both through the same command and always render the error reason.
7. **[P2] On viewports: don't split into multiple windows yet — fix the vertical economy first.** The bottom-docked detail panel costs ~45% of height on every list page while Sessions shows 3 rows in the remaining space; at 1100×720 the Inbox detail's action zone falls below the fold (#553). Offer a right-side detail orientation on wide windows (the `ListPageLayout` already has side/bottom variants — currently cloned CSS, see T2-11) and keep bottom-dock for narrow. Multi-window ("Open view in new window" already exists as a palette action) is worth pursuing later for the Log panel and plan review only.
8. **[P3] Auto-selecting the adjacent item after an apply should announce itself** ("Next: (root) · 3 files") or simply not happen — silent context switches make users doubt their action.

## Topic 4 — Data panels (detail panes): structure, ergonomics, completeness

The shared `DetailPanel`/`PropertyTable` skeleton is right; what's on it isn't yet.

1. **[P1] Make the detail a *delta* of the row, not an echo.** SessionDetail restates 6 of 7 row columns; MasterDetail 5 of 9; TargetDetail shows the designation three times and the type three times. Meanwhile genuinely new fields sit unrendered in the DTOs: session `type` and `linked.calibration`; master `usedByProjectIds`, `createdAt`/`ageDays` (only gates a pill — never shown as "180 d old"); inbox `offset`, `setTempC`/`ccdTempC`, `raDeg`/`decDeg`, `readoutMode`, `focalLengthMm`, `missingMandatory` (the field that actually blocks confirm!). Rule: the panel shows what the row can't.
2. **[P1] Fix the value-vs-“unknown” rendering.** Six em-dashes each decorated with a "FITS" source pill makes the sessions panel look broken (the pill outweighs the value). A metadata-less master renders Gain 0 · Exposure 0s · Size 0 KB — zeros that are *wrong*, not empty. Render distinct "unresolved" chips for missing data, never fake zeros, and only show source pills when there is a value to attribute.
3. **[P1] Fix the Channels palette unit bug.** `CoverageBar` hardcodes an `h` suffix (`CoverageBar.tsx:26`) and receives `ch.totalFrames` (`ProjectDetail.tsx:561`) — "42h" for 42 frames. Add a unit prop; pass hours or label frames.
4. **[P1] Populate or drop the dead columns.** Projects Sources table: Integ is a hardcoded em-dash (`ProjectDetail.tsx:371-373`) while `exposure`+`frames` exist on the DTO; SOURCE shows raw UUIDs. Projects list Target column is permanently "—" (summary DTO lacks the field the detail already has). Targets list IMG TIME + SESSIONS are all "—" in the default catalog view — show them only under "My targets" or fold into one "Coverage" column.
5. **[P2] Archive detail: delete the Details section (100% duplicate) and show the audit fields that matter.** Every row of "Details" already appears in the table row or the subtitle. Meanwhile `AuditEntry.outcome` and `actor` — the two fields the constitution's audit story is *about* — are dropped (`ArchiveDetail.tsx:57-66`). The settings Audit Log pane proves the columns work; mirror them here, plus link `archivedViaPlanId` to the originating plan.
6. **[P2] One integration-time format.** "1h 30m" (Sessions) vs "1.5h" (Projects) for the same quantity — extract `formatIntegration()` into `@/lib/format` and use everywhere. Same for the row-vs-panel "—" vs "0.0 h" mismatch on Targets.
7. **[P2] Migrate TargetDetailV2 onto the shared DetailPanel** (it hand-rolls its own header/section vocabulary — the only panel that does) and remove its duplicated Projects list (rendered twice per panel, `TargetDetailV2.tsx:709-732` vs `859-882`; the Sessions twin was already removed with a comment saying why).
8. **[P3] Reclaim the empty panel bar.** Each bottom panel spends a ~30px bar on a lone ✕ — put the panel title + primary actions on that bar (Archive already does; Sessions/Targets don't — this is also consistency finding C-5 inverted).

## Topic 5 — The other panels (overlays, log, status bar, sidebar)

1. **[P1] Status bar: one meaning per word.** While Inbox is open it shows "50 masters" (detected candidates, page slot) and "0 masters" (registered, global slot) simultaneously. Rename the page slot ("50 master candidates") or drop it. Also normalize IMAGETYP before display — "Dark_flat 1 · Darkflat 6" as sibling categories is a parser leak in permanent chrome.
2. **[P2] Log panel: one name, richer lines, floor filters.** Button says "Log", panel says "Activity" — pick one. Lines read "target target resolve_batch completed" (source echoed in message; #583) and level filtering is exact-match instead of a severity floor (#582). The "— Follow" label looks like a placeholder; use a toggle with a state.
3. **[P2] Fix LogPanel entity links.** 3 of 5 entity types navigate to routes that don't exist (`LogPanel.tsx:62-77`: `/plans/:id`, `/settings?tab=catalogs`, `/audit` fallback) — silent redirect to Sessions. Point catalog→`/settings/catalogs`-equivalent pane path, audit→`/settings/audit`, and drop plan links until plans are deep-linkable.
4. **[P2] Data Sources cards → table or compact rows.** 22 roots × ~200px cards, each repeating the identical inheritance sentence and a 7-decimal ISO timestamp ("scanned 2026-07-11T09:42:02.2555817Z"), with 5 buttons per card (#562 tracks the kebab consolidation — endorse it). Humanize timestamps ("2 h ago"), state the inheritance sentence once at section level, and make "Unprotected" a visually loud warning chip — it's the single most dangerous per-source state and currently has the same weight as everything else.
5. **[P3] Toasts exist (`ToastContainer.tsx`) but nothing meaningful uses them** — after wiring Topic-3 suggestion 1, ensure toast variants use the semantic tokens and the new full-border style (T2-10).

## Topic 6 — Settings

Inventory: 12 panes / ~60 controls audited; layout kit (`SettingsSection`/`SettingsRow`, tooltip-for-help) is consistently applied in 9 of 12 panes.

1. **[P0] Advanced pane: remove the fiction.** "Export database" and "Reset preferences" are `console.log` no-ops (`Advanced.tsx:123-124`) — one of them styled as a danger-zone action. The Database panel hardcodes Size 24.8 MB / Schema v1.0 / "142,318 files · 22 sessions · 3 projects" (`en.json:612-616`) and a pre-rename `~/.alm/` path — rendered directly above a status bar saying "3 sessions · 0 projects". Wire real stats or delete the section; a settings pane that lies poisons trust in every other number in the app.
2. **[P1] Appearance: fix or remove Font Size, and make Density honest.** Font Size is pure local `useState` — resets every visit, affects nothing (#587). Density persists but only Targets consumes it (see T2-2). Also rebuild this pane on `SettingsSection`/`SettingsRow` (it hand-rolls markup and duplicates each label as both section title and row label — "FONT SIZE → Font Size" for one dropdown).
3. **[P1] Resolve the duplicate scan-behavior stores.** `sources.followSymlinks`/`hashOnScan` (invisible, only reachable via the per-source override widget) vs `IngestionSettings.followSymlinks`/`hashingMode` (visible toggles, documented as not yet read by the pipeline). Two "follow symlinks" concepts, neither authoritative. Pick Ingestion as canonical, delete the sources scope, and re-point "Restore defaults" (which today resets keys the user can't even see).
4. **[P1] Prune the orphaned contract.** ~20 backend settings keys have no UI: the entire dead `"calibration"` scope (9 keys superseded by `calibration.tolerances.*`), `sourceViews` link-kind keys (spec 049 T030 deferred — its stale `SourceViewStrategy.tsx` component isn't even wired in), `plans` age cutoff, `protectedCategories`, `rememberFollowLogs`. Build the deferred pane or delete the scopes; contract-vs-UI drift is how the next fabricated panel happens.
5. **[P2] Regroup the nav: Library (Data Sources, Equipment, Ingestion, Naming) · Targets (Resolution, Planner) · Processing (Tools, Matching, Cleanup) · Application (Appearance, Advanced, Audit Log).** Target Resolution/Planner share nothing with file-organization panes. Move the SIMBAD/OpenNGC Attribution block (zero controls) to an About surface.
6. **[P2] Input-type hygiene.** Lat/long/elevation are free-text with hand-rolled validation while every other numeric setting uses `type="number"` (`ObservingSites.tsx:296-395`); the timezone select lists ~400 IANA zones unfiltered (make it a searchable combobox); debounce/timeout units live in labels ("(ms)") while sibling panes use unit suffixes — pick the suffix convention; the Moon-avoidance grid burns ~83px per band on two unlabeled inputs — add per-column headers and compact rows; `NamingStructure.tsx:1004-1018` has the app's only raw checkbox — convert to `Toggle`+`SettingsRow`.
7. **[P2] Equipment: seed symmetry and a train nudge.** 10 pre-seeded filters next to "No cameras registered / No telescopes / No optical trains" reads as half-installed. Either seed nothing or add one-line teach-copy ("Register a camera so calibration matching can fingerprint your frames").
8. **[P3] Disable-with-reason for offline-dependent fields.** The SIMBAD debounce field stays editable when online resolution is off while endpoint/timeout grey out (`ResolverSettingsControl.tsx:151` vs `:132,172`).

## Persona red flags (condensed)

- **Alex (power user):** palette unstyled with dead routes; no list multi-select in Inbox; disabled buttons indistinguishable — three strikes on the efficiency path.
- **Sam (accessibility):** border-only input focus; "(root)" column defeats screen-reader scanning; Targets filter chips overflow at 1100px; state pills rely on hue.
- **The meticulous 2TB astrophotographer:** the audit log doesn't list plan applies (only lifecycle refusals appeared during testing) — "empty audit" is indistinguishable from "not recording"; the Unprotected badge whispers; the wizard review step shows a fabricated plan. These three are precisely the trust surface this product sells.

## Cross-reference with the manual journey campaign

Already tracked (this review adds root causes): #581 palette (root cause: no CSS defines `alm-palette*`), #587 density/font (root cause: only `.alm-targets-table` consumes the token), #556 "(root)" (root cause: `relativePath || '(root)'`, `InboxList.tsx:362` — fall back to root basename), #574 catalog count, #553/#554 inbox detail, #564 session metadata, #562 source cards, #579/#580 planner columns, #573 targets freeze, #557 render loop (plausibly underlies the renderer freeze J1 triggered with Ctrl+K over an open overlay — force-kill was required), #583/#582 log panel, #567 reveal path, #569/#552 commit-blind confirm, plus the setup-wizard batch (#491–#516).

New here (not found in issues): mock wizard steps 3/6; silent lifecycle refusals; archive 0-item dead-end; no-op Export/Reset + fabricated DB panel; two plan overlays that jointly never show from→to; per-item apply failures discarded; bulk-override no-undo; CoverageBar frames-as-hours; dead Integ/Target columns; Archive Details 100% duplicate; audit outcome/actor dropped in ArchiveDetail; the measured height/row/top-bar drift; sub-floor font sizes; accent≡primary; dead palette routes; broken LogPanel links; the ~20 orphaned settings keys; status-bar "masters" double meaning; Dark_flat/Darkflat leak; "Add to plan" disabled placeholder; target→wizard handoff loss.

## Suggested sequencing

1. Trust: T6-1 (Advanced fiction), T1-1 (mock wizard steps), T3-4 (from→to + per-item outcomes).
2. Feedback: T3-1/T3-2 (success toasts + land-in-project), T1-2 (surface refusals), T3-3 (confirm→apply pipeline).
3. Consistency: T2-1/T2-2 (control + row metrics), T2-3 (palette), T2-5/T2-6 (toolbar + counts).
4. Panels: T4-1/T4-2 (delta + unknown rendering), T4-3/T4-4 (unit bug + dead columns).
5. Settings: T6-2..T6-6.

Impeccable follow-ups: `$impeccable polish` (picks up this snapshot's backlog), `$impeccable layout` (Targets header + detail-panel economy), `$impeccable clarify` (refusal/error copy), `$impeccable harden` (empty/error/disabled states).

---

# Addendum (2026-07-11, second pass)

Follow-ups executed: PR #598 carries this report; 28 issues filed (#599–#631) + epic #632 + root-cause comments on #581/#587/#556; journeys doc extended with Touch & validate contracts and Journeys 11–16.

## AI-slop signal review

The theme layer is *not* slop — one accent, semantic tokens, no gradients, no card grids, no hero metrics. The slop signals live one level down, in the reflexes:

1. **Pill inflation — the strongest tell.** Pills currently encode: workflow states, frame types, file formats, target types, catalog aliases, "FITS" source provenance, "Manual" equipment provenance, Protected/Unprotected, "Inherits global default", lifecycle states, Default/Active site tags, tool availability, aging warnings, and 7 filter chips per Targets row × 11,390 rows. When every fact wears the same rounded capsule, the capsule stops meaning anything — and the one pill that must stop a user cold ("Unprotected") has the same visual weight as "Manual". Fix with a taxonomy: pills for *state only* (color-coded, ≤1–2 per row); plain text for identity/category; small icon+tooltip for provenance; never pill a value that is the column's own subject ("Galaxy" 11,390 times).
2. **Em-dash as the universal placeholder.** "—" currently means unresolved-metadata, not-yet-computed, not-applicable-by-design, and genuinely-empty — four semantics, one glyph. Generated UIs do this because binding `?? '—'` is free. Distinct affordances per meaning (unresolved chip / "stub" disclosure / structural omission / true empty).
3. **Regenerate-rather-than-reuse duplicates.** Two plan overlays, two page-shell families (Settings vs list pages), `accent`≡`primary`, two empty-state systems, cloned panel-bar/modal-header CSS with comments admitting the clone. This is the classic parallel-implementation tell; the house rule (one parameterised component) already forbids it.
4. **Uniform decoration instead of information-bearing variation.** "LOW" + dot rendered on every visible Targets row; source pills attached to em-dashes; full section chrome (uppercase header + rule) around single dropdowns (FONT SIZE, DISPLAY DENSITY). Decoration applied by template, not by signal.
5. **Raw data leaks.** ISO timestamps with 7 decimal places, "(root)", raw UUIDs in a user-facing table, "Dark_flat"/"Darkflat" as sibling categories, SIMBAD OID as a first-class fact. The bind-whatever-the-API-returns tell.
6. **Button-placement drift.** Selected-item actions live in the detail header on Sessions/Calibration/Projects but in the top bar on Archive; the page CTA is top-right primary on Projects, mid-bar neutral on Targets, and two simultaneous accent CTAs on Inbox; the wizard's forward action lives in the right rail while Cancel/Save-draft live top-right. Pick one home per role (page CTA: top-right primary; selection actions: detail header; wizard progression: bottom-right of the form column) and enforce it in the PageTopBar doc-comment that already states the rule.
7. **Detector-level tells** (4 toast left-stripes, 3 layout-property transitions) — small, fix mechanically.

Not slop, worth saying: the wizard's footprint card, the protection-acknowledgement gate, the calibration-matching explanation panel, and the per-state lifecycle guidance copy are all *earned* product furniture — keep them.

## Viewport strategy (after the vertical-economy fix)

Ground truth for this product's desk: PixInsight occupies the primary monitor during processing; PlateVault typically lives on a secondary display or shares a monitor — design for a 1200–1600px window as the common case, not 2867px full-screen.

1. **Phase 0 — economy (prerequisite, already issue-tracked):** side-dockable detail panel, density token adopted by all tables, Targets header collapsed to one band, settings content max-width so 2560px doesn't render a 60%-dead pane.
2. **Phase 1 — adaptive dock:** detail panel docks right when window ≥ ~1500px logical, bottom below; user-overridable per page, persisted, with a drag-resizable split. This alone makes the list+detail pattern work at every size the app actually runs at.
3. **Phase 2 — pop-out windows for monitoring surfaces (highest multi-window value, lowest complexity):** Activity log and plan-apply progress as independent OS windows ("Open view in new window" already exists as a palette action). The user approves/monitors a long apply on one screen while browsing the library on another. Same candidate: a compact "Tonight" planner strip for capture nights (always-on-top, ~360×640).
4. **Phase 3 — don't do generalized multi-window workspaces.** Per-project multi-window adds session-management complexity the audience doesn't need; the single main window + two pop-outs covers the real desk. Revisit only if Phase 2 telemetry shows people juggling both pop-outs constantly.

---

# Second addendum (2026-07-12): untouched-controls discovery sweeps

Three serial interactive sweeps drove the live Windows build
(`redesign-ui-platevault` @ `8097d9c6`) over the Tauri MCP bridge, covering
every interactive control the journey campaign had not touched. Result:
**32 new issues (#639–#670**, label `spec-030`, epic #632), 17 existing
issues re-confirmed with fresh evidence, and one existing issue refuted.

## Sweep A — Settings (all 12 panes)

Issues: #639 (Calibration Matching pane persists nothing — payload/contract
type mismatch, P1), #640 (ConfirmOverlay confirm dialogs unstyled app-wide,
P1), #641 (Cleanup per-type overrides write but can never be read back,
P1), #645 (Default Catalogues toggles dead, P1), #646 (per-source override
widget invalid values for 2/3 keys; write-only), #647 (durable audit log
misses EventBus-only action classes), #655 (naming preview casing mismatch
→ `frame_type` renders "unknown" on the default pattern), #656 (path edit
silently re-enables a disabled tool), #657 (protection override
irreversible — no inherit-clear command), #659 (equipment duplicate
names/aliases accepted silently), #661 (train-form error text = bare field
label), #662 (no manual path entry anywhere — DirPicker native-picker-only).

**#558 refuted** on this build: Disable → confirm → `sources_set_active` →
card/backend agree, Enable restores. Recommend closing #558.

## Sweep B — Inbox / Sessions / Calibration

Issues: #642 (MasterDetail "Use in project" / "Replace master" / Reveal
have no onClick at all, P1), #643 (per-file metadata intermittently never
loads — Confirm gate silently enabled on items the backend would refuse,
P1), #644 (positional selection: detail swaps identity when search
changes), #648 (destination-root pick leaks across items and shows "Auto"
while a stale root stays armed), #649 (Format column sorts by hidden format
tag), #650 (Sessions linked-project chip drops the project id), #651
(Sessions reveal opens the source root, not the session folder), #652
(session count: chrome 3 vs table 4), #653 (list/detail file-count
disagreement), #654 (indistinguishable "Session — date" rows).

## Sweep C — Targets / Projects / palette / log panel

Issues: #658 (target detail mutations never refresh the list — user
aliases unsearchable, labels don't propagate), #660 (project Edit pane
hijacks the whole window; no dialog semantics, no Escape), #663 (project
Sources render raw session UUIDs), #664 (raw code
`match.observer_location_missing` leaks — backend prefix vs frontend bare
switch), #665 (manifests never generated: only the workflow-run subscriber
is wired), #666 (log category/source filter has state but no UI), #667
(Activity export dialog titled "Export Audit Log"), #668 (activity log
drowned by periodic internal events), #669 (filtered-empty vs truly-empty
states indistinguishable — Calibration search + log panel), #670
(cosmetics batch: stepper enum literals, "1 targets" plural, source-view
dialog styling, mixed path separators, duplicated empty-state copy).

## Fresh evidence for existing issues (comments pending)

Posting comments on pre-existing issues was denied by session permission
policy, so the evidence is recorded here:

- **#556** — "(root)" in ~100+ root-level Detection cells (InboxList.tsx:362).
- **#557** — still live: ~1,458 console lines/10 min and 3,122 errors/90 min
  idle on Inbox; user-facing consequence tracked in #643.
- **#581** — palette still completely unstyled (zero `.alm-palette` rules);
  functionality intact incl. "Open view in new window".
- **#587** — nuance: density persists and sets `--alm-row-height`, but only
  the Targets table rows + wizard steps consume it; font-size is fully dead
  (component-local state).
- **#601 / #602** — confirmed live (console.log no-ops; static DB info panel).
- **#603** — 0-item archive plan offered for "Approve & apply" with no
  explanation; no toast after Discard.
- **#604** — new members: Rescan, override Set, Re-detect, Restart guided
  flow, silent audit-export download.
- **#612** — re-confirmed via "+ New project here": wizard opens with no
  target fact.
- **#617** — palette still lists dead routes `/review` `/plans` `/audit`;
  not-found fallback silently bounces to index (router.tsx:298).
- **#620** — new members: SessionDetail FITS pills on em-dash values;
  MasterDetail fake zeros ("Gain 0 / 0s / 0 KB").
- **#623 / #624** — confirmed; reset-key lists enumerated in the sweep.
- **#625** — status bar shows "Dark_flat 1 · Darkflat 6" simultaneously
  (bucketKey lowercases only; inboxStatsFromItems.ts:29).
- **#626** — per-kind: project rows land unselected; plan rows land on
  Sessions via `/plans/<id>` → not-found; target rows have no link at all.
- **#628** — extended: disabled inputs indistinguishable (endpoint/timeout);
  "Apply remap" and "Apply selected (0)" disabled-but-primary.
- **#631** — new members: raw 7-digit-fraction ISO timestamps on source
  cards; MastersTable missing the grouped-by hint footer; History dates via
  `toLocaleDateString()`.

## Journey coverage updates

`docs/product/user-journeys.md` extended with sweep-derived Touch &
validate items on Journeys 2, 5, 8, 9, 10, 13, 15, 16, plus a new
**Journey 17 — Software update & install** (spec 051). Notable new
contracts: a metadata-load failure must disable Confirm (J2);
identity-based (never positional) selection (J2); every manifest reason
appends a snapshot (J5); source views produce reviewable plans (J5);
rendered-but-handlerless buttons fail the run (J8); list freshness after
identity edits (J9); filtered-empty must read differently from truly-empty
(J8/J13).

## Driving-mechanics updates (supersede part of the 2026-07-11 handover)

- WSL runs in **mirrored** networking mode now: the bridge host is
  `127.0.0.1:9223`. `172.20.10.1` is the LAN router today, not the Windows
  host.
- Synthetic hotkey `KeyboardEvent`s must be dispatched on `document.body` —
  tinykeys crashes on `window`/`document` targets.
- Never `WM_CLOSE` unfiltered top-level HWNDs of the app process: WebView2
  hosts enumerate as top-level and closing one kills the renderer.
