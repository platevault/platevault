// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The update offer (astro-plan-c72oo, decision astro-plan-eub2i).
//!
//! When a check finds a release, a system notification offers Install now
//! and Install on quit. Each button runs the [`UpdatePort`] operation the
//! matching in-app button runs, and only where that in-app button shows: for
//! the release the status names, in a phase that offers it
//! ([`allows`]). A click on a notification for another release, or during
//! a download or install, is dropped. This module has no update logic of
//! its own.
//!
//! [`Offers::current`] and [`Offers::feed`] say where the offer for the
//! release stands. [`OfferChannel::System`] holds only while a notification
//! that stays on screen until it is answered ([`Delivery::Persistent`]) is
//! outstanding. Everywhere else the notification is a heads-up
//! ([`Delivery::Transient`]) and [`OfferChannel::InApp`] keeps the in-app
//! notice visible:
//!
//! - macOS: `System` for the Alert notification style, which stays until
//!   the user acts, posted while the app is in the background. Posted while
//!   the app is frontmost, any notification shows as a banner. The Banner
//!   style leaves the screen by itself, and Focus sends it to Notification
//!   Center, so a banner is a heads-up.
//! - Windows: a heads-up until the app can read whether the user turned its
//!   toasts off (`ToastNotifier.Setting`, decision D2 pending).
//! - Linux and the other freedesktop systems: a heads-up. The notification
//!   does not expire, but at normal urgency a server such as GNOME Shell
//!   moves it off screen into its tray.
//!
//! The in-app notice also takes over when notification permission is
//! denied, the notification system shows no buttons, the notification
//! cannot be shown, the OS has not accepted it within [`OFFER_DEADLINE`],
//! the user answered or closed it, or it was withdrawn. The notification is
//! withdrawn when the phase leaves "available" or a newer release is
//! offered. A release offered once and available again, after a failed
//! download for one, is offered in-app.
//!
//! The offer is made from the check result alone, so nothing downloads
//! before a click.
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

    /// The button `identifier` names.
    #[must_use]
    pub fn from_identifier(identifier: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.identifier() == identifier)
    }
}

/// What the user did with an offer notification. Either way it is gone.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Response {
    /// Clicked a button.
    Chose(OfferAction),
    /// Clicked the notification's body or closed it, or the notification
    /// system dropped it.
    Dismissed,
}

impl Response {
    /// The response a notification reports by `identifier`: a button's
    /// identifier, else a dismissal, such as a body click or a close
    /// (`com.apple.UNNotificationDefaultActionIdentifier` and
    /// `com.apple.UNNotificationDismissActionIdentifier` on macOS, `default`
    /// and `__closed` through `notify-rust`).
    #[must_use]
    pub fn from_identifier(identifier: &str) -> Self {
        OfferAction::from_identifier(identifier).map_or(Self::Dismissed, Self::Chose)
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

/// How long an accepted notification stays on screen.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Delivery {
    /// Until the user answers it: the notification carries the offer.
    Persistent,
    /// It may leave the screen unanswered: a heads-up beside the in-app
    /// notice.
    Transient,
}

/// Why the system notification cannot carry the offer.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Refusal {
    /// The user has not given notification permission, or the OS shows the
    /// app's notifications without a banner or alert.
    PermissionDenied,
    /// The notification system shows no buttons.
    ActionsUnsupported,
    /// The notification could not be shown; English detail for the log.
    Failed(String),
}

/// What the offer task handles, in order.
enum Event {
    Status(UpdateStatus),
    Response {
        version: String,
        response: Response,
    },
    /// The update status ended with the updater.
    Ended,
}

/// Reports the user's response to the notification for one release, from
/// any thread.
#[derive(Clone, Debug)]
pub struct Responder {
    version: String,
    events: mpsc::UnboundedSender<Event>,
}

impl Responder {
    /// The user responded with `response`.
    pub fn respond(&self, response: Response) {
        let event = Event::Response { version: self.version.clone(), response };
        // A closed channel means the offer task ended with the updater.
        self.events.send(event).ok();
    }

    /// The notification reported `identifier` ([`Response::from_identifier`]).
    pub fn respond_identifier(&self, identifier: &str) {
        self.respond(Response::from_identifier(identifier));
    }
}

/// The OS side of the offer: a system notification with both buttons.
pub trait SystemOffer: Send + Sync + 'static {
    /// Show `text` with an Install now and an Install on quit button, and
    /// pass the user's response to `responder`. Resolves once the OS accepted
    /// the notification, with how long it stays on screen, or with why it
    /// cannot carry the offer.
    fn post(
        &self,
        text: &OfferText,
        responder: Responder,
    ) -> impl Future<Output = Result<Delivery, Refusal>> + Send;

    /// Take the notification [`Self::post`] showed, or is still showing, off
    /// screen, where the OS allows it.
    fn withdraw(&self);
}

#[cfg(target_os = "macos")]
type Platform = macos::MacOffer;
#[cfg(windows)]
type Platform = windows::ToastOffer;
#[cfg(all(unix, not(target_os = "macos")))]
type Platform = xdg::XdgOffer;

/// Reads whether the app's main window is frontmost: `None` when that is
/// not known.
pub type Focus = Box<dyn Fn() -> Option<bool> + Send + Sync>;

/// This platform's [`SystemOffer`], posting under `identity`. `focused` is
/// read at each post: macOS shows a notification posted while the app is
/// frontmost as a banner that leaves the screen, whatever the user's style.
#[must_use]
pub fn platform(identity: &AppIdentity, focused: Focus) -> impl SystemOffer {
    Platform::new(identity, focused)
}

/// Whether the in-app notice offers `action` for `version` in `status`,
/// mirroring the UI's `canInstall`: Install now from every installable
/// phase, Install on quit from each but the one it leads to.
#[must_use]
pub fn allows(status: &UpdateStatus, version: &str, action: OfferAction) -> bool {
    let installable = match status.phase {
        UpdatePhase::Available | UpdatePhase::DownloadFailed | UpdatePhase::InstallFailed => true,
        UpdatePhase::InstallOnQuit => action == OfferAction::InstallNow,
        _ => false,
    };
    installable && status.version.as_deref() == Some(version)
}

/// The update offers of one process. Cheap to clone.
#[derive(Clone)]
pub struct Offers {
    published: Arc<watch::Sender<UpdateOffer>>,
}

impl Offers {
    /// Offer each release `port` finds through `system`, in the locale
    /// `locale` names at the time. The returned task does the work: spawn it
    /// on the runtime the port's operations should run on. It ends with
    /// `port`'s status.
    pub fn new<P, S>(
        port: P,
        system: S,
        locale: impl Fn() -> &'static ShippedLocale + Send + Sync + 'static,
    ) -> (Self, impl Future<Output = ()> + Send + 'static)
    where
        P: UpdatePort + Clone + 'static,
        S: SystemOffer,
    {
        let (published, _) = watch::channel(UpdateOffer::none());
        let published = Arc::new(published);
        let (events, received) = mpsc::unbounded_channel();
        let statuses = forward_statuses(port.status(), events.clone());
        let offer = Offer {
            status: port.status(),
            port,
            system,
            locale,
            events,
            published: Arc::clone(&published),
            offered: None,
            outstanding: None,
        };
        let task = async move {
            tokio::join!(statuses, offer.run(received));
        };
        (Self { published }, task)
    }

    /// Where the offer for the release the last check found stands.
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

async fn forward_statuses(mut status: Latest<UpdateStatus>, events: mpsc::UnboundedSender<Event>) {
    while let Some(status) = status.next().await {
        if events.send(Event::Status(status)).is_err() {
            return;
        }
    }
    events.send(Event::Ended).ok();
}

/// The offer task's state.
struct Offer<P, S, L> {
    port: P,
    system: S,
    locale: L,
    events: mpsc::UnboundedSender<Event>,
    published: Arc<watch::Sender<UpdateOffer>>,
    /// The port's status as it is now, which a click is judged against: the
    /// queue may not have reached the latest change yet.
    status: Latest<UpdateStatus>,
    /// The release last posted.
    offered: Option<String>,
    /// How the notification for `offered` stays on screen, while it is
    /// posted and unanswered.
    outstanding: Option<Delivery>,
}

impl<P, S, L> Offer<P, S, L>
where
    P: UpdatePort + Clone + 'static,
    S: SystemOffer,
    L: Fn() -> &'static ShippedLocale,
{
    async fn run(mut self, mut received: mpsc::UnboundedReceiver<Event>) {
        while let Some(event) = received.recv().await {
            match event {
                Event::Status(status) => self.on_status(status).await,
                Event::Response { version, response } => self.on_response(&version, response),
                Event::Ended => return,
            }
        }
    }

    async fn on_status(&mut self, status: UpdateStatus) {
        let available = status.version.clone().filter(|_| status.phase == UpdatePhase::Available);
        match available {
            Some(version) if self.offered.as_ref() == Some(&version) => {
                // Still posted, or answered, closed or withdrawn earlier.
                if self.outstanding != Some(Delivery::Persistent) {
                    self.publish(&version, OfferChannel::InApp);
                }
            }
            Some(version) => {
                self.withdraw();
                self.offered = Some(version.clone());
                let channel = match self.post(&version).await {
                    Ok(delivery) => {
                        self.outstanding = Some(delivery);
                        match delivery {
                            Delivery::Persistent => OfferChannel::System,
                            Delivery::Transient => OfferChannel::InApp,
                        }
                    }
                    Err(refusal) => {
                        tracing::info!(?refusal, version, "the in-app notice offers the update");
                        OfferChannel::InApp
                    }
                };
                self.publish(&version, channel);
            }
            None => self.withdraw(),
        }
    }

    /// Post the offer of `version`. A notification the OS does not accept in
    /// time is withdrawn, where the OS allows it, should it appear later.
    async fn post(&self, version: &str) -> Result<Delivery, Refusal> {
        let text = OfferText::new((self.locale)(), version).map_err(Refusal::Failed)?;
        let responder = Responder { version: version.to_owned(), events: self.events.clone() };
        let posted = tokio::time::timeout(OFFER_DEADLINE, self.system.post(&text, responder)).await;
        posted.unwrap_or_else(|_| {
            self.system.withdraw();
            Err(Refusal::Failed("the OS did not accept the notification in time".to_owned()))
        })
    }

    /// Take the outstanding notification off screen and offer in-app.
    fn withdraw(&mut self) {
        if self.outstanding.take().is_none() {
            return;
        }
        self.system.withdraw();
        if let Some(version) = self.offered.clone() {
            self.publish(&version, OfferChannel::InApp);
        }
    }

    fn on_response(&mut self, version: &str, response: Response) {
        if self.offered.as_deref() == Some(version) && self.outstanding.take().is_some() {
            self.publish(version, OfferChannel::InApp);
        }
        let Response::Chose(action) = response else { return };
        let now = self.status.current();
        if !allows(&now, version, action) {
            tracing::info!(?action, version, phase = ?now.phase, "a stale offer button was ignored");
            return;
        }
        // Each on its own task, as each in-app button runs its own command.
        let port = self.port.clone();
        tokio::spawn(async move {
            match action {
                OfferAction::InstallNow => port.install_now().await,
                OfferAction::InstallOnQuit => port.install_on_quit().await,
            }
        });
    }

    fn publish(&self, version: &str, channel: OfferChannel) {
        self.published.send_replace(UpdateOffer { version: Some(version.to_owned()), channel });
    }
}
