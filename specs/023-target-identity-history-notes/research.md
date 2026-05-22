# Research: Target Identity, History, And Notes

**Spec**: 023-target-identity-history-notes | **Date**: 2026-05-20

## R1. Target Identity Resolution Boundary

### Question

Where does spec 013 (Target Lookup From FITS `OBJECT`) end and spec 023 begin?

### Decision

- **Spec 013** owns extraction of the FITS `OBJECT` hint, suggestion
  generation against catalog candidates, and surfacing the suggestion UI
  during import.
- **Spec 023** owns the durable target record that a confirmed suggestion is
  attached to: id, primary name, aliases, catalog refs, notes, and the
  history views derived from `TargetSession` and `TargetProject`.

When a user confirms a spec 013 suggestion, the import use case writes
`session.target_id = target.id` against the target record defined here. If
no target exists for the confirmed designation, the target is created on
first confirmation.

### Rationale

This split keeps spec 013 focused on hint quality and confidence, and keeps
spec 023 focused on identity persistence and history aggregation.

## R2. Alias Management Policy

### Question

How are aliases added, normalized, and conflict-checked?

### Decision

- Aliases are stored as structured `catalog_refs` of shape
  `{ catalog: String, designation: String }` plus a free-string `aliases[]`
  list for user nicknames that do not belong to a known catalog.
- Normalization on add: trim whitespace, collapse internal whitespace,
  case-insensitive comparison, treat `M 31` / `M31` / `Messier 31` as
  variants of the same canonical Messier reference.
- Conflict policy: if the normalized alias is already attached to a
  different target, the add fails with `alias.duplicate` and returns the
  conflicting `target_id` in `details`. The user must resolve via a manual
  merge/split workflow (deferred from v1).
- Aliases on the originating target are idempotent: adding an alias that is
  already present is a no-op success.

### Alternatives considered

- **Free-string aliases only**: rejected because catalog refs must support
  structured lookup (e.g. for cross-referencing with spec 014 catalog index).
- **Silent merge on duplicate**: rejected; merging targets is destructive
  enough that it requires explicit user review.

## R3. History By Date And `captured_on` Derivation

### Question

How are sessions ordered and grouped on target detail, and how is `captured_on`
derived?

### Decision (A5, R-3.1 — 2026-05-22)

**`captured_on` derivation formula:**

```
captured_on = local_date_of(frame.exposure_start_utc - 12h)
```

where `local_date` is the UTC date shifted by −12 h, then interpreted in the
timezone of `AcquisitionSession.observer_location.tz`.

This is the "solar-noon boundary" rule: an observation that begins just after
midnight local time belongs to the previous calendar date (the start of the
observing night), not the new calendar date.

Reference: `AcquisitionSession.observer_location: ProvenancedValue<ObserverLocation>`
(spec 002 data-model.md §ObserverLocation).

**Null rule (R-3.1):** When `AcquisitionSession.observer_location` is null
or in `unreviewed` state (i.e. not yet confirmed), `captured_on = null` and
the session is **excluded** from the target history list until
`observer_location` is reviewed. The session remains in the spec 002
`needs_review` queue with `observer_location` as the blocking field
(`provenance.unreviewed` error code per spec 002). Once the user reviews
`observer_location`, `captured_on` is derived and the session appears in
history on next `target.get` call.

**Ordering and display:**

- Sessions with a valid `captured_on` are ordered reverse-chronologically.
- v1 renders a flat list; year grouping is a cosmetic enhancement deferred
  to a follow-up. `captured_on` is exposed as a full date so the UI can
  group later without a contract change.
- Sessions surface filter, exposure, and frame count for at-a-glance reuse
  decisions.

### Rationale

Astrophotographers think in terms of "the night of" capture, not file
timestamps. The −12 h rule captures the conventional solar-noon-to-solar-noon
observing night boundary. Excluding sessions with unreviewed observer_location
ensures `captured_on` values are trustworthy when displayed.

## R4. Observing Notes: Per-Target vs Per-Session

### Question

Where do user notes live? Per target, per session, or both?

### Decision

Both, with distinct semantics:

- **Per-target note** (this spec): durable observation context about the
  target itself — framing intent, plate-scale plans, ongoing capture goals.
  Survives session deletion and alias edits.
- **Per-session note** (spec 005 / acquisition session model): captured-on
  context — seeing, transparency, equipment problems. Lives with the session
  row, not the target.

Target detail renders only the per-target note in its notes section;
per-session notes remain attached to their session rows inside the sessions
list.

### Alternatives considered

- **Single notes blob per target**: rejected because session-specific
  context loses meaning when surfaced under an aggregate.
- **Notes only per session**: rejected because users need durable target
  intent that outlives any individual session.

## R5. Observing Plan References Scope

### Question

Where do observing-plan references attach?

### Decision

Out of scope for v1 of this spec. Observing-plan references remain a future
addition; the contract surface intentionally omits them so the v1
implementation can ship without a planning-tool integration commitment.
Re-evaluate after a research pass on which planning systems (NINA, SkySafari,
Stellarium plans) are recognized first.
