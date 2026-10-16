// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer on macOS: a `UNUserNotificationCenter` notification in a
//! category carrying Install now and Install on quit
//! (`platevault_notify_macos`). It is posted only once the category is
//! registered, and only when the app may show notifications on screen: full
//! permission with the Banner or Alert style ([`delivery`]). When permission
//! was never asked, it is asked for now. The Alert style stays on screen
//! until the user acts, so it carries the offer, unless the app is
//! frontmost: the center delegate then presents the notification as a
//! banner, whatever the style. A banner leaves the screen by itself, and
//! Focus sends it to Notification Center, so it is a heads-up beside the
//! in-app notice. A process without a bundle, such as `cargo tauri dev`,
//! gets the in-app notice.
//!
//! Each release is posted under a request identifier of its own, and the
//! category's one handler routes a response by the identifier of the
//! notification that received it ([`Responders`]). A response to an older
//! release's notification, already queued when a newer release registered
//! the category again, so answers for its own release, which the offer
//! then drops as stale. Every post first removes every offer notification
//! still delivered or pending, so neither an earlier post's nor one left by
//! an earlier run of the app keeps buttons that reach no responder.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use platevault_notify_macos::{Action, AlertStyle, Authorization, NotificationCenter, Settings};
use tokio::sync::oneshot;

use super::{Delivery, Focus, OfferAction, OfferText, Refusal, Responder, SystemOffer};
use crate::AppIdentity;

/// The category the offer is posted in, which carries its buttons.
const CATEGORY: &str = "update-offer";

/// The request identifier of the offer of `version`.
fn request_for(version: &str) -> String {
    format!("update-offer-{version}")
}

/// The responder of every offer posted, by request identifier. Kept for the
/// process, one per release offered, so a response that arrives after a
/// newer post still reaches the responder of its own release.
#[derive(Default)]
struct Responders {
    by_request: HashMap<String, Responder>,
    /// The request of the last post, which [`SystemOffer::withdraw`] removes.
    last: Option<String>,
}

impl Responders {
    /// Keep `responder` and return its request identifier.
    fn add(&mut self, responder: Responder) -> String {
        let request = request_for(&responder.version);
        self.by_request.insert(request.clone(), responder);
        self.last = Some(request.clone());
        request
    }

    /// The notification `request` reported `action`.
    fn respond(&self, request: &str, action: &str) {
        if let Some(responder) = self.by_request.get(request) {
            responder.respond_identifier(action);
        }
    }
}

/// The offer through the process's notification center.
pub struct MacOffer {
    responders: Arc<Mutex<Responders>>,
    focused: Focus,
}

impl MacOffer {
    /// The center posts under the bundle's own identifier.
    pub fn new(_identity: &AppIdentity, focused: Focus) -> Self {
        Self { responders: Arc::default(), focused }
    }

    /// The request of the last post.
    fn last_request(&self) -> Option<String> {
        self.responders.lock().unwrap_or_else(PoisonError::into_inner).last.clone()
    }
}

impl SystemOffer for MacOffer {
    async fn post(&self, text: &OfferText, responder: Responder) -> Result<Delivery, Refusal> {
        let (send, cleared) = oneshot::channel();
        center()?.withdraw_category(CATEGORY, move || {
            send.send(()).ok();
        });
        cleared.await.map_err(|_| never_answered())?;
        let settings = permission().await?;
        let delivery = delivery(settings, (self.focused)())?;
        let request = self.responders.lock().unwrap_or_else(PoisonError::into_inner).add(responder);
        let (send, registered) = oneshot::channel();
        {
            let actions = OfferAction::ALL
                .into_iter()
                .map(|action| Action {
                    identifier: action.identifier().to_owned(),
                    title: text.label(action).to_owned(),
                })
                .collect();
            let responders = Arc::clone(&self.responders);
            center()?.register_category(
                CATEGORY,
                actions,
                move |request, action| {
                    responders
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .respond(request, action);
                },
                move |registered| {
                    send.send(registered).ok();
                },
            );
        }
        if !registered.await.map_err(|_| never_answered())? {
            return Err(Refusal::Failed("the offer's buttons were not registered".to_owned()));
        }
        let (send, accepted) = oneshot::channel();
        center()?.submit_in_category(&request, &text.title, &text.body, CATEGORY, move |result| {
            drop(send.send(result));
        });
        accepted.await.map_err(|_| never_answered())?.map_err(Refusal::Failed)?;
        Ok(delivery)
    }

    fn withdraw(&self) {
        if let (Some(request), Some(center)) = (self.last_request(), NotificationCenter::current())
        {
            center.withdraw(&request);
        }
    }
}

/// How a notification under `settings`, posted while the app is `frontmost`
/// or not (`None`: not known), stays on screen, or why it would not be seen.
/// Provisional and ephemeral permission, and the None style, show no
/// banner, so the buttons would sit unseen in Notification Center. Posted
/// while the app is frontmost, or may be, even an alert is presented as a
/// banner.
fn delivery(settings: Settings, frontmost: Option<bool>) -> Result<Delivery, Refusal> {
    match (settings.authorization, settings.style, frontmost) {
        (Authorization::Authorized, AlertStyle::Alert, Some(false)) => Ok(Delivery::Persistent),
        (Authorization::Authorized, AlertStyle::Alert | AlertStyle::Banner, _) => {
            Ok(Delivery::Transient)
        }
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
    use contracts_core::updates::{UpdatePhase, UpdateStatus};
    use platevault_notify_macos::{AlertStyle, Authorization, Settings};
    use tokio::sync::mpsc;

    use super::super::{allows, Event, OfferAction, Responder, Response};
    use super::{delivery, Delivery, Refusal, Responders};

    #[test]
    fn a_response_to_an_older_alert_answers_for_its_own_release_and_is_dropped() {
        let (events, mut received) = mpsc::unbounded_channel();
        let responder =
            |version: &str| Responder { version: version.to_owned(), events: events.clone() };
        let mut responders = Responders::default();
        let older = responders.add(responder("0.7.0"));
        // A newer release is posted, re-registering the category's handler,
        // before the response to the older alert is handled.
        responders.add(responder("0.7.1"));
        responders.respond(&older, OfferAction::InstallNow.identifier());

        let Ok(Event::Response { version, response }) = received.try_recv() else {
            panic!("the response did not reach a responder");
        };
        assert_eq!(version, "0.7.0");
        assert_eq!(response, Response::Chose(OfferAction::InstallNow));
        let now = UpdateStatus {
            phase: UpdatePhase::Available,
            version: Some("0.7.1".to_owned()),
            body: None,
            error: None,
        };
        assert!(!allows(&now, &version, OfferAction::InstallNow), "a stale click would install");
    }

    #[test]
    fn a_response_to_an_unknown_request_reaches_no_responder() {
        let (events, mut received) = mpsc::unbounded_channel();
        let mut responders = Responders::default();
        responders.add(Responder { version: "0.7.0".to_owned(), events });
        responders.respond("update-offer", OfferAction::InstallNow.identifier());
        assert!(received.try_recv().is_err());
    }

    const FRONTMOST: [Option<bool>; 3] = [Some(true), Some(false), None];

    #[test]
    fn only_an_alert_posted_while_the_app_is_in_the_background_carries_the_offer() {
        let authorized = |style| Settings { authorization: Authorization::Authorized, style };
        assert_eq!(delivery(authorized(AlertStyle::Alert), Some(false)), Ok(Delivery::Persistent));
        // The delegate presents a notification as a banner while the app is
        // frontmost; unknown focus may be frontmost.
        assert_eq!(delivery(authorized(AlertStyle::Alert), Some(true)), Ok(Delivery::Transient));
        assert_eq!(delivery(authorized(AlertStyle::Alert), None), Ok(Delivery::Transient));
        for frontmost in FRONTMOST {
            assert_eq!(
                delivery(authorized(AlertStyle::Banner), frontmost),
                Ok(Delivery::Transient),
                "banner {frontmost:?}"
            );
            assert_eq!(
                delivery(authorized(AlertStyle::None), frontmost),
                Err(Refusal::PermissionDenied),
                "none {frontmost:?}"
            );
        }
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
                for frontmost in FRONTMOST {
                    assert_eq!(
                        delivery(Settings { authorization, style }, frontmost),
                        Err(Refusal::PermissionDenied),
                        "{authorization:?} {style:?} {frontmost:?}"
                    );
                }
            }
        }
    }
}
