## Objective

Implement the full PlateVault rebuild backend against specs 064 through 072. Selectively reuse verified original functionality and place reusable functionality in skymath, simbad-resolver, target-match, fits-header or xisf-header where appropriate. After backend functionality and contracts are verified, build a clean-slate frontend proof of concept.

## Success criteria

- Every non-deferred backend requirement has real implementation and consumer-visible integration evidence: target catalogs/resolution, grouping and metadata, calibration inventory/matching, Projects/Views, exact handoff, Results, storage operations and planning/reminders.
- Workspace tests and applicable contract tests pass. Original image files remain protected.
- Development builds include a fully functional Tauri MCP bridge that controls the real app. This is the mandatory means of application verification.
- Every PR has independent review and an exact-head Sniff audit.
- Production MCP shipping is an optional future feature, not a completion requirement.

## Verification

- Run `cargo test --workspace` plus each active spec's real generated or public FITS/XISF integration and restart/recovery scenarios.
- Run the frontend's applicable typecheck/build checks.
- Exercise implemented workflows in the real development Tauri app through its MCP bridge. Native-UI-only evidence does not substitute for mandatory MCP verification.
- Never weaken tests or verification assets to pass.

## Boundaries

- Work one implementation spec at a time. Fan out independent major tasks within it using task agents and linked worktrees.
- Conservative product defaults and human specification-gate waivers are authorized for this run.
- Reviewed PlateVault PRs may merge. Reviewed changes in skymath, simbad-resolver, target-match, fits-header and xisf-header may merge and release.
- All existing application databases may be reset because there is no real catalog. Generate FITS/XISF fixtures or use public samples.
- Preserve real image libraries, credentials and unrelated work.
- Frontend work must use impeccable, improve-ui, ui-microcopy, ui-review, ui-skills-root, modern-web-guidance, web-design-guidelines, web-quality-audit and ss-a11y. Use shadcn-ui only if shadcn is selected.
- Native isolation stays disabled. Repository work uses linked worktrees.
- Production MCP, if separately implemented, requires authenticated safe enablement/password/interface/port configuration. Never expose unauthenticated development control in production.

## Stop conditions

- No global time limit.
- After five failed fix attempts per issue, defer it with reproducible evidence in the backlog and continue independent work.
- Halt affected work for unsafe original-file mutation, credential disclosure, insecure MCP exposure, unavailable necessary authorization or a shared blocker preventing safe progress.
- Deferred requirements are explicitly reported and never claimed implemented.
