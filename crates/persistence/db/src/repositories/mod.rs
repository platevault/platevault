//! Repository trait definitions for spec 002 lifecycle, spec 003 first-run,
//! spec 005 inbox, spec 006 inventory, spec 007 calibration assignments,
//! spec 008 projects, spec 013 target lookup,
//! spec 014 catalogs, spec 030 equipment operations, spec 018 settings,
//! spec 017 plans, spec 025 plan apply runs/events, spec 012 artifacts,
//! spec 016 source protection, spec 024 manifests/notes,
//! spec 026 prepared source views, and spec 010 guided flow.

pub mod artifacts;
pub mod calibration_assignment;
pub mod equipment;
pub mod first_run;
pub mod guided_flow;
pub mod inbox;
pub mod inventory;
pub mod lifecycle;
pub mod manifests;
pub mod plan_apply;
pub mod plans;
pub mod prepared_source_views;
pub mod project_notes;
pub mod projects;
pub mod provenance;
pub mod session_snapshot;
pub mod settings;
pub mod source_protection;
pub mod targets;
pub mod tool_launches;
