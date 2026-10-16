// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Session calibration pins (spec 064 LIB-FR-17, LIB-FR-23 to LIB-FR-26; 068
//! CAL-FR-02, CAL-FR-05, CAL-FR-08, CAL-FR-16/17, CAL-FR-19 to CAL-FR-22;
//! D-W101 to D-W106, D-W113).
//!
//! Ingestion records every new light session's calibration with matching
//! pending, inside the ingestion transaction, and the camera's "Don't use
//! darks" and "Don't use bias" settle those kinds as No. Matching runs after
//! the commit and again on restart: [`Catalog::match_pending_calibration`]
//! fills only kinds still waiting (unresolved or suggested), never a pin or a
//! No, and clears the pending flag in the transaction that writes the result,
//! so a crash leaves the session pending and a rerun changes nothing. A rig
//! confirmation and calibration arriving later mark sessions pending again.
//! Import never waits for any of it.
//!
//! The user confirms a suggestion, chooses No or reassigns a kind against the
//! calibration generation they saw. A pin's health is computed on read from
//! the catalog's latest observation of its files: the pin stays when a file
//! changed or went missing. Hide and Move to Trash of a master or raw set
//! read who uses it through the pin indexes and the Closed snapshots.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;

use platevault_model::{
    Asset, Availability, CalibrationHealth, CalibrationInputProject, CalibrationInputUse,
    CalibrationNeed, CalibrationRules, Camera, CameraBasis, CameraLink, CameraResolution,
    CaptureKey, DeclineOrigin, InputKind, InputRef, LibraryError, LightRig, MatchCamera,
    ObservationFingerprint, PendingChange, PinHealth, PinOrigin, PinState, PinTarget, PinnedFile,
    ProcessingMasterOffer, ProjectBasis, ProjectLifecycle, Revision, SessionCalibration,
    SessionCalibrationStatus, SessionInput, SessionLight, SessionNeeds, WorkflowSettings,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use time::Date;
use uuid::Uuid;

use super::inventory::{self, Listed};
use super::{light_basis, load_master, night_of};
use crate::admission::read_calibration;
use crate::rigs::cameras::{
    link_session_camera_by_model, load_cameras, load_session_camera, load_session_camera_link,
};
use crate::rigs::versions::{load_rig_versions, load_session_rig_version};
use crate::workflow_settings::read_workflow_settings;
use crate::{
    blocking, current_digest, current_member_assets, fingerprint_matches, from_json, from_text,
    listed_sessions, load_assets, load_location, load_session_row, now, parse_uuid, successors_of,
    to_json, to_text, Catalog, Members, Result, SourceProbe, SourceRoot,
};

const KINDS: [InputKind; 3] = [InputKind::Bias, InputKind::Dark, InputKind::Flat];

const DATE: &[time::format_description::BorrowedFormatItem<'static>] =
    time::macros::format_description!("[year]-[month]-[day]");

/// Digests hashed for matching, by asset, with the observation they hashed.
type Digests = HashMap<Uuid, (String, ObservationFingerprint)>;

impl Catalog {
    /// Match every session whose calibration matching is pending: each kind
    /// still waiting gets its best match, pinned automatically when it has no
    /// caution and otherwise suggested; pins and No choices are never
    /// replaced. Frames a match binds that were never hashed are
    /// hashed first, outside the writer, and their digests recorded with the
    /// match. A session whose match still needs an unreadable file stays
    /// pending. Returns the sessions matched.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable or corrupt catalog.
    pub async fn match_pending_calibration<R, P>(&self, rules: &R, probe: P) -> Result<Vec<Uuid>>
    where
        R: CalibrationRules + ?Sized,
        P: SourceProbe,
    {
        let work = {
            let mut conn = self.reader().await?;
            let mut snapshot = conn.begin().await?;
            let work = unhashed_work(&mut snapshot, rules).await?;
            snapshot.rollback().await?;
            work
        };
        let digests = hash_frames(work, probe).await?;
        let matched = write_txn!(self, |conn| reconcile(conn, rules, &digests).await?);
        Ok(matched)
    }

    /// One session's calibration with each pin's health and why it waits in
    /// Needs calibration. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown session.
    pub async fn session_calibration(&self, session_id: Uuid) -> Result<SessionCalibrationStatus> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        load_session_row(&mut snapshot, session_id).await?;
        let calibration = read_calibration(&mut snapshot, session_id).await?;
        let health = read_health(&mut snapshot, &calibration).await?;
        snapshot.rollback().await?;
        let needs = calibration.needs(|kind| health.kind(kind));
        Ok(SessionCalibrationStatus { calibration, health, needs })
    }

    /// The Library's Needs calibration queue (LIB-FR-17), in Sessions order:
    /// every listed session with a kind neither pinned nor No, just-imported
    /// and unreviewed ones included, and every one with a pinned file that
    /// changed or went missing. Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable or corrupt catalog.
    pub async fn needs_calibration(&self) -> Result<Vec<SessionNeeds>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let listed = listed_sessions(&mut snapshot, false, None, Members::Live).await?;
        let mut queue = Vec::new();
        for session_id in listed {
            let needs = session_needs(&mut snapshot, session_id).await?;
            if !needs.is_empty() {
                queue.push(SessionNeeds { session_id, needs });
            }
        }
        snapshot.rollback().await?;
        Ok(queue)
    }

    /// Confirm a kind's suggestion: it is pinned as the user confirmed it,
    /// with any unknown criterion recorded in its evaluation (CAL-FR-05).
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `Conflict` (with successors for a
    /// superseded session) when the generation is not `expected`;
    /// `InvalidInput` when the kind has no suggestion.
    pub async fn confirm_calibration(
        &self,
        session_id: Uuid,
        kind: InputKind,
        expected: Revision,
    ) -> Result<SessionCalibration> {
        let confirmed = write_txn!(self, |conn| {
            let calibration = require_generation(conn, session_id, expected).await?;
            let PinState::Suggested { target } = calibration.kind(kind) else {
                return Err(LibraryError::InvalidInput(format!(
                    "session {session_id} has no {} suggestion to confirm",
                    kind.as_str()
                )));
            };
            let state = PinState::Pinned { target: target.clone(), origin: PinOrigin::Confirmed };
            write_kind(conn, session_id, kind, &state, &now()?).await?;
            read_calibration(conn, session_id).await?
        });
        Ok(confirmed)
    }

    /// No darks, No flats or No bias on each session, against the generation
    /// the user saw; the choice needs no reason (CAL-FR-05, CAL-AC-19).
    ///
    /// # Errors
    /// `NotFound` for an unknown session; `Conflict` (with successors for a
    /// superseded session) for a generation other than the expected one.
    pub async fn decline_calibration(
        &self,
        sessions: &[(Uuid, Revision)],
        kind: InputKind,
    ) -> Result<Vec<SessionCalibration>> {
        let declined = write_txn!(self, |conn| {
            let at = now()?;
            let state = PinState::Declined { origin: DeclineOrigin::User };
            let mut declined = Vec::with_capacity(sessions.len());
            for (session_id, expected) in sessions {
                let calibration = require_generation(conn, *session_id, *expected).await?;
                if *calibration.kind(kind) != state {
                    write_kind(conn, *session_id, kind, &state, &at).await?;
                }
                declined.push(read_calibration(conn, *session_id).await?);
            }
            declined
        });
        Ok(declined)
    }

    /// Reassign a kind to `input`, a raw set or master the user picked, or
    /// switch a session to its raw flats: always allowed, also over a pin or
    /// a No (LIB-FR-25). The input must pass the kind's hard checks against
    /// the session; frames it binds that were never hashed are hashed first.
    /// Open Projects that hold the session see it as a calibration change;
    /// nothing is written into them.
    ///
    /// # Errors
    /// `NotFound` for an unknown session or input; `Conflict` (with
    /// successors for a superseded session) for a generation other than
    /// `expected`; `InvalidInput` for an input of another kind or one a hard
    /// check refuses; `SourceUnavailable` when a frame to hash can't be read.
    pub async fn reassign_calibration<R, P>(
        &self,
        session_id: Uuid,
        kind: InputKind,
        input: InputRef,
        expected: Revision,
        rules: &R,
        probe: P,
    ) -> Result<SessionCalibration>
    where
        R: CalibrationRules + ?Sized,
        P: SourceProbe,
    {
        let work = {
            let mut conn = self.reader().await?;
            let mut snapshot = conn.begin().await?;
            let target =
                reassigned(&mut snapshot, rules, session_id, kind, input, &Digests::new()).await?;
            let work = frames_to_hash(&mut snapshot, &target).await?;
            snapshot.rollback().await?;
            work
        };
        let wanted = work.len();
        let digests = hash_frames(work, probe).await?;
        if digests.len() < wanted {
            return Err(LibraryError::SourceUnavailable(format!(
                "a frame of {} could not be read to record its digest",
                input_label(&input)
            )));
        }
        let reassigned = write_txn!(self, |conn| {
            require_generation(conn, session_id, expected).await?;
            let target = reassigned(conn, rules, session_id, kind, input, &digests).await?;
            if !hashed(&target) {
                return Err(LibraryError::Conflict {
                    id: input.id(),
                    current: input.revision(),
                    successors: Vec::new(),
                });
            }
            let at = now()?;
            record_digests(conn, &target, &at).await?;
            let state = PinState::Pinned { target, origin: PinOrigin::Reassigned };
            write_kind(conn, session_id, kind, &state, &at).await?;
            read_calibration(conn, session_id).await?
        });
        Ok(reassigned)
    }

    /// The calibration changes the sessions of an open Project have since
    /// its installed View was applied (VSEL-FR-12, LIB-FR-25): computed on
    /// read from the installed basis and the sessions' current calibration,
    /// labelled as Library changes. A Project never applied, or not open,
    /// has none: a Closed Project is never touched.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn calibration_changes(&self, project_id: Uuid) -> Result<Vec<PendingChange>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let changes = project_calibration_changes(&mut snapshot, project_id).await?;
        snapshot.rollback().await?;
        Ok(changes)
    }

    /// Who uses a master or raw set (CAL-FR-16/17, provisional): the Projects
    /// of any lifecycle that hold a session pinned to it or recorded it in
    /// their Closed snapshot, and the sessions pinned to it. Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn calibration_input_use(&self, input: &InputRef) -> Result<CalibrationInputUse> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let used = input_use(&mut snapshot, input).await?;
        snapshot.rollback().await?;
        Ok(used)
    }

    /// The step Hide and Move to Trash take first (CAL-FR-16/17,
    /// provisional): refused while any Project uses the input; otherwise
    /// every session pinned to it, or offered it as a suggestion, needs
    /// calibration again and is matched again. Returns those sessions.
    ///
    /// # Errors
    /// `InvalidInput` naming the Projects that use it.
    pub async fn release_calibration_input(&self, input: &InputRef) -> Result<Vec<Uuid>> {
        let released = write_txn!(self, |conn| release_input(conn, input).await?);
        Ok(released)
    }

    /// Hide on a Processing master offer (CAL-FR-06): the decline for that
    /// file and digest, so the offer does not return; the master stays
    /// listed as a candidate in Calibration. Hiding it again changes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown offer; `InvalidInput` for an adopted one.
    pub async fn dismiss_processing_master(&self, offer_id: Uuid) -> Result<ProcessingMasterOffer> {
        let offer = write_txn!(self, |conn| {
            let mut offer = load_offer(conn, offer_id).await?;
            match offer.state {
                platevault_model::MasterOfferState::Dismissed => offer,
                platevault_model::MasterOfferState::Adopted => {
                    return Err(LibraryError::InvalidInput(format!(
                        "offer {offer_id} was adopted into the calibration library"
                    )))
                }
                platevault_model::MasterOfferState::Offered => {
                    offer.state = platevault_model::MasterOfferState::Dismissed;
                    offer.decided_at = Some(now()?);
                    write_offer(conn, &offer).await?;
                    offer
                }
            }
        });
        Ok(offer)
    }

    /// Every generated master a Project's `Processing/` offered that is not
    /// adopted, offered or hidden, oldest first: the candidates Calibration
    /// lists (CAL-FR-06). Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` for a corrupt record.
    pub async fn processing_master_candidates(&self) -> Result<Vec<ProcessingMasterOffer>> {
        let mut conn = self.reader().await?;
        let offers: Vec<String> = sqlx::query_scalar(
            "SELECT offer FROM processing_master_offers WHERE state <> 'adopted' \
             ORDER BY offered_at, id",
        )
        .fetch_all(&mut *conn)
        .await?;
        offers.iter().map(|offer| from_json(offer)).collect()
    }
}

// ── Ingestion hooks ──────────────────────────────────────────────────────────

/// Record a session ingestion created, inside the ingestion transaction. A
/// light session gets its calibration record with matching pending and its
/// camera's defaults; a calibration session is linked to its camera by
/// model, and the sessions still waiting are matched again (LIB-FR-25).
/// Frames of unknown type record nothing until their type is known.
pub async fn session_ingested(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    members: &BTreeSet<Uuid>,
    assets: &[Asset],
) -> Result<()> {
    let mut members = assets.iter().filter(|asset| members.contains(&asset.id));
    let first = members
        .clone()
        .find(|asset| asset.availability != Availability::Retired)
        .or_else(|| members.next());
    match first.and_then(|asset| asset.effective.is_light()) {
        Some(true) => {
            sqlx::query(
                "INSERT INTO session_calibration (session_id, generation, matching_pending, \
                 updated_at) VALUES (?1, 1, 1, ?2) ON CONFLICT (session_id) DO NOTHING",
            )
            .bind(session_id.to_string())
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            camera_defaults(conn, session_id).await
        }
        Some(false) => {
            link_session_camera_by_model(conn, session_id).await?;
            calibration_arrived(conn).await
        }
        None => Ok(()),
    }
}

/// Calibration arrived (a raw set grew or was created, or a master was
/// adopted): every current session with a kind still waiting is matched
/// again. Pins and No choices are never touched.
pub async fn calibration_arrived(conn: &mut SqliteConnection) -> Result<()> {
    sqlx::query(
        "UPDATE session_calibration SET matching_pending = 1, updated_at = ?1 \
         WHERE matching_pending = 0 \
         AND session_id IN (SELECT id FROM sessions WHERE superseded_by IS NULL) \
         AND session_id IN (SELECT session_id FROM session_calibration_kinds \
             WHERE state IN ('unresolved', 'suggested'))",
    )
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// A session's rig was confirmed or its rig version recorded: its camera's
/// defaults apply to waiting kinds, and it is matched again for the rig
/// version and camera it now has.
pub async fn rig_recorded(conn: &mut SqliteConnection, session_id: Uuid) -> Result<()> {
    let recorded = sqlx::query(
        "UPDATE session_calibration SET matching_pending = 1, updated_at = ?2 \
         WHERE session_id = ?1",
    )
    .bind(session_id.to_string())
    .bind(now()?)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if recorded > 0 {
        camera_defaults(conn, session_id).await?;
    }
    Ok(())
}

/// A master was adopted with digest `sha256`: Processing offers of those
/// bytes read adopted, and waiting sessions are matched again.
pub async fn master_adopted(conn: &mut SqliteConnection, sha256: &str) -> Result<()> {
    let offers: Vec<String> = sqlx::query_scalar(
        "SELECT offer FROM processing_master_offers WHERE sha256 = ?1 AND state <> 'adopted'",
    )
    .bind(sha256)
    .fetch_all(&mut *conn)
    .await?;
    let at = now()?;
    for offer in offers {
        let mut offer: ProcessingMasterOffer = from_json(&offer)?;
        offer.state = platevault_model::MasterOfferState::Adopted;
        offer.decided_at = Some(at.clone());
        write_offer(conn, &offer).await?;
    }
    calibration_arrived(conn).await
}

/// Write the camera's "Don't use darks" and "Don't use bias" as No on the
/// kinds still waiting (CAL-FR-22); a pin or the user's choice stays.
async fn camera_defaults(conn: &mut SqliteConnection, session_id: Uuid) -> Result<()> {
    let Some(camera) = load_session_camera(conn, session_id).await? else { return Ok(()) };
    let calibration = read_calibration(conn, session_id).await?;
    let at = now()?;
    for kind in [InputKind::Dark, InputKind::Bias] {
        if let Some(state) = camera_default(&camera, kind, calibration.kind(kind)) {
            write_kind(conn, session_id, kind, &state, &at).await?;
        }
    }
    Ok(())
}

/// The No a camera default gives a waiting kind.
fn camera_default(camera: &Camera, kind: InputKind, current: &PinState) -> Option<PinState> {
    let declined = match kind {
        InputKind::Dark => camera.no_darks,
        InputKind::Bias => camera.no_bias,
        InputKind::Flat => false,
    };
    (declined && waiting(current))
        .then_some(PinState::Declined { origin: DeclineOrigin::CameraDefault })
}

/// Unresolved or only suggested: what matching may fill.
const fn waiting(state: &PinState) -> bool {
    matches!(state, PinState::Unresolved | PinState::Suggested { .. })
}

// ── Matching ─────────────────────────────────────────────────────────────────

/// The current sessions whose matching is pending, in id order.
async fn pending_sessions(conn: &mut SqliteConnection) -> Result<Vec<Uuid>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT session_id FROM session_calibration WHERE matching_pending = 1 ORDER BY session_id",
    )
    .fetch_all(&mut *conn)
    .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

/// What matching reads once per pass.
struct Facts {
    settings: WorkflowSettings,
    cameras: Vec<Camera>,
    inputs: Vec<SessionInput>,
}

impl Facts {
    async fn read<R: CalibrationRules + ?Sized>(
        conn: &mut SqliteConnection,
        rules: &R,
        digests: &Digests,
    ) -> Result<Self> {
        let (settings, _) = read_workflow_settings(conn).await?;
        let cameras = load_cameras(conn).await?;
        let inputs = session_inputs(conn, rules, &cameras, digests).await?;
        Ok(Self { settings, cameras, inputs })
    }
}

/// The new state of every waiting kind of one pending session, or `None`
/// when the session is superseded or no longer a light session.
async fn planned<R: CalibrationRules + ?Sized>(
    conn: &mut SqliteConnection,
    rules: &R,
    facts: &Facts,
    session_id: Uuid,
) -> Result<Option<Vec<(InputKind, PinState)>>> {
    if load_session_row(conn, session_id).await?.superseded_by.is_some() {
        return Ok(None);
    }
    let Some(light) = session_light(conn, session_id, &facts.cameras).await? else {
        return Ok(None);
    };
    let calibration = read_calibration(conn, session_id).await?;
    let camera = load_session_camera(conn, session_id).await?;
    let mut states = Vec::new();
    for kind in KINDS {
        let current = calibration.kind(kind);
        if !waiting(current) {
            continue;
        }
        let state = match camera.as_ref().and_then(|camera| camera_default(camera, kind, current)) {
            Some(declined) => declined,
            None => rules.match_session(kind, &light, &facts.inputs, &facts.settings).state(),
        };
        if state != *current {
            states.push((kind, state));
        }
    }
    Ok(Some(states))
}

/// One frame to hash: its asset, location root, path and recorded observation.
struct FrameWork {
    asset_id: Uuid,
    root: SourceRoot,
    relative: PathBuf,
    fingerprint: ObservationFingerprint,
}

/// The frames the pending sessions' new pins and suggestions bind that have
/// no recorded digest.
async fn unhashed_work<R: CalibrationRules + ?Sized>(
    conn: &mut SqliteConnection,
    rules: &R,
) -> Result<Vec<FrameWork>> {
    let pending = pending_sessions(conn).await?;
    if pending.is_empty() {
        return Ok(Vec::new());
    }
    let facts = Facts::read(conn, rules, &Digests::new()).await?;
    let mut work = Vec::new();
    let mut seen = BTreeSet::new();
    for session_id in pending {
        let Some(states) = planned(conn, rules, &facts, session_id).await? else { continue };
        for target in states.iter().filter_map(|(_, state)| state.target()) {
            for frame in frames_to_hash(conn, target).await? {
                if seen.insert(frame.asset_id) {
                    work.push(frame);
                }
            }
        }
    }
    Ok(work)
}

/// A target's raw-set frames with no digest yet.
async fn frames_to_hash(conn: &mut SqliteConnection, target: &PinTarget) -> Result<Vec<FrameWork>> {
    let ids: BTreeSet<Uuid> = target
        .files
        .iter()
        .filter(|file| file.sha256.is_empty())
        .filter_map(|file| file.asset_id)
        .collect();
    let mut work = Vec::with_capacity(ids.len());
    for asset in load_assets(conn, &ids).await? {
        let location = load_location(conn, asset.location_id).await?;
        work.push(FrameWork {
            asset_id: asset.id,
            relative: asset.relative_path.relative_path()?,
            root: SourceRoot::new(location)?,
            fingerprint: asset.fingerprint,
        });
    }
    Ok(work)
}

/// Hash each frame against its recorded observation, outside the writer. A
/// frame that can't be read, or that changed, is left out.
async fn hash_frames<P: SourceProbe>(work: Vec<FrameWork>, probe: P) -> Result<Digests> {
    if work.is_empty() {
        return Ok(Digests::new());
    }
    blocking(move || {
        let mut roots: BTreeMap<Uuid, bool> = BTreeMap::new();
        let mut digests = Digests::new();
        for frame in work {
            let verified = *roots
                .entry(frame.root.location.id)
                .or_insert_with(|| frame.root.verify(&probe).is_ok());
            if !verified {
                continue;
            }
            if let Ok(sha256) =
                current_digest(&frame.root, &frame.relative, &frame.fingerprint, &probe)
            {
                digests.insert(frame.asset_id, (sha256, frame.fingerprint));
            }
        }
        Ok(digests)
    })
    .await
}

/// Match and write every pending session in the writer's transaction. A
/// kind whose match still lacks a digest is not written and keeps its
/// session pending.
async fn reconcile<R: CalibrationRules + ?Sized>(
    conn: &mut SqliteConnection,
    rules: &R,
    digests: &Digests,
) -> Result<Vec<Uuid>> {
    let pending = pending_sessions(conn).await?;
    if pending.is_empty() {
        return Ok(Vec::new());
    }
    let facts = Facts::read(conn, rules, digests).await?;
    let at = now()?;
    let mut matched = Vec::new();
    for session_id in pending {
        let mut complete = true;
        if let Some(states) = planned(conn, rules, &facts, session_id).await? {
            for (kind, state) in states {
                if state.target().is_some_and(|target| !hashed(target)) {
                    complete = false;
                    continue;
                }
                if let Some(target) = state.target() {
                    record_digests(conn, target, &at).await?;
                }
                write_kind(conn, session_id, kind, &state, &at).await?;
            }
            matched.push(session_id);
        }
        if complete {
            sqlx::query(
                "UPDATE session_calibration SET matching_pending = 0, updated_at = ?2 \
                 WHERE session_id = ?1",
            )
            .bind(session_id.to_string())
            .bind(&at)
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(matched)
}

/// Every file of the target carries its digest.
fn hashed(target: &PinTarget) -> bool {
    target.files.iter().all(|file| !file.sha256.is_empty())
}

/// Record the digests matching hashed on the raw-set frames a target binds,
/// as a verification records them (D19).
async fn record_digests(conn: &mut SqliteConnection, target: &PinTarget, at: &str) -> Result<()> {
    for file in &target.files {
        let Some(asset_id) = file.asset_id else { continue };
        sqlx::query(
            "UPDATE assets SET fingerprint = ?1, last_verified_at = ?2 \
             WHERE id = ?3 AND json_extract(fingerprint, '$.contentSha256') IS NULL",
        )
        .bind(to_json(&file.fingerprint)?)
        .bind(at)
        .bind(asset_id.to_string())
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// The pin a reassignment writes: `input` evaluated against the session,
/// refused when a hard check fails.
async fn reassigned<R: CalibrationRules + ?Sized>(
    conn: &mut SqliteConnection,
    rules: &R,
    session_id: Uuid,
    kind: InputKind,
    input: InputRef,
    digests: &Digests,
) -> Result<PinTarget> {
    load_session_row(conn, session_id).await?;
    let facts = Facts::read(conn, rules, digests).await?;
    let candidate = facts
        .inputs
        .iter()
        .find(|candidate| candidate.input.id() == input.id())
        .ok_or_else(|| LibraryError::NotFound(format!("calibration input {}", input.id())))?;
    if candidate.input != input {
        return Err(LibraryError::Conflict {
            id: input.id(),
            current: candidate.input.revision(),
            successors: Vec::new(),
        });
    }
    if candidate.kind != kind {
        return Err(LibraryError::InvalidInput(format!(
            "{} holds {} frames, not {}",
            input_label(&input),
            candidate.kind.as_str(),
            kind.as_str()
        )));
    }
    let light = session_light(conn, session_id, &facts.cameras).await?.ok_or_else(|| {
        LibraryError::InvalidInput(format!("session {session_id} is not a light session"))
    })?;
    let offered =
        rules.match_session(kind, &light, std::slice::from_ref(candidate), &facts.settings);
    offered.offers.into_iter().next().map(|offer| offer.target).ok_or_else(|| {
        LibraryError::InvalidInput(format!(
            "{} fails a hard {} check for session {session_id}",
            input_label(&input),
            kind.as_str()
        ))
    })
}

// ── Facts ────────────────────────────────────────────────────────────────────

/// The calendar date of a capture key's night.
fn key_night(key: &CaptureKey) -> Option<Date> {
    Date::parse(night_of(key)?.split('@').next()?, DATE).ok()
}

/// The date part of a header date such as DATE-OBS.
fn header_date(text: Option<&str>) -> Option<Date> {
    Date::parse(text?.get(..10)?, DATE).ok()
}

/// The camera one side names: a confirmed link, a model link while its model
/// still names one camera, else the one camera of the header model.
fn match_camera(cameras: &[Camera], link: Option<CameraLink>, model: Option<&str>) -> MatchCamera {
    let by_model =
        |model: Option<&str>| match model.map(|model| Camera::resolve_model(cameras, model)) {
            Some(CameraResolution::Model { camera_id }) => MatchCamera::Known { camera_id },
            Some(CameraResolution::Choose { .. }) => MatchCamera::Ambiguous,
            Some(CameraResolution::Unknown) | None => MatchCamera::Unlinked,
        };
    match link {
        Some(CameraLink { camera_id, basis: CameraBasis::Confirmed }) => {
            MatchCamera::Known { camera_id }
        }
        Some(CameraLink { camera_id, basis: CameraBasis::Model }) => {
            let model = cameras.iter().find(|camera| camera.id == camera_id).map(|c| &c.model);
            match by_model(model.map(String::as_str)) {
                MatchCamera::Known { camera_id: only } if only == camera_id => {
                    MatchCamera::Known { camera_id }
                }
                _ => MatchCamera::Ambiguous,
            }
        }
        None => by_model(model),
    }
}

/// One light session's side of a match; `None` when it is not a light
/// session of known type.
async fn session_light(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    cameras: &[Camera],
) -> Result<Option<SessionLight>> {
    let members = current_member_assets(conn, session_id).await?;
    let ids: BTreeSet<Uuid> = members.iter().map(|asset| asset.id).collect();
    let Some(basis) = light_basis(conn, session_id, &ids).await? else { return Ok(None) };
    if !basis.light_type_known {
        return Ok(None);
    }
    let row = load_session_row(conn, session_id).await?;
    let rig = match super::confirmed_equipment(conn, session_id).await? {
        Some(rig_id) => Some(LightRig {
            rig_id,
            version: load_session_rig_version(conn, session_id).await?,
            versions: load_rig_versions(conn, rig_id).await?,
        }),
        None => None,
    };
    let recorded = rig
        .as_ref()
        .and_then(|rig| rig.version.as_ref())
        .and_then(|version| version.optics.camera_id);
    let model = members.iter().find_map(|asset| asset.effective.camera.clone());
    let camera = match recorded {
        Some(camera_id) => MatchCamera::Known { camera_id },
        None => match_camera(cameras, None, model.as_deref()),
    };
    let rotator_deg = row
        .session
        .framing
        .as_ref()
        .and_then(|framing| framing.rotator_deg)
        .or_else(|| members.iter().find_map(|asset| asset.effective.mechanical_rotation_deg));
    Ok(Some(SessionLight {
        session_id,
        capture: basis.evidence.capture,
        night: key_night(&row.session.key),
        camera,
        rig,
        rotator_deg,
    }))
}

/// Every raw set and adopted master a light session may use. Superseded raw
/// sets, drifted masters and detected candidates are never inputs. A frame
/// with no recorded digest takes the one matching hashed, if its
/// observation is unchanged, and otherwise an empty digest that keeps a
/// target from being written.
async fn session_inputs<R: CalibrationRules + ?Sized>(
    conn: &mut SqliteConnection,
    rules: &R,
    cameras: &[Camera],
    digests: &Digests,
) -> Result<Vec<SessionInput>> {
    let mut inputs = Vec::new();
    for listed in inventory::list_inputs(conn, rules).await? {
        let summary = &listed.summary;
        if summary.state.superseded || summary.state.drifted {
            continue;
        }
        let Some(input) = summary.input.input() else { continue };
        let side = match input {
            InputRef::RawSet { session_id, .. } => {
                raw_set_side(conn, session_id, &listed, cameras, digests).await?
            }
            InputRef::Master { master_id, .. } => master_side(conn, master_id, cameras).await?,
        };
        inputs.push(SessionInput {
            input,
            kind: summary.kind,
            capture: summary.evidence.clone(),
            captured: side.captured,
            camera: side.camera,
            rig_version_id: side.rig_version_id,
            rotator_deg: side.rotator_deg,
            files: side.files,
            available: summary.state.available(),
        });
    }
    Ok(inputs)
}

/// What an input side adds to its inventory listing.
struct InputSide {
    captured: Option<Date>,
    camera: MatchCamera,
    rig_version_id: Option<Uuid>,
    rotator_deg: Vec<Option<f64>>,
    files: Vec<PinnedFile>,
}

async fn raw_set_side(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    listed: &Listed,
    cameras: &[Camera],
    digests: &Digests,
) -> Result<InputSide> {
    let row = load_session_row(conn, session_id).await?;
    let chosen: BTreeSet<Uuid> = listed
        .members
        .iter()
        .filter_map(|member| {
            member
                .copies
                .iter()
                .find(|copy| copy.availability == Availability::Available)
                .or_else(|| member.copies.first())
                .map(|copy| copy.asset_id)
        })
        .collect();
    let assets = load_assets(conn, &chosen).await?;
    let model = assets.iter().find_map(|asset| asset.effective.camera.clone());
    let link = load_session_camera_link(conn, session_id).await?;
    let files = assets
        .iter()
        .map(|asset| {
            let mut fingerprint = asset.fingerprint.clone();
            if fingerprint.content_sha256.is_none() {
                fingerprint.content_sha256 = digests
                    .get(&asset.id)
                    .filter(|(_, hashed)| fingerprint_matches(&asset.fingerprint, hashed))
                    .map(|(sha256, _)| sha256.clone());
            }
            PinnedFile {
                asset_id: Some(asset.id),
                sha256: fingerprint.content_sha256.clone().unwrap_or_default(),
                fingerprint,
            }
        })
        .collect();
    Ok(InputSide {
        captured: key_night(&row.session.key),
        camera: match_camera(cameras, link, model.as_deref()),
        rig_version_id: load_session_rig_version(conn, session_id).await?.map(|version| version.id),
        rotator_deg: assets.iter().map(|asset| asset.effective.mechanical_rotation_deg).collect(),
        files,
    })
}

async fn master_side(
    conn: &mut SqliteConnection,
    master_id: Uuid,
    cameras: &[Camera],
) -> Result<InputSide> {
    let master = load_master(conn, master_id).await?;
    let row = sqlx::query(
        "SELECT content_sha256, camera_id, camera_basis FROM adopted_masters WHERE id = ?1",
    )
    .bind(master_id.to_string())
    .fetch_one(&mut *conn)
    .await?;
    let sha256: String = row.try_get("content_sha256")?;
    let link = match (
        row.try_get::<Option<String>, _>("camera_id")?,
        row.try_get::<Option<String>, _>("camera_basis")?,
    ) {
        (Some(camera_id), Some(basis)) => {
            Some(CameraLink { camera_id: parse_uuid(&camera_id)?, basis: from_text(&basis)? })
        }
        _ => None,
    };
    let observed = &master.observed;
    let mut fingerprint = master.fingerprint.clone();
    fingerprint.content_sha256 = Some(sha256.clone());
    Ok(InputSide {
        captured: header_date(observed.date_obs.as_deref())
            .or_else(|| header_date(observed.date_local.as_deref())),
        camera: match_camera(cameras, link, observed.camera.as_deref()),
        rig_version_id: None,
        rotator_deg: vec![observed.mechanical_rotation_deg],
        files: vec![PinnedFile { asset_id: None, sha256, fingerprint }],
    })
}

// ── Writes ───────────────────────────────────────────────────────────────────

/// The session's calibration when its generation is `expected`.
async fn require_generation(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    expected: Revision,
) -> Result<SessionCalibration> {
    let row = load_session_row(conn, session_id).await?;
    let calibration = read_calibration(conn, session_id).await?;
    if row.superseded_by.is_some() {
        return Err(LibraryError::Conflict {
            id: session_id,
            current: calibration.generation,
            successors: successors_of(conn, &row).await?,
        });
    }
    if calibration.generation == 0 {
        return Err(LibraryError::InvalidInput(format!(
            "session {session_id} is not a light session with calibration"
        )));
    }
    if calibration.generation != expected {
        return Err(LibraryError::Conflict {
            id: session_id,
            current: calibration.generation,
            successors: Vec::new(),
        });
    }
    Ok(calibration)
}

/// Write one kind's state; the schema advances the session's generation.
async fn write_kind(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    kind: InputKind,
    state: &PinState,
    at: &str,
) -> Result<()> {
    if let Some(target) = state.target() {
        target.validate()?;
    }
    let (raw_set, master, input_revision) = match state.target().map(|target| target.input) {
        Some(InputRef::RawSet { session_id, grouping_revision }) => {
            (Some(session_id.to_string()), None, Some(crate::db_revision(grouping_revision)?))
        }
        Some(InputRef::Master { master_id, revision }) => {
            (None, Some(master_id.to_string()), Some(crate::db_revision(revision)?))
        }
        None => (None, None, None),
    };
    sqlx::query(
        "UPDATE session_calibration_kinds SET state = ?3, input_session_id = ?4, \
         input_master_id = ?5, input_revision = ?6, pin = ?7, decided_at = ?8 \
         WHERE session_id = ?1 AND kind = ?2",
    )
    .bind(session_id.to_string())
    .bind(to_text(&kind)?)
    .bind(state.name())
    .bind(raw_set)
    .bind(master)
    .bind(input_revision)
    .bind(to_json(state)?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE session_calibration SET updated_at = ?2 WHERE session_id = ?1")
        .bind(session_id.to_string())
        .bind(at)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

// ── Health and the queue ─────────────────────────────────────────────────────

/// Whether a pin's files still hold what it recorded, from the catalog's
/// latest observation of them (D-W113): a file the catalog records as
/// missing, trashed or retired, or a pinned master gone from the library, is
/// missing; one whose observation or digest differs is changed. An offline
/// file makes no claim; Apply re-reads every file it places. This is the one
/// statement of a pin's health for Needs calibration, session details and
/// admission.
///
/// # Errors
/// `PersistenceFailure` for a corrupt record.
pub async fn pin_health(conn: &mut SqliteConnection, target: &PinTarget) -> Result<PinHealth> {
    let observed: Vec<(Option<Asset>, &PinnedFile)> = match target.input {
        InputRef::RawSet { .. } => {
            let ids: BTreeSet<Uuid> =
                target.files.iter().filter_map(|file| file.asset_id).collect();
            let mut assets: HashMap<Uuid, Asset> =
                load_assets(conn, &ids).await?.into_iter().map(|asset| (asset.id, asset)).collect();
            target
                .files
                .iter()
                .map(|file| (file.asset_id.and_then(|id| assets.remove(&id)), file))
                .collect()
        }
        InputRef::Master { master_id, .. } => {
            let Some(copy) = master_copy(conn, master_id).await? else {
                return Ok(PinHealth::Missing);
            };
            let Some(file) = target.files.first() else { return Ok(PinHealth::Missing) };
            match copy {
                Some(asset) => vec![(Some(asset), file)],
                None => Vec::new(),
            }
        }
    };
    let mut health = PinHealth::Intact;
    for (asset, file) in observed {
        let file_health = match asset {
            None => PinHealth::Missing,
            Some(asset) => match asset.availability {
                Availability::Missing | Availability::Trashed | Availability::Retired => {
                    PinHealth::Missing
                }
                Availability::Offline
                | Availability::Unreadable
                | Availability::IdentityConflict => PinHealth::Intact,
                Availability::Available
                    if fingerprint_matches(&asset.fingerprint, &file.fingerprint) =>
                {
                    PinHealth::Intact
                }
                Availability::Available => PinHealth::Changed,
            },
        };
        health = match (health, file_health) {
            (PinHealth::Missing, _) | (_, PinHealth::Missing) => PinHealth::Missing,
            (PinHealth::Changed, _) | (_, PinHealth::Changed) => PinHealth::Changed,
            (PinHealth::Intact, PinHealth::Intact) => PinHealth::Intact,
        };
    }
    Ok(health)
}

/// A pinned master's library copy as a scan last observed it: `None` when
/// the master left the library, `Some(None)` while no scan indexed the copy.
async fn master_copy(
    conn: &mut SqliteConnection,
    master_id: Uuid,
) -> Result<Option<Option<Asset>>> {
    let row = sqlx::query("SELECT location_id, path_key FROM adopted_masters WHERE id = ?1")
        .bind(master_id.to_string())
        .fetch_optional(&mut *conn)
        .await?;
    let Some(row) = row else { return Ok(None) };
    let asset: Option<String> = sqlx::query_scalar(
        "SELECT id FROM assets WHERE location_id = ?1 AND path_key = ?2 \
         ORDER BY availability = 'available' DESC, last_observed_at DESC LIMIT 1",
    )
    .bind(row.try_get::<String, _>("location_id")?)
    .bind(row.try_get::<Vec<u8>, _>("path_key")?)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(asset) = asset else { return Ok(Some(None)) };
    let ids = BTreeSet::from([parse_uuid(&asset)?]);
    Ok(Some(load_assets(conn, &ids).await?.into_iter().next()))
}

/// Each pinned kind's health.
///
/// # Errors
/// `PersistenceFailure` for a corrupt record.
pub async fn read_health(
    conn: &mut SqliteConnection,
    calibration: &SessionCalibration,
) -> Result<CalibrationHealth> {
    let mut health = CalibrationHealth::INTACT;
    for kind in KINDS {
        let PinState::Pinned { target, .. } = calibration.kind(kind) else { continue };
        let observed = pin_health(conn, target).await?;
        match kind {
            InputKind::Bias => health.bias = observed,
            InputKind::Dark => health.dark = observed,
            InputKind::Flat => health.flat = observed,
        }
    }
    Ok(health)
}

/// Why a listed session waits in Needs calibration: a session with no
/// record reads every kind unresolved.
pub async fn session_needs(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Vec<CalibrationNeed>> {
    let calibration = read_calibration(conn, session_id).await?;
    let health = read_health(conn, &calibration).await?;
    Ok(calibration.needs(|kind| health.kind(kind)))
}

// ── Projects ─────────────────────────────────────────────────────────────────

async fn project_calibration_changes(
    conn: &mut SqliteConnection,
    project_id: Uuid,
) -> Result<Vec<PendingChange>> {
    let lifecycle: Option<String> =
        sqlx::query_scalar("SELECT lifecycle FROM projects WHERE id = ?1")
            .bind(project_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    let lifecycle: ProjectLifecycle = from_text(
        &lifecycle.ok_or_else(|| LibraryError::NotFound(format!("project {project_id}")))?,
    )?;
    if !lifecycle.is_open() {
        return Ok(Vec::new());
    }
    let basis: Option<String> = sqlx::query_scalar(
        "SELECT basis FROM view_manifests WHERE project_id = ?1 AND state = 'installed'",
    )
    .bind(project_id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    let Some(basis) = basis else { return Ok(Vec::new()) };
    let basis: ProjectBasis = from_json(&basis)?;
    let mut changes = Vec::new();
    for session in basis.groups.iter().flat_map(|group| &group.sessions) {
        let current = read_calibration(conn, session.session_id).await?;
        changes.extend(current.changes_since(&session.calibration));
    }
    Ok(changes)
}

/// "raw set <id>" or "master <id>".
fn input_label(input: &InputRef) -> String {
    match input {
        InputRef::RawSet { session_id, .. } => format!("raw set {session_id}"),
        InputRef::Master { master_id, .. } => format!("master {master_id}"),
    }
}

/// The id column of the pin index an input uses.
const fn input_column(input: &InputRef) -> &'static str {
    match input {
        InputRef::RawSet { .. } => "input_session_id",
        InputRef::Master { .. } => "input_master_id",
    }
}

async fn input_use(conn: &mut SqliteConnection, input: &InputRef) -> Result<CalibrationInputUse> {
    let column = input_column(input);
    let sessions: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT DISTINCT session_id FROM session_calibration_kinds \
         WHERE {column} = ?1 AND state = 'pinned' ORDER BY session_id"
    )))
    .bind(input.id().to_string())
    .fetch_all(&mut *conn)
    .await?;
    let id_key = match input {
        InputRef::RawSet { .. } => "sessionId",
        InputRef::Master { .. } => "masterId",
    };
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT p.id, p.name, p.lifecycle FROM projects p WHERE p.id IN ( \
             SELECT ps.project_id FROM project_sessions ps \
             JOIN session_calibration_kinds k ON k.session_id = ps.session_id \
             WHERE k.{column} = ?1 AND k.state = 'pinned' \
             UNION SELECT s.project_id FROM project_snapshots s, json_tree(s.snapshot) t \
             WHERE t.key = '{id_key}' AND t.value = ?1) \
         ORDER BY p.name, p.id"
    )))
    .bind(input.id().to_string())
    .fetch_all(&mut *conn)
    .await?;
    let projects = rows
        .iter()
        .map(|row| {
            Ok(CalibrationInputProject {
                project_id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                name: row.try_get("name")?,
                lifecycle: from_text(&row.try_get::<String, _>("lifecycle")?)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(CalibrationInputUse {
        projects,
        sessions: sessions.iter().map(|id| parse_uuid(id)).collect::<Result<_>>()?,
    })
}

async fn release_input(conn: &mut SqliteConnection, input: &InputRef) -> Result<Vec<Uuid>> {
    let used = input_use(conn, input).await?;
    if !used.projects.is_empty() {
        let names: Vec<&str> = used.projects.iter().map(|project| project.name.as_str()).collect();
        return Err(LibraryError::InvalidInput(format!(
            "{} is used by the Project(s) {}",
            input_label(input),
            names.join(", ")
        )));
    }
    let column = input_column(input);
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT session_id, kind FROM session_calibration_kinds \
         WHERE {column} = ?1 AND state IN ('pinned', 'suggested') ORDER BY session_id, kind"
    )))
    .bind(input.id().to_string())
    .fetch_all(&mut *conn)
    .await?;
    let at = now()?;
    let mut released = BTreeSet::new();
    for row in rows {
        let session_id = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
        let kind: InputKind = from_text(&row.try_get::<String, _>("kind")?)?;
        write_kind(conn, session_id, kind, &PinState::Unresolved, &at).await?;
        released.insert(session_id);
    }
    for session_id in &released {
        sqlx::query(
            "UPDATE session_calibration SET matching_pending = 1, updated_at = ?2 \
             WHERE session_id = ?1 AND matching_pending = 0",
        )
        .bind(session_id.to_string())
        .bind(&at)
        .execute(&mut *conn)
        .await?;
    }
    Ok(released.into_iter().collect())
}

// ── Processing master offers ─────────────────────────────────────────────────

async fn load_offer(conn: &mut SqliteConnection, offer_id: Uuid) -> Result<ProcessingMasterOffer> {
    let offer: Option<String> =
        sqlx::query_scalar("SELECT offer FROM processing_master_offers WHERE id = ?1")
            .bind(offer_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    from_json(&offer.ok_or_else(|| LibraryError::NotFound(format!("master offer {offer_id}")))?)
}

async fn write_offer(conn: &mut SqliteConnection, offer: &ProcessingMasterOffer) -> Result<()> {
    offer.validate()?;
    sqlx::query(
        "UPDATE processing_master_offers SET offer = ?2, state = ?3, decided_at = ?4 WHERE id = ?1",
    )
    .bind(offer.id.to_string())
    .bind(to_json(offer)?)
    .bind(to_text(&offer.state)?)
    .bind(offer.decided_at.as_deref())
    .execute(&mut *conn)
    .await?;
    Ok(())
}
