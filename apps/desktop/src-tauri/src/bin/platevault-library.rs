// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Isolated rebuilt library shell entrypoint (spec 064); see
//! [`desktop_shell::library_shell`]. It never calls the legacy `build_app`/`run_app`.

// Hide the Windows console window on release builds; harmless elsewhere.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::process::ExitCode;

use tracing_subscriber::EnvFilter;

fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();
    match desktop_shell::library_shell::run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "library shell failed to start");
            ExitCode::FAILURE
        }
    }
}
