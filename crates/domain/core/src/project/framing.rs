// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `Framing` entity (spec 008 Q27, F-Framing-1) — data-model.md §Framing.
//!
//! A framing is the co-registerable integration unit within a project: the
//! light sessions sharing target + optic-train + pointing + rotation within a
//! tunable tolerance, spanning all filters and nights of one pointing.
//! `project → framing → session → frames`.
//!
//! This module carries the entity shape and the invariants that are natural
//! to encode as types/methods at this layer (FR-013/FR-016/FR-017). The
//! clustering algorithm itself (F-Framing-2) and the merge/split/reassign use
//! cases (F-Framing-3) live elsewhere; this is pure data + the small rules
//! that follow directly from the shape.

use crate::ids::EntityId;

/// Representative FOV-relative pointing for a framing, or a session's durable
/// clustering-key pointing. Degrees, ICRS.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pointing {
    pub ra_deg: f64,
    pub dec_deg: f64,
}

/// Snapshot of the tunable tolerance a clustering pass used (FR-014). Never an
/// exact-match key — documents *why* sessions grouped, not a rule the app
/// treats as authoritative.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FramingTolerance {
    /// Pointing tolerance as used by the clustering pass (FOV-relative
    /// fraction, or the absolute-degree no-FOV fallback per research R11a —
    /// the unit is a property of how the snapshot was produced, not of this
    /// type).
    pub pointing: f64,
    /// Rotation tolerance in degrees.
    pub rotation_deg: f32,
}

/// Clustering provenance (FR-015): the app's grouping is always a suggestion
/// until a user merges, splits, or reassigns — it never becomes authoritative
/// by itself.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Clustering {
    /// Produced by the tolerance-based clustering pass; still eligible for the
    /// bulk re-derive pass (onboarding/rescan) to update it.
    Suggested,
    /// The user merged, split, or reassigned this framing. Re-derivation MUST
    /// NEVER modify a `UserAdjusted` framing (FR-015) — it may only surface
    /// new suggestions.
    UserAdjusted,
}

impl Clustering {
    /// Whether re-derivation must leave this framing's membership untouched
    /// (FR-015). `Suggested` framings may be overwritten by a fresh suggestion;
    /// `UserAdjusted` framings are protected.
    #[must_use]
    pub const fn protected_from_rederivation(self) -> bool {
        matches!(self, Self::UserAdjusted)
    }
}

/// The co-registerable integration unit within a project (Q27).
///
/// Mirrors data-model.md §Framing. `session_view_id`/`manifest` (Q20/Q10
/// projections) are consumers of this model delivered by later iterations
/// (F-Framing-7) and are not persisted by this node — omitted here rather
/// than carried as always-`None` dead fields.
#[derive(Clone, Debug, PartialEq)]
pub struct Framing {
    pub id: EntityId,
    /// A framing belongs to exactly one project.
    pub project_id: EntityId,
    /// The framing's target; equals the project's declared target for mosaic
    /// panels (FR-017) and for the single active framing of a non-mosaic
    /// project (FR-016).
    pub target_id: Option<EntityId>,
    /// Optic-train identity (Q12/Q17 grouping key).
    pub optic_train_key: String,
    pub pointing: Pointing,
    pub rotation_deg: f32,
    pub tolerance: FramingTolerance,
    pub session_ids: Vec<EntityId>,
    pub clustering: Clustering,
}

impl Framing {
    /// Whether this framing's `target_id` is consistent with the owning
    /// project's declared target and mosaic mode.
    ///
    /// - Mosaic project (FR-017): every framing inherits the project's
    ///   declared target; per-frame target resolution is suppressed, so any
    ///   stored `target_id` (including `None`) is consistent.
    /// - Non-mosaic project (FR-016, one-target-per-project rule): the
    ///   framing's `target_id` MUST equal the project's declared target.
    #[must_use]
    pub fn target_is_consistent(&self, project_declared_target: EntityId, is_mosaic: bool) -> bool {
        is_mosaic || self.target_id == Some(project_declared_target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(byte: u8) -> EntityId {
        EntityId::from_uuid(uuid::Uuid::from_bytes([byte; 16]))
    }

    #[test]
    fn user_adjusted_is_protected_from_rederivation() {
        assert!(Clustering::UserAdjusted.protected_from_rederivation());
        assert!(!Clustering::Suggested.protected_from_rederivation());
    }

    fn framing_with_target(target_id: Option<EntityId>) -> Framing {
        Framing {
            id: id(2),
            project_id: id(3),
            target_id,
            optic_train_key: "scope-a|cam-a".to_owned(),
            pointing: Pointing { ra_deg: 10.0, dec_deg: 20.0 },
            rotation_deg: 0.0,
            tolerance: FramingTolerance { pointing: 0.1, rotation_deg: 3.0 },
            session_ids: vec![],
            clustering: Clustering::Suggested,
        }
    }

    #[test]
    fn non_mosaic_framing_must_match_the_project_declared_target() {
        let declared = id(1);
        assert!(framing_with_target(Some(declared)).target_is_consistent(declared, false));
        assert!(!framing_with_target(Some(id(9))).target_is_consistent(declared, false));
        assert!(!framing_with_target(None).target_is_consistent(declared, false));
    }

    #[test]
    fn mosaic_framing_target_is_always_consistent() {
        let declared = id(1);
        assert!(framing_with_target(Some(id(9))).target_is_consistent(declared, true));
        assert!(framing_with_target(None).target_is_consistent(declared, true));
    }
}
