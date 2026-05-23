//! Stable identifier and timestamp primitives.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;
use time::OffsetDateTime;
use uuid::Uuid;

/// Stable UUIDv4 identifier for any entity.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
    Type,
)]
#[serde(transparent)]
pub struct EntityId(Uuid);

impl EntityId {
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    #[must_use]
    pub const fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl Default for EntityId {
    fn default() -> Self {
        Self::new()
    }
}

impl From<Uuid> for EntityId {
    fn from(value: Uuid) -> Self {
        Self::from_uuid(value)
    }
}

impl std::fmt::Display for EntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Opaque UUID identifier for an `AuditLogEntry`.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, JsonSchema,
    Type,
)]
#[serde(transparent)]
pub struct AuditId(Uuid);

impl AuditId {
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    #[must_use]
    pub const fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl Default for AuditId {
    fn default() -> Self {
        Self::new()
    }
}

/// 32-byte SHA-256 content hash. Lazy — populated only when a workflow demands it.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(transparent)]
pub struct ContentHash(String);

impl ContentHash {
    /// Construct from a lowercase hex string. Panics in debug if length != 64.
    #[must_use]
    pub fn from_hex(hex: impl Into<String>) -> Self {
        let s = hex.into();
        debug_assert_eq!(s.len(), 64, "SHA-256 hex must be 64 chars");
        Self(s)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// RFC 3339 UTC timestamp wrapper.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct Timestamp(OffsetDateTime);

impl Timestamp {
    #[must_use]
    pub fn now_utc() -> Self {
        Self(OffsetDateTime::now_utc())
    }

    #[must_use]
    pub const fn from_offset_date_time(value: OffsetDateTime) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn as_offset_date_time(self) -> OffsetDateTime {
        self.0
    }
}

impl From<OffsetDateTime> for Timestamp {
    fn from(value: OffsetDateTime) -> Self {
        Self::from_offset_date_time(value)
    }
}

// Manual JsonSchema impl: represent as RFC 3339 date-time string.
impl schemars::JsonSchema for Timestamp {
    fn schema_name() -> String {
        "Timestamp".to_owned()
    }

    fn json_schema(_gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        use schemars::schema::{InstanceType, SchemaObject};
        SchemaObject {
            instance_type: Some(InstanceType::String.into()),
            format: Some("date-time".to_owned()),
            metadata: Some(Box::new(schemars::schema::Metadata {
                description: Some("RFC 3339 UTC timestamp.".to_owned()),
                ..Default::default()
            })),
            ..Default::default()
        }
        .into()
    }
}
