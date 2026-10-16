// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! What the Windows and freedesktop offers share: a `notify-rust`
//! notification with both buttons, and a thread that waits for the response.

use notify_rust::Notification;

use super::{OfferAction, OfferText, Refusal, Responder};

/// Show `notification` with `text` and both buttons, and pass the response
/// (a button, a body click or a close) to `responder` from a thread of its
/// own: waiting for it blocks until the user acts or the notification
/// closes. Blocks while the OS takes the notification, so it runs on a
/// blocking thread.
pub fn show(
    mut notification: Notification,
    text: &OfferText,
    responder: Responder,
) -> Result<(), Refusal> {
    notification.summary(&text.title).body(&text.body);
    for action in OfferAction::ALL {
        notification.action(action.identifier(), text.label(action));
    }
    let handle = notification.show().map_err(|error| Refusal::Failed(error.to_string()))?;
    std::thread::Builder::new()
        .name("update-offer".to_owned())
        .spawn(move || {
            handle.wait_for_action(|identifier| responder.respond_identifier(identifier))
        })
        .map(drop)
        .map_err(|error| Refusal::Failed(error.to_string()))
}

/// Run `show` on a blocking thread.
pub async fn show_blocking(
    show: impl FnOnce() -> Result<(), Refusal> + Send + 'static,
) -> Result<(), Refusal> {
    tokio::task::spawn_blocking(show)
        .await
        .unwrap_or_else(|error| Err(Refusal::Failed(error.to_string())))
}
