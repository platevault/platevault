# Implementation Plan: Library inventory

**Branch**: `063-clean-rebuild-contract`
**Spec**: [064-library-inventory](spec.md)
**Date**: 2026-10-04

## Summary

Implement the full LIB contract in a clean Rust backend and catalog. The first acceptance unit indexes in place, returns progressive sessions/Target coverage, preserves uncertain/offline state and records user corrections durably. Target catalog reuse and development Tauri MCP integration are part of this feature, not later substitutes.

## Technical Context

- Language: Rust workspace toolchain, edition 2021.
- Dependencies: existing metadata_fits/metadata_xisf/metadata_core and fs_pathsafe; workspace serde, sqlx SQLite, Tokio, UUID, SHA-256 and time; published simbad-resolver/skymath/target-match where their qualified contracts fit.
- Storage: fresh SQLite catalog, WAL, foreign keys, FULL synchronous user-decision commits; no legacy data migration.
- Platform: desktop Tauri 2 on macOS, Windows and Linux. Host proof is macOS; other-platform gates remain explicit.
- Testing: focused Rust behavior tests and generated FITS/XISF integration, then `cargo test --workspace` after integration; real development Tauri MCP application scenarios.
- Performance: bounded headers and progressive batches; no source copies. New Unreviewed indexing does not hash full images. Explicit quality review, readable rescans/reuse of previously decided assets and cross-location duplicate candidates hash bytes off the UI thread, even when stats match. A decided asset is verification pending, outside applicable totals, until its rehash finishes. Unavailable inputs keep last-observed quality with availability labels.
- Scale: user-selected roots and file inventory, not an assumed workspace. Preserve non-UTF8 path errors rather than silently skip them.

## Constitution Check

Local-first custody: indexing writes no source files. Mutations require reviewed operations in later features. No calibration, debayering, registration or integration is introduced. Scientific work is Rust-owned. UI/core contracts include requests, responses, errors, revisions and operation states. User decisions commit durably; interrupted operations retain recoverable intent. Research and contracts precede code. The all-human-gate waiver leaves analysis and verification mandatory.

## Project Structure

- `crates/platevault-core/Cargo.toml`: clean backend crate.
- `crates/platevault-model/src/lib.rs`: canonical shared types and immutable IDs; one integration owner. Core consumes this crate; persistence never depends on the application core.
- `crates/platevault-core/src/inventory.rs`: read-only scan observations, explicit complete/incomplete scope and progress.
- `crates/platevault-core/src/grouping.rs`: pure homogeneous capture grouping and revision rules.
- `crates/persistence/library/src/lib.rs` and `schema.sql`: sole clean-schema and SQLite writer owner, user corrections and revision checks. The existing SQL boundary remains unchanged.
- `crates/platevault-core/src/targets.rs`: local seed/search, provenance, provider adapter and geometry evidence.
- `crates/platevault-core/src/library.rs`: integrates observations, reconciliation, corrections and coverage.
- `crates/platevault-core/tests/library.rs`: consumer-visible fixture/restart/negative behavior.
- `apps/desktop/src-tauri/src/commands/library.rs`: real rebuilt IPC with separate data directory and no legacy command/job registration; shell enforces loopback dev MCP and release exclusion.
- `specs/064-library-inventory/contracts/library.md`: language-neutral wire contract.
- `specs/064-library-inventory/data-model.md`: stable catalog entity/transition contract.

No `tasks.md`: executable task state lives under the molecule implement step in Beads.

## Independent units and integration

The lead establishes model/API signatures and workspace registration first. Ready independent units then own inventory/grouping, SQLite catalog and target provider/seed modules in separate linked worktrees from one recorded contract commit. They do not edit shared exports, manifests or the shell. The lead integrates them and owns `library.rs`, exported commands, fixtures and application wiring. Units that consume another artifact wait only for that artifact, not a title-based sequence.

Workers skip repository-wide builds/tests/lint/formatters. The lead runs focused backend proof and one integrated workspace verification, then exact-head independent review and Sniff. Original hashes are checked before/after. UI-dependent LIB criteria and J19 remain open on a separate final-frontend acceptance task; backend inspection does not certify them. After all backend specs, the clean-slate frontend delivers real onboarding, Targets, Sessions, Settings and Activity and fresh MCP journey proof. Five failed fixes per issue receive reproducible backlog evidence, never a stub.

## Complexity Tracking

The application core composes inventory, grouping and target logic. A shared model crate breaks the persistence/application dependency cycle; all SQL remains under `crates/persistence`. The archived baseline remains available for selective adoption and comparison.
