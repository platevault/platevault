// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Composition-root helpers for `build_app`/`run_app` (issue #981), split by
//! why each part changes: window geometry restoration, the native
//! application menu, and the background task spawners. Not part of the
//! crate's public API.
//!
//! The `specta`/`invoke_handler` builder pair (`bootstrap/specta.rs`) is grouped
//! here conceptually but is `include!`d from `lib.rs`'s crate-root scope
//! instead of declared as a `mod` of this one — see that file's header
//! comment for why a real module boundary breaks it.

pub(crate) mod background;
pub(crate) mod menu;
pub(crate) mod window;
