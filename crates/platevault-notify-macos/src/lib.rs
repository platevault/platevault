// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! macOS notification center bindings for reminders (spec 072 R13) and the
//! update offer (astro-plan-c72oo).
//!
//! A safe API over `UNUserNotificationCenter`: the authorization status, an
//! authorization request, an immediate notification request, each reporting
//! the framework's own completion result to a callback, and categories whose
//! action buttons report the user's choice
//! ([`NotificationCenter::register_category`]). A process without
//! a bundle identifier gets no center, because the framework aborts such a
//! process instead of answering. Callbacks run on a framework queue.
#![cfg(target_os = "macos")]

mod categories;
#[allow(unsafe_code)] // the delegate class; its module states the contract
mod delegate;

pub use categories::Action;

use std::ptr::NonNull;
use std::sync::Mutex;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{NSArray, NSBundle, NSError, NSString};
use objc2_user_notifications::{
    UNAlertStyle, UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotificationRequest, UNNotificationSetting, UNNotificationSettings, UNUserNotificationCenter,
};

/// The authorization status the framework reports.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Authorization {
    NotDetermined,
    Denied,
    Authorized,
    Provisional,
    Ephemeral,
    /// A status this binding does not know.
    Other(isize),
}

impl Authorization {
    fn from_status(status: UNAuthorizationStatus) -> Self {
        match status {
            UNAuthorizationStatus::NotDetermined => Self::NotDetermined,
            UNAuthorizationStatus::Denied => Self::Denied,
            UNAuthorizationStatus::Authorized => Self::Authorized,
            UNAuthorizationStatus::Provisional => Self::Provisional,
            UNAuthorizationStatus::Ephemeral => Self::Ephemeral,
            other => Self::Other(other.0),
        }
    }
}

/// How the app's notifications appear on screen.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AlertStyle {
    /// Off screen: only in Notification Center, or not shown.
    None,
    /// A banner that leaves the screen by itself.
    Banner,
    /// An alert that stays until the user acts on it.
    Alert,
}

/// The app's notification settings that decide whether a notification is
/// seen.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Settings {
    pub authorization: Authorization,
    /// How notifications appear on screen; `None` too when the user turned
    /// alerts off for the app.
    pub style: AlertStyle,
}

/// The main bundle's identifier; `None` for an unbundled process.
#[must_use]
pub fn bundle_identifier() -> Option<String> {
    NSBundle::mainBundle().bundleIdentifier().map(|identifier| identifier.to_string())
}

/// The process's notification center.
pub struct NotificationCenter(Retained<UNUserNotificationCenter>);

impl NotificationCenter {
    /// The current center; `None` without a bundle identifier. The first
    /// call installs the process's one center delegate.
    #[must_use]
    pub fn current() -> Option<Self> {
        bundle_identifier()?;
        let center = UNUserNotificationCenter::currentNotificationCenter();
        delegate::install(&center);
        Some(Self(center))
    }

    /// Read the authorization status without prompting.
    pub fn authorization(&self, done: impl FnOnce(Authorization) + Send + 'static) {
        self.settings(move |settings| done(settings.authorization));
    }

    /// Read the app's notification settings without prompting.
    pub fn settings(&self, done: impl FnOnce(Settings) + Send + 'static) {
        let done = once(done);
        let block = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: the framework passes a valid settings object that lives
            // for the duration of this completion handler.
            #[allow(unsafe_code)]
            let settings = unsafe { settings.as_ref() };
            let style = match settings.alertStyle() {
                _ if settings.alertSetting() != UNNotificationSetting::Enabled => AlertStyle::None,
                UNAlertStyle::Alert => AlertStyle::Alert,
                UNAlertStyle::Banner => AlertStyle::Banner,
                _ => AlertStyle::None,
            };
            done(Settings {
                authorization: Authorization::from_status(settings.authorizationStatus()),
                style,
            });
        });
        self.0.getNotificationSettingsWithCompletionHandler(&block);
    }

    /// Remove the notification `identifier` from the screen and from
    /// Notification Center, and drop it if it is still waiting to be shown.
    pub fn withdraw(&self, identifier: &str) {
        let identifiers = NSArray::from_retained_slice(&[NSString::from_str(identifier)]);
        self.0.removePendingNotificationRequestsWithIdentifiers(&identifiers);
        self.0.removeDeliveredNotificationsWithIdentifiers(&identifiers);
    }

    /// Ask the user for alert and sound permission. Reports whether it was
    /// granted, or the framework's error text.
    pub fn request_authorization(&self, done: impl FnOnce(Result<bool, String>) + Send + 'static) {
        let done = once(done);
        let block = RcBlock::new(move |granted: Bool, error: *mut NSError| {
            done(error_text(error).map_or(Ok(granted.as_bool()), Err));
        });
        let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
        self.0.requestAuthorizationWithOptions_completionHandler(options, &block);
    }

    /// Post one notification immediately. Reports the framework's acceptance,
    /// or its error text.
    pub fn submit(
        &self,
        identifier: &str,
        title: &str,
        body: &str,
        done: impl FnOnce(Result<(), String>) + Send + 'static,
    ) {
        self.post(identifier, title, body, None, done);
    }

    /// Post one notification in `category`, which shows its action buttons,
    /// immediately. Reports the framework's acceptance, or its error text.
    pub fn submit_in_category(
        &self,
        identifier: &str,
        title: &str,
        body: &str,
        category: &str,
        done: impl FnOnce(Result<(), String>) + Send + 'static,
    ) {
        self.post(identifier, title, body, Some(category), done);
    }

    fn post(
        &self,
        identifier: &str,
        title: &str,
        body: &str,
        category: Option<&str>,
        done: impl FnOnce(Result<(), String>) + Send + 'static,
    ) {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        if let Some(category) = category {
            content.setCategoryIdentifier(&NSString::from_str(category));
        }
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(identifier),
            &content,
            None,
        );
        let done = once(done);
        let block = RcBlock::new(move |error: *mut NSError| {
            done(error_text(error).map_or(Ok(()), Err));
        });
        self.0.addNotificationRequest_withCompletionHandler(&request, Some(&block));
    }
}

/// A completion handler the framework may hold as `Fn`, calling `done` once.
fn once<T>(done: impl FnOnce(T) + Send + 'static) -> impl Fn(T) + 'static {
    let slot = Mutex::new(Some(done));
    move |value| {
        let taken = slot.lock().map_or(None, |mut slot| slot.take());
        if let Some(done) = taken {
            done(value);
        }
    }
}

fn error_text(error: *mut NSError) -> Option<String> {
    // SAFETY: the framework passes null or a valid error object that lives for
    // the duration of the completion handler.
    #[allow(unsafe_code)]
    let error = unsafe { error.as_ref() }?;
    Some(error.localizedDescription().to_string())
}
