//! In-process event bus backed by `tokio::sync::broadcast`.
//!
//! The durable side (SQLite `events` table writes + cursor reads for replay)
//! is tracked as T010b and deferred. Subscribers here receive live events only;
//! replay across restarts requires loading from the `events` table first.

use serde::Serialize;
use tokio::sync::broadcast;

use crate::event_bus::{EventEnvelope, Source};

/// Capacity of the broadcast channel.  Lagging receivers are dropped with
/// `RecvError::Lagged`; they must re-subscribe and query the durable table.
const BUS_CAPACITY: usize = 256;

/// In-process live event bus.
///
/// Clone to share across tasks — clones share the same underlying channel.
#[derive(Clone, Debug)]
pub struct EventBus {
    sender: broadcast::Sender<EventEnvelope<serde_json::Value>>,
}

impl EventBus {
    #[must_use]
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(BUS_CAPACITY);
        Self { sender }
    }

    /// Publish a typed payload on the given topic. The payload is serialised
    /// to `serde_json::Value` before broadcasting so the channel stays
    /// payload-agnostic.
    ///
    /// Returns the number of active receivers that received the event.
    /// A return value of `0` is not an error — it just means no one is listening.
    ///
    /// # Errors
    /// Returns `Err` if serialisation of `payload` fails.
    pub fn publish<P: Serialize>(
        &self,
        topic: &str,
        source: Source,
        payload: P,
    ) -> Result<usize, serde_json::Error> {
        let value = serde_json::to_value(payload)?;
        let envelope = EventEnvelope::new(topic, source, value);
        // `send` errors only when there are NO receivers at all (which is fine).
        Ok(self.sender.send(envelope).unwrap_or(0))
    }

    /// Subscribe to all events on the bus.
    ///
    /// Receiver is non-blocking (async). Missed events due to capacity overflow
    /// come back as `RecvError::Lagged`.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<EventEnvelope<serde_json::Value>> {
        self.sender.subscribe()
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event_bus::Source;

    #[tokio::test]
    async fn publish_and_receive_event() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();

        bus.publish("test.topic", Source::System, serde_json::json!({"ok": true}))
            .expect("serialize");

        let envelope = rx.try_recv().expect("should receive");
        assert_eq!(envelope.topic, "test.topic");
        assert_eq!(envelope.payload["ok"], true);
    }

    #[test]
    fn publish_to_no_receivers_is_not_an_error() {
        let bus = EventBus::new();
        let count =
            bus.publish("test.topic", Source::System, serde_json::json!({})).expect("serialize");
        assert_eq!(count, 0);
    }
}
