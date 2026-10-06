// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Pure View selection semantics (spec 066, research R10, R12, R13, R19, R20
//! and R24): candidate evaluation and preselection, browsing filters, sorting
//! and paging, membership summaries and refresh differences. Everything here
//! reads one catalog snapshot the caller passes in; nothing does I/O, writes,
//! hashes or measures. Unknown evidence stays unknown: it never reads as a
//! zero distance, a zero overlap or a match.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use uuid::Uuid;

use crate::view_geometry::{frame_geometry, session_geometry};
use crate::{
    Association, AssociationKind, AssociationState, Availability, CandidateBasis, CandidateFilters,
    CandidatePage, CandidateQuery, CandidateRow, CandidateSession, CandidateSortKey,
    ChannelSummary, ChoiceBasis, Equipment, ExclusionCount, ExclusionReason, ExpectedSession,
    FrameEvidence, FramingSource, GeometryClass, GeometryEvidence, MemberBasis, MemberState,
    MembershipBasis, MembershipSummary, Microseconds, QualityCount, QualityState, RefreshItem,
    RefreshItemKind, SelectionReason, SessionChoice, SessionChoiceState, SessionSummary,
    SortDirection, SuggestionState, UnresolvedAction, UnresolvedSource, ViewCriteria,
};

/// A candidate session paired with its geometry against the criteria.
#[derive(Clone, Debug)]
pub struct CandidateEvaluation<'a> {
    pub session: &'a CandidateSession,
    pub geometry: GeometryEvidence,
    pub suggestion: SuggestionState,
}

impl CandidateEvaluation<'_> {
    #[must_use]
    pub const fn session_id(&self) -> Uuid {
        self.session.summary.session.id
    }

    /// The geometry matches a framing element and the session qualifies for
    /// preselection under `criteria` (R10). Refresh uses the same rule for
    /// additions and removals.
    #[must_use]
    pub fn meets(&self, criteria: &ViewCriteria) -> bool {
        self.geometry.matched.is_some()
            && light_session(self.session)
            && qualifies(self.session, criteria)
    }
}

fn count(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

fn association(session: &CandidateSession, kind: AssociationKind) -> Option<&Association> {
    session.associations.iter().find(|association| association.kind == kind)
}

/// A light session; sessions of unknown image type are never suggested (R20).
fn light_session(session: &CandidateSession) -> bool {
    session.captures.iter().any(|capture| capture.frame.light == Some(true))
}

/// A Project framing and a Confirmed equipment association with an equipment
/// id of the Project snapshot (R10).
fn qualifies(session: &CandidateSession, criteria: &ViewCriteria) -> bool {
    criteria.framing.source == FramingSource::Project
        && association(session, AssociationKind::Equipment).is_some_and(|association| {
            association.state == AssociationState::Confirmed
                && association.subject_id.is_some_and(|id| criteria.equipment_ids.contains(&id))
        })
}

/// The equipment record of the session's Confirmed equipment association: the
/// field-of-view fallback of R6.
fn confirmed_equipment<'e>(
    session: &CandidateSession,
    equipment: &'e [Equipment],
) -> Option<&'e Equipment> {
    let association = association(session, AssociationKind::Equipment)
        .filter(|association| association.state == AssociationState::Confirmed)?;
    let id = association.subject_id?;
    equipment.iter().find(|record| record.id == id)
}

/// Geometry and suggestion state of every candidate, in basis order.
#[must_use]
pub fn evaluate_candidates<'a>(
    basis: &'a CandidateBasis,
    criteria: &ViewCriteria,
) -> Vec<CandidateEvaluation<'a>> {
    basis
        .sessions
        .iter()
        .map(|session| {
            let equipment = confirmed_equipment(session, &basis.equipment);
            let frames: Vec<_> = session
                .captures
                .iter()
                .map(|capture| frame_geometry(&capture.frame, equipment))
                .collect();
            let geometry = session_geometry(&frames, criteria);
            let light = light_session(session);
            let suggestion = if light && geometry.matched.is_some() {
                if qualifies(session, criteria) {
                    SuggestionState::Preselectable
                } else {
                    SuggestionState::Suggested
                }
            } else if light
                && geometry.class == GeometryClass::PointingOnly
                && geometry.within_radius
            {
                SuggestionState::PointingOnly
            } else {
                SuggestionState::None
            };
            CandidateEvaluation { session, geometry, suggestion }
        })
        .collect()
}

/// The geometry suggestions a Project-origin View starts with: footprint
/// matches with a Confirmed association to Project-snapshot equipment, each
/// recording the evidence that qualified it. Any other framing preselects
/// nothing (R10, VSEL-AC-14).
#[must_use]
pub fn preselect(
    evaluations: &[CandidateEvaluation<'_>],
    criteria: &ViewCriteria,
) -> Vec<SessionChoice> {
    if criteria.framing.source != FramingSource::Project {
        return Vec::new();
    }
    evaluations
        .iter()
        .filter(|evaluation| evaluation.meets(criteria))
        .map(|evaluation| SessionChoice {
            session_id: evaluation.session_id(),
            grouping_revision: evaluation.session.summary.session.grouping_revision,
            state: SessionChoiceState::Selected,
            reason: SelectionReason::GeometrySuggestion,
            evidence: Some(evaluation.geometry.clone()),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Rows, filters, sorting and paging
// ---------------------------------------------------------------------------

/// Session values every filter and sort reads, computed once per candidate.
struct Facts<'a> {
    index: usize,
    session: &'a CandidateSession,
    date: Option<&'a str>,
    night: Option<&'a str>,
    channel: Option<&'a str>,
    exposure: Option<f64>,
    camera: Option<&'a str>,
    telescope: Option<&'a str>,
    frames: u64,
    unknown_image_type: u64,
    unknown_exposure: u64,
    integration: Microseconds,
}

/// Frames of light or unknown image type: the ones a candidate is about.
fn candidate_frames(session: &CandidateSession) -> impl Iterator<Item = &FrameEvidence> {
    session.captures.iter().map(|capture| &capture.frame).filter(|frame| frame.light != Some(false))
}

/// The value every frame shares, or `None` when one lacks it or they differ.
fn uniform<T: PartialEq + Copy>(values: impl Iterator<Item = Option<T>>) -> Option<T> {
    let mut shared = None;
    for value in values {
        let value = value?;
        match shared {
            None => shared = Some(value),
            Some(seen) if seen == value => {}
            Some(_) => return None,
        }
    }
    shared
}

/// The observing night from the session key component `night=YYYY-MM-DD@basis`.
fn night(session: &CandidateSession) -> Option<&str> {
    let night =
        session.summary.session.key.0.split('|').find_map(|part| part.strip_prefix("night="))?;
    Some(night.split_once('@').map_or(night, |(date, _)| date))
}

fn facts(index: usize, session: &CandidateSession) -> Facts<'_> {
    let mut frames = 0;
    let mut unknown_image_type = 0;
    let mut unknown_exposure = 0;
    let mut integration = Microseconds::default();
    for frame in candidate_frames(session) {
        if frame.light.is_none() {
            unknown_image_type += 1;
            continue;
        }
        frames += 1;
        match frame.exposure_seconds.and_then(Microseconds::from_seconds) {
            Some(exposure) => integration = integration.saturating_add(exposure),
            None => unknown_exposure += 1,
        }
    }
    Facts {
        index,
        session,
        date: candidate_frames(session)
            .filter_map(|frame| frame.date_obs.as_deref().or(frame.date_local.as_deref()))
            .min(),
        night: night(session),
        channel: uniform(candidate_frames(session).map(|frame| frame.filter.as_deref())),
        exposure: uniform(candidate_frames(session).map(|frame| frame.exposure_seconds)),
        camera: uniform(candidate_frames(session).map(|frame| frame.camera.as_deref())),
        telescope: uniform(candidate_frames(session).map(|frame| frame.telescope.as_deref())),
        frames,
        unknown_image_type,
        unknown_exposure,
        integration,
    }
}

fn bounded<T: PartialOrd + Copy>(value: T, min: Option<T>, max: Option<T>) -> bool {
    min.is_none_or(|min| value >= min) && max.is_none_or(|max| value <= max)
}

/// No bounds, or a known value inside them.
fn within<T: PartialOrd + Copy>(value: Option<T>, min: Option<T>, max: Option<T>) -> bool {
    (min.is_none() && max.is_none()) || value.is_some_and(|value| bounded(value, min, max))
}

/// No bounds, or every candidate frame has a known value inside them.
fn every_frame<T: PartialOrd + Copy>(
    session: &CandidateSession,
    value: impl Fn(&FrameEvidence) -> Option<T>,
    min: Option<T>,
    max: Option<T>,
) -> bool {
    if min.is_none() && max.is_none() {
        return true;
    }
    let mut frames = candidate_frames(session).peekable();
    frames.peek().is_some()
        && frames.all(|frame| value(frame).is_some_and(|value| bounded(value, min, max)))
}

/// A date or date-time text against `from` and `to` prefixes: `to` compares
/// the date truncated to its own length, so a date bound includes its day.
fn date_within(date: Option<&str>, from: Option<&str>, to: Option<&str>) -> bool {
    if from.is_none() && to.is_none() {
        return true;
    }
    date.is_some_and(|date| {
        from.is_none_or(|from| date >= from)
            && to.is_none_or(|to| date.get(..to.len()).unwrap_or(date) <= to)
    })
}

fn listed<T: PartialEq>(allowed: &[T], value: Option<&T>) -> bool {
    allowed.is_empty() || value.is_some_and(|value| allowed.contains(value))
}

fn associated(session: &CandidateSession, kind: AssociationKind, allowed: &[Uuid]) -> bool {
    allowed.is_empty()
        || session.associations.iter().any(|association| {
            association.kind == kind
                && association.subject_id.is_some_and(|id| allowed.contains(&id))
        })
}

fn frame_binning(frame: &FrameEvidence) -> Option<u32> {
    frame.binning_x.filter(|x| frame.binning_y.is_none_or(|y| y == *x))
}

/// Date, night, channel, exposure, camera, quality, location and availability.
fn matches_session(facts: &Facts<'_>, filters: &CandidateFilters) -> bool {
    let session = facts.session;
    date_within(facts.date, filters.date_from.as_deref(), filters.date_to.as_deref())
        && filters.night.as_deref().is_none_or(|night| facts.night == Some(night))
        && (filters.channels.is_empty()
            || facts.channel.is_some_and(|channel| filters.channels.iter().any(|c| c == channel)))
        && within(facts.exposure, filters.exposure_min, filters.exposure_max)
        && (filters.cameras.is_empty()
            || facts.camera.is_some_and(|camera| filters.cameras.iter().any(|c| c == camera)))
        && (filters.quality_states.is_empty()
            || session.captures.iter().any(|capture| {
                filters.quality_states.contains(&QualityState::of(&capture.quality))
            }))
        && (filters.location_ids.is_empty()
            || session.summary.location_ids.iter().any(|id| filters.location_ids.contains(id)))
        && listed(&filters.availability, Some(&session.summary.availability))
}

/// Associations, OBJECT text and the per-frame header ranges.
fn matches_frames(session: &CandidateSession, filters: &CandidateFilters) -> bool {
    let object_text = filters.object_text.as_deref().map(str::to_lowercase);
    associated(session, AssociationKind::Equipment, &filters.equipment_ids)
        && associated(session, AssociationKind::Target, &filters.target_ids)
        && object_text.is_none_or(|text| {
            candidate_frames(session).any(|frame| {
                frame.object.as_deref().is_some_and(|object| object.to_lowercase().contains(&text))
            })
        })
        && (!filters.missing_object
            || candidate_frames(session)
                .any(|frame| frame.object.as_deref().is_none_or(|object| object.trim().is_empty())))
        && every_frame(session, |frame| frame.gain, filters.gain_min, filters.gain_max)
        && every_frame(session, |frame| frame.offset, filters.offset_min, filters.offset_max)
        && every_frame(
            session,
            |frame| frame.set_temperature_c,
            filters.set_temperature_min,
            filters.set_temperature_max,
        )
        && (filters.binning.is_empty()
            || candidate_frames(session)
                .all(|frame| listed(&filters.binning, frame_binning(frame).as_ref())))
}

fn matches(facts: &Facts<'_>, filters: &CandidateFilters) -> bool {
    matches_session(facts, filters) && matches_frames(facts.session, filters)
}

/// The sessions matching `filters`, in candidate order: what Select matching chooses.
#[must_use]
pub fn matching_sessions(
    evaluations: &[CandidateEvaluation<'_>],
    filters: &CandidateFilters,
) -> Vec<ExpectedSession> {
    evaluations
        .iter()
        .enumerate()
        .filter(|(index, evaluation)| matches(&facts(*index, evaluation.session), filters))
        .map(|(_, evaluation)| evaluation.session.expected())
        .collect()
}

const fn availability_rank(availability: Availability) -> u8 {
    match availability {
        Availability::Available => 0,
        Availability::Offline => 1,
        Availability::Missing => 2,
        Availability::Unreadable => 3,
        Availability::IdentityConflict => 4,
        Availability::Retired => 5,
    }
}

/// Known values in `direction`; a row without the value comes last either way.
fn ordered<T>(
    left: Option<T>,
    right: Option<T>,
    direction: SortDirection,
    compare: impl Fn(&T, &T) -> Ordering,
) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => match direction {
            SortDirection::Asc => compare(&left, &right),
            SortDirection::Desc => compare(&right, &left),
        },
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn compare_rows(
    left: &Facts<'_>,
    right: &Facts<'_>,
    key: CandidateSortKey,
    direction: SortDirection,
    evaluations: &[CandidateEvaluation<'_>],
) -> Ordering {
    let geometry = |facts: &Facts<'_>| &evaluations[facts.index].geometry;
    match key {
        CandidateSortKey::Date => ordered(left.date, right.date, direction, Ord::cmp),
        CandidateSortKey::Night => ordered(left.night, right.night, direction, Ord::cmp),
        CandidateSortKey::Channel => ordered(left.channel, right.channel, direction, Ord::cmp),
        CandidateSortKey::Exposure => {
            ordered(left.exposure, right.exposure, direction, f64::total_cmp)
        }
        CandidateSortKey::Camera => ordered(left.camera, right.camera, direction, Ord::cmp),
        CandidateSortKey::Frames => {
            ordered(Some(left.frames), Some(right.frames), direction, Ord::cmp)
        }
        CandidateSortKey::Integration => {
            ordered(Some(left.integration), Some(right.integration), direction, Ord::cmp)
        }
        CandidateSortKey::Availability => ordered(
            Some(availability_rank(left.session.summary.availability)),
            Some(availability_rank(right.session.summary.availability)),
            direction,
            Ord::cmp,
        ),
        CandidateSortKey::SkyDistance => ordered(
            geometry(left).distance_deg,
            geometry(right).distance_deg,
            direction,
            f64::total_cmp,
        ),
        CandidateSortKey::Overlap => {
            ordered(geometry(left).coverage, geometry(right).coverage, direction, f64::total_cmp)
        }
        CandidateSortKey::Unsupported => Ordering::Equal,
    }
}

fn quality_counts(session: &CandidateSession) -> Vec<QualityCount> {
    let mut counts: BTreeMap<QualityState, u64> = BTreeMap::new();
    for capture in &session.captures {
        *counts.entry(QualityState::of(&capture.quality)).or_default() += 1;
    }
    counts.into_iter().map(|(state, count)| QualityCount { state, count }).collect()
}

fn row(
    facts: &Facts<'_>,
    evaluation: &CandidateEvaluation<'_>,
    selection: Option<&SessionChoice>,
) -> CandidateRow {
    let session = evaluation.session;
    CandidateRow {
        session: session.summary.clone(),
        date: facts.date.map(str::to_owned),
        night: facts.night.map(str::to_owned),
        channel: facts.channel.map(str::to_owned),
        exposure_seconds: facts.exposure,
        camera: facts.camera.map(str::to_owned),
        telescope: facts.telescope.map(str::to_owned),
        equipment: association(session, AssociationKind::Equipment).cloned(),
        frames: facts.frames,
        captures: count(session.captures.len()),
        unknown_image_type_count: facts.unknown_image_type,
        unknown_exposure_count: facts.unknown_exposure,
        integration: facts.integration,
        quality_counts: quality_counts(session),
        geometry: evaluation.geometry.clone(),
        suggestion: evaluation.suggestion,
        selection: selection.cloned(),
        measurements: None,
    }
}

/// One page of candidates: the filtered rows (or, with `selectedOnly`, the
/// selected ones whatever the filters), sorted with rows lacking the sorted
/// evidence last and ties by session id, then paged. `matchCount` counts every
/// filter match; `selectedOutsideFilters` counts selected sessions the filters
/// hide. Nothing here changes `selection` (FR-06, R20).
#[must_use]
pub fn page_candidates(
    evaluations: &[CandidateEvaluation<'_>],
    query: &CandidateQuery,
    selection: &[SessionChoice],
) -> CandidatePage {
    let choices: HashMap<Uuid, &SessionChoice> =
        selection.iter().map(|choice| (choice.session_id, choice)).collect();
    let selected: HashSet<Uuid> = selection
        .iter()
        .filter(|choice| choice.state == SessionChoiceState::Selected)
        .map(|choice| choice.session_id)
        .collect();
    let all: Vec<(Facts<'_>, bool)> = evaluations
        .iter()
        .enumerate()
        .map(|(index, evaluation)| {
            let facts = facts(index, evaluation.session);
            let matched = matches(&facts, &query.filters);
            (facts, matched)
        })
        .collect();
    let matched: HashSet<Uuid> = all
        .iter()
        .filter(|(_, matched)| *matched)
        .map(|(facts, _)| facts.session.summary.session.id)
        .collect();
    let mut listed: Vec<&Facts<'_>> = all
        .iter()
        .filter(|(facts, matched)| {
            if query.selected_only {
                selected.contains(&facts.session.summary.session.id)
            } else {
                *matched
            }
        })
        .map(|(facts, _)| facts)
        .collect();
    let (key, direction) =
        query.sort.map_or((CandidateSortKey::Unsupported, SortDirection::Asc), |sort| {
            (sort.key, sort.direction)
        });
    listed.sort_by(|left, right| {
        compare_rows(left, right, key, direction, evaluations)
            .then_with(|| left.session.summary.session.id.cmp(&right.session.summary.session.id))
    });
    let offset = usize::try_from(query.offset).unwrap_or(usize::MAX);
    let limit = usize::try_from(query.limit).unwrap_or(usize::MAX);
    let rows = listed
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|facts| {
            let evaluation = &evaluations[facts.index];
            row(facts, evaluation, choices.get(&evaluation.session_id()).copied())
        })
        .collect();
    CandidatePage {
        rows,
        match_count: count(matched.len()),
        selected_count: count(selected.len()),
        selected_outside_filters: count(selected.difference(&matched).count()),
    }
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

#[derive(Default)]
struct ChannelTally {
    summary: ChannelSummary,
    excluded: BTreeMap<ExclusionReason, u64>,
}

impl ChannelTally {
    fn count(&mut self, member: &MemberBasis) {
        let row = &mut self.summary;
        if member.member.state == MemberState::Excluded {
            *self.excluded.entry(ExclusionReason::of(&member.member.reason)).or_default() += 1;
            return;
        }
        if member.frame.light.is_none() {
            row.unknown_image_type_count += 1;
            return;
        }
        row.included_frames += 1;
        match member.frame.exposure_seconds.and_then(Microseconds::from_seconds) {
            Some(exposure) => row.included_seconds = row.included_seconds.saturating_add(exposure),
            None => row.unknown_exposure_count += 1,
        }
        match QualityState::of(&member.quality) {
            QualityState::Unreviewed => row.unreviewed_frames += 1,
            QualityState::Usable => row.usable_frames += 1,
            _ => {}
        }
    }

    fn finish(self) -> ChannelSummary {
        let mut summary = self.summary;
        summary.excluded = self
            .excluded
            .into_iter()
            .map(|(reason, count)| ExclusionCount { reason, count })
            .collect();
        summary
    }
}

/// Reconnect an offline or unreadable location, locate a copy, or remove the
/// member; a retired location cannot be reconnected (R15).
fn unresolved_actions(availability: Availability) -> Vec<UnresolvedAction> {
    match availability {
        Availability::Retired => vec![UnresolvedAction::Locate, UnresolvedAction::Remove],
        _ => vec![UnresolvedAction::Reconnect, UnresolvedAction::Locate, UnresolvedAction::Remove],
    }
}

/// Name an unresolved member under its session and the location and
/// availability of each of its copies, none of them Available, so every
/// location's actions are offered (R15). The capture's last-observed frame and
/// seconds count once, under its member-key copy, else its first copy; they are
/// never verified counts.
fn add_unresolved(
    sources: &mut BTreeMap<(Uuid, Uuid, u8), UnresolvedSource>,
    member: &MemberBasis,
) {
    let key = member.member.member_key;
    let counted = member.copies.iter().position(|copy| copy.asset_id == key).unwrap_or(0);
    let session_id = member.member.session_id;
    for (index, copy) in member.copies.iter().enumerate() {
        let source = sources
            .entry((session_id, copy.location_id, availability_rank(copy.availability)))
            .or_insert_with(|| UnresolvedSource {
                session_id,
                location_id: copy.location_id,
                location_name: copy.location_name.clone(),
                availability: copy.availability,
                failure_reason: copy.failure_reason.clone(),
                member_keys: Vec::new(),
                paths: Vec::new(),
                last_observed_frames: 0,
                last_observed_seconds: Microseconds::default(),
                verified: false,
                actions: unresolved_actions(copy.availability),
            });
        // This member's copies are added together, so a second copy in the
        // same source finds its key last.
        if source.member_keys.last() != Some(&key) {
            source.member_keys.push(key);
        }
        source.paths.push(copy.path.clone());
        if index == counted {
            source.last_observed_frames += 1;
            if let Some(exposure) =
                member.frame.exposure_seconds.and_then(Microseconds::from_seconds)
            {
                source.last_observed_seconds =
                    source.last_observed_seconds.saturating_add(exposure);
            }
        }
    }
}

/// The summary of one membership (R19): included light frames and integer
/// microseconds per exact FILTER, each logical capture once; unknown FILTER as
/// its own row; unknown exposure and unknown image type counted, never zero;
/// excluded counts by reason. Included members that are unresolved or changed
/// since review leave the totals and are listed instead (R15, R16).
#[must_use]
pub fn summarize(basis: &MembershipBasis) -> MembershipSummary {
    let mut channels: BTreeMap<Option<&str>, ChannelTally> = BTreeMap::new();
    let mut unresolved = BTreeMap::new();
    let mut changed_since_review = Vec::new();
    for member in &basis.members {
        let included = member.member.state == MemberState::Included;
        if included && (member.unresolved || member.changed_since_review) {
            if member.unresolved {
                add_unresolved(&mut unresolved, member);
            }
            if member.changed_since_review {
                changed_since_review.push(member.member.member_key);
            }
            continue;
        }
        if member.frame.light == Some(false) {
            continue;
        }
        let channel = member.frame.filter.as_deref();
        channels
            .entry(channel)
            .or_insert_with(|| ChannelTally {
                summary: ChannelSummary {
                    channel: channel.map(str::to_owned),
                    ..ChannelSummary::default()
                },
                excluded: BTreeMap::new(),
            })
            .count(member);
    }
    let unknown_channel = channels.remove(&None).map(ChannelTally::finish);
    let channels: Vec<ChannelSummary> = channels.into_values().map(ChannelTally::finish).collect();
    let rows = || channels.iter().chain(unknown_channel.as_ref());
    let included_frames = rows().map(|row| row.included_frames).sum();
    let included_seconds = rows()
        .map(|row| row.included_seconds)
        .fold(Microseconds::default(), Microseconds::saturating_add);
    changed_since_review.sort_unstable();
    MembershipSummary {
        channels,
        unknown_channel,
        included_frames,
        included_seconds,
        unresolved: unresolved.into_values().collect(),
        changed_since_review,
    }
}

// ---------------------------------------------------------------------------
// Refresh differences
// ---------------------------------------------------------------------------

const fn kind_rank(kind: RefreshItemKind) -> u8 {
    match kind {
        RefreshItemKind::AddedSession => 0,
        RefreshItemKind::AddedCaptures => 1,
        RefreshItemKind::Removed => 2,
        RefreshItemKind::Regrouped => 3,
        RefreshItemKind::Unavailable => 4,
        RefreshItemKind::ManualInclusion => 5,
        RefreshItemKind::KeptExclusion => 6,
    }
}

fn expected_of(summary: &SessionSummary) -> ExpectedSession {
    ExpectedSession {
        session_id: summary.session.id,
        grouping_revision: summary.session.grouping_revision,
        decision_revision: summary.session.decision_revision,
    }
}

/// An item with an id unique within the review: kind, session and whether it
/// names members.
fn item(
    view: Uuid,
    kind: RefreshItemKind,
    session_id: Uuid,
    member_keys: Vec<Uuid>,
) -> RefreshItem {
    let name = format!("{kind:?}/{session_id}/{}", member_keys.is_empty());
    RefreshItem {
        id: Uuid::new_v5(&view, name.as_bytes()),
        kind,
        session_id,
        session: None,
        assessed: None,
        evidence: None,
        reason: None,
        member_keys,
        successors: Vec::new(),
    }
}

/// What refresh reads about the reviewed membership.
struct Reviewed<'m> {
    view: Uuid,
    /// Every recorded copy of every member.
    recorded: HashSet<Uuid>,
    /// Members by the session they were chosen through.
    members: HashMap<Uuid, Vec<&'m MemberBasis>>,
}

impl Reviewed<'_> {
    fn members_of(&self, session: Uuid) -> &[&MemberBasis] {
        self.members.get(&session).map(Vec::as_slice).unwrap_or_default()
    }

    fn holds(&self, session: &CandidateSession) -> bool {
        session
            .captures
            .iter()
            .any(|capture| capture.copies.iter().any(|copy| self.recorded.contains(&copy.asset_id)))
    }
}

/// Items of one selected session: a regroup for a superseded session, else a
/// manual inclusion outside the criteria, a removal of a criteria-based choice
/// that no longer meets them (never with an unavailable member, R24), and the
/// captures that joined it.
fn selected_items(
    reviewed: &Reviewed<'_>,
    chosen: &ChoiceBasis,
    candidates: &HashMap<Uuid, &CandidateEvaluation<'_>>,
    criteria: &ViewCriteria,
) -> Vec<RefreshItem> {
    let session_id = chosen.choice.session_id;
    if !chosen.current.successors.is_empty() {
        let mut regrouped = item(reviewed.view, RefreshItemKind::Regrouped, session_id, Vec::new());
        regrouped.session = Some(expected_of(&chosen.current));
        regrouped.successors = chosen
            .current
            .successors
            .iter()
            .filter_map(|successor| candidates.get(successor))
            .map(|successor| successor.session.expected())
            .collect();
        return vec![regrouped];
    }
    let candidate = candidates.get(&session_id);
    let meets = candidate.is_some_and(|candidate| candidate.meets(criteria));
    let members = reviewed.members_of(session_id);
    let mut items = Vec::new();
    if chosen.choice.reason.is_pinned() {
        if !meets {
            let mut kept =
                item(reviewed.view, RefreshItemKind::ManualInclusion, session_id, Vec::new());
            kept.reason = Some(chosen.choice.reason.clone());
            items.push(kept);
        }
    } else if !meets && members.iter().all(|member| !member.unresolved) {
        let keys = members.iter().map(|member| member.member.member_key).collect();
        let mut removed = item(reviewed.view, RefreshItemKind::Removed, session_id, keys);
        removed.session = Some(expected_of(&chosen.current));
        return vec![removed];
    }
    if let Some(candidate) = candidate {
        let joined: Vec<Uuid> = candidate
            .session
            .captures
            .iter()
            .filter(|capture| {
                capture.copies.iter().all(|copy| !reviewed.recorded.contains(&copy.asset_id))
            })
            .map(|capture| capture.member_key)
            .collect();
        if !joined.is_empty() {
            let mut added = item(reviewed.view, RefreshItemKind::AddedCaptures, session_id, joined);
            added.session = Some(candidate.session.expected());
            added.assessed = Some(candidate.session.assessed.clone());
            items.push(added);
        }
    }
    items
}

/// Unavailable included members and kept member exclusions, per session.
fn member_items(reviewed: &Reviewed<'_>) -> Vec<RefreshItem> {
    let mut items = Vec::new();
    for (session, members) in &reviewed.members {
        let keys = |keep: &dyn Fn(&MemberBasis) -> bool| -> Vec<Uuid> {
            let mut keys: Vec<Uuid> = members
                .iter()
                .filter(|member| keep(member))
                .map(|member| member.member.member_key)
                .collect();
            keys.sort_unstable();
            keys
        };
        let unavailable =
            keys(&|member| member.member.state == MemberState::Included && member.unresolved);
        if !unavailable.is_empty() {
            items.push(item(reviewed.view, RefreshItemKind::Unavailable, *session, unavailable));
        }
        let excluded = keys(&|member| member.member.state == MemberState::Excluded);
        if !excluded.is_empty() {
            items.push(item(reviewed.view, RefreshItemKind::KeptExclusion, *session, excluded));
        }
    }
    items
}

/// The differences between a committed membership and the current library
/// (R24): sessions that newly meet the criteria and are neither chosen,
/// excluded, a regrouped member's successor nor holding a recorded copy;
/// captures that joined a selected session; removals of criteria-based choices
/// that no longer meet the criteria; regrouped sessions with their successors;
/// unavailable members; manual inclusions outside the criteria; and kept
/// session and member exclusions. A pinned choice or an unavailable member is
/// never proposed for removal. Items are ordered by kind, then session.
#[must_use]
pub fn refresh_items(
    committed: &MembershipBasis,
    evaluations: &[CandidateEvaluation<'_>],
    criteria: &ViewCriteria,
) -> Vec<RefreshItem> {
    let candidates: HashMap<Uuid, &CandidateEvaluation<'_>> =
        evaluations.iter().map(|evaluation| (evaluation.session_id(), evaluation)).collect();
    let mut reviewed =
        Reviewed { view: committed.view_id, recorded: HashSet::new(), members: HashMap::new() };
    for member in &committed.members {
        reviewed.recorded.extend(member.member.copies.iter().map(|copy| copy.asset_id));
        reviewed.members.entry(member.member.session_id).or_default().push(member);
    }
    let mut items = member_items(&reviewed);
    let mut chosen = HashSet::new();
    for basis in &committed.sessions {
        chosen.insert(basis.choice.session_id);
        chosen.extend(basis.current.successors.iter().copied());
        match basis.choice.state {
            SessionChoiceState::Selected => {
                items.extend(selected_items(&reviewed, basis, &candidates, criteria));
            }
            SessionChoiceState::Excluded => {
                let mut kept = item(
                    committed.view_id,
                    RefreshItemKind::KeptExclusion,
                    basis.choice.session_id,
                    Vec::new(),
                );
                kept.reason = Some(basis.choice.reason.clone());
                items.push(kept);
            }
        }
    }
    for evaluation in evaluations {
        if chosen.contains(&evaluation.session_id())
            || !evaluation.meets(criteria)
            || reviewed.holds(evaluation.session)
        {
            continue;
        }
        let keys = evaluation.session.captures.iter().map(|capture| capture.member_key).collect();
        let mut added =
            item(committed.view_id, RefreshItemKind::AddedSession, evaluation.session_id(), keys);
        added.session = Some(evaluation.session.expected());
        added.assessed = Some(evaluation.session.assessed.clone());
        added.evidence = Some(evaluation.geometry.clone());
        items.push(added);
    }
    items.sort_by(|left, right| {
        kind_rank(left.kind)
            .cmp(&kind_rank(right.kind))
            .then(left.session_id.cmp(&right.session_id))
            .then(left.member_keys.is_empty().cmp(&right.member_keys.is_empty()))
    });
    items
}
