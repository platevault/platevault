# Pull request

## Change

State the user-visible change and its governing specification.

## Verification

Record the commands and changed-path behavior exercised. Name pre-existing unrelated failures separately.

## Exact-head review gates

Record evidence for the final base and head commits. A new push requires renewed head-specific assessment.

- [ ] Independent code review completed; verdict and remaining findings linked.
- [ ] Sniff completed on the same head/base range; report, analyzer coverage, and challenged findings linked.
- [ ] Focused behavioral proof and integrated repository verification passed.
- [ ] Affected interaction entries and journeys updated; running-product validation evidence linked where behavior changed.
- [ ] Required CI and repository-configured automated reviewers passed on this head.
- [ ] No tests, verification assets, or thresholds were weakened to pass checks.

Missing coverage needs an explicit human exception naming this head, the omitted check, and its risk. Documentation-only changes record applicable checks without claiming code analyzers or product validation ran.

## Delivery linkage

Link the governing specification and existing Bead. Keep the PR draft until its applicable gates are satisfied.
