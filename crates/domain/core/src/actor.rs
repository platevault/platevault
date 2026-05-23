//! Actor — initiator of a lifecycle transition or audit event.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ids::EntityId;

/// Who initiated an action.
///
/// `system` is only permitted on edges entering or leaving `blocked`
/// (per spec 009 ratification). The use-case layer enforces this and rejects
/// violations with `transition.refused`.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Actor {
    User {
        user_id: EntityId,
    },
    #[default]
    System,
}

impl Actor {
    #[must_use]
    pub fn user(user_id: EntityId) -> Self {
        Self::User { user_id }
    }

    #[must_use]
    pub const fn system() -> Self {
        Self::System
    }

    #[must_use]
    pub fn is_system(&self) -> bool {
        matches!(self, Self::System)
    }
}

// ── Legacy compat: old Actor(String) used .as_str() ──────────────────────────

impl Actor {
    #[must_use]
    pub fn as_str(&self) -> &str {
        match self {
            Self::System => "system",
            Self::User { .. } => "user",
        }
    }

    /// Construct a legacy "local" user actor (compat shim).
    #[must_use]
    pub fn local(_label: impl Into<String>) -> Self {
        Self::User { user_id: EntityId::new() }
    }
}
