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

/// Why the last update step failed. The UI words it in the user's language;
/// the English detail goes to the log only.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "code", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum UpdateFailure {
    /// The update server could not be reached or answered with an error, or
    /// the download stalled, ran out of time or was larger than an update can
    /// be.
    Network,
    /// The update information is malformed, has nothing for this platform, or
    /// points at a file that is not this platform's package.
    Manifest,
    /// The update's signature is missing, does not verify, or was made for
    /// another version.
    Signature,
    /// The new macOS app is not signed by the identity of the installed one.
    Identity,
    /// Permission to install was refused or not given.
    Permission,
    /// The install step failed.
    Install,
    /// The update's files could not be written or read.
    FileSystem,
    /// This copy cannot update itself: no release package installed it, or
    /// no update endpoint is configured.
    Unsupported,
    /// The install failed and the previous macOS app could not be put back.
    /// It was kept at `kept_at` instead of being deleted.
    PreviousAppNotRestored { kept_at: String },
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
    pub error: Option<UpdateFailure>,
}

impl UpdateStatus {
    /// The status before any check has run.
    #[must_use]
    pub const fn idle() -> Self {
        Self { phase: UpdatePhase::Idle, version: None, body: None, error: None }
    }
}

/// Where the Install now and Install on quit offer for a release is made
/// (astro-plan-c72oo).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum OfferChannel {
    /// A system notification with both buttons is outstanding that stays on
    /// screen until the user answers it: on macOS, the Alert notification
    /// style, posted while the app is in the background. Elsewhere the
    /// notification is only a heads-up beside the in-app notice.
    System,
    /// The in-app notice carries them: the notification is a heads-up that
    /// may leave the screen unanswered (a macOS banner, a Windows toast, a
    /// freedesktop notification), notification permission was denied, the
    /// notification system shows no buttons, the notification could not be
    /// shown or was not accepted in time, or the user answered or closed it,
    /// or it was withdrawn.
    InApp,
}

/// Where the offer for the release the last check found stands.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOffer {
    /// The release offered; `None` until a check has found one.
    pub version: Option<String>,
    pub channel: OfferChannel,
}

impl UpdateOffer {
    /// No offer made yet.
    #[must_use]
    pub const fn none() -> Self {
        Self { version: None, channel: OfferChannel::InApp }
    }
}
