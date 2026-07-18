// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Repository trait definitions for spec 002 lifecycle, spec 003 first-run,
//! spec 005 inbox, spec 006 inventory, spec 007 calibration assignments,
//! spec 008 projects, spec 018 settings,
//! spec 017 plans, spec 025 plan apply runs/events, spec 012 artifacts,
//! spec 016 source protection, spec 024 manifests/notes,
//! spec 026 prepared source views, and spec 010 guided flow.
//!
//! Spec 008 Q27 framing layer (`framing`/`framing_session` +
//! `acquisition_session` clustering-key geometry) lives in `framing`.
//!
//! Spec 013/023 gen-2 target repository (`targets`) removed by spec 036.
//! Spec 023 US2/US3/US4 target history + notes queries live in `targets`.
//! Spec 051 US2 target favourites queries live in `target_favourites`.
//!
//! Spec 056 onboarding redesign lives in `onboarding` (per-item state +
//! section flags, migration 0069). `guided_flow` (spec 010) stays until the
//! spec 056 deletion lane removes it; its table was dropped by migration
//! 0069, so its own tests fail at runtime until that lane lands (expected,
//! atomic-landing risk documented in specs/056-onboarding-redesign/research.md R7).

pub mod artifacts;
pub mod audit;
pub mod calibration_assignment;
pub mod calibration_tolerances;
pub mod equipment;
pub mod events;
pub mod first_run;
pub mod framing;
pub mod guided_flow;
pub mod inbox;
pub mod inventory;
pub mod lifecycle;
pub mod manifests;
pub mod onboarding;
pub mod plan_apply;
pub mod plans;
pub mod prepared_source_views;
pub mod project_notes;
pub mod projects;
pub mod provenance;
// q_* modules are empty scaffolding stubs for the db-boundary-zero drain
// nodes (each node owns exactly one, avoiding file-creation collisions).
pub mod q_calibration;
pub mod q_core;
pub mod q_desktop;
pub mod q_inbox;
pub mod q_projects;
pub mod q_resolver;
pub mod q_targets_ingest;
pub mod q_targets_mgmt;
pub mod session_snapshot;
pub mod settings;
pub mod source_protection;
pub mod target_favourites;
pub mod targets;
pub mod tool_launches;
