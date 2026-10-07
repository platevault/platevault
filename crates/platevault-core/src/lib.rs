// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Local-first library records and lossless application contracts.

pub mod calendar;
pub mod calibration;
pub mod custody;
pub mod frame_review;
pub mod grouping;
pub mod import;
pub mod inventory;
pub mod library;
pub mod model;
pub mod naming;
pub mod notifier;
pub mod observing_plans;
pub mod planning;
pub mod projects;
pub mod reminders;
pub mod rig;
pub mod subframe_csv;
pub mod targets;
pub mod view_geometry;
pub mod view_selection;
pub use model::*;
