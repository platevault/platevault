# Specification Quality Checklist: Calibration matching at ingestion, the calibration library, and master adoption

Created: 2026-10-03
Amended: 2026-10-14 and 2026-10-16, to the calibration library of D-W82 and the F4 Project model (D-W93 to D-W116)
Feature: [Specification](../spec.md)

- [x] User outcomes and negative acceptance scenarios are stated.
- [x] Feature scope and root-contract references are explicit.
- [x] User outcomes and mandatory development-MCP boundary are explicit; detailed implementation belongs in the plan.
- [x] Original input custody and failure outcomes are preserved.
- [x] Consuming product decisions are encoded in the root D01 through D19 register under the authorized conservative defaults.
- [x] Workflow decisions D-W5, D-W24, D-W29, D-W37, D-W41 and D-W55 (settled 2026-10-06) are encoded; each changed or new requirement names its decision.
- [x] Workflow decisions D-W82 and D-W93 to D-W116 move matching to ingestion, pin calibration on each session and make the Calibrate step a read-only check. Each changed or new requirement names its decision, withdrawn IDs keep their line with the deciding tag, and *Provisional* items are labelled in the text.
- [x] Independent cross-feature requirements review passed after M1 through M13, R1 through R9 and C1 corrections for the 2026-10-03 contract; implementation readiness is not certified.
- [ ] Independent cross-feature review of the 2026-10-06 workflow amendment has not yet run.
- [ ] Independent requirements review of the F4 amendment (PR #1804) has not yet passed.
- [x] The user's all-human-gate waiver follows the root autonomous objective; native gates cite the resolution decision.

Product choices are settled for this run. Independent review, research, plan, data model, contracts, tasks and analysis must still complete before implementation; this checklist does not certify those artifacts or runtime behavior.
