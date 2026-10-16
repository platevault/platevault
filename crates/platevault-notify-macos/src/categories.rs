// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Notification categories with action buttons (astro-plan-c72oo).
//!
//! The process's one center delegate (`crate::delegate`) asks this registry
//! two things about every notification it sees, by the notification's
//! category identifier:
//!
//! - whether to show it while the app is frontmost: a registered category
//!   shows as a banner and in Notification Center, and every other
//!   notification, a reminder for one, is not shown, which is what the
//!   framework does when no delegate is installed;
//! - who handles the user's response: a registered category's handler gets
//!   the chosen action's identifier, the default action's for a click on
//!   the body, or the dismiss action's for a close (the categories carry
//!   `CustomDismissAction`), and a response to any other notification is
//!   only acknowledged, as before.

use std::collections::HashMap;
use std::ptr::NonNull;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use block2::RcBlock;

use objc2::rc::Retained;
use objc2_foundation::{NSArray, NSOperatingSystemVersion, NSProcessInfo, NSSet, NSString};
use objc2_user_notifications::{
    UNNotificationAction, UNNotificationActionOptions, UNNotificationCategory,
    UNNotificationCategoryOptions, UNNotificationPresentationOptions,
};

use crate::NotificationCenter;

/// A button a notification category shows.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Action {
    /// What the category's handler receives when the button is clicked.
    pub identifier: String,
    /// The button's text, in the user's language.
    pub title: String,
}

/// Receives the identifier of the action the user chose.
pub type Handler = Arc<dyn Fn(&str) + Send + Sync>;

struct Category {
    actions: Vec<Action>,
    on_action: Handler,
}

/// The registered categories, by identifier.
#[derive(Default)]
pub struct Categories(HashMap<String, Category>);

impl Categories {
    fn insert(&mut self, identifier: &str, actions: Vec<Action>, on_action: Handler) {
        self.0.insert(identifier.to_owned(), Category { actions, on_action });
    }

    /// How a notification in `category` shows while the app is frontmost, on
    /// a macOS that has (`banner_options`) or lacks the macOS 11 `Banner` and
    /// `List` options.
    pub fn presentation(
        &self,
        category: &str,
        banner_options: bool,
    ) -> UNNotificationPresentationOptions {
        if !self.0.contains_key(category) {
            UNNotificationPresentationOptions::empty()
        } else if banner_options {
            UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List
        } else {
            #[allow(deprecated)] // the only option macOS 10.15 knows
            UNNotificationPresentationOptions::Alert
        }
    }

    /// The handler for a response to a notification in `category`.
    pub fn handler(&self, category: &str) -> Option<Handler> {
        self.0.get(category).map(|category| Arc::clone(&category.on_action))
    }

    /// Every registered category, as the framework takes them.
    fn built(&self) -> Retained<NSSet<UNNotificationCategory>> {
        let built: Vec<_> = self
            .0
            .iter()
            .map(|(identifier, category)| build(identifier, &category.actions))
            .collect();
        NSSet::from_retained_slice(&built)
    }
}

/// The process's registry.
pub fn registry() -> MutexGuard<'static, Categories> {
    static CATEGORIES: OnceLock<Mutex<Categories>> = OnceLock::new();
    CATEGORIES.get_or_init(Mutex::default).lock().unwrap_or_else(PoisonError::into_inner)
}

/// Whether this macOS has the `Banner` and `List` presentation options,
/// which macOS 11 introduced.
pub fn has_banner_options() -> bool {
    let big_sur = NSOperatingSystemVersion { majorVersion: 11, minorVersion: 0, patchVersion: 0 };
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(big_sur)
}

fn build(identifier: &str, actions: &[Action]) -> Retained<UNNotificationCategory> {
    let actions: Vec<_> = actions
        .iter()
        .map(|action| {
            UNNotificationAction::actionWithIdentifier_title_options(
                &NSString::from_str(&action.identifier),
                &NSString::from_str(&action.title),
                UNNotificationActionOptions::empty(),
            )
        })
        .collect();
    UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &NSString::from_str(identifier),
        &NSArray::from_retained_slice(&actions),
        &NSArray::new(),
        UNNotificationCategoryOptions::CustomDismissAction,
    )
}

impl NotificationCenter {
    /// Register `category` with `actions`, replacing an earlier registration
    /// of it and keeping every other category. A response to a notification
    /// in `category` reaches `on_action` with the response's action
    /// identifier, on the main thread, so `on_action` must return promptly.
    ///
    /// `registered` reports whether the categories the framework reads back
    /// afterwards hold `category`, so the caller posts in it only once its
    /// buttons are in place.
    pub fn register_category(
        &self,
        category: &str,
        actions: Vec<Action>,
        on_action: impl Fn(&str) + Send + Sync + 'static,
        registered: impl FnOnce(bool) + Send + 'static,
    ) {
        let built = {
            let mut categories = registry();
            categories.insert(category, actions, Arc::new(on_action));
            categories.built()
        };
        self.0.setNotificationCategories(&built);
        let identifier = category.to_owned();
        let registered = crate::once(registered);
        let block = RcBlock::new(move |set: NonNull<NSSet<UNNotificationCategory>>| {
            // SAFETY: the framework passes a valid set that lives for the
            // duration of this completion handler.
            #[allow(unsafe_code)]
            let set = unsafe { set.as_ref() };
            registered(set.iter().any(|category| category.identifier().to_string() == identifier));
        });
        self.0.getNotificationCategoriesWithCompletionHandler(&block);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    const OFFER: &str = "update-offer";

    fn with_offer(chosen: Arc<Mutex<Vec<String>>>) -> Categories {
        let mut categories = Categories::default();
        let button = |identifier: &str| Action {
            identifier: identifier.to_owned(),
            title: identifier.to_owned(),
        };
        categories.insert(
            OFFER,
            vec![button("install-now"), button("install-on-quit")],
            Arc::new(move |action| chosen.lock().unwrap().push(action.to_owned())),
        );
        categories
    }

    #[test]
    fn a_reminder_is_not_shown_while_the_app_is_frontmost_as_without_a_delegate() {
        // Reminders post with no category, which the framework reports as "".
        let categories = with_offer(Arc::default());
        for banner_options in [true, false] {
            assert_eq!(
                categories.presentation("", banner_options),
                UNNotificationPresentationOptions::empty()
            );
            assert_eq!(
                Categories::default().presentation("", banner_options),
                UNNotificationPresentationOptions::empty()
            );
        }
    }

    #[test]
    fn a_response_to_a_reminder_reaches_no_handler() {
        let chosen = Arc::default();
        let categories = with_offer(Arc::clone(&chosen));
        assert!(categories.handler("").is_none());
        assert!(chosen.lock().unwrap().is_empty());
    }

    #[test]
    fn a_registered_category_shows_as_a_banner_while_frontmost_from_macos_11() {
        let categories = with_offer(Arc::default());
        assert_eq!(
            categories.presentation(OFFER, true),
            UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List
        );
    }

    #[test]
    #[allow(deprecated)] // `Alert` is the only option macOS 10.15 knows
    fn a_registered_category_shows_as_an_alert_while_frontmost_before_macos_11() {
        let categories = with_offer(Arc::default());
        assert_eq!(categories.presentation(OFFER, false), UNNotificationPresentationOptions::Alert);
    }

    #[test]
    fn a_response_in_a_registered_category_reaches_its_handler_with_the_action() {
        let chosen = Arc::default();
        let categories = with_offer(Arc::clone(&chosen));
        let handler = categories.handler(OFFER).expect("registered");
        handler("install-on-quit");
        assert_eq!(*chosen.lock().unwrap(), ["install-on-quit"]);
    }

    #[test]
    fn registering_a_category_again_replaces_it() {
        let first = Arc::default();
        let second: Arc<Mutex<Vec<String>>> = Arc::default();
        let mut categories = with_offer(Arc::clone(&first));
        let replacement = Arc::clone(&second);
        categories.insert(
            OFFER,
            Vec::new(),
            Arc::new(move |action: &str| replacement.lock().unwrap().push(action.to_owned())),
        );
        categories.handler(OFFER).expect("registered")("install-now");
        assert!(first.lock().unwrap().is_empty());
        assert_eq!(*second.lock().unwrap(), ["install-now"]);
    }
}
