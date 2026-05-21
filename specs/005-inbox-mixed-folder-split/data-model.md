# Data Model: Inbox Mixed-Folder Split

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Date**: 2026-05-20

## Entities

### InboxItem

A candidate folder discovered under an Inbox root. One row per folder.

| Field | Type | Notes |
|---|---|---|
| `id` | `InboxItemId` (ulid) | Stable across rescans of the same path. |
| `root_id` | `InboxRootId` | FK to scanned Inbox root. |
| `relative_path` | `string` | Path relative to root; remap-friendly. |
| `file_count` | `int` | Files counted at scan time. |
| `discovered_at` | `Timestamp` | First-scan time. |
| `last_scanned_at` | `Timestamp` | Most recent scan completion. |
| `content_signature` | `string` | Filename+size+mtime digest; not a file hash. |
| `state` | `InboxItemState` | See below. |

**InboxItemState** enum:

- `pending_classification`
- `classified`
- `plan_open` — there is an open Plan; see [InboxPlanLink](#inboxplanlink).
- `resolved` — a plan reached `applied`.

Invariants:

- An InboxItem in `plan_open` MUST have exactly one row in
  `inbox_plan_links` pointing at a Plan whose state is open
  ({`draft`, `ready_for_review`, `approved`, `applying`}).
- Transition from `plan_open` → `classified` occurs when the linked Plan
  becomes `discarded` or `failed`.
- Transition from `plan_open` → `resolved` occurs when the linked Plan
  becomes `applied`.

### InboxClassification

A classifier result for an InboxItem. Recomputable; cached.

| Field | Type | Notes |
|---|---|---|
| `inbox_item_id` | `InboxItemId` | FK. |
| `result` | `ClassificationResult` | See below. |
| `confidence` | `f32` in [0,1] | Folder-level aggregate. |
| `computed_at` | `Timestamp` | |
| `content_signature` | `string` | Matches InboxItem at compute time; invalidates on drift. |
| `breakdown` | `InboxBreakdown[]` | Per-frame-type rows. |
| `unclassified_files` | `string[]` | Relative filenames in "Needs review". |
| `sample_files` | `string[]` | Up to ~10 representative filenames. |

**ClassificationResult** enum:

- `single_type { frame_type: FrameType }`
- `mixed { frame_types: FrameType[] }`
- `unclassified`

### InboxBreakdown

One row per detected frame type within a `mixed` (or single-type)
classification. Rendered in the detail drawer.

| Field | Type | Notes |
|---|---|---|
| `kind` | `FrameType` | LIGHT / DARK / BIAS / FLAT / DARK_FLAT |
| `count` | `int` | Files attributed to this kind. |
| `destination` | `string` | Preview path produced by the active Naming & Structure pattern (spec 015). Resolved at classification time for preview only; **not** the canonical plan destination (which is resolved again at plan-generation time). |
| `sample_files` | `string[]` | Representative filenames. |

### InboxClassificationEvidence

Per-file evidence record. Persisted only for files that contributed to a
classification decision or were flagged unclassified.

| Field | Type | Notes |
|---|---|---|
| `inbox_item_id` | `InboxItemId` | FK. |
| `relative_file_path` | `string` | |
| `frame_type` | `FrameType?` | Null when unclassified. |
| `confidence` | `f32` in [0,1] | |
| `evidence_source` | `EvidenceSource` | `imagetyp_header` / `xisf_property` / `filename_strict` / `filename_loose` / `none` |
| `raw_value` | `string?` | Original header or filename match for audit. |

### FrameType

```
enum FrameType { Light, Dark, Bias, Flat, DarkFlat }
```

Normalization rules and aliases live in `crates/metadata/core`; see
[research.md](./research.md).

### InboxPlanLink

Enforces the "at most one open Plan per Inbox item" invariant.

| Field | Type | Notes |
|---|---|---|
| `inbox_item_id` | `InboxItemId` | PK + FK. |
| `plan_id` | `PlanId` | FK to spec 017 plan table. |
| `linked_at` | `Timestamp` | |

**Constraint**: SQLite partial unique index ensures only one link exists
per `inbox_item_id` when the referenced plan is in an open state.
Closing the plan (apply/discard/fail) deletes the link.

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
     plan_open  ─── plan applied ──▶ resolved
        │
        │ plan discarded / failed
        ▼
     classified
```

**Invariant**: An InboxItem has at most one Plan in open state at any
time. This is enforced both at the use-case layer (`InboxConfirmUseCase`
checks `inbox_plan_links` before creating a plan) and at the database
layer (partial unique index).

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
can be recomputed at any time without loss. The durable records owned by
this feature are `InboxItem.state` and `InboxPlanLink`.
