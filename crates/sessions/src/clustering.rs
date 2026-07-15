// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Tolerance-based framing clustering (spec 008 Q27, F-Framing-2) per
//! research R11a.
//!
//! Pure algorithm over caller-supplied session/framing descriptors — no
//! database access. The app layer (F-Framing-3/5) is responsible for loading
//! a project's session geometry and existing framings, calling
//! [`derive_clustering`], and applying/persisting the result as a review
//! surface (FR-015: suggestions are never auto-applied).
//!
//! Scope note: this module clusters **within one project's** light sessions
//! (F-Framing-2). Cross-project confirm-time attribution ranking, the FR-019
//! mosaic envelope relaxation, and the optic-train+coarse-sky-bin prefilter
//! belong to F-Framing-5 and are intentionally not implemented here.
//!
//! ## Algorithm (R11a)
//!
//! - **Linkage**: single-link against a group's *representative*, never
//!   pairwise/transitive — a session joins the closest group whose
//!   representative it matches within tolerance; it never merges two groups
//!   that are each individually out of tolerance of the other.
//! - **Representative**: circular mean of RA, arithmetic mean of Dec,
//!   circular mean of rotation — recomputed exactly (via running unit-vector
//!   sums, not the framing's stored snapshot) from whichever member sessions'
//!   geometry the caller passed in this call, every call. This trades a
//!   "pass the full project's session set" caller contract for algorithmic
//!   simplicity and numerical exactness (no incremental-update approximation
//!   error) — acceptable at per-project session-count scale.
//! - **Protection**: sessions already belonging to a `UserAdjusted` framing
//!   are assigned to that framing unconditionally and never enter candidate
//!   matching for any other group — re-derivation cannot modify or drain a
//!   user-adjusted framing's membership (FR-015). New sessions that would
//!   otherwise have matched a user-adjusted framing's location form a new
//!   suggested group instead; the user can still fold them in manually via
//!   `framing.merge`/`reassign` (F-Framing-3).
//! - **NULL-geometry**: sessions missing target, optic-train, pointing, or
//!   rotation are excluded from clustering and returned as `Unassigned`
//!   (never zero-defaulted) — data-model.md §211, R11 "NULL-geometry
//!   sessions are excluded" note.
//! - **Rotation wraparound**: compared as a circular quantity modulo 360°
//!   (shortest arc, range `[0, 180]`), matching the RA treatment. R11a's
//!   rationale text ("meridian-flip camera-angle drift stays inside [the 3°
//!   tolerance]") describes flip drift as small, not a ~180° jump — NINA-style
//!   field derotators hold sky position angle across a flip — so plain mod-360
//!   wraparound (not mod-180) is the correct model; a mod-180 model would
//!   incorrectly treat a deliberately-rotated composition 180° away as the
//!   same framing.

use std::collections::BTreeMap;

use domain_core::project::framing::{Clustering, FramingTolerance, Pointing};
use domain_core::EntityId;

/// One light session's clustering-relevant attributes for one clustering
/// pass. Any `None` geometry field excludes the session from clustering.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionGeometry {
    pub session_id: EntityId,
    pub target_id: Option<EntityId>,
    pub optic_train_key: Option<String>,
    pub pointing: Option<Pointing>,
    pub rotation_deg: Option<f32>,
    /// Optic-train FOV diagonal in degrees (focal length + sensor dimensions,
    /// R11a). `None` triggers the fixed no-equipment pointing-tolerance
    /// fallback for every comparison involving this session.
    pub fov_diagonal_deg: Option<f64>,
}

/// A framing already known to the caller, considered as a join candidate
/// (`Suggested`) or as protected, untouchable membership (`UserAdjusted`).
#[derive(Clone, Debug, PartialEq)]
pub struct ExistingFraming {
    pub id: EntityId,
    pub target_id: Option<EntityId>,
    pub optic_train_key: String,
    pub clustering: Clustering,
    pub member_session_ids: Vec<EntityId>,
}

/// The tunable clustering parameters (R11a; stored in Settings, F-Framing-11).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ToleranceParams {
    /// Fraction of FOV diagonal used as pointing tolerance (R11a default 0.10).
    pub pointing_fraction_of_fov: f64,
    /// Absolute pointing tolerance in degrees used when FOV is unknown
    /// (R11a default 0.2).
    pub pointing_fallback_deg: f64,
    /// Rotation tolerance in degrees (R11a default 3.0).
    pub rotation_tolerance_deg: f32,
    /// Mosaic candidate envelope (F-Framing-5, FR-019 relaxation): fraction of
    /// FOV diagonal used as the pointing envelope around any existing framing's
    /// representative for `isMosaic` projects, replacing target equality
    /// (R11a default 1.0 — adjacent panels at 10-20% overlap land at
    /// ~0.8-0.9x FOV spacing, inside the envelope; unrelated targets fall far
    /// outside it).
    pub mosaic_envelope_fraction_of_fov: f64,
}

impl ToleranceParams {
    /// R11a shipped defaults.
    #[must_use]
    pub const fn defaults() -> Self {
        Self {
            pointing_fraction_of_fov: 0.10,
            pointing_fallback_deg: 0.2,
            rotation_tolerance_deg: 3.0,
            mosaic_envelope_fraction_of_fov: 1.0,
        }
    }
}

/// FOV diagonal in degrees from optic-train focal length + sensor dimensions
/// (R11a "FOV source"). `None` when any input is non-positive/absent — callers
/// fall back to [`ToleranceParams::pointing_fallback_deg`] per R11a.
///
/// Standard small-angle-free optics formula: `2 * atan(sensor_diagonal_mm /
/// (2 * focal_length_mm))`, converted to degrees. `pixel_size_um` is the same
/// value on both axes (square pixels, the overwhelming common case for
/// astro cameras); `naxis1`/`naxis2` are the sensor dimensions in pixels.
// Sensor dimensions in pixels never approach f64's exact-integer limit
// (2^53) at any real camera resolution; this narrows an i64 pixel count into
// FOV geometry math, not a precision-sensitive accumulation.
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn fov_diagonal_deg(
    focal_length_mm: f64,
    pixel_size_um: f64,
    naxis1: i64,
    naxis2: i64,
) -> Option<f64> {
    if focal_length_mm <= 0.0 || pixel_size_um <= 0.0 || naxis1 <= 0 || naxis2 <= 0 {
        return None;
    }
    let sensor_width_mm = (naxis1 as f64) * pixel_size_um / 1000.0;
    let sensor_height_mm = (naxis2 as f64) * pixel_size_um / 1000.0;
    let sensor_diagonal_mm = sensor_width_mm.hypot(sensor_height_mm);
    Some(2.0 * (sensor_diagonal_mm / (2.0 * focal_length_mm)).atan().to_degrees())
}

/// Why a session was excluded from clustering.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnassignedReason {
    MissingTarget,
    MissingOpticTrain,
    MissingPointing,
    MissingRotation,
}

/// The clustering outcome for one session.
#[derive(Clone, Debug, PartialEq)]
pub enum Assignment {
    /// Joins an existing framing (protected `UserAdjusted` membership, or a
    /// tolerance match against a `Suggested` framing's representative).
    JoinExisting(EntityId),
    /// Joins a freshly suggested group; index into
    /// [`ClusteringResult::new_framings`].
    NewFraming(usize),
    /// Excluded from clustering (NULL geometry).
    Unassigned(UnassignedReason),
}

/// A brand-new suggested framing produced by this pass.
#[derive(Clone, Debug, PartialEq)]
pub struct NewFramingGroup {
    pub target_id: EntityId,
    pub optic_train_key: String,
    pub representative: Pointing,
    pub representative_rotation_deg: f32,
    /// Snapshot of the tolerance this group was formed under (FR-014), taken
    /// from the seeding session's FOV data.
    pub tolerance: FramingTolerance,
    pub tolerance_is_fallback: bool,
    pub session_ids: Vec<EntityId>,
}

/// Full result of one clustering pass.
#[derive(Clone, Debug, PartialEq)]
pub struct ClusteringResult {
    /// One entry per input session, in input order.
    pub assignments: Vec<(EntityId, Assignment)>,
    pub new_framings: Vec<NewFramingGroup>,
}

/// Group a project's light sessions into suggested framings (F-Framing-2).
///
/// `sessions` should be the project's full light-session geometry set (both
/// currently-framed and unframed) so representatives are recomputed exactly;
/// `existing` is the project's current framings. The result is a suggestion
/// only — nothing here writes to a store (FR-015).
///
/// # Panics
/// Never panics for valid input (each `session_id` in `sessions` is unique);
/// the internal `expect` documents an algorithm invariant, not a caller
/// contract.
#[must_use]
pub fn derive_clustering(
    sessions: &[SessionGeometry],
    existing: &[ExistingFraming],
    params: &ToleranceParams,
) -> ClusteringResult {
    // Every session already declared a member of an existing framing (whether
    // `Suggested` or `UserAdjusted`) resolves to that framing directly and
    // contributes to its accumulator exactly once via seeding in
    // `cluster_partition` — never re-decided by matching within this same
    // pass. This is what makes `UserAdjusted` membership untouchable (FR-015)
    // and, as a side effect, keeps already-`Suggested`-attributed sessions
    // stable within one call instead of being re-litigated (and potentially
    // double-counted, or reassigned by input-order luck) against every other
    // candidate framing each time. A session can still move between framings
    // via the explicit F-Framing-3 merge/split/reassign use cases.
    let member_framing_of: BTreeMap<EntityId, EntityId> = existing
        .iter()
        .flat_map(|f| f.member_session_ids.iter().map(move |session_id| (*session_id, f.id)))
        .collect();

    let (mut resolved, partitions, geometry_by_id) =
        split_known_members_and_null_geometry(sessions, &member_framing_of);

    let mut new_framings = Vec::new();
    for ((target_id, optic_train_key), members) in partitions {
        cluster_partition(
            target_id,
            &optic_train_key,
            members,
            existing,
            &geometry_by_id,
            params,
            &mut new_framings,
            &mut resolved,
        );
    }

    let assignments = sessions
        .iter()
        .map(|session| {
            let assignment = resolved.remove(&session.session_id).expect(
                "every session is resolved by the protected/NULL-geometry/partition passes above",
            );
            (session.session_id, assignment)
        })
        .collect();

    ClusteringResult { assignments, new_framings }
}

type ClusterableSession = (EntityId, Pointing, f32, Option<f64>);
/// A resolved session's pointing/rotation/FOV, keyed by session id elsewhere —
/// used to seed an existing framing's accumulator from its declared
/// `member_session_ids`' *actual* geometry (never from input-order luck).
type SessionGeom = (Pointing, f32, Option<f64>);
type SplitResult = (
    BTreeMap<EntityId, Assignment>,
    BTreeMap<(EntityId, String), Vec<ClusterableSession>>,
    BTreeMap<EntityId, SessionGeom>,
);

/// Splits sessions into eagerly-resolved assignments (known existing
/// membership, NULL-geometry exclusion) and the remaining not-yet-attributed
/// clusterable sessions, grouped by the exact `(target, optic_train_key)`
/// identity key — pointing/rotation tolerance only applies *within* one such
/// partition (FR-013). Also returns a session-id-keyed geometry lookup
/// covering *every* session with complete geometry, including already-a-member
/// ones, so `cluster_partition` can seed existing framings' representatives
/// from their real members (rather than leaving them unseeded, or double-
/// counting a member that also appears in the clusterable set).
fn split_known_members_and_null_geometry(
    sessions: &[SessionGeometry],
    member_framing_of: &BTreeMap<EntityId, EntityId>,
) -> SplitResult {
    let mut resolved: BTreeMap<EntityId, Assignment> = BTreeMap::new();
    let mut geometry_by_id: BTreeMap<EntityId, SessionGeom> = BTreeMap::new();
    let mut clusterable: Vec<(EntityId, EntityId, String, Pointing, f32, Option<f64>)> = Vec::new();

    for session in sessions {
        if let (Some(pointing), Some(rotation_deg)) = (session.pointing, session.rotation_deg) {
            if session.target_id.is_some() && session.optic_train_key.is_some() {
                geometry_by_id
                    .insert(session.session_id, (pointing, rotation_deg, session.fov_diagonal_deg));
            }
        }

        if let Some(&framing_id) = member_framing_of.get(&session.session_id) {
            resolved.insert(session.session_id, Assignment::JoinExisting(framing_id));
            continue;
        }
        let Some(target_id) = session.target_id else {
            resolved.insert(
                session.session_id,
                Assignment::Unassigned(UnassignedReason::MissingTarget),
            );
            continue;
        };
        let Some(optic_train_key) = session.optic_train_key.clone() else {
            resolved.insert(
                session.session_id,
                Assignment::Unassigned(UnassignedReason::MissingOpticTrain),
            );
            continue;
        };
        let Some(pointing) = session.pointing else {
            resolved.insert(
                session.session_id,
                Assignment::Unassigned(UnassignedReason::MissingPointing),
            );
            continue;
        };
        let Some(rotation_deg) = session.rotation_deg else {
            resolved.insert(
                session.session_id,
                Assignment::Unassigned(UnassignedReason::MissingRotation),
            );
            continue;
        };
        clusterable.push((
            session.session_id,
            target_id,
            optic_train_key,
            pointing,
            rotation_deg,
            session.fov_diagonal_deg,
        ));
    }
    // Deterministic processing order regardless of input order.
    clusterable.sort_by_key(|(session_id, ..)| *session_id);

    let mut partitions: BTreeMap<(EntityId, String), Vec<ClusterableSession>> = BTreeMap::new();
    for (session_id, target_id, optic_train_key, pointing, rotation_deg, fov) in clusterable {
        partitions.entry((target_id, optic_train_key)).or_default().push((
            session_id,
            pointing,
            rotation_deg,
            fov,
        ));
    }
    (resolved, partitions, geometry_by_id)
}

/// Runs single-link-to-representative clustering for one `(target,
/// optic_train_key)` partition, extending `new_framings` and `resolved` in
/// place.
fn cluster_partition(
    target_id: EntityId,
    optic_train_key: &str,
    members: Vec<ClusterableSession>,
    existing: &[ExistingFraming],
    geometry_by_id: &BTreeMap<EntityId, SessionGeom>,
    params: &ToleranceParams,
    new_framings: &mut Vec<NewFramingGroup>,
    resolved: &mut BTreeMap<EntityId, Assignment>,
) {
    let candidates: Vec<&ExistingFraming> = existing
        .iter()
        .filter(|f| {
            f.clustering == Clustering::Suggested
                && f.target_id == Some(target_id)
                && f.optic_train_key == optic_train_key
        })
        .collect();
    let candidate_count = candidates.len();

    // Seed each existing framing's accumulator from its declared members'
    // *actual* geometry before any new session is matched — matching against
    // an unseeded (count==0) accumulator would let whichever new session
    // happens to be processed first squat an existing framing regardless of
    // fit (the order-dependent anti-pattern R11a rejects).
    let mut groups: Vec<GroupAccumulator> = candidates
        .iter()
        .map(|framing| {
            let mut group =
                GroupAccumulator::new(Some(framing.id), framing.member_session_ids.is_empty());
            for member_id in &framing.member_session_ids {
                if let Some(&(pointing, rotation_deg, fov)) = geometry_by_id.get(member_id) {
                    group.push(*member_id, pointing, rotation_deg, fov.is_none());
                }
            }
            group
        })
        .collect();
    let group_offset_for_new = new_framings.len();

    for (session_id, pointing, rotation_deg, fov) in members {
        let effective_pointing_tolerance_deg = fov
            .map_or(params.pointing_fallback_deg, |fov_diag| {
                params.pointing_fraction_of_fov * fov_diag
            });
        let used_fallback = fov.is_none();

        let group_idx = best_matching_group(
            &groups,
            pointing,
            rotation_deg,
            effective_pointing_tolerance_deg,
            params,
        )
        .unwrap_or_else(|| {
            groups.push(GroupAccumulator::new(None, false));
            groups.len() - 1
        });
        groups[group_idx].push(session_id, pointing, rotation_deg, used_fallback);

        let assignment = if let Some(framing_id) = groups[group_idx].existing_id {
            Assignment::JoinExisting(framing_id)
        } else {
            Assignment::NewFraming(group_offset_for_new + (group_idx - candidate_count))
        };
        resolved.insert(session_id, assignment);
    }

    for group in groups.into_iter().skip(candidate_count) {
        new_framings.push(NewFramingGroup {
            target_id,
            optic_train_key: optic_train_key.to_owned(),
            representative: group.representative_pointing(),
            representative_rotation_deg: group.representative_rotation_deg(),
            tolerance: FramingTolerance {
                pointing: if group.seed_used_fallback {
                    params.pointing_fallback_deg
                } else {
                    params.pointing_fraction_of_fov
                },
                rotation_deg: params.rotation_tolerance_deg,
            },
            tolerance_is_fallback: group.seed_used_fallback,
            session_ids: group.session_ids,
        });
    }
}

/// Finds the closest existing/in-progress group this session matches, per the
/// single-link-to-representative rule (R11a). Ties prefer the lower group
/// index — pre-existing-framing candidates are indexed first, so a match
/// prefers a stable, DB-anchored suggestion over a brand-new group.
///
/// A genuinely-empty existing framing (declared zero members — e.g. one the
/// user just created via reassign/new-framing) has no representative to
/// compare against; it is a **last-resort** candidate only, considered when
/// nothing else matched geometrically. It must never outrank or displace a
/// real geometric match against a seeded group (regression: an unrelated
/// session must not "claim" a populated framing just because it happens to
/// be processed before that framing's real members are evaluated).
fn best_matching_group(
    groups: &[GroupAccumulator],
    pointing: Pointing,
    rotation_deg: f32,
    effective_pointing_tolerance_deg: f64,
    params: &ToleranceParams,
) -> Option<usize> {
    let real_match = groups
        .iter()
        .enumerate()
        .filter(|(_, group)| group.count > 0)
        .filter_map(|(idx, group)| {
            let pointing_distance =
                angular_separation_deg(pointing, group.representative_pointing());
            if pointing_distance > effective_pointing_tolerance_deg {
                return None;
            }
            let rotation_distance =
                rotation_circular_distance_deg(rotation_deg, group.representative_rotation_deg());
            if rotation_distance > f64::from(params.rotation_tolerance_deg) {
                return None;
            }
            Some((idx, pointing_distance))
        })
        .min_by(|(idx_a, dist_a), (idx_b, dist_b)| {
            dist_a.partial_cmp(dist_b).unwrap_or(std::cmp::Ordering::Equal).then(idx_a.cmp(idx_b))
        })
        .map(|(idx, _)| idx);
    if real_match.is_some() {
        return real_match;
    }

    groups
        .iter()
        .position(|group| group.existing_id.is_some() && group.count == 0 && group.declared_empty)
}

/// Running exact circular-mean accumulator for one candidate group.
struct GroupAccumulator {
    existing_id: Option<EntityId>,
    /// True only for an existing framing whose `member_session_ids` was
    /// genuinely empty (not merely unresolved this call) — the sole
    /// condition under which this group is eligible for the last-resort
    /// trivial match in [`best_matching_group`]. Meaningless for new
    /// (`existing_id: None`) groups.
    declared_empty: bool,
    sum_sin_ra: f64,
    sum_cos_ra: f64,
    sum_dec: f64,
    sum_sin_rot: f64,
    sum_cos_rot: f64,
    count: u32,
    seed_used_fallback: bool,
    session_ids: Vec<EntityId>,
}

impl GroupAccumulator {
    fn new(existing_id: Option<EntityId>, declared_empty: bool) -> Self {
        Self {
            existing_id,
            declared_empty,
            sum_sin_ra: 0.0,
            sum_cos_ra: 0.0,
            sum_dec: 0.0,
            sum_sin_rot: 0.0,
            sum_cos_rot: 0.0,
            count: 0,
            seed_used_fallback: false,
            session_ids: Vec::new(),
        }
    }

    fn push(
        &mut self,
        session_id: EntityId,
        pointing: Pointing,
        rotation_deg: f32,
        used_fallback: bool,
    ) {
        if self.count == 0 {
            self.seed_used_fallback = used_fallback;
        }
        let ra_rad = pointing.ra_deg.to_radians();
        self.sum_sin_ra += ra_rad.sin();
        self.sum_cos_ra += ra_rad.cos();
        self.sum_dec += pointing.dec_deg;
        let rot_rad = f64::from(rotation_deg).to_radians();
        self.sum_sin_rot += rot_rad.sin();
        self.sum_cos_rot += rot_rad.cos();
        self.count += 1;
        self.session_ids.push(session_id);
    }

    /// Circular-mean-RA / arithmetic-mean-Dec representative of the members
    /// pushed so far. Callers only invoke this once `count > 0` (an empty
    /// group has no representative to compute); the `max(1)` guard just keeps
    /// this self-contained rather than panicking on misuse.
    fn representative_pointing(&self) -> Pointing {
        let count = f64::from(self.count.max(1));
        Pointing {
            ra_deg: normalize_deg_0_360(self.sum_sin_ra.atan2(self.sum_cos_ra).to_degrees()),
            dec_deg: self.sum_dec / count,
        }
    }

    // Angles live in [-180, 180] degrees; an f64->f32 rotation angle never
    // approaches f32's magnitude limits, so this narrows precision, not range.
    #[allow(clippy::cast_possible_truncation)]
    fn representative_rotation_deg(&self) -> f32 {
        self.sum_sin_rot.atan2(self.sum_cos_rot).to_degrees() as f32
    }
}

fn normalize_deg_0_360(deg: f64) -> f64 {
    deg.rem_euclid(360.0)
}

/// Great-circle angular separation between two ICRS pointings, in degrees
/// (haversine — accurate at the sub-degree scale framing tolerances operate
/// at; avoids the RA/Dec Euclidean-distance bug that overstates separation
/// near the poles).
#[must_use]
pub fn angular_separation_deg(a: Pointing, b: Pointing) -> f64 {
    let (lat1, lat2) = (a.dec_deg.to_radians(), b.dec_deg.to_radians());
    let dlat = lat2 - lat1;
    let dlon = (b.ra_deg - a.ra_deg).to_radians();
    let sin_dlat_2 = (dlat / 2.0).sin();
    let sin_dlon_2 = (dlon / 2.0).sin();
    let h = sin_dlat_2.mul_add(sin_dlat_2, lat1.cos() * lat2.cos() * sin_dlon_2 * sin_dlon_2);
    2.0 * h.clamp(0.0, 1.0).sqrt().asin().to_degrees()
}

/// Shortest circular distance between two rotation angles, in degrees,
/// modulo 360° (range `[0, 180]`). See module docs for why 360°, not 180°.
#[must_use]
pub fn rotation_circular_distance_deg(a: f32, b: f32) -> f64 {
    let diff = (f64::from(a) - f64::from(b)).rem_euclid(360.0);
    diff.min(360.0 - diff)
}

/// Circular mean of a set of degree angles (mod 360°), for standalone testing
/// of the wraparound behaviour independent of [`derive_clustering`].
///
/// Caution for external callers: near-antipodal angle sets (e.g. `[0.0,
/// 180.0]`, cancelling resultant vectors) are directionally undefined and
/// resolve to `atan2(0, 0) == 0.0` — a well-defined float, but not a
/// meaningful "center" of two opposite points. `derive_clustering` never
/// exercises this case because tolerance gates keep every grouped angle set
/// tightly clustered by construction.
///
/// # Panics
/// Never panics; returns `0.0` for an empty iterator (no observations).
#[must_use]
pub fn circular_mean_deg<I: IntoIterator<Item = f64>>(angles: I) -> f64 {
    let (mut sin_sum, mut cos_sum) = (0.0, 0.0);
    for angle in angles {
        let rad = angle.to_radians();
        sin_sum += rad.sin();
        cos_sum += rad.cos();
    }
    normalize_deg_0_360(sin_sum.atan2(cos_sum).to_degrees())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(byte: u8) -> EntityId {
        EntityId::from_uuid(uuid::Uuid::from_bytes([byte; 16]))
    }

    fn geom(
        byte: u8,
        target: u8,
        optic_train: &str,
        ra: f64,
        dec: f64,
        rotation: f32,
        fov: Option<f64>,
    ) -> SessionGeometry {
        SessionGeometry {
            session_id: id(byte),
            target_id: Some(id(target)),
            optic_train_key: Some(optic_train.to_owned()),
            pointing: Some(Pointing { ra_deg: ra, dec_deg: dec }),
            rotation_deg: Some(rotation),
            fov_diagonal_deg: fov,
        }
    }

    fn params() -> ToleranceParams {
        ToleranceParams::defaults()
    }

    fn assignment_for(result: &ClusteringResult, byte: u8) -> &Assignment {
        &result.assignments.iter().find(|(sid, _)| *sid == id(byte)).expect("session present").1
    }

    // ── multi-night/multi-filter collapse ───────────────────────────────────

    #[test]
    fn multi_night_multi_filter_sessions_collapse_into_one_framing() {
        // Same target/optic-train/pointing/rotation across three "nights"
        // (distinct session ids), well within a 2° FOV's 10% tolerance.
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
            geom(2, 10, "scope-a|cam-a", 100.01, 20.01, 0.5, Some(2.0)),
            geom(3, 10, "scope-a|cam-a", 99.99, 19.99, -0.5, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &[], &params());

        assert_eq!(result.new_framings.len(), 1);
        let group_idx = match assignment_for(&result, 1) {
            Assignment::NewFraming(idx) => *idx,
            other => panic!("expected NewFraming, got {other:?}"),
        };
        for byte in [1_u8, 2, 3] {
            assert_eq!(*assignment_for(&result, byte), Assignment::NewFraming(group_idx));
        }
        assert_eq!(result.new_framings[group_idx].session_ids.len(), 3);
    }

    // ── pointing beyond tolerance → split ───────────────────────────────────

    #[test]
    fn pointing_beyond_tolerance_splits_into_distinct_framings() {
        // 2° FOV, 10% tolerance = 0.2°. 1.0° separation is well beyond it.
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
            geom(2, 10, "scope-a|cam-a", 101.0, 20.0, 0.0, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &[], &params());

        assert_eq!(result.new_framings.len(), 2);
        let (a, b) = (assignment_for(&result, 1), assignment_for(&result, 2));
        assert_ne!(a, b);
    }

    // ── user_adjusted protection ─────────────────────────────────────────────

    #[test]
    fn user_adjusted_framing_membership_is_never_modified() {
        let framing_id = id(50);
        let existing = vec![ExistingFraming {
            id: framing_id,
            target_id: Some(id(10)),
            optic_train_key: "scope-a|cam-a".to_owned(),
            clustering: Clustering::UserAdjusted,
            member_session_ids: vec![id(1)],
        }];
        // session 1 is a protected member; session 2 has geometry that would
        // otherwise match session 1's location closely.
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
            geom(2, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &existing, &params());

        assert_eq!(*assignment_for(&result, 1), Assignment::JoinExisting(framing_id));
        // Session 2 must NOT be attributed to the protected framing — it
        // forms its own new suggested group instead.
        assert!(matches!(assignment_for(&result, 2), Assignment::NewFraming(_)));
        assert!(result.new_framings.iter().all(|g| !g.session_ids.contains(&id(1))));
    }

    // ── regression: seeded existing framings must not be displaced ──────────

    #[test]
    fn unrelated_new_session_does_not_displace_or_orphan_seeded_existing_framings() {
        // Reviewer repro: two populated existing framings (B near RA 200,
        // C near RA 50) plus an unrelated new session at RA 125 — roughly
        // equidistant, but far beyond tolerance from both. Before the fix,
        // unseeded accumulators trivially auto-matched whichever session was
        // processed first, letting the RA-125 newcomer "claim" framing B and
        // orphan its real member.
        let framing_b = id(60);
        let framing_c = id(61);
        let existing = vec![
            ExistingFraming {
                id: framing_b,
                target_id: Some(id(10)),
                optic_train_key: "scope-a|cam-a".to_owned(),
                clustering: Clustering::Suggested,
                member_session_ids: vec![id(2)],
            },
            ExistingFraming {
                id: framing_c,
                target_id: Some(id(10)),
                optic_train_key: "scope-a|cam-a".to_owned(),
                clustering: Clustering::Suggested,
                member_session_ids: vec![id(3)],
            },
        ];
        let sessions = vec![
            geom(2, 10, "scope-a|cam-a", 200.0, 20.0, 0.0, Some(2.0)), // framing B's real member
            geom(3, 10, "scope-a|cam-a", 50.0, 20.0, 0.0, Some(2.0)),  // framing C's real member
            geom(1, 10, "scope-a|cam-a", 125.0, 20.0, 0.0, Some(2.0)), // unrelated newcomer
        ];

        let result = derive_clustering(&sessions, &existing, &params());
        assert_eq!(*assignment_for(&result, 2), Assignment::JoinExisting(framing_b));
        assert_eq!(*assignment_for(&result, 3), Assignment::JoinExisting(framing_c));
        assert!(matches!(assignment_for(&result, 1), Assignment::NewFraming(_)));

        // Order independence: same outcome regardless of input session order.
        let shuffled = vec![sessions[2].clone(), sessions[0].clone(), sessions[1].clone()];
        let reshuffled_result = derive_clustering(&shuffled, &existing, &params());
        let mut expected = result.assignments.clone();
        let mut actual = reshuffled_result.assignments.clone();
        expected.sort_by_key(|(session_id, _)| *session_id);
        actual.sort_by_key(|(session_id, _)| *session_id);
        assert_eq!(expected, actual);
        assert_eq!(result.new_framings, reshuffled_result.new_framings);
    }

    // ── NULL-geometry exclusion ──────────────────────────────────────────────

    #[test]
    fn null_geometry_sessions_are_excluded_not_zero_defaulted() {
        let mut missing_pointing = geom(1, 10, "scope-a|cam-a", 0.0, 0.0, 0.0, Some(2.0));
        missing_pointing.pointing = None;
        let mut missing_rotation = geom(2, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0));
        missing_rotation.rotation_deg = None;
        let mut missing_optic_train = geom(3, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0));
        missing_optic_train.optic_train_key = None;
        let mut missing_target = geom(4, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0));
        missing_target.target_id = None;
        let sessions =
            vec![missing_pointing, missing_rotation, missing_optic_train, missing_target];

        let result = derive_clustering(&sessions, &[], &params());

        assert_eq!(
            *assignment_for(&result, 1),
            Assignment::Unassigned(UnassignedReason::MissingPointing)
        );
        assert_eq!(
            *assignment_for(&result, 2),
            Assignment::Unassigned(UnassignedReason::MissingRotation)
        );
        assert_eq!(
            *assignment_for(&result, 3),
            Assignment::Unassigned(UnassignedReason::MissingOpticTrain)
        );
        assert_eq!(
            *assignment_for(&result, 4),
            Assignment::Unassigned(UnassignedReason::MissingTarget)
        );
        assert!(result.new_framings.is_empty());
    }

    // ── circular-mean wraparound at RA 0/360 ─────────────────────────────────

    #[test]
    fn circular_mean_wraps_correctly_across_the_ra_zero_boundary() {
        // Naive arithmetic mean of 359 and 1 is 180 (exactly wrong side of
        // the sky); the circular mean must land near 0.
        let mean = circular_mean_deg([359.0, 1.0]);
        assert!(!(1.0..=359.0).contains(&mean), "expected near-0 wraparound mean, got {mean}");
    }

    #[test]
    fn ra_wraparound_sessions_still_collapse_into_one_framing() {
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 359.9, 20.0, 0.0, Some(2.0)),
            geom(2, 10, "scope-a|cam-a", 0.1, 20.0, 0.0, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &[], &params());
        assert_eq!(result.new_framings.len(), 1);
    }

    // ── dec-pole sanity ───────────────────────────────────────────────────────

    #[test]
    fn angular_separation_near_pole_is_small_despite_large_ra_difference() {
        // At dec=89.9, points 180deg apart in RA are only ~0.2deg apart on
        // the sphere; a naive Euclidean RA/Dec distance would report ~180deg.
        let a = Pointing { ra_deg: 10.0, dec_deg: 89.9 };
        let b = Pointing { ra_deg: 190.0, dec_deg: 89.9 };
        let separation = angular_separation_deg(a, b);
        assert!(separation < 0.3, "expected small polar separation, got {separation}");
    }

    #[test]
    fn near_pole_sessions_collapse_into_one_framing_via_great_circle_distance() {
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 10.0, 89.9, 0.0, Some(2.0)),
            geom(2, 10, "scope-a|cam-a", 190.0, 89.9, 0.0, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &[], &params());
        assert_eq!(result.new_framings.len(), 1);
    }

    // ── rotation tolerance boundary ──────────────────────────────────────────

    #[test]
    fn rotation_exactly_at_tolerance_boundary_joins() {
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
            geom(2, 10, "scope-a|cam-a", 100.0, 20.0, 3.0, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &[], &params());
        assert_eq!(result.new_framings.len(), 1);
    }

    #[test]
    fn rotation_just_beyond_tolerance_boundary_splits() {
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
            geom(2, 10, "scope-a|cam-a", 100.0, 20.0, 3.01, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &[], &params());
        assert_eq!(result.new_framings.len(), 2);
    }

    #[test]
    fn rotation_distance_wraps_at_360_not_180() {
        // 359 and 1 degrees are 2deg apart circularly, not ~358.
        assert!((rotation_circular_distance_deg(359.0, 1.0) - 2.0).abs() < 1e-9);
        // A deliberate ~180deg re-framing must NOT be treated as equivalent.
        assert!((rotation_circular_distance_deg(0.0, 180.0) - 180.0).abs() < 1e-9);
    }

    // ── FOV fallback path ────────────────────────────────────────────────────

    #[test]
    fn no_fov_data_uses_fixed_fallback_tolerance() {
        // No FOV → fixed 0.2deg fallback (not 10% of anything).
        let inside = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, None),
            geom(2, 10, "scope-a|cam-a", 100.15, 20.0, 0.0, None),
        ];
        let result = derive_clustering(&inside, &[], &params());
        assert_eq!(result.new_framings.len(), 1);
        assert!(result.new_framings[0].tolerance_is_fallback);

        let outside = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, None),
            geom(2, 10, "scope-a|cam-a", 100.25, 20.0, 0.0, None),
        ];
        let result = derive_clustering(&outside, &[], &params());
        assert_eq!(result.new_framings.len(), 2);
    }

    #[test]
    fn different_optic_trains_never_share_a_framing() {
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
            geom(2, 10, "scope-b|cam-b", 100.0, 20.0, 0.0, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &[], &params());
        assert_eq!(result.new_framings.len(), 2);
    }

    #[test]
    fn different_targets_never_share_a_framing() {
        let sessions = vec![
            geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
            geom(2, 11, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0)),
        ];
        let result = derive_clustering(&sessions, &[], &params());
        assert_eq!(result.new_framings.len(), 2);
    }

    #[test]
    fn new_session_joins_existing_suggested_framing_within_tolerance() {
        let framing_id = id(50);
        let existing = vec![ExistingFraming {
            id: framing_id,
            target_id: Some(id(10)),
            optic_train_key: "scope-a|cam-a".to_owned(),
            clustering: Clustering::Suggested,
            member_session_ids: vec![],
        }];
        let sessions = vec![geom(1, 10, "scope-a|cam-a", 100.0, 20.0, 0.0, Some(2.0))];
        let result = derive_clustering(&sessions, &existing, &params());
        assert_eq!(*assignment_for(&result, 1), Assignment::JoinExisting(framing_id));
        assert!(result.new_framings.is_empty());
    }
}
