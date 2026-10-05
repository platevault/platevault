# Storage custody data model

## Durable entities

STO records are Tier 1 filesystem-mutation intent and outcome records in the clean library catalog. Each review, phase intent and outcome commits in one writer transaction before or after the filesystem action it names. STO writes only the tables listed here, plus the asset repoint and basis rebinding of [research](research.md) R13.

- CleanupReview: UUID, View ID, scope `view` or `replaced_entries`, the View revision and preparation revisions it read, decision revision 1, state `reviewed`, `applied` or `superseded`, and creation time. It holds the selected items with their basis, the retained entries, explicit protected selections, per-volume Trash support and the reference kinds consulted for STO-FR-02. Confirmation is single-use.
- TransferReview: UUID, kind `archive` or `filing`, the `ExpectedSession` values, the destination location ID, its expected revision and folder, and state as for cleanup. It records destination volume identity, free bytes, writability, footprint, expected reclaim, items, references, blockers and consulted reference kinds. A filing review also states that its files are already indexed.
- StorageOperation: UUID, review ID, kind, state `running`, `settled` or `interrupted`, a revision incremented on every item commit, and start and settle times. It records the source volume's free bytes at start and settle and a summary that reads `complete` or `partial`.
- StorageItem: operation ID, item ID, kind `trash` or `transfer`, the reviewed basis, phase, state `pending`, `running`, `done` or `held`, and an optional hold of `blocked`, `uncertain` or `failed` with reason and message. A transfer item adds the asset ID, source path, snapshot, destination path, method `copy` or `same_volume_link` and the recorded destination identity. A trash item adds the PREP entry ID or the RES or CAL record ID, and the Trash evidence path.
- ItemReference: operation ID, item ID, PREP entry ID, View ID, preparation ID, current mode, proposed mode, the user's choice when required, outcome `pending`, `completed`, `blocked` or `uncertain`, and reason.
- StorageClaim: location ID and lossless relative path key, primary key together, with operation ID, item ID and role `destination` or `source`. A claimed path is never indexed and never part of absence reconciliation.
- AssetRepoint: asset ID, operation and item IDs, old and new location ID, relative path and fingerprint, and the verification time. Assets keep their ID; the repoint row is history for X7.

## Cleanup groups

PREP, RES and CAL records supply roles; STO assigns groups and defaults. Proof is required before removal as in [research](research.md) R7 and R8.

| Group | Roles | Default | Proof before removal |
| --- | --- | --- | --- |
| Calibrated intermediates | RES `intermediate_calibrated` | selected | entry basis |
| Registered intermediates | RES `intermediate_registered` | selected | entry basis |
| Other intermediates | RES `intermediate_other`, including stacking and calibration XISF | selected | entry basis |
| Temporary files and caches | RES `temp_cache` | selected | entry basis |
| Prepared inputs | PREP symlink, hardlink, copy, patched copy, clone and staging entries | unselected | link: identity and link text; others: entry basis and retained original |
| Verified duplicates | a file with an LIB `identical` copy link to a registered copy that the cleanup keeps | unselected | entry basis and the named kept copy |
| Logs and manifests | RES `log`, PREP manifest, Direct-source and input-list files | unselected | entry basis |
| Still being written | RES write state pending | unselected | always blocked |
| Unknown | RES `candidate`, including an unaccepted stack, and any file no record names | unselected | entry basis |
| Keep | RES accepted products, CAL candidate and adopted masters, CAL retained adoption sources | protected | explicit selection naming the product or master and its dependent Views, plus entry basis; a retained source also names its verified kept copy |

A library asset of a Captures or Calibration location appears in no group. Selecting a group selects its files, never a directory.

## Per-file evidence

Each file shows its path, role, recognition evidence, other View and Project references and estimated bytes. It also shows a reclaim class: `expected` for a sole copy, `shared_link` for a hardlink, `link_only` for a symbolic link and `not_guaranteed` for a clone. Retained-original evidence reads `verified` with the kept copy, path and verification time, `insufficient` with a reason, `unavailable` or `not_required`. Preview shows recorded evidence; review records fresh evidence.

## Cleanup item states

A trash item moves `pending` to `running` with its intent committed, then to one outcome:

- `trashed`: the Trash path and the moved item's file identity are recorded.
- `refused`: Trash is unsupported; the item offers `keep_files` and `reveal_location`.
- `blocked`: stale identity, insufficient proof, an unavailable source or ambiguous ownership.
- `absent`: the entry was gone before the call.
- `uncertain`: the call was interrupted.

No state deletes a file. The operation summary lists trashed and remaining entries by name. It reads `partial` unless every reviewed item is `trashed`.

## Transfer phases

| Phase | Reached when | Commit with it |
| --- | --- | --- |
| `pending` | review applied | claims on destination paths |
| `destination_written` | file created with `create_new`, copied or linked, file and parent flushed | destination identity |
| `destination_verified` | re-read SHA-256 equals the snapshot | verification time |
| `references_updated` | every ItemReference reads `completed` | asset repoint, basis rebinding, destination claim released, source claim added |
| `source_retired` | source rehash equals the snapshot and the Trash move verified | source claim released, Trash path |

Each phase intent commits before its action. A failure holds the item at its last phase. Reasons include `hash_mismatch`, `destination_unavailable`, `identity_conflict`, `collision`, `insufficient_space`, `reference_blocked`, `source_drift`, `trash_unsupported` and `references_unverified`. `source_drift` and `trash_unsupported` end the item as source retained and release the source claim, so the next scan indexes the kept file. The user sees four groups per item: destination verified, reference updated, source retained, and pending or uncertain work.

## Reference modes

| Current mode | Same volume | Cross volume |
| --- | --- | --- |
| symbolic link | new target, no choice | new target, no choice |
| hardlink | unchanged; the destination shares the file | choice required: `symlink` or `keep_local_copy` |
| copy, patched copy, clone | unchanged | unchanged |
| Direct-source or input-list path | rewritten through the PREP renderer | rewritten through the PREP renderer |

A review with a required choice unanswered is blocked. `keep_local_copy` leaves the entry holding the bytes and reports zero expected reclaim for that asset.

## Atomicity and durability

Every command is one `BEGIN IMMEDIATE` transaction on the FULL-synchronous writer. Confirmation compares the review state, decision revision and every expected record revision. It marks the review applied, creates the operation and inserts claims together. Any failure leaves STO rows unchanged and reports Conflict, NotFound, InvalidInput, IdentityConflict, SourceUnavailable or PersistenceFailure. A disposable `max_page_count` catalog proves that SQLITE_FULL returns PersistenceFailure and persists nothing after reopen. Restart marks Running operations `interrupted` and in-flight items `uncertain`. Committed reviews, phases, references and claims survive restart unchanged.

## Overview

Storage reads one reader snapshot and no file bytes. It lists registered locations with role, lifecycle and availability. View footprints come from PREP, RES and CAL records and no-follow metadata, grouped by reclaim class. Duplicate groups name every physical copy with its location and availability: `identical` from verified digests, `candidate` from size and start time, `conflicting` for diverged copies. Transfers list their operations with per-phase counts. No overview row offers removal.
