//! Shared domain primitives for Astro Library Manager.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

pub const CRATE_NAME: &str = "domain_core";

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum DomainError {
    #[error("confidence score must be between 0.0 and 1.0 inclusive, got {0}")]
    InvalidConfidenceScore(String),
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Actor(String);

impl Actor {
    pub const SYSTEM_VALUE: &'static str = "system";

    #[must_use]
    pub fn system() -> Self {
        Self(Self::SYSTEM_VALUE.to_owned())
    }

    #[must_use]
    pub fn local(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for Actor {
    fn default() -> Self {
        Self::system()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EntityMetadata {
    pub id: EntityId,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub created_by: Actor,
}

impl EntityMetadata {
    #[must_use]
    pub fn new(created_by: Actor) -> Self {
        let now = Timestamp::now_utc();

        Self { id: EntityId::new(), created_at: now, updated_at: now, created_by }
    }

    #[must_use]
    pub fn system() -> Self {
        Self::new(Actor::system())
    }

    pub fn touch(&mut self, updated_at: Timestamp) {
        self.updated_at = updated_at;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConfidenceScore(f64);

impl ConfidenceScore {
    pub const MIN: f64 = 0.0;
    pub const MAX: f64 = 1.0;

    pub fn new(value: f64) -> Result<Self, DomainError> {
        if (Self::MIN..=Self::MAX).contains(&value) {
            Ok(Self(value))
        } else {
            Err(DomainError::InvalidConfidenceScore(value.to_string()))
        }
    }

    #[must_use]
    pub const fn get(self) -> f64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfidenceLevel {
    Unknown,
    Low,
    Medium,
    High,
    Confirmed,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EvidenceRef {
    pub kind: EvidenceKind,
    pub reference: String,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    MetadataKey,
    Path,
    Rule,
    UserDecision,
    PriorObservation,
    ExternalDocument,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Confidence {
    pub score: ConfidenceScore,
    pub level: ConfidenceLevel,
    pub evidence_refs: Vec<EvidenceRef>,
    pub explanation: String,
}

impl Confidence {
    pub fn new(
        score: ConfidenceScore,
        level: ConfidenceLevel,
        explanation: impl Into<String>,
    ) -> Self {
        Self { score, level, evidence_refs: Vec::new(), explanation: explanation.into() }
    }

    pub fn with_evidence(mut self, evidence: EvidenceRef) -> Self {
        self.evidence_refs.push(evidence);
        self
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewState {
    Unreviewed,
    Confirmed,
    Corrected,
    Rejected,
    Ignored,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLifecycleState {
    Candidate,
    Active,
    SourceMapped,
    Prepared,
    Processing,
    Finalized,
    Verified,
    CleanupReviewed,
    Archived,
    Retired,
}

impl ProjectLifecycleState {
    #[must_use]
    pub const fn is_before_archive(self) -> bool {
        matches!(
            self,
            Self::Candidate
                | Self::Active
                | Self::SourceMapped
                | Self::Prepared
                | Self::Processing
                | Self::Finalized
                | Self::Verified
                | Self::CleanupReviewed
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationState {
    NotReady,
    OutputsRecorded,
    Verified,
    Rejected,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanupState {
    NotReviewed,
    Eligible,
    Reviewed,
    Applied,
    Blocked,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveState {
    NotArchived,
    Planned,
    Archived,
    Restored,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Draft,
    ReadyForReview,
    Approved,
    Applying,
    Applied,
    PartiallyApplied,
    Failed,
    Cancelled,
    Superseded,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcquisitionSessionState {
    Candidate,
    Confirmed,
    Rejected,
    Superseded,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Reviewed<T> {
    pub value: T,
    pub confidence: Confidence,
    pub review_state: ReviewState,
}

impl<T> Reviewed<T> {
    #[must_use]
    pub const fn new(value: T, confidence: Confidence, review_state: ReviewState) -> Self {
        Self { value, confidence, review_state }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Actor, ConfidenceLevel, ConfidenceScore, EntityId, EntityMetadata, ProjectLifecycleState,
        ReviewState, Reviewed, CRATE_NAME,
    };

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "domain_core");
    }

    #[test]
    fn creates_stable_entity_metadata() {
        let metadata = EntityMetadata::new(Actor::local("tester"));

        assert_ne!(metadata.id, EntityId::default());
        assert_eq!(metadata.created_by.as_str(), "tester");
        assert_eq!(metadata.created_at, metadata.updated_at);
    }

    #[test]
    fn validates_confidence_score_bounds() {
        assert_eq!(ConfidenceScore::new(0.0).unwrap().get(), 0.0);
        assert_eq!(ConfidenceScore::new(1.0).unwrap().get(), 1.0);
        assert!(ConfidenceScore::new(-0.01).is_err());
        assert!(ConfidenceScore::new(1.01).is_err());
    }

    #[test]
    fn supports_reviewed_values() {
        let confidence = super::Confidence::new(
            ConfidenceScore::new(0.9).unwrap(),
            ConfidenceLevel::High,
            "matching metadata",
        );
        let reviewed = Reviewed::new("M31", confidence, ReviewState::Confirmed);

        assert_eq!(reviewed.value, "M31");
        assert_eq!(reviewed.review_state, ReviewState::Confirmed);
    }

    #[test]
    fn identifies_lifecycle_states_before_archive() {
        assert!(ProjectLifecycleState::Verified.is_before_archive());
        assert!(!ProjectLifecycleState::Archived.is_before_archive());
        assert!(!ProjectLifecycleState::Retired.is_before_archive());
    }
}
