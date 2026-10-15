// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Software update status DTOs (spec 051 US10, astro-plan-5wcib).
//!
//! The desktop services updater publishes an [`UpdateStatus`] whenever the
//! update flow moves on; the host pushes each one to the UI, which only shows
//! it and offers the actions its phase allows.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Where the update flow stands.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum UpdatePhase {
    /// No check has run in this session.
    Idle,
    Checking,
    UpToDate,
    CheckFailed,
    /// A newer release exists. Nothing is installed until the user chooses
    /// Install now or Install on quit.
    Available,
    Downloading,
    DownloadFailed,
    Installing,
    InstallFailed,
    /// Downloaded and signature-verified; installs when the app quits.
    InstallOnQuit,
}

/// The update state the UI shows.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub phase: UpdatePhase,
    /// The release version, from the phase a check found it in onwards.
    pub version: Option<String>,
    /// The release notes, when the release has any.
    pub body: Option<String>,
    /// Why the last step failed, in the `*-failed` phases.
    pub error: Option<String>,
}

impl UpdateStatus {
    /// The status before any check has run.
    #[must_use]
    pub const fn idle() -> Self {
        Self { phase: UpdatePhase::Idle, version: None, body: None, error: None }
    }
}
