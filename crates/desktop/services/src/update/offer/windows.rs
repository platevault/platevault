// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer on Windows: a toast with both buttons under the
//! `AppUserModelID` the installer registers on its shortcuts, so Windows
//! shows it as the app's own and routes the click back into the running app.
//! A binary no installer registered gets the in-app notice.
//!
//! The toast uses the reminder scenario, which stays on screen until the
//! user acts on it: `notify-rust` waits for one activation, so a toast that
//! timed out into Action Center would keep buttons that reach nothing. A
//! click on the body or a dismissal reports a close.
//!
//! The toast is a heads-up ([`Delivery::Transient`]), so the in-app notice
//! keeps the offer: Windows does not tell this adapter when the user turned
//! the app's notifications off, or when Focus Assist holds the toast back
//! (`ToastNotifier.Setting` needs the `windows` crate, which is not a
//! dependency, decision D2), and such a toast is accepted and never shown.
//! Nor can it take a toast off screen: `notify-rust` hands the toast to the
//! thread waiting for its activation. A button on a toast left behind is
//! ignored unless the in-app notice offers the same choice for its release.

use notify_rust::{Notification, Urgency};

use super::notify::{show, show_blocking};
use super::{Delivery, OfferText, Refusal, Responder, SystemOffer};
use crate::AppIdentity;

/// The offer as a toast.
pub struct ToastOffer {
    app_id: Option<String>,
}

impl ToastOffer {
    pub fn new(identity: &AppIdentity) -> Self {
        Self {
            app_id: std::env::current_exe().ok().and_then(|exe| {
                exe.parent().and_then(|dir| identity.windows_app_id(dir)).map(str::to_owned)
            }),
        }
    }
}

impl SystemOffer for ToastOffer {
    async fn post(&self, text: &OfferText, responder: Responder) -> Result<Delivery, Refusal> {
        let Some(app_id) = &self.app_id else {
            return Err(Refusal::Failed(
                "no installer registered this copy's AppUserModelID".to_owned(),
            ));
        };
        let mut toast = Notification::new();
        toast.app_id(app_id).urgency(Urgency::Critical);
        let text = text.clone();
        show_blocking(move || show(toast, &text, responder)).await?;
        Ok(Delivery::Transient)
    }

    fn withdraw(&self) {}
}
