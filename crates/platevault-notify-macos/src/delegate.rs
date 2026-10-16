// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The process's one `UNUserNotificationCenterDelegate` (astro-plan-c72oo).
//!
//! It serves every notification the process posts and defers each decision
//! to the category registry (`crate::categories`): reminders keep what they
//! had without a delegate, and a registered category shows while the app is
//! frontmost and reports the chosen action. The framework holds its delegate
//! weakly, so the one instance lives in a static for the whole process.
//!
//! `unsafe` here is the class definition: the method selectors and argument
//! types must match the protocol's Objective-C declarations, which the
//! signatures below copy from `objc2-user-notifications`.

use std::sync::OnceLock;

use block2::DynBlock;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AnyThread};
use objc2_foundation::{NSObject, NSObjectProtocol};
use objc2_user_notifications::{
    UNNotification, UNNotificationPresentationOptions, UNNotificationResponse,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};

use crate::categories::registry;

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and the class keeps
    // no instance variables.
    #[unsafe(super(NSObject))]
    #[name = "PlateVaultNotificationCenterDelegate"]
    struct Delegate;

    // SAFETY: NSObjectProtocol has no requirements beyond NSObject's.
    unsafe impl NSObjectProtocol for Delegate {}

    // SAFETY: each method's selector and signature match the protocol's.
    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            notification: &UNNotification,
            completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let category = notification.request().content().categoryIdentifier().to_string();
            let options =
                registry().presentation(&category, crate::categories::has_banner_options());
            completion_handler.call((options,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &DynBlock<dyn Fn()>,
        ) {
            let request = response.notification().request();
            let category = request.content().categoryIdentifier().to_string();
            // Out of the registry before the call, so a handler that
            // registers a category cannot deadlock on it.
            let handler = registry().handler(&category);
            if let Some(handler) = handler {
                handler(
                    &request.identifier().to_string(),
                    &response.actionIdentifier().to_string(),
                );
            }
            completion_handler.call(());
        }
    }
);

impl Delegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        // SAFETY: `init` is NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }
}

/// Make the one delegate `center`'s delegate, once per process.
pub fn install(center: &UNUserNotificationCenter) {
    static DELEGATE: OnceLock<Retained<Delegate>> = OnceLock::new();
    DELEGATE.get_or_init(|| {
        let delegate = Delegate::new();
        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        delegate
    });
}
