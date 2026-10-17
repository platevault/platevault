// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! OS notifications for long-running task completions (spec 051 US8).
//!
//! Three completions notify: an approved filesystem plan finishing its apply
//! run, a tool workflow run being attributed as complete, and an
//! ingest-resolution drain pass that resolved at least one queued target. All
//! three are operations the user starts and then leaves, which is why they
//! notify and shorter foreground work does not.
//!
//! Every failure path is a `debug` log and a return: on macOS and Windows the
//! user may have denied notifications, and on Linux there may be no
//! notification daemon at all, and none of those may disturb the task being
//! reported on (FR-025).

use std::sync::mpsc;
use std::time::Duration;

use app_core::ingest_resolution::DrainSummary;
use audit::bus::EventBus;
use audit::event_bus::{
    PlanApplyingCompleted, WorkflowRunCompleted, TOPIC_PLAN_APPLYING_COMPLETED,
    TOPIC_WORKFLOW_RUN_COMPLETED,
};
use tokio::sync::broadcast::error::RecvError;

use crate::locale::{self, ActiveLocale};
use crate::AppIdentity;

/// One OS notification's title and body.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Notice {
    /// The notification summary/title.
    pub title: String,
    /// The notification body.
    pub body: String,
}

/// Notification-only fields deserialized once per shipped locale by `MESSAGES`.
#[derive(Debug, serde::Deserialize)]
pub(crate) struct NotificationMessages {
    #[serde(rename = "notification_target_resolution_title")]
    target_resolution_title: String,
    #[serde(rename = "notification_target_resolution_body_singular")]
    target_resolution_body_singular: String,
    #[serde(rename = "notification_target_resolution_body")]
    target_resolution_body: String,
    #[serde(rename = "notification_plan_apply_title")]
    plan_apply_title: String,
    #[serde(rename = "notification_plan_applied_body")]
    plan_state_applied: String,
    #[serde(rename = "notification_plan_partially_applied_body")]
    plan_state_partially_applied: String,
    #[serde(rename = "notification_plan_failed_body")]
    plan_state_failed: String,
    #[serde(rename = "notification_plan_cancelled_body")]
    plan_state_cancelled: String,
    #[serde(rename = "notification_workflow_run_title")]
    workflow_run_title: String,
    #[serde(rename = "notification_workflow_run_body_singular")]
    workflow_run_body_singular: String,
    #[serde(rename = "notification_workflow_run_body")]
    workflow_run_body: String,
}

static MESSAGES: locale::ShippedMessages<NotificationMessages> = locale::ShippedMessages::new();

#[derive(Clone, Copy)]
pub(crate) struct Wording(&'static NotificationMessages);

impl Wording {
    pub(crate) fn messages(self) -> &'static NotificationMessages {
        self.0
    }

    pub(crate) fn from_locale(locale: &'static locale::ShippedLocale) -> Self {
        Self(MESSAGES.get(locale))
    }

    pub(crate) fn from_active(locale: &ActiveLocale) -> Self {
        Self::from_locale(locale.get())
    }

    pub(crate) fn target_resolution(self, count: usize) -> Notice {
        let messages = self.0;
        Notice {
            title: messages.target_resolution_title.clone(),
            body: locale::fill(
                if count == 1 {
                    &messages.target_resolution_body_singular
                } else {
                    &messages.target_resolution_body
                },
                &[("count", &count.to_string())],
            ),
        }
    }
}

/// How long [`Notifier::notify_before_exit`] waits for the OS to take a
/// notification: a D-Bus daemon or the Windows toast service answers in
/// milliseconds, and the app is on its way out.
const BEFORE_EXIT_WAIT: Duration = Duration::from_secs(2);

/// Delivers OS notifications under the application's identity.
#[derive(Clone, Debug)]
pub struct Notifier {
    locale: locale::ActiveLocale,
    #[cfg(target_os = "macos")]
    bundle_id: String,
    #[cfg(windows)]
    app_id: Option<String>,
}

impl Notifier {
    #[cfg_attr(not(any(target_os = "macos", windows)), allow(unused_variables))]
    pub(crate) fn new(identity: &AppIdentity, locale: locale::ActiveLocale) -> Self {
        Self {
            locale,
            #[cfg(target_os = "macos")]
            bundle_id: identity.macos_bundle_id().to_owned(),
            #[cfg(windows)]
            app_id: std::env::current_exe().ok().and_then(|exe| {
                exe.parent().and_then(|dir| identity.windows_app_id(dir)).map(str::to_owned)
            }),
        }
    }

    fn wording(&self) -> Wording {
        Wording::from_active(&self.locale)
    }

    /// Notify about a finished ingest-resolution drain pass, unless the window
    /// is `focused`.
    ///
    /// The periodic drain ticks every 30s and is usually a no-op, so only a pass
    /// that resolved at least one queued target notifies.
    pub fn ingest_drain_completed(&self, focused: Option<bool>, summary: &DrainSummary) {
        if !should_notify(focused, summary.resolved > 0) {
            return;
        }
        let notification = self.wording().target_resolution(summary.resolved);
        self.deliver(&notification);
    }

    /// Show `notification` unless the window is `focused`.
    fn completed(&self, focused: Option<bool>, notification: &Notice) {
        if should_notify(focused, true) {
            self.deliver(notification);
        }
    }

    /// Show `summary` and `body` now, whatever the window focus, and wait up
    /// to [`BEFORE_EXIT_WAIT`] until the OS has them: for an outcome the user
    /// must hear about when the app exits next, which would otherwise end the
    /// delivery thread first.
    pub fn notify_before_exit(&self, summary: &str, body: &str) {
        if let Some(shown) = self.show(summary, body) {
            if shown.recv_timeout(BEFORE_EXIT_WAIT).is_err() {
                tracing::debug!("OS notification not confirmed before exit");
            }
        }
    }

    fn deliver(&self, notification: &Notice) {
        drop(self.show(&notification.title, &notification.body));
    }

    /// Hand `summary` and `body` to the OS from a thread of its own: the
    /// Linux D-Bus call blocks until the daemon answers. The receiver hears
    /// once that call returned; `None` when no thread could start.
    #[cfg_attr(not(any(target_os = "macos", windows)), allow(clippy::unused_self))]
    fn show(&self, summary: &str, body: &str) -> Option<mpsc::Receiver<()>> {
        let mut toast = notify_rust::Notification::new();
        toast.summary(summary).body(body).auto_icon();
        #[cfg(windows)]
        if let Some(app_id) = &self.app_id {
            toast.app_id(app_id);
        }
        // The first call sets the process-wide sender; later ones report
        // `AlreadySet` for the same bundle id.
        #[cfg(target_os = "macos")]
        let _ = notify_rust::set_application(&self.bundle_id);

        let (done, shown) = mpsc::channel();
        let spawned =
            std::thread::Builder::new().name("os-notification".to_owned()).spawn(move || {
                if let Err(error) = toast.show() {
                    tracing::debug!("OS notification not delivered: {error}");
                }
                let _ = done.send(());
            });
        match spawned {
            Ok(_) => Some(shown),
            Err(error) => {
                tracing::debug!("OS notification not delivered: {error}");
                None
            }
        }
    }
}

/// Whether a completed task should raise an OS notification.
///
/// `focused` is `None` when window focus could not be read (no main window
/// yet, or the host's query failed); an unknown focus notifies, because losing
/// the notification is the worse failure of the two.
const fn should_notify(focused: Option<bool>, did_meaningful_work: bool) -> bool {
    did_meaningful_work && !matches!(focused, Some(true))
}

/// Subscribe to the two completion topics that already exist on the bus and
/// notify on each: plan-apply terminal state and tool workflow-run completion.
///
/// Workflow runs notify off `workflow.run_completed`, not off the
/// `manifest.write.success` the manifest subscriber publishes downstream. The
/// manifest subscriber replays historical `workflow.run_completed` rows from the
/// durable events table when it lags, and each replay writes a manifest and
/// publishes a fresh success event, so notifying on that topic turns one lag
/// into a burst of notifications for runs the user finished long ago.
/// `workflow.run_completed` is published once, live, by the attribution pass.
pub(crate) fn spawn_completion_notifier(
    notifier: Notifier,
    bus: &EventBus,
    focused: impl Fn() -> Option<bool> + Send + 'static,
) -> tokio::task::JoinHandle<()> {
    let mut rx = bus.subscribe();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(env) => {
                    if !matches!(
                        env.topic.as_str(),
                        TOPIC_PLAN_APPLYING_COMPLETED | TOPIC_WORKFLOW_RUN_COMPLETED
                    ) {
                        continue;
                    }
                    let notification =
                        notification_for(&env.topic, &env.payload, notifier.wording().messages());
                    if let Some(notification) = notification {
                        notifier.completed(focused(), &notification);
                    }
                }
                // Lag drops completions rather than replaying them: a
                // notification for an event the user has long since seen in
                // the UI is noise, and the outcome is durable in the events
                // table either way.
                Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => break,
            }
        }
    })
}

/// The notification a bus envelope earns, or `None` for every topic and payload
/// that must stay silent.
fn notification_for(
    topic: &str,
    payload: &serde_json::Value,
    messages: &NotificationMessages,
) -> Option<Notice> {
    match topic {
        TOPIC_PLAN_APPLYING_COMPLETED => Some(Notice {
            title: messages.plan_apply_title.clone(),
            body: plan_apply_body(payload, messages)?,
        }),
        TOPIC_WORKFLOW_RUN_COMPLETED => {
            let event: WorkflowRunCompleted = serde_json::from_value(payload.clone()).ok()?;
            let count = event.artifact_ids.len();
            Some(Notice {
                title: messages.workflow_run_title.clone(),
                body: locale::fill(
                    if count == 1 {
                        &messages.workflow_run_body_singular
                    } else {
                        &messages.workflow_run_body
                    },
                    &[("name", &event.tool_id), ("count", &count.to_string())],
                ),
            })
        }
        _ => None,
    }
}

/// Summarise a `plan.applying.completed` payload for the notification body, or
/// `None` when the payload is not a full typed completion.
fn plan_apply_body(payload: &serde_json::Value, messages: &NotificationMessages) -> Option<String> {
    let event: PlanApplyingCompleted = serde_json::from_value(payload.clone()).ok()?;
    let message = match event.terminal_state.as_str() {
        "applied" => &messages.plan_state_applied,
        "partially_applied" => &messages.plan_state_partially_applied,
        "failed" => &messages.plan_state_failed,
        "cancelled" => &messages.plan_state_cancelled,
        _ => return None,
    };
    Some(locale::fill(
        message,
        &[
            ("applied", &event.items_applied.to_string()),
            ("failed", &event.items_failed.to_string()),
            ("skipped", &event.items_skipped.to_string()),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::locale::ActiveLocale;

    #[test]
    fn set_locale_changes_delivered_wording_and_unknown_locales_fall_back() {
        let locale = ActiveLocale::new();
        let notifier = Notifier::new(
            &AppIdentity { identifier: "dev.example.app".to_owned(), development: true },
            locale,
        );
        notifier.locale.set_locale("pt-BR");
        assert_eq!(notifier.wording().target_resolution(1).body, "Alvo da fila resolvido: 1.");
        notifier.locale.set_locale("de-DE");
        assert_eq!(notifier.wording().target_resolution(1).body, "Queued target resolved: 1.");
    }

    /// One shipped locale's expected notification text.
    struct ExpectedCopy {
        /// Target resolution bodies for a count of one and of two.
        targets: [&'static str; 2],
        /// Workflow run bodies for one artifact and for two.
        workflow: [&'static str; 2],
        /// Plan bodies by terminal state and applied, failed and skipped
        /// counts: a 1 in every position, then a lone 1 in each position.
        plan: [(&'static str, [u64; 3], &'static str); 7],
    }

    fn expected_copy(tag: &str) -> ExpectedCopy {
        match tag {
            "en-GB" => ExpectedCopy {
                targets: ["Queued target resolved: 1.", "Queued targets resolved: 2."],
                workflow: [
                    "New artifact attributed by siril: 1.",
                    "New artifacts attributed by siril: 2.",
                ],
                plan: [
                    ("applied", [1, 1, 1], "Plan applied — 1 applied, 1 failed, 1 skipped."),
                    (
                        "partially_applied",
                        [1, 1, 1],
                        "Plan partly applied — 1 applied, 1 failed, 1 skipped.",
                    ),
                    ("failed", [1, 1, 1], "Plan apply failed — 1 applied, 1 failed, 1 skipped."),
                    (
                        "cancelled",
                        [1, 1, 1],
                        "Plan apply cancelled — 1 applied, 1 failed, 1 skipped.",
                    ),
                    (
                        "partially_applied",
                        [1, 2, 2],
                        "Plan partly applied — 1 applied, 2 failed, 2 skipped.",
                    ),
                    (
                        "partially_applied",
                        [2, 1, 2],
                        "Plan partly applied — 2 applied, 1 failed, 2 skipped.",
                    ),
                    (
                        "partially_applied",
                        [2, 2, 1],
                        "Plan partly applied — 2 applied, 2 failed, 1 skipped.",
                    ),
                ],
            },
            "pt-BR" => ExpectedCopy {
                targets: ["Alvo da fila resolvido: 1.", "Alvos da fila resolvidos: 2."],
                workflow: [
                    "Novo artefato atribuído por siril: 1.",
                    "Novos artefatos atribuídos por siril: 2.",
                ],
                plan: [
                    (
                        "applied",
                        [1, 1, 1],
                        "Plano aplicado — aplicados: 1, com falha: 1, ignorados: 1.",
                    ),
                    (
                        "partially_applied",
                        [1, 1, 1],
                        "Plano parcialmente aplicado — aplicados: 1, com falha: 1, ignorados: 1.",
                    ),
                    (
                        "failed",
                        [1, 1, 1],
                        "Falha ao aplicar o plano — aplicados: 1, com falha: 1, ignorados: 1.",
                    ),
                    (
                        "cancelled",
                        [1, 1, 1],
                        "Aplicação do plano cancelada — aplicados: 1, com falha: 1, ignorados: 1.",
                    ),
                    (
                        "partially_applied",
                        [1, 2, 2],
                        "Plano parcialmente aplicado — aplicados: 1, com falha: 2, ignorados: 2.",
                    ),
                    (
                        "partially_applied",
                        [2, 1, 2],
                        "Plano parcialmente aplicado — aplicados: 2, com falha: 1, ignorados: 2.",
                    ),
                    (
                        "partially_applied",
                        [2, 2, 1],
                        "Plano parcialmente aplicado — aplicados: 2, com falha: 2, ignorados: 1.",
                    ),
                ],
            },
            other => panic!("no expected notification copy for shipped locale {other}"),
        }
    }

    #[test]
    fn every_shipped_locale_has_the_notification_wording() {
        for shipped in &locale::SHIPPED_LOCALES {
            let tag = shipped.tag;
            let expected = expected_copy(tag);
            let wording = Wording::from_locale(shipped);
            let messages = wording.messages();

            for (count, body) in [1, 2].into_iter().zip(expected.targets) {
                assert_eq!(wording.target_resolution(count).body, body, "{tag} {count}");
            }

            let artifacts = [serde_json::json!(["a-1"]), serde_json::json!(["a-1", "a-2"])];
            for (artifact_ids, body) in artifacts.into_iter().zip(expected.workflow) {
                let mut payload = workflow_run_payload();
                payload["artifactIds"] = artifact_ids;
                let notice = notification_for(TOPIC_WORKFLOW_RUN_COMPLETED, &payload, messages)
                    .expect("workflow run notification");
                assert_eq!(notice.body, body, "{tag}");
            }

            for (state, [applied, failed, skipped], body) in expected.plan {
                let mut payload = plan_completion_payload();
                payload["terminalState"] = serde_json::json!(state);
                payload["itemsApplied"] = serde_json::json!(applied);
                payload["itemsFailed"] = serde_json::json!(failed);
                payload["itemsSkipped"] = serde_json::json!(skipped);
                let notice = notification_for(TOPIC_PLAN_APPLYING_COMPLETED, &payload, messages)
                    .expect("plan notification");
                assert_eq!(notice.body, body, "{tag} {state} {applied}/{failed}/{skipped}");
            }
        }
    }

    #[test]
    fn unfocused_window_notifies() {
        assert!(should_notify(Some(false), true));
    }

    #[test]
    fn focused_window_suppresses_the_notification() {
        assert!(!should_notify(Some(true), true));
    }

    #[test]
    fn an_empty_drain_pass_never_notifies() {
        assert!(!should_notify(Some(false), false));
        assert!(!should_notify(None, false));
    }

    #[test]
    fn unknown_focus_notifies() {
        assert!(should_notify(None, true));
    }

    fn plan_completion_payload() -> serde_json::Value {
        serde_json::json!({
            "planId": "p-1",
            "runId": "r-1",
            "terminalState": "partially_applied",
            "itemsApplied": 3,
            "itemsFailed": 1,
            "itemsSkipped": 2,
            "itemsCancelled": 0,
            "at": "2026-08-20T00:00:00Z",
        })
    }

    fn plan_completion_payload_with_applied(applied: usize) -> serde_json::Value {
        let mut payload = plan_completion_payload();
        payload["itemsApplied"] = serde_json::json!(applied);
        payload
    }

    #[test]
    fn plan_notification_renders_in_portuguese() {
        let locale = ActiveLocale::new();
        locale.set_locale("pt-BR");
        let wording = Wording::from_active(&locale);
        let notification = notification_for(
            TOPIC_PLAN_APPLYING_COMPLETED,
            &plan_completion_payload_with_applied(1),
            wording.messages(),
        )
        .expect("plan notification");
        assert_eq!(notification.title, "Aplicação do plano concluída");
        assert_eq!(
            notification.body,
            "Plano parcialmente aplicado — aplicados: 1, com falha: 1, ignorados: 2."
        );
    }

    #[test]
    fn the_degraded_bulk_cancel_payload_raises_no_notification() {
        let wording = Wording::from_locale(locale::base());
        let degraded = serde_json::json!({ "planId": "p-1", "cancelledCount": 4 });
        assert_eq!(plan_apply_body(&degraded, wording.messages()), None);
        assert_eq!(plan_apply_body(&serde_json::json!({}), wording.messages()), None);
    }

    #[test]
    fn workflow_run_body_names_the_tool_and_counts_artifacts() {
        let payload = serde_json::json!({
            "projectId": "prj-1",
            "toolId": "siril",
            "toolLaunchId": "tl-1",
            "completedAt": "2026-08-20T00:00:00Z",
            "artifactIds": ["a-1", "a-2"],
        });
        let wording = Wording::from_locale(locale::base());
        assert_eq!(
            notification_for(TOPIC_WORKFLOW_RUN_COMPLETED, &payload, wording.messages())
                .map(|notification| notification.body),
            Some("New artifacts attributed by siril: 2.".to_owned())
        );
    }

    #[test]
    fn workflow_run_body_rejects_an_untyped_payload() {
        let wording = Wording::from_locale(locale::base());
        assert_eq!(
            notification_for(
                TOPIC_WORKFLOW_RUN_COMPLETED,
                &serde_json::json!({ "toolId": "siril" }),
                wording.messages()
            ),
            None
        );
    }

    fn workflow_run_payload() -> serde_json::Value {
        serde_json::json!({
            "projectId": "prj-1",
            "toolId": "siril",
            "artifactIds": ["a-1"],
            "toolLaunchId": "tl-1",
            "completedAt": "2026-08-20T00:00:00Z",
        })
    }

    #[test]
    fn the_plan_apply_topic_dispatches_to_the_plan_apply_notification() {
        let wording = Wording::from_locale(locale::base());
        assert_eq!(
            notification_for(
                TOPIC_PLAN_APPLYING_COMPLETED,
                &plan_completion_payload(),
                wording.messages(),
            ),
            Some(Notice {
                title: "Plan apply finished".to_owned(),
                body: "Plan partly applied — 3 applied, 1 failed, 2 skipped.".to_owned()
            }),
        );
    }

    #[test]
    fn the_workflow_run_topic_dispatches_to_the_workflow_run_notification() {
        let wording = Wording::from_locale(locale::base());
        assert_eq!(
            notification_for(
                TOPIC_WORKFLOW_RUN_COMPLETED,
                &workflow_run_payload(),
                wording.messages(),
            ),
            Some(Notice {
                title: "Workflow run finished".to_owned(),
                body: "New artifact attributed by siril: 1.".to_owned()
            }),
        );
    }

    #[test]
    fn an_unsubscribed_topic_raises_no_notification() {
        let wording = Wording::from_locale(locale::base());
        assert_eq!(
            notification_for(
                "plan.applying.started",
                &plan_completion_payload(),
                wording.messages(),
            ),
            None
        );
        assert_eq!(
            notification_for("manifest.write.success", &workflow_run_payload(), wording.messages(),),
            None
        );
    }

    #[test]
    fn a_subscribed_topic_with_an_undeserialisable_payload_raises_no_notification() {
        let wording = Wording::from_locale(locale::base());
        let degraded = serde_json::json!({ "planId": "p-1", "cancelledCount": 4 });
        assert_eq!(
            notification_for(TOPIC_PLAN_APPLYING_COMPLETED, &degraded, wording.messages()),
            None
        );
        assert_eq!(
            notification_for(TOPIC_WORKFLOW_RUN_COMPLETED, &degraded, wording.messages()),
            None
        );
    }
}
