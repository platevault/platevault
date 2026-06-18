# Spec 035 — Implementation Notes (autonomous run log)

Running log of decisions, assumptions, and items needing your input. Started during the
unattended implementation run (2026-06-18). Newest sections appended over time.

## ⚠️ NEEDS YOUR INPUT (decisions I could not make alone)

1. **Project ↔ target persistence gap (US1 acceptance #2).** The `TargetSearch` component
   (T013) lets a user search + select a canonical target during project creation, but
   `ProjectCreateRequest` (the `projects.create` contract, spec 008) has **no target field**, so
   the selection is **not persisted**. Wiring it requires a backend contract + schema change to the
   projects feature (cross-spec). I did NOT expand into spec 008 unilaterally. **Decision needed:**
   add `targetId` to project create/edit (and a `project_target` association), or handle target
   association elsewhere (e.g. via the image→target grouping only)? Until then, project-creation
   target selection is UI-only.

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

The two pre-logged gaps (US1 project↔target persistence; US4 not wired to a live per-image ingest
pipeline / spec-002) are **still open and need your input** — they were confirmed by the verify gate,
not fixed here (cross-spec scope decisions).
