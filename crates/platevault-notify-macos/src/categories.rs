// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Notification categories with action buttons (astro-plan-c72oo).
//!
//! The process's one center delegate (`crate::delegate`) asks this registry
//! two things about every notification it sees, by the notification's
//! category identifier:
//!
//! - how to show it while the app is frontmost, the only time the framework
//!   asks: a registered category shows as a banner and in Notification
//!   Center, whatever the user's style, and its presenter gets the
//!   notification's request identifier, so the caller knows that
//!   notification leaves the screen by itself. Every other notification, a
//!   reminder for one, is not shown, which is what the framework does when
//!   no delegate is installed;
//! - who handles the user's response: a registered category's handler gets
//!   the responding notification's request identifier, so a caller that
//!   posts several notifications in one category tells them apart, and the
//!   chosen action's identifier: a button's, the default action's for a
//!   click on the body, or the dismiss action's for a close (the categories
//!   carry `CustomDismissAction`). A response to any other notification is
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

/// Receives the responding notification's request identifier and the
/// identifier of the action the user chose.
pub type Handler = Arc<dyn Fn(&str, &str) + Send + Sync>;

/// Receives the request identifier of a notification shown while the app is
/// frontmost.
pub type Presenter = Arc<dyn Fn(&str) + Send + Sync>;

struct Category {
    actions: Vec<Action>,
    on_action: Handler,
    on_present: Presenter,
}

/// The registered categories, by identifier.
#[derive(Default)]
pub struct Categories(HashMap<String, Category>);

impl Categories {
    fn insert(
        &mut self,
        identifier: &str,
        actions: Vec<Action>,
        on_action: Handler,
        on_present: Presenter,
    ) {
        self.0.insert(identifier.to_owned(), Category { actions, on_action, on_present });
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

    /// Who learns that a notification in `category` is shown while the app
    /// is frontmost.
    pub fn presenter(&self, category: &str) -> Option<Presenter> {
        self.0.get(category).map(|category| Arc::clone(&category.on_present))
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
    /// in `category` reaches `on_action` with the notification's request
    /// identifier and the response's action identifier. A notification in
    /// `category` shown while the app is frontmost, as a banner whatever the
    /// user's style, reaches `on_present` with its request identifier as it
    /// shows. Both run on a framework queue, so they must return promptly.
    ///
    /// `registered` reports whether the categories the framework reads back
    /// afterwards hold `category`, so the caller posts in it only once its
    /// buttons are in place.
    pub fn register_category(
        &self,
        category: &str,
        actions: Vec<Action>,
        on_action: impl Fn(&str, &str) + Send + Sync + 'static,
        on_present: impl Fn(&str) + Send + Sync + 'static,
        registered: impl FnOnce(bool) + Send + 'static,
    ) {
        let built = {
            let mut categories = registry();
            categories.insert(category, actions, Arc::new(on_action), Arc::new(on_present));
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

    /// Each response as "request:action", and each presentation while the
    /// app is frontmost as "request:presented".
    type Seen = Arc<Mutex<Vec<String>>>;

    /// Register the offer category with `actions`, recording into `seen`.
    fn register(categories: &mut Categories, actions: Vec<Action>, seen: &Seen) {
        let (responded, presented) = (Arc::clone(seen), Arc::clone(seen));
        categories.insert(
            OFFER,
            actions,
            Arc::new(move |request, action| {
                responded.lock().unwrap().push(format!("{request}:{action}"));
            }),
            Arc::new(move |request| presented.lock().unwrap().push(format!("{request}:presented"))),
        );
    }

    fn with_offer(seen: &Seen) -> Categories {
        let mut categories = Categories::default();
        let button = |identifier: &str| Action {
            identifier: identifier.to_owned(),
            title: identifier.to_owned(),
        };
        register(&mut categories, vec![button("install-now"), button("install-on-quit")], seen);
        categories
    }

    #[test]
    fn a_reminder_is_not_shown_while_the_app_is_frontmost_as_without_a_delegate() {
        // Reminders post with no category, which the framework reports as "".
        let categories = with_offer(&Seen::default());
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
        assert!(categories.presenter("").is_none());
    }

    #[test]
    fn a_response_to_a_reminder_reaches_no_handler() {
        let seen = Seen::default();
        let categories = with_offer(&seen);
        assert!(categories.handler("").is_none());
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn a_registered_category_shows_as_a_banner_while_frontmost_from_macos_11() {
        let categories = with_offer(&Seen::default());
        assert_eq!(
            categories.presentation(OFFER, true),
            UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List
        );
    }

    #[test]
    #[allow(deprecated)] // `Alert` is the only option macOS 10.15 knows
    fn a_registered_category_shows_as_an_alert_while_frontmost_before_macos_11() {
        let categories = with_offer(&Seen::default());
        assert_eq!(categories.presentation(OFFER, false), UNNotificationPresentationOptions::Alert);
    }

    #[test]
    fn a_frontmost_presentation_reaches_its_categorys_presenter_with_its_request() {
        let seen = Seen::default();
        let categories = with_offer(&seen);
        categories.presenter(OFFER).expect("registered")("update-offer-0.7.0");
        assert_eq!(*seen.lock().unwrap(), ["update-offer-0.7.0:presented"]);
    }

    #[test]
    fn a_response_reaches_its_categorys_handler_with_its_request_and_action() {
        let seen = Seen::default();
        let categories = with_offer(&seen);
        let handler = categories.handler(OFFER).expect("registered");
        handler("update-offer-0.7.0", "install-on-quit");
        assert_eq!(*seen.lock().unwrap(), ["update-offer-0.7.0:install-on-quit"]);
    }

    #[test]
    fn registering_a_category_again_replaces_it() {
        let first = Seen::default();
        let second = Seen::default();
        let mut categories = with_offer(&first);
        register(&mut categories, Vec::new(), &second);
        categories.handler(OFFER).expect("registered")("update-offer-0.7.1", "install-now");
        categories.presenter(OFFER).expect("registered")("update-offer-0.7.1");
        assert!(first.lock().unwrap().is_empty());
        assert_eq!(
            *second.lock().unwrap(),
            ["update-offer-0.7.1:install-now", "update-offer-0.7.1:presented"]
        );
    }
}
