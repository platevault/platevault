// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer on macOS: a `UNUserNotificationCenter` notification in a
//! category carrying Install now and Install on quit
//! (`platevault_notify_macos`). Only full notification permission shows it;
//! when permission was never asked, it is asked for now. A process without a
//! bundle, such as `cargo tauri dev`, gets the in-app notice.

use platevault_notify_macos::{Action, Authorization, NotificationCenter};
use tokio::sync::oneshot;

use super::{Chooser, OfferAction, OfferText, Refusal, SystemOffer};
use crate::AppIdentity;

/// The category the offer is posted in, which carries its buttons.
const CATEGORY: &str = "update-offer";

/// The offer's request identifier, so a newer offer replaces one still shown.
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
    async fn post(&self, text: &OfferText, chooser: Chooser) -> Result<(), Refusal> {
        permission().await?;
        let (send, accepted) = oneshot::channel();
        {
            let center = center()?;
            let actions = OfferAction::ALL
                .into_iter()
                .map(|action| Action {
                    identifier: action.identifier().to_owned(),
                    title: text.label(action).to_owned(),
                })
                .collect();
            center.register_category(CATEGORY, actions, move |identifier| {
                chooser.choose_identifier(identifier);
            });
            center.submit_in_category(REQUEST, &text.title, &text.body, CATEGORY, move |result| {
                drop(send.send(result));
            });
        }
        accepted.await.map_err(|_| never_answered())?.map_err(Refusal::Failed)
    }
}

fn center() -> Result<NotificationCenter, Refusal> {
    NotificationCenter::current()
        .ok_or_else(|| Refusal::Failed("the process has no bundle identifier".to_owned()))
}

fn never_answered() -> Refusal {
    Refusal::Failed("the notification center never answered".to_owned())
}

/// Full notification permission, asked for when it was never decided.
async fn permission() -> Result<(), Refusal> {
    let (send, status) = oneshot::channel();
    center()?.authorization(move |status| {
        send.send(status).ok();
    });
    match status.await.map_err(|_| never_answered())? {
        Authorization::Authorized => Ok(()),
        Authorization::NotDetermined => {
            let (send, answer) = oneshot::channel();
            center()?.request_authorization(move |result| drop(send.send(result)));
            match answer.await.map_err(|_| never_answered())? {
                Ok(true) => Ok(()),
                Ok(false) => Err(Refusal::PermissionDenied),
                Err(error) => Err(Refusal::Failed(error)),
            }
        }
        // Provisional and ephemeral permission show no banner, so the
        // buttons would sit unseen in Notification Center.
        Authorization::Denied
        | Authorization::Provisional
        | Authorization::Ephemeral
        | Authorization::Other(_) => Err(Refusal::PermissionDenied),
    }
}
