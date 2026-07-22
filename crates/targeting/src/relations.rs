// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure panel, mosaic, lineage, proposal, and object-evidence invariants.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use target_match::{CoverageState, FootprintUnion, ObjectShape, SkyFootprint};

/// Stable logical panel identity and one immutable accepted revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanelGroupRevision {
    pub panel_group_id: String,
    pub revision_id: String,
    pub parent_revision_id: Option<String>,
    pub session_ids: BTreeSet<String>,
    pub representative_session_id: String,
    pub matching_settings_revision: u64,
}

impl PanelGroupRevision {
    /// Create the stable singleton group required for every light session.
    #[must_use]
    pub fn singleton(
        panel_group_id: impl Into<String>,
        revision_id: impl Into<String>,
        session_id: impl Into<String>,
        matching_settings_revision: u64,
    ) -> Self {
        let session_id = session_id.into();
        Self {
            panel_group_id: panel_group_id.into(),
            revision_id: revision_id.into(),
            parent_revision_id: None,
            session_ids: BTreeSet::from([session_id.clone()]),
            representative_session_id: session_id,
            matching_settings_revision,
        }
    }

    /// Validate non-vacuous membership and representative stability.
    ///
    /// # Errors
    ///
    /// Returns an invariant error for empty membership or a representative
    /// outside the immutable membership snapshot.
    pub fn validate(&self) -> Result<(), RelationInvariantError> {
        if self.session_ids.is_empty() {
            return Err(RelationInvariantError::EmptyPanelMembership);
        }
        if !self.session_ids.contains(&self.representative_session_id) {
            return Err(RelationInvariantError::RepresentativeNotMember);
        }
        Ok(())
    }
}

/// Validate current panel heads as one snapshot.
///
/// A session belongs to at most one current group, and no current group may
/// contain both sides of an accepted supersession relation.
///
/// # Errors
///
/// Returns an invariant error for an invalid revision, duplicate current
/// membership, or predecessor/replacement coexistence.
pub fn validate_current_panel_membership(
    revisions: &[PanelGroupRevision],
    supersessions: &[(String, String)],
) -> Result<(), RelationInvariantError> {
    let mut current_members = BTreeSet::new();
    for revision in revisions {
        revision.validate()?;
        for session_id in &revision.session_ids {
            if !current_members.insert(session_id) {
                return Err(RelationInvariantError::DuplicateCurrentPanelMembership);
            }
        }
        if supersessions.iter().any(|(predecessor, successor)| {
            revision.session_ids.contains(predecessor) && revision.session_ids.contains(successor)
        }) {
            return Err(RelationInvariantError::PredecessorAndReplacementCoexist);
        }
    }
    Ok(())
}

/// One exact accepted adjacency edge between panel revisions.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct MosaicEdge {
    pub left_panel_revision_id: String,
    pub right_panel_revision_id: String,
    pub evidence_id: String,
}

impl MosaicEdge {
    #[must_use]
    pub fn new(
        left: impl Into<String>,
        right: impl Into<String>,
        evidence_id: impl Into<String>,
    ) -> Self {
        Self {
            left_panel_revision_id: left.into(),
            right_panel_revision_id: right.into(),
            evidence_id: evidence_id.into(),
        }
    }
}

/// Validate that exact mosaic members are connected by exact accepted edges.
///
/// # Errors
///
/// Returns an invariant error when fewer than two panels are supplied, an edge
/// is self-referential or outside membership, or the accepted graph is not
/// connected.
pub fn validate_mosaic_connectivity(
    panels: &BTreeSet<String>,
    edges: &[MosaicEdge],
) -> Result<(), RelationInvariantError> {
    if panels.len() < 2 {
        return Err(RelationInvariantError::MosaicNeedsTwoPanels);
    }
    let mut adjacency: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for edge in edges {
        let left = edge.left_panel_revision_id.as_str();
        let right = edge.right_panel_revision_id.as_str();
        if left == right || !panels.contains(left) || !panels.contains(right) {
            return Err(RelationInvariantError::InvalidMosaicEdge);
        }
        adjacency.entry(left).or_default().push(right);
        adjacency.entry(right).or_default().push(left);
    }
    let Some(seed) = panels.first().map(String::as_str) else {
        return Err(RelationInvariantError::MosaicNeedsTwoPanels);
    };
    let mut visited = BTreeSet::from([seed]);
    let mut queue = VecDeque::from([seed]);
    while let Some(node) = queue.pop_front() {
        for next in adjacency.get(node).into_iter().flatten().copied() {
            if visited.insert(next) {
                queue.push_back(next);
            }
        }
    }
    if visited.len() != panels.len() {
        return Err(RelationInvariantError::DisconnectedMosaic);
    }
    Ok(())
}

/// Whether a proposed edge connects two already accepted components.
#[must_use]
pub fn edge_bridges_components(left: &str, right: &str, accepted_edges: &[MosaicEdge]) -> bool {
    if left == right {
        return false;
    }
    !reachable(left, right, accepted_edges)
        && accepted_edges
            .iter()
            .any(|edge| edge.left_panel_revision_id == left || edge.right_panel_revision_id == left)
        && accepted_edges.iter().any(|edge| {
            edge.left_panel_revision_id == right || edge.right_panel_revision_id == right
        })
}

/// Detect a bridge when accepted component membership is already known.
#[must_use]
pub fn edge_bridges_accepted_mosaics(
    left: &str,
    right: &str,
    accepted_components: &[BTreeSet<String>],
) -> bool {
    let left_component = accepted_components.iter().position(|component| component.contains(left));
    let right_component =
        accepted_components.iter().position(|component| component.contains(right));
    matches!((left_component, right_component), (Some(left), Some(right)) if left != right)
}

fn reachable(start: &str, destination: &str, edges: &[MosaicEdge]) -> bool {
    let mut visited = BTreeSet::from([start]);
    let mut queue = VecDeque::from([start]);
    while let Some(node) = queue.pop_front() {
        for edge in edges {
            let next = if edge.left_panel_revision_id == node {
                Some(edge.right_panel_revision_id.as_str())
            } else if edge.right_panel_revision_id == node {
                Some(edge.left_panel_revision_id.as_str())
            } else {
                None
            };
            if let Some(next) = next {
                if next == destination {
                    return true;
                }
                if visited.insert(next) {
                    queue.push_back(next);
                }
            }
        }
    }
    false
}

/// Validate a directed lineage snapshot, including proposed edges, is acyclic.
///
/// # Errors
///
/// Returns [`RelationInvariantError::LineageCycle`] for a self-edge or cycle.
pub fn validate_acyclic_lineage(edges: &[(String, String)]) -> Result<(), RelationInvariantError> {
    let mut successors: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut indegree: BTreeMap<&str, usize> = BTreeMap::new();
    for (predecessor, successor) in edges {
        if predecessor == successor {
            return Err(RelationInvariantError::LineageCycle);
        }
        successors.entry(predecessor).or_default().push(successor);
        indegree.entry(predecessor).or_default();
        *indegree.entry(successor).or_default() += 1;
    }
    let mut queue: VecDeque<&str> =
        indegree.iter().filter_map(|(node, degree)| (*degree == 0).then_some(*node)).collect();
    let mut visited = 0;
    while let Some(node) = queue.pop_front() {
        visited += 1;
        for successor in successors.get(node).into_iter().flatten().copied() {
            if let Some(degree) = indegree.get_mut(successor) {
                *degree -= 1;
                if *degree == 0 {
                    queue.push_back(successor);
                }
            }
        }
    }
    if visited != indegree.len() {
        return Err(RelationInvariantError::LineageCycle);
    }
    Ok(())
}

/// Kinds accepted by explicit manual relation review.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelationKind {
    PanelAdd,
    PanelReplace,
    PanelSplit,
    PanelMerge,
    MosaicCreate,
    MosaicEdge,
    MosaicSplit,
    MosaicMerge,
}

/// Target scope reviewed with a manual relation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TargetScope {
    SameTarget { canonical_target_id: String },
    ExistingCrossTarget { association_id: String },
    NewReviewedCrossTarget { canonical_target_ids: BTreeSet<String> },
}

/// Pure shape of a manual relation proposal before persistence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManualRelation {
    pub kind: RelationKind,
    pub review_reason: String,
    pub target_scope: TargetScope,
    pub source_revision_ids: BTreeSet<String>,
    pub subject_ids: BTreeSet<String>,
    pub membership_ids: BTreeSet<String>,
    pub edges: Vec<MosaicEdge>,
    pub lineage: Vec<(String, String)>,
    pub missing_evidence_codes: BTreeSet<String>,
}

impl ManualRelation {
    /// Enforce the non-vacuous and kind-specific contract before persistence.
    ///
    /// # Errors
    ///
    /// Returns an invariant error when inputs or outputs are empty, target
    /// scope is invalid, or the kind-specific membership/topology shape fails.
    pub fn validate(&self) -> Result<(), RelationInvariantError> {
        if self.review_reason.trim().is_empty() {
            return Err(RelationInvariantError::MissingReviewReason);
        }
        if self.source_revision_ids.is_empty() || self.subject_ids.is_empty() {
            return Err(RelationInvariantError::EmptyProposalInputs);
        }
        if self.membership_ids.is_empty() && self.edges.is_empty() && self.lineage.is_empty() {
            return Err(RelationInvariantError::RelationFreeProposal);
        }
        if let TargetScope::NewReviewedCrossTarget { canonical_target_ids } = &self.target_scope {
            if canonical_target_ids.len() < 2 {
                return Err(RelationInvariantError::CrossTargetNeedsTwoTargets);
            }
        }
        match self.kind {
            RelationKind::PanelAdd | RelationKind::PanelReplace => {
                if self.source_revision_ids.len() != 1 || self.membership_ids.is_empty() {
                    return Err(RelationInvariantError::KindShapeMismatch);
                }
            }
            RelationKind::PanelSplit | RelationKind::PanelMerge => {
                if self.membership_ids.is_empty() || self.lineage.is_empty() {
                    return Err(RelationInvariantError::KindShapeMismatch);
                }
            }
            RelationKind::MosaicCreate => {
                validate_mosaic_connectivity(&self.membership_ids, &self.edges)?;
            }
            RelationKind::MosaicEdge => {
                if self.subject_ids.len() != 2 || self.edges.len() != 1 {
                    return Err(RelationInvariantError::KindShapeMismatch);
                }
            }
            RelationKind::MosaicSplit | RelationKind::MosaicMerge => {
                if self.membership_ids.is_empty()
                    || self.edges.is_empty()
                    || self.lineage.is_empty()
                {
                    return Err(RelationInvariantError::KindShapeMismatch);
                }
                validate_mosaic_connectivity(&self.membership_ids, &self.edges)?;
            }
        }
        validate_acyclic_lineage(&self.lineage)
    }
}

/// Complete fingerprint that suppresses only equivalent automatic proposals.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct RejectionFingerprint {
    pub basis_fingerprint: String,
    pub evidence_revision: String,
    pub matching_settings_revision: u64,
}

/// In-memory domain model of remembered rejection semantics.
#[derive(Debug, Default)]
pub struct RememberedRejections(BTreeSet<RejectionFingerprint>);

impl RememberedRejections {
    pub fn remember(&mut self, fingerprint: RejectionFingerprint) {
        self.0.insert(fingerprint);
    }

    #[must_use]
    pub fn suppresses(&self, fingerprint: &RejectionFingerprint) -> bool {
        self.0.contains(fingerprint)
    }
}

/// Contract-facing object coverage retained for a captured mosaic union.
#[derive(Debug, Clone, PartialEq)]
pub struct MosaicObjectEvidence {
    pub state: MosaicObjectCoverage,
    pub covered_fraction: Option<f64>,
    pub panel_evidence_ids: BTreeSet<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MosaicObjectCoverage {
    Full,
    Partial,
}

/// Measure one object and exclude zero-coverage results, including gap points.
///
/// # Errors
///
/// Returns the upstream typed geometry error when the object cannot be
/// projected or measured against the union's persisted anchor.
pub fn measure_mosaic_object(
    union: &FootprintUnion,
    object: ObjectShape<'_>,
) -> target_match::Result<Option<MosaicObjectEvidence>> {
    let evidence = union.measure_object(object)?;
    if evidence.state == CoverageState::None {
        return Ok(None);
    }
    let panel_evidence_ids = if let Some(point) = evidence.point {
        point
            .panels
            .into_iter()
            .filter(|panel| panel.containment.is_covered())
            .map(|panel| panel.provenance.as_str().to_owned())
            .collect()
    } else {
        evidence.panels.into_iter().map(|panel| panel.provenance.as_str().to_owned()).collect()
    };
    Ok(Some(MosaicObjectEvidence {
        state: match evidence.state {
            CoverageState::Partial => MosaicObjectCoverage::Partial,
            CoverageState::Full => MosaicObjectCoverage::Full,
            CoverageState::None => unreachable!("zero coverage returned early"),
        },
        covered_fraction: evidence.covered_fraction,
        panel_evidence_ids,
    }))
}

/// Build the captured union once for an exact mosaic revision.
///
/// # Errors
///
/// Returns the upstream typed geometry error for an empty set, duplicate
/// provenance, incompatible epochs, projection failure, or invalid geometry.
pub fn captured_union(footprints: &[SkyFootprint]) -> target_match::Result<FootprintUnion> {
    FootprintUnion::new(footprints)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelationInvariantError {
    EmptyPanelMembership,
    RepresentativeNotMember,
    MosaicNeedsTwoPanels,
    InvalidMosaicEdge,
    DisconnectedMosaic,
    LineageCycle,
    MissingReviewReason,
    EmptyProposalInputs,
    RelationFreeProposal,
    CrossTargetNeedsTwoTargets,
    KindShapeMismatch,
    DuplicateCurrentPanelMembership,
    PredecessorAndReplacementCoexist,
}

impl std::fmt::Display for RelationInvariantError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for RelationInvariantError {}

#[cfg(test)]
mod tests {
    use super::*;
    use skymath::{Angle, Equatorial};
    use target_match::{FootprintProvenance, ImageParity};

    fn edge(left: &str, right: &str) -> MosaicEdge {
        MosaicEdge::new(left, right, format!("{left}-{right}"))
    }

    fn coordinate(ra: f64, dec: f64) -> Equatorial {
        Equatorial::j2000(Angle::from_degrees(ra), Angle::from_degrees(dec))
            .expect("valid coordinate")
    }

    fn square(centre_ra: f64, provenance: &str) -> SkyFootprint {
        SkyFootprint::new(
            coordinate(centre_ra, 0.0),
            vec![
                coordinate(centre_ra - 0.5, -0.5),
                coordinate(centre_ra + 0.5, -0.5),
                coordinate(centre_ra + 0.5, 0.5),
                coordinate(centre_ra - 0.5, 0.5),
            ],
            Angle::from_degrees(0.0),
            ImageParity::Direct,
            FootprintProvenance::new(provenance).expect("valid provenance"),
        )
        .expect("valid footprint")
    }

    #[test]
    fn singleton_panel_is_valid_and_stable() {
        let group = PanelGroupRevision::singleton("panel", "r1", "session", 7);
        assert_eq!(group.representative_session_id, "session");
        assert_eq!(group.matching_settings_revision, 7);
        assert_eq!(group.validate(), Ok(()));
    }

    #[test]
    fn current_panel_membership_excludes_duplicates_and_replacements() {
        let first = PanelGroupRevision::singleton("p1", "r1", "old", 1);
        let duplicate = PanelGroupRevision::singleton("p2", "r2", "old", 1);
        assert_eq!(
            validate_current_panel_membership(&[first.clone(), duplicate], &[]),
            Err(RelationInvariantError::DuplicateCurrentPanelMembership)
        );

        let mut coexist = first;
        coexist.session_ids.insert("new".into());
        assert_eq!(
            validate_current_panel_membership(&[coexist], &[("old".into(), "new".into())]),
            Err(RelationInvariantError::PredecessorAndReplacementCoexist)
        );
    }

    #[test]
    fn mosaic_requires_connected_exact_members() {
        let panels = BTreeSet::from(["a".into(), "b".into(), "c".into()]);
        assert_eq!(
            validate_mosaic_connectivity(&panels, &[edge("a", "b")]),
            Err(RelationInvariantError::DisconnectedMosaic)
        );
        assert_eq!(
            validate_mosaic_connectivity(&panels, &[edge("a", "b"), edge("b", "c")]),
            Ok(())
        );
    }

    #[test]
    fn bridge_between_accepted_components_requires_merge_review() {
        let accepted = [edge("a", "b"), edge("c", "d")];
        assert!(edge_bridges_components("b", "c", &accepted));
        assert!(!edge_bridges_components("a", "b", &accepted));
        let components =
            [BTreeSet::from(["singleton".into()]), BTreeSet::from(["a".into(), "b".into()])];
        assert!(edge_bridges_accepted_mosaics("singleton", "a", &components));
    }

    #[test]
    fn lineage_cycle_is_rejected() {
        let edges = vec![("a".into(), "b".into()), ("b".into(), "a".into())];
        assert_eq!(validate_acyclic_lineage(&edges), Err(RelationInvariantError::LineageCycle));
    }

    #[test]
    fn remembered_rejection_changes_with_material_evidence() {
        let old = RejectionFingerprint {
            basis_fingerprint: "basis".into(),
            evidence_revision: "e1".into(),
            matching_settings_revision: 1,
        };
        let changed = RejectionFingerprint { evidence_revision: "e2".into(), ..old.clone() };
        let mut remembered = RememberedRejections::default();
        remembered.remember(old.clone());
        assert!(remembered.suppresses(&old));
        assert!(!remembered.suppresses(&changed));
    }

    #[test]
    fn manual_relation_cannot_be_vacuous() {
        let relation = ManualRelation {
            kind: RelationKind::PanelAdd,
            review_reason: "geometry unavailable".into(),
            target_scope: TargetScope::SameTarget { canonical_target_id: "target".into() },
            source_revision_ids: BTreeSet::from(["r1".into()]),
            subject_ids: BTreeSet::from(["s1".into()]),
            membership_ids: BTreeSet::new(),
            edges: Vec::new(),
            lineage: Vec::new(),
            missing_evidence_codes: BTreeSet::from(["footprint_missing".into()]),
        };
        assert_eq!(relation.validate(), Err(RelationInvariantError::RelationFreeProposal));
    }

    #[test]
    fn point_in_uncaptured_gap_is_excluded() {
        let union = captured_union(&[square(8.0, "left"), square(12.0, "right")])
            .expect("valid disconnected union");
        assert_eq!(union.component_count(), 2);
        assert_eq!(
            measure_mosaic_object(&union, ObjectShape::Point(coordinate(10.0, 0.0)))
                .expect("coverage measurement"),
            None
        );
        let captured = measure_mosaic_object(&union, ObjectShape::Point(coordinate(8.0, 0.0)))
            .expect("coverage measurement")
            .expect("captured point");
        assert_eq!(captured.state, MosaicObjectCoverage::Full);
        assert_eq!(captured.panel_evidence_ids, BTreeSet::from(["left".into()]));
    }

    #[test]
    fn forward_only_lineage_is_acyclic_across_sampled_sizes() {
        for node_count in 1_usize..128 {
            let edges: Vec<(String, String)> = (0..node_count.saturating_sub(1))
                .map(|index| (format!("n{index}"), format!("n{}", index + 1)))
                .collect();
            assert_eq!(validate_acyclic_lineage(&edges), Ok(()));
        }
    }
}
