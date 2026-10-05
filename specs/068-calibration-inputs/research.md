# Calibration inputs research

## Decision

Calibration records are Tier 1 rows in the clean library catalog, `crates/persistence/library`, written through its single serialized writer. Pure classification, criterion evaluation and plan assembly live in a new `platevault_core::calibration` module. The catalog receives that module's rules through a trait object, the same way it receives `group_assets` today. Master adoption is the only file write in this feature. It copies one reviewed file into a registered Calibration location and verifies it there. The isolated rebuilt shell exposes `calibration_*` commands. No legacy calibration table, tolerance, command or orchestration is reused. The pure legacy master detector is reused as a dependency.

## Source evidence

Read at `97ca51be39cf970be23e22fcbf22c60c7963b40c`: the rebuilt 064 backend plus the 065 plan. 065 code is not on this commit. No runtime behavior is claimed from reading.

- Roles and indexing: `LocationRole` is `Captures`, `Calibration` or `Results` (`crates/platevault-model/src/lib.rs:330-335`). A Calibration root is registered and scanned by the same read-only pipeline as Captures (`crates/platevault-core/src/library.rs:167-182`, `:246-263`, `:648-675`). No calibration-specific record exists.
- Frame type: grouping writes `type=<v1 label>`, `type=unclassified:<text>` or `type?` into the `capture-v1` key (`crates/platevault-core/src/grouping.rs:76-94`). Every frame type forms ordinary Sessions (`grouping.rs:32-55`). The shared v1 IMAGETYP table maps light, dark, bias/offset/zero and flat spellings. It leaves dark flats unclassified: R-DarkFlat-Reserved (`crates/metadata/core/src/lib.rs:176-213`). `Master Dark` therefore keys as `unclassified:master dark`.
- Key fields: `type`, `night`, `camera`, `camera_id`, `telescope`, `focal_length_mm`, `filter`, `exposure_s`, `gain`, `offset`, `binning_x`, `binning_y`, `width`, `height`, `readout` and `set_temp_c` (`grouping.rs:76-114`). Every D13 criterion is therefore homogeneous within a Session.
- Stack count: `RawFileMetadata.stack_count` carries STACKCNT, falling back to NCOMBINE (`crates/metadata/core/src/lib.rs:265-269`). `CaptureMetadata` drops it (`crates/platevault-model/src/lib.rs:413-445`, `:457-517`).
- Corrections: every `CaptureMetadata` field except `raw` is correctable (`crates/persistence/library/src/lib.rs:4376-4405`, `:4423-4450`).
- Durability and schema: `write_txn!` runs `BEGIN IMMEDIATE` on the one writer (`lib.rs:52-64`). `SCHEMA` is `schema.sql` alone and `SCHEMA_VERSION` is 6. `install_schema` refuses every other recorded version before DDL (`lib.rs:45-46`, `:2066-2102`; `schema.sql:8-16`). `recover_interrupted` marks Running scans Partial at open (`lib.rs:2104-2121`).
- D19 helpers: `current_digests` hashes off the writer lock and `current_digest` refuses a changed fingerprint or prior digest (`lib.rs:1221-1255`, `:6097-6121`). `hash_contained` and `open_contained` read below a verified root without following links (`lib.rs:6127-6155`, `:6207`). `set_quality` and `verify_digest` hash first, then re-check expectations inside the transaction and bind digest and `last_verified_at` (`lib.rs:1148-1219`).
- CAS: `ExpectedAsset` and `ExpectedSession` (`model/src/lib.rs:615-627`). `check_expected_assets` refuses stale revisions, changed fingerprints and Retired copies (`lib.rs:4334-4366`). `check_expected_sessions` returns Conflict with lineage successors (`lib.rs:4882-4910`).
- Equipment: `Equipment` holds camera, telescope, focal length and pixel size with state and provenance (`model/src/lib.rs:864-877`). Session associations carry kind, state and provenance (`model/src/lib.rs:666-711`; `schema.sql:258-274`).
- References: `AssetReferences` is read by Retire review and re-read on confirmation (`crates/platevault-core/src/library.rs:41-46`, `:195-241`). `ReferenceKind` is View, Project or Result (`model/src/lib.rs:964-973`).
- Light test: `is_light` reads any image type containing `light` (`lib.rs:5134-5140`).
- Activity: `list_operations` reads `scan_operations` only (`lib.rs:793-810`).
- IPC: handlers take `State<Arc<Library>>` and use the `Reply`, `fail` and `report` conventions (`apps/desktop/src-tauri/src/commands/library.rs:25-52`). The shell lists handlers in `generate_handler!` (`library_shell.rs:72-98`). The dev bridge needs `dev-tools`, binds IPv4 loopback and fails release compilation (`library_shell.rs:24`, `:165-190`). The catalog directory is `PV_LIBRARY_DATA_DIR` (`library_shell.rs:47`, `:135-149`). Legacy `commands/calibration.rs` exists and stays unregistered.
- Write primitive: no rebuilt code writes files. `fs_executor::update_view::install_item` writes a `tempfile::NamedTempFile` beside the destination, calls `sync_all`, then `persist_noclobber` and a directory sync (`crates/fs/executor/src/update_view/install.rs:93-125`). It buffers the whole source and never re-reads the destination, so D05 is not met as is.
- Legacy calibration: `calibration_master_detect` depends only on `metadata_core`. `detect_master` lets STACKCNT/NCOMBINE evidence outrank naming. `parse_frame_type` strips `master` before token matching. `path_looks_like_master` is a naming heuristic (`crates/calibration/master-detect/src/lib.rs:111-121`, `:142-169`, `:180-200`). The `calibration_core` rules use soft tolerances: dark temperature ±2 °C and dark exposure ±5 % (`crates/calibration/core/src/ranking.rs:88-95`, `:151-156`). The legacy `calibration_tolerances` table defaults to 5 °C and 2 s (`crates/persistence/core/migrations/0001_initial_schema.sql:427-435`). D13 forbids guessed tolerances, so none of these values is reused.

## Resolved ambiguities

Each entry records the decision, its basis and the alternative considered. Where the spec is silent, the default follows the root [decision register](../063-clean-rebuild-contract/decisions.md).

- **R1 Storage and schema version.** Calibration tables live in `crates/persistence/library/src/calibration.sql`. They are appended to `SCHEMA` after the View tables, because CAL rows reference View revisions. Dependency order is 064 (v6), then 065 (v7), then 066 (next), then 068. 068 takes the next version after the latest version landed when it is implemented. `install_schema` refuses every other version, and the autonomous objective permits resetting development catalogs. Alternative: a separate persistence crate needs a second writer connection, or public access to the catalog's private digest and containment helpers.
- **R2 Kinds.** Calibration kinds are bias, dark and flat. Dark flats stay outside matching and listing. The shared v1 table reserves them, and D13 names no criterion that pairs a dark flat with a flat set. 065's `dark_flat` checklist item therefore keeps reading unknown. Alternative: classifying dark flats through `parse_frame_type` would contradict the Session key, which reads them unclassified.
- **R3 Raw sets.** A raw set is a current Session whose effective IMAGETYP maps through the v1 table to bias, dark or flat, excluding master files (R4). The same table drives the Session key, so CAL and LIB always agree on frame type. An accepted basis keeps one copy per logical capture (D16). It leaves out library-Unusable members, by analogy with D02, and lists them. Partial or offline availability is shown and blocks preselection (R10).
- **R4 Master detection.** A present STACKCNT or NCOMBINE decides alone: a value above 1 is a master, and 1 or less is a raw frame. Without a count, IMAGETYP containing the token `master` is header evidence. `path_looks_like_master` alone is labelled name-only inference, as constitution II requires. `detect_master` supplies the base kind. Masters of lights or dark flats are not calibration inputs. Detection needs `stackCount` on `CaptureMetadata`. This is an additive field, filled from `RawFileMetadata.stack_count`, so 064 and RES rows carry it. Basis: the Siril detector keeps the plain base IMAGETYP and relies on the stack count (`crates/calibration/master-detect/src/siril.rs:33-51`). Alternative: IMAGETYP alone misses Siril masters.
- **R5 Detection never adopts.** Each detected master is a candidate with Add to calibration library until adopted. This holds even for a candidate inside a registered Calibration location. Adoption always copies (D05). Basis: CAL-FR-06, CAL-AC-04 and D05. Alternative: in-place registration. The product flow lists it, but D05 chose copy and re-read verification; see open question Q1.
- **R6 Criteria.** These criteria apply to every kind: image type, camera, dimensions, binning, gain and offset (D13). Darks add exposure and cooler setpoint. Flats add channel and optical train. Every comparison is exact on canonical text or decimal values with tolerance `none`, shown as such. `300` equals `300.0`, and negative zero is normalized as in the Session key. Measured temperature, readout mode and night are shown as evidence without a verdict. Basis: D13, plus the J23 fixture, whose darks match the recorded temperature exactly. Alternative: the legacy soft tolerances, which D13 forbids.
- **R7 Camera identity.** The camera criterion needs INSTRUME on both sides. CAMERAID is compared when both record it. A body ID recorded on one side only reads unknown. When neither side records one, the verdict rests on the model, and the explanation names that basis. Basis: 064 keys `camera` and `camera_id` separately; D13 names the camera, not a body serial. Alternative: requiring CAMERAID turns every capture without that header unknown.
- **R8 Optical train.** Each side's optical train comes from a Confirmed Equipment association, or else from header TELESCOP and FOCALLEN. The same confirmed Equipment ID is compatible. Otherwise a fully known (telescope, focal length) pair on both sides is compared exactly, and anything less reads unknown. Suggested associations never count. Adopted masters use header evidence only. Basis: D13 flat optical-train evidence; CAL-AC-02 expects unknown for the 26 Sep flats, which carry neither source. Alternative: OBJECT or rotation as train evidence; the spec names neither.
- **R9 Channel.** The flat channel matches the effective FILTER text exactly, as in 065 R7. Spelling variants are fixed through reviewed catalog corrections (D15).
- **R10 Verdict and preselection.** A candidate is compatible only when every criterion of its kind is compatible. Otherwise it is incompatible if any criterion is, and unknown if not. Each requirement preselects at most one compatible candidate. Candidates are ordered by absolute night distance, with unknown nights last, then adopted masters before raw sets, then ID. Some candidates are never preselected: offline, unreadable, partially available, unadopted, or from a Retired location. Retired ones are not listed at all. Basis: CAL-FR-02, CAL-AC-04 and D01, where ordering never decides eligibility. Alternative: no preselection when several candidates are compatible. That contradicts CAL-AC-01.
- **R11 Requirements.** A requirement is a light Session of a committed View revision, paired with each kind the View requires. The default required kinds are dark and flat, as in the worked example and CAL-AC-01. The user may change them explicitly; the change commits a new calibration plan revision. Product inputs carry no requirement (RES-FR-05). A member Session whose effective type is unknown reads unresolved, with reason `light_type_unknown`. Basis: CAL-FR-08 names unresolved requirements, and FR-004 forbids silent omission. Alternative: deriving requirements from available candidates would omit a missing kind silently.
- **R12 Resolutions.** These resolutions apply:
  - Accept records only all-compatible candidates.
  - An exception is required when a candidate has an incompatible or unknown criterion. It needs a trimmed non-empty reason and snapshots those criteria. Its scope is one View, light Session, kind and input. It never edits input evidence and never applies to another View.
  - Choose another input is an accept or an exception with a different input.
  - Withdraw appends a row that ends the effective decision.
  - Exclude the session is VSEL's draft exclusion followed by `view_save`, which commits a new membership revision. CAL records nothing.
  - Defer records nothing; the requirement stays unresolved.

  Basis: CAL-FR-05, CAL-AC-03, D13 and Plan066's seam. Alternative: an exception without an input cannot name the criterion it waives.
- **R13 Revision applicability.** A decision records the committed View revision it was made at, plus the exact included asset IDs of its light Session. A later revision reuses it only while three things hold. First, that asset set is unchanged. Second, the input's current verdicts equal the snapshot. Third, the input is current: its Session is not superseded and its master is not Retired. Otherwise the requirement reads unresolved with reason `light_membership_changed` or `input_evidence_changed`. Writes name the current committed revision and are refused with Conflict otherwise. A Complete View refuses calibration writes until Reopen (D09, RES-AC-08). Basis: VSEL-FR-12 asks only changed inputs for a new calibration review. Alternative: re-accepting every assignment after each revision; the spec does not require it.
- **R14 D19 at decision time.** Accept and exception hash every input file off the writer lock (the `current_digests` pattern). They bind each digest and `last_verified_at`, then record the identity, fingerprint and SHA-256 basis. A drifted, offline or unreadable file blocks the request. The write is all-or-nothing and names every blocked item, following 064 batch edits. After hashing, copies with equal SHA-256 count once (D16). Light frames are not hashed; their identities are View membership. Plan and handoff reads never rehash.
- **R15 Adoption sequence.** These steps follow D05:
  1. Review hashes the source and records its identity and SHA-256.
  2. Review checks the destination. It must be an existing real directory in an Active, online Calibration location, with no entry at the target path. CAL creates no directories.
  3. Confirm commits a Running operation before any write. This is the Tier 1 intent that constitution V requires.
  4. Confirm creates a temporary file with create-new semantics in the verified destination folder and records its identity. It streams the source while hashing, requires the review digest, then runs `sync_all`.
  5. Confirm installs the file without replacing anything, using `persist_noclobber` semantics, then syncs the folder and records the installed identity.
  6. Confirm re-opens the destination without following links and re-hashes it. It then re-hashes the source.
  7. One transaction registers the master and completes the operation.

  Any failure retains the candidate and registers nothing. A temporary file whose recorded identity matches is removed. An installed but unregistered copy is left in place and named. A file system without no-replace install support blocks adoption; it never falls back to a replacing rename. Restart marks a Running operation Interrupted. An explicit retry resumes by recorded identity, never by file name (D09 retry rule). Alternative: `install_item` buffers the whole file and skips the re-read.
- **R16 Adopted master record.** The master is a CAL record holding:
  - kind, plus the destination location and relative path;
  - the fingerprint with SHA-256;
  - the observed metadata of the copied bytes;
  - provenance: source identity and SHA-256, origin, review and time.

  The source asset's catalog corrections are not carried, as with D11 decisions. If a later scan indexes the destination, CAL links that asset by location, path and digest and never lists it as a new candidate. Alternative: inserting a library asset during adoption would bypass scan reconciliation and regrouping.
- **R17 Origin.** An indexed source's origin is its location and path. Until 070 lands, a generated master in a processing folder is found only when that folder lies inside a registered Results location. A RES output's origin is its View (070 seam).
- **R18 Errors.** The plan adds no `LibraryError` variant, as in 065. These errors apply:
  - An existing destination entry is `IdentityConflict`, scoped to the destination path.
  - Accepting a non-compatible input is `InvalidInput` naming its criteria.
  - Accepting an unadopted master is `InvalidInput`.
  - A stale plan or View revision is `Conflict`.
- **R19 Custody and references.** CAL publishes candidate masters, adopted masters and retained generated sources to STO as custody facts. A new `ReferenceKind::Calibration` lets Retire review name Views whose effective decisions use the location's assets, and adopted masters whose source or destination lies there. The reference revision is the plan or master revision, so a change after review refuses confirmation, as 065 R17 does.
- **R20 Naming.** Commands use the `calibration_` prefix in `commands/calibration_inputs.rs`, because legacy `commands/calibration.rs` exists.
- **R21 Activity.** Adoption operations are listed by `calibration_list_adoptions`, including Interrupted ones after restart. `library_list_operations` stays scan-only as 064 specifies. The final frontend's Activity reads both.
- **R22 Performance.** Inventory and plan reads use one reader snapshot over current non-light Sessions and adopted masters. They read no image bytes. Only accept, exception and adoption hash files.

## Cross-spec seams

Each seam states the interface CAL needs and the conservative default. The owning planner confirmed every interface except PRJ.

- **VSEL (066).** `Catalog::view_revision(view_id, revision)` returns immutable committed members. Each member is a logical capture with `sessionId`, `state` and `copies[{assetId, decisionRevision, fingerprint}]`. CAL derives each Session's included asset set from members whose state is included. `Catalog::view(id).revision` names the latest committed revision. CAL foreign keys reference `view_revisions(view_id, revision)`. Draft membership never carries CAL decisions. Default: until 066 lands, View-scoped CAL tasks stay blocked, while inventory, matching and adoption proceed.
- **PREP (069).** PREP calls `Library::calibration_handoff(view_id, view_revision)`. It composes `Catalog::calibration_handoff(view, revision, rules)` with `platevault_core::calibration::Rules`, is read-only and starts no rehash. It returns `ready` plus the assignments with `resolution` accepted or exception, criteria, reason and `inputs[{assetId | masterId, locationId, relativePath, fingerprint}]`. It also returns the unresolved entries with reasons. PREP re-verifies every input before its effect and never writes CAL records. A blocked item keeps a preparation from reading Prepared.
- **RES (070).** `Catalog::discovered_outputs(view_id)` supplies output rows with root, path, fingerprint, `CaptureMetadata`, availability and `writeState`. CAL applies R4 over those rows, with origin = `viewId`. A `pending` row is never adoptable. RES offers no Add to calibration library. RES also owns View completion; CAL refuses writes while it reads Complete. Default: before 070, no completion record exists, and only indexed sources are adoptable.
- **STO (071).** STO defines `CustodyFacts` in `platevault_core::storage_seams`. CAL implements it with kind Calibration over `Catalog::calibration_custody_facts(view_id)`, which lists candidate masters, adopted masters and retained generated sources. Each comes with its no-follow fingerprint. A retained source carries its kept copy as `{masterId, locationId, relativePath, fingerprint}`. STO keeps these in protected Keep and never changes CAL records. Default: until 071 lands, the catalog read exists with no consumer.
- **PRJ (065).** 065 R11 keeps `missing_calibration` unknown with `calibration_matching_unavailable`. `Library::calibration_match(sessions, kinds)` returns per-Session compatible, unknown or none evidence, which 065 may adopt later. 068 edits no 065 file.
- **LIB (064).** This feature makes two additive model changes: `CaptureMetadata.stackCount` and `ReferenceKind::Calibration`. Scan, grouping, totals and `library_list_operations` behave as before.

## Open questions

- **Q1.** Should masters already inside a registered Calibration location be registered in place? D05 requires a copy today.
- **Q2.** Which criterion should pair dark flats with flat sets?
- **Q3.** Should readout mode become a criterion? It is shown as evidence today.
- **Q4.** May adoption create a destination subfolder? Today the folder must already exist.
- **Q5.** Should a name-only master candidate be adoptable at all? Today it is adoptable and labelled as inference.
- **Q6.** Is the preselection order (night distance, then master, then ID) right for darks, and when a profile builds its own masters?

## Incidental finding

Grouping maps IMAGETYP `object` and `science` to Light through the v1 table, but catalog `is_light` tests for the substring `light` (`lib.rs:5134-5140`). Coverage therefore reads such frames as non-light. CAL uses the v1 table. LIB owns this mismatch; this plan records it for LIB and leaves `is_light` unchanged.

## Qualification

Generated FITS and XISF fixtures must cover:

- Ha and OIII lights at 300 s;
- raw darks at 300 s and 120 s;
- raw Ha flats with RedCat evidence, and 26 Sep OIII flats without it;
- a PixInsight `Master Dark` XISF, a Siril-style master flat with STACKCNT and a name-only master;
- a destination collision, source drift between review and confirm, a corrupted install, an interrupted adoption, an offline Calibration location and SQLITE_FULL.

Every scenario compares source hashes before and after. Real development-MCP evidence remains an acceptance gate. No legacy test result proves the rebuild.
