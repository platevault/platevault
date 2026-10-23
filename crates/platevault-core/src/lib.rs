// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Local-first library records and lossless application contracts.

#[cfg(test)]
extern crate self as platevault_core;
pub mod apply;
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
pub mod new_captures;
pub mod notifier;
pub mod observing_plans;
mod patched_copy;
pub mod planning;
pub mod planning_project;
pub mod project_groups;
pub mod project_output;
pub mod project_progress;
pub mod projects;
pub mod reminders;
pub mod rig;
#[cfg(test)]
#[path = "../tests/support/scan.rs"]
mod scan_support;
pub mod storage;
pub mod subframe_csv;
pub mod targets;
pub mod targets_list;
pub mod tonight;
pub mod wrap_up;
pub use model::*;
