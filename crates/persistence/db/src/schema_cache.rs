// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Embedded database migrations.
//!
//! The pre-1.0 schema is a single frozen baseline. Keep `0001_initial_schema.sql`
//! append-only after it lands; future schema changes must use a new `0002+`
//! migration rather than rewriting the baseline.

/// The append-only migration set consumed by [`crate::Database`].
pub(crate) static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
