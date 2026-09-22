# Independent challenge: engineering process and tooling

Model identity exposed by the environment: openai-codex/gpt-6-astra. The requested @max role is not separately exposed as verifiable metadata.

This is a holistic snapshot adjudication, not a claim that these defects were introduced in a particular patch. All citations below are relative to the permitted worktree. Seven original findings were challenged; none is omitted. Source-only inspection confirms four as stated, downgrades three, and rejects none in full. No files were written and no tests, builds, linters, workflow runners, database operations, or runtime validation were executed.

## PROC-01 — DOWNGRADE to P2: classify unknown paths per file

**Confirmed defect; original P1 urgency is not established.** `.github/workflows/ci.yml:138-194` contains no direct classification for root `deny.toml` or `.cargo/config.toml`, while Markdown matches `docs`. The fallback at `:227-241` tests aggregate booleans for the entire change set, rather than the membership of every changed path. Therefore README plus either configuration file suppresses the fallback: neither language lane activates. The consuming dispatch confirms the impact: `integration-idle` at `:788-810` publishes successful integration contexts and explicitly says no tests were applicable, and `supply-chain` at `:816-830` only runs when `rust` is true. The deny-policy example is especially concrete: the configuration change can skip the cargo-deny job intended to consume it.

**Counterevidence/guards inspected:** unknown-only changes do activate both lanes; recognized Rust and shared-driver changes activate Rust directly (`:198-213`). The defect is limited to unknown inputs accompanied by at least one recognized path. It does not bypass all checks for arbitrary Rust edits, demonstrate a released regression, or establish universal operational impact. This supports P2 rather than the report's P1.

**Remaining verification:** exercise the actual path-filter/decision pair with docs-only, unknown-only, docs plus deny.toml, frontend plus Rust configuration, and recognized mixed-language changes; inspect downstream job selection. The fix should preserve per-lane conservatism while finding unclassified files, not merely append the two example patterns.

## PROC-02 — ACCEPT, P2: honor full-workspace selection in the performance consumer

The producer/consumer mismatch is explicit. `scripts/ci-affected-crates.sh:24-31` recognizes Cargo manifests but not Cargo.lock; `:80-90` returns `ALL` for an unmapped Rust-relevant path and empty output for no Rust-relevant paths. The root Cargo manifest is outside individual workspace-member directories, so it takes the ALL path. CI nevertheless activates Rust for both root manifest and lockfile changes through `.github/workflows/ci.yml:143-145,202-204`. The performance consumer at `:859-871` recognizes only the three named crates; neither ALL nor empty output matches, and the measured ratchet is skipped. Its comment at `:833-838` incorrectly asserts the full-workspace path will contain the crate names.

**Counterevidence/guards/tests inspected:** ordinary Rust testing explicitly accepts ALL and empty output at `.github/workflows/ci.yml:556-560`; this is not total test omission. Reverse dependency expansion in `scripts/ci-affected-crates.sh:94-115` correctly reaches measured consumers for normal mapped changes. The script's self-test block at `:118-160` covers orphan-path ALL and docs-empty behavior, but does not test the performance caller's sentinel handling. These producer tests would not catch this integration defect.

**Remaining verification:** root Cargo.toml, Cargo.lock, measured crate, reverse-dependent input, and positively unrelated crate cases, proving whether the ratchet step actually executes. Also include a lockfile plus unrelated crate: the report's proposed generic empty-output repair alone would not cover that mixed case unless force-full inputs are retained in the selection contract.

## PROC-03 — ACCEPT, P2: reconcile the supported SpecKit contracts

The source contradictions are real. `justfile:215-217` invokes speckit-full. `.specify/workflows/speckit-full/workflow.yml:44-73` requests checklist before plan/tasks, while `gates.yaml:135-139` requires all three predecessors. The workflow invokes speckit.implement at `:116-120`, whereas `gates.yaml:368-376` deprecates that route. Assignment production and consumption are concretely inconsistent: `.specify/extensions/agent-assign/commands/assign.md:114-145` writes agent-assignments.yml, and `commands/execute.md:51-57` requires that YAML file; `gates.yaml:37-52` and `.specify/gates/nodes.json:25-89` name agent-assignments.md. The compiled execute/validate nodes include the Markdown path in hard_missing.

**Counterevidence/guards/callers inspected:** `.specify/extensions.yml:111-139` supplies an enabled but optional after_tasks assignment hook. That can produce YAML assignments but cannot repair the gate's expected extension. `.specify/integration.json:1-19` identifies installed integrations and defaults, while the Just recipe defaults to codex; this is metadata, not proof of an enforced gate runner. The deprecation entry itself describes an upgrade hint, not necessarily a hard prohibition. Accordingly, retain the source-consistency finding, but do not state that every current invocation definitely blocks or that deprecation itself prevents implementation. The original report correctly acknowledged this uncertainty.

**Remaining verification:** inspect the supported installed runner's command normalization and gate registration, then resolve/dry-run a fresh feature through the chosen integration. Verify ordering, the actual artifact producer/consumer pair, and regeneration of compiled gates. Consolidation should remove redundant authorities, not add another prose override.

## PROC-04 — DOWNGRADE to P3: filename-filter exclusion is proven, complete scanner bypass is not

`.pre-commit-config.yaml:16` globally excludes the listed process/config trees; detect-private-key is registered at `:26` and Gitleaks at `:45-48`. `scripts/precommit-verify.sh:23-41` checks only that some hook ran. Therefore a mixed invocation can pass the wrapper without demonstrating that a filename-based private-key check inspected the excluded file. That limited coverage/accounting weakness is established.

**Material unsupported claim:** the report treats removing a file from pre-commit's filename list as proof that the Gitleaks hook cannot scan it. The checked-in configuration pins an external hook but does not include its implementation or demonstrate that it consumes only forwarded filenames. A hook that scans the staged diff independently could inspect an excluded staged file once another file causes the hook to run. Consequently the mixed included/excluded synthetic-secret reproducer is not source-proven to bypass Gitleaks, and the broad P2 security blind-spot conclusion is too strong under the permitted evidence boundary.

**Counterevidence/guards inspected:** wholly excluded invocations are rejected by the wrapper; CONTRIBUTING.md:28-42 explicitly warns that a green hook command does not prove coverage. Non-mutating scanner exclusions are not justified by preserving generator-owned whitespace, but the rationale for preserving those bytes is legitimate. Searches of the checked-in workflow/script scope found no replacement Gitleaks invocation; that does not establish the absence of platform secret scanning or tell us the external hook's behavior. No actual secret exposure is alleged.

**Remaining verification:** inspect the exact pinned Gitleaks hook definition and execution implementation, including pass_filenames/always_run semantics. Then use disposable synthetic positives for excluded-only, mixed staged, and explicit --files cases. Escalate to P2 if the complete applicable scanner chain misses a supported case; otherwise retain a narrow defense-in-depth/coverage-reporting improvement. No external source fetch or scanner invocation was performed here.

## PROC-05 — ACCEPT, P2: validate run provenance and internally consistent outcomes

The helper's documented structural role does not excuse accepting records that violate its own run schema. `docs/journeys/FORMAT.md:151-181` defines version, commit, date, mode, interface, result, and per-step outcomes. `docs/journeys/journeys.py:174-188` only checks nonempty frontmatter, matching journey, aggregate result membership, and any supplied step entries. Missing steps become an empty mapping at `:184`; no run-provenance keys or relationship between aggregate and step results are checked. With an otherwise valid parent journey, journey plus result: pass satisfies this entire run-validation block. A pass aggregate with a known failing step likewise passes the implemented checks.

The consumer amplifies the gap: `latest_run` at `:62-68` reads the last filename without validation, and `cmd_index` at `:88-95` displays its result while defaulting missing mode to full and missing date to ?. The report's structural acceptance and misleading-index consequence are therefore grounded.

**Counterevidence/guards/callers/tests inspected:** `.beads/formulas/journey-step-agentic-verification.formula.toml:24-27,33-71` requires a 40-character SHA and independent preflight/fan-in. These are meaningful workflow controls but do not validate arbitrary run Markdown accepted by the helper. The helper's `cmd_lint` at `journeys.py:191-202` simply aggregates lint_journey errors, with no second validation layer. Searches in the journey, scripts, CI, and Just scopes found documentation/helper references but no additional journey-lint caller or focused test enforcement there; this is not a claim about every external integration. No current run was declared fabricated or invalid.

**Remaining verification:** isolated fixtures for missing provenance, contradictory results, malformed mappings, full-mode coverage, changed-only/smoke semantics, and blocked runs. Confirm the intended mode rules before requiring every step for all modes. The report's broad date/SHA strictness recommendations should be implemented in proportion to the stated schema, not treated as independent proven defects.

## PROC-06 — ACCEPT, P2: retain valid historical identities across step retirement

`docs/journeys/FORMAT.md:104-111` explicitly permits removing a step heading while permanently retiring its identifier. `:225-233` retains the newest run files across consolidation rather than requiring all prior-version evidence to disappear. In contrast, `docs/journeys/journeys.py:149-161` collects only present headings; `:170-172` rejects delta references outside that set, and `:174-188` checks every retained run against the same current set without consulting journey_version. A valid v1 run containing S2 therefore becomes an unknown-step error after S2 is intentionally removed in v2. A removal delta naming S2 is rejected as well.

**Counterevidence/guards/callers inspected:** current-ID membership is a useful typo guard, and pruning eventually removes old runs. Neither reconciles a newly retired step with still-retained history, and pruning runs does not fix the immediate removal-delta error. The format preserves prior evidence in Git, but the linter does not resolve definitions from that history. Requiring historical runs to use today's IDs would contradict the versioning policy rather than fix the defect.

**Remaining verification:** a valid v1 record, v2 retirement/delta, retained v1 run, a current-version typo, and forbidden ID reuse. Repair version/history lookup or introduce explicit retirement metadata while preserving current-identity checks. Address this together with PROC-05 so stronger provenance validation does not force rewriting old evidence.

## PROC-07 — DOWNGRADE to P3: missing local workflow registration is established; clean-run failure remains unverified

`justfile:219-223` invokes workflow IDs speckit-bugfix and speckit-tinyspec. `.specify/workflows/workflow-registry.json:3-26` registers only speckit, speckit-quality, and speckit-full, and the scoped workflow.yml glob found exactly those three definitions. The cited local-asset mismatch is confirmed.

**Counterevidence/guards/callers inspected:** `.specify/extensions/bugfix/extension.yml:15-25` exposes bugfix report/patch/verify commands, and `.specify/extensions/tinyspec/extension.yml:15-25` exposes tinyspec, implement, and classify commands. They do not register the requested workflow IDs, but they materially narrow the claim that lightweight routes are unavailable: smaller command routes are checked in. The runner is external; its built-ins, automatic discovery, and global lookup were not inspected. README.md:98-105 documents pnpm/Rust source startup, and CONTRIBUTING.md:18-42 gives contribution/check guidance, neither demonstrating a specific workflow installation dependency. The Just comment says the Specify CLI is required, but this is not evidence that its resolver lacks built-in workflows.

Thus preserve the reproducibility/documentation inconsistency at P3, but do not report a definite fresh-contributor command failure or assert contributors must use the full ceremony without resolving the actual runner behavior first.

**Remaining verification:** inspect the pinned/supported Specify runner's resolver and determine whether these IDs are built in, packaged externally, or genuinely absent. Then list and dry-resolve both recipes in a clean environment without personal configuration. Depending on the result, promote to P2 and supply/register the workflows, or document the deliberate dependency and supported lightweight command routes.

## Material omissions and corrected boundaries

- **PROC-02 mixed force-full inputs:** ALL/empty handling is necessary but insufficient if a lockfile accompanies a mapped unrelated crate. The helper ignores the lockfile and can return only that crate, so the performance consumer still needs the force-full dependency-change contract. This is an extension of PROC-02, not an eighth finding.
- **PROC-04 hook semantics:** the external Gitleaks implementation is decisive missing evidence. Do not present its presumed filename-only behavior as fact.
- **PROC-07 available alternatives:** the checked-in lightweight extension commands are stronger counterevidence than the original report's discussion acknowledges; broken recipe IDs would not mean no lightweight route exists.
- **Journey index interpretation:** README.md:3 configures GitHub issues, while journeys.py:71-82 reads only a local TRACKER.md and :96-105 renders absent counts as a dash. Preserve the first-wave report's warning that this is not proof of no open findings. No tracker or issue-health conclusion was drawn, and this was not promoted to a new counted finding.
- No independently verified additional finding is added. Ownership quality, overall automation complexity, and the necessity of individual ratchets cannot be inferred from their names or count.

## Safety controls versus unnecessary process weight

Keep conservative unknown-input handling, generated-byte integrity, reverse-dependency coverage, exact-SHA runtime evidence, independent inspection, and serialized access to shared runtime state. Their code/contracts address different failure modes. The proven unnecessary weight is contradictory execution authority in PROC-03: humans must reconcile workflow ordering and artifact formats that should agree mechanically. The appropriate simplification is one maintained execution contract with checked derivatives, not removing the safeguards. Onboarding would benefit from a supported tool/check map, but that is not independently elevated to a correctness defect.

## Prioritized roadmap and exclusions

1. Fix the confirmed CI selection gaps, PROC-01 and PROC-02, with producer-to-consumer selection cases.
2. Repair journey provenance/outcome checks and version-aware history together, PROC-05 and PROC-06.
3. Reconcile the supported SpecKit workflow, artifact names, and compiled derivative, PROC-03.
4. Resolve external Gitleaks semantics and Specify workflow discovery before scheduling the stronger security or broken-command repairs claimed in PROC-04/07.

All proposed verification remains outstanding under the explicit no-validation constraint. No live GitHub settings, scanner service, actual CI outcome, installed runner, global configuration, issue-store contents, or user data was accessed. Static issue health remains unknown. No rendered UI was inspected; source-only visual/usability claims remain unverified. Existing tests were inspected only where noted; none was executed. Source-only reasoning establishes the listed conditional paths, not observed production failures.

| ID | Verdict | Corrected severity |
|---|---|---|
| PROC-01 | DOWNGRADE | P2 |
| PROC-02 | ACCEPT | P2 |
| PROC-03 | ACCEPT | P2 |
| PROC-04 | DOWNGRADE | P3 |
| PROC-05 | ACCEPT | P2 |
| PROC-06 | ACCEPT | P2 |
| PROC-07 | DOWNGRADE | P3 |

Totals: ACCEPT 4; DOWNGRADE 3; REJECT 0. No rejected finding was removed or hidden; there were no full rejections.
