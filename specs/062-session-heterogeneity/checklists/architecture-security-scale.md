# Spec 062 Architecture, Security, and Scale Requirements Checklist

**Purpose**: Formal pre-implementation review of requirement completeness,
clarity, consistency, measurability, and exceptional-path coverage.
**Created**: 2026-07-21
**Audience**: Spec authors, independent reviewers, and release gatekeepers.

## Requirement Completeness

- [x] CHK001 Are the immutable identity fields and allowed absent/unknown states specified for every supported light and calibration session kind? [Completeness, Spec §FR-001–FR-016, §FR-060–FR-075, §FR-088–FR-091]
- [x] CHK002 Are the session, same-panel sibling, and mosaic predicates defined as distinct and mutually non-overlapping concepts? [Completeness, Spec §FR-017–FR-041, §FR-085–FR-087]
- [x] CHK003 Are singleton PanelGroup creation, successor revisions, stable identities, retirement, lineage, and rejection memory all specified? [Completeness, Spec §FR-016, §FR-042–FR-049]
- [x] CHK004 Are exact project pins, related-session suggestions, lifecycle guards, staleness, preview, approval, additive apply, and correction overlays all covered? [Completeness, Spec §FR-050–FR-059, §FR-092–FR-100]
- [x] CHK005 Are dark, bias, and flat identity, family, aging, temperature, orientation, and external-handoff requirements complete while DarkFlat remains unreachable? [Completeness, Spec §FR-060–FR-075, §FR-088–FR-091]
- [x] CHK006 Are metadata correction, replacement sessions, supersession, affected project consequences, and mosaic-edge invalidation specified without in-place historical mutation? [Completeness, Spec §FR-042–FR-050, §FR-058]
- [x] CHK007 Are command idempotency, trusted actor derivation, leases, fencing, audit, outbox, and atomic terminal-result requirements documented for every mutation? [Completeness, Contracts README §Mutation envelope and concurrency]

## Requirement Clarity

- [x] CHK008 Are all coverage, centre-separation, overlap, rotation, aging, thermal, and configuration bounds quantified with units and inclusive/exclusive semantics? [Clarity, Spec §FR-019, §FR-022, §FR-027–FR-034, §FR-065–FR-074, §FR-087–FR-090]
- [x] CHK009 Is representative-based complete linkage distinguished clearly from transitive mosaic connectivity? [Clarity, Spec §FR-020, §FR-023, §FR-035]
- [x] CHK010 Is transported WCS/object sky orientation defined separately from mechanical rotator provenance, parity, and modulo-180 equivalence? [Clarity, Spec §FR-024–FR-026, §FR-073, §FR-089]
- [x] CHK011 Is “sufficient calibration candidate” limited unambiguously to complete recipe evidence plus at least one readable frame, while executable handoff requires every selected-session frame? [Clarity, Spec §FR-071, §FR-075; Calibration handoff contract §CalibrationCandidateEvidence, §calibration.handoff.create, §calibration.handoff.reviewed_add]
- [x] CHK012 Is “current processing content” distinguished from immutable historical filesystem entries and manifests after correction? [Clarity, Spec §FR-058–FR-059, §FR-097–FR-100]
- [x] CHK013 Is every use of “group,” “panel,” “mosaic,” “family,” “session,” and “project membership” tied to one explicit identity and ownership boundary? [Clarity, Spec §Key Entities]

## Requirement Consistency

- [x] CHK014 Do immutable session membership and later sibling suggestions remain consistent across Inbox ingestion, metadata reclassification, and project flows? [Consistency, Spec §US1, §US3, §US5]
- [x] CHK015 Do exact project-session pins remain authoritative despite group, panel, mosaic, family, and related-session display context? [Consistency, Spec §FR-050–FR-052, §FR-058]
- [x] CHK016 Do additive Update View requirements consistently prohibit rewriting, removing, renaming, or relocating existing materialized content? [Consistency, Spec §FR-054–FR-059, §FR-092–FR-100]
- [x] CHK017 Do calibration-family relations preserve observing-night session identity while allowing separately reviewed cross-night reuse? [Consistency, Spec §FR-011, §FR-061–FR-062, §FR-070–FR-074]
- [x] CHK018 Do DarkFlat exclusion requirements supersede older product documents without deleting dormant internal detection code or exposing a supported enum path? [Consistency, Spec §FR-060; Dependencies and boundaries]
- [x] CHK019 Are global command IDs, actor-bound payload digests, lease fencing, and replay behavior consistent across database-only and filesystem mutations? [Consistency, Contracts README §Mutation envelope and concurrency]

## Acceptance Criteria Quality

- [x] CHK020 Can every user story be accepted independently through explicit unit, real-SQLite integration, and real-backend journey evidence? [Measurability, Spec §US1–US5]
- [x] CHK021 Are supported-scale counts and warm, cold, transaction, traversal, cancellation, and startup measurements tied to a documented reference machine and exact fixture? [Measurability, Spec §SC-008–SC-013]
- [x] CHK022 Are performance exclusions such as FITS parsing, WCS solving, catalogue/network work, filesystem work, and writer-lock wait stated for each relevant metric? [Measurability, Spec §SC-009–SC-012]
- [x] CHK023 Are query-plan acceptance rules objective enough to reject unbounded scans without snapshotting brittle complete plan text? [Measurability, Plan §Phase 4; Spec §FR-076–FR-084]
- [x] CHK024 Are progress and cancellation requirements quantified for the pathological topology fixture? [Measurability, Spec §FR-081, §FR-096]

## Scenario and Edge-Case Coverage

- [x] CHK025 Are missing, absent, contradictory, unreadable, stale, rejected, corrected, superseded, and manually related paths addressed for each affected workflow? [Coverage, Spec §Edge Cases]
- [x] CHK026 Are meridian flips, parity mismatch, RA-zero crossing, polar geometry, disconnected footprints, holes, and extended objects intersecting gaps covered? [Coverage, Spec §US2]
- [x] CHK027 Are bridge edges, competing concurrent proposals, cycle attempts, and settings changes after accepted grouping addressed without silent topology mutation? [Coverage, Spec §US2, §FR-031, §FR-035, §FR-042–FR-049]
- [x] CHK028 Are known collisions, runtime collision races, partial filesystem success, retry adoption, source identity changes, and stale lease owners covered? [Coverage, Recovery, Spec §US3]
- [x] CHK029 Are completed and archived project refusals distinguished from allowed setup, ready, prepared, processing, and blocked additions? [Coverage, Spec §FR-053, §FR-059]
- [x] CHK030 Are red, unregulated, unknown-temperature, insufficient, partially unavailable, and all-frames-verified calibration cases specified separately? [Coverage, Spec §US4]

## Non-Functional Requirements

- [x] CHK031 Are request, response, cursor, path, digest, identifier, collection, recursion, work, byte-work, and candidate bounds defined at both transport and trusted-core boundaries? [Security, Contracts README §Resource limits; Spec §FR-081, §FR-093]
- [x] CHK032 Are root identity, root-relative no-follow resolution, same-handle hashing/materialization, atomic no-clobber, and platform collision normalization requirements complete? [Security, Spec §US3, §US4]
- [x] CHK033 Are unauthorized source projections and user-safe errors required to omit absolute paths, stable identities, fingerprints, SQL, OS messages, and secrets? [Privacy, Gap]
- [x] CHK034 Are keyboard, focus, screen-reader naming, warning severity, stale-state prominence, and reduced-motion requirements specified for every new desktop review surface? [Accessibility, Gap]
- [x] CHK035 Is startup behavior explicitly prohibited from loading or mirroring the full relationship graph? [Performance, Spec §FR-083]

## Dependencies and Assumptions

- [x] CHK036 Are released skymath orientation/gnomonic capabilities and target-match footprint/union capabilities explicit blocking dependencies rather than assumed local helpers? [Dependency, Spec §Dependencies]
- [x] CHK037 Is normalized SQLite the sole durable authority, with graph acceleration and native calibration stacking explicitly deferred to their roadmap Beads? [Dependency, Spec §Out of Scope]
- [x] CHK038 Is the greenfield reset assumption explicit enough to prevent accidental legacy-history fabrication while preserving raw-file custody? [Assumption, Spec §Assumptions]
- [x] CHK039 Are supported-scale values described as tested support targets rather than product rejection limits? [Clarity, Spec §FR-076–FR-077, §SC-012]

## Ambiguities and Conflicts

- [x] CHK040 Are all historical provisional fallback, split-plan, native-master, graph-database, and migration-preservation decisions explicitly superseded by the final requirements? [Conflict, Spec §Clarifications]
- [x] CHK041 Are no unresolved placeholders, “NEEDS CLARIFICATION” markers, or undefined owner decisions left in normative artifacts? [Ambiguity]
- [x] CHK042 Do contracts, data model, research, plan, quickstart, and Beads decomposition use the same enums, identity widths, limits, lifecycle states, and ownership boundaries? [Consistency, Data model §Relation proposals and remembered rejection, §Transaction and concurrency rules; Sessions, groups, and proposals contract §RelationProposal, §relation_proposal.accept]
