# Messy Library Fixture

This fixture family models a representative existing astrophotography library
root for User Story 1. Tests may materialize this structure under a temporary
directory at runtime; do not commit private image data or large source frames.

## Root Shape

Use `Astrophotography/` as the temporary root name. The root intentionally mixes
capture data, calibration material, processing work, published outputs, manual
notes, tool folders, and unknown material.

```text
Astrophotography/
├── Raw/
│   ├── 2026-01-12_M42/
│   │   ├── Lights/
│   │   │   ├── M42_L_001.fit
│   │   │   └── M42_R_001.fit
│   │   ├── Flats/
│   │   │   └── flat_L_001.fit
│   │   └── NINA/
│   │       └── m42-plan.json
│   └── 2026-02-04_M31/
│       ├── lights/
│       │   └── m31_light_001.xisf
│       └── unclear/
│           └── camera-export.bin
├── Masters/
│   ├── Darks/
│   │   └── master_dark_300s_gain100.fit
│   ├── Bias/
│   │   └── master_bias_gain100.fit
│   └── Flats/
│       └── master_flat_L.fit
├── Process/
│   ├── M42_2026_attempt_1/
│   │   ├── WBPP/
│   │   │   └── WeightedBatchPreprocessing.xpsm
│   │   └── working/
│   │       └── integration_cache.tmp
│   └── orphan_processing_folder/
│       └── notes.txt
├── Published/
│   ├── M42_final.jpg
│   └── M31_web.png
├── SharpCap Captures/
│   └── Jupiter_2026-03-01/
│       └── jupiter_001.ser
├── Manual/
│   ├── processing-notes.md
│   └── target-plan.csv
├── PixInsight processes/
│   ├── DBE_process.xpsm
│   └── color_calibration.xpsm
├── Databases/
│   └── old-catalog.sqlite
├── Tools/
│   └── scripts/
│       └── rename-helper.ps1
└── Unknown Drop/
    ├── maybe_stack.fit
    └── readme.tmp
```

## Expected Classification Hints

- `Raw/**/Lights` and lowercase `lights` should classify as candidate
  acquisition source folders with medium or high confidence.
- `Raw/**/Flats`, `Masters/Darks`, `Masters/Bias`, and `Masters/Flats` should
  classify as calibration material or calibration masters.
- `Process/M42_2026_attempt_1` should classify as project-like material, not as
  an app-managed project.
- `Published/*` should classify as final-output candidates.
- `SharpCap Captures/**/*.ser` should classify as planetary or lunar video
  source material.
- `Manual/*` should classify as notes or planning artifacts when extensions and
  names support that inference.
- `PixInsight processes/*.xpsm` and `Process/**/WBPP/*.xpsm` should classify as
  processing-tool artifacts.
- `Databases/old-catalog.sqlite`, `Tools/scripts/*`, and `Unknown Drop/*`
  should remain reviewable when no safe high-confidence domain assignment
  exists.

## Safety Cases

Tests that need links or platform-specific path behavior should create these
entries dynamically under the temporary fixture root:

- A symlink from `Raw/linked-masters` to `Masters/`.
- A junction on Windows from `Process/junction-to-raw` to `Raw/`.
- A missing root simulation by recording the original root and then moving the
  temporary directory before lookup.
- A case-conflict pair such as `Raw/CaseTest/M42.fit` and
  `Raw/CaseTest/m42.fit` on case-sensitive filesystems only.

Default scan settings must record links without traversal. Any traversal test
must explicitly opt in and assert the setting that allowed it.

## Test Assertions

User Story 1 tests should verify:

- The scanner records root-relative paths rather than absolute fixture paths.
- The scanner does not mutate files, directories, timestamps, or link targets.
- Classification output includes confidence and review state for every
  classified item.
- Unknown and low-confidence material remains visible for review.
- Project-like processing folders are not imported as app-managed projects.
- Missing or moved roots produce a recoverable root state instead of losing
  relationships.
