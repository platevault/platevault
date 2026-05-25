//! Tauri command surface.
//!
//! `lifecycle` exposes the spec 002 surface as native Tauri 2 commands wired
//! through tauri-specta for TS binding generation. The legacy envelope-based
//! `OperationCommandDispatcher` boundary in `envelope` is preserved for the
//! contract test suite and any operation that does not yet have a typed
//! Tauri command.

pub mod envelope;
pub mod lifecycle;
pub mod sessions;
