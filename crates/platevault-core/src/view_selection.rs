// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Processing run selection (spec 066, amended D-W1..D-W74; research R12, R13,
//! R19, R20 and R24): candidate evaluation, browsing filters, sorting and
//! paging, membership summaries and refresh differences, and the `Library`
//! operations over them. The pure functions read one catalog snapshot the
//! caller passes in; none does I/O, writes, hashes or measures. A run's
//! candidates are the subject's sessions on the run's rig; geometry only
//! orders them and never removes one. Unknown evidence stays unknown: it never
//! reads as a zero distance or a framed Target.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use persistence_library::{
    CandidateBasis, CandidateSession, Catalog, ChoiceBasis, MembershipBasis, SessionSummary,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::library::{AssetReferences, Library, ReferencesFuture};
use crate::view_geometry::{frame_geometry, session_geometry};
use crate::{
    Availability, CandidateFilters, CandidateQuery, CandidateSortKey, ChannelSummary, DraftEdit,
    ExclusionCount, ExclusionReason, ExpectedSession, FrameEvidence, GeometryEvidence,
    LibraryError, MemberBasis, MemberReason, MemberState, Membership, MembershipSummary,
    Microseconds, NewView, OpenChoice, OpenChoiceKind, QualityAction, QualityCount, QualityScope,
    QualityState, ReferenceKind, RefreshItem, RefreshItemKind, RefreshReview, RefreshState,
    RejectionMark, Revision, ScopeChannel, ScopeOwner, SessionChoice, SessionChoiceState,
    SortDirection, UnresolvedAction, UnresolvedSource, View, ViewDraftHeader, ViewRecord,
    ViewRevisionHeader,
};

/// Re-reads of a run's membership before a refresh review that keeps meeting
/// a concurrent Save is reported.
const REFRESH_ATTEMPTS: usize = 3;

/// A candidate session paired with its geometry against the subject's Target.
#[derive(Clone, Debug)]
pub struct RunCandidate<'a> {
    pub session: &'a CandidateSession,
    pub geometry: GeometryEvidence,
}

impl RunCandidate<'_> {
    #[must_use]
    pub const fn session_id(&self) -> Uuid {
        self.session.summary.session.id
    }
}

/// One candidate session with its evidence and selection state.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateRow {
    pub session: SessionSummary,
    /// Earliest capture start (DATE-OBS, else DATE-LOC).
    pub date: Option<String>,
    pub night: Option<String>,
    pub channel: Option<String>,
    pub exposure_seconds: Option<f64>,
    pub camera: Option<String>,
    pub telescope: Option<String>,
    /// Light frames: logical captures whose image type is light.
    pub frames: u64,
    pub captures: u64,
    pub unknown_image_type_count: u64,
    pub unknown_exposure_count: u64,
    pub integration: Microseconds,
    pub quality_counts: Vec<QualityCount>,
    pub geometry: GeometryEvidence,
    /// This session's choice in the chosen membership, if any.
    pub selection: Option<SessionChoice>,
}

/// One page of a run's candidates.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidatePage {
    pub rows: Vec<CandidateRow>,
    pub match_count: u64,
    pub selected_count: u64,
    pub selected_outside_filters: u64,
}

/// The run workspace's backend read.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewDetail {
    pub view: View,
    pub revision: Option<ViewRevisionHeader>,
    pub draft: Option<ViewDraftHeader>,
    /// Session choices of the draft when one exists, else of the revision.
    pub sessions: Vec<ChoiceBasis>,
    pub revision_summary: Option<MembershipSummary>,
    pub draft_summary: Option<MembershipSummary>,
    /// Unresolved sources of the draft when one exists, else of the revision.
    pub unresolved: Vec<UnresolvedSource>,
    pub open_choices: Vec<OpenChoice>,
    /// What 'Add N new sessions' offers; a Complete run asks for Reopen first.
    pub new_sessions: u64,
}

fn count(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

/// Geometry of every candidate against the subject's Target, in basis order.
/// The run's rig fills the field of view where headers lack optics (R6).
#[must_use]
pub fn evaluate_candidates(basis: &CandidateBasis) -> Vec<RunCandidate<'_>> {
    basis
        .sessions
        .iter()
        .map(|session| {
            let frames: Vec<_> = session
                .captures
                .iter()
                .map(|capture| frame_geometry(&capture.frame, Some(&basis.rig)))
                .collect();
            RunCandidate { session, geometry: session_geometry(&frames, &basis.framing) }
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

fn frame_binning(frame: &FrameEvidence) -> Option<u32> {
    frame.binning_x.filter(|x| frame.binning_y.is_none_or(|y| y == *x))
}

/// Date, night, channel, exposure, quality, location and availability.
fn matches_session(facts: &Facts<'_>, filters: &CandidateFilters) -> bool {
    let session = facts.session;
    date_within(facts.date, filters.date_from.as_deref(), filters.date_to.as_deref())
        && filters.night.as_deref().is_none_or(|night| facts.night == Some(night))
        && (filters.channels.is_empty()
            || facts.channel.is_some_and(|channel| filters.channels.iter().any(|c| c == channel)))
        && within(facts.exposure, filters.exposure_min, filters.exposure_max)
        && (filters.quality_states.is_empty()
            || session.captures.iter().any(|capture| {
                filters.quality_states.contains(&QualityState::of(&capture.quality))
            }))
        && (filters.location_ids.is_empty()
            || session.summary.location_ids.iter().any(|id| filters.location_ids.contains(id)))
        && listed(&filters.availability, Some(&session.summary.availability))
}

/// OBJECT text and the per-frame header ranges.
fn matches_frames(session: &CandidateSession, filters: &CandidateFilters) -> bool {
    let object_text = filters.object_text.as_deref().map(str::to_lowercase);
    object_text.is_none_or(|text| {
        candidate_frames(session).any(|frame| {
            frame.object.as_deref().is_some_and(|object| object.to_lowercase().contains(&text))
        })
    }) && (!filters.missing_object
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

/// The candidates matching `filters`, in candidate order: what Select matching chooses.
#[must_use]
pub fn matching_sessions(
    candidates: &[RunCandidate<'_>],
    filters: &CandidateFilters,
) -> Vec<ExpectedSession> {
    candidates
        .iter()
        .enumerate()
        .filter(|(index, candidate)| matches(&facts(*index, candidate.session), filters))
        .map(|(_, candidate)| candidate.session.expected())
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
        Availability::Trashed => 6,
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

/// A footprint holding the Target ranks 0, one missing it 1; no footprint is
/// unknown and comes last.
fn framed_rank(geometry: &GeometryEvidence) -> Option<u8> {
    geometry.framed.map(|framed| u8::from(!framed))
}

/// The picker's default order (VSEL-FR-03, VSEL-FR-04): framed footprints
/// first, then by angular separation; unknown geometry comes last.
fn geometry_order(left: &GeometryEvidence, right: &GeometryEvidence) -> Ordering {
    ordered(framed_rank(left), framed_rank(right), SortDirection::Asc, Ord::cmp).then_with(|| {
        ordered(left.distance_deg, right.distance_deg, SortDirection::Asc, f64::total_cmp)
    })
}

fn compare_rows(
    left: &Facts<'_>,
    right: &Facts<'_>,
    sort: Option<(CandidateSortKey, SortDirection)>,
    candidates: &[RunCandidate<'_>],
) -> Ordering {
    let geometry = |facts: &Facts<'_>| &candidates[facts.index].geometry;
    let Some((key, direction)) = sort else {
        return geometry_order(geometry(left), geometry(right));
    };
    match key {
        CandidateSortKey::Date => ordered(left.date, right.date, direction, Ord::cmp),
        CandidateSortKey::Night => ordered(left.night, right.night, direction, Ord::cmp),
        CandidateSortKey::Channel => ordered(left.channel, right.channel, direction, Ord::cmp),
        CandidateSortKey::Exposure => {
            ordered(left.exposure, right.exposure, direction, f64::total_cmp)
        }
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
            ordered(framed_rank(geometry(left)), framed_rank(geometry(right)), direction, Ord::cmp)
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
    candidate: &RunCandidate<'_>,
    selection: Option<&SessionChoice>,
) -> CandidateRow {
    let session = candidate.session;
    CandidateRow {
        session: session.summary.clone(),
        date: facts.date.map(str::to_owned),
        night: facts.night.map(str::to_owned),
        channel: facts.channel.map(str::to_owned),
        exposure_seconds: facts.exposure,
        camera: facts.camera.map(str::to_owned),
        telescope: facts.telescope.map(str::to_owned),
        frames: facts.frames,
        captures: count(session.captures.len()),
        unknown_image_type_count: facts.unknown_image_type,
        unknown_exposure_count: facts.unknown_exposure,
        integration: facts.integration,
        quality_counts: quality_counts(session),
        geometry: candidate.geometry.clone(),
        selection: selection.cloned(),
    }
}

/// One page of candidates: the filtered rows (or, with `selectedOnly`, the
/// selected ones whatever the filters), sorted with rows lacking the sorted
/// evidence last, in geometry order without a sort, ties by session id, then
/// paged. `matchCount` counts every filter match; `selectedOutsideFilters`
/// counts selected sessions the filters hide. Nothing here changes `selection`
/// (FR-06, R20).
#[must_use]
pub fn page_candidates(
    candidates: &[RunCandidate<'_>],
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
    let all: Vec<(Facts<'_>, bool)> = candidates
        .iter()
        .enumerate()
        .map(|(index, candidate)| {
            let facts = facts(index, candidate.session);
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
    let sort = query.sort.map(|sort| (sort.key, sort.direction));
    listed.sort_by(|left, right| {
        compare_rows(left, right, sort, candidates)
            .then_with(|| left.session.summary.session.id.cmp(&right.session.summary.session.id))
    });
    let offset = usize::try_from(query.offset).unwrap_or(usize::MAX);
    let limit = usize::try_from(query.limit).unwrap_or(usize::MAX);
    let rows = listed
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|facts| {
            let candidate = &candidates[facts.index];
            row(facts, candidate, choices.get(&candidate.session_id()).copied())
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
        RefreshItemKind::NoLongerMatchesSubject => 2,
        RefreshItemKind::Regrouped => 3,
        RefreshItemKind::Unavailable => 4,
        RefreshItemKind::KeptExclusion => 5,
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
    fn holds(&self, session: &CandidateSession) -> bool {
        session
            .captures
            .iter()
            .any(|capture| capture.copies.iter().any(|copy| self.recorded.contains(&copy.asset_id)))
    }
}

/// Items of one selected session: a regroup for a superseded session; a
/// session no longer a candidate, flagged and offered for removal while it
/// stays a member (D-W45); or the captures that joined it.
fn selected_items(
    reviewed: &Reviewed<'_>,
    chosen: &ChoiceBasis,
    candidates: &HashMap<Uuid, &RunCandidate<'_>>,
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
    let Some(candidate) = candidates.get(&session_id) else {
        let mut flagged =
            item(reviewed.view, RefreshItemKind::NoLongerMatchesSubject, session_id, Vec::new());
        flagged.session = Some(expected_of(&chosen.current));
        flagged.reason = Some(chosen.choice.reason.clone());
        return vec![flagged];
    };
    let joined: Vec<Uuid> = candidate
        .session
        .captures
        .iter()
        .filter(|capture| {
            capture.copies.iter().all(|copy| !reviewed.recorded.contains(&copy.asset_id))
        })
        .map(|capture| capture.member_key)
        .collect();
    if joined.is_empty() {
        return Vec::new();
    }
    let mut added = item(reviewed.view, RefreshItemKind::AddedCaptures, session_id, joined);
    added.session = Some(candidate.session.expected());
    added.assessed = Some(candidate.session.assessed.clone());
    vec![added]
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

/// The differences between a committed membership and the run's current
/// candidates (R24): candidates neither chosen, excluded, a regrouped member's
/// successor nor holding a recorded copy; captures that joined a selected
/// session; selected sessions no longer candidates; regrouped sessions with
/// their successors; unavailable members; and kept session and member
/// exclusions. A member is never removed unless the user accepts it. Items are
/// ordered by kind, then session.
#[must_use]
pub fn refresh_items(
    committed: &MembershipBasis,
    candidates: &[RunCandidate<'_>],
) -> Vec<RefreshItem> {
    let by_session: HashMap<Uuid, &RunCandidate<'_>> =
        candidates.iter().map(|candidate| (candidate.session_id(), candidate)).collect();
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
                items.extend(selected_items(&reviewed, basis, &by_session));
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
    for candidate in candidates {
        if chosen.contains(&candidate.session_id()) || reviewed.holds(candidate.session) {
            continue;
        }
        let keys = candidate.session.captures.iter().map(|capture| capture.member_key).collect();
        let mut added =
            item(committed.view_id, RefreshItemKind::AddedSession, candidate.session_id(), keys);
        added.session = Some(candidate.session.expected());
        added.assessed = Some(candidate.session.assessed.clone());
        added.evidence = Some(candidate.geometry.clone());
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

// ---------------------------------------------------------------------------
// Detail, open choices and quality scopes
// ---------------------------------------------------------------------------

/// A member whose quality needs a look before handoff: a starting exclusion
/// for its quality, or an included member whose live quality is neither
/// Unreviewed nor Usable.
fn needs_quality_review(member: &MemberBasis) -> bool {
    matches!(member.member.reason, MemberReason::QualityNeedsReview { .. })
        || (member.member.state == MemberState::Included
            && !matches!(
                QualityState::of(&member.quality),
                QualityState::Unreviewed | QualityState::Usable
            ))
}

/// The choices Review preparation gathers, each with its count.
fn open_choices(
    record: &ViewRecord,
    chosen: Option<&MembershipBasis>,
    summary: Option<&MembershipSummary>,
) -> Vec<OpenChoice> {
    let draft = record.draft.as_ref();
    let counts = [
        (OpenChoiceKind::UnsavedDraft, u64::from(draft.is_some())),
        (OpenChoiceKind::StaleDraft, u64::from(draft.is_some_and(|draft| draft.stale))),
        (
            OpenChoiceKind::UnresolvedMembers,
            summary.map_or(0, |summary| {
                let members: BTreeSet<Uuid> = summary
                    .unresolved
                    .iter()
                    .flat_map(|source| source.member_keys.iter().copied())
                    .collect();
                count(members.len())
            }),
        ),
        (
            OpenChoiceKind::QualityNeedsReview,
            chosen.map_or(0, |basis| {
                count(basis.members.iter().filter(|member| needs_quality_review(member)).count())
            }),
        ),
        (
            OpenChoiceKind::ChangedSinceReview,
            summary.map_or(0, |summary| count(summary.changed_since_review.len())),
        ),
        (OpenChoiceKind::ProfileUnset, u64::from(record.view.profile_id.is_none())),
    ];
    counts
        .into_iter()
        .filter(|(_, count)| *count > 0)
        .map(|(kind, count)| OpenChoice { kind, count })
        .collect()
}

/// The scope of `action` over the asked `keys` of `basis` (R18), with one
/// Project-only mark per accepted copy at its `rejections` revision.
fn quality_scope(
    basis: &MembershipBasis,
    action: QualityAction,
    owner: ScopeOwner,
    keys: &[Uuid],
    rejections: &HashMap<Uuid, Revision>,
) -> QualityScope {
    let asked: BTreeSet<Uuid> = keys.iter().copied().collect();
    let accepted: Vec<&MemberBasis> = basis
        .members
        .iter()
        .filter(|member| asked.contains(&member.member.member_key))
        .filter(|member| {
            action != QualityAction::MarkUsable || member.member.state == MemberState::Included
        })
        .collect();
    let held: BTreeSet<Uuid> = accepted.iter().map(|member| member.member.member_key).collect();
    let mut channels: BTreeMap<Option<&str>, (u64, Microseconds)> = BTreeMap::new();
    for member in &accepted {
        let channel = channels.entry(member.frame.filter.as_deref()).or_default();
        channel.0 += 1;
        if let Some(exposure) = member.frame.exposure_seconds.and_then(Microseconds::from_seconds) {
            channel.1 = channel.1.saturating_add(exposure);
        }
    }
    let sessions: BTreeSet<Uuid> = accepted.iter().map(|member| member.member.session_id).collect();
    let copies = || accepted.iter().flat_map(|member| member.copies.iter());
    let marks = if action == QualityAction::RejectForProject {
        copies()
            .map(|copy| RejectionMark {
                asset_id: copy.asset_id,
                fingerprint: copy.current.fingerprint.clone(),
                expected_revision: rejections.get(&copy.asset_id).copied().unwrap_or(0),
                rejected: true,
            })
            .collect()
    } else {
        Vec::new()
    };
    QualityScope {
        action,
        owner,
        frames: count(accepted.len()),
        sessions: count(sessions.len()),
        channels: channels
            .into_iter()
            .map(|(channel, (frames, seconds))| ScopeChannel {
                channel: channel.map(str::to_owned),
                frames,
                seconds,
            })
            .collect(),
        refused: asked.difference(&held).copied().collect(),
        expected: copies().map(|copy| copy.current.clone()).collect(),
        marks,
    }
}

// ---------------------------------------------------------------------------
// Library operations
// ---------------------------------------------------------------------------

/// Runs (spec 066) as a reference source: a run holds the copies of its
/// committed revisions and its draft.
pub(crate) struct ViewReferences {
    pub(crate) catalog: Arc<Catalog>,
}

impl AssetReferences for ViewReferences {
    fn kind(&self) -> ReferenceKind {
        ReferenceKind::View
    }

    fn references_to<'a>(&'a self, assets: &'a BTreeSet<Uuid>) -> ReferencesFuture<'a> {
        Box::pin(self.catalog.view_references(assets))
    }
}

impl Library {
    /// Start a run in its Project on one subject and one of the Project's
    /// rigs (VSEL-FR-01); it starts with every available candidate selected
    /// (D-W49). Writes only run rows.
    ///
    /// # Errors
    /// As [`Catalog::create_view`].
    pub async fn create_view(&self, input: &NewView) -> Result<ViewDetail, LibraryError> {
        let record = self.catalog().create_view(input).await?;
        self.view_detail(record.view.id).await
    }

    /// The run workspace's read: headers, the session choices and unresolved
    /// sources of the draft (else the revision), both summaries, the open
    /// choices and the 'Add N new sessions' count. Read-only; one run state
    /// across its reads.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `PersistenceFailure` when the catalog
    /// cannot be read.
    pub async fn view_detail(&self, id: Uuid) -> Result<ViewDetail, LibraryError> {
        let catalog = self.catalog();
        loop {
            let record = catalog.view(id).await?;
            let committed = match record.revision {
                Some(_) => Some(catalog.view_membership(id, Membership::Committed).await?),
                None => None,
            };
            let draft = match record.draft {
                Some(_) => Some(catalog.view_membership(id, Membership::Draft).await?),
                None => None,
            };
            let new_sessions = catalog.view_new_candidate_count(id).await?;
            // A run write committed between the reads: read one state again.
            if catalog.view(id).await? != record {
                continue;
            }
            let revision_summary = committed.as_ref().map(summarize);
            let draft_summary = draft.as_ref().map(summarize);
            let (chosen, summary) = match (draft, draft_summary.as_ref()) {
                (Some(draft), Some(summary)) => (Some(draft), Some(summary)),
                _ => (committed, revision_summary.as_ref()),
            };
            let open_choices = open_choices(&record, chosen.as_ref(), summary);
            let unresolved = summary.map(|summary| summary.unresolved.clone()).unwrap_or_default();
            let sessions = chosen.map(|basis| basis.sessions).unwrap_or_default();
            return Ok(ViewDetail {
                view: record.view,
                revision: record.revision,
                draft: record.draft,
                sessions,
                revision_summary,
                draft_summary,
                unresolved,
                open_choices,
                new_sessions,
            });
        }
    }

    /// One page of the run's candidates, the subject's sessions on its rig,
    /// with each row's selection state in the chosen membership. Browsing
    /// changes nothing: no measurement, rehash or write starts (FR-05, FR-06).
    ///
    /// # Errors
    /// `InvalidInput` for an invalid query; `NotFound` for an unknown run or a
    /// membership it does not have.
    pub async fn view_candidates(
        &self,
        id: Uuid,
        query: &CandidateQuery,
    ) -> Result<CandidatePage, LibraryError> {
        query.validate()?;
        let membership = self.catalog().view_membership(id, query.membership).await?;
        let basis = self.catalog().view_candidate_basis(id).await?;
        let candidates = evaluate_candidates(&basis);
        let selection: Vec<SessionChoice> =
            membership.sessions.into_iter().map(|basis| basis.choice).collect();
        Ok(page_candidates(&candidates, query, &selection))
    }

    /// Choose every candidate matching `filters` as `select_matching`,
    /// recording the filters (FR-06). Starts the draft from the latest
    /// revision when `expected_draft` is 0.
    ///
    /// # Errors
    /// `InvalidInput` for invalid filters, no match, or a run that is Complete
    /// or in the Trash; `Conflict` for a stale draft or session; `NotFound`
    /// for an unknown run.
    pub async fn view_select_matching(
        &self,
        id: Uuid,
        expected_draft: Revision,
        filters: &CandidateFilters,
    ) -> Result<ViewRecord, LibraryError> {
        filters.validate()?;
        let basis = self.catalog().view_candidate_basis(id).await?;
        let sessions = matching_sessions(&evaluate_candidates(&basis), filters);
        if sessions.is_empty() {
            return Err(LibraryError::InvalidInput("no candidate matches the filters".into()));
        }
        let edit = DraftEdit::SelectMatching { filters: Box::new(filters.clone()), sessions };
        self.catalog().edit_view_draft(id, expected_draft, &edit).await
    }

    /// Durably review the differences between the latest committed revision
    /// and the run's current candidates (R24), re-reading up to three times
    /// when a Save lands meanwhile. Changes no membership.
    ///
    /// # Errors
    /// `NotFound` for an unknown or never-saved run; `InvalidInput` for a run
    /// that is Complete (Reopen it first) or in the Trash; `Conflict` when
    /// Saves kept landing.
    pub async fn refresh_view(&self, id: Uuid) -> Result<RefreshReview, LibraryError> {
        let mut attempt = 1;
        loop {
            let committed = self.catalog().view_membership(id, Membership::Committed).await?;
            let basis = self.catalog().view_candidate_basis(id).await?;
            let candidates = evaluate_candidates(&basis);
            let review = RefreshReview {
                id: Uuid::new_v4(),
                view_id: id,
                base_revision: committed.revision,
                items: refresh_items(&committed, &candidates),
                criteria: committed.criteria,
                state: RefreshState::Reviewed,
                created_at: String::new(),
                applied_at: None,
            };
            match self.catalog().record_refresh_review(&review).await {
                Err(LibraryError::Conflict { .. }) if attempt < REFRESH_ATTEMPTS => attempt += 1,
                result => return result,
            }
        }
    }

    /// The named scope of a quality action before confirmation (R18): the
    /// library or the run's Project, the accepted members' frames, sessions
    /// and seconds per channel, the asked keys it refuses and the current
    /// expectations of every accepted copy (with the Project-only marks for
    /// Reject for this Project only). Mark usable accepts included members
    /// only. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for no member keys; `NotFound` for an unknown run or
    /// membership.
    pub async fn view_quality_scope(
        &self,
        id: Uuid,
        membership: Membership,
        action: QualityAction,
        members: &[Uuid],
    ) -> Result<QualityScope, LibraryError> {
        if members.is_empty() {
            return Err(LibraryError::InvalidInput("memberKeys must not be empty".into()));
        }
        let record = self.catalog().view(id).await?;
        let basis = self.catalog().view_membership(id, membership).await?;
        let (owner, rejections) = match action {
            QualityAction::MarkUsable | QualityAction::MarkUnusable => {
                (ScopeOwner::Library, HashMap::new())
            }
            QualityAction::RejectForProject => {
                let project_id = record.view.project_id;
                let detail = self.catalog().project_detail(project_id).await?;
                let rejections = detail
                    .rejections
                    .iter()
                    .map(|rejection| (rejection.asset_id, rejection.revision))
                    .collect();
                (ScopeOwner::Project { project_id, name: detail.project.name }, rejections)
            }
        };
        Ok(quality_scope(&basis, action, owner, members, &rejections))
    }
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use uuid::Uuid;

    use super::geometry_order;
    use crate::targets::ICRS_FRAME;
    use crate::view_geometry::{frame_geometry, session_geometry};
    use crate::{FrameEvidence, FramingTarget, GeometryClass, SkyCoordinates};

    fn frame(pointing: Option<(f64, f64)>) -> FrameEvidence {
        FrameEvidence {
            asset_id: Uuid::new_v4(),
            light: Some(true),
            ra_deg: pointing.map(|(ra, _)| ra),
            dec_deg: pointing.map(|(_, dec)| dec),
            ..FrameEvidence::default()
        }
    }

    /// VSEL-AC-02: a candidate with no pointing reads Position unknown with no
    /// distance (never 0) and sorts after every candidate with evidence.
    #[test]
    fn unknown_pointing_sorts_last_never_zero() {
        let target = FramingTarget {
            target_id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            coordinates: Some(SkyCoordinates {
                ra_deg: 314.75,
                dec_deg: 44.33,
                frame: ICRS_FRAME.into(),
            }),
        };
        let geometry =
            |pointing| session_geometry(&[frame_geometry(&frame(pointing), None)], &target);
        let near = geometry(Some((314.75, 44.43)));
        let far = geometry(Some((314.75, 46.33)));
        let unknown = geometry(None);
        assert_eq!(unknown.class, GeometryClass::PositionUnknown);
        assert_eq!(unknown.distance_deg, None, "never a zero distance");
        assert!(near.distance_deg.is_some_and(|d| d > 0.0 && d < 0.2), "{near:?}");
        assert_eq!(geometry_order(&near, &far), Ordering::Less);
        assert_eq!(geometry_order(&far, &unknown), Ordering::Less, "unknown sorts last");
        assert_eq!(geometry_order(&unknown, &near), Ordering::Greater);
    }
}
