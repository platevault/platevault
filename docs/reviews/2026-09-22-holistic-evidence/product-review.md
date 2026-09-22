# Product/workflow review — wave one

Model identity exposed by harness: `openai-codex/gpt-6-astra`. The requested `@max` role is not independently exposed for verification. Read-only source inspection; no tests, builds, linters, servers, database operations, user-data access or writes performed.

## Assessment and feature matrix

“Implemented” below means a reachable source path with concrete handlers/contracts, not runtime certification. “Partial” means a specific observed gap. “Planned” is used only where documentation explicitly defers scope. The inspected file inventory is supplied in `files`.

| Area | Status | Reachable evidence and limits |
|---|---|---|
| Ingestion | Implemented core; full format coverage unknown | `/inbox` is registered at `apps/desktop/src/app/router.tsx:76-92`. Single confirmation sends classification/signature/destination information; attribution and destination recovery are explicit in `apps/desktop/src/features/inbox/useInboxConfirmFlow.ts:160-236,253-305,349-385`. Setup persists real tool configuration and first-run completion (`apps/desktop/src/features/setup/SetupWizard.tsx:488-523`). Not a claim that every format, watcher or brownfield migration works. |
| Sessions | Implemented inventory; partial deep-link behavior | Real inventory response drives searchable/groupable sessions, per-kind backend filtering and connectivity-gated reveal (`apps/desktop/src/features/sessions/SessionsPage.tsx:101-231`). Non-light deep links have the defect in PROD-07. Split/merge and manual session editing were not exhaustively traced. |
| Calibration | Implemented master browsing and project matching surfaces | Master inventory/search/grouping mounts `MasterDetail` (`apps/desktop/src/features/calibration/CalibrationPage.tsx:60-226`). Project detail mounts `CalibrationMatchPanel` for selected source IDs (`apps/desktop/src/features/projects/ProjectBottomDetail.tsx:71-88`). Master archive retry wiring exists (`apps/desktop/src/features/calibration/MasterDetail.tsx:259-260`). Matching algorithms and numerical correctness belong outside this slice. |
| Targets | Implemented catalog/detail linkage; partial cross-page visibility | Detail loads canonical identity, linked sessions/projects, notes, aliases and tonight data; New project passes a real target ID (`apps/desktop/src/features/targets/TargetDetail.tsx:95-161,256-278`). Projects list discards target visibility (PROD-06). Observing-plan file attachment was not established: unknown, not reported absent. |
| Projects | Implemented creation/edit/lifecycle/tool-launch surfaces; partial output workflow | Wizard route exists (`apps/desktop/src/app/router.tsx:175-187`); detail offers edit, launch and lifecycle controls (`apps/desktop/src/features/projects/ProjectDetail.tsx:194-259`). Plan-required transitions open actual generation/review flows (`apps/desktop/src/features/projects/useProjectDetailActions.ts:108-201`). Output acceptance/verification is not connected (PROD-05). |
| Source views | Implemented management workflow | Generate dialog, removal, regeneration, verification and retry all reach handlers and shared review (`apps/desktop/src/features/projects/SourceViewsSection.tsx:76-211`). Verify/readiness across actual filesystem/link capabilities remains untested. |
| Manifests | Implemented generation/read/reveal; partial live history | Creation finalizer writes a manifest (`crates/app/core/src/plan_apply/finalizers.rs:18-43`); source add/remove trigger new snapshots (`crates/app/projects/src/project_setup/sources.rs:140,257`). UI lists/expands/reveals snapshots (`apps/desktop/src/features/projects/ManifestsAccordion.tsx:55-120`). Same-project live refresh is missing (PROD-08). |
| Cleanup/archive | Partial | Project cleanup scan → generated plan → review is real (`apps/desktop/src/features/projects/OutputsCleanupSections.tsx:218-397`); project archive and project/master restore are connected (`apps/desktop/src/features/projects/useProjectDetailActions.ts:162-177`; `apps/desktop/src/features/archive/store.ts:65-76`). Archive disposal bypasses equivalent review and has outcome gaps (PROD-01–03). A global cross-library cleanup sweep was not established. |
| Settings/onboarding | Implemented surfaces; complete behavioral coverage unknown | Settings registers sources/equipment/ingestion/naming/tools/calibration/resolver/planner/framing/cleanup/source views/general/advanced/audit (`apps/desktop/src/features/settings/SettingsPage.tsx:41-177`). Setup has surfaced completion errors and durable first-run completion; onboarding derives per-page checklist state (`apps/desktop/src/features/setup/SetupWizard.tsx:457-530`; `apps/desktop/src/features/onboarding/useChecklistGroups.ts:47-97`). No claim of complete localization, accessibility or migration correctness. |
| Tool interoperability | Implemented configuration/launch boundary; planetary/lunar scope planned or unclear | Real tool profile list/update/validate/discover calls exist (`apps/desktop/src/features/settings/ProcessingTools.tsx:39-173`); Rust explicitly separates process launch from image processing (`crates/app/core/src/tool_launch.rs:4-22,44-55`). DTO vocabulary contains PixInsight, Siril and Planetary Suite (`crates/contracts/core/src/projects_v2.rs:68-95`), but an enum is not proof of a shipped planetary workflow. Later spec explicitly defers planetary/lunar tools (`specs/030-ui-audit-revision/spec.md:508-509`). |

## Concrete strengths

- Core project operations are not merely attractive inactive controls: source-view generation/removal/regeneration opens an actual shared plan overlay and routes newly generated retry plans back into review (`apps/desktop/src/features/projects/SourceViewsSection.tsx:114-211`).
- The common plan surface exposes item destinations, protection, materialization kind and durable outcomes, and supports reopen/cancel/resume/retry rather than treating every failure as terminal (`apps/desktop/src/features/plans/PlanReviewOverlay.tsx:98-136,233-247,330-433`).
- Archive restore is implemented for both projects and calibration masters, with entity-specific backend routing and query invalidation (`apps/desktop/src/features/archive/store.ts:65-76`; `apps/desktop/src/features/archive/ArchivePage.tsx:137-170`). This is counterevidence to a blanket claim that archival has no recovery path.
- Target-to-project creation preserves the canonical target ID; detail DTOs expose canonical identity, rather than fabricating labels (`apps/desktop/src/features/targets/TargetDetail.tsx:256-278`; `crates/contracts/core/src/projects_v2.rs:184-189`).
- Tool configuration uses real persisted settings and validation; failed enable toggles revert optimistic state (`apps/desktop/src/features/settings/ProcessingTools.tsx:110-141`).
- Source data connectivity is considered before offering filesystem reveal, avoiding a misleading actionable control for known-offline roots (`apps/desktop/src/features/sessions/SessionsPage.tsx:213-231`).

## Findings

### PROD-01 — P1 — High confidence — Defect: archive disposal bypasses review of the new destructive action

**Evidence:** `README.md:8-9,35-37` promises reviewed plans for filesystem changes; `specs/030-ui-audit-revision/spec.md:333-335` specifically requires plan rules for Archive deletion. `apps/desktop/src/features/archive/ArchivePage.tsx:124-127,192-196,237-248` directly submits trash/delete mutations. `apps/desktop/src/features/archive/store.ts:39-48` invokes archive commands without generating a new plan. `crates/app/core/src/plans/archive.rs:125-167,216-285` executes trash/delete on paths taken from the previous archive plan.

**Causal trace / proposed reproducer:** Archive a project normally. Select its Archive row and click Send to trash. The handler immediately executes disposal; there is no review of current file actions/destinations. Permanent deletion adds a typed DELETE modal but still has no new itemized plan/approval. The old plan approved moving files into archive, not removing them from it.

**Impact:** The product's defining safety promise does not cover a prominently exposed destructive workflow. The user cannot review the current affected file set or a new action's preconditions before disposal.

**Counterevidence:** Permanent deletion does require exact confirmation text and respects the global block setting (`crates/app/core/src/plans/archive.rs:223-242`); path containment exists. This is not a claim that arbitrary paths can be deleted, nor that deletion has no confirmation whatsoever.

**Recommended fix:** Generate disposal plans with explicit trash/delete actions and route them through the existing review/approval executor. Preserve the permanent-delete policy and typed gate.

**Verification still needed:** Disposable archive fixture; assert no file changes before plan approval, current item set is visible, cancellation changes nothing, and policy refusal survives IPC-level calls.

### PROD-02 — P1 — High confidence — Defect: mixed archive-disposal failures are reduced to success counts

**Evidence:** `crates/app/core/src/plans/archive.rs:147-191` stores only `last_failure`, emits a warning for failed items, and returns an error only when `items_moved == 0`. Permanent deletion repeats the same pattern at `crates/app/core/src/plans/archive.rs:261-309`. The event contains plan ID and success count, not failed-item outcomes. `README.md:38-39` promises reconstruction including failed actions and reasons.

**Causal trace / proposed reproducer:** Use an archive containing two files; allow one disposal and make the other fail with a permission or trash-provider error. At least one success suppresses the failure return. The result does not tell the user which archived file remains or why. On all-failed runs, the code returns before publishing its success event; the observed logging path is not a durable per-item action record.

**Impact:** Partial destructive operations cannot be reliably understood or retried from the product's result. The full-audit claim is stronger than this path supports.

**Counterevidence:** Success counts are based on real filesystem outcomes, and total failure is correctly returned as an error. This finding concerns loss of partial-failure detail, not fabricated counts. Broader event subscribers were not exhaustively audited; no claim that every external log loses the warning.

**Recommended fix:** Use per-item persisted outcomes in the common executor, or minimally return/persist every success, failure and skipped item and mark partial completion explicitly.

**Verification still needed:** Mixed success/failure, all-failure and repeated-disposal scenarios; inspect durable user-visible records after restart and verify retry targets only remaining failed items.

### PROD-03 — P2 — High confidence — Defect: archive trash/delete errors have no user-facing recovery state

**Evidence:** `apps/desktop/src/features/archive/ArchivePage.tsx:124-127,192-196,274-368` submits mutations but never renders their error states. Hooks in `apps/desktop/src/features/archive/store.ts:117-140` only invalidate on success. `apps/desktop/src/data/queryClient.ts:15-25` has no global mutation-error handler.

**Causal trace / proposed reproducer:** Block permanent deletion in settings, or have the OS reject trash. Submit from Archive. Backend rejects; pending state ends, but neither page nor store displays the reason. For permanent delete the modal stays open without explaining what must change.

**Impact:** Users cannot distinguish policy refusal, unavailable trash, permission failure or a no-op. Repeated clicks are the only obvious response.

**Recommended fix:** Show typed/localized mutation errors next to the action/modal, with recoverable next steps and an explicit retry path. Also show success/partial outcomes; do not rely only on invalidating an unchanged archive list.

**Verification still needed:** Exercise blocked policy, missing archive file, permission-denied and trash-unavailable errors and confirm each is visible and actionable.

### PROD-04 — P1 — High confidence — Defect: interrupted-plan retry is generated but not opened by the recovery banner

**Evidence:** The banner is live in `apps/desktop/src/app/Shell.tsx:163-165`. `apps/desktop/src/features/recovery/RecoveryBanner.tsx:59-79` opens the first interrupted plan and passes only close/applied callbacks. `apps/desktop/src/features/plans/PlanReviewOverlay.tsx:390-421` creates a new retry plan then delegates navigation solely through optional `onRetryCreated`. Normal source-view/archive flows provide that callback (`apps/desktop/src/features/projects/SourceViewsSection.tsx:202-211`; `apps/desktop/src/features/archive/ArchivePage.tsx:356-365`).

**Causal trace / proposed reproducer:** Restart into an interrupted plan that becomes failed/partially applied; open it from the banner and choose Generate retry plan. The command creates a new draft and reports success, but the callback is absent, so the overlay remains bound to the old plan. The banner keeps opening its first original ID. It also lacks `onDiscarded`, so discarding the first item does not advance the queue.

**Impact:** The dedicated disaster-recovery entry point strands a recoverable operation and can obstruct later interrupted plans. There is no standalone Plans route in `apps/desktop/src/app/router.tsx:288-309` to compensate.

**Recommended fix:** Track original interrupted ID separately from the active retry-plan ID. Supply retry and discard callbacks, advance/remove the original queue entry after successful completion or intentional discard, and offer selection/skip for multiple interrupted plans.

**Verification still needed:** Two interrupted plans; partial failure → retry generation → successful retry; discard first; close/reopen; confirm no orphan draft or stale queue head.

### PROD-05 — P2 — High confidence — Opportunity plus documentation defect: output tracking is promised but the reachable section is permanently empty

**Evidence:** `README.md:31-32` promises lifecycle through output tracking; original requirement `specs/001-astro-library-manager/spec.md:430-433` includes outputs/final verification. `apps/desktop/src/features/projects/ProjectBottomDetail.tsx:107-109` always mounts `OutputsSection` without output data. Its default is `[]` and the empty state is the only live path (`apps/desktop/src/features/projects/OutputsCleanupSections.tsx:47-75,103-105`). `crates/contracts/core/src/projects_v2.rs:172-202` has no accepted-output projection.

**Causal trace / proposed reproducer:** Create a project, prepare inputs, run the external processor and produce a final output. Reopen the project: the accepted-output section still receives no data and provides no acceptance/verification operation.

**Impact:** The user cannot complete the advertised output-tracking loop or record which deliverable was accepted before cleanup. No claim is made that cleanup currently deletes unregistered outputs.

**Counterevidence / scope distinction:** Later spec explicitly removes Record output and says processing outputs are not managed (`specs/030-ui-audit-revision/spec.md:1154,1324`). Observed processing artifacts and launch history do exist. Therefore implementing full output management is a product decision, not automatically a regression fix; the established defect is contradictory shipping documentation and a section users cannot populate.

**Recommended fix:** Resolve scope first. Either expose a small accepted-output registry with verification/protection and manifest linkage, or remove the unfulfillable output-tracking promise/placeholder and describe artifact observation accurately.

**Verification still needed:** Chosen contract: either accept/verify/persist/reopen a real output and observe protection, or check all shipping docs/UI avoid claiming output management.

### PROD-06 — P2 — High confidence — Defect: Projects target column stays blank even when the project has a canonical target

**Evidence:** `apps/desktop/src/features/projects/ProjectsTable.tsx:97-98,260-262` sorts target as constant null and renders a literal em dash. `crates/contracts/core/src/projects_v2.rs:144-167` excludes target identity from list DTO, while detail includes it at `:184-189`. Target-originating project creation passes the real ID (`apps/desktop/src/features/targets/TargetDetail.tsx:256-278`).

**Causal trace / proposed reproducer:** Create a project from a known target. Its detail can display canonical target identity, but the Projects list shows no target and target sorting cannot reorder meaningfully.

**Impact:** Users cannot scan their processing library by its central astronomical subject; the table incorrectly suggests unresolved target metadata despite an established relationship.

**Recommended fix:** Add the canonical target's ID/display label to the existing list projection and use it consistently for rendering and sorting. Do not introduce per-row detail fetches.

**Verification still needed:** Linked and unlinked projects, renamed target aliases, mixed-label sorting and return from target-originated creation.

### PROD-07 — P2 — High confidence — Defect: session frame-filter links are accepted then ignored

**Evidence:** `apps/desktop/src/app/router.tsx:49-56` validates `frameFilter`. `apps/desktop/src/features/sessions/SessionsPage.tsx:102-117` reads only selected/sourceFilter and initializes kind to light; `:134-138` sends that local kind to inventory. Selected IDs are searched only in the resulting filtered response and cleared as stale (`:165-168,186-201`).

**Causal trace / proposed reproducer:** Open `#/sessions?frameFilter=dark&selected=<existing-dark-session-id>`. The route accepts the filter but the page requests light sessions, cannot find the selected dark session, and clears the selection. A cold `/sessions/<dark-id>` link has the same default-kind problem.

**Impact:** Shareable navigation to non-light sessions does not preserve user intent; valid records appear absent on reload or cross-page navigation.

**Recommended fix:** Make the URL kind filter the single source of truth and update it from the control. For ID-only deep links, resolve the selected session independently or infer its kind before applying stale-selection cleanup.

**Verification still needed:** Direct/reloaded dark/flat/bias links, back/forward navigation, switching filters and genuinely removed session IDs.

### PROD-08 — P2 — High confidence — Defect: manifest history does not refresh after same-project source changes

**Evidence:** `apps/desktop/src/features/projects/ManifestsAccordion.tsx:55-80` fetches its list only on mount or `projectId` change, stores it in component state, and has no refresh subscription/control. Source add/remove writes new snapshots at `crates/app/projects/src/project_setup/sources.rs:140,257`, through `crates/app/projects/src/project_setup/mod.rs:337-350`. `apps/desktop/src/features/projects/ProjectsPage.tsx:232-238` keeps the same operational component mounted for the selected project.

**Causal trace / proposed reproducer:** Open a project's manifest history, edit its source selection successfully, return to the same detail without deselecting. Backend has generated a new source-change manifest but the accordion keeps its old array until remount/project change.

**Impact:** The visible provenance history lags the action the user just completed, undermining confidence that the new selection has been documented.

**Counterevidence:** Generation itself is wired and the new snapshot should appear after remount; this is stale presentation, not absence of manifests.

**Recommended fix:** Put manifest lists on the existing query/event invalidation path or pass an explicit revision signal after relevant mutations; retain a retry/refresh affordance for fetch failure.

**Verification still needed:** Source add/remove while detail remains mounted, failed manifest write, initial load failure/retry, and rapid project selection changes.

## Product ideas, separately from defects

1. **Accepted deliverable tracking:** Highest-value missing capability if output management remains a product goal (PROD-05). Keep it limited to registration, user verification and protection; do not build image processing.
2. **Persistent contextual plan history:** The common overlay explicitly says there is no standalone Plans list (`apps/desktop/src/features/plans/PlanReviewOverlay.tsx:390-392`). A project/source-scoped history with resumable drafts and failures would avoid depending on transient modal state, while preserving the intentional removal of top-level Plans navigation.
3. **Cross-library cleanup readiness:** PRODUCT.md asks for a global sweep, while the inspected reachable cleanup path is project-local. Investigate whether existing backend candidate queries can support a global review queue. Its absence is not conclusively established here; treat this as discovery work, not a bug assertion.
4. **Published workflow capability table:** Clarify supported tool/profile/operation combinations. A Planetary Suite enum and historic broad product scope do not establish a complete planetary handoff; later specs explicitly defer it.

## Prioritized roadmap

1. **Safety and recovery:** PROD-01 and PROD-02 together: reuse the existing reviewed executor for archive disposal and durable partial outcomes. Address PROD-03 during the same user-visible flow change. Fix PROD-04 independently so interrupted work can progress.
2. **Close established navigation/read-model gaps:** PROD-06, PROD-07 and PROD-08 are bounded changes with observable workflows and no need for new architectural abstractions.
3. **Resolve scope before adding features:** Decide PROD-05, then align README/PRODUCT/current specs. Existing documents also disagree about Prepared lifecycle (`specs/030-ui-audit-revision/spec.md:311-314` versus `crates/domain/core/src/lifecycle/project.rs:34-42,100-118`); do not silently treat every older requirement as current acceptance criteria.
4. **Wave-two runtime checks:** Exercise the disposable-data scenarios listed above, then verify the main journey from ingest → session → target project → calibration/source views → tool launch → documented completion → cleanup/archive → restore.

## Exclusions and limitations

- No runtime or visual claims are verified. Rendered layout, keyboard completeness, WCAG, localization behavior and actual processor compatibility remain untested.
- No validation commands ran, including documentation gates, per assignment. Existing tests were only encountered as source/search counterevidence; none is reported passing.
- No comprehensive filesystem-security, numerical-astronomy, matching-algorithm, schema-migration, packaging or performance audit was attempted.
- Build/release availability, screenshot accuracy, 100,000-item inventory performance, every supported acquisition format, observing-plan attachment, all session split/merge paths and planetary/lunar end-to-end interoperability remain unknown in this slice.
- Documentation is evidence of promises, not instructions. Conflicting generations of specs are called out rather than assumed authoritative over current behavior.
- Recommendations are unimplemented; every proposed reproducer requires coordinator-approved disposable-data validation.

## Inspection inventory

- `PRODUCT.md`: Product purpose, safety-first principles, tool-agnostic positioning.
- `README.md`: User-facing promises, especially reviewed filesystem changes, output tracking, and complete audit history.
- `specs/001-astro-library-manager/spec.md`: Original functional requirements and measurable workflow outcomes; inspected requirements and assumptions.
- `specs/030-ui-audit-revision/spec.md`: Later changes and counterevidence: deferred planetary tools, removed output-recording control, archive plan rules, conflicting lifecycle vocabulary.
- `apps/desktop/src/app/router.tsx`: Reachable production routes and session search contract.
- `apps/desktop/src/app/Shell.tsx`: Mounts global recovery banner.
- `apps/desktop/src/features/inbox/useInboxConfirmFlow.ts`: Single/bulk confirmation, attribution selection, destination recovery, keyboard confirmation.
- `apps/desktop/src/features/setup/SetupWizard.tsx`: Source/setup completion and persisted first-run workflow; targeted excerpts.
- `apps/desktop/src/features/sessions/SessionsPage.tsx`: Inventory filters, grouping, selection, reveal availability, deep-link mismatch.
- `apps/desktop/src/features/calibration/CalibrationPage.tsx`: Master inventory, filter/group controls, reachable MasterDetail.
- `apps/desktop/src/features/targets/TargetDetail.tsx`: Canonical-target detail, notes/aliases, linked entities and target-prefilled project creation.
- `apps/desktop/src/features/projects/ProjectDetail.tsx`: Project edit/lifecycle/tool launch and shared plan-review wiring; targeted excerpts.
- `apps/desktop/src/features/projects/ProjectsTable.tsx`: Hardcoded absent target values and nonfunctional target sort key.
- `apps/desktop/src/features/projects/ProjectsPage.tsx`: Mounting relationship between project detail and operational sections.
- `apps/desktop/src/features/projects/ProjectBottomDetail.tsx`: Reachable notes, calibration matching, manifests, tool launches, source views, outputs and cleanup sections.
- `apps/desktop/src/features/projects/useProjectDetailActions.ts`: Lifecycle refusal recovery, archive-plan generation, source-view plan handoff.
- `apps/desktop/src/features/projects/OutputsCleanupSections.tsx`: Output placeholder versus functional cleanup scan/generate/review flow.
- `apps/desktop/src/features/projects/SourceViewsSection.tsx`: Generate, verify, remove, regenerate and retry-plan handoffs.
- `apps/desktop/src/features/projects/ManifestsAccordion.tsx`: Manifest listing, body loading and OS reveal; mount-only refresh.
- `apps/desktop/src/features/plans/PlanReviewOverlay.tsx`: Protection/destructive gates, plan outcomes, resume, reopen and retry behavior.
- `apps/desktop/src/features/recovery/RecoveryBanner.tsx`: Interrupted-plan entry point and missing retry/discard continuation.
- `apps/desktop/src/features/archive/ArchivePage.tsx`: Archive restore, immediate trash and permanent-delete modal.
- `apps/desktop/src/features/archive/store.ts`: Archive IPC mutations, invalidation, absent mutation-error presentation.
- `apps/desktop/src/features/settings/SettingsPage.tsx`: Configuration pane registry and reachable settings areas.
- `apps/desktop/src/features/settings/ProcessingTools.tsx`: Real profile listing, executable validation, discovery and enabled-state updates.
- `apps/desktop/src/features/onboarding/useChecklistGroups.ts`: Page-contextual checklist grouping and completion state.
- `apps/desktop/src/data/queryClient.ts`: Confirms no global mutation error handler compensates for Archive omissions.
- `crates/contracts/core/src/projects_v2.rs`: Project list/detail contracts, canonical target detail support, tool vocabulary, missing accepted-output projection.
- `crates/domain/core/src/lifecycle/project.rs`: Current project lifecycle including Prepared, contrasting later UI spec.
- `crates/app/core/src/plans/archive.rs`: Direct archived-file trash/delete execution and partial-failure reporting.
- `crates/app/core/src/plan_apply/finalizers.rs`: Automatic manifest generation after project-create plan application.
- `crates/app/projects/src/project_setup/mod.rs`: Source-change manifest generation and project readiness helpers.
- `crates/app/projects/src/project_setup/sources.rs`: Actual source-add/remove manifest trigger callsites.
- `crates/app/core/src/tool_launch.rs`: Tool launch boundary, durable launch records and executable configuration.
