//! Real-UI end-to-end test crate (spec 037, Layer 2).
//!
//! The library target is intentionally empty. All E2E logic lives under
//! `tests/`:
//!
//! - `tests/common/` — the thirtyfour WebDriver harness (driver + app
//!   lifecycle, the `window.__APP_E2E__` invoke bridge, fresh-DB reset).
//! - `tests/journeys.rs` — the high-level user journeys.
//! - `tests/smoke.rs` — the all-top-level-screens-load smoke.
//!
//! Keeping the logic in `tests/` means `thirtyfour` is a dev-dependency that
//! only compiles for the test binaries, never for `cargo build --workspace`.
//!
//! STATUS: scaffold. The journeys are `#[ignore]`d stubs — they compile and
//! appear in `cargo nextest list`, but their assertions are `todo!()` pending a
//! stable backend command surface and the `__APP_E2E__` bridge. See `README.md`.
