# Data Model: Inbox Mixed-Folder Split

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Date**: 2026-05-22 (updated from 2026-05-20)

## Entities

### InboxItem

A candidate leaf folder discovered under an Inbox root. One row per FITS-bearing
leaf folder (per R-Granularity-1: each folder that directly contains FITS files
is its own item; intermediate folders containing only subfolders are not items).

| Field | Type | Notes |
|---|---|---|
| `id` | `InboxItemId` (ulid) | Stable across rescans of the same path. |
| `root_id` | `InboxRootId` | FK to scanned Inbox root. |
| `relative_path` | `string` | Path of the leaf folder relative to root; remap-friendly. |
| `file_count` | `int` | FITS files counted at scan time. Does NOT drive plan-item enumeration (see A9). |
| `discovered_at` | `Timestamp` | First-scan time. |
| `last_scanned_at` | `Timestamp` | Most recent scan completion. |
| `content_signature` | `string` | Folder-level signature per R-Sig-1 formula. |
| `state` | `InboxItemState` | See below. |
| `lane` | `enum("fits", "video")` | `fits` for FITS-bearing folders; `video` for video-only folders routed to `inbox.video.*`. (Ref: R-Video-1) |

**InboxItemState** enum:

- `pending_classification`
- `classified`
- `plan_open` — there is an open Plan; see [InboxPlanLink](#inboxplanlink).
  This state is stored and persisted (Ref: R-PlanOpen).
- `resolved` — a plan reached `applied`.

Invariants:

- An InboxItem in `plan_open` MUST have exactly one row in
  `inbox_plan_links` pointing at a Plan whose state is open
  ({`draft`, `ready_for_review`, `approved`, `applying`, `paused`}).
  (Ref: E1 — `paused` added)
- Transition from `plan_open` → `classified` occurs when the linked Plan
  becomes `discarded`, `failed`, or `cancelled`.
- Transition from `plan_open` → `resolved` occurs when the linked Plan
  becomes `applied`.
- A background repair query (every 5 minutes) scans `plan_open` items whose
  linked plan is in a terminal state and closes the link. This is a
  self-healing invariant; the event bus is the primary update path.
  (Ref: R-PlanOpen)

### InboxClassification

A classifier result for an InboxItem. Recomputable; cached. Classification
is **deterministic** — no confidence scores. (Ref: R-IMAGETYP, A5)

| Field | Type | Notes |
|---|---|---|
| `inbox_item_id` | `InboxItemId` | FK. |
| `result` | `ClassificationResult` | See below. |
| `computed_at` | `Timestamp` | |
| `content_signature` | `string` | Folder signature at compute time (per R-Sig-1). Invalidates on drift. |
| `breakdown` | `InboxBreakdown[]` | Per-frame-type rows. |
| `unclassified_file_count` | `int` | Count of files with `unclassified = true` AND `manualOverride IS NULL`. |
| `sample_files` | `string[]` | Up to ~10 representative filenames. |

**Note**: The `confidence` field is removed. Classification is deterministic; no
aggregate confidence value exists.

**ClassificationResult** enum:

- `single_type { frame_type: FrameType }` — all classified files map to one type.
- `mixed { frame_types: FrameType[] }` — two or more distinct types present.
- `unclassified` — all files have `unclassified = true` (no readable IMAGETYP).

### InboxBreakdown

One row per detected frame type within a classification result. Rendered in
the detail drawer.

| Field | Type | Notes |
|---|---|---|
| `kind` | `FrameType` | `Light / Dark / Bias / Flat / DarkFlat` |
| `count` | `int` | Files attributed to this kind (classified by IMAGETYP or manualOverride). |
| `destination` | `string` | Preview path produced by the active Naming & Structure pattern (spec 015). Resolved at classification time for preview only; **not** the canonical plan destination (which is resolved again at plan-generation time). |
| `sample_files` | `string[]` | Representative filenames. |

### InboxClassificationEvidence

Per-file evidence record. Persisted for every file in the folder.
`InboxConfirmUseCase` MUST enumerate live files from this table
(`relativeFilePath` rows) when building plan items — it MUST NOT regenerate
the file list from `InboxItem.fileCount`. Plan items carry actual
source/destination paths. (Ref: A9)

| Field | Type | Notes |
|---|---|---|
| `inbox_item_id` | `InboxItemId` | FK. |
| `relative_file_path` | `string` | Relative path from the inbox root. Used as source path in plan items. |
| `frame_type` | `FrameType?` | Null when `unclassified = true` and `manualOverride IS NULL`. |
| `evidence_source` | `EvidenceSource` | `imagetyp_header` / `xisf_property` / `manual_override` / `none` |
| `raw_value` | `string?` | Original IMAGETYP value or XISF property value for audit. |
| `unclassified` | `boolean` | `true` when `IMAGETYP` is absent, unreadable, or unmapped. Default false. (Ref: R-FileMarker) |
| `manual_override` | `FrameType?` | Set by `inbox.reclassify`. When non-null, this value is used instead of the IMAGETYP-derived result. (Ref: R-Unclass-1) |

**Invariants**:

- Folder-level classification ignores files where `unclassified = true` AND
  `manual_override IS NULL`.
- A folder is `unclassified` only if ALL files have `unclassified = true`
  AND `manual_override IS NULL`.
- When `manual_override IS NOT NULL`, `evidence_source = 'manual_override'`
  and the file is treated as classified by the override type.

### FrameType

```
enum FrameType { Light, Dark, Bias, Flat, DarkFlat }
```

Normalization rules and aliases live in `crates/metadata/core` in the
`ImageTypNormalizationTable`. See [research.md §IMAGETYP Normalization](./research.md).
(Ref: R-FrameEnum — `mixed` is NOT a FrameType; it is a folder-level
`ClassificationResult` variant.)

### ImageTypNormalizationTable

A data artifact (not hardcoded logic) shipped in `crates/metadata/core`.
Maps raw IMAGETYP string values to `FrameType`, case-insensitively after
trim. Unknown values return `None` (file marked unclassified). (Ref:
R-IMAGETYP-Norm)

The canonical mapping is documented in [research.md §IMAGETYP
Normalization](./research.md). A settings UI for user-extended mappings is
deferred to v1.x (spec 018 follow-up).

### InboxPlanLink

Enforces the "at most one open Plan per Inbox item" invariant.

| Field | Type | Notes |
|---|---|---|
| `inbox_item_id` | `InboxItemId` | PK + FK. |
| `plan_id` | `PlanId` | FK to spec 017 plan table. |
| `linked_at` | `Timestamp` | |

**Constraint**: SQLite partial unique index ensures only one link exists
per `inbox_item_id` when the referenced plan is in an open state
({`draft`, `ready_for_review`, `approved`, `applying`, `paused`}).
Closing the plan (apply/discard/fail/cancel) deletes the link.

## Content Signature

**Section added 2026-05-22. (Ref: R-Sig-1)**

### Formula

- **Per-file signature**: `sha256(filename || size_bytes || mtime_unix_ns || sha256(first 65536 bytes))`
  - The 64 KB partial-content hash detects FITS header rewrites that preserve
    size and mtime.
- **Folder content_signature**: `sha256(sorted(per_file_signatures))`

### Purpose

`inbox.classify` computes and returns the folder `contentSignature` in its
response. `inbox.confirm` requires the caller to supply `contentSignature`
from the most recent classify call. If the folder has changed since
classification (signatures don't match), the operation returns
`classification.stale` with a `staleSince` timestamp, forcing the caller to
re-classify before confirming.

## Lifecycle

```
            scan
              │
              ▼
    pending_classification
              │ classify
              ▼
        classified
        │       │
   confirm     generate_split
   (single)    (mixed)
        │       │
        ▼       ▼
     plan_open ─── plan applied ──▶ resolved
        │
        │ plan discarded / failed / cancelled
        ▼
     classified
```

**Invariant**: An InboxItem has at most one Plan in open state at any
time. This is enforced both at the use-case layer (`InboxConfirmUseCase`
checks `inbox_plan_links` before creating a plan) and at the database
layer (partial unique index).

**Repair**: A background query runs every 5 minutes checking `plan_open`
items whose linked plan has reached a terminal state; it transitions the
item to the appropriate post-plan state. (Ref: R-PlanOpen)

## Relationships

```
InboxRoot 1 ──< * InboxItem 1 ──? 1 InboxClassification
                              \
                               1 ──? 1 InboxPlanLink ──> Plan (spec 017)
                              /
                              * InboxClassificationEvidence
```

## Notes On Reproducibility

Per constitution principle V, `InboxClassification` and
`InboxClassificationEvidence` are **projections** derivable from file
metadata. They are cached in SQLite for speed and UI responsiveness but
can be recomputed at any time without loss (given unchanged files on disk).
The durable records owned by this feature are `InboxItem.state` and
`InboxPlanLink`.
