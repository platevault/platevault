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

use crate::locale::{self, ActiveLocale, NotificationMessages};
use crate::AppIdentity;

/// An OS notification's title and body.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Notice {
    /// The notification summary/title.
    pub title: String,
    /// The notification body.
    pub body: String,
}

/// A small non-sensitive copy of a catalogue's already-parsed messages.
pub(crate) struct Wording {
    messages: &'static NotificationMessages,
}
impl Wording {
    pub(crate) fn messages(&self) -> &'static NotificationMessages {
        self.messages
    }

    pub(crate) fn from_locale(locale: &'static locale::ShippedLocale) -> Self {
        Self { messages: locale::notification_messages(locale) }
    }

    pub(crate) fn from_active(locale: &ActiveLocale) -> Self {
        Self::from_locale(locale.get())
    }

    pub(crate) fn target_resolution(&self, count: usize) -> Notice {
        let messages = self.messages;
        Notice {
            title: messages.target_resolution_title.clone(),
            body: locale::fill(&messages.target_resolution_body, &[("count", &count.to_string())]),
        }
    }

    pub(crate) fn admin_prompt(&self, version: &str) -> String {
        locale::fill(&self.messages.update_admin_prompt, &[("version", version)])
    }

    pub(crate) fn previous_app_kept(&self, kept: &std::path::Path) -> Notice {
        let messages = self.messages;
        let reason = locale::fill(
            &messages.previous_app_not_restored,
            &[("path", &kept.display().to_string())],
        );
        Notice {
            title: messages.install_failed_title.clone(),
            body: locale::fill(&messages.install_failed, &[("message", &reason)]),
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
            Some(Notice {
                title: messages.workflow_run_title.clone(),
                body: locale::fill(
                    &messages.workflow_run_body,
                    &[("name", &event.tool_id), ("count", &event.artifact_ids.len().to_string())],
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
        assert_eq!(notifier.wording().target_resolution(1).body, "Alvos da fila resolvidos: 1.");
        notifier.locale.set_locale("de-DE");
        assert_eq!(notifier.wording().target_resolution(1).body, "Queued target(s) resolved: 1.");
    }

    #[test]
    fn every_shipped_locale_has_the_notification_wording() {
        for shipped in &locale::SHIPPED_LOCALES {
            let messages = locale::notification_messages(shipped);
            let wording = Wording::from_locale(shipped);
            let notification = wording.target_resolution(1);
            assert!(!notification.body.contains('{'), "{}", shipped.tag);
            let prompt = wording.admin_prompt("0.7.0");
            assert!(prompt.contains("PlateVault") && prompt.contains("0.7.0"), "{prompt}");
            assert!(!prompt.contains('{'), "every placeholder is filled: {prompt}");
            assert_eq!(
                prompt,
                if shipped.tag == "pt-BR" {
                    "O PlateVault precisa do nome e da senha de um administrador para instalar a atualização 0.7.0."
                } else {
                    "PlateVault needs an administrator's name and password to install update 0.7.0."
                },
                "{}",
                shipped.tag
            );
            let plan_notification = notification_for(
                TOPIC_PLAN_APPLYING_COMPLETED,
                &plan_completion_payload(),
                messages,
            )
            .expect("notification plan body");
            assert!(
                !plan_notification.body.contains('{'),
                "{}: {}",
                shipped.tag,
                plan_notification.body
            );
            let workflow =
                notification_for(TOPIC_WORKFLOW_RUN_COMPLETED, &workflow_run_payload(), messages)
                    .expect("notification workflow body");
            assert!(!workflow.body.contains('{'), "{}: {}", shipped.tag, workflow.body);
        }
    }
    #[test]
    fn updater_kept_app_notice_uses_each_cached_catalogue() {
        let kept = std::path::Path::new("/Applications/PlateVault (previous version).app");
        let english = Wording::from_locale(locale::base()).previous_app_kept(kept);
        assert_eq!(english.title, "Update not installed");
        assert_eq!(english.body, "Could not install update: the previous version couldn't be put back. It's saved at /Applications/PlateVault (previous version).app.");
        let portuguese =
            Wording::from_locale(locale::shipped_or_base("pt-BR")).previous_app_kept(kept);
        assert_eq!(portuguese.title, "Atualização não instalada");
        assert_eq!(portuguese.body, "Não foi possível instalar a atualização: não foi possível restaurar a versão anterior. Ela está salva em /Applications/PlateVault (previous version).app.");
    }
    #[test]
    fn ingest_drain_notification_uses_the_selected_catalogue() {
        let wording = ActiveLocale::new();
        wording.set_locale("pt-BR");
        let notification = Wording::from_active(&wording).target_resolution(2);
        assert_eq!(notification.title, "Resolução de alvos concluída");
        assert_eq!(notification.body, "Alvos da fila resolvidos: 2.");
    }

    #[test]
    fn focused_window_suppresses_the_notification() {
        assert!(!should_notify(Some(true), true));
    }

    #[test]
    fn unfocused_window_notifies() {
        assert!(should_notify(Some(false), true));
    }

    #[test]
    fn an_empty_drain_pass_never_notifies() {
        assert!(!should_notify(Some(false), false));
        assert!(!should_notify(None, false));
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

    #[test]
    fn plan_notification_renders_in_portuguese() {
        let locale = ActiveLocale::new();
        locale.set_locale("pt-BR");
        let wording = Wording::from_active(&locale);
        let notification = notification_for(
            TOPIC_PLAN_APPLYING_COMPLETED,
            &plan_completion_payload(),
            wording.messages(),
        )
        .expect("plan notification");
        assert_eq!(notification.title, "Aplicação do plano concluída");
        assert_eq!(
            notification.body,
            "Plano parcialmente aplicado: 3 item(ns) aplicado(s), 1 falha(s) e 2 ignorado(s)."
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
            "toolLaunchId": "tl-1",
            "completedAt": "2026-08-20T00:00:00Z",
            "artifactIds": ["a-1"],
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
                body: "Plan partly applied: 3 item(s) applied, 1 failure(s), 2 skipped.".to_owned()
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
                body: "New artifacts attributed by siril: 1.".to_owned()
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
