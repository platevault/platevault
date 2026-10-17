# Specification Quality Checklist: Clean rebuild product contract

Created: 2026-10-03
Feature: [Specification](../spec.md)

## Content quality

- [x] User outcomes and architectural boundaries are distinguished; detailed implementation belongs in feature plans.
- [x] Required scenarios, requirements, entities, outcomes, and assumptions are present.
- [x] Proposed behavior is distinguished from shipped behavior.

## Requirement coverage

- [x] All 44 interaction steps have one primary feature owner across the 12 journeys, and the redesign surfaces (Home, Project page, Wrap up, Import, Targets list) have one owner each.
- [x] Negative scenarios cover input custody, uncertainty, exact handoff, quality scope, completion, and cleanup.
- [x] Open choices have named consuming feature owners.
- [x] Existing uncommitted work and the archived reference remain outside destructive actions.
- [x] Independent cross-feature requirements review of the pre-redesign text passed after M1 through M13, R1 through R9 and C1 corrections; implementation readiness is not certified.
- [x] Conservative product defaults are encoded in D01 through D19 under the user-authorized autonomous run.
- [x] The 2026-10-06 workflow decisions D-W1 through D-W71 and the 2026-10-07 answers D-W72 through D-W74 are copied verbatim into the repository, and every D01 to D19 entry they contradict names its superseding decision.
- [x] The workflow decisions log records D-W75 (2026-10-08), D-W76 to D-W92 (2026-10-12 to 2026-10-14), D-W93 to D-W106 (2026-10-14), D-W107 to D-W116 (2026-10-15/16), D-W117 to D-W121 (2026-10-16), and D-W122 (Round 9 C15, recorded 2026-10-17).
  It also records provisional D-W123 for corrected-FITS mapping and the open generic-tool and non-FITS delivery questions, with *Provisional* and *Open* items marked.
- [ ] Owner confirmation remains open for D-W123's fixed-format alias coverage (including `FOCAL` and `FLENGTH`), whether to patch HIERARCH aliases, generic-tool delivery evidence, the non-FITS correction route, and handling corrected values FITS cannot represent in printable-ASCII cards.
- [x] Changed and added requirements end with their D-W tag; the cross-spec flow states the Project, its groups, its View and Apply, and the Wrap up model.
- [ ] Independent requirements review of the 2026-10-06 workflow amendment has not yet run.
- [ ] Independent requirements review of the 2026-10-08 and round 9 amendments (D-W75 to D-W92) has not yet run.
- [ ] Independent requirements review of the F4 Project model amendment and the owner's second batch (D-W93 to D-W121, 2026-10-14 to 2026-10-16) has not yet passed.
- [ ] Independent requirements review of the Round 9 C15 amendment (D-W122) and provisional D-W123 mapping/open questions has not yet run.

## Feature readiness

- [x] The user's all-human-gate waiver is quoted in the autonomous objective and decision register; native gates cite the resolution decision.
- [ ] Planning and analysis artifacts are verified before product implementation.

The root is a shared contract. PV-LIB owns the usable navigation and catalog trust rules; PV-PRJ owns Home. Product implementation still requires each feature's research, plan, contracts, tasks and analysis; the human approval waiver does not certify those artifacts.
