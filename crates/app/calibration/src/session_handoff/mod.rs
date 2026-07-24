// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! External-processor calibration handoff aggregate (spec 062 US4).
//!
//! This module implements:
//! - `snapshots` — snapshot creation and reviewed-addition succession.
//! - `evidence` — candidate evidence evaluation (age, thermal, orientation,
//!   source availability, automatic eligibility).
//!
//! The handoff command itself (`calibration.handoff.create` and
//! `calibration.handoff.reviewed_add`) is asynchronous with:
//! - `evaluationAt` captured from the trusted clock at the start, never from
//!   caller input.
//! - Verification outside the writer transaction (streaming frame hash loop).
//! - One final `BEGIN IMMEDIATE` commit that revalidates the snapshot head
//!   CAS before inserting the successor snapshot.
//!
//! This module owns the aggregate logic. Filesystem verification (open,
//! hash, no-follow resolution) is the responsibility of the executor layer
//! that calls into these use cases.

pub mod evidence;
pub mod snapshots;
