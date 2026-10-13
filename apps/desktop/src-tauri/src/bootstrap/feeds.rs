// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Forwards `desktop_services` feeds to the webview as Tauri events.

use desktop_services::channels::Feed;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

/// Emit every item of `feed` as the Tauri event `event`, in order, until the
/// feed ends.
///
/// An item that cannot be delivered is passed to `undelivered`, which logs it
/// with the feed's own context, and is skipped: each feed's durable source (its
/// status command, or `log.recent`) stays the truth.
pub async fn forward<R: Runtime, F>(
    app: AppHandle<R>,
    event: &'static str,
    mut feed: F,
    undelivered: impl Fn(&F::Item, &tauri::Error),
) where
    F: Feed,
    F::Item: Serialize,
{
    while let Some(item) = feed.next().await {
        if let Err(error) = app.emit(event, &item) {
            undelivered(&item, &error);
        }
    }
}
