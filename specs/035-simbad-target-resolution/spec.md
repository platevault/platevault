# Feature Specification: SIMBAD Target Resolution (online resolver + bundled seed + local cache)

> **Cross-spec impact**: This feature **supersedes** the catalog-distribution mechanism of
> [Spec 014 — Catalog Index Licensing](../014-catalog-index-licensing/spec.md) (download bundled
> catalog files + signed manifest + auto-update) and the offline-index resolution approach of
> [Spec 013 — Target Lookup From FITS OBJECT](../013-target-lookup-from-fits-object/spec.md). It
> retains and reuses the **target-identity model** from spec 013 (canonical target, catalog
> references, aliases, dedup). Online name resolution — previously deferred in spec 013 R4 — becomes
> the primary mechanism. Design rationale: `docs/development/catalog-data-pipeline-plan.md`.

**Feature Branch**: `035-simbad-target-resolution`

**Created**: 2026-06-18

**Status**: Draft

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

1. **Given** an imported image with a recognisable `OBJECT` value, **When** it is processed, **Then**
   it is associated with the canonical target for that object (resolved from cache or SIMBAD).
2. **Given** several images whose `OBJECT` values are aliases of the same object, **When** ingested,
   **Then** they are grouped under a single target identity.
3. **Given** an `OBJECT` value that cannot be resolved (unknown/garbled, or SIMBAD unreachable),
   **When** processed, **Then** the image is marked unresolved/pending (not mis-assigned, not given
   fabricated coordinates) and can be resolved later.

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
  and the image associated with the resulting canonical target.
- **FR-009**: When an `OBJECT` value or query cannot be resolved (unknown, malformed, or SIMBAD
  unreachable), the system MUST mark it unresolved/pending — never fabricate coordinates and never
  mis-assign — and MUST allow later retry.
- **FR-010**: Target search MUST span all catalogues/types by default and MUST offer an optional,
  non-required filter by catalogue and/or object type.
- **FR-011**: When SIMBAD is unreachable, search and ingest MUST degrade gracefully to seed + cache
  without blocking the user.
- **FR-012**: The system MUST surface the attribution required by the data sources (CDS/SIMBAD,
  OpenNGC) in the app's notices.

### Key Entities *(include if feature involves data)*

- **Canonical Target**: the stable identity for one physical object — primary designation, object
  type, ICRS J2000 coordinates, and its alias/designation set. (Reuses the spec 013 target-identity
  model.)
- **Alias / Designation**: an alternate name or catalogue designation pointing to a canonical target
  (e.g. `M 31`, `NGC 224`, `NAME Andromeda Galaxy`); used for search matching and ingest resolution.
- **Resolution Cache Entry**: a durable local record of a resolved target — its identity, aliases,
  source (`seed` | `resolved`), and when it was resolved.
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
