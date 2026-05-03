# Risk Register and Unresolved Questions

## Risks

### R001: Unsafe Filesystem Mutation

- Severity: High
- Likelihood: Medium
- Risk: A bug could move, delete, overwrite, or unlink user data unexpectedly.
- Mitigation: All mutations go through filesystem plans, explicit approval,
  precondition checks, no silent overwrite, archive/trash defaults, and audit.
- Owner area: `crates/fs/planner`, `crates/audit`, `crates/app/core`

### R002: Misclassified Source or Calibration Data

- Severity: High
- Likelihood: Medium
- Risk: Incorrect classification could lead to bad project mappings or unsafe
  cleanup suggestions.
- Mitigation: Confidence scores, evidence, review state, unknown buckets, and
  conservative protected defaults.
- Owner area: `crates/fs/inventory`, `crates/metadata/*`, `crates/calibration/core`

### R003: Calibration Reuse False Positives

- Severity: High
- Likelihood: Medium
- Risk: Flats or masters may appear compatible but be invalid due to dust,
  focus, rotation, filter, binning, temperature, gain, offset, or optical train
  changes.
- Mitigation: Hard incompatibility gates, weighted scoring, mismatch reasons,
  and user acceptance/override records.
- Owner area: `crates/calibration/core`, `crates/sessions`

### R004: PixInsight Artifact Rules Drift

- Severity: Medium
- Likelihood: Medium
- Risk: PixInsight/WBPP output structure may vary by version, settings, or user
  behavior.
- Mitigation: Treat workspace as tool/user-managed, observe rather than own,
  keep artifact rules configurable, and classify cleanup candidates with
  confidence.
- Owner area: `crates/project/structure`, `crates/workflow/profiles`

### R005: Cross-Platform Path Semantics

- Severity: High
- Likelihood: High
- Risk: Windows, macOS, and Linux differ in links, junctions, path length,
  reserved names, case sensitivity, Unicode normalization, and removable drives.
- Mitigation: Root-relative paths, platform flags, capability checks,
  non-following scans by default, and platform fixture tests.
- Owner area: `crates/fs/inventory`, `crates/fs/planner`

### R006: Contract Drift Between UI and Core

- Severity: Medium
- Likelihood: Medium
- Risk: React, Tauri commands, and Rust DTOs could diverge.
- Mitigation: JSON Schema source of truth, contract parity tests, `AlmClient`
  adapter boundary, and no direct component-to-command coupling.
- Owner area: `packages/contracts`, `crates/contracts/core`, `apps/desktop`

### R007: SQLite Schema Churn

- Severity: Medium
- Likelihood: Medium
- Risk: The domain model is large and may change as implementation reveals
  better boundaries.
- Mitigation: Migration framework, fixture-backed tests, repository boundaries,
  and explicit schema versioning.
- Owner area: `crates/persistence/db`

### R008: Large Library Performance

- Severity: Medium
- Likelihood: High
- Risk: Millions of files or large FITS/video files could make scans,
  extraction, hashing, or UI rendering slow.
- Mitigation: Lazy/optional hashing, header-only extraction, paginated inventory,
  operation progress, cancellation where safe, and benchmark harnesses.
- Owner area: `crates/fs/inventory`, `crates/metadata/*`, `apps/desktop`

### R009: Manifest Confusion

- Severity: Medium
- Likelihood: Medium
- Risk: Users may edit generated manifests and expect them to become canonical.
- Mitigation: Mark manifests as generated/protected documentation, keep database
  canonical, version formats, and define future import as a reviewed operation.
- Owner area: `crates/project/structure`, `packages/contracts`

### R010: Scope Creep Into Processing

- Severity: High
- Likelihood: Medium
- Risk: Metadata, source views, or workflow profiles could drift into image
  processing responsibilities.
- Mitigation: Constitution boundary: no calibration, debayering, registration,
  integration, drizzle, stacking, or editing.
- Owner area: All implementation areas

## Unresolved Questions

### Q001: SQLite Implementation Choice

Candidates:
- `rusqlite`
- `sqlx`
- Another migration/repository stack

Decision needed before persistence implementation tasks.

### Q002: FITS/XISF Parser Dependencies

Decision needed after fixture requirements are finalized. The parser stack must
support header/property extraction without reading full image payloads by
default.

### Q003: Exact PixInsight Artifact Taxonomy

Needs validation against current PixInsight/WBPP output structure and user
sample projects.

### Q004: Planetary/Lunar Tool Profile Depth

Need decide whether v1 uses one generic planetary/lunar profile or detailed
profiles for common tools beyond SharpCap capture metadata.

### Q005: Link Strategy Defaults Per Platform

Need validate tool compatibility and permission behavior for symlinks,
junctions, hard links, and copies on Windows/macOS/Linux.

### Q006: Manifest Import Future

Need decide whether future remote service migration includes manifest import,
database sync, or both. v1 keeps manifests generated and non-canonical.

### Q007: Root Identity Reliability

Need determine which volume/device identifiers are reliable enough per platform
for moved-drive detection.
