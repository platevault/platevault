# Research: Generated Project Source View Removal

**Spec**: `specs/026-generated-project-source-view-removal/spec.md`  
**Status**: NOT IMPLEMENTED

## R1: When Source Views Become Stale

A `PreparedSourceView` is considered stale when any of the following holds:

- A referenced inventory item's canonical path no longer resolves under the
  current root mapping.
- The recorded link target on disk no longer exists, has changed kind (e.g.
  symlink replaced by a regular file), or points outside the original
  inventory item.
- The project's workflow profile has changed such that the view's strategy
  (symlink vs copy vs junction) is no longer the project's preferred strategy.
- A canonical inventory item the view references has been archived or marked
  deleted.

Detection runs as a read-only sweep on project open and on demand. Stale views
are surfaced in the UI; no mutation happens without a reviewed plan.

## R2: Cross-Platform Link and Junction Cleanup

| Strategy   | Windows                              | macOS / Linux         |
| ---------- | ------------------------------------ | --------------------- |
| symlink    | `RemoveDirectoryW` / `DeleteFileW`   | `unlink(2)`           |
| junction   | reparse point removal via `DeviceIoControl` then `RemoveDirectoryW` | not applicable |
| hardlink   | `DeleteFileW` (only the link entry)  | `unlink(2)`           |
| copy       | archive then delete via trash crate  | archive then trash    |

Removal MUST never recurse into the link target. Junction handling on Windows
must explicitly detect reparse points so the OS does not follow the junction
and delete inventory content. Long-path prefix (`\\?\`) is required on
Windows. Symlink loops are guarded by visiting only the recorded view
membership, never by walking the filesystem.

## R3: Archive vs Delete for View Files

- Link-kind views (symlink, junction, hardlink) carry no unique bytes; direct
  unlink is safe and reversible by regeneration. Default: direct unlink.
- Copy-kind views carry duplicated bytes that may be the user's only convenient
  workflow copy; default to archive/trash so the user can restore without a
  full regeneration. The user may opt into permanent delete per plan.
- Mixed-strategy views produce a plan with mixed actions, each item explicitly
  labeled in the review surface.

## R4: Regeneration Cost Analysis

- Link/junction/hardlink regeneration: O(items) syscalls, no byte movement.
  Practically instant for typical project sizes (hundreds to low thousands of
  items).
- Copy regeneration: dominated by disk I/O proportional to the bytes copied.
  This cost is the primary reason copy-kind views default to archive on
  removal rather than direct delete.
- Regeneration always reads the canonical database first and resolves current
  inventory paths, so it correctly handles root remaps that occurred between
  removal and regeneration.

## Decisions

- D1: Treat removal and regeneration as `FilesystemPlan` variants, not as
  bespoke operations.
- D2: Default link-kind removal to direct unlink; default copy-kind removal to
  archive.
- D3: Stale detection is read-only and never auto-mutates.
- D4: Preserve `PreparedSourceView` membership history after removal so
  regeneration is reproducible.
