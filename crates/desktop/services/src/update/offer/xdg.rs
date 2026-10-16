// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer on Linux and the other freedesktop systems: a notification with
//! both buttons over D-Bus, when the notification server advertises the
//! `actions` capability. A server without it, or no server at all, gets the
//! in-app notice. A click on its body (`default`) or a close reports a
//! close.
//!
//! The notification is a heads-up ([`Delivery::Transient`]), so the in-app
//! notice keeps the offer. It is posted at normal urgency with no expiry,
//! but neither keeps it on screen: a server such as GNOME Shell moves a
//! notification that is not critical into its tray. Critical urgency, which
//! would keep it there, is for emergencies and some servers show it through
//! Do Not Disturb.
//!
//! The offer cannot take the notification off screen: `notify-rust` hands it
//! to the thread waiting for its action. A button on a notification left
//! behind is ignored unless the in-app notice offers the same choice for its
//! release.

use notify_rust::{Notification, Timeout};

use super::notify::{show, show_blocking};
use super::{Delivery, OfferText, Refusal, Responder, SystemOffer};
use crate::AppIdentity;

/// The capability a server advertises when it shows action buttons.
const ACTIONS: &str = "actions";

/// The offer as a freedesktop notification.
pub struct XdgOffer;

impl XdgOffer {
    /// The server names the sender after the executable.
    pub const fn new(_identity: &AppIdentity) -> Self {
        Self
    }
}

impl SystemOffer for XdgOffer {
    async fn post(&self, text: &OfferText, responder: Responder) -> Result<Delivery, Refusal> {
        let text = text.clone();
        show_blocking(move || {
            let capabilities = notify_rust::get_capabilities()
                .map_err(|error| Refusal::Failed(error.to_string()))?;
            if !capabilities.iter().any(|capability| capability == ACTIONS) {
                return Err(Refusal::ActionsUnsupported);
            }
            let mut notification = Notification::new();
            notification.auto_icon().timeout(Timeout::Never);
            show(notification, &text, responder)
        })
        .await?;
        Ok(Delivery::Transient)
    }

    fn withdraw(&self) {}
}
