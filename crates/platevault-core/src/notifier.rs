// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Ports for in-app reminders (spec 072): the OS notification adapter and the
//! wall clock.
//!
//! A [`Notifier`] reports real permission evidence and the real result of each
//! submission; a submission it accepted is `Submitted`, which never means the
//! user saw it. The shell supplies the platform adapter; tests drive these
//! ports with a recording notifier and a controlled clock.

use std::future::Future;
use std::pin::Pin;

use time::OffsetDateTime;

use crate::{PermissionState, WindowKey};

/// What [`Notifier`] methods return, boxed as [`crate::library::AssetReferences`] does.
pub type NotifierFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One reminder notification for one window identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReminderNotice {
    pub window: WindowKey,
    pub title: String,
    pub body: String,
}

/// The adapter's answer to one submission.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubmitOutcome {
    /// The OS notification center accepted the request.
    Submitted,
    /// The adapter refused or the OS returned an error, with its text.
    Failed { reason: String },
}

/// The OS notification center.
pub trait Notifier: Send + Sync + 'static {
    /// Current permission, without prompting.
    fn permission(&self) -> NotifierFuture<'_, PermissionState>;
    /// Ask the OS for permission when it was never decided; otherwise report it.
    fn request_permission(&self) -> NotifierFuture<'_, PermissionState>;
    /// Submit one notification immediately and report the OS result.
    fn submit<'a>(&'a self, notice: &'a ReminderNotice) -> NotifierFuture<'a, SubmitOutcome>;
}

/// The wall clock the scheduler re-reads, so it catches up after system sleep.
pub trait Clock: Send + Sync + 'static {
    fn now_utc(&self) -> OffsetDateTime;
}

/// The real system wall clock.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_utc(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}
