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

pub mod audit;
pub mod calibration;
pub mod envelope;
pub mod lifecycle;
pub mod plans;
pub mod preferences;
pub mod projects;
pub mod review;
pub mod roots;
pub mod search;
pub mod sessions;
pub mod settings;
pub mod targets;
pub mod tour;
