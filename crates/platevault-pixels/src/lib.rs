// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pixel decoding, measurement and display for frame review (spec 067).
//!
//! The crate reads FITS and XISF sample data from any `Read`, keeps samples in
//! their stored type with their scaling and invalid-sample categories, measures
//! with the qualified method `platevault.stars` and renders memory-only display
//! tiles. It has no catalog, Tauri or application dependency and writes nothing.

// Sample and coordinate conversions are bounded by validated plane dimensions
// (at most u32 per side) and by the stored type ranges, so the numeric casts
// these lints flag are deliberate.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::cast_lossless
)]

pub mod decode;
#[cfg(feature = "fixtures")]
pub mod fixtures;
pub mod plane;

pub use plane::*;
