// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer through its interface: a fake update port records which
//! operation each button runs, and a fake OS accepts or refuses the
//! notification the way each platform can.

use std::future::{ready, Future};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use contracts_core::updates::{UpdatePhase, UpdateStatus};
use tokio::sync::{watch, Notify};

use super::{
    Chooser, OfferAction, OfferChannel, OfferText, Offers, Refusal, SystemOffer, UpdateOffer,
    OFFER_DEADLINE,
};
use crate::channels::{Feed as _, Latest};
use crate::locale::{self, ShippedLocale};
use crate::update::UpdatePort;

/// What the port records when the offer ran none of its operations.
const NO_CALLS: [&str; 0] = [];

/// Records every port operation the offer runs.
#[derive(Clone)]
struct FakePort {
    status: Arc<watch::Sender<UpdateStatus>>,
    calls: Arc<Mutex<Vec<&'static str>>>,
    called: Arc<Notify>,
}

impl FakePort {
    fn new() -> Self {
        let (status, _) = watch::channel(UpdateStatus::idle());
        Self { status: Arc::new(status), calls: Arc::default(), called: Arc::default() }
    }

    fn publish(&self, phase: UpdatePhase, version: &str) {
        self.status.send_replace(UpdateStatus {
            phase,
            version: Some(version.to_owned()),
            body: None,
            error: None,
        });
    }

    fn record(&self, call: &'static str) {
        self.calls.lock().unwrap().push(call);
        self.called.notify_one();
    }

    fn calls(&self) -> Vec<&'static str> {
        self.calls.lock().unwrap().clone()
    }

    async fn next_call(&self) -> Vec<&'static str> {
        tokio::time::timeout(Duration::from_secs(5), self.called.notified())
            .await
            .expect("the offer ran no port operation");
        self.calls()
    }
}

impl UpdatePort for FakePort {
    fn status(&self) -> Latest<UpdateStatus> {
        Latest::new(self.status.subscribe())
    }

    fn check(&self) -> impl Future<Output = ()> + Send {
        self.record("check");
        ready(())
    }

    fn download(&self) -> impl Future<Output = bool> + Send {
        self.record("download");
        ready(true)
    }

    fn install_now(&self) -> impl Future<Output = ()> + Send {
        self.record("install_now");
        ready(())
    }

    fn install_on_quit(&self) -> impl Future<Output = ()> + Send {
        self.record("install_on_quit");
        ready(())
    }
}

/// How the fake OS answers a notification.
#[derive(Clone)]
enum Answer {
    Accept,
    Refuse(Refusal),
    Never,
}

/// A fake OS that keeps every posted offer and its chooser.
#[derive(Clone)]
struct FakeSystem {
    answer: Answer,
    posted: Arc<Mutex<Vec<OfferText>>>,
    chooser: Arc<Mutex<Option<Chooser>>>,
}

impl FakeSystem {
    fn new(answer: Answer) -> Self {
        Self { answer, posted: Arc::default(), chooser: Arc::default() }
    }

    fn posted(&self) -> Vec<OfferText> {
        self.posted.lock().unwrap().clone()
    }

    /// The user clicks `action` in the posted notification.
    fn click(&self, action: OfferAction) {
        self.chooser.lock().unwrap().as_ref().expect("an offer was posted").choose(action);
    }
}

impl SystemOffer for FakeSystem {
    async fn post(&self, text: &OfferText, chooser: Chooser) -> Result<(), Refusal> {
        self.posted.lock().unwrap().push(text.clone());
        *self.chooser.lock().unwrap() = Some(chooser);
        match &self.answer {
            Answer::Accept => Ok(()),
            Answer::Refuse(refusal) => Err(refusal.clone()),
            Answer::Never => std::future::pending().await,
        }
    }
}

fn base() -> &'static ShippedLocale {
    locale::base()
}

/// The offer published for `version`, once the OS answered.
async fn offer_for(offers: &Offers, version: &str) -> UpdateOffer {
    let mut feed = offers.feed();
    let wait = async {
        loop {
            let offer = feed.next().await.expect("the offer feed ended");
            if offer.version.as_deref() == Some(version) {
                return offer;
            }
        }
    };
    tokio::time::timeout(OFFER_DEADLINE * 2, wait).await.expect("no offer was published")
}

/// An offer for `version` made through `answer`, and its fakes.
async fn offered(answer: Answer, version: &str) -> (FakePort, FakeSystem, Offers, UpdateOffer) {
    let port = FakePort::new();
    let system = FakeSystem::new(answer);
    let offers = Offers::spawn(port.clone(), system.clone(), base);
    port.publish(UpdatePhase::Available, version);
    let offer = offer_for(&offers, version).await;
    (port, system, offers, offer)
}

#[tokio::test]
async fn install_now_in_the_notification_runs_the_ports_install_now() {
    let (port, system, _offers, _) = offered(Answer::Accept, "0.7.0").await;
    system.click(OfferAction::InstallNow);
    assert_eq!(port.next_call().await, ["install_now"]);
}

#[tokio::test]
async fn install_on_quit_in_the_notification_runs_the_ports_install_on_quit() {
    let (port, system, _offers, _) = offered(Answer::Accept, "0.7.0").await;
    system.click(OfferAction::InstallOnQuit);
    assert_eq!(port.next_call().await, ["install_on_quit"]);
}

#[tokio::test]
async fn nothing_downloads_before_a_click() {
    let (port, system, _offers, _) = offered(Answer::Accept, "0.7.0").await;
    assert_eq!(system.posted().len(), 1);
    assert_eq!(port.calls(), NO_CALLS, "the offer ran a port operation before a click");
}

#[tokio::test]
async fn an_accepted_notification_carries_the_offer() {
    let (_, _, offers, offer) = offered(Answer::Accept, "0.7.0").await;
    let expected = UpdateOffer { version: Some("0.7.0".to_owned()), channel: OfferChannel::System };
    assert_eq!(offer, expected);
    assert_eq!(offers.current(), expected);
}

#[tokio::test]
async fn denied_permission_falls_back_to_the_in_app_notice() {
    let (port, _, _, offer) = offered(Answer::Refuse(Refusal::PermissionDenied), "0.7.0").await;
    assert_eq!(offer.channel, OfferChannel::InApp);
    assert_eq!(port.calls(), NO_CALLS);
}

#[tokio::test]
async fn a_notification_system_without_buttons_falls_back_to_the_in_app_notice() {
    let (port, _, _, offer) = offered(Answer::Refuse(Refusal::ActionsUnsupported), "0.7.0").await;
    assert_eq!(offer.channel, OfferChannel::InApp);
    assert_eq!(port.calls(), NO_CALLS);
}

#[tokio::test]
async fn a_notification_that_cannot_be_shown_falls_back_to_the_in_app_notice() {
    let refusal = Refusal::Failed("no notification server".to_owned());
    let (_, _, _, offer) = offered(Answer::Refuse(refusal), "0.7.0").await;
    assert_eq!(offer.channel, OfferChannel::InApp);
}

#[tokio::test(start_paused = true)]
async fn an_unanswered_notification_falls_back_after_the_deadline() {
    let (_, _, _, offer) = offered(Answer::Never, "0.7.0").await;
    assert_eq!(offer.channel, OfferChannel::InApp);
}

#[tokio::test]
async fn each_release_is_offered_once() {
    let (port, system, offers, _) = offered(Answer::Accept, "0.7.0").await;
    port.publish(UpdatePhase::Checking, "0.7.0");
    port.publish(UpdatePhase::Available, "0.7.0");
    port.publish(UpdatePhase::Available, "0.7.1");
    offer_for(&offers, "0.7.1").await;
    let bodies: Vec<_> = system.posted().into_iter().map(|text| text.body).collect();
    assert_eq!(bodies, ["Update 0.7.0 is available.", "Update 0.7.1 is available."]);
}

#[tokio::test]
async fn phases_after_available_make_no_offer() {
    let port = FakePort::new();
    let system = FakeSystem::new(Answer::Accept);
    let offers = Offers::spawn(port.clone(), system.clone(), base);
    for phase in [UpdatePhase::Downloading, UpdatePhase::InstallOnQuit, UpdatePhase::UpToDate] {
        port.publish(phase, "0.7.0");
        tokio::task::yield_now().await;
    }
    port.publish(UpdatePhase::Available, "0.7.1");
    offer_for(&offers, "0.7.1").await;
    assert_eq!(system.posted().len(), 1);
}

#[tokio::test]
async fn the_offer_speaks_the_locale_it_reads_at_the_time() {
    let port = FakePort::new();
    let system = FakeSystem::new(Answer::Accept);
    let offers = Offers::spawn(port.clone(), system.clone(), || locale::shipped_or_base("pt-BR"));
    port.publish(UpdatePhase::Available, "0.7.0");
    offer_for(&offers, "0.7.0").await;
    assert_eq!(
        system.posted(),
        [OfferText {
            title: "Atualização disponível".to_owned(),
            body: "A atualização 0.7.0 está disponível.".to_owned(),
            install_now: "Instalar agora".to_owned(),
            install_on_quit: "Instalar ao sair".to_owned(),
        }]
    );
}

#[test]
fn every_shipped_locale_words_the_offer() {
    for shipped in &locale::SHIPPED_LOCALES {
        let text = OfferText::new(shipped, "0.7.0").unwrap_or_else(|error| panic!("{error}"));
        assert!(text.body.contains("0.7.0"), "{}: {}", shipped.tag, text.body);
    }
}

#[test]
fn a_button_identifier_names_its_action_and_nothing_else_does() {
    for action in OfferAction::ALL {
        assert_eq!(OfferAction::from_identifier(action.identifier()), Some(action));
    }
    for other in ["default", "__closed", "com.apple.UNNotificationDefaultActionIdentifier", ""] {
        assert_eq!(OfferAction::from_identifier(other), None, "{other}");
    }
}
