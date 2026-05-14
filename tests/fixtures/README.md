# Fixture Layout

Fixtures model real astrophotography library situations while staying safe to
commit and run in CI.

Planned layout:

```text
fixtures/
├── library_messy/
├── metadata/
├── project_structure/
├── processing_artifacts/
└── filesystem_safety/
```

Fixture rules:

- Prefer tiny synthetic files and header-only samples over real large images.
- Never commit private image data, exact personal filesystem paths, or secrets.
- Use explicit manifests to describe what each fixture represents.
- Link, junction, hard-link, long-path, and case-sensitivity fixtures must be
  guarded by platform capability checks.
- Any fixture that simulates destructive cleanup must live under a temporary
  test root created at runtime.

Required fixture families:

- Messy library root with broad folders such as Raw, Masters, Process,
  Published, SharpCap Captures, Manual, and PixInsight processes.
- FITS/XISF metadata samples with complete, incomplete, conflicting, and
  vendor-specific keys.
- Calibration reuse cases for darks, biases, dark flats, flats, and masters.
- App-owned project envelope examples.
- PixInsight/WBPP and planetary/lunar processing artifact examples.
