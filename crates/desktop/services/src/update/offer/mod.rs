// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The update offer (astro-plan-c72oo, decision astro-plan-eub2i).
//!
//! When a check finds a release, a system notification offers Install now
//! and Install on quit. Each button runs the [`UpdatePort`] operation the
//! matching in-app button runs; this module has no update logic of its own.
//! [`Offers::current`] and [`Offers::feed`] say where the offer for the
//! release was made: [`OfferChannel::System`] once the OS accepted the
//! notification, else [`OfferChannel::InApp`], and the UI shows its in-app
//! notice instead. The in-app notice takes over when notification permission
//! is denied, the notification system shows no buttons, the notification
//! cannot be shown, or the OS has not accepted it within [`OFFER_DEADLINE`].
//!
//! The offer is made from the check result alone, so nothing downloads
//! before a click. Each release is offered once per process.
//!
//! [`SystemOffer`] is the seam to the OS ([`platform`]): macOS posts through
//! `UNUserNotificationCenter` in a category carrying both actions, Windows
//! shows a toast under the `AppUserModelID` the installer registers, and
//! other Unix systems send a freedesktop notification when the server
//! advertises the `actions` capability.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(target_os = "macos"))]
mod notify;
#[cfg(test)]
mod tests;
#[cfg(windows)]
mod windows;
#[cfg(all(unix, not(target_os = "macos")))]
mod xdg;

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

pub use contracts_core::updates::{OfferChannel, UpdateOffer};
use contracts_core::updates::{UpdatePhase, UpdateStatus};
use serde::Deserialize;
use tokio::sync::{mpsc, watch};

use super::UpdatePort;
use crate::channels::{Feed as _, Latest};
use crate::locale::{self, ShippedLocale};
use crate::AppIdentity;

/// The longest the OS may take to accept the offer, an unanswered macOS
/// permission prompt included, before the in-app notice takes over.
pub const OFFER_DEADLINE: Duration = Duration::from_secs(30);

/// A button of the offer.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OfferAction {
    InstallNow,
    InstallOnQuit,
}

impl OfferAction {
    /// Both buttons, in the order the notification shows them.
    pub const ALL: [Self; 2] = [Self::InstallNow, Self::InstallOnQuit];

    /// The identifier the notification carries for this button.
    #[must_use]
    pub const fn identifier(self) -> &'static str {
        match self {
            Self::InstallNow => "install-now",
            Self::InstallOnQuit => "install-on-quit",
        }
    }

    /// The button `identifier` names; `None` for the notification's own
    /// responses, such as a click on its body or a dismissal.
    #[must_use]
    pub fn from_identifier(identifier: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.identifier() == identifier)
    }
}

/// The offer's text, in the user's language.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OfferText {
    pub title: String,
    pub body: String,
    pub install_now: String,
    pub install_on_quit: String,
}

/// The catalogue messages the offer reads. The buttons and the body are the
/// in-app notice's own lines.
#[derive(Deserialize)]
struct Messages {
    #[serde(rename = "update_offer_title")]
    title: String,
    /// With `{version}`.
    #[serde(rename = "settings_advanced_updates_available")]
    available: String,
    #[serde(rename = "settings_advanced_updates_install_now")]
    install_now: String,
    #[serde(rename = "settings_advanced_updates_install_on_quit")]
    install_on_quit: String,
}

impl OfferText {
    /// The offer of release `version` in `locale`.
    ///
    /// # Errors
    ///
    /// The locale's catalogue lacks one of the offer's messages.
    pub fn new(locale: &ShippedLocale, version: &str) -> Result<Self, String> {
        let messages: Messages = locale.messages()?;
        Ok(Self {
            title: messages.title,
            body: locale::fill(&messages.available, &[("version", version)]),
            install_now: messages.install_now,
            install_on_quit: messages.install_on_quit,
        })
    }

    /// The text of `action`'s button.
    #[must_use]
    pub fn label(&self, action: OfferAction) -> &str {
        match action {
            OfferAction::InstallNow => &self.install_now,
            OfferAction::InstallOnQuit => &self.install_on_quit,
        }
    }
}

/// Why the system notification cannot carry the offer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Refusal {
    /// The user has not given notification permission.
    PermissionDenied,
    /// The notification system shows no buttons.
    ActionsUnsupported,
    /// The notification could not be shown; English detail for the log.
    Failed(String),
}

/// Hands a clicked button to the offer, from any thread.
#[derive(Clone, Debug)]
pub struct Chooser(mpsc::UnboundedSender<OfferAction>);

impl Chooser {
    /// The user clicked `action`.
    pub fn choose(&self, action: OfferAction) {
        // A closed channel means the offer task ended with the process.
        let _ = self.0.send(action);
    }

    /// The user clicked the button `identifier` names; anything else, such
    /// as a click on the notification's body, is ignored.
    pub fn choose_identifier(&self, identifier: &str) {
        if let Some(action) = OfferAction::from_identifier(identifier) {
            self.choose(action);
        }
    }
}

/// The OS side of the offer: a system notification with both buttons.
pub trait SystemOffer: Send + Sync + 'static {
    /// Show `text` with an Install now and an Install on quit button, and
    /// pass each click to `chooser`. Resolves once the OS accepted the
    /// notification, or with why it cannot carry the offer.
    fn post(
        &self,
        text: &OfferText,
        chooser: Chooser,
    ) -> impl Future<Output = Result<(), Refusal>> + Send;
}

#[cfg(target_os = "macos")]
type Platform = macos::MacOffer;
#[cfg(windows)]
type Platform = windows::ToastOffer;
#[cfg(all(unix, not(target_os = "macos")))]
type Platform = xdg::XdgOffer;

/// This platform's [`SystemOffer`], posting under `identity`.
#[must_use]
pub fn platform(identity: &AppIdentity) -> impl SystemOffer {
    Platform::new(identity)
}

/// The update offers of one process. Cheap to clone.
#[derive(Clone)]
pub struct Offers {
    published: Arc<watch::Sender<UpdateOffer>>,
}

impl Offers {
    /// Offer each release `port` finds through `system`, in the locale
    /// `locale` names at the time. Runs on the ambient tokio runtime until
    /// `port`'s status ends.
    pub fn spawn<P, S>(
        port: P,
        system: S,
        locale: impl Fn() -> &'static ShippedLocale + Send + 'static,
    ) -> Self
    where
        P: UpdatePort + Clone + 'static,
        S: SystemOffer,
    {
        let (published, _) = watch::channel(UpdateOffer::none());
        let published = Arc::new(published);
        let (choices, chosen) = mpsc::unbounded_channel();
        tokio::spawn(run_choices(port.clone(), chosen));
        tokio::spawn(make_offers(port, system, locale, Chooser(choices), Arc::clone(&published)));
        Self { published }
    }

    /// Where the offer for the release the last check found was made.
    #[must_use]
    pub fn current(&self) -> UpdateOffer {
        self.published.borrow().clone()
    }

    /// The current offer first, then each change.
    #[must_use]
    pub fn feed(&self) -> Latest<UpdateOffer> {
        Latest::new(self.published.subscribe())
    }
}

/// Run the port operation of each clicked button, each on its own task as
/// each in-app button runs its own command.
async fn run_choices<P: UpdatePort + Clone + 'static>(
    port: P,
    mut chosen: mpsc::UnboundedReceiver<OfferAction>,
) {
    while let Some(action) = chosen.recv().await {
        let port = port.clone();
        tokio::spawn(async move {
            match action {
                OfferAction::InstallNow => port.install_now().await,
                OfferAction::InstallOnQuit => port.install_on_quit().await,
            }
        });
    }
}

/// Offer each newly available release, and publish where it was offered.
async fn make_offers<P, S>(
    port: P,
    system: S,
    locale: impl Fn() -> &'static ShippedLocale,
    chooser: Chooser,
    published: Arc<watch::Sender<UpdateOffer>>,
) where
    P: UpdatePort,
    S: SystemOffer,
{
    let mut status = port.status();
    let mut offered: Option<String> = None;
    while let Some(status) = status.next().await {
        let Some(version) = newly_available(&status, offered.as_deref()) else { continue };
        offered = Some(version.to_owned());
        let refusal = match OfferText::new(locale(), version) {
            Ok(text) => tokio::time::timeout(OFFER_DEADLINE, system.post(&text, chooser.clone()))
                .await
                .unwrap_or_else(|_| {
                    Err(Refusal::Failed("the OS did not accept the notification in time".to_owned()))
                })
                .err(),
            Err(error) => Some(Refusal::Failed(error)),
        };
        let channel = match refusal {
            None => OfferChannel::System,
            Some(refusal) => {
                tracing::info!(?refusal, version, "the in-app notice offers the update");
                OfferChannel::InApp
            }
        };
        published.send_replace(UpdateOffer { version: Some(version.to_owned()), channel });
    }
}

/// The release `status` offers, unless it is the one already `offered`.
fn newly_available<'a>(status: &'a UpdateStatus, offered: Option<&str>) -> Option<&'a str> {
    let version = status.version.as_deref().filter(|_| status.phase == UpdatePhase::Available)?;
    (offered != Some(version)).then_some(version)
}
