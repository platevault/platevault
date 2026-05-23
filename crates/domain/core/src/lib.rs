//! Shared domain primitives for Astro Library Manager.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

pub mod actor;
pub mod ids;
pub mod lifecycle;

pub use actor::Actor;
pub use ids::{AuditId, ContentHash, EntityId, Timestamp};

// ── Legacy type aliases kept for crates that import the old flat names ────────
/// Legacy alias: use `lifecycle::plan::PlanState` in new code.
pub use lifecycle::plan::PlanState as PlanStatus;

pub const CRATE_NAME: &str = "domain_core";

// ── Re-export legacy types that other crates still import ────────────────────

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum DomainError {
    #[error("confidence score must be between 0.0 and 1.0 inclusive, got {0}")]
    InvalidConfidenceScore(String),
}

#[derive(Clone, Copy, Debug, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ConfidenceScore(f64);

impl ConfidenceScore {
    pub const MIN: f64 = 0.0;
    pub const MAX: f64 = 1.0;

    /// # Errors
    /// Returns `DomainError::InvalidConfidenceScore` if `value` is outside `[0.0, 1.0]`.
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

    #[must_use]
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

/// Legacy flat struct used by other crates — kept for compilation compatibility.
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
        Self::new(Actor::System)
    }

    pub fn touch(&mut self, updated_at: Timestamp) {
        self.updated_at = updated_at;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        Actor, ConfidenceLevel, ConfidenceScore, EntityId, EntityMetadata, ReviewState, Reviewed,
        CRATE_NAME,
    };

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "domain_core");
    }

    #[test]
    fn creates_stable_entity_metadata() {
        let metadata = EntityMetadata::new(Actor::user(EntityId::new()));

        assert_ne!(metadata.id, EntityId::default());
        assert!(matches!(metadata.created_by, Actor::User { .. }));
        assert_eq!(metadata.created_at, metadata.updated_at);
    }

    #[test]
    #[allow(clippy::float_cmp)] // exact boundary values are representable without error
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
}
