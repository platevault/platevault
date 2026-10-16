// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer on macOS: a `UNUserNotificationCenter` notification in a
//! category carrying Install now and Install on quit
//! (`platevault_notify_macos`). It is posted only once the category is
//! registered, and only when the app may show banners or alerts: full
//! permission with an alert style other than None. When permission was never
//! asked, it is asked for now. A process without a bundle, such as
//! `cargo tauri dev`, gets the in-app notice.

use platevault_notify_macos::{Action, Authorization, NotificationCenter, Settings};
use tokio::sync::oneshot;

use super::{OfferAction, OfferText, Refusal, Responder, SystemOffer};
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
    async fn post(&self, text: &OfferText, responder: Responder) -> Result<(), Refusal> {
        permission().await?;
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
        accepted.await.map_err(|_| never_answered())?.map_err(Refusal::Failed)
    }

    fn withdraw(&self) {
        if let Some(center) = NotificationCenter::current() {
            center.withdraw(REQUEST);
        }
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

/// Permission to show the offer on screen, asked for when it was never
/// decided.
async fn permission() -> Result<(), Refusal> {
    let mut current = settings().await?;
    if current.authorization == Authorization::NotDetermined {
        let (send, answer) = oneshot::channel();
        center()?.request_authorization(move |result| drop(send.send(result)));
        answer.await.map_err(|_| never_answered())?.map_err(Refusal::Failed)?;
        current = settings().await?;
    }
    // Provisional and ephemeral permission, and an alert style of None,
    // show no banner, so the buttons would sit unseen in Notification
    // Center.
    if current.authorization == Authorization::Authorized && current.alerts {
        Ok(())
    } else {
        Err(Refusal::PermissionDenied)
    }
}
