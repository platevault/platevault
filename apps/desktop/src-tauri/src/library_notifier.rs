// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The reminder notification adapter (spec 072 R13).
//!
//! On macOS it reads `UNUserNotificationCenter` through
//! `platevault_notify_macos`: the authorization status for permission, an
//! authorization request when permission was never decided, and an immediate
//! request whose completion result decides `Submitted` or `Failed`. Only full
//! authorization counts as granted. A process without a bundle identifier is
//! unavailable with `unbundled_process`; other platforms are unavailable with
//! `platform_not_qualified` until a platform qualification adds an adapter.
//! The notification plugin's desktop permission API, which always reports
//! Granted, is never used.

use std::sync::Arc;

use platevault_core::notifier::{Notifier, NotifierFuture, ReminderNotice, SubmitOutcome};
use platevault_core::{PermissionState, UnavailableReason};

/// The adapter for this platform and process.
#[must_use]
pub fn platform_notifier() -> Arc<dyn Notifier> {
    #[cfg(target_os = "macos")]
    {
        if platevault_notify_macos::bundle_identifier().is_some() {
            return Arc::new(macos::MacNotifier);
        }
        Arc::new(Unavailable(UnavailableReason::UnbundledProcess))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Arc::new(Unavailable(UnavailableReason::PlatformNotQualified))
    }
}

/// Where the platform's notification settings open; `None` without a target.
#[must_use]
pub const fn notification_settings_url() -> Option<&'static str> {
    if cfg!(target_os = "macos") {
        Some("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
    } else {
        None
    }
}

/// A notifier that can report no permission and post nothing.
struct Unavailable(UnavailableReason);

impl Notifier for Unavailable {
    fn permission(&self) -> NotifierFuture<'_, PermissionState> {
        let state = PermissionState::Unavailable { reason: self.0 };
        Box::pin(async move { state })
    }

    fn request_permission(&self) -> NotifierFuture<'_, PermissionState> {
        self.permission()
    }

    fn submit<'a>(&'a self, _notice: &'a ReminderNotice) -> NotifierFuture<'a, SubmitOutcome> {
        let reason = format!("notifications are unavailable: {:?}", self.0);
        Box::pin(async move { SubmitOutcome::Failed { reason } })
    }
}

#[cfg(any(target_os = "macos", test))]
fn submit_outcome(result: Result<(), String>) -> SubmitOutcome {
    match result {
        Ok(()) => SubmitOutcome::Submitted,
        Err(reason) => SubmitOutcome::Failed { reason },
    }
}

#[cfg(target_os = "macos")]
fn permission_from(status: platevault_notify_macos::Authorization) -> PermissionState {
    use platevault_notify_macos::Authorization;
    match status {
        Authorization::Authorized => PermissionState::Granted,
        Authorization::Denied => PermissionState::Denied,
        Authorization::NotDetermined => PermissionState::NotDetermined,
        Authorization::Provisional | Authorization::Ephemeral | Authorization::Other(_) => {
            PermissionState::Unavailable { reason: UnavailableReason::LimitedAuthorization }
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use platevault_core::notifier::{Notifier, NotifierFuture, ReminderNotice, SubmitOutcome};
    use platevault_core::{PermissionState, UnavailableReason};
    use platevault_notify_macos::NotificationCenter;
    use tokio::sync::oneshot;

    use super::{permission_from, submit_outcome};

    const UNBUNDLED: PermissionState =
        PermissionState::Unavailable { reason: UnavailableReason::UnbundledProcess };

    /// The bundled application's notification center.
    pub(super) struct MacNotifier;

    async fn status() -> PermissionState {
        let (send, answer) = oneshot::channel();
        {
            let Some(center) = NotificationCenter::current() else { return UNBUNDLED };
            // A dropped receiver means the caller stopped waiting.
            center.authorization(move |status| {
                send.send(permission_from(status)).ok();
            });
        }
        answer.await.unwrap_or(UNBUNDLED)
    }

    impl Notifier for MacNotifier {
        fn permission(&self) -> NotifierFuture<'_, PermissionState> {
            Box::pin(status())
        }

        fn request_permission(&self) -> NotifierFuture<'_, PermissionState> {
            Box::pin(async {
                if status().await != PermissionState::NotDetermined {
                    return status().await;
                }
                let (send, answer) = oneshot::channel();
                {
                    let Some(center) = NotificationCenter::current() else { return UNBUNDLED };
                    center.request_authorization(move |result| drop(send.send(result)));
                }
                // The prompt's answer, or its error, is read back as the status.
                drop(answer.await);
                status().await
            })
        }

        fn submit<'a>(&'a self, notice: &'a ReminderNotice) -> NotifierFuture<'a, SubmitOutcome> {
            Box::pin(async move {
                let (send, answer) = oneshot::channel();
                {
                    let Some(center) = NotificationCenter::current() else {
                        return submit_outcome(Err("the process has no bundle identifier".into()));
                    };
                    let identifier = notice.window.to_string();
                    center.submit(&identifier, &notice.title, &notice.body, move |result| {
                        drop(send.send(result));
                    });
                }
                submit_outcome(
                    answer
                        .await
                        .unwrap_or_else(|_| Err("the notification center never answered".into())),
                )
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use platevault_core::notifier::SubmitOutcome;
    use platevault_core::{PermissionState, UnavailableReason};

    use super::*;

    #[test]
    fn only_full_authorization_counts_as_granted() {
        #[cfg(target_os = "macos")]
        {
            use platevault_notify_macos::Authorization;
            let limited =
                PermissionState::Unavailable { reason: UnavailableReason::LimitedAuthorization };
            assert_eq!(permission_from(Authorization::Authorized), PermissionState::Granted);
            assert_eq!(permission_from(Authorization::Denied), PermissionState::Denied);
            assert_eq!(
                permission_from(Authorization::NotDetermined),
                PermissionState::NotDetermined
            );
            assert_eq!(permission_from(Authorization::Provisional), limited);
            assert_eq!(permission_from(Authorization::Ephemeral), limited);
            assert_ne!(permission_from(Authorization::Other(9)), PermissionState::Granted);
        }
        assert_eq!(submit_outcome(Ok(())), SubmitOutcome::Submitted);
        let refused =
            submit_outcome(Err("Notifications are not allowed for this application".into()));
        assert_eq!(
            refused,
            SubmitOutcome::Failed {
                reason: "Notifications are not allowed for this application".into()
            }
        );
    }

    #[tokio::test]
    async fn an_unbundled_or_unqualified_process_never_reports_permission_or_posts() {
        let expected = if cfg!(target_os = "macos") {
            UnavailableReason::UnbundledProcess
        } else {
            UnavailableReason::PlatformNotQualified
        };
        let notifier = platform_notifier();
        let unavailable = PermissionState::Unavailable { reason: expected };
        assert_eq!(notifier.permission().await, unavailable);
        assert_eq!(notifier.request_permission().await, unavailable);
        let notice = platevault_core::notifier::ReminderNotice {
            window: platevault_core::WindowKey::new(
                uuid::Uuid::new_v4(),
                uuid::Uuid::new_v4(),
                time::macros::datetime!(2026-10-24 22:01 UTC),
            )
            .unwrap(),
            title: "NGC 7000 at Backyard".into(),
            body: "Window 2026-10-25 00:01 to 02:30 Europe/Amsterdam".into(),
        };
        assert!(matches!(notifier.submit(&notice).await, SubmitOutcome::Failed { .. }));
        if cfg!(target_os = "macos") {
            assert!(notification_settings_url().is_some());
        } else {
            assert_eq!(notification_settings_url(), None);
        }
    }
}
