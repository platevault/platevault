# Contract: Log Viewer (FR-025)

Reconciles spec 019 drift (no conformance tests exist today, so these went unnoticed).

## Version
- Runtime `contractVersion` MUST equal the schema's `const`. Today runtime emits `"1"` while the schema
  pins `"2.0.0"` → schema validation would reject all real entries. **Decision: align runtime to the
  schema `const` (`"2.0.0"`).**

## Diagnostic cursor
- The `dia:` cursor MUST be parsed so diagnostic resume continues from the cursor; today it is ignored and
  resume silently replays the full window. Parse and honor `dia:` cursors.

## Export
- `log.export` response MUST include a `status` field (currently missing).
- Export path MUST come from a **file picker**, not a hardcoded `/tmp` (FR-030 relates for dev export).

## Conformance
- Test: a real log entry validates against the schema with matching `contractVersion`.
- Test: a `dia:`-cursored resume returns only entries after the cursor (no full replay).
- Test: `log.export` response includes `status`; export writes to the chosen path.
