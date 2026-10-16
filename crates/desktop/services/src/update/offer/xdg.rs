// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer on Linux and the other freedesktop systems: a notification with
//! both buttons over D-Bus, when the notification server advertises the
//! `actions` capability. A server without it, or no server at all, gets the
//! in-app notice. The notification does not expire, so its buttons stay
//! until the user acts on them.

use notify_rust::{Notification, Timeout};

use super::notify::{show, show_blocking};
use super::{Chooser, OfferText, Refusal, SystemOffer};
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
    async fn post(&self, text: &OfferText, chooser: Chooser) -> Result<(), Refusal> {
        let text = text.clone();
        show_blocking(move || {
            let capabilities = notify_rust::get_capabilities()
                .map_err(|error| Refusal::Failed(error.to_string()))?;
            if !capabilities.iter().any(|capability| capability == ACTIONS) {
                return Err(Refusal::ActionsUnsupported);
            }
            let mut notification = Notification::new();
            notification.auto_icon().timeout(Timeout::Never);
            show(notification, &text, chooser)
        })
        .await
    }
}
