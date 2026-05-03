# Quickstart: Astro Library Manager Planning Baseline

This quickstart describes how a future implementation should prove the v1
planning decisions without starting image processing work.

## Prerequisites

- Rust toolchain pinned by `rust-toolchain.toml`
- pnpm matching `package.json`
- Platform fixtures for Windows-style paths, POSIX paths, long paths, links,
  unknown files, FITS/XISF headers, video files, and PixInsight-like workspaces

## Current Scaffold Checks

Run from the repository root:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo metadata --no-deps --format-version 1
```

Expected result for the planning scaffold: all commands pass with placeholder
workspace crates.

## First Executable Slice Recommended After Tasks

The first implementation slice should be non-mutating inventory:

1. Register a library root in SQLite.
2. Scan a fixture root without following links.
3. Store file and folder records as `LibraryRoot` plus root-relative paths.
4. Classify obvious items into low-confidence categories.
5. Show scan progress and final inventory counts through the operation contract.
6. Prove no filesystem mutations occur during scan.

Acceptance evidence:

- Unit tests for path normalization and root-relative storage.
- Fixture tests for links/junction markers where platform support exists.
- Contract test for `library.scan.start` progress and completion events.
- Audit or operation-state record showing scan start/completion without plan
  application.

## Second Executable Slice

Implement metadata extraction and session candidates:

1. Extract FITS/XISF header metadata without reading image payloads.
2. Store raw metadata and normalized fields.
3. Create candidate acquisition sessions and calibration sessions.
4. Show confidence and evidence for each candidate.
5. Allow review state updates without mutating session identity.

Acceptance evidence:

- FITS/XISF fixture tests.
- Metadata normalization tests.
- Session grouping tests covering multi-target folders and missing metadata.

## Third Executable Slice

Implement app-owned project creation and project source mapping:

1. Create a project structure plan from a selected target and workflow profile.
2. Apply the approved plan to create the app-owned outer envelope.
3. Create the `Project` record only after required directories exist.
4. Map acquisition sessions, calibration candidates, and panels to the project.
5. Generate a manifest preview from database state.

Acceptance evidence:

- Dry-run plan tests.
- Conflict handling tests for existing destination paths.
- Audit tests for applied project directory creation.
- Manifest preview tests proving DB-to-document projection.

## Fourth Executable Slice

Implement source views and cleanup preview:

1. Generate a source view plan from approved project sources.
2. Support manifest-only and one platform-safe link strategy first.
3. Track app-created source view items.
4. Observe a PixInsight-like processing workspace on refresh.
5. Build a nested cleanup tree using inherited global/project/resource policy.

Acceptance evidence:

- Source view plan tests with no silent overwrite.
- Generated-link cleanup tests.
- Artifact observation fixture tests.
- Cleanup tree inheritance and override tests.

## Manual Demo Scenario

Use a fixture library shaped like:

```text
Astrophotography/
├── Raw/
│   ├── 2026-04-10_M51/
│   └── 2026-04-11_M51/
├── Masters/
├── Process/
├── Published/
├── Sharpcap Captures/
└── Pixinsight processes/
```

Demo flow:

1. Register the root.
2. Run initial scan.
3. Confirm target aliases and acquisition sessions.
4. Confirm independent calibration sessions/masters.
5. Create an app-managed project for the target using PixInsight/WBPP.
6. Generate a source view plan and manifest preview.
7. Observe the PixInsight workspace after files are created externally.
8. Mark final output verified.
9. Preview cleanup tree and reclaimable disk estimate.
10. Apply only a reviewed archive/trash plan against generated or intermediate
    artifacts.

## Implementation Guardrails

- Do not add image processing operations.
- Do not expose direct unreviewed file mutation commands.
- Keep React components behind the `AlmClient` interface.
- Keep database records canonical and manifests generated.
- Keep large-file hashing disabled or lazy by default.
- Keep source view links tracked so they can be safely removed.
