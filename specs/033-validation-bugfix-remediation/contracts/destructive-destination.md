# Contract: Destructive Destination (FR-038, FR-006)

Resolves the 0014 (`archive`/`os_trash`) ↔ 0019 (`trash`/`archive`/`none`) drift. Decision **D1**.

## Canonical enum
```
DestructiveDestination = "archive" | "trash"
```
- `archive` — move into the app archive root.
- `trash` — OS recycle bin / Trash / XDG trash (via the `trash` crate, D4).
- **No `none`**, **no `os_trash`**, **no `permanent`**. Permanent deletion is a separate, gated action
  type (spec 017 permanent-delete gate + destructive-confirm), never a destination value.

## Where it appears
- Plan item `destination` field (only when the action is destructive).
- Inbox confirm request (FR-032 — the UI must surface the choice and send it; no silent default).
- Apply result audit row records the destination actually used (and `archive` fallback when `trash`
  was requested but unavailable — FR-006).

## Conformance
- Schema rejects any value outside `{archive, trash}`.
- Test: a destructive plan item serialized/deserialized round-trips only the two values; legacy
  `os_trash` rows are migrated (0032) and fail the new schema if reintroduced.
- Test: requesting `trash` on a platform without a working bin yields an audit row with
  `destination=archive` and a recorded fallback reason.
