// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! How services hand values to a host, which forwards each [`Feed`] item to
//! its UI in order (Tauri `emit` today).
//!
//! Two channel kinds carry those values, each with a fixed delivery promise:
//!
//! - **Latest-value state**, over `tokio::sync::watch` and read through
//!   [`Latest`]: for state the UI must never miss. A subscriber that arrives
//!   late or falls behind skips intermediate values but always receives the
//!   current one. First consumer: the updater's update status
//!   (astro-plan-5wcib).
//! - **Transient events**, over `tokio::sync::broadcast`: a subscriber that
//!   falls behind is told how many it missed, and each feed decides what that
//!   means. The [`crate::jobs`] feeds re-read durable status; the
//!   [`crate::log_stream`] feed reports the gap.

use std::future::Future;

use tokio::sync::watch;

/// An ordered source of values for a host to show.
///
/// A host polls each [`Feed::next`] call to completion, one call at a time.
/// The method is not cancel-safe: dropping a pending call, for example as the
/// losing branch of a `select!`, can lose a value or the durable resync that
/// follows a lagged channel.
pub trait Feed: Send {
    type Item: Send;

    /// The next value, or `None` once the feed has ended.
    fn next(&mut self) -> impl Future<Output = Option<Self::Item>> + Send;
}

/// Latest-value state from a `watch` channel: the current value first, then
/// each change, ending when the sender is dropped. Its first producer is the
/// updater (astro-plan-5wcib), which publishes its update status through it.
pub struct Latest<T> {
    receiver: watch::Receiver<T>,
}

impl<T> Latest<T> {
    #[must_use]
    pub fn new(mut receiver: watch::Receiver<T>) -> Self {
        receiver.mark_changed();
        Self { receiver }
    }
}

impl<T: Clone + Send + Sync> Feed for Latest<T> {
    type Item = T;

    async fn next(&mut self) -> Option<T> {
        self.receiver.changed().await.ok()?;
        Some(self.receiver.borrow_and_update().clone())
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::sync::watch;

    use super::{Feed, Latest};

    #[tokio::test]
    async fn a_late_subscriber_first_receives_the_current_value() {
        let (sender, _) = watch::channel(0_u32);
        sender.send_replace(7);
        let mut latest = Latest::new(sender.subscribe());
        assert_eq!(latest.next().await, Some(7));
    }

    #[tokio::test]
    async fn a_lagging_subscriber_skips_to_the_newest_value() {
        let (sender, receiver) = watch::channel(0_u32);
        let mut latest = Latest::new(receiver);
        assert_eq!(latest.next().await, Some(0));
        for value in 1..=5 {
            sender.send_replace(value);
        }
        assert_eq!(latest.next().await, Some(5));
    }

    #[tokio::test]
    async fn an_unchanged_value_is_not_repeated() {
        let (_sender, receiver) = watch::channel(0_u32);
        let mut latest = Latest::new(receiver);
        assert_eq!(latest.next().await, Some(0));
        let waited = tokio::time::timeout(Duration::from_millis(50), latest.next()).await;
        assert!(waited.is_err(), "no change, so nothing to yield");
    }

    #[tokio::test]
    async fn the_feed_ends_after_the_last_value_once_the_sender_is_gone() {
        let (sender, receiver) = watch::channel(0_u32);
        let mut latest = Latest::new(receiver);
        assert_eq!(latest.next().await, Some(0));
        sender.send_replace(1);
        drop(sender);
        assert_eq!(latest.next().await, Some(1), "an unseen final value is still delivered");
        assert_eq!(latest.next().await, None);
    }
}
