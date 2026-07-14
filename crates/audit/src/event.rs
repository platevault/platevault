// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `AuditLogEntry` — the durable, append-only transition record.
//! Spec 002 data-model.md §AuditLogEntry.
//!
//! Moved to `audit_types::event` (2026-07) so `persistence_db` can depend on
//! the types without depending on `audit`. Re-exported here so
//! `audit::event::X` import paths keep compiling unchanged.

pub use audit_types::event::*;
