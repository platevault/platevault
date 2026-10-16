// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer on macOS: a `UNUserNotificationCenter` notification in a
//! category carrying Install now and Install on quit
//! (`platevault_notify_macos`). It is posted only once the category is
//! registered, and only when the app may show notifications on screen: full
//! permission with the Banner or Alert style ([`delivery`]). When permission
//! was never asked, it is asked for now. The Alert style stays on screen
//! until the user acts, so it carries the offer; a banner leaves the screen
//! by itself, and Focus sends it to Notification Center, so it is a heads-up
//! beside the in-app notice. A process without a bundle, such as
//! `cargo tauri dev`, gets the in-app notice.
//!
//! The category's handler answers for the release of the last post, so
//! every post first withdraws the notification an earlier post left.

use platevault_notify_macos::{Action, AlertStyle, Authorization, NotificationCenter, Settings};
use tokio::sync::oneshot;

use super::{Delivery, OfferAction, OfferText, Refusal, Responder, SystemOffer};
use crate::AppIdentity;

/// The category the offer is posted in, which carries its buttons.
const CATEGORY: &str = "update-offer";

/// The offer's request identifier, so a newer offer replaces one still
/// shown and a withdrawal removes it.
const REQUEST: &str = "update-offer";

/// The offer through the process's notification center.
pub struct MacOffer;

impl MacOffer {
    /// The center posts under the bundle's own identifier.
    pub const fn new(_identity: &AppIdentity) -> Self {
        Self
    }
}

impl SystemOffer for MacOffer {
    async fn post(&self, text: &OfferText, responder: Responder) -> Result<Delivery, Refusal> {
        // Its buttons would reach the handler registered below, for this
        // release.
        center()?.withdraw(REQUEST);
        let delivery = delivery(permission().await?)?;
        let (send, registered) = oneshot::channel();
        {
            let actions = OfferAction::ALL
                .into_iter()
                .map(|action| Action {
                    identifier: action.identifier().to_owned(),
                    title: text.label(action).to_owned(),
                })
                .collect();
            center()?.register_category(
                CATEGORY,
                actions,
                move |identifier| responder.respond_identifier(identifier),
                move |registered| {
                    send.send(registered).ok();
                },
            );
        }
        if !registered.await.map_err(|_| never_answered())? {
            return Err(Refusal::Failed("the offer's buttons were not registered".to_owned()));
        }
        let (send, accepted) = oneshot::channel();
        center()?.submit_in_category(REQUEST, &text.title, &text.body, CATEGORY, move |result| {
            drop(send.send(result));
        });
        accepted.await.map_err(|_| never_answered())?.map_err(Refusal::Failed)?;
        Ok(delivery)
    }

    fn withdraw(&self) {
        if let Some(center) = NotificationCenter::current() {
            center.withdraw(REQUEST);
        }
    }
}

/// How a notification under `settings` stays on screen, or why it would not
/// be seen. Provisional and ephemeral permission, and the None style, show
/// no banner, so the buttons would sit unseen in Notification Center.
fn delivery(settings: Settings) -> Result<Delivery, Refusal> {
    match (settings.authorization, settings.style) {
        (Authorization::Authorized, AlertStyle::Alert) => Ok(Delivery::Persistent),
        (Authorization::Authorized, AlertStyle::Banner) => Ok(Delivery::Transient),
        _ => Err(Refusal::PermissionDenied),
    }
}

fn center() -> Result<NotificationCenter, Refusal> {
    NotificationCenter::current()
        .ok_or_else(|| Refusal::Failed("the process has no bundle identifier".to_owned()))
}

fn never_answered() -> Refusal {
    Refusal::Failed("the notification center never answered".to_owned())
}

async fn settings() -> Result<Settings, Refusal> {
    let (send, settings) = oneshot::channel();
    center()?.settings(move |settings| {
        send.send(settings).ok();
    });
    settings.await.map_err(|_| never_answered())
}

/// The app's notification settings, after asking for permission when it was
/// never decided.
async fn permission() -> Result<Settings, Refusal> {
    let current = settings().await?;
    if current.authorization != Authorization::NotDetermined {
        return Ok(current);
    }
    let (send, answer) = oneshot::channel();
    center()?.request_authorization(move |result| drop(send.send(result)));
    answer.await.map_err(|_| never_answered())?.map_err(Refusal::Failed)?;
    settings().await
}

#[cfg(test)]
mod tests {
    use platevault_notify_macos::{AlertStyle, Authorization, Settings};

    use super::{delivery, Delivery, Refusal};

    #[test]
    fn only_the_alert_style_carries_the_offer_and_a_banner_is_a_heads_up() {
        let authorized = |style| Settings { authorization: Authorization::Authorized, style };
        assert_eq!(delivery(authorized(AlertStyle::Alert)), Ok(Delivery::Persistent));
        assert_eq!(delivery(authorized(AlertStyle::Banner)), Ok(Delivery::Transient));
        assert_eq!(delivery(authorized(AlertStyle::None)), Err(Refusal::PermissionDenied));
    }

    #[test]
    fn anything_short_of_full_permission_leaves_the_offer_in_app() {
        for authorization in [
            Authorization::NotDetermined,
            Authorization::Denied,
            Authorization::Provisional,
            Authorization::Ephemeral,
            Authorization::Other(99),
        ] {
            for style in [AlertStyle::Alert, AlertStyle::Banner, AlertStyle::None] {
                assert_eq!(
                    delivery(Settings { authorization, style }),
                    Err(Refusal::PermissionDenied),
                    "{authorization:?} {style:?}"
                );
            }
        }
    }
}
