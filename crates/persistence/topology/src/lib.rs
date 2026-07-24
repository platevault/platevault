// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Panel/mosaic topology persistence: heads, revisions, memberships, edges,
//! lineage, proposals, cross-target associations, and bounded traversal previews.
//!
//! Implements the persistence contracts from spec 062
//! (`specs/062-session-heterogeneity/contracts/sessions-groups-proposals.md`).
//!
//! All write operations use `BEGIN IMMEDIATE` with optimistic CAS on the
//! `head_generation` column.  Traversal previews are ephemeral in-process
//! operations; they read from a captured sequence watermark and never write
//! domain rows, audit entries, or outbox events.
#![allow(clippy::doc_markdown)]

pub mod repositories;
pub mod traversal;

#[cfg(any(test, feature = "test-fixture"))]
pub mod test_support;
