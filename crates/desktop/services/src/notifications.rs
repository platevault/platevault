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

use crate::AppIdentity;

/// How long [`Notifier::notify_before_exit`] waits for the OS to take a
/// notification: a D-Bus daemon or the Windows toast service answers in
/// milliseconds, and the app is on its way out.
const BEFORE_EXIT_WAIT: Duration = Duration::from_secs(2);

/// One OS notification.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Notification {
    title: &'static str,
    body: String,
}

/// Delivers OS notifications under the application's identity.
#[derive(Clone, Debug)]
pub struct Notifier {
    #[cfg(target_os = "macos")]
    bundle_id: String,
    #[cfg(windows)]
    app_id: Option<String>,
}

impl Notifier {
    #[cfg_attr(not(any(target_os = "macos", windows)), allow(unused_variables))]
    pub(crate) fn new(identity: &AppIdentity) -> Self {
        Self {
            #[cfg(target_os = "macos")]
            bundle_id: identity.macos_bundle_id().to_owned(),
            #[cfg(windows)]
            app_id: std::env::current_exe().ok().and_then(|exe| {
                exe.parent().and_then(|dir| identity.windows_app_id(dir)).map(str::to_owned)
            }),
        }
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
        self.deliver(&Notification {
            title: "Target resolution finished",
            body: format!("Resolved {} queued target(s).", summary.resolved),
        });
    }

    /// Show `notification` unless the window is `focused`.
    fn completed(&self, focused: Option<bool>, notification: &Notification) {
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

    fn deliver(&self, notification: &Notification) {
        drop(self.show(notification.title, &notification.body));
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
                    if let Some(notification) = notification_for(&env.topic, &env.payload) {
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
fn notification_for(topic: &str, payload: &serde_json::Value) -> Option<Notification> {
    match topic {
        TOPIC_PLAN_APPLYING_COMPLETED => {
            Some(Notification { title: "Plan apply finished", body: plan_apply_body(payload)? })
        }
        TOPIC_WORKFLOW_RUN_COMPLETED => {
            Some(Notification { title: "Workflow run finished", body: workflow_run_body(payload)? })
        }
        _ => None,
    }
}

/// Summarise a `plan.applying.completed` payload for the notification body, or
/// `None` when the payload is not a full typed completion.
///
/// The topic carries one degraded publisher: when `list_pending_items` fails
/// twice, `cancel_pending_items` writes an aggregate audit row carrying only
/// `planId` and `cancelledCount`, and `handle_cancelled` publishes the real
/// completion afterwards. Defaulting the absent counts would report that
/// bookkeeping row as `done: 0 applied, 0 failed, 0 skipped` and then notify a
/// second time with the true summary, so a payload that does not deserialise is
/// dropped instead.
fn plan_apply_body(payload: &serde_json::Value) -> Option<String> {
    let event: PlanApplyingCompleted = serde_json::from_value(payload.clone()).ok()?;
    Some(format!(
        "{}: {} applied, {} failed, {} skipped.",
        event.terminal_state, event.items_applied, event.items_failed, event.items_skipped
    ))
}

/// Summarise a `workflow.run_completed` payload, or `None` when it does not
/// deserialise.
fn workflow_run_body(payload: &serde_json::Value) -> Option<String> {
    let event: WorkflowRunCompleted = serde_json::from_value(payload.clone()).ok()?;
    Some(format!(
        "{} run recorded: {} new artifact(s) attributed.",
        event.tool_id,
        event.artifact_ids.len()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focused_window_suppresses_the_notification() {
        assert!(!should_notify(Some(true), true));
    }

    #[test]
    fn unfocused_window_notifies() {
        assert!(should_notify(Some(false), true));
    }

    #[test]
    fn unknown_focus_notifies() {
        assert!(should_notify(None, true));
    }

    #[test]
    fn an_empty_drain_pass_never_notifies() {
        assert!(!should_notify(Some(false), false));
        assert!(!should_notify(None, false));
    }

    /// A full typed `PlanApplyingCompleted` payload, as `handle_terminal` and
    /// `handle_cancelled` publish it.
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
    fn plan_apply_body_summarises_counts() {
        assert_eq!(
            plan_apply_body(&plan_completion_payload()).as_deref(),
            Some("partially_applied: 3 applied, 1 failed, 2 skipped.")
        );
    }

    #[test]
    fn the_degraded_bulk_cancel_payload_raises_no_notification() {
        // `cancel_pending_items` publishes this shape on the same topic when
        // `list_pending_items` fails twice. Defaulting its absent counts would
        // announce a successful-looking apply that never happened.
        let degraded = serde_json::json!({ "planId": "p-1", "cancelledCount": 4 });
        assert_eq!(plan_apply_body(&degraded), None);
        assert_eq!(plan_apply_body(&serde_json::json!({})), None);
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
        assert_eq!(
            workflow_run_body(&payload).as_deref(),
            Some("siril run recorded: 2 new artifact(s) attributed.")
        );
    }

    #[test]
    fn workflow_run_body_rejects_an_untyped_payload() {
        assert_eq!(workflow_run_body(&serde_json::json!({ "toolId": "siril" })), None);
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
        assert_eq!(
            notification_for(TOPIC_PLAN_APPLYING_COMPLETED, &plan_completion_payload()),
            Some(Notification {
                title: "Plan apply finished",
                body: "partially_applied: 3 applied, 1 failed, 2 skipped.".to_owned()
            })
        );
    }

    #[test]
    fn the_workflow_run_topic_dispatches_to_the_workflow_run_notification() {
        assert_eq!(
            notification_for(TOPIC_WORKFLOW_RUN_COMPLETED, &workflow_run_payload()),
            Some(Notification {
                title: "Workflow run finished",
                body: "siril run recorded: 1 new artifact(s) attributed.".to_owned()
            })
        );
    }

    #[test]
    fn an_unsubscribed_topic_raises_no_notification() {
        // Every other topic on the shared bus reaches this subscriber.
        assert_eq!(notification_for("plan.applying.started", &plan_completion_payload()), None);
        assert_eq!(notification_for("manifest.write.success", &workflow_run_payload()), None);
    }

    #[test]
    fn a_subscribed_topic_with_an_undeserialisable_payload_raises_no_notification() {
        let degraded = serde_json::json!({ "planId": "p-1", "cancelledCount": 4 });
        assert_eq!(notification_for(TOPIC_PLAN_APPLYING_COMPLETED, &degraded), None);
        assert_eq!(notification_for(TOPIC_WORKFLOW_RUN_COMPLETED, &degraded), None);
    }
}
