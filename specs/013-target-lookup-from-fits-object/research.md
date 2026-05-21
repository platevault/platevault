# Research: Target Lookup From FITS OBJECT

**Branch**: `013-target-lookup-from-fits-object` | **Date**: 2026-05-20
**Status**: NOT IMPLEMENTED — research decisions are draft and pending review.

## R1. Catalog Sources And Licensing

### Decision

Bundle a curated, offline catalog covering the four most common sources for
amateur astrophotography target identification:

- **Messier (M 1 – M 110)** — small, stable, public-domain list. Source:
  derived from the original Messier catalog; canonical designation form
  `M <n>` with the alias `M<n>`.
- **NGC (New General Catalogue, ~7,840 entries)** — sourced from the
  OpenNGC project (CC BY-SA 4.0) which provides a curated, machine-readable
  NGC/IC dataset. Canonical form `NGC <n>` with aliases `NGC<n>`, `N<n>`.
- **IC (Index Catalogue, ~5,386 entries)** — included in the OpenNGC dataset.
  Canonical form `IC <n>`.
- **Popular common names** — a small (~300 entries) hand-curated list mapping
  popular nicknames (e.g. `Pinwheel Galaxy`, `Andromeda Galaxy`, `Orion
  Nebula`) to the canonical Messier/NGC/IC designation. Sourced from public
  amateur-astronomy references and shipped under the project license.

### Rationale

OpenNGC is a well-maintained, machine-readable, redistributable source for the
two largest catalogs and avoids any dependency on Sesame/SIMBAD or VizieR at
runtime. Messier is short enough to embed directly. Common-name coverage is
deliberately small to keep the curated list reviewable.

### Alternatives Considered

- **Sesame/SIMBAD HTTP lookups**: rejected for v1 — violates the no-network
  policy below and adds an external availability dependency that conflicts
  with FR-005 of the spec.
- **Full HYG / VizieR snapshots**: rejected — far larger than required for
  amateur target identification and increases redistribution complexity.

### Licensing

OpenNGC is distributed under CC BY-SA 4.0; the bundled snapshot must carry
attribution and a `NOTICE` entry. The Messier list is public-domain. The
curated common-names list ships under the project license. License manifests
live next to the bundled data and are surfaced in the application's about
panel.

## R2. Fuzzy Matching Algorithm

### Decision

Two-stage matcher:

1. **Normalize-then-exact**: casefold, NFKC normalize, collapse internal
   whitespace, strip punctuation except digits, and expand short catalog
   prefixes (`M` → `M `, `NGC` → `NGC `). Look the result up in a hash index
   keyed by normalized alias. A hit returns `confidence = high`.
2. **Token-set similarity**: if normalize-then-exact fails, run a token-set
   similarity using `rapidfuzz`-style token_set_ratio against the alias index,
   then break ties with a bounded Damerau–Levenshtein edit distance on the
   highest scorers. Scores above 90 map to `medium` confidence; 75–90 map to
   `low`; below 75 are discarded.

### Rationale

The two-stage shape keeps the common path (exact catalog designation)
deterministic and O(1) while still tolerating spacing, punctuation, and
common-name fragments. Token-set similarity handles trailing tokens such as
`M101 LRGB` naturally because the catalog token still contributes a
near-perfect token-set match.

### Alternatives Considered

- **Pure Levenshtein on full strings**: rejected — fails on the `M101 LRGB`
  pattern because trailing tokens inflate distance.
- **Phonetic algorithms (Soundex/Metaphone)**: rejected — popular astronomy
  names are mostly proper nouns where phonetic matching produces noise.
- **TF-IDF / vector embeddings**: rejected — over-engineered for a catalog
  this size and would add a heavy dependency.

## R3. Ambiguity Resolution Policy

### Decision

Lookup returns one of four outcomes:

- `resolved` — exactly one match at `high` confidence, or exactly one match at
  `medium` confidence with a clear gap (>=15 points) over the next candidate.
- `ambiguous` — multiple candidates within 15 points of each other, or
  multiple `high` candidates. All candidates are returned ranked; the UI is
  responsible for prompting the user.
- `unresolved` — no candidate scores above the discard threshold (75).
- `catalog.unavailable` — the bundled catalog failed to load.

The `target.resolve` operation collapses the ranked form into a single
identity plus confidence, returning `ambiguous` or `unresolved` errors when it
cannot. The `target.lookup` operation always returns the full ranked list so
the UI can present a chooser.

### Rationale

Treating ambiguity as an explicit, named outcome (rather than a single
"best-guess" answer) preserves the constitution's reviewability principle: a
target identity is only auto-applied when the system is confident, and the
user is always given the ranked evidence when it is not.

## R4. No-Network Policy

### Decision

v1 lookup MUST NOT issue network requests. All catalog data is bundled with
the application and loaded from disk at startup. Online providers such as
Sesame/SIMBAD are out of scope for this feature and tracked separately as a
future enhancement.

### Rationale

The spec requires lookup to work without first-run downloads (FR-005) and to
be non-blocking (FR-006). A network-free implementation satisfies both
constraints, keeps the targeting crate pure-domain, and avoids the
availability and rate-limit failure modes that an external service would
introduce. Online enrichment can be added later as a separate crate that
sits behind the same operation contracts.
