// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Sessions domain persistence: immutable sessions, frame membership, equipment
//! and metadata resolution, supersession, result snapshots, and watermarked list
//! queries.
#![allow(clippy::doc_markdown)]

pub mod repositories;

#[cfg(any(test, feature = "test-fixture"))]
pub mod test_support;
