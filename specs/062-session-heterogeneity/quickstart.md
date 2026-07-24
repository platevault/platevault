# Quickstart: Validate Immutable Sessions and Observation Groups

**Feature**: 062-session-heterogeneity

Use this guide after implementing the feature described in [spec.md](./spec.md).
All persistence checks use SQLite with the repository migrations applied.
All UI journeys use the real Tauri app, real IPC handlers, and an isolated
file-backed SQLite database.

## Command status

- **Available** commands exist in this repository.
- **Requires implementation** commands name focused test targets that this
  feature must add.

Do not replace a **Requires implementation** command with a mock-only test.

## Prerequisites

Install the workspace dependencies and the real-UI driver:

```bash
pnpm install --frozen-lockfile
cargo install cargo-nextest --locked
cargo install tauri-webdriver --locked
```

Linux real-UI runs also require the Tauri WebKit/GTK packages and `xvfb-run`.
The operating-system prerequisites are listed in
[the testing guide](../../docs/development/testing.md#layer-2--full-stack-real-ui-e2e).

## 1. Apply and validate migrations

Run the existing persistence suite first:

```bash
# Available
cargo nextest run -p persistence_core
```

Add a focused migration target and run it against a new file-backed database:

```bash
# Requires implementation: crates/persistence/core/tests/session_heterogeneity_migration.rs
cargo nextest run -p persistence_core --test session_heterogeneity_migration
```

The focused target must prove:

- the complete migration chain applies to an empty SQLite file;
- reopening the migrated database succeeds without replaying schema changes;
- ingestion-operation identity cannot produce a second outcome;
- the generic command ledger records one result for Inbox-ingestion and
  metadata-reclassification materialization subtypes;
- accepted session membership cannot be updated or extended;
- a light session, singleton PanelGroup, initial revision, audit row, and outbox
  events commit or roll back together;
- one current accepted head is enforced for each panel or mosaic group;
- current group membership cannot contain both a predecessor and replacement;
- group lineage rejects cycles;
- project membership heads reference immutable exact-session revisions and do
  not use `project_sources` as authority;
- proposal acceptance is atomic when its base revision is stale; and
- `PRAGMA foreign_key_check` returns no rows after every fixture.

The feature assumes development databases may be reset.
The test must still apply every checked-in migration from an empty database.

## 2. Run unit and contract tests

Run the existing package suites while iterating:

```bash
# Available
cargo nextest run \
  -p sessions \
  -p app_core_inbox \
  -p app_core_targets \
  -p app_core_projects \
  -p app_core_calibration \
  -p contracts_core \
  -p contract_tests

# Available: regenerate Rust-derived schemas and Tauri bindings, then fail on drift
just check-generated
```

Unit coverage must include these boundaries:

| Area | Required assertions |
|---|---|
| Session identity | Observing night, confirmed target, filter, normalized exposure, exact gain, offset state/value, horizontal and vertical binning, readout state/value, raster, crop evidence, geometry, and ingestion provenance |
| Missing metadata | Absent values remain absent; contradictory timestamps that change the noon-to-noon bucket block automatic materialization |
| Geometry | Same-session and sibling thresholds are inclusive at their boundaries; complete linkage prevents transitive expansion; parity is independent from 180-degree-equivalent orientation |
| Mosaic relations | Coverage uses captured intersection divided by the smaller footprint; bridge edges create merge proposals; rejected evidence stays suppressed until its basis changes |
| Calibration | Dark, bias, and flat recipe discriminators follow FR-065 through FR-074; flat exposure does not split compatibility; unknown dark temperature blocks automatic use |
| Object evidence | Point objects in gaps are excluded; extended objects report zero, partial, or full captured intersection; canonical identities deduplicate across panels |
| Project snapshots | A group-derived action expands once to exact session IDs and does not follow later group changes |
| Resource bounds | Test max-minus-one, max, and max-plus-one for page size, recursive depth, candidate work, cursor bytes, path segment/total bytes, aggregate source bytes, request/response bytes, and canonical digest length/algorithm; reject excess without fallback |
| Filesystem safety | Paths are safe-relative and root-contained; traversal is no-follow; apply revalidates source identity and content fingerprint; platform-equivalent collision aliases conflict |
| Privacy projection | Unauthorized source and error projections omit roots, paths, stable identities, fingerprints, SQL, and OS error text |
| Observing-night derivation | Exact local noon belongs to the new observing night; one microsecond before noon belongs to the prior night; cover spring-forward and fall-back transitions, a remote acquisition site that differs from the machine timezone, canonical UTC plus corroborating local time, and reviewed local fallback with no usable canonical instant |
| Equipment resolution | Cover representative focal-length differences immediately below, at, and above 5 and 10 percent; retain reported and plate-solved values when they disagree; scope common labels such as `L` and `Ha` to their optical profile; never infer an absent filter |
| Pagination | Reject malformed cursors and changed filters; hold the first-page watermark across concurrent inserts, retirements, and decisions; reduce a response page without losing the next cursor when the byte budget binds |

Contract coverage must exercise success, blocked, warning, stale-conflict, and
manual-review responses.
It must also verify that generated TypeScript bindings contain no dark-flat
user action or supported calibration kind.

## 3. Run real-SQLite integration tests

Run the repository-wide real-backend layer:

```bash
# Available
just test-integration
```

Add and run focused file-backed SQLite targets:

```bash
# Requires implementation
cargo nextest run -p app_core_inbox --test session_heterogeneity
cargo nextest run -p app_core_projects --test related_session_addition
cargo nextest run -p app_core_calibration --test immutable_calibration_matching
cargo nextest run -p persistence_core --test session_topology_concurrency
```

Each target must create a temporary SQLite file, run the real migration chain,
and use production repositories and use cases.
External catalogue or network access may be replaced only at its network
boundary.

### Ingestion and relation grouping

Use one approved operation containing light frames that vary one discriminator
at a time.
Assert the exact session count and exact frame membership.
Assert that every light session receives one singleton panel group and one
accepted initial revision in the same transaction as session creation.

Run the same assertions through the Inbox-ingestion and
metadata-reclassification materialization subtypes. Assert that both use the
generic command ledger and outbox.

Replay the same operation identity.
Assert that the replay returns the original session and revision IDs and changes
zero row counts.

Apply a second operation containing metadata-identical frames.
Assert that it creates a distinct session, leaves the first membership
byte-for-byte unchanged, and creates a reviewable sibling relation.

Add adjacent panels and then a bridging panel.
Assert that the bridge creates a merge proposal without changing either
accepted mosaic head.

Create a manual cross-target relation proposal through the public command.
Assert that no cross-target association exists during preview. Accept it and
assert that the reviewed association, exact ordered target set, and first
relation revision commit atomically. Reject unauthorized creation and acceptance.

### Project staleness and additive materialization

Create a project-membership revision containing one session and materialize its
source view in a temporary directory through the existing generic plan/apply
executor.
Record every existing relative path, file hash, and materialized snapshot ID.

Ingest a related session.
Assert that the project reports availability without changing its pins.
Explicitly add the session in setup-incomplete, ready, prepared, processing,
and blocked states.
Assert that the exact session is pinned and the source view is stale.

Generate and apply Update View.
Assert that the preview contains only additions for the new pin.
Assert that all recorded paths and hashes remain unchanged after apply.
Create a known destination collision before apply.
Assert that full preflight refuses the operation before any write.

After a clean preflight, introduce a destination race or injected filesystem
failure after one item succeeds. Assert that the successful item remains
journaled, no completed snapshot exists, and retry recognizes only the matching
item created by the same operation. Assert that retry refuses an unrelated
occupant and publishes one completed successor snapshot only after every item
succeeds.

Inject a crash immediately after atomic no-replace install and before item-
journal completion. Assert that the prepared install intent lets a newly fenced
worker prove stable ownership, adopt the item, and continue.

Change the stable identity while preserving equal bytes and assert collision
rather than adoption.
Inject failures after prepared-intent commit, after install, after the
destination-directory durability barrier, and before journal commit. Simulate
loss of an unflushed directory entry and assert that no journal or published
snapshot can claim a missing destination.

Try absolute paths, parent traversal, symlink traversal, and a destination that
escapes the approved root. Assert refusal before write. Change a source after
preview and assert that source-identity or fingerprint revalidation stops before
the affected item.

Apply a reclassification in which one predecessor produces two replacement
sessions. Page through the complete plan and apply snapshots and assert exact
preallocated destination group/revision IDs, predecessor retirements,
identity-change lineage, stale mosaic edges, and project replacement proposals.
Assert old project pins remain unchanged. Then accept the complete two-session
replacement set atomically. Missing, extra, duplicate, or stale replacement sets
must change zero pins.

Assert that old filesystem entries remain immutable and queryable as historical overlay.
Assert that the versioned current processing manifest excludes the predecessor,
includes the replacement, and leaves the predecessor's paths and hashes
unchanged.
Assert that completed and archived projects reject the addition.

### Calibration matching and freshness

Create dark and bias sessions on different observing nights with matching
camera and recipe evidence.
Assert that the sessions remain distinct and appear under one compatible
recipe.

Create flat frames with different exposures but the same optical profile,
filter, gain, offset state, binning, raster, readout state, camera geometry,
and physical orientation.
Assert that exposure does not split the flat relation.
Assert that a same-night compatible flat is the automatic candidate, a
cross-night flat remains selectable only through explicit review, and the age
state is fresh at one night, yellow from two through seven nights, and red after
seven nights.

For calibration handoff creation and reviewed addition, run separate aggregate
source-byte cases at 17,592,186,044,415, 17,592,186,044,416, and
17,592,186,044,417 bytes. The first two may proceed; the last refuses before
hashing or snapshot creation. Cancel both command paths during hashing and assert
no handoff head or successor snapshot commits.

Generate dates relative to the test clock for the fresh, yellow, and red age
boundaries.
Assert the displayed state and automatic-eligibility decision at every boundary.
Cover missing and unverified physical rotation separately.

Create a regulated dark with fewer than 80% valid temperature readings and a
dark with no cooling set point.
Assert that neither is automatically assigned, built, matched, or reused.

Create an external-processing handoff with a controlled trusted clock. Assert
that transport-supplied historical preview time cannot influence the committed
age decision, concurrent reviewed additions from one snapshot yield one
successor and one stale conflict, and retry returns the same snapshot.

Open each selected frame through the no-follow handoff boundary. Hash the bytes
consumed from that same handle and assert they match the immutable fingerprint.
Change a source concurrently and assert the handoff fails before use. Make one
frame in an otherwise sufficient session unavailable and assert the entire
session is blocked from executable handoff without dropping that frame or
applying scientific-quality filtering.

### Dark-flat exclusion

Scan a detected dark-flat fixture through the production classifier.
Assert zero Inbox candidates, sessions, matches, plans, audit actions, and
supported-type reclassification choices.
Also pass the internal dark-flat kind to any dormant plan entry point.
Assert a rejection or no-op and zero dark or flat rows.

### Concurrency and idempotency

Use two independent SQLite connections and a barrier to accept two proposals
from the same base revision at the same time.
Assert one accepted successor and one stale conflict.
Assert zero partial memberships, edges, lineage rows, or project changes.

Repeat each accepted operation with the same operation identity.
Assert stable response IDs and unchanged database counts.
Assert that each domain mutation has one command-ledger outcome and the expected
outbox rows.

Expire a command lease after one journaled item, reclaim it on another worker,
and then resume the former owner. Assert that the new lease generation adopts
the reconciled item, while the stale generation is refused before another
install, journal transition, heartbeat, domain commit, or terminal result.
Simulate a crash after the domain commit but before ledger reconciliation and
assert that retry discovers and records the existing result without executing
again. Inject contradictory recovery evidence and assert fail-closed behavior.

Exercise root-identity changes, unauthorized source/error redaction, and
Linux, macOS, and Windows collision aliases. Test canonical UUID, SHA-256
digest, cursor, path-segment, total-path, 1-MiB request, and 4-MiB response
limits at max-minus-one, max, and max-plus-one values.
Exercise an unauthorized actor for every Update View plan, approve, apply, and
resume command. Assert zero filesystem effects and that unauthorized and unknown
resource IDs return the same detail-free `resource.unavailable` result. Repeat
for cursor continuation, progress, cancellation, and idempotent replay.

Generate Update View plans at 17,592,186,044,415, 17,592,186,044,416, and
17,592,186,044,417 aggregate source bytes. The last case must persist no partial
plan; the other two retain the exact approved byte count in the digest.

## 4. Run the real SQLite scale fixture

The scale fixture must use a file-backed SQLite database in release mode.
It must not use an in-memory database, mocked repository, or reduced row count.

```bash
# Requires implementation: crates/persistence/core/tests/session_topology_scale.rs
cargo test -p persistence_core \
  --release \
  --test session_topology_scale \
  -- \
  --ignored \
  --nocapture
```

Load the fixture in bulk before timing:

- 100,000 sessions;
- approximately 10,000,000 session-frame memberships;
- 500,000 immutable panel or mosaic revisions; and
- 2,000,000 membership, edge, or lineage relations.

After the fixture passes its integrity checks, insert one additional valid row
for each supported-scale dimension: a session, session-frame membership,
immutable panel or mosaic revision, and relation. Exercise the ordinary public
write and read paths for those rows. No command may return a capacity or
unsupported-scale refusal merely because the tested fixture count was exceeded;
an optional performance diagnostic may be recorded.

The checked-in fixture manifest fixes the generator version, seed, schema hash,
row distributions, query/action corpus, ten warmup calls, at least 100 warm
samples, at least 20 cold samples, nearest-rank percentile method, and raw-result
schema. It records CPU, memory, storage, filesystem, operating system and
kernel, power governor, Rust version, SQLite version, commit, and database size.

Cold measurement closes every connection, checkpoints WAL, evicts the database,
WAL, and SHM files from the OS page cache with the documented reference-machine
tool, verifies zero resident pages, and then reopens. Merely reopening the
database is not cold-cache evidence. Reports include warm and cold p50, p95,
p99, maximum, sample count, writer-lock wait, and acquired-lock-to-commit time.

The target passes only when:

- common session and group list, filter, and detail queries are at most 250 ms
  warm-cache p95;
- sibling and mosaic candidate discovery is at most 500 ms warm-cache p95;
- preview and validation at 1,000 nodes and 5,000 relations is at most 1 second
  p95;
- the 10,000-node and 50,000-relation stress component completes within 5
  seconds and exercises progress plus cancellation;
- normal acceptance is at most 250 ms warm-cache p95;
- stress acceptance is at most 1 second excluding separately reported
  writer-lock wait; and
- application startup adds at most 250 ms without loading the full topology.

## 5. Run real Tauri UI journeys

Run the complete real-UI suite through the existing wrapper:

```bash
# Available
just test-e2e
```

Add one focused journey binary for this feature:

```bash
# Requires implementation: crates/e2e-tests/tests/session_heterogeneity_journeys.rs
cargo nextest run \
  -p e2e_tests \
  --test session_heterogeneity_journeys \
  --profile e2e \
  --run-ignored all
```

The focused binary must use the existing `InstanceEnv` isolation and FITS
fixture writer.
It must drive the built `desktop_shell --features e2e` app through its webview.
It must not enable `VITE_USE_MOCKS`.

Add these journeys:

1. **Mixed ingestion grouping**: scan one folder containing discriminator and
   missing-metadata cases; review the grouping evidence; approve; verify exact
   session rows, singleton panel groups, and blocked ambiguous items.
2. **Later related session**: replay the first operation through real IPC;
   verify no duplicate; ingest matching files under a new operation; verify a
   distinct related session and unchanged first-session membership in the UI.
3. **Project additive update**: open a project that pins the first session;
   verify the related-available indicator; add the later session; verify the
   stale state; review and apply Update View; verify only new files appeared and
   all pre-existing files retained their paths and hashes.
4. **Project replacement overlay**: accept an explicit session replacement;
   verify the old entry remains visible in history, the current processing
   manifest excludes it, and the replacement is included after retry-safe
   materialization.
5. **Calibration evidence**: ingest multi-night dark, bias, and flat fixtures;
   verify camera or optical-profile grouping, recipe evidence, fresh/yellow/red
   states, flat orientation evidence, and blocked unknown-temperature darks.
6. **Dark-flat absence**: scan a dark-flat fixture; verify that Inbox,
   Sessions, Calibration, Plans, and reclassification controls expose no item
   or dark-flat action.
7. **Concurrent acceptance**: leave one proposal open in the UI; accept the
   same base through a competing real-IPC request; submit the visible proposal;
   verify a stale-conflict surface and the single accepted revision after
   refresh.
8. **Mosaic gaps and objects**: ingest panels with a deterministic captured
   gap through the production flow; accept the mosaic; verify that a point
   object wholly in the gap is absent, an extended object crossing the gap is
   partially covered, a cross-panel object is deduplicated, and per-panel
   evidence remains inspectable.
9. **Manual reviewed relation**: use sessions with missing reliable geometry;
   open the manual-relation control, inspect the missing-evidence disclosure,
   enter a non-empty reason, select two confirmed target scopes, review the exact
   affected revisions, accept, and verify the cross-target association appears
   only after acceptance.
10. **Accessible long-running review**: operate proposal and Update View review
    using only the keyboard; verify focus restoration, non-color warning and
    stale indicators, screen-reader announcements for progress and terminal
   state, and a cancellation result within the documented deadline.
11. **Accessible Inbox materialization**: review mixed-site partitions, select a
    candidate site/timezone for one partition, correct another through reviewed
    local fallback with its evidence and reason, acknowledge a conflicting local
    timestamp, and verify approval stays blocked until every partition is
    resolved. Then start materialization, inspect coalesced progress, cancel
    before final commit, and verify a screen-reader announcement plus zero
    partial sessions or groups.

The journeys may use the E2E invoke bridge for retry and race setup.
Their user-visible assertions must come from rendered application state after
real backend invalidation and refresh.
Use a deterministic local catalogue fixture for object checks.
Do not call the live SIMBAD service.

### Review-comprehension acceptance

Run a moderated study with at least ten qualified astrophotographers. A
participant qualifies by having independently acquired and processed
multi-night data with at least one supported external processing workflow in
the preceding year. Record the qualifying workflow and experience band in
de-identified form. Each participant completes five scripted tasks without
hints:

1. explain why two Inbox frames become separate immutable sessions;
2. identify the missing evidence and outcome of a manual relation proposal;
3. distinguish a related session from a project pin and approve Update View;
4. choose a calibration candidate using freshness, temperature, and orientation
   evidence; and
5. explain the predecessor, replacements, unchanged pins, and filesystem effect
   of a correction plan.

For each task, the observer records completion without intervention and three
pre-action answers: affected sessions, highest evidence severity, and approval
result. Store de-identified task-level outcomes with the tested build and script
version. Pass only when at least 90 percent of participants complete all five
tasks without intervention and at least 90 percent of the scored answers for
each of the three pre-action fields are correct across all participants and
tasks.

## 6. Run the merge gates

Run the local pre-merge gate and the persistence-boundary ratchet:

```bash
# Available
just check
just db-boundary
```

CI runs unit and real-SQLite integration coverage in
`.github/workflows/ci.yml`.
Real Tauri journeys run independently on Linux and Windows in
`.github/workflows/e2e.yml`.
Update the real-stack coverage matrix when the focused targets land:
[coverage-matrix.md](../037-e2e-integration-testing/contracts/coverage-matrix.md).
