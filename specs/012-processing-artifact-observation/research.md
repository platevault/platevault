# Research: Processing Artifact Observation

**Feature**: `012-processing-artifact-observation`
**Date**: 2026-05-20
**Status**: Resolved items recorded; open items deferred to design or v1+.

This research backs the constitution's Research-Led Domain Modeling
principle for output-folder conventions, classification heuristics,
watcher technology, and debounce defaults.

---

## R-1: Output Folder Conventions Per Tool

**Question**: Where do PixInsight, Siril, and planetary/lunar tools
write their outputs by default, and how does the app discover the
folder?

**Findings**:

- **PixInsight / WBPP**: Outputs are typically written under a
  project-relative subtree chosen at WBPP run time. Common patterns:
  `<project>/master/`, `<project>/calibrated/`, `<project>/registered/`,
  `<project>/integration/`. The exact root is user-configured per
  WBPP run and persisted in the WBPP icon. There is no environment
  variable; the app must let the user point at the folder explicitly
  (or accept the project envelope folder from feature 008).
- **Siril**: Output location is fully configurable per script or
  session. Siril writes alongside inputs by default but most users
  configure a per-project working directory. Detection must rely on
  the user-configured workflow profile output folder; no convention
  exists.
- **Planetary/lunar tools (AutoStakkert!, Registax)**: Outputs are
  written next to the input video by default. Mirrors Siril's
  user-configured pattern. Out of scope for v1's first surface but
  the same model fits.

**Decision**: Each workflow profile carries an `output_folder_strategy`:
either `project_relative_subfolder(name)` (default for PI) or
`user_configured_path` (default for Siril and planetary). The user
sets the path at project create/edit time (feature 008).

---

## R-2: Classification Heuristics

**Question**: How does the app decide whether an observed file is an
intermediate, master, or final artifact?

**Findings**:

- Filename suffix patterns are the most reliable signal across tools.
  PixInsight's WBPP writes `MasterDark_*.xisf`, `MasterFlat_*.xisf`,
  `MasterBias_*.xisf`, and `integration_*.xisf`. The `Master*` prefix
  is canonical for master frames; `integration_*` denotes the final
  integration result.
- Extension alone is insufficient: a `.xisf` can be any of the three
  kinds.
- The user's chosen final filename (e.g. `<target>_final.tif`,
  `<target>-final.png`) is project-specific and unreliable without a
  user-defined rule.
- Header peeking (XISF properties, FITS HISTORY cards) could confirm
  classification but adds a heavy parser dependency and a read-side
  effect on user files; deferred (research item M-3).

**Decision (heuristic order, highest priority first)**:

1. Manual override (always wins).
2. Workflow-profile rule with a literal filename match, confidence 1.0.
3. Workflow-profile rule with a prefix match (`MasterDark_*`),
   confidence 0.9.
4. Workflow-profile rule with a suffix match (`*_final.tif`),
   confidence 0.8.
5. Extension-only fallback to `intermediate`, confidence 0.1.

PixInsight default rules:

| Pattern | Kind | Confidence |
|---------|------|------------|
| `MasterDark_*.xisf`, `MasterFlat_*.xisf`, `MasterBias_*.xisf` | master | 0.9 |
| `integration_*.xisf`, `*_integration.xisf` | final | 0.85 |
| `*_c.xisf`, `*_r.xisf`, `*_d.xisf` (calibrated/registered/debayered) | intermediate | 0.8 |

Siril default rules:

| Pattern | Kind | Confidence |
|---------|------|------------|
| `master-dark.fit`, `master-flat.fit`, `master-bias.fit` | master | 0.9 |
| `result_*.fit`, `*_stacked.fit` | final | 0.8 |
| `pp_*.fit`, `r_*.fit` (pre-processed, registered) | intermediate | 0.8 |

---

## R-3: Watch Vs Poll Selection

**Question**: When can the app rely on native filesystem notifications
and when must it fall back to polling?

**Findings**:

- `notify-rs` provides native watchers (FSEvents on macOS, ReadDirectoryChangesW
  on Windows, inotify on Linux). Reliable on local disks across the
  three platforms.
- Network shares (SMB, NFS) deliver inotify/ReadDirectoryChanges
  events inconsistently or not at all. PixInsight users frequently
  stage outputs on NAS shares.
- FUSE mounts (rclone, sshfs) drop events.
- macOS FSEvents has a known coalescing window (~30s historically,
  now configurable) — acceptable for our use case but means our
  debounce should be no shorter than the coalescing window on macOS.

**Decision**: Default to notify-rs. On watcher attach, probe the
target path for: (a) mount-type heuristics (Windows `GetDriveTypeW`,
macOS `statfs.f_fstypename`, Linux `/proc/self/mountinfo`), and (b)
synthetic-event self-test (write a temp file in the app's own
scratch area, not in the user's folder, and confirm an event lands).
If the path is on a known-bad filesystem type OR the self-test fails,
fall back to a polling watcher with a 5s interval. The polling
watcher uses directory mtime + stable-size check before emitting a
`detected` event.

---

## R-4: Debounce Window

**Question**: How long should the app wait after the last write event
before recording a `detected` artifact, to avoid races with partial
writes?

**Findings**:

- PixInsight writes XISF files in a single pass for most operations
  but stacking integrations can take minutes. The watcher fires once
  per OS event coalesce window.
- A short debounce (≤500ms) risks recording a partially written file.
- A long debounce (≥10s) makes the UI feel laggy for users dropping
  in already-complete files.
- Stable-size check (poll size twice with a delay; require equality)
  bypasses the debate at the cost of one extra `stat` per event.

**Decision**: Default debounce 2000ms with a stable-size check
(re-stat after the debounce; require unchanged size and mtime before
emitting `detected`). User-overridable per workflow profile in v1+.

---

## R-5: PixInsight-Specific Folder Layout (v1 minimum)

**Question**: What is the minimum PixInsight-aware folder layout v1
must understand without becoming PixInsight-specific in code?

**Decision**:

- v1 watches one folder per project (the configured output folder).
- Subfolders inside the output folder are recursed up to depth 3 to
  cover WBPP's `master/`, `calibrated/`, `registered/`, `integration/`
  pattern, but the watcher is filesystem-generic — the depth and
  subfolder names are workflow-profile config, not hardcoded.

---

## R-6: Missing-State Transition

**Question**: When does an observed artifact become `missing` and how
does it return to `present`?

**Decision**:

- A reconciliation scan runs on watcher attach and on user-initiated
  rescan. Rows whose `path` no longer exists transition to `missing`.
- If the file reappears at the same path, the row transitions back to
  `present` and a new audit event records the round-trip. The
  classification persists unless the file's mtime moved forward AND no
  manual override exists, in which case the classifier re-runs.

---

## Open Questions Deferred

- **M-1**: Whether `final` artifacts should automatically be linked
  into the project manifest body (feature 024) or only on user
  confirmation.
- **M-2**: Polling-fallback heuristic refinement after first real-world
  usage on SMB/NFS.
- **M-3**: XISF/FITS header peeking for classification disambiguation.
  Currently deferred to keep dependency surface lean (no XISF parser
  in the watcher crate).
- **M-4**: Whether intermediates should age out of the UI after N days
  (auto-hide) without affecting the index.
