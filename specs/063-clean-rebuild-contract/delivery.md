# Rebuild delivery contract

Date: 2026-10-03
Authority: user instruction to work spec by spec, fan out major work within the active spec, and review plus Sniff every PR
Scope: all PRs produced by this rebuild

## One active specification

Only one feature specification enters product implementation at a time. Draft specifications and unresolved decisions may be prepared ahead of it. Clarification and analysis artifacts must be complete before implementation; the user's 2026-10-04 authorization resolves every human-approval gate without signoff.

The lead selects the next eligible feature from actual artifact dependencies. The first user-visible path is library indexing, session inspection, standalone View selection, and exact external-tool handoff. No empty application shell is an independently accepted milestone.

## Fan out within the active specification

The lead decomposes major work into independently verifiable acceptance units. Each unit has bounded files, input/output contracts, an implementation owner, and a Bead. Shared schema, contract, registry, and generated regions have one owner.

Ready independent units are dispatched together through task subagents. Each editing worker uses a prepared linked worktree from the same recorded base commit. Native clone isolation remains disabled. A unit waits only when it consumes another unit's artifact or necessarily shares its write region.

Workers run focused proof for their changed behavior. The lead integrates their branches and runs repository-wide verification once after integration. A failed integrated check receives a targeted fix; unrelated failures are recorded separately.

The lead retains integration and PR ownership. Workers never independently land or request automated review rounds for the lead's PR.

## Every PR has two separate assessments

Each PR must have:

1. Independent code review against its exact head and actual base. Review covers correctness, safety, regressions, test quality, and maintainability.
2. A Sniff run against the same immutable head/base range. The run uses installed analyzers through the Sniff intake and authorized recipes; missing tools are explicit coverage gaps.

Sniff does not replace code review. Code review does not replace Sniff. Full Sniff findings receive the prescribed challenge pass. A documentation-only PR still records its applicable assessment and coverage; it must not claim that absent code analyzers ran.

Sniff is a read-only exact-head audit and plan assessment. It neither approves nor applies refactors. Any refactor outside the requested feature needs separate explicit approval; a Sniff finding alone does not expand implementation scope.

The PR remains a draft until local validation, both assessments, required CI, and configured automated reviewers complete against the exact head. A new push invalidates prior head-specific approval and Sniff evidence.

## Evidence before landing

The PR body or governing delivery record identifies:

- Base commit and reviewed head commit.
- Independent review verdict and unresolved findings.
- Sniff manifest/report identity, exact target, analyzer coverage, and challenged findings.
- Focused behavioral proof and integrated verification results.
- Affected journey versions and running-product validation evidence.
- The associated specification and governing Beads.

Actionable findings are fixed by one owner, verified, and reassessed on the new head. Pre-existing unrelated issues do not expand the change; they receive separate tracking. No test, verification asset, or threshold is weakened to clear a gate.

The all-human-gate waiver removes signoff waits only. Required automated assessments and coverage remain mandatory; a separate explicit user exception must name the PR head, omitted check and risk to waive one.

## Journey acceptance

New-project journeys remain Draft until a fresh validator exercises the running implementation. Authors do not validate their own new journey context. Specs define feature requirements; journeys independently describe end-to-end user actions and observations.

Each feature updates its affected interaction entries and journeys when intentional behavior changes. Stable journey and step identities are preserved. Existing baseline run records remain historical evidence and are never presented as rebuild validation.

A feature is accepted only with its specified end-to-end behavior, updated interaction coverage, and affected running-product journey evidence. Passing isolated unit tests or a compiling scaffold is insufficient.

## Standing boundaries

- Old application source, real image files, credentials, and unrelated work remain recoverable. The user authorized resetting all existing application databases because no real catalog exists; this does not authorize deleting source images.
- No silent source mutation, membership omission, copy fallback, or permanent-delete fallback.
- Rust scientific execution and frontend presentation do not alter metric definitions or custody requirements.
- All repository human-approval gates, including verification signoff, are waived under the user's recorded 2026-10-04 instruction in the autonomous objective. Conservative defaults and review findings remain recorded. Automated analysis, tests, independent review, Sniff, delivery evidence and original-file protection remain required.
- Landing and cleanup require the repository's exact-head delivery receipt workflow.
- Development Tauri MCP is mandatory and must control the actual application for verification. Production MCP shipping is an optional future feature; release builds never inherit unauthenticated development exposure.
- Each issue gets at most five failed fix attempts, then a reproducible deferred backlog entry. Continue independent work with no global time limit; deferred requirements are never claimed implemented.
