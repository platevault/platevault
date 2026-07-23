# Data Model: Inbox — Drop Parent Items

**Feature**: 058-inbox-drop-parent-items | **Date**: 2026-07-19

**Verified against**: branch `spec/058-plan-gate` (worktree). Every line
reference below was read, not inferred. Corrections to `plan.md`/`research.md`
citations are marked **[corrected]**.

Principle: reuse existing tables. This feature adds **one** column (FR-028) and
otherwise changes *which rows are written* and *what one existing column is
allowed to mean*. No table is created, and per D-004 no data migration is
written.

## Entities

### Source group — existing `inbox_source_groups` (`0049:39-50`)

The folder-level identity for one scanned leaf directory. **Unchanged
schema.** This feature promotes it from a bookkeeping side-table to the
canonical folder anchor (FR-019) and to a *displayed* queue row (FR-016).

| Column | Type | Meaning after 058 |
|---|---|---|
| `id` | TEXT PK | folder identity; the sibling-set key (FR-005, D-002) |
| `root_id` | TEXT NOT NULL | library root — identity stays root-scoped |
| `relative_path` | TEXT NOT NULL | leaf folder relative to the root |
| `discovered_at` / `last_scanned_at` | TEXT | upsert preserves `discovered_at` on re-scan (`inbox.rs:285-320`) |
| `content_signature` | TEXT | folder-level signature written by scan (`commands/inbox.rs:331`). **Becomes the sole folder-level anchor** once the placeholder row stops duplicating it (FR-019) |
| `format` | TEXT | `fits`/`xisf`/`video`/`mixed` |
| `lane` | TEXT | **`move` \| `catalogue`** — derived from the root's `organization_state` (`commands/inbox.rs:307-313`) |
| `child_count` | INTEGER | number of materialized items; set by `materialize_sub_items` (`classify.rs:1003`) |

UNIQUE `(root_id, relative_path)` — the upsert conflict target. Two folders at
the same relative path under different roots are distinct rows, which is why
D-007 groups the list on `source_group_id` and never on the path string.

> **[corrected] Two different columns are named `lane`.**
> `inbox_source_groups.lane` is `move`/`catalogue` (no CHECK).
> `inbox_items.lane` is `fits`/`video` with `CHECK (lane IN ('fits','video'))`
> (`0049:104-105`). The spec's assumption "the lane distinction (move versus
> catalogue) remains a folder-level property of the source group" is correct
> **about the source group only** — the item column is a different concept with
> the same name. This conflation already caused a live bug (#1021). Any code
> reading "lane" during this feature must state which table it means.

**Cardinality to items**: zero after scan (FR-015), N after classification
(FR-002/003). Never one-plus-a-placeholder.

### Inbox item — existing `inbox_items` (`0049:84-114`, `0043` columns)

One actionable queue unit: the files of one folder that share a classification
identity.

| Column | Type | Change |
|---|---|---|
| `id` | TEXT PK | — |
| `root_id`, `relative_path` | TEXT NOT NULL | — |
| `source_group_id` | TEXT → `inbox_source_groups(id)` ON DELETE SET NULL | now **always** set for folder-derived items (NULL only for master items) |
| `group_key` | TEXT NOT NULL DEFAULT `''` | **narrowed to classification identity only** — see FR-028 below |
| `group_label` | TEXT | display label |
| `frame_type` | TEXT CHECK(`light`\|`dark`\|`bias`\|`flat`\|`dark_flat`) | must be non-NULL whenever `state='classified'` (FR-007) |
| `file_count` | INTEGER | — |
| `content_signature` | TEXT | per-group signature (`classify.rs:930-935`), the sole confirm anchor once the parent is gone |
| `state` | TEXT CHECK(`pending_classification`\|`classified`\|`plan_open`\|`resolved`) | — |
| `lane` | TEXT CHECK(`fits`\|`video`) | — |
| `format`, `is_master_item`, `master_*` | | — |
| **`needs_review`** | **INTEGER NOT NULL DEFAULT 0 CHECK (0,1)** | **NEW (FR-028)** |

UNIQUE `(root_id, relative_path, group_key)` (`0049:113`) — this is what lets N
siblings coexist at one folder path today, and it is why the model needs no new
structural concept.

Related rows, all already keyed on `inbox_items.id` and therefore already
sibling-safe:

| Table | Key | Note |
|---|---|---|
| `inbox_classifications` | `inbox_item_id` PK, `result CHECK ('classified','unclassified')` | **[corrected]** the CHECK collapse is migration **0049:191**, not 0048. `classify.rs:390` and `confirm.rs:211` both cite 0048; those comments are wrong |
| `inbox_classification_evidence` | `inbox_item_id` FK, one row per file | `0020:56-74` |
| `inbox_file_metadata` | `inbox_item_id` FK | — |
| `inbox_plan_links` | `inbox_item_id` **PRIMARY KEY** (`0020:105-110`) | at most one plan per item, structurally (FR-011) |

### Sibling set — derived, not a table

The items sharing one `source_group_id`. A set of any size, with **no
distinguished member and no shared lifecycle** (D-002/D-003). It is not
materialized anywhere; it is `SELECT … WHERE source_group_id = ?`.

Two existing helpers read this set and must not be read as "the item for this
folder":

- `list_inbox_sub_items` (`persistence/db/.../inbox.rs:632-646`) — filters
  `group_key != ''` purely to skip the placeholder. The filter becomes dead once
  no source-group-backed row has an empty key.
- `list_item_ids_for_source_group` (`inbox.rs:1451-1461`) — `ORDER BY id`, no
  semantics. Its one consumer, `target_recommendations::resolve_item_id`
  (`target_recommendations.rs:227-232`), takes `ids.next()`. **That is
  arbitrary today and undefined under this model** — it is #1102, and per
  `plan.md`'s risk table it must be decided before the placeholder is removed.

## The FR-028 change: what `group_key` carries

`group_key` is one column doing four jobs today. FR-028 requires it to do one.

| Role | Encoded as | Written at | After 058 |
|---|---|---|---|
| **1. Classification identity** | `type=<ft>·<dims…>` from the grouping engine | `classify.rs:906-908` | **kept — the only role** |
| **2. Needs-review flag** | `__needs_review__` sentinel | `classify.rs:911`, `:915` (const at `:699`) | moves to `needs_review` |
| **3. Uniqueness discriminator** | `type=<ft>·resolved=<item_id>` | `clear_needs_review_sentinel` (`inbox.rs:589`) | **removed, not replaced** |
| **4. Placeholder marker** | `''` | `insert_inbox_folder_placeholder` (`q_desktop.rs:38-41`, column default) | removed with the placeholder |

Role 3 exists only because reclassify v1 mutates a row in place rather than
re-splitting, so promoting a sentinel row to its real identity could collide
with a sibling already holding that identity (the comment at `inbox.rs:576-581`
says exactly this). Under this model a collision is not a problem to dodge — two
rows with the same classification identity in the same folder **are the same
item**, and the existing `ON CONFLICT(root_id, relative_path, group_key) DO
UPDATE` in `upsert_inbox_sub_item` (`inbox.rs:526-533`) already converges them.
So role 3 is deleted by routing the sentinel-resolve path through
materialization instead of in-place rewrite, which is what `reclassify_v2`
already does (`classify.rs:870` caller B).

> **Role 4 does not vanish entirely.** `insert_inbox_master_item`
> (`q_desktop.rs:88-110`) never sets `group_key`, so detected calibration
> masters keep `group_key = ''` **and** `source_group_id IS NULL`. The invariant
> must therefore be scoped: *no row with a non-NULL `source_group_id` may have
> an empty `group_key`* — not the unscoped "no empty group keys". The existing
> suppression predicate already carries this scoping
> (`i.source_group_id IS NOT NULL`, `inbox.rs:1498`); the invariant inherits it.

### Migration shape

One additive column, no backfill, no data migration:

```sql
ALTER TABLE inbox_items
    ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0
        CHECK (needs_review IN (0, 1));
```

Why this shape:

- **Additive, not a table rebuild.** SQLite `ADD COLUMN` with a NOT NULL DEFAULT
  is a metadata-only operation. The 0049 rebuild pattern is only needed to
  change a UNIQUE constraint or drop a column, and this does neither.
- **Durable, not derived.** `confirm` gates on it directly (today
  `confirm.rs:174` reads `group_key`), and the list must render it without an
  N-file aggregate per row. It is the persisted verdict of the mandatory-attribute
  gate at materialization time — same lifecycle and same authority as
  `frame_type`. This answers `plan.md`'s post-Phase-1 constitution re-check:
  **durable record state (Constitution V), not presentation.** The presentation
  concern is `missing_mandatory`, which stays derived.
- **No data migration (D-004).** Existing rows take the `0` default and are
  wrong for any row currently carrying the sentinel. That is acceptable *and
  intended*: there are no installs, and 058 explicitly does not preserve
  existing inbox state (FR-027). **Nobody should build a backfill.** If this
  lands after the product has real users, D-004's licence lapses and Q-1
  reopens — the column is then no longer the whole story.

> **Migration number.** Highest on `origin/main` is `0073`. The next free
> number is `0074`, but open PR #1048 currently adds `0072_onboarding.sql` and
> `0073_drop_guided_flow_state.sql`, which already collide with `main` and will
> renumber upward. Re-check the free number at implementation time —
> a duplicate version aborts `migrate()` on a fresh DB.

### Contract surface

`needs_review` becomes a field on `InboxListItem` (see `contracts/`), replacing
the frontend's current two-signal guess at `InboxList.tsx:63-68`
(`groupKey === '__needs_review__' || missingMandatory.length > 0` — the second
disjunct is dead, because `inbox_list` hardcodes `missing_mandatory: Vec::new()`
at `commands/inbox.rs:564`).

## Inbox item state transitions

`state` values are fixed by `0049:97-103`. This feature changes which
transitions exist, not the enum.

```
                       (no item row exists)
                                │
                                │  scan  ──▶ creates only the source group (FR-015)
                                │            NO inbox_items row (FR-001, D-006)
                                ▼
   classify / reclassify ─── materialize_sub_items ───▶  classified
                                                          (one row per group)
                                                                │
                                                 confirm ───────┤
                                                                ▼
                                                            plan_open
                                                                │
                                            plan applied ───────┤
                                                                ▼
                                                             resolved
```

`pending_classification` survives only as the state of a **master item**
(`q_desktop.rs:40`); after FR-015 no folder-derived row is ever created in it,
because folder-derived rows are created by materialization, which writes
`state = 'classified'` unconditionally in the same statement
(`inbox.rs:525`, `:532`).

Plan-driven reverse transitions are unchanged and already exist:
`plan_listener.rs` returns an item to `classified` when its plan reaches
`partially_applied`, `failed`, or `cancelled`.

### FR-029 — the atomic transition

Resolving a needs-review item MUST record **frame type + classification identity
+ `classified` state** as one transition, with no observable intermediate in
which the row reports `classified` without a frame type.

Today exactly one statement does this — `clear_needs_review_sentinel`
(`crates/persistence/db/src/repositories/inbox.rs:584-600`, statement at
`:590-598`):

```sql
UPDATE inbox_items SET group_key = ?, frame_type = ?, state = 'classified'
 WHERE id = ? AND group_key = '__needs_review__'
```

**Any replacement must write all three (now four, with `needs_review`) in one
statement.** Splitting them recreates FR-007's violation — a row reporting
`classified` with a NULL `frame_type` — in a new location, which is the exact
failure this feature exists to remove.

The replacement already exists in generalized form:
`upsert_inbox_sub_item` (`inbox.rs:507-550`) writes `group_key`, `frame_type`
and `state='classified'` in a single `INSERT … ON CONFLICT DO UPDATE …
RETURNING id`. Extending it with `needs_review` keeps the transition atomic and
deletes a near-duplicate write path rather than adding one.

Two properties of that statement are load-bearing and must survive:

- `RETURNING id` yields the **persisted** id, which differs from the
  caller-generated id on conflict. Seeding evidence against the discarded id
  FK-fails and strands the real row (issue #854 — documented at `inbox.rs:512-519`).
- The `ON CONFLICT` target is the `(root_id, relative_path, group_key)` UNIQUE,
  which is what makes convergence-on-collision the default rather than an error.

## Invariants

- **INV-1** (FR-001/004/007): no `inbox_items` row exists with a non-NULL
  `source_group_id` and an empty `group_key`. Master items (`source_group_id IS
  NULL`) are exempt.
- **INV-2** (FR-007, SC-003): `state = 'classified'` implies `frame_type IS NOT
  NULL` **or** `needs_review = 1`. No row reports a classification it does not
  carry.
- **INV-3** (FR-028): `group_key` encodes classification identity only. It
  carries no flag and no uniqueness discriminator.
- **INV-4** (FR-029): frame type, `group_key` and `state` change together in one
  statement, along with `needs_review`.
- **INV-5** (FR-002/003, D-001): a classified source group has exactly
  `child_count` item rows and no others; `child_count = groups.len()`
  (`classify.rs:926`, `:1003`).
- **INV-6** (D-002/D-003, FR-006/010/011/012): nothing derives one sibling's
  state, classification, signature or plan from another's. `inbox_plan_links`
  enforces the plan half structurally (PK on `inbox_item_id`).
- **INV-7** (FR-015/016, D-006): between scan and classification a folder has a
  source-group row and **zero** item rows.
- **INV-8** (FR-019): the folder-level content signature lives on
  `inbox_source_groups.content_signature`; per-item signatures on
  `inbox_items.content_signature` cover only that item's own files (FR-013).
- **INV-9** (FR-018, SC-008): re-scanning an unchanged folder changes no item
  id. Rests on the `(root_id, relative_path, group_key)` upsert key, not on any
  parent row.

## Known-surviving exception (PG-3)

Two folder-wide interlocks survive this feature untouched, both recorded rather
than removed:

1. `reclassify_v2` refuses when **any** sibling in the group has a plan link —
   `crates/app/inbox/src/reclassify.rs:346-362` (**[corrected]**: `plan.md` and
   `spec.md` both cite `:347-360`; the block is the loop at `:353-361` preceded
   by the id fetch at `:349-351`).
2. `classify()` filters the materialization gate on `state != 'plan_open'` —
   `classify.rs:433` — so the scan/classify path also declines re-derivation for
   a plan-open item.

Both guard `delete_sub_item_if_unlinked` (`inbox.rs:610-620`), which **silently**
refuses to delete a plan-linked row. Removing either without D-005's
invalidation path yields a queue row with an open plan and nothing on disk
behind it — the "keep and show" outcome D-005 rejects. Per-item `reclassify`
blocks only on the item's own plan (`reclassify.rs:81-89`) and is already
D-003-consistent.
