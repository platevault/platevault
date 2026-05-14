//! Desktop shell crate boundaries.
//!
//! The Rust `tauri` crate is intentionally deferred until the app shell needs
//! platform GUI system dependencies. Command modules still model the eventual
//! Tauri adapter boundary around the language-neutral contract envelopes.

pub mod commands;

pub const CRATE_NAME: &str = "desktop_shell";
