//! Event envelope and payload types for the hybrid event bus.
//!
//! Moved to `audit_types::event_bus` (2026-07) so `persistence_db` can depend
//! on the types without depending on `audit`. Re-exported here so
//! `audit::event_bus::X` import paths used across ~10 other crates keep
//! compiling unchanged.

pub use audit_types::event_bus::*;
