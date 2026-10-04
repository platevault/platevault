# Engineering process and developer tooling review

## Scope and method

Model identity exposed by the environment: `openai-codex/gpt-6-astra`. The requested `@max` role is not independently exposed as verifiable runtime metadata.

Reviewed the assigned snapshot through source reads and searches only. No files were written; no commands, tests, linters, builds, database operations, network publication or runtime validation were performed. Reproducers below are proposed, not executed. Repository instructions and historical records were treated as evidence, not followed.

Inventory is provided in the structured `files` field. Additional directory inventories covered GitHub workflows, script tooling, SpecKit workflow definitions and journey directories. This was a targeted process review, not an exhaustive review of every release/E2E workflow or vendored extension.

## Concrete strengths

- **Workspace boundaries have an actual structural basis.** `Cargo.toml:3-47` registers separate application, persistence, filesystem, domain, contract, testing and tool crates. This is more meaningful than ownership inferred from directory names alone. It permits the reverse-dependency selection in `scripts/ci-affected-crates.sh:89-115`. Team ownership or review accountability was not established by this review.
- **Safety checks target identifiable failure modes.** CI runs DB-boundary, dead-caller, hot-read, lifecycle-string and explicit-test-target guards (`.github/workflows/ci.yml:453-494`), plus both ordinary and `dev-tools` clippy variants (`:512-525`) and generated-contract checks (`:707-736`). These are not interchangeable checks merely because several are scripts.
- **Performance optimization is intentionally conservative in the main test lane.** The crate helper traverses reverse dependencies and emits `ALL` for unmapped Rust-relevant paths (`scripts/ci-affected-crates.sh:64-115`); the test caller recognizes both `ALL` and empty selection (`.github/workflows/ci.yml:556-570`). The performance caller's inconsistency is a finding below, not a reason to remove affected-crate testing.
- **Journey policy separates intent from observed behavior.** `docs/journeys/FORMAT.md:114-149` distinguishes corrections, behavior deltas and run results, and prevents a regression from being silently normalized into the journey. Stable identifiers and exact-version/commit run records are useful controls.
- **Runtime evidence has a sensible concurrency boundary.** The static journey formula allows definition and acceptance inspection beside a single runtime-driving step, then requires fan-in before recording (`.beads/formulas/journey-step-agentic-verification.formula.toml:33-71`). This supports independent scrutiny without multiplying mutations of the shared desktop environment.
- **Process uncertainty is sometimes recorded honestly.** `specs/SPEC_STATUS.md:20-30` explicitly limits the scope of its partial reconciliation. The close guard distinguishes PR merge state from main-branch landing and refuses ambiguous PR identification (`scripts/bd-close-guard.sh:11-58,157-179`). These are useful controls; historical numerical claims in those comments were not independently verified.

## Findings

### PROC-01 — Mixed changes bypass the unknown-path fail-closed policy

**P1 · High confidence · Defect**

**Evidence:** `.github/workflows/ci.yml:214-241` checks whether any aggregate filter matched, not whether every changed file was classified. The docs matcher includes all Markdown (`:186-194`); the idle job reports no applicable tests when both lanes are false (`:788-810`).

**Causal trace / proposed reproducer:** Submit a change containing `README.md` and `deny.toml`, or `README.md` and `.cargo/config.toml`. The Markdown sets `docs=true`. Neither configuration path is covered by a direct Rust/frontend/shared matcher in `:138-180`. Because the fallback requires `docs != true`, it does not activate either lane. A path that alone would trigger both lanes therefore becomes untested when accompanied by documentation. Similarly, a known frontend change can mask an unknown Rust configuration input.

**Impact:** Rust configuration or supply-chain policy changes can avoid the checks intended to validate them. This violates the explicit fail-closed guarantee without requiring an unusual source change.

**Counterevidence:** An entirely unknown change does activate both lanes; directly recognized Rust/frontend changes still activate their own lanes. The defect is specifically the mixed set.

**Recommended fix:** Compute unclassified paths from the complete changed-file set minus the union of recognized paths. Any remaining path should activate the conservative lanes. Explicitly classify common root build/security configuration, but do not rely on adding individual patterns as the sole repair.

**Verification still needed:** Exercise a table of unknown-only, docs-only, docs+unknown, frontend+unknown-Rust-config and recognized mixed-language changes against the actual selection logic; confirm resulting job execution, not just outputs.

### PROC-02 — Performance gate skips full-workspace and dependency changes

**P2 · High confidence · Defect**

**Evidence:** `.github/workflows/ci.yml:833-838` claims Cargo manifest/lock changes are covered. Its actual predicate at `:859-867` matches only three crate names. The helper emits literal `ALL` for an unmapped root manifest (`scripts/ci-affected-crates.sh:80-84`) and ignores `Cargo.lock` in its Rust-relevance predicate (`:24-31`), yielding empty output (`:89-90`). The ordinary Rust test caller already handles both cases (`.github/workflows/ci.yml:556-560`).

**Causal trace / proposed reproducer:** A root `Cargo.toml` change returns `ALL`; a Cargo-lock-only change returns empty output. Both activate the Rust CI lane through `force_full_rust` (`.github/workflows/ci.yml:143-145,202-204`), but neither matches the performance gate's grep. Consequently the measured scenarios do not run.

**Impact:** Dependency or workspace-level changes affecting inbox query behavior can evade the SQL-statement regression ratchet while the job succeeds.

**Counterevidence:** A directly changed measured crate or a dependency whose reverse closure contains it does run the gate. Full-workspace tests also still run; this is a performance-contract gap, not total test omission.

**Recommended fix:** Reuse one selection contract across callers. Run the performance scenarios on `ALL`, relevant force-full triggers and uncertain/empty selections when the Rust lane is active; skip only a positively known unrelated selection.

**Verification still needed:** Selection cases for root manifest, lockfile, measured crate, transitive dependency and unrelated leaf; demonstrate the performance step is reached for the first four applicable cases.

### PROC-03 — SpecKit entry workflow and gate artifacts contradict one another

**P2 · High confidence on source contradiction; medium on installed-runtime effect · Defect**

**Evidence:** `justfile:215-217` exposes the full workflow. `.specify/workflows/speckit-full/workflow.yml:45-73` invokes checklist before plan/tasks, while `gates.yaml:135-139` requires both plan and tasks for checklist. The workflow later invokes `speckit.implement` (`.specify/workflows/speckit-full/workflow.yml:116-120`), while `gates.yaml:368-376` marks that route deprecated in favor of assign→validate→execute. The assignment gates expect `agent-assignments.md` (`gates.yaml:37-52`; compiled `.specify/gates/nodes.json:25-89`), but the actual extension requires `agent-assignments.yml` (`.specify/extensions/agent-assign/commands/execute.md:54-57`).

**Causal trace / proposed reproducer:** Start `just speckit-full` for a fresh feature using the checked-in workflow and active gate definitions. Its first checklist is requested before required artifacts exist. If that is bypassed, implementation uses the deprecated route instead of the declared chain. Following the replacement chain produces/consumes YAML assignment evidence while the gate looks for Markdown.

**Impact:** Contributors face blocked steps or must learn which nominally authoritative layer to ignore. The artifact mismatch can also reject genuine completion evidence. This is process weight without added assurance: multiple copies of the workflow disagree about order and evidence.

**Counterevidence:** The installed SpecKit/gate runner was not executed; some gate entries may be advisory rather than hard enforcement in a particular integration. The checked-in contradictions remain regardless of that runtime detail.

**Recommended fix:** Select one supported execution route, align workflow order with its prerequisites, and use the actual assignment artifact extension throughout source and compiled gates. Retire obsolete entry points or migrate them completely; avoid another explanatory override document.

**Verification still needed:** Validate and then dry-run a fresh feature through the supported installed integration, checking each predecessor/artifact transition and generated gate consistency.

### PROC-04 — Global process-document exclusions also remove security scanning

**P2 · High confidence · Defect**

**Evidence:** `.pre-commit-config.yaml:16` globally excludes `.specify/`, `specs/`, multiple agent-config trees, `.mcp.json` and generated bindings. The same configuration registers `detect-private-key` (`:28`) and Gitleaks (`:46-49`). The wrapper only counts whether any hook ran (`scripts/precommit-verify.sh:23-41`).

**Causal trace / proposed reproducer:** In a disposable fixture, place a scanner's synthetic known-positive secret example under a globally excluded process/config path and include an ordinary source/document file in the invocation. Pre-commit filters out the excluded path before security hooks receive it. Hooks can run successfully on the ordinary file, so the wrapper's nonzero-hook-count safeguard does not detect the coverage gap.

**Impact:** Secret-bearing configuration and process documents have a checked-in security-scan blind spot. No actual secret exposure is alleged. The reviewed GitHub workflows contain no matching Gitleaks/private-key/pre-commit invocation providing an obvious replacement.

**Counterevidence:** Generated-file byte preservation is a valid reason to exclude files from mutating whitespace hooks, and a wholly excluded invocation is caught by the wrapper. Neither requires excluding security hooks across those trees. Platform-side secret scanning, if enabled, was not inspected.

**Recommended fix:** Move generated-byte and document-format exemptions to the relevant individual hooks. Keep security hooks broad, with only narrowly justified scanner-specific exceptions. Describe per-file coverage separately from the fact that some hooks executed.

**Verification still needed:** Synthetic positive scanner fixtures in each previously excluded category, including a mixed included/excluded invocation; confirm legitimate generated files remain unchanged.

### PROC-05 — Journey lint accepts run records without provenance or coherent outcomes

**P2 · High confidence · Defect**

**Evidence:** Run records are defined with journey version, commit, date, mode, interface, outcome and steps in `docs/journeys/FORMAT.md:151-181`. The implementation only requires readable frontmatter, matching journey, an allowed aggregate result, and validity of any supplied step entries (`docs/journeys/journeys.py:174-188`). Missing steps become `{}` at `:184`. The index then prints the latest record's result, supplying `?` for absent date (`:62-68,85-95`).

**Causal trace / proposed reproducer:** Add a run record containing only `journey: J07` and `result: pass`; it satisfies every run check. So does `result: pass` with an existing step marked `fail`, because aggregate/step consistency is not checked. Neither needs a validated commit, journey version, interface or mode.

**Impact:** The structural evidence validator can endorse records that cannot establish what was validated, or that contradict their own result. The generated routing index can surface those records as a passing last run.

**Counterevidence:** The format and static formula demand exact-SHA evidence, and a careful human can reject malformed records. This finding concerns what the deterministic helper actually enforces, not a claim that current run evidence is fabricated.

**Recommended fix:** Require and type-check run provenance; validate allowed modes, SHA/date formats, step-map type, and outcome consistency. For full-mode passes require the appropriate version's full step coverage; preserve explicit changed-only and smoke semantics rather than treating them as full validation.

**Verification still needed:** Minimal/absent provenance, malformed step maps, full-pass omissions, contradictory aggregate results, legitimate partial runs and valid blocked runs. No helper invocation was performed here.

### PROC-06 — Journey lint invalidates retained history after a legitimate step retirement

**P2 · High confidence · Defect**

**Evidence:** Stable-identity rules explicitly permit removing a step heading while retiring its identifier (`docs/journeys/FORMAT.md:104-111`). Consolidation retains recent historical runs (`:225-233`). Yet `docs/journeys/journeys.py:174-188` compares every historical run's step IDs against only today's `step_ids`; the delta check does the same (`:163-172`).

**Causal trace / proposed reproducer:** Keep a valid v1 run containing S2. Amend the journey to v2 by legitimately removing S2 and recording the intentional behavior delta. The historical run now fails lint as an unknown step. A delta naming the removed step also fails the current-step membership check.

**Impact:** Normal journey evolution creates false failures and pressure to delete or rewrite precisely the evidence the versioned format is supposed to preserve.

**Counterevidence:** Current-version misspellings should still be rejected. The defect is failing to distinguish retired IDs and historical versions from invalid current IDs.

**Recommended fix:** Resolve each run against its declared journey version or maintain a compact retired-ID/history contract. Permit behavior deltas to reference removed IDs with explicit retirement semantics, while continuing to reject accidental unknown IDs.

**Verification still needed:** A v1→v2 removal with retained runs and delta; current-version typo; forbidden ID reuse; old-version valid step; pruning without historical rewriting.

### PROC-07 — Advertised bugfix and tiny-spec recipes have no repository workflow registration

**P2 · High confidence for checked-in assets; medium for machine-local availability · Defect**

**Evidence:** `justfile:219-223` invokes workflows named `speckit-bugfix` and `speckit-tinyspec`. `.specify/workflows/workflow-registry.json:3-26` registers only `speckit`, `speckit-quality` and `speckit-full`. Both the workflow-directory listing and a separate workflow-file glob found exactly those three implementations.

**Causal trace / proposed reproducer:** On a clean contributor environment with the documented Specify prerequisite and only repository workflow assets, invoke either Just recipe. The requested workflow has neither a local definition nor a registry entry. A globally installed personal workflow could mask this on the maintainer's machine, but that dependency is not declared by the recipe.

**Impact:** The lightweight routes most useful for avoiding full-cycle process overhead are not reproducibly available to contributors. Failures route users toward manual ceremony or the much larger full workflow.

**Counterevidence:** This is not proof of failure on every existing workstation; global runner resolution was not inspected. The checked-in extension named `bugfix` is a command extension, not evidence of a workflow with the exact requested ID.

**Recommended fix:** Check in and register the intended small workflows, or remove the dead recipes and document the supported smaller route. If an external workflow package is deliberate, declare and verify its version and installation in onboarding.

**Verification still needed:** A clean-environment workflow listing and non-mutating resolution/dry-run of both recipes, without personal global configuration.

## Process-weight assessment

Keep plan-before-mutation product verification, exact-SHA runtime evidence, independent review, generated-artifact drift checks, and conservative fallback checks. They protect different concrete risks and should not be collapsed merely to shorten the command list.

The avoidable weight is **competing authority**: executable workflow YAML, gate YAML, compiled nodes, vendored extension contracts and historical status documents all need reconciliation. PROC-03 is a concrete example of maintenance effort producing contradiction instead of assurance. Prefer one maintained source per execution contract and generated/checked derivatives.

The historical spec index is not grounds for asserting poor issue health. It explicitly acknowledges partial freshness (`specs/SPEC_STATUS.md:20-30`) and exposes unresolved parity caveats even in implemented rows. However, its own claim to reconciled authority should be clearly distinguished from the inaccessible current work ledger. Similarly, journey indexing currently reads local `TRACKER.md` only (`docs/journeys/journeys.py:71-82`) while this repository configures GitHub issues (`docs/journeys/README.md:3`); the `—` findings display must not be interpreted as proof of no open findings. No external issue counts were inferred.

Contributor onboarding is concise but underspecified for verification: README offers a source launch (`README.md:104-113`), CONTRIBUTING offers generic test guidance and the valuable pre-commit warning, while Just contains the actual tool-dependent gate set. A short supported setup/verification map would be more useful than another long process narrative. A stale comment also says DB-boundary is not wired to CI (`justfile:53-56`) despite the explicit CI step (`.github/workflows/ci.yml:453-460`); treat this as documentation cleanup, not a separate high-signal finding.

## Prioritized roadmap

1. **Close misleading-green paths:** repair mixed-path CI classification (PROC-01), performance sentinel handling (PROC-02), and security-hook exclusions (PROC-04).
2. **Make evidence mechanically trustworthy:** add provenance/outcome checks and version-aware historical validation together (PROC-05/06), so strengthening one does not destroy valid history.
3. **Converge workflow authority:** repair the actual supported SpecKit route and assignment artifact names (PROC-03), then make the small-work recipes reproducible or remove them (PROC-07).
4. **Reduce onboarding ambiguity:** document the supported toolchain and local/CI check map, correct stale claims, and distinguish historical spec reconciliation from live work state. Generate derivative authority artifacts where practical instead of maintaining parallel prose contracts.

## Exclusions and limitations

- Issue-store contents and health, actual GitHub branch protection, repository secret-scanning settings, workflow-run outcomes and merge evidence were not accessed.
- Release, signing, E2E caching and merge-queue scripts were inventoried or encountered but not comprehensively audited in this slice.
- No assertion that every boundary ratchet is semantically correct; their implementations were not all read.
- No installed SpecKit runtime, global workflow registry or integration hook behavior was executed. Relevant findings distinguish source inconsistency from machine-specific enforcement.
- Existing graph artifact was absent at the expected path; directory/source searches supplied evidence. No graph generation was attempted.
- No source changes were made, so there is no behavioral-change verification claim. All proposed verification remains outstanding by the assignment's explicit no-validation constraint.
- No rendered UI was inspected; all visual or usability behavior remains unverified.

## Inspection inventory

- `.github/workflows/ci.yml`: Inspected change classification, integration lane gating, selected verification steps, idle contexts and performance-gate selection.
- `scripts/ci-affected-crates.sh`: Read crate mapping, reverse-dependency closure, ALL fallback and self-test cases.
- `scripts/branch-protection-main.json`: Read checked-in required-status policy; live GitHub settings not accessed.
- `justfile`: Read developer entry points, lint/test/check composition, ratchets, development launch and SpecKit recipes.
- `package.json`: Read package manager/runtime constraints and root scripts.
- `Cargo.toml`: Inspected workspace membership and central dependency definitions.
- `README.md`: Read source-build onboarding and contributor links.
- `CONTRIBUTING.md`: Read contribution sequence and pre-commit evidence guidance.
- `.pre-commit-config.yaml`: Read global exclusions and syntax/security/format hooks.
- `scripts/precommit-verify.sh`: Read no-hooks-ran detection and its coverage limitations.
- `.config/wt.toml`: Read project copy-ignored exclusions; no provisioning operations performed.
- `gates.yaml`: Inspected prerequisite definitions, assignment artifacts, checklist gate, deprecated implement gate and task artifacts.
- `.specify/gates/nodes.json`: Inspected compiled assignment gate prerequisites and artifact names.
- `.specify/workflows/speckit-full/workflow.yml`: Read complete workflow ordering and invoked command names.
- `.specify/workflows/workflow-registry.json`: Read registered workflow names and installation provenance.
- `.specify/extensions/agent-assign/commands/execute.md`: Search-inspected required assignment file and task execution contract.
- `specs/SPEC_STATUS.md`: Read authority claim, reconciliation scope and representative status rows; did not infer issue health.
- `docs/journeys/README.md`: Read reporter configuration, platform profiles, surface routing and intent-evidence rules.
- `docs/journeys/FORMAT.md`: Read identity, versioning, amendment, run evidence and consolidation contracts.
- `docs/journeys/journeys.py`: Read frontmatter parsing, indexing, linting and pruning implementation.
- `.beads/formulas/journey-step-agentic-verification.formula.toml`: Read static exact-SHA preflight, runtime/definition/acceptance fan-out and triage/record dependencies.
- `scripts/bd-close-guard.sh`: Sampled PR resolution precedence, ancestry/content decision contract, self-test tail and fetch behavior; no issue store or live PR queries.
