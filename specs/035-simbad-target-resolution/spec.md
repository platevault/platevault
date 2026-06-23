# Feature Specification: SIMBAD Target Resolution (online resolver + bundled seed + local cache)

> **Cross-spec impact**: This feature **supersedes** the catalog-distribution mechanism of
> [Spec 014 — Catalog Index Licensing](../014-catalog-index-licensing/spec.md) (download bundled
> catalog files + signed manifest + auto-update) and the offline-index resolution approach of
> [Spec 013 — Target Lookup From FITS OBJECT](../013-target-lookup-from-fits-object/spec.md). It
> retains and reuses the **target-identity model** from spec 013 (canonical target, catalog
> references, aliases, dedup). Online name resolution — previously deferred in spec 013 R4 — becomes
> the primary mechanism. Design rationale: `docs/development/catalog-data-pipeline-plan.md`.
>
> **Extended (2026-06-23) by [Spec 041 — Inbox Plan Surface](../041-inbox-plan-surface/spec.md), iteration "single-type inbox sub-items".**
> 041 adds **coordinate-based** target resolution at light ingestion (FOV-aware nearest-neighbour of
> the image `RA`/`DEC` against this spec's target DB) and auto-propagation of the chosen target to
> linked projects (041 FR-052, R-17; tasks T074/T075). The two **compose**: 041's coordinate-NN is
> the ingest path and reuses this spec's target-identity model + resolver; this spec's **name**
> resolution remains the manual/typed-search path. Per 041, the FITS `OBJECT` header is used only as
> an initial display name, not as a search key.

**Feature Branch**: `035-simbad-target-resolution`

**Created**: 2026-06-18

**Updated**: 2026-06-23

**Status**: Implemented — resolver + seed + cache + ingest grouping shipped (PRs #250–252, #307/#309). Validated end-to-end 2026-06-23: resolver unit 55/55, `simbad_resolution_integration` 4/4, `target_search_seeded` 8/8, `ingest_sessions_integration` 2/2.

**Input**: User description: "Resolve target identities on demand against the SIMBAD astronomical
database, backed by a bundled seed index of popular catalogues and a growing local cache; supersede
the hosted/downloaded signed-catalog feature. Desktop tool, connectivity assumed at import/organize
time, SIMBAD trusted."

## Overview

Astro Library Manager needs to recognise *which astronomical target* an image or a project refers
to — turning a designation or name (from a FITS `OBJECT` header, or typed by the user) into a single
canonical target identity with coordinates, object type, and all known aliases, so images and
projects group correctly (e.g. `M31`, `NGC 224`, and `Andromeda Galaxy` are one target).

This is a **desktop image-library management tool** used with internet connectivity at the time of
import and organisation (not a field/offline imaging tool). Given that, the product resolves targets
**on demand against SIMBAD** (the CDS astronomical cross-identification database, the authoritative
source for designations, coordinates, object types, and aliases), and **caches** every resolution
locally so each object is resolved at most once. A **bundled seed index** of the popular catalogues
ships with the app and pre-populates the local cache at first run, so the common cases are instant
and require no network.

This replaces the previous plan to build, host, sign, and auto-update our own catalog files. Because
SIMBAD is trusted over TLS, no catalog signing/verification or hosted manifest is required.

## Clarifications

### Session 2026-06-18

- Q: When ingesting images, how should OBJECT-header resolution against SIMBAD happen? → A: Asynchronous background queue — ingest never blocks; seed/cache hits resolve immediately, the long tail is enqueued and resolved in the background (images marked pending until resolved).
- Q: Can the user manually override/correct a resolved target identity, and does it persist over SIMBAD? → A: Yes — a manual override is stored (source = user-override) and takes precedence over future SIMBAD/seed resolutions for that object.
- Q: Should there be a settings toggle to enable/disable online SIMBAD resolution? → A: Yes — an enable/disable toggle, default ON; when disabled, resolution uses only the bundled seed + local cache.
- Q: Is ingest `OBJECT`→target resolution exact-match or fuzzy/inferred? → A: Exact normalized designation/identifier match against cache/seed/SIMBAD only — no fuzzy or probabilistic matching. A value that does not match exactly (or is ambiguous across physical objects with no user selection) is marked unresolved/pending (FR-009). Because resolution is not inferential, no confidence score is attached (constitution §II "confidence levels where inference is used" is therefore N/A for this feature).

## Iterations

### Iteration 2026-06-18: close /speckit.analyze gaps (clarifications + coverage hardening)

**Change**: Closed the gaps surfaced by `/speckit.analyze` — no scope change.
**Scope**: Coverage hardening (spec clarification + tasks.md additions).
**Artifacts updated**: spec.md (FR-008 exact-match wording + Clarifications entry), data-model.md (exact-match note + `source` serde-rename note), plan.md (command list: override folded into `target_resolve`), tasks.md (T003/T006/T035 append-only migration; T018 SC-001 <100 ms assertion; T039 audit emission added).
**Tasks added**: T039 (audit events for resolve + user-override via `crates/audit`).
**Tasks removed**: none.
**Tasks marked complete**: none (implementation not started).

### Iteration 2026-06-21: US4 ingest grouping reactivation

**Change**: Reactivated US4 (T026/T028 were phantom completions — never implemented). Ingested light
frames now correctly create `acquisition_session` records, link a resolved `canonical_target_id`, and
enqueue pending resolutions for back-fill. GitHub issue #307 (empty Sessions page; targets never
linked) is closed by this scope.
**Scope**: Phase-level (US4) + additive functional requirement (FR-016) + one durable migration
(0046).
**Artifacts updated**: spec.md (US4 acceptance scenarios sharpened; FR-016 added; observer-location
edge case added; this Iterations entry), data-model.md (`acquisition_session.canonical_target_id`
added), plan.md (migration 0046; plan-apply-completion ingest hook; background drain; Sessions
read-path join), research.md (decisions R2 updated for `file_record.root_id` FK; R3 for id-space
choice; UTC fallback; plan_listener idempotency), tasks.md (T026/T028 re-opened; T040–T047 added),
quickstart.md (S3 ingest scenario expanded with session-grouping and unknown-OBJECT pending detail).
**Tasks added**: T040 (migration 0046), T041 (ingest module), T042 (plan_listener hook), T043
(background drain), T044 (Sessions read path), T045 (Layer-1 test: cache-hit grouping), T046
(Layer-1 test: unknown OBJECT pending + back-fill), T047 (coverage-matrix update).
**Tasks re-opened**: T026, T028 (phantom completions corrected).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a target while creating a project (Priority: P1)

As a user creating a project (or assigning images to a target), I want to type a designation or
common name and immediately see matching targets, so I can pick the right one without knowing its
exact catalogue designation.

**Why this priority**: Choosing the target is the entry point for organising a project; it must be
fast and forgiving. This is the most visible, most-used path.

**Independent Test**: Open the project-creation target search, type `androm`, and confirm matching
targets (e.g. Andromeda Galaxy / M 31) appear as suggestions showing designation, common name, and
object type; select one and confirm the project is associated with that canonical target.

**Acceptance Scenarios**:

1. **Given** the target search field, **When** the user types a partial designation or name (e.g.
   `M3`, `androm`, `ngc 70`), **Then** matching suggestions appear as they type, each showing the
   primary designation, common name (if any), and object type.
2. **Given** a suggestion list, **When** the user selects a target, **Then** the system records that
   project/target association against a single canonical target identity (with coordinates, type,
   and aliases).
3. **Given** a query that matches several objects, **When** results render, **Then** each result is
   distinguishable by its designation + common name + type (and catalogue) so the user can pick
   correctly.

---

### User Story 2 - Instant results for popular objects without network (Priority: P1)

As a user, I want searches for common objects to be instant and to work even if SIMBAD is slow or
briefly unreachable, so the tool feels responsive and reliable.

**Why this priority**: Responsiveness of typeahead is core to the search experience; depending on a
network round-trip per keystroke would be slow and unreliable.

**Independent Test**: With the app freshly installed and the network disabled, search for a popular
object (e.g. `M42`, `NGC 7000`) and confirm it resolves from the bundled seed/cache instantly.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** the app first runs, **Then** the bundled seed of popular
   catalogues is available locally for search without any network call.
2. **Given** a query matching a seeded object, **When** the user types, **Then** suggestions render
   from the local index with no perceptible delay and no network dependency.
3. **Given** a previously resolved (cached) object, **When** it is searched or encountered again,
   **Then** it resolves from the local cache without re-querying SIMBAD.

---

### User Story 3 - Resolve any object beyond the seed (Priority: P2)

As a user imaging less-common objects, I want the tool to resolve targets that aren't in the bundled
seed by consulting SIMBAD, so I'm not limited to a fixed catalogue subset.

**Why this priority**: Completeness — the seed covers common targets, but the tool must handle the
long tail (obscure Sharpless/LBN/PK objects, etc.) which only an authoritative service knows.

**Independent Test**: Search for an object not in the seed (e.g. an obscure designation) while
online; confirm it is resolved via SIMBAD, added to suggestions, and written to the local cache.

**Acceptance Scenarios**:

1. **Given** a query with no local match, **When** the user pauses typing, **Then** the system
   queries SIMBAD for the long tail and merges any results into the suggestions.
2. **Given** rapid typing, **When** input changes before a SIMBAD query returns, **Then** the
   in-flight query is superseded/cancelled so stale results never overwrite current ones.
3. **Given** a SIMBAD-resolved object is selected, **When** resolution completes, **Then** its
   canonical identity, coordinates, type, and aliases are written to the local cache.

---

### User Story 4 - Group ingested images by resolved target (Priority: P1)

As a user importing images, I want the `OBJECT` keyword in each file resolved to a canonical target,
so images of the same object group together even when the header uses different alias spellings.

**Why this priority**: Correct grouping of acquired data by target is a core organisational outcome
of the product; mis-grouping fragments a user's library.

**Independent Test**: Ingest images whose `OBJECT` headers read `M31`, `NGC 224`, and `Andromeda`;
confirm all are grouped under one canonical target.

**Acceptance Scenarios**:

1. **Given** applied light frames arrive via plan completion, **When** they are ingested, **Then**
   each frame is grouped into an `acquisition_session` keyed by capture identity (`session_key`:
   target/OBJECT, filter, binning, gain, observing-night); sessions are created or appended
   idempotently.
2. **Given** a recognised `OBJECT` value that produces a cache hit, **When** the frame is ingested,
   **Then** the session's `canonical_target_id` is set inline to the cached canonical target without
   any network call or blocking.
3. **Given** an `OBJECT` value that is unknown, garbled, or SIMBAD is unreachable, **When** the
   frame is ingested, **Then** the session is still created, `canonical_target_id` is left NULL, a
   pending `ingest_resolution` entry is enqueued — the canonical target is never fabricated —
   and the linkage is back-filled automatically once the background resolver drains the queue.
4. **Given** several frames whose `OBJECT` values are aliases of the same physical object (e.g.
   `M31`, `NGC 224`, `Andromeda`), **When** ingested, **Then** they all group under one
   `acquisition_session` and link to a single canonical target identity.

**Scope note**: Calibration frames (bias, dark, flat) are out of US4 scope; they are handled by the
existing master-registration path (spec 040).

---

### User Story 5 - Optionally narrow search by catalogue or type (Priority: P3)

As a power user, I want to optionally filter target search by catalogue or object type, so I can
disambiguate collisions or browse within a catalogue.

**Why this priority**: A convenience/disambiguation aid; the default all-catalogue search already
covers the common case, so this is lower priority.

**Independent Test**: Apply a "planetary nebula" type filter (or an "Abell PN" catalogue filter) and
confirm only matching objects appear; remove the filter and confirm the full result set returns.

**Acceptance Scenarios**:

1. **Given** the search UI, **When** no filter is applied, **Then** search spans all catalogues and
   object types by default (the filter is optional, not required).
2. **Given** an applied catalogue or type filter, **When** the user searches, **Then** only matching
   targets are suggested.

---

### Edge Cases

- **SIMBAD unreachable / offline:** search and ingest fall back to the seed + cache; unmatched
  queries/objects are marked pending and retried later. The tool never blocks indefinitely or
  fabricates data.
- **Ambiguous query** (matches multiple physical objects): all candidates are offered, distinguished
  by designation/common-name/type; the user selects.
- **Same physical object across catalogues** (e.g. an object that is both a Collinder and a Melotte
  cluster): resolves to one canonical target identity, not duplicates.
- **Unrecognised / malformed `OBJECT` string:** marked unresolved/pending; no silent mis-assignment.
- **SIMBAD returns a different normalised designation than typed** (e.g. spacing/case): the user's
  query still resolves to the canonical target and is cached under the queried alias.
- **Rate/usage limits:** interactive long-tail queries are debounced and de-duplicated so normal use
  stays within polite usage of the public service.
- **Observer location unset:** when the observer's geographic location is not configured, the
  observing-night boundary used in `session_key` grouping is computed in UTC rather than local time.
  This is a documented degraded mode: sessions spanning UTC midnight may be split across two
  observing-night buckets. The `acquisition_session` records `has_observer_location = 0` to signal
  the degraded computation so the grouping can be corrected if location is later provided.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST resolve a designation or common name to a single canonical target
  identity comprising coordinates (ICRS J2000), object type, and the set of known aliases/designations.
- **FR-002**: The system MUST ship a bundled seed index of the popular catalogues (Messier, Caldwell,
  NGC/IC, named objects, and popular survey objects) and make it available for search at first run
  without any network call.
- **FR-003**: The system MUST provide as-you-type target suggestions for project creation / target
  selection, served instantly from local data (seed + cache).
- **FR-004**: The system MUST resolve queries and `OBJECT` values not present in the local data by
  consulting SIMBAD, and MUST write each resolution to the local cache so the same object is resolved
  at most once.
- **FR-005**: Long-tail SIMBAD queries during interactive typing MUST be debounced and cancellable so
  superseded queries cannot overwrite current results and usage stays polite.
- **FR-006**: The local cache MUST be the durable record of resolved targets and their aliases;
  repeated searches/encounters of a cached object MUST NOT re-query SIMBAD.
- **FR-007**: The system MUST treat aliases of one physical object as a single canonical target
  (de-duplication), so a target is never split across alias variants or catalogues.
- **FR-008**: During image ingest, the FITS `OBJECT` value MUST be resolved (via cache then SIMBAD)
  and the image associated with the resulting canonical target. Resolution MUST be exact normalized
  designation/identifier matching only (no fuzzy or probabilistic matching); a value with no exact
  match — or one ambiguous across multiple physical objects with no user selection — MUST be marked
  unresolved/pending per FR-009 rather than guessed. (No confidence score is attached because
  resolution is not inferential.)
- **FR-009**: When an `OBJECT` value or query cannot be resolved (unknown, malformed, or SIMBAD
  unreachable), the system MUST mark it unresolved/pending — never fabricate coordinates and never
  mis-assign — and MUST allow later retry.
- **FR-010**: Target search MUST span all catalogues/types by default and MUST offer an optional,
  non-required filter by catalogue and/or object type.
- **FR-011**: When SIMBAD is unreachable, search and ingest MUST degrade gracefully to seed + cache
  without blocking the user.
- **FR-012**: The system MUST surface the attribution required by the data sources (CDS/SIMBAD,
  OpenNGC) in the app's notices.
- **FR-013**: Image-ingest resolution MUST be asynchronous — cache/seed hits resolve immediately, but
  uncached objects MUST be enqueued and resolved in the background without blocking ingest; images
  awaiting resolution are marked pending (per FR-009) until resolved.
- **FR-014**: The user MUST be able to manually set or correct a target's canonical identity; a manual
  override MUST be persisted (source = `user-override`) and MUST take precedence over SIMBAD/seed
  resolutions for that object on subsequent encounters.
- **FR-015**: The app MUST provide a setting to enable/disable online SIMBAD resolution (default
  enabled); when disabled, resolution uses only the bundled seed + local cache.
- **FR-016**: Ingesting applied light frames MUST create `acquisition_session` records grouped by
  capture identity (`session_key`: target/OBJECT, filter, binning, gain, observing-night) and MUST
  link the resolved canonical target (`canonical_target_id`) when known; linkage is non-blocking and
  back-filled by the background resolver when the target is resolved after the initial ingest.

### Key Entities *(include if feature involves data)*

- **Canonical Target**: the stable identity for one physical object — primary designation, object
  type, ICRS J2000 coordinates, and its alias/designation set. (Reuses the spec 013 target-identity
  model.)
- **Alias / Designation**: an alternate name or catalogue designation pointing to a canonical target
  (e.g. `M 31`, `NGC 224`, `NAME Andromeda Galaxy`); used for search matching and ingest resolution.
- **Resolution Cache Entry**: a durable local record of a resolved target — its identity, aliases,
  source (`seed` | `resolved` | `user-override`), and when it was resolved. A `user-override` entry
  takes precedence over `resolved`/`seed` for the same object (FR-014).
- **Seed Index**: the bundled set of popular catalogue objects that pre-populates the cache at first
  run.
- **Catalogue / Type (filter vocabulary)**: the set of catalogues and object types used for the
  optional search filter (reuses the v1 catalogue vocabulary).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For objects in the bundled seed, target suggestions appear within ~100 ms of typing,
  with no network call.
- **SC-002**: A user can find and select a common target (an object from the popular catalogues) in
  under 10 seconds from opening the search.
- **SC-003**: For a set of test images whose `OBJECT` headers use different aliases of the same
  object, 100% group under a single canonical target.
- **SC-004**: Any object known to SIMBAD can be resolved when online (no fixed-catalogue ceiling),
  and is resolved at most once per object (subsequent uses served from cache).
- **SC-005**: With the network disabled, search and ingest of seeded/cached objects continue to work,
  and unknown objects are clearly marked unresolved rather than failing silently or being mis-assigned.

## Assumptions

- The user's machine has internet connectivity at import/organisation time; this is a desktop
  library-management tool, not a field/offline imaging tool. Brief outages are tolerated via seed +
  cache.
- SIMBAD (CDS) is trusted as the authoritative resolution source; data is transferred over TLS, so
  no catalog signing/verification is required.
- Resolving an object sends its designation/name to the CDS public service; this is acceptable and
  noted in the app's documentation/notices.
- The bundled seed's exact contents are a curated "popular catalogues" set (Messier, Caldwell,
  NGC/IC, named objects, and popular Sharpless/Barnard/LBN/LDN/vdB/Abell/Arp/Melotte objects); the
  precise membership is an implementation/plan detail.
- The target-identity model and the v1 catalogue vocabulary from specs 013/014 are reused.

## Out of Scope

- Building, hosting, signing, or auto-updating our own catalog files (the superseded spec 014
  mechanism) — including the separate catalog repository, signed manifest, and minisign verification.
- Offline-first field use (the product assumes desktop connectivity).
- Image processing of any kind (PixInsight/WBPP boundary per constitution).
- A live coordinate plate-solving / astrometry feature (resolution is by designation/name, not by
  solving image pixels).
- Editing or contributing back to SIMBAD/OpenNGC source data.
