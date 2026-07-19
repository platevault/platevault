# Contracts: Inbox — Drop Parent Items

**Feature**: 058-inbox-drop-parent-items | **Date**: 2026-07-19

Language-neutral operation contracts (Constitution V). Realized as Rust DTOs in
`crates/contracts/core/src/inbox.rs`, exposed via Tauri commands in
`apps/desktop/src-tauri/src/commands/inbox.rs`, and generated into
`apps/desktop/src/bindings/index.ts` by tauri-specta. Command names are
canonical: the registered Tauri fn name MUST match the invoke target exactly
(no specta rename on an invoke target — known pitfall).

Every struct below was read on branch `spec/058-plan-gate`. Fields are marked
**[current]** or **[proposed]**; nothing is described as existing that does not.

## What is NOT changing

This section is first because it is the largest part of the answer, and a
reader coming from #711 will assume otherwise.

### `inbox.confirm` — already single-item

`InboxConfirmRequest` (`crates/contracts/core/src/inbox.rs:110-135`) carries
`inboxItemId: string` and nothing folder-shaped. `confirm.rs` operates strictly
on `req.inbox_item_id` and never resolves a folder:

| Site | Behaviour |
|---|---|
| `confirm.rs:162` | open-plan dedupe via `get_plan_link(inbox_item_id)` — per row |
| `confirm.rs:174` | needs-review gate (the one `group_key` read — see below) |
| `confirm.rs:198` | TOCTOU signature guard, compares the item's own `content_signature` |
| `confirm.rs:215` | requires `classification.result == "classified"` — already expects a single-type row |
| `confirm.rs:225` | evidence enumerated by item id |
| `confirm.rs:605` | `insert_plan_link(req.inbox_item_id, plan_id)` |

**No request or response field changes.** What changes is *which id the UI hands
it* — today, for a homogeneous folder, the placeholder's. This is the single
most load-bearing finding of `research.md` §4.2 and it holds: the confirm
contract needs re-pointing, not redesign (FR-010, FR-012).

The one internal edit is `confirm.rs:174`, which today reads
`item.group_key == SENTINEL_NEEDS_REVIEW`; after FR-028 it reads the
`needs_review` field. Same gate, same error
(`inbox.missing_path_attributes`), different source column.

### `inbox_plan_links` — already one plan per item

`inbox_item_id` is the PRIMARY KEY (`migrations/0020_inbox.sql:105-110`), so
"a plan binds to exactly one inbox item" (FR-011) is enforced by the schema
already. No contract, table or index changes. A folder yielding N items yields N
independent plans and N lines on the plan surface — a presentation consequence,
not a contract change.

### `inbox.reclassify` v2

`InboxReclassifyV2Request` (`inbox.rs:848-870`) already identifies the **source
group** (directly or via one of its item ids) and already carries
`rootAbsolutePath` — merged ahead of this feature via #1105, which closed the
Q-5 vacuous-signature hole. `InboxReclassifyV2Response` (`:897-906`) already
returns `subItems: InboxSubItemSummary[]` with no distinguished member, which is
D-002-shaped. No change.

## `inbox.list` — `InboxListItem`

### `classification_result` — **[proposed]**, not merged

`plan.md` and the task framing suggest PR #1099 may have landed. **It has not:
#1099 is OPEN as of 2026-07-19** and no `classification_result` exists on
`origin/main` or on this branch. Its proposed shape:

```jsonc
{ "classificationResult": "classified | unclassified | null" }
```

`Option<String>` with `skip_serializing_if` — additive on the wire. Sourced from
`inbox_classifications.result` for the item, added to `grouping_keys_for_items`
as a plain keyed lookup (not a GROUP BY).

**Interaction with this feature**: #1099 is a presentation-layer patch that
teaches the list badge to prefer the cached classification over `state`, because
`state` lies. 058 removes the lie at the source. If #1099 lands first, this
feature keeps the field (it is a genuinely useful truth source and FR-008
requires list, detail and classification result to agree) and deletes only its
*fallback* rationale. If #1099 does not land, 058 does not need it. **Either
ordering is safe; neither blocks the other.** Do not treat the field as present
until `crates/contracts/core/src/inbox.rs` says so.

### `needsReview` — **[proposed]**, FR-028

```jsonc
{ "needsReview": true }
```

Non-optional `bool`. Replaces the frontend's current two-signal guess at
`InboxList.tsx:63-68`:

```ts
item.groupKey === '__needs_review__' || (item.missingMandatory?.length ?? 0) > 0
```

The second disjunct is **already dead**: `inbox_list` hardcodes
`missing_mandatory: Vec::new()` (`commands/inbox.rs:564`), so the sentinel is
the list's only working needs-review signal today. After FR-028 the frontend
reads `needsReview` and the `groupKey` comparison is deleted — this is the only
production `groupKey` read in the desktop app.

### `groupKey` — **[current]**, semantics narrowed

`pub group_key: String` (`inbox.rs:403`, non-nullable, generated as
`groupKey: string` at `bindings/index.ts`). The field stays; what it may
contain narrows to classification identity only. The empty-string value
survives on the wire **only for master items** (`sourceGroupId: null`), because
`insert_inbox_master_item` never sets a group key. Clients must not read `''` as
"folder placeholder" after this feature.

### Unchanged fields worth naming

`sourceGroupId: string | null` (`inbox.rs:412`) already carries the sibling-set
key that D-007's folder grouping and FR-005's set identity need. `frameType`
(`:418`) is already the authoritative singular value. Neither changes.

## The scan / classify boundary — D-006, FR-015/016/017

### `inbox.scan.folder` — response semantics change

`InboxScanFolderResponse { rootId, items: InboxItemSummary[] }`
(`inbox.rs:315-318`). Today `items` is one row per folder **by construction**:
`inbox_scan_folder` (`commands/inbox.rs:295-377`) calls
`persist_folder_placeholder` (`:392-454`) per scanned folder, which invents an
item id, inserts the placeholder, backfills the source-group link, reads it back
via `get_inbox_placeholder_row` (`q_desktop.rs:72-87`, scoped to
`group_key = ''`), and returns exactly one `InboxItemSummary`.

**After FR-015 the entire path is deleted** and `items` contains only detected
calibration masters (`persist_master_item`, `commands/inbox.rs:458+`), which are
real single-file items and were never placeholders. For a folder of subframes,
`items` is empty.

The response shape is unchanged; its *guarantee* is not. Callers that assume
"one summary per scanned folder" break. The known one is the desktop scan flow,
which echoes the returned `contentSignature` into a later confirm
(`commands/inbox.rs:448` reads it back **from the placeholder**) — that read
must be re-sourced to `inbox_source_groups.content_signature`, which scan
already writes at `commands/inbox.rs:331`.

### Representing the unclassified folder in `inbox.list` — **[proposed]**

FR-016 requires a scanned-but-unclassified folder to be visible; `spec.md:428`
requires that row to be **not confirmable**.

**Decision: a second, separate array on `InboxListResponse`.**

```jsonc
{
  "items": [ /* InboxListItem[] — unchanged */ ],
  "sourceGroups": [
    {
      "sourceGroupId": "string",
      "rootId": "string",
      "rootAbsolutePath": "string",
      "relativePath": "string",
      "fileCount": 0,
      "format": "fits | xisf | video | mixed",
      "lane": "move | catalogue",
      "contentSignature": "string",
      "discoveredAt": "string"
    }
  ],
  "capped": false,
  "limit": 500
}
```

`sourceGroups` contains only groups with **zero** item rows — FR-017's
"replaced by its item rows" is then a consequence of the query, not a separate
step: the moment materialization writes item rows the group drops out of
`sourceGroups` and its items appear in `items`.

Non-confirmability is **structural, not enforced**: a source-group row has no
`inboxItemId`, so there is nothing to pass to `inbox.confirm`. No new error
code, no new guard.

**Rejected: a `kind: "sourceGroup" | "item"` discriminator on `InboxListItem`.**
It would restore a row that looks like an item and carries an id the UI is
tempted to confirm — which is the shape this feature exists to remove (FR-004).
A discriminated union also makes every existing consumer of `items` handle a
member that has no frame type, no state and no plan, which is precisely the
placeholder by another name.

`lane` here is the source group's `move`/`catalogue` value, **not** the item
`lane` (`fits`/`video`). The two columns share a name and do not share a
meaning; see `data-model.md`.

### Harness consequence (PG-2)

The two Layer-2 helpers assume a scan yields one *selectable, confirmable* item:

- `rescan_and_wait_for_item` — waits for an `inbox-item-*` testid immediately
  after Rescan
- `select_only_item` — clicks the first such row **and then waits for
  `inbox-confirm-btn` to mount**

> **[corrected] These live in
> `crates/e2e-tests/tests/inbox_ui_journeys.rs:135-138` and `:148-170`, not in
> `crates/e2e-tests/tests/common/mod.rs`** as `plan.md`'s Project Structure
> section states. `common/mod.rs` contains neither.

Both are called by all **five** journeys in that file (`:224`/`:230`, `:368`,
`:493`, `:554`, `:630`), including all three SC-005 journeys. Per PG-2 the
helpers split — select the source-group row after scan asserting Confirm is
**absent**; select an item row after classification asserting Confirm is
present — and land in the same change as FR-015/016.

## Read-side suppression removed — FR-026, SC-007

`exclude_split_placeholder!` (`crates/persistence/db/src/repositories/inbox.rs:1494-1506`)
and **four** call sites are deleted outright. With no aggregate row there is
nothing to suppress, and no replacement suppression may be introduced (SC-007).

| Call site | Surface |
|---|---|
| `inbox.rs:1788` — `list_unacknowledged_across_roots` | the Inbox list |
| `inbox.rs:1565` — `inbox_stats` | per-type stats |
| `inbox.rs:1603` — `count_distinct_inbox_folders` | folder total |
| `q_desktop.rs:184` — `count_unacknowledged_inbox_items` | status-bar badge |

> **[corrected] `research.md` §2 lists three call sites and says
> `count_unacknowledged_inbox_items` "has **no** dedup clause at all", to be
> "fixed for free".** That is no longer true on this branch: the function is at
> `q_desktop.rs:179-189` and **does** apply the macro, imported at
> `q_desktop.rs:13`. There are four call sites, the badge/list divergence is
> already fixed, and FR-026's deletion surface is correspondingly larger.

The `pub(crate) use exclude_split_placeholder;` re-export (`inbox.rs:1512`) and
the tests that exist only to prove suppression works go with them.

## Contract invariants

- No operation in this feature mutates the filesystem. Confirm still produces a
  reviewable plan before any mutation, and confirm's own logic is untouched
  (Constitution II).
- `inbox.confirm` operates on exactly one `inboxItemId` and never resolves a
  folder (FR-010). No sibling's state, classification or plan binding is
  observable from another's (FR-006).
- A source-group row exposes no item id and is therefore not confirmable
  (FR-016, `spec.md:428`).
- `needsReview` and `classificationResult`, where present, are read from the
  same durable rows `inbox.classify` reads, so the list, the detail panel and
  the classification result agree by construction (FR-008, FR-030, SC-001).
- All additive fields are `skip_serializing_if` or defaulted, so the wire
  surface stays backward-compatible even though D-004 does not require it.
- Errors use the spec-046 error-code registry. This feature adds none.
