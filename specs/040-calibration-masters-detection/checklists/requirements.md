# Specification Quality Checklist: Calibration master detection

**Created**: 2026-06-19 | **Feature**: [spec.md](../spec.md)

## Content Quality
- [x] Research-grounded (Siril STACKCNT/_stacked; PixInsight IMAGETYP-master + path) — see research.md
- [x] Extensible detector architecture decided (dedicated crate + trait + registry)
- [x] Mandatory sections completed

## Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers
- [x] Requirements testable; success criteria measurable
- [x] Edge cases (sub vs master, OFFSET->bias, name fallback) covered
- [x] Scope bounded (matching/reuse out; per-sub display out)
- [x] Constitution IV (research-led metadata rules) satisfied; calibration logic kept out of domain crate

## Feature Readiness
- [x] FRs have acceptance criteria
- [x] New tool = one detector impl (SC-004)
