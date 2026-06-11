//! Tauri command surface.
//!
//! `lifecycle` exposes the spec 002 surface as native Tauri 2 commands wired
//! through tauri-specta for TS binding generation. The legacy envelope-based
//! `OperationCommandDispatcher` boundary in `envelope` is preserved for the
//! contract test suite and any operation that does not yet have a typed
//! Tauri command.
//!
//! Spec 029 stub modules expose every command group with hardcoded fixture
//! data until the real persistence layer is wired.
//!
//! Spec 030 modules add equipment CRUD, status, cleanup, calibration
//! tolerances, ingestion settings, tools, inbox scan, and cleanup scan
//! commands.

pub mod artifacts;
pub mod audit;
pub mod calibration;
pub mod calibration_tolerances;
pub mod catalogs;
pub mod cleanup;
pub mod envelope;
pub mod equipment;
pub mod firstrun;
pub mod inbox;
pub mod ingestion;
pub mod inventory;
pub mod lifecycle;
pub mod manifests;
pub mod native;
pub mod patterns;
pub mod plan_apply;
pub mod plans;
pub mod preferences;
pub mod projects;
pub mod protection;
pub mod review;
pub mod roots;
pub mod search;
pub mod sessions;
pub mod settings;
pub mod status;
pub mod target_identity;
pub mod target_lookup;
pub mod targets;
pub mod tools;
pub mod tour;
