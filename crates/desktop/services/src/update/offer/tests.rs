// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The offer through its interface: a fake update port records which
//! operation each button runs, and a fake OS accepts or refuses the
//! notification the way each platform can, on demand where a test needs to
//! act while a post is pending, and answers it the way a user can. Every
//! wait is for an observable outcome.

use std::future::{ready, Future};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use contracts_core::updates::{UpdatePhase, UpdateStatus};
use tokio::sync::{oneshot, watch};

use super::{
    allows, Delivery, OfferAction, OfferChannel, OfferText, Offers, Refusal, Responder, Response,
    SystemOffer, UpdateOffer, OFFER_DEADLINE, PERSISTENT_OFFER_TIMEOUT,
};
use crate::channels::{Feed as _, Latest};
use crate::locale::{self, ShippedLocale};
use crate::update::UpdatePort;

/// What the port records when the offer ran none of its operations.
const NO_CALLS: [&str; 0] = [];

/// Wait until `condition` holds; the tasks under test run in the meantime.
async fn until(what: &str, condition: impl Fn() -> bool) {
    let wait = async {
        while !condition() {
            tokio::task::yield_now().await;
        }
    };
    tokio::time::timeout(Duration::from_secs(5), wait)
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {what}"));
}

/// Records every port operation the offer runs.
#[derive(Clone)]
struct FakePort {
    status: Arc<watch::Sender<UpdateStatus>>,
    calls: Arc<Mutex<Vec<&'static str>>>,
}

impl FakePort {
    fn new() -> Self {
        let (status, _) = watch::channel(UpdateStatus::idle());
        Self { status: Arc::new(status), calls: Arc::default() }
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
    }

    fn calls(&self) -> Vec<&'static str> {
        self.calls.lock().unwrap().clone()
    }

    /// The operations run, once at least one has.
    async fn first_calls(&self) -> Vec<&'static str> {
        until("a port operation", || !self.calls().is_empty()).await;
        self.calls()
    }
}

impl UpdatePort for FakePort {
    fn status(&self) -> Latest<UpdateStatus> {
        Latest::new(self.status.subscribe())
    }

    fn check(&self, _include_candidates: bool) -> impl Future<Output = ()> + Send {
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
    Now(Result<Delivery, Refusal>),
    /// When the test calls [`FakeSystem::decide`].
    OnDemand,
    Never,
}

/// A fake OS that keeps every posted offer with its responder, and counts
/// withdrawals.
#[derive(Clone)]
struct FakeSystem {
    answer: Answer,
    posted: Arc<Mutex<Vec<(OfferText, Responder)>>>,
    pending: Arc<Mutex<Option<oneshot::Sender<Result<Delivery, Refusal>>>>>,
    withdrawn: Arc<Mutex<usize>>,
}

impl FakeSystem {
    fn new(answer: Answer) -> Self {
        Self { answer, posted: Arc::default(), pending: Arc::default(), withdrawn: Arc::default() }
    }

    fn posted(&self) -> Vec<OfferText> {
        self.posted.lock().unwrap().iter().map(|(text, _)| text.clone()).collect()
    }

    fn posts(&self) -> usize {
        self.posted.lock().unwrap().len()
    }

    fn withdrawn(&self) -> usize {
        *self.withdrawn.lock().unwrap()
    }

    /// The user answers the `index`th posted notification with `response`.
    fn answer(&self, index: usize, response: Response) {
        self.posted.lock().unwrap()[index].1.respond(response);
    }

    /// The user answers the last posted notification.
    fn answer_last(&self, response: Response) {
        let last = self.posts() - 1;
        self.answer(last, response);
    }

    /// The OS shows the `index`th posted notification as a heads-up after
    /// all: macOS presents it as a banner while the app is frontmost.
    fn heads_up(&self, index: usize) {
        self.posted.lock().unwrap()[index].1.heads_up();
    }

    /// The OS answers the pending post.
    fn decide(&self, result: Result<Delivery, Refusal>) {
        let pending = self.pending.lock().unwrap().take().expect("a post is pending");
        pending.send(result).expect("the post is still waiting");
    }
}

impl SystemOffer for FakeSystem {
    async fn post(&self, text: &OfferText, responder: Responder) -> Result<Delivery, Refusal> {
        let decided = match &self.answer {
            Answer::OnDemand => {
                let (send, decided) = oneshot::channel();
                *self.pending.lock().unwrap() = Some(send);
                Some(decided)
            }
            Answer::Now(_) | Answer::Never => None,
        };
        self.posted.lock().unwrap().push((text.clone(), responder));
        match (&self.answer, decided) {
            (Answer::Now(result), _) => result.clone(),
            (_, Some(decided)) => decided.await.expect("the test decides the post"),
            (_, None) => std::future::pending().await,
        }
    }

    fn withdraw(&self) {
        *self.withdrawn.lock().unwrap() += 1;
    }
}

fn base() -> &'static ShippedLocale {
    locale::base()
}

fn offer(version: &str, channel: OfferChannel) -> UpdateOffer {
    UpdateOffer { version: Some(version.to_owned()), channel }
}

/// Wait until the published offer is `expected`.
async fn published(offers: &Offers, expected: &UpdateOffer) {
    let mut feed = offers.feed();
    let wait = async { while feed.next().await.expect("the offer feed ended") != *expected {} };
    tokio::time::timeout(OFFER_DEADLINE * 2, wait).await.unwrap_or_else(|_| {
        panic!("{expected:?} was not published; the offer is {:?}", offers.current())
    });
}

/// The offer task over fakes, running.
fn started(answer: Answer) -> (FakePort, FakeSystem, Offers) {
    started_in(answer, base)
}

fn started_in(
    answer: Answer,
    locale: impl Fn() -> &'static ShippedLocale + Send + Sync + 'static,
) -> (FakePort, FakeSystem, Offers) {
    let port = FakePort::new();
    let system = FakeSystem::new(answer);
    let (offers, task) = Offers::new(port.clone(), system.clone(), locale);
    tokio::spawn(task);
    (port, system, offers)
}

/// An offer of 0.7.0 the OS answered with `answer`, published as `channel`.
async fn offered(
    answer: Result<Delivery, Refusal>,
    channel: OfferChannel,
) -> (FakePort, FakeSystem, Offers) {
    let (port, system, offers) = started(Answer::Now(answer));
    port.publish(UpdatePhase::Available, "0.7.0");
    published(&offers, &offer("0.7.0", channel)).await;
    (port, system, offers)
}

/// An offer of 0.7.0 in a notification that stays on screen.
async fn on_screen() -> (FakePort, FakeSystem, Offers) {
    offered(Ok(Delivery::Persistent), OfferChannel::System).await
}

#[tokio::test]
async fn install_now_in_the_notification_runs_the_ports_install_now() {
    let (port, system, _offers) = on_screen().await;
    system.answer_last(Response::Chose(OfferAction::InstallNow));
    assert_eq!(port.first_calls().await, ["install_now"]);
}

#[tokio::test]
async fn install_on_quit_in_the_notification_runs_the_ports_install_on_quit() {
    let (port, system, _offers) = on_screen().await;
    system.answer_last(Response::Chose(OfferAction::InstallOnQuit));
    assert_eq!(port.first_calls().await, ["install_on_quit"]);
}

#[tokio::test]
async fn nothing_downloads_before_a_click() {
    let (port, system, _offers) = on_screen().await;
    assert_eq!(system.posts(), 1);
    assert_eq!(port.calls(), NO_CALLS, "the offer ran a port operation before a click");
}

#[tokio::test]
async fn a_notification_that_stays_on_screen_carries_the_offer() {
    let (_, _, offers) = on_screen().await;
    assert_eq!(offers.current(), offer("0.7.0", OfferChannel::System));
}

#[tokio::test]
async fn a_heads_up_leaves_the_offer_in_app_and_its_buttons_still_work() {
    let (port, system, _offers) = offered(Ok(Delivery::Transient), OfferChannel::InApp).await;
    assert_eq!(system.posts(), 1, "the heads-up was not posted");
    system.answer_last(Response::Chose(OfferAction::InstallOnQuit));
    assert_eq!(port.first_calls().await, ["install_on_quit"]);
}

#[tokio::test]
async fn a_heads_up_is_withdrawn_when_the_phase_leaves_available() {
    let (port, system, _offers) = offered(Ok(Delivery::Transient), OfferChannel::InApp).await;
    port.publish(UpdatePhase::Checking, "0.7.0");
    until("the withdrawal", || system.withdrawn() == 1).await;
}

#[tokio::test]
async fn a_click_on_the_body_or_a_close_hands_the_offer_to_the_in_app_notice() {
    let (port, system, offers) = on_screen().await;
    system.answer_last(Response::Dismissed);
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
    assert_eq!(port.calls(), NO_CALLS);
}

#[tokio::test]
async fn a_button_click_takes_the_offer_off_the_system_channel() {
    let (_, system, offers) = on_screen().await;
    system.answer_last(Response::Chose(OfferAction::InstallOnQuit));
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
}

#[tokio::test]
async fn a_release_available_again_after_a_failure_is_offered_in_app() {
    let (port, system, offers) = on_screen().await;
    system.answer_last(Response::Chose(OfferAction::InstallNow));
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
    port.publish(UpdatePhase::DownloadFailed, "0.7.0");
    let mut feed = offers.feed();
    feed.next().await;
    port.publish(UpdatePhase::Available, "0.7.0");
    assert_eq!(feed.next().await, Some(offer("0.7.0", OfferChannel::InApp)));
    assert_eq!(system.posts(), 1, "the release was posted again");
}

#[tokio::test]
async fn leaving_available_withdraws_the_notification_and_offers_in_app() {
    let (port, system, offers) = on_screen().await;
    port.publish(UpdatePhase::Checking, "0.7.0");
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
    assert_eq!(system.withdrawn(), 1);
}

#[tokio::test]
async fn a_newer_release_replaces_the_offer_of_the_older_one() {
    let (port, system, offers) = on_screen().await;
    port.publish(UpdatePhase::Available, "0.7.1");
    published(&offers, &offer("0.7.1", OfferChannel::System)).await;
    assert_eq!(system.withdrawn(), 1);
    let bodies: Vec<_> = system.posted().into_iter().map(|text| text.body).collect();
    assert_eq!(bodies, ["Update 0.7.0 is available.", "Update 0.7.1 is available."]);
}

#[tokio::test]
async fn a_button_on_the_notification_for_an_older_release_is_ignored() {
    let (port, system, offers) = on_screen().await;
    port.publish(UpdatePhase::Available, "0.7.1");
    published(&offers, &offer("0.7.1", OfferChannel::System)).await;
    system.answer(0, Response::Chose(OfferAction::InstallNow));
    system.answer(1, Response::Chose(OfferAction::InstallOnQuit));
    // Port operations start in the order the clicks were handled.
    assert_eq!(port.first_calls().await, ["install_on_quit"]);
}

#[tokio::test]
async fn a_notification_shown_as_a_heads_up_after_all_hands_the_offer_to_the_in_app_notice() {
    let (port, system, offers) = on_screen().await;
    system.heads_up(0);
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
    // Still outstanding: it is withdrawn when the phase leaves available.
    port.publish(UpdatePhase::Checking, "0.7.0");
    until("the withdrawal", || system.withdrawn() == 1).await;
}

#[tokio::test]
async fn a_heads_up_reported_before_the_os_accepts_the_post_still_counts() {
    // macOS asks how to present a notification before it reports the post
    // accepted.
    let (port, system, offers) = started(Answer::OnDemand);
    port.publish(UpdatePhase::Available, "0.7.0");
    until("the post", || system.posts() == 1).await;
    system.heads_up(0);
    system.decide(Ok(Delivery::Persistent));
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
}

/// A feed of `offers` past the offer published now.
async fn past_current(offers: &Offers) -> Latest<UpdateOffer> {
    let mut feed = offers.feed();
    feed.next().await;
    feed
}

/// The next offer `feed` publishes, within `within`.
async fn next_offer(feed: &mut Latest<UpdateOffer>, within: Duration) -> UpdateOffer {
    let change = tokio::time::timeout(within, feed.next()).await;
    change.expect("nothing was published").expect("the offer feed ended")
}

/// With time paused, `feed` publishes nothing before `quiet` has passed:
/// the tasks under test run first, and the clock moves on only once they
/// all wait.
async fn nothing_published(feed: &mut Latest<UpdateOffer>, quiet: Duration) {
    if let Ok(change) = tokio::time::timeout(quiet, feed.next()).await {
        panic!("{change:?} was published");
    }
}

#[tokio::test(start_paused = true)]
async fn a_heads_up_of_the_notification_for_an_older_release_changes_nothing() {
    let (port, system, offers) = on_screen().await;
    port.publish(UpdatePhase::Available, "0.7.1");
    published(&offers, &offer("0.7.1", OfferChannel::System)).await;
    let mut feed = past_current(&offers).await;
    system.heads_up(0);
    nothing_published(&mut feed, Duration::from_secs(1)).await;
    system.heads_up(1);
    assert_eq!(next_offer(&mut feed, OFFER_DEADLINE).await, offer("0.7.1", OfferChannel::InApp));
}

#[tokio::test(start_paused = true)]
async fn a_heads_up_after_the_user_answered_changes_nothing() {
    let (_, system, offers) = on_screen().await;
    system.answer_last(Response::Dismissed);
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
    let mut feed = past_current(&offers).await;
    system.heads_up(0);
    nothing_published(&mut feed, Duration::from_secs(1)).await;
}

#[tokio::test(start_paused = true)]
async fn an_unanswered_notification_carries_the_offer_only_until_the_timeout() {
    let start = tokio::time::Instant::now();
    let (port, system, offers) = on_screen().await;
    let mut feed = past_current(&offers).await;
    let change = next_offer(&mut feed, PERSISTENT_OFFER_TIMEOUT * 2).await;
    assert_eq!(change, offer("0.7.0", OfferChannel::InApp));
    assert!(start.elapsed() >= PERSISTENT_OFFER_TIMEOUT, "handed over after {:?}", start.elapsed());
    assert_eq!(system.withdrawn(), 0, "the notification was taken away");
    // Still outstanding: withdrawn when the phase leaves available, which
    // publishes the in-app offer again after the withdrawal. A yield loop
    // would never let the paused clock reach a timeout.
    port.publish(UpdatePhase::Checking, "0.7.0");
    assert_eq!(next_offer(&mut feed, OFFER_DEADLINE).await, offer("0.7.0", OfferChannel::InApp));
    assert_eq!(system.withdrawn(), 1);
}

#[tokio::test(start_paused = true)]
async fn an_answered_notification_hands_nothing_over_at_the_timeout() {
    let (_, system, offers) = on_screen().await;
    system.answer_last(Response::Dismissed);
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
    let mut feed = past_current(&offers).await;
    nothing_published(&mut feed, PERSISTENT_OFFER_TIMEOUT * 2).await;
}

#[tokio::test]
async fn a_button_during_a_download_is_ignored_and_works_again_after_it_failed() {
    let (port, system, offers) = on_screen().await;
    // A click is judged against the port's status when the offer handles it.
    // Back to back, the click reaches the queue before the status does, so
    // the in-app offer it publishes shows it was handled during the download.
    port.publish(UpdatePhase::Downloading, "0.7.0");
    system.answer_last(Response::Chose(OfferAction::InstallOnQuit));
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
    port.publish(UpdatePhase::DownloadFailed, "0.7.0");
    system.answer_last(Response::Chose(OfferAction::InstallNow));
    assert_eq!(port.first_calls().await, ["install_now"]);
}

#[tokio::test]
async fn a_response_while_the_post_is_pending_is_handled_once_the_os_answers() {
    let (port, system, offers) = started(Answer::OnDemand);
    port.publish(UpdatePhase::Available, "0.7.0");
    until("the post", || system.posts() == 1).await;
    system.answer_last(Response::Chose(OfferAction::InstallNow));
    system.decide(Ok(Delivery::Persistent));
    assert_eq!(port.first_calls().await, ["install_now"]);
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
}

#[tokio::test]
async fn a_click_sent_right_after_a_newer_release_is_judged_against_it() {
    let (port, system, offers) = on_screen().await;
    // Back to back: the port moved on before the click reached the offer.
    port.publish(UpdatePhase::Available, "0.7.1");
    system.answer(0, Response::Chose(OfferAction::InstallNow));
    published(&offers, &offer("0.7.1", OfferChannel::System)).await;
    system.answer(1, Response::Chose(OfferAction::InstallOnQuit));
    assert_eq!(port.first_calls().await, ["install_on_quit"]);
}

#[tokio::test]
async fn denied_permission_falls_back_to_the_in_app_notice() {
    let (port, _, _) = offered(Err(Refusal::PermissionDenied), OfferChannel::InApp).await;
    assert_eq!(port.calls(), NO_CALLS);
}

#[tokio::test]
async fn a_notification_system_without_buttons_falls_back_to_the_in_app_notice() {
    let (port, _, _) = offered(Err(Refusal::ActionsUnsupported), OfferChannel::InApp).await;
    assert_eq!(port.calls(), NO_CALLS);
}

#[tokio::test]
async fn a_notification_that_cannot_be_shown_falls_back_to_the_in_app_notice() {
    let refusal = Refusal::Failed("no notification server".to_owned());
    offered(Err(refusal), OfferChannel::InApp).await;
}

#[tokio::test(start_paused = true)]
async fn an_unanswered_notification_falls_back_at_the_deadline_and_is_withdrawn() {
    let (port, system, offers) = started(Answer::Never);
    let posted_at = tokio::time::Instant::now();
    port.publish(UpdatePhase::Available, "0.7.0");
    published(&offers, &offer("0.7.0", OfferChannel::InApp)).await;
    assert!(posted_at.elapsed() >= OFFER_DEADLINE, "fell back after {:?}", posted_at.elapsed());
    assert_eq!(system.withdrawn(), 1);
}

#[tokio::test]
async fn each_phase_after_available_makes_no_offer_and_withdraws_the_notification() {
    let (port, system, offers) = started(Answer::Now(Ok(Delivery::Persistent)));
    let phases = [
        UpdatePhase::Downloading,
        UpdatePhase::DownloadFailed,
        UpdatePhase::Installing,
        UpdatePhase::InstallFailed,
        UpdatePhase::InstallOnQuit,
        UpdatePhase::Checking,
        UpdatePhase::CheckFailed,
        UpdatePhase::UpToDate,
        UpdatePhase::Idle,
    ];
    for (index, phase) in phases.into_iter().enumerate() {
        let version = format!("0.7.{index}");
        port.publish(UpdatePhase::Available, &version);
        published(&offers, &offer(&version, OfferChannel::System)).await;
        port.publish(phase, &version);
        // The withdrawal shows the offer saw this phase before the next.
        published(&offers, &offer(&version, OfferChannel::InApp)).await;
        assert_eq!(system.withdrawn(), index + 1, "{phase:?}");
        assert_eq!(system.posts(), index + 1, "{phase:?} made an offer");
    }
}

#[tokio::test]
async fn the_offer_speaks_the_locale_it_reads_at_the_time() {
    let (port, system, offers) =
        started_in(Answer::Now(Ok(Delivery::Persistent)), || locale::shipped_or_base("pt-BR"));
    port.publish(UpdatePhase::Available, "0.7.0");
    published(&offers, &offer("0.7.0", OfferChannel::System)).await;
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
fn a_button_identifier_is_a_choice_and_anything_else_a_dismissal() {
    for action in OfferAction::ALL {
        assert_eq!(Response::from_identifier(action.identifier()), Response::Chose(action));
    }
    for other in [
        "default",
        "__closed",
        "com.apple.UNNotificationDefaultActionIdentifier",
        "com.apple.UNNotificationDismissActionIdentifier",
        "",
    ] {
        assert_eq!(Response::from_identifier(other), Response::Dismissed, "{other}");
    }
}

#[test]
fn the_buttons_are_allowed_where_the_in_app_notice_offers_them() {
    let status =
        |phase| UpdateStatus { phase, version: Some("0.7.0".to_owned()), body: None, error: None };
    for phase in [UpdatePhase::Available, UpdatePhase::DownloadFailed, UpdatePhase::InstallFailed] {
        for action in OfferAction::ALL {
            assert!(allows(&status(phase), "0.7.0", action), "{phase:?} {action:?}");
            assert!(
                !allows(&status(phase), "0.6.9", action),
                "{phase:?} {action:?} for another release"
            );
        }
    }
    assert!(allows(&status(UpdatePhase::InstallOnQuit), "0.7.0", OfferAction::InstallNow));
    assert!(!allows(&status(UpdatePhase::InstallOnQuit), "0.7.0", OfferAction::InstallOnQuit));
    for phase in [
        UpdatePhase::Idle,
        UpdatePhase::Checking,
        UpdatePhase::UpToDate,
        UpdatePhase::CheckFailed,
        UpdatePhase::Downloading,
        UpdatePhase::Installing,
    ] {
        for action in OfferAction::ALL {
            assert!(!allows(&status(phase), "0.7.0", action), "{phase:?} {action:?}");
        }
    }
}
