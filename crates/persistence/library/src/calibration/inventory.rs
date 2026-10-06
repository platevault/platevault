// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Raw sets, adopted masters and detected candidates from one reader snapshot.
//!
//! A raw set is a current Session's raw calibration frames, one member per
//! logical capture (D16); Library-Unusable members are listed as excluded and
//! master files of the same Session are candidates of their own (R3, R4). A
//! detected candidate is never reusable (R5). Retired copies are not listed.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    AdoptedMaster, ApplicableQuality, Asset, Availability, CalibrationDecision, CalibrationRules,
    CandidateRef, CaptureEvidence, Classification, EvidenceField, InputCandidate, InputEvidence,
    InputForm, InputKind, InputRef, InputState, Location, LocationLifecycle, MasterOrigin, Session,
};
use sqlx::sqlite::SqliteConnection;
use uuid::Uuid;

use super::{
    corrected_fields, load_masters, night_of, CalibrationInputSummary, InputCopy, InputGroup,
    InputMember,
};
use crate::{
    capture_quality, load_assets, load_location, load_session_row, parse_uuid, path_key,
    session_availability, CaptureView, Result,
};

/// Current non-light candidates: every copy in an Active location of a current Session.
const CURRENT_ASSETS: &str = "SELECT a.id, a.session_id FROM assets a \
    JOIN locations l ON l.id = a.location_id JOIN sessions s ON s.id = a.session_id \
    WHERE s.superseded_by IS NULL AND l.lifecycle = 'active' ORDER BY a.session_id, a.id";

/// One listed input with the members it binds.
pub struct Listed {
    pub summary: CalibrationInputSummary,
    pub members: Vec<InputMember>,
    pub excluded: Vec<InputMember>,
}

impl Listed {
    /// The input as the planner sees it.
    pub fn candidate(&self) -> InputCandidate {
        let summary = &self.summary;
        InputCandidate {
            candidate: summary.input,
            evidence: InputEvidence {
                kind: summary.kind,
                form: summary.form,
                capture: summary.evidence.clone(),
            },
            state: summary.state.clone(),
            master: summary.master.clone(),
            origin: summary.origin.clone(),
        }
    }
}

const fn form_rank(form: InputForm) -> u8 {
    match form {
        InputForm::RawSet => 0,
        InputForm::Master => 1,
        InputForm::Candidate => 2,
    }
}

fn listing_order(left: &Listed, right: &Listed) -> Ordering {
    let (left, right) = (&left.summary, &right.summary);
    left.group
        .cmp(&right.group)
        .then_with(|| form_rank(left.form).cmp(&form_rank(right.form)))
        .then_with(|| left.input.id().cmp(&right.input.id()))
}

/// Every listed input in group order.
pub async fn list_inputs<R: CalibrationRules + ?Sized>(
    conn: &mut SqliteConnection,
    rules: &R,
) -> Result<Vec<Listed>> {
    let mut locations = HashMap::new();
    let masters = load_masters(conn).await?;
    // An adopted master's indexed destination and its source are never new candidates (R16).
    let destinations: BTreeSet<(Uuid, Vec<u8>)> =
        masters.iter().map(|m| (m.location_id, path_key(&m.relative_path))).collect();
    let sources: BTreeSet<Uuid> =
        masters.iter().filter_map(|m| m.provenance.source.asset_id).collect();
    let mut listed = Vec::new();
    for master in masters {
        let location = cached_location(conn, &mut locations, master.location_id).await?;
        if location.lifecycle == LocationLifecycle::Active {
            listed.push(master_listed(master, &location));
        }
    }

    let rows: Vec<(String, String)> = sqlx::query_as(CURRENT_ASSETS).fetch_all(&mut *conn).await?;
    let mut session_of = HashMap::with_capacity(rows.len());
    for (asset, session) in &rows {
        session_of.insert(parse_uuid(asset)?, parse_uuid(session)?);
    }
    let ids: BTreeSet<Uuid> = session_of.keys().copied().collect();
    let mut by_session: BTreeMap<Uuid, Vec<(Asset, Classification)>> = BTreeMap::new();
    for asset in load_assets(conn, &ids).await? {
        if destinations.contains(&(asset.location_id, path_key(&asset.relative_path))) {
            continue;
        }
        if let Some(classification) = rules.classify(&asset.effective, &asset.relative_path) {
            by_session.entry(session_of[&asset.id]).or_default().push((asset, classification));
        }
    }
    let classified: Vec<Asset> =
        by_session.values().flatten().map(|(asset, _)| asset.clone()).collect();
    let session_ids: Vec<Uuid> = by_session.keys().copied().collect();
    let view = CaptureView::read(conn, &session_ids, &classified).await?;
    for (session_id, entries) in by_session {
        let session = load_session_row(conn, session_id).await?.session;
        let (masters, raw): (Vec<_>, Vec<_>) =
            entries.into_iter().partition(|(_, classification)| classification.master.is_some());
        if let Some((_, first)) = raw.first() {
            let kind = first.kind;
            let assets: Vec<Asset> = raw.into_iter().map(|(asset, _)| asset).collect();
            listed.push(raw_set(conn, &view, &session, kind, &assets).await?);
        }
        for (asset, classification) in masters {
            if !sources.contains(&asset.id) {
                let location = cached_location(conn, &mut locations, asset.location_id).await?;
                listed.push(candidate(conn, &session, &location, asset, classification).await?);
            }
        }
    }
    listed.sort_by(listing_order);
    Ok(listed)
}

/// Inputs that decisions name but that no longer list as they were decided:
/// a raw set whose Session was superseded or regrouped reads `superseded`.
pub async fn unlisted_inputs<R: CalibrationRules + ?Sized>(
    conn: &mut SqliteConnection,
    decisions: &[CalibrationDecision],
    listed: &[Listed],
    rules: &R,
) -> Result<Vec<InputCandidate>> {
    let known: BTreeSet<CandidateRef> = listed.iter().map(|l| l.summary.input).collect();
    let mut added = BTreeMap::new();
    for decision in decisions {
        let Some(input @ InputRef::RawSet { .. }) = decision.input else { continue };
        let reference = CandidateRef::from(input);
        if known.contains(&reference) || added.contains_key(&reference) {
            continue;
        }
        let ids: BTreeSet<Uuid> = decision.inputs.iter().filter_map(|file| file.asset_id).collect();
        let assets = load_assets(conn, &ids).await?;
        let Some(asset) = assets.first() else { continue };
        let kind = rules
            .classify(&asset.effective, &asset.relative_path)
            .map_or(decision.kind, |classification| classification.kind);
        let session = load_session_row(conn, input.id()).await?.session;
        let capture = CaptureEvidence::from_metadata(
            &asset.effective,
            &corrected_fields(conn, asset.id).await?,
            night_of(&session.key).as_deref(),
            super::confirmed_equipment(conn, session.id).await?,
        );
        let members = u64::try_from(assets.len()).unwrap_or(u64::MAX);
        let available = assets.iter().filter(|a| a.availability == Availability::Available).count();
        added.insert(
            reference,
            InputCandidate {
                candidate: reference,
                evidence: InputEvidence { kind, form: InputForm::RawSet, capture },
                state: InputState {
                    availability: session_availability(&assets),
                    members,
                    available_members: u64::try_from(available).unwrap_or(u64::MAX),
                    excluded_members: 0,
                    superseded: true,
                },
                master: None,
                origin: None,
            },
        );
    }
    Ok(added.into_values().collect())
}

async fn cached_location(
    conn: &mut SqliteConnection,
    cache: &mut HashMap<Uuid, Location>,
    id: Uuid,
) -> Result<Location> {
    if let Some(location) = cache.get(&id) {
        return Ok(location.clone());
    }
    let location = load_location(conn, id).await?;
    cache.insert(id, location.clone());
    Ok(location)
}

fn group(kind: InputKind, evidence: &CaptureEvidence) -> InputGroup {
    let value = |field| evidence.get(field).map(|v| v.value.clone());
    let pair = |a, b| Some(format!("{}x{}", value(a)?, value(b)?));
    InputGroup {
        kind,
        camera: value(EvidenceField::Camera),
        gain: value(EvidenceField::Gain),
        offset: value(EvidenceField::Offset),
        channel: if kind == InputKind::Flat { value(EvidenceField::Filter) } else { None },
        dimensions: pair(EvidenceField::Width, EvidenceField::Height),
        binning: pair(EvidenceField::BinningX, EvidenceField::BinningY),
    }
}

/// Evidence the kind's criteria compare that this input does not record. A
/// flat's optical train needs TELESCOP and FOCALLEN only without Confirmed
/// Equipment (R8).
fn missing(kind: InputKind, evidence: &CaptureEvidence) -> Vec<EvidenceField> {
    let mut needed = vec![
        EvidenceField::Camera,
        EvidenceField::Width,
        EvidenceField::Height,
        EvidenceField::BinningX,
        EvidenceField::BinningY,
        EvidenceField::Gain,
        EvidenceField::Offset,
    ];
    match kind {
        InputKind::Dark => needed.extend([EvidenceField::Exposure, EvidenceField::SetTemperature]),
        InputKind::Flat => {
            needed.push(EvidenceField::Filter);
            if evidence.confirmed_equipment.is_none() {
                needed.extend([EvidenceField::Telescope, EvidenceField::FocalLength]);
            }
        }
        InputKind::Bias => {}
    }
    needed.into_iter().filter(|field| evidence.get(*field).is_none()).collect()
}

fn input_copy(asset: &Asset) -> InputCopy {
    InputCopy {
        asset_id: asset.id,
        location_id: asset.location_id,
        relative_path: asset.relative_path.clone(),
        availability: asset.availability,
        fingerprint: asset.fingerprint.clone(),
    }
}

fn count(items: usize) -> u64 {
    u64::try_from(items).unwrap_or(u64::MAX)
}

/// The raw set of `session`: its raw frames grouped into logical captures.
async fn raw_set(
    conn: &mut SqliteConnection,
    view: &CaptureView,
    session: &Session,
    kind: InputKind,
    assets: &[Asset],
) -> Result<Listed> {
    let mut members = Vec::new();
    let mut excluded = Vec::new();
    let mut included_copies: Vec<Asset> = Vec::new();
    let mut excluded_copies: Vec<Asset> = Vec::new();
    let mut evidence_asset = None;
    for (key, present) in view.group(assets) {
        let mut copies: Vec<&Asset> = view
            .copies_of(&key)
            .into_iter()
            .filter(|copy| copy.availability != Availability::Retired)
            .collect();
        if copies.is_empty() {
            copies.clone_from(&present);
        }
        let quality = capture_quality(&copies);
        let member = InputMember {
            member_key: parse_uuid(&key)?,
            quality,
            copies: copies.iter().map(|copy| input_copy(copy)).collect(),
        };
        if quality == ApplicableQuality::Unusable {
            excluded_copies.extend(copies.iter().map(|copy| (*copy).clone()));
            excluded.push(member);
        } else {
            evidence_asset =
                evidence_asset.or_else(|| present.first().map(|asset| (*asset).clone()));
            included_copies.extend(copies.iter().map(|copy| (*copy).clone()));
            members.push(member);
        }
    }
    let evidence_asset = evidence_asset.unwrap_or_else(|| assets[0].clone());
    let evidence = CaptureEvidence::from_metadata(
        &evidence_asset.effective,
        &corrected_fields(conn, evidence_asset.id).await?,
        night_of(&session.key).as_deref(),
        super::confirmed_equipment(conn, session.id).await?,
    );
    let available = members
        .iter()
        .filter(|member| member.copies.iter().any(|c| c.availability == Availability::Available))
        .count();
    let availability = session_availability(if included_copies.is_empty() {
        &excluded_copies
    } else {
        &included_copies
    });
    let location_ids: BTreeSet<Uuid> =
        included_copies.iter().chain(&excluded_copies).map(|copy| copy.location_id).collect();
    let summary = CalibrationInputSummary {
        input: CandidateRef::RawSet {
            session_id: session.id,
            grouping_revision: session.grouping_revision,
        },
        kind,
        form: InputForm::RawSet,
        group: group(kind, &evidence),
        missing: missing(kind, &evidence),
        state: InputState {
            availability,
            members: count(members.len()),
            available_members: count(available),
            excluded_members: count(excluded.len()),
            superseded: false,
        },
        evidence,
        master: None,
        origin: None,
        provenance: None,
        reusable: true,
        location_ids: location_ids.into_iter().collect(),
        member_assets: included_copies.iter().map(|copy| copy.id).collect(),
    };
    Ok(Listed { summary, members, excluded })
}

/// A detected master: labelled with its evidence basis and origin, never reusable.
async fn candidate(
    conn: &mut SqliteConnection,
    session: &Session,
    location: &Location,
    asset: Asset,
    classification: Classification,
) -> Result<Listed> {
    let evidence = CaptureEvidence::from_metadata(
        &asset.effective,
        &corrected_fields(conn, asset.id).await?,
        night_of(&session.key).as_deref(),
        None,
    );
    let kind = classification.kind;
    let available = asset.availability == Availability::Available;
    let summary = CalibrationInputSummary {
        input: CandidateRef::Candidate { asset_id: asset.id },
        kind,
        form: InputForm::Candidate,
        group: group(kind, &evidence),
        missing: missing(kind, &evidence),
        state: InputState {
            availability: asset.availability,
            members: 1,
            available_members: u64::from(available),
            excluded_members: 0,
            superseded: false,
        },
        evidence,
        master: classification.master,
        origin: Some(MasterOrigin::Location {
            location_id: location.id,
            location_name: location.name.clone(),
            relative_path: asset.relative_path.clone(),
        }),
        provenance: None,
        reusable: false,
        location_ids: vec![asset.location_id],
        member_assets: vec![asset.id],
    };
    let members = vec![InputMember {
        member_key: asset.id,
        quality: asset.applicable_quality(),
        copies: vec![input_copy(&asset)],
    }];
    Ok(Listed { summary, members, excluded: Vec::new() })
}

/// An adopted master: header evidence of the copied bytes only (R8, R16).
fn master_listed(master: AdoptedMaster, location: &Location) -> Listed {
    let evidence = CaptureEvidence::from_metadata(&master.observed, &BTreeSet::new(), None, None);
    let kind = master.kind;
    let available = location.availability == Availability::Available;
    let summary = CalibrationInputSummary {
        input: CandidateRef::Master { master_id: master.id, revision: master.revision },
        kind,
        form: InputForm::Master,
        group: group(kind, &evidence),
        missing: missing(kind, &evidence),
        state: InputState {
            availability: location.availability,
            members: 1,
            available_members: u64::from(available),
            excluded_members: 0,
            superseded: false,
        },
        evidence,
        master: master.classification.master.clone(),
        origin: Some(master.provenance.origin.clone()),
        provenance: Some(master.provenance),
        reusable: true,
        location_ids: vec![master.location_id],
        member_assets: master.asset_id.into_iter().collect(),
    };
    Listed { summary, members: Vec::new(), excluded: Vec::new() }
}
