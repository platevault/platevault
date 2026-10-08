// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Local-first library records and lossless application contracts.

pub mod calendar;
pub mod calibration;
pub mod calibration_inputs;
pub mod custody;
pub mod frame_review;
pub mod grouping;
pub mod home;
pub mod import;
pub mod inventory;
pub mod layout;
pub mod library;
pub mod model;
pub mod naming;
pub mod notifier;
pub mod observing_plans;
pub mod planning;
pub mod planning_project;
pub mod prepare;
pub mod project_progress;
pub mod projects;
pub mod reminders;
pub mod results;
pub mod rig;
pub mod run_lifecycle;
pub mod storage;
pub mod subframe_csv;
pub mod targets;
pub mod targets_list;
pub mod tonight;
pub mod view_geometry;
pub mod view_groups;
pub mod view_selection;
pub use model::*;
