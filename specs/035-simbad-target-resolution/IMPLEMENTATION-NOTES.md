# Spec 035 — Implementation Notes (autonomous run log)

Running log of decisions, assumptions, and items needing your input. Started during the
unattended implementation run (2026-06-18). Newest sections appended over time.

## ⚠️ NEEDS YOUR INPUT (decisions I could not make alone)

1. ~~**Project ↔ target persistence gap (US1 acceptance #2).**~~ **RESOLVED (closed end-to-end).**
   The selection now persists via `ProjectCreateRequest.canonicalTargetId` (additive, optional;
   migration 0033 nullable `projects.canonical_target_id`), validated+stored in `project_setup.rs`,
   joined back on the read path into `ProjectDetailDto.canonicalTarget` (`ProjectCanonicalTarget`
   DTO), and displayed as a "Target" rail card on `ProjectDetail` (tested in
   `ProjectDetail.target.test.tsx`). **One sub-item still your call:** the legacy spec-013 `targets`
   table coexists with `canonical_target` — reconciling/retiring it is an architecture decision, not
   a fix. I did NOT unify them unilaterally.

2. **US4 ingest grouping is a ready seam, not wired to live ingest.** `associate_or_enqueue` +
   the `ingest_resolution` queue (T025/T026) are implemented and unit-tested (alias variants group
   under one target; unknown/offline → pending/retry; never fabricated). BUT no production code path
   creates per-image `file_record` rows — per-image inventory ingest is **spec-002 territory and is
   not implemented**. So the grouping logic can't run end-to-end through real file ingest yet.
   **Decision needed:** should spec 035 also build the per-image ingest path (out of its task
   breakdown, into spec-002 scope), or leave `associate_or_enqueue` as the documented seam for
   spec-002 to call later? Current choice: leave the seam (logic complete + tested).

3. **`common_name` display is non-deterministic.** A target with multiple SIMBAD `NAME` aliases
   (e.g. M 31 has 4) returns the first by DB insertion order. Minor UX nit. Options: store a primary
   common name on `canonical_target`, or pick shortest/curated. Left as-is for now.

## DECISIONS TAKEN (applied)

- **Migration numbering:** spec said `0017_target_resolution.sql`, but `0017` is taken by spec-013's
  `0017_targets.sql`. Used **`0031_target_resolution.sql`** (next free). Reconciled tasks.md/agent
  -assignments. The separate calibration-flatten change uses **`0032`** (see below).
- **`target_search`/`target_resolve` command home:** placed in `commands/target_lookup.rs` (the
  spec-013/035 target command family with DB access), NOT the spec-named `commands/targets.rs`
  (which is the spec-029 fixture stub with no pool). tasks.md updated.
- **spec-013 `target_resolve` collision:** renamed the old FITS-against-local-catalog command to
  `target.resolve.fits`; the new spec-035 SIMBAD resolver owns `target.resolve`.
- **`CanonicalTarget.id` derivation:** `target_id_from_designation` (UUIDv5 from the bare canonical
  designation). `simbad_oid` is the real dedup key when present; the derived id only governs
  null-oid (seed/override-only) rows.
- **Catalogue filter (T029):** no catalogue column on the cache → derived from a target's alias
  designation prefixes (M→messier, NGC/IC→openngc, etc.) via the existing normalize vocabulary.
- **Sesame fallback (T019):** NOT added — SIMBAD TAP `ident IN (...)` (verbatim + space-collapsed)
  already covers single-identifier resolution. Flag if a Sesame backstop is wanted.
- **Event topics (T027):** `target.resolved` / `target.resolve_batch.completed` added as Rust event
  -bus string constants (`crates/audit/event_bus.rs`). There is no frontend `events.ts` topic
  registry (frontend uses `listen()` inline), so no frontend/bindings change — matches existing
  convention.
- **Calibration source-folder flatten (your request, separate concern):** unified `dark/flat/bias`
  source kinds → a single `calibration` kind in the setup wizard. Done on its own branch
  `feat/unify-calibration-source-kind` (off main) → **PR #251** (migration 0032). Per-image frame
  type stays detected from FITS `IMAGETYP` metadata (verified already decoupled). Spec-007
  calibration-MATCHING model (Dark/Flat/Bias) intentionally untouched. **Left unmerged for your
  review/Windows test.**

## ASSUMPTIONS

- `map_otype` input code set uses the published SIMBAD object-type vocabulary; should be validated/
  extended against live SIMBAD responses over time (fallback `Other` keeps it safe).
- Seed asset (`assets/seed/seed.json`) committed as a 487-object MVP subset (all Messier + Caldwell
  + NGC 1–300); full ~14k regen via `cargo run -p seed-builder -- --full`. NGC 7000 excluded from the
  live test because SIMBAD classifies it `Cl*` not emission-nebula; used NGC 7293 instead.

## KNOWN TRANSIENT STATE / RISKS

- **`catalogs` repo tests fail** (`no such table: catalog_downloaded`) because migration 0031 drops
  the spec-014 catalog tables. This is **fixed by T034/T035** (remove the superseded catalog-download
  surface) — in progress. Until then `cargo test --workspace` shows ~7 failures, all in that one
  superseded module.
- Pre-existing `clippy --all-targets` lints in non-035 files (`inbox/plan_listener.rs`,
  `tests/startup_wiring_regression.rs`) — `just lint` gate (T037) must reconcile; not introduced by
  035.

## INTERACTIVE TESTING REQUIRED (for the handover / your return)

- Live browser exercise of the `TargetSearch` UI (typeahead, long-tail SIMBAD, cancel-in-flight,
  settings toggle, override action) via the running app — deferred to the Windows rebuild + quickstart.
- Windows rebuild + full quickstart S1–S5 (T038) — see status below.

## FINAL STATUS (autonomous run)

**Spec 035 implementation: 38/39 tasks done. Workspace fully GREEN on Linux/WSL** —
`cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`, `cargo test --workspace`
(66 ok, 0 fail), `just typecheck`, and `vitest` (50 files / 496 tests) all pass. All commits pushed
to `origin/035-simbad-target-resolution` (PR #250, draft).

**T038 (Windows verify) — NOT done; needs you.** The Windows checkout `/mnt/c/dev/astro-plan` was
on branch `033` with **2542 uncommitted files** (autocrlf line-ending churn / stale state) AND a
**running Tauri dev server** (locked `tauri-dev.log`). I did not force a branch switch / rebuild over
your active session. A recoverable `git stash` entry ("pre-035-rebuild stash") was created on that
checkout (a partial-stash artifact) — `git stash drop` it, or `pop` if you want the churn back.

To do the Windows verify yourself:
1. Stop the running Tauri dev server on Windows.
2. In `C:\dev\astro-plan`: reconcile the working tree (it's a testing mirror — `git stash drop` the
   churn, or `git reset --hard origin/035-simbad-target-resolution`).
3. `git fetch && git checkout 035-simbad-target-resolution` (and merge PR #251 first if you also
   want the calibration-flatten in the same build).
4. Recompile (Windows cargo) + `pnpm -C apps/desktop build` and relaunch — avoids the stale-binary
   "command not found" trap from `spec-033-windows-verify-loop`.
5. Exercise quickstart S1–S5: project-creation target search (typeahead) · offline seeded search
   (M42/M31) · long-tail SIMBAD resolve of an unseeded object · ingest grouping (see caveat: needs
   per-image ingest, gap #2 above) · catalogue/type filter + resolver settings toggle + "Correct…"
   override.

**Open PRs awaiting your review/merge:** #250 (spec 035, draft — mark ready when you've reviewed the
gaps above), #251 (calibration source-kind flatten), #309 (apm setup-speckit fix — already merged;
release PR #310 bumps speckit 0.1.2).

## PHASE 3 QUALITY-GATE FINDINGS (verify / code-review / security) + fixes

Ran the mandatory Phase-3 gates (verify FR/SC, code-review, security-audit) after implementation.
Real bugs found (the gates earned their keep — these were integration gaps the per-task build missed):

- **CRITICAL — bundled seed never loaded at app startup.** `load_bundled_on_first_run` existed +
  unit-tested but was not called in `main.rs`/`lib.rs`, so a fresh/offline install had an empty cache
  → US2 / FR-002 / FR-003 / FR-011 / SC-001 / SC-005 silently non-functional in the running app.
  **→ FIXED** (wired into startup after migrations).
- **H1 — Caldwell live-resolve broken.** `caldwell_to_designation` was only used by the seed-builder;
  the live `SimbadResolver` sent raw `C n` to SIMBAD (which doesn't know Caldwell) → `NotFound` for
  non-seeded Caldwell objects (breaks R2). **→ FIXED** (translate Caldwell→NGC/IC in resolve).
- **H2** — `target.resolve` command built a SimbadResolver even when online disabled. **→ FIXED**
  (gate on `online_enabled`).
- **M2** — ingest drain burned `attempts` on transient `Network`/`Timeout` errors. **→ FIXED**
  (transient → stays `pending`, no attempt increment; only real misses → `unresolved`).
- **L4** — `AbortController` in TargetSearch was decorative (signal never wired; cancel-in-flight
  actually works via the generation guard). **→ FIXED** (removed dead machinery).
- **Security** — ADQL escaping is CORRECT and not exploitable (quote-doubling + percent-encode); all
  SQL is sqlx-parameterized; LIKE wildcards escaped; response parsing panic-free, never fabricates
  coords. Two low hardening items applied: https-scheme validation on user-set `simbad_endpoint`,
  bounded response read.
- Minor: frontend endpoint default aligned to `.../sim-tap/sync`. `common_name` non-determinism +
  `map_otype` NGC 7000→OpenCluster remain accepted cosmetic notes.

UPDATE (later in the run): **gap #1 (project↔target persistence) is now RESOLVED additively** —
migration 0033 adds nullable `projects.canonical_target_id` (+ optional `canonicalTargetId` on
ProjectCreateRequest + persistence/validation + CreateProjectDialog wiring), leaving the old
spec-013 `projects.target_id` untouched. **Decision logged:** new column, not a unify/migrate of the
old `targets` table — that deeper reconciliation (two coexisting target tables) is still your call.

UPDATE (read+display now done): the canonical target is surfaced **end-to-end**. Backend adds
`ProjectCanonicalTarget` DTO + optional `ProjectDetailDto.canonicalTarget`, joined from
`canonical_target` via `projects.canonical_target_id` (common_name from `target_alias`); frontend
renders a "Target" RailCard on `ProjectDetail` (primary designation + common name). So create →
persist → read → display is complete. **Only the two-target-table reconciliation remains your call.**
**Gap #2 (US4 not wired to a live per-image ingest / spec-002 inventory) remains open** — it needs
the spec-002 `file_record` ingest pipeline (no production writer exists), a feature decision, not a fix.

## SEED-SCALING FINDING (kept the 487 MVP seed; full seed deferred)

Generated the full seed (`seed-builder --full`) to test scaling: it produced **56,826 objects /
19.5 MB** — it pulls *every* object in the R2 prefix families (all of ACO/LDN/LBN, not just the
"popular" subset the spec intends). **Did NOT commit it**, because:
- It overshoots the spec's "~14k objects / a few MB" and includes obscure objects.
- 19.5 MB committed + `include_bytes!`-embedded bloats the repo and binary.
- **Loader doesn't scale**: FIX-1 loads the seed **synchronously at startup via per-entry
  `upsert_resolved`** — fine for 487 (sub-second), but ~56k entries × several queries each would hang
  the first launch for minutes (violates responsiveness).

**RESOLVED — the curated seed + batched loader are now done** (both follow-ups implemented):
- **Loader batched**: `cache::upsert_resolved_conn(&mut SqliteConnection, …)` added; `load_seed` now
  runs all upserts in a SINGLE transaction (one fsync). The per-call `upsert_resolved(&SqlitePool)`
  wrapper is unchanged, so all other callers are untouched. Dedup/precedence identical.
- **Curated `--popular` seed (now the seed-builder default)**: NGC + IC + Messier + Caldwell + named +
  Sharpless + Barnard + vdB + Abell-PN + Melotte; EXCLUDES ACO/LDN/LBN/APG; **DSO-only cap** drops
  `object_type == Other` (35k stellar/cluster-member rows the prefix LIKE pulled in). Committed
  `assets/seed/seed.json` is now **13,073 objects / 4.5 MB** (was 487 / 191 KB) — at the spec's
  ~14k / few-MB target. Breakdown: 9479 galaxy, 1490 double_star, 850 open_cluster, 437 emission_neb,
  394 dark_neb, 222 planetary_neb, 135 globular, 54 reflection_neb, 8 SNR, 4 galaxy_cluster.
- **DECISION LOGGED — first-run load is synchronous (~4.5s release, one-time)**: the batched 13k load
  blocks the FIRST app launch for ~4.5s (guarded by `is_first_run`, so only at install). Kept
  synchronous for correctness (seed guaranteed ready before the UI). **If that first-launch delay
  feels too slow, the simple change is to background it** (spawn the load in main.rs instead of
  awaiting) — accepting a brief window where first searches see fewer results. Your call; left
  synchronous for now. A `seed_load_timing` regression test guards the batched-load performance.

## VERIFY CLOSEOUT (2026-06-19, after gap #1 closure)

Re-ran `/speckit.verify` (read-only, fresh subagent) now that gap #1 is closed. Result:
**adherence-complete — 19/20 implemented, 1 partial, 0 missing, 0 diverged, no must-fix.**

- All 15 FRs and 5 SCs have concrete tested evidence end-to-end, including the now-closed
  project↔target persistence (contract field → persist/validate → read join → UI rail card).
- **SC-002 is "partial" only in measurement**: the select→associate→display path is implemented and
  unit-tested, but the "find+select a common target in <10 s" UX timing is not separately asserted.
  Confirm during T038 interactive verify (the path is local typeahead + one click, so it's fast).
- **VF-4 fixed**: stale `target.search` doc comment claimed `catalog_filter` wasn't applied; the code
  AND-combines both filters and has passing tests. Comment corrected.
- Constitution: all five principles PASS. §II confidence-levels clause correctly N/A (resolution is
  exact-match, non-inferential).
- Linux gates all green: `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace`
  (68 suites, 0 failed), `just typecheck`, `vitest` (incl. `ProjectDetail.target.test.tsx`).

**Still open (by design, your call — NOT spec-035 defects):**
1. **T038 Windows interactive verify** — recompile + quickstart S1–S5 on Windows. Cannot be done
   autonomously. Watch the stale-binary trap (push→pull→recompile→verify).
2. **US4 live ingest (gap #2)** — `associate_or_enqueue`/`resolve_pending` are a tested seam; no
   production per-image `file_record` ingest exists to call them (needs spec-002 inventory).
3. **Two-target-table reconciliation** — legacy spec-013 `targets` vs `canonical_target`.
4. **SC-004 live SIMBAD** — validated by a gated test (`cargo test -p targeting -- --ignored`);
   run once against the live service before final close.

Recommended before merge: T038 on Windows, then squash-merge PR #250.
