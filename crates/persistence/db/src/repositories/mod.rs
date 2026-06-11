//! Repository trait definitions for spec 002 lifecycle, spec 003 first-run,
//! spec 005 inbox, spec 006 inventory, spec 007 calibration assignments,
//! spec 008 projects, spec 013 target lookup,
//! spec 014 catalogs, spec 030 equipment operations, spec 018 settings,
//! spec 017 plans, spec 025 plan apply runs/events, spec 012 artifacts,
//! and spec 016 source protection.

pub mod artifacts;
pub mod calibration_assignment;
pub mod catalogs;
pub mod equipment;
pub mod first_run;
pub mod inbox;
pub mod inventory;
pub mod lifecycle;
pub mod plan_apply;
pub mod plans;
pub mod projects;
pub mod provenance;
pub mod session_snapshot;
pub mod settings;
pub mod source_protection;
pub mod targets;
pub mod tool_launches;
