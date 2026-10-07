// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Processing runs (spec 066, amended D-W1..D-W74): Tier 1 reviewed membership
//! in the clean catalog. A run (View) lives in one Project, on one subject and
//! one of the Project's rigs, fixed at creation. It holds immutable committed
//! revisions and at most one durable draft. Every write is one `BEGIN
//! IMMEDIATE` transaction on the FULL-synchronous writer that checks the
//! expected revisions and every referenced record first, so a refusal writes
//! nothing. Run writes touch only the run tables, except the decisions a Review
//! step mark writes beside its draft change: no session, association, Target or
//! Project row, and no file. Members are logical captures (D16) whose starting
//! state comes from their applicable quality inside the write transaction (D02)
//! and is then kept. The picker offers only the subject's candidates on the
//! run's rig (D-W33, D-W37), and a run starts with every available one
//! selected (D-W49).

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    initial_member_state, ApplicableQuality, AssessedMembers, Asset, AssetReference, Availability,
    CandidateCapture, CaptureCopy, CopyState, DraftEdit, Equipment, ExpectedAsset, ExpectedSession,
    FrameEvidence, FramingTarget, LibraryError, MemberBasis, MemberCopy, MemberReason, MemberState,
    Membership, NewView, ObservationFingerprint, ProjectMember, ProjectRejection, Quality,
    ReferenceKind, RefreshItem, RefreshItemKind, RefreshReview, RefreshState, RejectScope,
    RejectionMark, RemapItem, ReviewDecision, ReviewMark, ReviewMarkOutcome, Revision,
    RunCompletion, RunStage, SelectionReason, Session, SessionChoice, SessionChoiceState, View,
    ViewCriteria, ViewDraftHeader, ViewListing, ViewMember, ViewQuery, ViewRecord, ViewRevision,
    ViewRevisionHeader,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    check_expected_assets, check_expected_sessions, conflict, current_member_assets, db_revision,
    decide_quality, fingerprint_matches, from_json, from_text, json_ids, load_asset, load_assets,
    load_equipment, load_session_row, load_target, now, parse_uuid, projects, require_decidable,
    require_revision, require_unique_assets, revision, successors_of, summarize_rows, to_json,
    to_text, CaptureView, Catalog, Members, Result, SessionSummary, SourceProbe, MAX_PAGE,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

// ---------------------------------------------------------------------------
// Read models holding session summaries
// ---------------------------------------------------------------------------

/// One candidate of a run: a current session whose confirmed Target is the
/// subject's Target and whose confirmed rig is the run's rig, with its frames
/// outside the Trash.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSession {
    pub summary: SessionSummary,
    pub captures: Vec<CandidateCapture>,
    /// The member observations this evidence describes.
    pub assessed: AssessedMembers,
}

impl CandidateSession {
    #[must_use]
    pub const fn session_id(&self) -> Uuid {
        self.summary.session.id
    }

    #[must_use]
    pub const fn expected(&self) -> ExpectedSession {
        ExpectedSession {
            session_id: self.summary.session.id,
            grouping_revision: self.summary.session.grouping_revision,
            decision_revision: self.summary.session.decision_revision,
        }
    }
}

/// Everything a run's picker evaluates, read from one catalog snapshot: the
/// run, the subject's Target it orders against, the run's rig and every
/// candidate of the subject on that rig. Hashes, measures and writes nothing.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateBasis {
    pub view: View,
    pub framing: FramingTarget,
    pub rig: Equipment,
    pub sessions: Vec<CandidateSession>,
}

/// A session choice with the session as the library records it now.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceBasis {
    pub choice: SessionChoice,
    /// Current summary, with successors when superseded.
    pub current: SessionSummary,
}

/// A membership (draft or committed revision) with live member state, from one
/// catalog snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MembershipBasis {
    pub view_id: Uuid,
    pub membership: Membership,
    /// The committed revision, or the draft revision.
    pub revision: Revision,
    pub criteria: ViewCriteria,
    pub sessions: Vec<ChoiceBasis>,
    pub members: Vec<MemberBasis>,
}

/// The draft row of a run.
struct DraftRow {
    row: i64,
    draft_revision: Revision,
    base_revision: Revision,
}

// ---------------------------------------------------------------------------
// Runs and drafts
// ---------------------------------------------------------------------------

impl Catalog {
    /// Create a run in its Project on one subject and one of the Project's
    /// rigs, at revision 0 with unsaved work at draft revision 1. The draft
    /// starts with every available candidate of the subject on the rig
    /// selected, each with the reason naming that Target and rig, read in the
    /// same transaction. Writes only run rows.
    ///
    /// # Errors
    /// `InvalidInput` for a blank name, a mosaic subject (it takes a run group)
    /// or a rig that is not one of the Project's rigs; `NotFound` for an
    /// unknown Project, or a subject that is not the Project's.
    pub async fn create_view(&self, input: &NewView) -> Result<ViewRecord> {
        input.validate()?;
        let record = write_txn!(self, |conn| {
            let target_id = run_subject(conn, input.project_id, input.subject_id).await?;
            require_project_rig(conn, input.project_id, input.rig_id).await?;
            let id = Uuid::new_v4();
            let at = now()?;
            sqlx::query(
                "INSERT INTO views (id, project_id, subject_id, rig_id, stage, completion, \
                 calibration_policy, revision, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?8)",
            )
            .bind(id.to_string())
            .bind(input.project_id.to_string())
            .bind(input.subject_id.to_string())
            .bind(input.rig_id.to_string())
            .bind(to_text(&RunStage::Select)?)
            .bind(to_text(&RunCompletion::Open)?)
            .bind(to_text(&platevault_model::CalibrationPolicy::Automatic)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            let criteria = ViewCriteria { target_id, rig_id: input.rig_id, panel_id: None };
            let row = sqlx::query(
                "INSERT INTO view_revisions (view_id, state, draft_revision, base_revision, name, \
                 criteria, updated_at) VALUES (?1, 'draft', 1, 0, ?2, ?3, ?4)",
            )
            .bind(id.to_string())
            .bind(input.name.trim())
            .bind(to_json(&criteria)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?
            .last_insert_rowid();
            let view = load_view(conn, id).await?;
            let reason = SelectionReason::Candidate { target_id, rig_id: input.rig_id };
            for candidate in run_candidates(conn, &view).await? {
                let assets = current_member_assets(conn, candidate).await?;
                if assets.iter().any(|asset| asset.availability == Availability::Available) {
                    let session = load_session_row(conn, candidate).await?.session;
                    select_session(conn, row, &session, &reason, None).await?;
                }
            }
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// Move a run to another pipeline step (VSEL-FR-02). An open run moves
    /// freely among Select to Done; a Complete run only between Done and Clean
    /// up. Changes no membership.
    ///
    /// # Errors
    /// `InvalidInput` for a run in the Project's Trash, Clean up on an open run
    /// or a step before Done on a Complete run; `NotFound` for an unknown run.
    pub async fn set_view_stage(&self, id: Uuid, stage: RunStage) -> Result<ViewRecord> {
        let record = write_txn!(self, |conn| {
            let view = load_view(conn, id).await?;
            require_live(&view)?;
            let allowed = match view.completion {
                RunCompletion::Open => stage != RunStage::CleanUp,
                RunCompletion::Complete => matches!(stage, RunStage::Done | RunStage::CleanUp),
            };
            if !allowed {
                return Err(invalid(format!(
                    "run {id} is {:?} and cannot move to {stage:?}",
                    view.completion
                )));
            }
            sqlx::query("UPDATE views SET stage = ?2, updated_at = ?3 WHERE id = ?1")
                .bind(id.to_string())
                .bind(to_text(&stage)?)
                .bind(now()?)
                .execute(&mut *conn)
                .await?;
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// Apply one edit to the run's unsaved work. With `expected_draft` 0 and no
    /// draft, the edit starts a draft from the latest committed revision.
    /// Committed revisions never change. Only candidates of the run's subject
    /// on its rig can be selected.
    ///
    /// # Errors
    /// `Conflict` carrying the current draft revision (0 without a draft) for a
    /// stale `expected_draft`, and for stale or superseded sessions;
    /// `InvalidInput` for a run that is Complete or in the Trash, a blank name,
    /// invalid filters, empty or repeated ids, a session that is not one of the
    /// run's candidates or a non-member key; `NotFound` for an unknown run or
    /// session.
    pub async fn edit_view_draft(
        &self,
        id: Uuid,
        expected_draft: Revision,
        edit: &DraftEdit,
    ) -> Result<ViewRecord> {
        validate_edit(edit)?;
        let record = write_txn!(self, |conn| {
            let view = load_view(conn, id).await?;
            require_open(&view)?;
            let row = begin_edit(conn, &view, expected_draft).await?;
            apply_edit(conn, &view, row, edit).await?;
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// Commit the draft as revision n+1 when its base is the latest revision n.
    /// Draft additions take n+1 as the revision that added them. Changes no
    /// quality and creates no folder.
    ///
    /// # Errors
    /// `Conflict` carrying the committed revision for a stale `expected` or a
    /// stale draft base, and carrying the draft revision for a stale
    /// `expected_draft`; `InvalidInput` for a run that is Complete or in the
    /// Trash; `NotFound` for an unknown run.
    pub async fn save_view(
        &self,
        id: Uuid,
        expected: Revision,
        expected_draft: Revision,
    ) -> Result<ViewRecord> {
        let record = write_txn!(self, |conn| {
            let view = load_view(conn, id).await?;
            require_open(&view)?;
            require_revision(id, view.revision, expected)?;
            let draft = require_draft(conn, id, expected_draft).await?;
            if draft.base_revision != view.revision {
                return Err(conflict(id, view.revision));
            }
            let next = view.revision + 1;
            let at = now()?;
            sqlx::query(
                "UPDATE view_members SET added_in_revision = ?2 \
                 WHERE revision_row = ?1 AND added_in_revision IS NULL",
            )
            .bind(draft.row)
            .bind(db_revision(next)?)
            .execute(&mut *conn)
            .await?;
            sqlx::query(
                "UPDATE view_revisions SET state = 'committed', revision = ?2, \
                 committed_at = ?3, updated_at = ?3 WHERE id = ?1 AND state = 'draft'",
            )
            .bind(draft.row)
            .bind(db_revision(next)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            sqlx::query("UPDATE views SET revision = ?2, updated_at = ?3 WHERE id = ?1")
                .bind(id.to_string())
                .bind(db_revision(next)?)
                .bind(&at)
                .execute(&mut *conn)
                .await?;
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// Remove the unsaved work. A run that was never saved is removed with it,
    /// and `None` is returned.
    ///
    /// # Errors
    /// `Conflict` carrying the current draft revision for a stale
    /// `expected_draft`; `NotFound` for an unknown run.
    pub async fn discard_view_draft(
        &self,
        id: Uuid,
        expected_draft: Revision,
    ) -> Result<Option<ViewRecord>> {
        let record = write_txn!(self, |conn| {
            let view = load_view(conn, id).await?;
            let draft = require_draft(conn, id, expected_draft).await?;
            delete_revision_rows(conn, draft.row).await?;
            if view.revision == 0 {
                sqlx::query("DELETE FROM views WHERE id = ?1")
                    .bind(id.to_string())
                    .execute(&mut *conn)
                    .await?;
                None
            } else {
                Some(load_record(conn, id).await?)
            }
        });
        Ok(record)
    }

    /// The run with its latest committed revision and its draft, read separately.
    ///
    /// # Errors
    /// `NotFound` for an unknown run.
    pub async fn view(&self, id: Uuid) -> Result<ViewRecord> {
        let mut conn = self.reader().await?;
        load_record(&mut conn, id).await
    }

    /// Runs outside the Project's Trash by name, optionally of one Project.
    /// A run's name is that of its latest revision, or of its draft before the
    /// first Save. Computes no totals.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_views(&self, query: &ViewQuery) -> Result<Vec<ViewListing>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT v.*, c.committed_at, coalesce(c.name, d.name) AS name, \
             d.id IS NOT NULL AS has_draft, \
             coalesce(d.base_revision != v.revision, 0) AS draft_stale \
             FROM views v \
             LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
             LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
             WHERE v.trashed_at IS NULL AND (?1 IS NULL OR v.project_id = ?1) \
             ORDER BY name, v.id LIMIT ?2 OFFSET ?3",
        )
        .bind(query.project_id.map(|id| id.to_string()))
        .bind(i64::from(if query.limit == 0 { MAX_PAGE } else { query.limit.min(MAX_PAGE) }))
        .bind(i64::from(query.offset))
        .fetch_all(&mut *conn)
        .await?;
        rows.iter()
            .map(|row| {
                let view = view_from_row(row)?;
                Ok(ViewListing {
                    id: view.id,
                    name: row.try_get("name")?,
                    project_id: view.project_id,
                    subject_id: view.subject_id,
                    rig_id: view.rig_id,
                    group_id: view.group_id,
                    panel_id: view.panel_id,
                    stage: view.stage,
                    completion: view.completion,
                    revision: view.revision,
                    committed_at: row.try_get("committed_at")?,
                    has_draft: row.try_get("has_draft")?,
                    draft_stale: row.try_get("draft_stale")?,
                })
            })
            .collect()
    }

    /// An immutable committed revision with every choice, member, copy and
    /// review basis. Reading an older revision is never Conflict.
    ///
    /// # Errors
    /// `NotFound` for an unknown run or revision.
    pub async fn view_revision(&self, id: Uuid, revision: Revision) -> Result<ViewRevision> {
        let mut conn = self.reader().await?;
        let (row, header) = committed_header(&mut conn, id, revision).await?;
        Ok(ViewRevision {
            header,
            sessions: load_choices(&mut conn, row).await?,
            members: load_members(&mut conn, row).await?,
        })
    }

    /// The Project's members (VSEL-FR-16, PRJ-FR-08): the sessions selected in
    /// the latest committed revision of any of its runs outside the Trash, each
    /// with those runs. A candidate in no run is no member. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project.
    pub async fn project_members(&self, project: Uuid) -> Result<Vec<ProjectMember>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        projects::require_project(&mut snapshot, project).await?;
        let rows = sqlx::query(
            "SELECT c.session_id, v.id AS view_id FROM views v \
             JOIN view_revisions r ON r.view_id = v.id AND r.revision = v.revision \
             JOIN view_session_choices c ON c.revision_row = r.id AND c.state = 'selected' \
             WHERE v.project_id = ?1 AND v.trashed_at IS NULL ORDER BY c.session_id, v.id",
        )
        .bind(project.to_string())
        .fetch_all(&mut *snapshot)
        .await?;
        snapshot.rollback().await?;
        let mut members: BTreeMap<Uuid, Vec<Uuid>> = BTreeMap::new();
        for row in &rows {
            let session = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
            members
                .entry(session)
                .or_default()
                .push(parse_uuid(&row.try_get::<String, _>("view_id")?)?);
        }
        Ok(members
            .into_iter()
            .map(|(session_id, view_ids)| ProjectMember { session_id, view_ids })
            .collect())
    }
}

// ---------------------------------------------------------------------------
// Candidate and membership reads
// ---------------------------------------------------------------------------

impl Catalog {
    /// Everything the run's picker evaluates, from one catalog snapshot: each
    /// candidate of the run's subject on its rig with its summary, its logical
    /// captures (D16) outside the Trash with their copies, applicable quality
    /// and header evidence, and the member observations the evidence
    /// describes. Sessions holding no light or unknown-type frame belong to
    /// CAL and are left out. Hashes, measures and writes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown run; `PersistenceFailure` when the catalog
    /// cannot be read.
    pub async fn view_candidate_basis(&self, id: Uuid) -> Result<CandidateBasis> {
        let mut conn = self.reader().await?;
        // One deferred transaction, so every read below sees the same snapshot.
        let mut snapshot = conn.begin().await?;
        let basis = read_candidate_basis(&mut snapshot, id).await?;
        snapshot.rollback().await?;
        Ok(basis)
    }

    /// The draft or the latest committed revision with live member state, from
    /// one catalog snapshot: each choice with its session as recorded now, and
    /// each member with its copies' availability, location failure and current
    /// expectation. Unresolved (included, no Available copy) and changed since
    /// review (a copy's fingerprint differs from its basis) are derived here
    /// and never stored. Hashes, measures and writes nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown run, or for a membership it does not have.
    pub async fn view_membership(
        &self,
        id: Uuid,
        membership: Membership,
    ) -> Result<MembershipBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let basis = read_membership(&mut snapshot, id, membership).await?;
        snapshot.rollback().await?;
        Ok(basis)
    }

    /// The candidates of the run's subject on its rig that its latest committed
    /// revision neither chose nor excluded, and whose captures no member holds:
    /// what 'Add N new sessions' counts (VSEL-FR-12, VSEL-FR-17). A Complete run
    /// counts them too; 0 before the first Save. Read-only.
    ///
    /// # Errors
    /// `NotFound` for an unknown run.
    pub async fn view_new_candidate_count(&self, id: Uuid) -> Result<u64> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let view = load_view(&mut snapshot, id).await?;
        let count = if view.revision == 0 {
            0
        } else {
            let (row, _) = committed_header(&mut snapshot, id, view.revision).await?;
            new_candidates(&mut snapshot, &view, row).await?.len()
        };
        snapshot.rollback().await?;
        Ok(u64::try_from(count).unwrap_or(u64::MAX))
    }

    /// Each run whose revisions or draft hold any of `assets` as a member copy,
    /// naming the asked assets it holds. The reference revision is the run's
    /// latest committed revision, 0 for a never-saved draft.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn view_references(&self, assets: &BTreeSet<Uuid>) -> Result<Vec<AssetReference>> {
        if assets.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.reader().await?;
        let rows =
            sqlx::query(VIEW_REFERENCES).bind(json_ids(assets)?).fetch_all(&mut *conn).await?;
        let mut references: BTreeMap<Uuid, AssetReference> = BTreeMap::new();
        for row in &rows {
            let id = parse_uuid(&row.try_get::<String, _>("view_id")?)?;
            let asset = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
            if let Some(reference) = references.get_mut(&id) {
                reference.asset_ids.push(asset);
                continue;
            }
            references.insert(
                id,
                AssetReference {
                    kind: ReferenceKind::View,
                    id,
                    name: row.try_get("name")?,
                    revision: revision(row.try_get("revision")?)?,
                    asset_ids: vec![asset],
                },
            );
        }
        Ok(references.into_values().collect())
    }
}

/// Runs holding asked assets in any revision row, committed or draft, with
/// the latest committed name (else the draft's) and revision.
const VIEW_REFERENCES: &str = "\
    SELECT DISTINCT v.id AS view_id, v.revision, coalesce(c.name, d.name) AS name, \
    m.asset_id FROM view_member_copies m \
    JOIN view_revisions r ON r.id = m.revision_row JOIN views v ON v.id = r.view_id \
    LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
    LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
    WHERE m.asset_id IN (SELECT value FROM json_each(?1)) ORDER BY v.id, m.asset_id";

/// The run's candidate sessions on `conn`'s snapshot, in candidate order: the
/// Project's candidates whose subject and rig are the run's.
async fn run_candidates(conn: &mut SqliteConnection, view: &View) -> Result<Vec<Uuid>> {
    Ok(projects::candidates(conn, view.project_id)
        .await?
        .into_iter()
        .filter(|candidate| {
            candidate.subject_id == view.subject_id && candidate.rig_id == view.rig_id
        })
        .map(|candidate| candidate.session_id)
        .collect())
}

/// The run's candidates its committed revision row `row` neither chose (nor
/// regrouped into a successor) nor excluded, and whose live captures no member
/// copy holds. Refresh lists exactly these as added sessions.
async fn new_candidates(conn: &mut SqliteConnection, view: &View, row: i64) -> Result<Vec<Uuid>> {
    let mut chosen = BTreeSet::new();
    for choice in load_choices(conn, row).await? {
        chosen.insert(choice.session_id);
        let current = load_session_row(conn, choice.session_id).await?;
        chosen.extend(successors_of(conn, &current).await?);
    }
    let recorded = recorded_copies(conn, row).await?;
    let mut added = Vec::new();
    for session in run_candidates(conn, view).await? {
        if chosen.contains(&session) {
            continue;
        }
        let assets = current_member_assets(conn, session).await?;
        if !assets.iter().any(|asset| asset.effective.is_light() != Some(false)) {
            continue;
        }
        let view_of = CaptureView::read(conn, &[session], &assets).await?;
        let holds = assets.iter().any(|asset| {
            view_of.copies_of(view_of.key(asset)).iter().any(|copy| recorded.contains(&copy.id))
        });
        if !holds {
            added.push(session);
        }
    }
    Ok(added)
}

async fn read_candidate_basis(conn: &mut SqliteConnection, id: Uuid) -> Result<CandidateBasis> {
    let view = load_view(conn, id).await?;
    let target_id = run_subject(conn, view.project_id, view.subject_id).await?;
    let target = load_target(conn, target_id).await?;
    let framing = FramingTarget {
        target_id,
        designation: target.candidate.designation.clone(),
        coordinates: target.candidate.coordinates.clone(),
    };
    let rig = load_equipment(conn, view.rig_id).await?;
    let mut rows = Vec::new();
    let mut members = Vec::new();
    let mut all = Vec::new();
    for session in run_candidates(conn, &view).await? {
        let assets = current_member_assets(conn, session).await?;
        // Calibration sessions belong to CAL: a candidate has a light or
        // unknown-type capture.
        if !assets.iter().any(|asset| asset.effective.is_light() != Some(false)) {
            continue;
        }
        rows.push(load_session_row(conn, session).await?);
        all.extend(assets.iter().cloned());
        members.push(assets);
    }
    let session_ids: Vec<Uuid> = rows.iter().map(|row| row.session.id).collect();
    let captures_of = CaptureView::read(conn, &session_ids, &all).await?;
    let mut sessions = Vec::with_capacity(rows.len());
    for (row, assets) in rows.into_iter().zip(members) {
        let captures = captures_of
            .group(&assets)
            .into_iter()
            .filter_map(|(key, present)| candidate_capture(&captures_of, &key, &present))
            .collect();
        sessions.push(CandidateSession {
            captures,
            assessed: assessed_members(&assets),
            summary: captures_of.summary(row, &assets, Vec::new(), Members::Live),
        });
    }
    Ok(CandidateBasis { view, framing, rig, sessions })
}

/// One logical capture with every recorded copy, keyed like a member: the
/// smallest copy id. The evidence is the session's own copy.
fn candidate_capture(
    view: &CaptureView,
    key: &str,
    present: &[&Asset],
) -> Option<CandidateCapture> {
    let mut copies = view.copies_of(key);
    copies.sort_by_key(|copy| copy.id);
    Some(CandidateCapture {
        member_key: copies.first()?.id,
        copies: copies
            .iter()
            .map(|copy| CaptureCopy {
                asset_id: copy.id,
                location_id: copy.location_id,
                availability: copy.availability,
                decision_revision: copy.decision_revision,
                fingerprint: copy.fingerprint.clone(),
            })
            .collect(),
        quality: view.quality(key),
        frame: frame_evidence(present.first()?),
    })
}

/// The member observations a refresh addition binds (R11).
fn assessed_members(assets: &[Asset]) -> AssessedMembers {
    AssessedMembers {
        observations: assets.iter().map(|a| (a.id, a.fingerprint.clone())).collect(),
        decisions: assets.iter().map(|a| (a.id, a.decision_revision)).collect(),
        observation_revisions: assets.iter().map(|a| (a.id, a.observation_revision)).collect(),
    }
}

/// The members are exactly those assessed, with the same observations,
/// decisions and observation sequences.
fn members_unchanged(assessed: &AssessedMembers, members: &[Asset]) -> bool {
    let count = members.len();
    count == assessed.observations.len()
        && count == assessed.decisions.len()
        && count == assessed.observation_revisions.len()
        && members.iter().all(|asset| {
            assessed
                .observations
                .get(&asset.id)
                .is_some_and(|expected| fingerprint_matches(&asset.fingerprint, expected))
                && assessed.decisions.get(&asset.id) == Some(&asset.decision_revision)
                && assessed.observation_revisions.get(&asset.id)
                    == Some(&asset.observation_revision)
        })
}

/// Header evidence projected from a copy's effective metadata.
fn frame_evidence(asset: &Asset) -> FrameEvidence {
    let m = &asset.effective;
    FrameEvidence {
        asset_id: asset.id,
        light: m.is_light(),
        object: m.object.clone(),
        filter: m.filter.clone(),
        exposure_seconds: m.exposure_seconds,
        camera: m.camera.clone(),
        telescope: m.telescope.clone(),
        gain: m.gain,
        offset: m.offset,
        binning_x: m.binning_x,
        binning_y: m.binning_y,
        width: m.width,
        height: m.height,
        set_temperature_c: m.set_temperature_c,
        date_obs: m.date_obs.clone(),
        date_local: m.date_local.clone(),
        ra_deg: m.ra_deg,
        dec_deg: m.dec_deg,
        wcs_ra_deg: m.wcs_ra_deg,
        wcs_dec_deg: m.wcs_dec_deg,
        sky_rotation_deg: m.sky_rotation_deg,
        focal_length_mm: m.focal_length_mm,
        pixel_size_um: m.pixel_size_um,
    }
}

/// A location's name and, while it is unavailable, its recorded failure.
async fn location_state(conn: &mut SqliteConnection, id: Uuid) -> Result<(String, Option<String>)> {
    let row =
        sqlx::query("SELECT name, availability, unavailable_reason FROM locations WHERE id = ?1")
            .bind(id.to_string())
            .fetch_one(&mut *conn)
            .await?;
    let availability: Availability = from_text(&row.try_get::<String, _>("availability")?)?;
    let reason = if availability == Availability::Available {
        None
    } else {
        row.try_get("unavailable_reason")?
    };
    Ok((row.try_get("name")?, reason))
}

async fn read_membership(
    conn: &mut SqliteConnection,
    id: Uuid,
    membership: Membership,
) -> Result<MembershipBasis> {
    let view = load_view(conn, id).await?;
    let (row, revision, criteria) = match membership {
        Membership::Draft => {
            let (row, header) = draft_header(conn, &view)
                .await?
                .ok_or_else(|| LibraryError::NotFound(format!("draft of view {id}")))?;
            (row, header.draft_revision, header.criteria)
        }
        Membership::Committed => {
            if view.revision == 0 {
                return Err(LibraryError::NotFound(format!("committed revision of view {id}")));
            }
            let (row, header) = committed_header(conn, id, view.revision).await?;
            (row, header.revision, header.criteria)
        }
    };
    let choices = load_choices(conn, row).await?;
    let mut session_rows = Vec::with_capacity(choices.len());
    for choice in &choices {
        session_rows.push(load_session_row(conn, choice.session_id).await?);
    }
    let summaries = summarize_rows(conn, session_rows, Members::Live).await?;
    let sessions = choices
        .into_iter()
        .zip(summaries)
        .map(|(choice, current)| ChoiceBasis { choice, current })
        .collect();
    let members = load_members(conn, row).await?;
    let ids: BTreeSet<Uuid> =
        members.iter().flat_map(|m| m.copies.iter().map(|copy| copy.asset_id)).collect();
    let assets = load_assets(conn, &ids).await?;
    let remaps = verified_remaps(conn, &ids).await?;
    let member_sessions: Vec<Uuid> =
        members.iter().map(|m| m.session_id).collect::<BTreeSet<_>>().into_iter().collect();
    let captures = CaptureView::read(conn, &member_sessions, &assets).await?;
    let mut locations = HashMap::new();
    for asset in &assets {
        if let Entry::Vacant(entry) = locations.entry(asset.location_id) {
            entry.insert(location_state(conn, asset.location_id).await?);
        }
    }
    let by_id: HashMap<Uuid, &Asset> = assets.iter().map(|asset| (asset.id, asset)).collect();
    let members = members
        .into_iter()
        .map(|member| member_basis(member, &by_id, &remaps, &locations, &captures))
        .collect::<Result<_>>()?;
    Ok(MembershipBasis { view_id: id, membership, revision, criteria, sessions, members })
}

/// Applied remap reviews of `ids`, each copy's in apply order. One remap is
/// the hashed original fingerprint and the byte-identical candidate that
/// replaced it; applying rehashed both just before commit (D19).
type Remaps = HashMap<Uuid, Vec<(ObservationFingerprint, ObservationFingerprint)>>;

async fn verified_remaps(conn: &mut SqliteConnection, ids: &BTreeSet<Uuid>) -> Result<Remaps> {
    // A location's later review expects the revision its earlier apply produced.
    let items: Vec<String> = sqlx::query_scalar(
        "SELECT j.value FROM remap_reviews r, json_each(r.items) j WHERE r.state = 'applied' \
         AND json_extract(j.value, '$.assetId') IN (SELECT value FROM json_each(?1)) \
         ORDER BY r.location_id, r.expected_revision",
    )
    .bind(json_ids(ids)?)
    .fetch_all(&mut *conn)
    .await?;
    let mut remaps = Remaps::new();
    for item in items {
        let item: RemapItem = from_json(&item)?;
        let step = (item.original_digest.fingerprint, item.candidate_fingerprint);
        remaps.entry(item.asset_id).or_default().push(step);
    }
    Ok(remaps)
}

/// The recorded basis carried across verified remaps: a remap whose hashed
/// original matches the basis proves its candidate holds the reviewed bytes.
/// A later content change still differs from the carried basis.
fn reviewed_basis<'a>(
    recorded: &'a ObservationFingerprint,
    remaps: Option<&'a Vec<(ObservationFingerprint, ObservationFingerprint)>>,
) -> &'a ObservationFingerprint {
    remaps.into_iter().flatten().fold(recorded, |basis, (original, candidate)| {
        if fingerprint_matches(original, basis) {
            candidate
        } else {
            basis
        }
    })
}

fn member_basis(
    member: ViewMember,
    assets: &HashMap<Uuid, &Asset>,
    remaps: &Remaps,
    locations: &HashMap<Uuid, (String, Option<String>)>,
    captures: &CaptureView,
) -> Result<MemberBasis> {
    let asset = |id: &Uuid| {
        assets
            .get(id)
            .copied()
            .ok_or_else(|| LibraryError::PersistenceFailure(format!("member copy {id} is unknown")))
    };
    let mut copies = Vec::with_capacity(member.copies.len());
    let mut changed = false;
    for recorded in &member.copies {
        let current = asset(&recorded.asset_id)?;
        let basis = reviewed_basis(&recorded.fingerprint, remaps.get(&recorded.asset_id));
        changed |= !fingerprint_matches(&current.fingerprint, basis);
        let (name, reason) = &locations[&current.location_id];
        copies.push(CopyState {
            asset_id: current.id,
            location_id: current.location_id,
            location_name: name.clone(),
            path: current.relative_path.clone(),
            availability: current.availability,
            failure_reason: reason.clone(),
            last_observed_at: current.last_observed_at.clone(),
            current: ExpectedAsset {
                asset_id: current.id,
                decision_revision: current.decision_revision,
                fingerprint: current.fingerprint.clone(),
            },
        });
    }
    let representative = asset(&member.member_key)?;
    let unresolved = member.state == MemberState::Included
        && copies.iter().all(|copy| copy.availability != Availability::Available);
    Ok(MemberBasis {
        quality: captures.quality(captures.key(representative)),
        frame: frame_evidence(representative),
        unresolved,
        changed_since_review: changed,
        copies,
        member,
    })
}

// ---------------------------------------------------------------------------
// Scoped quality actions, Review step marks and refresh reviews
// ---------------------------------------------------------------------------

impl Catalog {
    /// Mark members Usable (included members only) or Unusable (any member) in
    /// the library. The scope is the draft at `expected_draft` or the latest
    /// committed revision. The sources are hashed off the writer lock as
    /// `set_quality` does; one transaction then checks the draft, the scope and
    /// every expected asset and decides. No member state changes (R18), so a
    /// Complete run takes it too.
    ///
    /// # Errors
    /// `InvalidInput` for Unreviewed, a run in the Trash, a missing
    /// `expected_draft` for the draft, an asset that is no member, an excluded
    /// member marked Usable or a Retired copy, each refused before anything is
    /// hashed; `Conflict` for a stale draft or asset; `NotFound` for an
    /// unknown run or membership; source access errors and `IdentityConflict`
    /// as for `set_quality`.
    pub async fn set_view_quality<P: SourceProbe>(
        &self,
        id: Uuid,
        membership: Membership,
        expected_draft: Option<Revision>,
        expected: &[ExpectedAsset],
        quality: Quality,
        probe: P,
    ) -> Result<Vec<Asset>> {
        if quality == Quality::Unreviewed {
            return Err(invalid("a run quality action marks frames Usable or Unusable".into()));
        }
        require_unique_assets(expected)?;
        let included_only = quality == Quality::Usable;
        let ids: BTreeSet<Uuid> = expected.iter().map(|item| item.asset_id).collect();
        {
            let mut conn = self.reader().await?;
            let row = membership_row(&mut conn, id, membership, expected_draft).await?;
            require_scope(&mut conn, row, &ids, included_only).await?;
            for item in expected {
                require_decidable(&load_asset(&mut conn, item.asset_id).await?)?;
            }
        }
        let digests = self.current_digests(expected, probe).await?;
        let assets = write_txn!(self, |conn| {
            let row = membership_row(conn, id, membership, expected_draft).await?;
            require_scope(conn, row, &ids, included_only).await?;
            let assets = check_expected_assets(conn, expected).await?;
            let decided_at = now()?;
            for asset in &assets {
                decide_quality(conn, asset, quality, digests.get(&asset.id), &decided_at).await?;
            }
            load_assets(conn, &ids).await?
        });
        Ok(assets)
    }

    /// Reject members for the run's Project only: the 065 rejection, written in
    /// the same transaction that checks the draft and the membership scope.
    /// Library quality and every member stay unchanged.
    ///
    /// # Errors
    /// `InvalidInput` for a run in the Trash, an asset that is no member, a
    /// withdrawal, or a Retired or Trashed copy; `Conflict` for a stale draft
    /// or a mark whose decision revision or bytes changed; `NotFound` for an
    /// unknown run or membership.
    pub async fn reject_view_members(
        &self,
        id: Uuid,
        membership: Membership,
        expected_draft: Option<Revision>,
        marks: &[RejectionMark],
    ) -> Result<Vec<ProjectRejection>> {
        if marks.iter().any(|mark| !mark.rejected) {
            return Err(invalid(
                "Reject for this Project only rejects; it withdraws nothing".into(),
            ));
        }
        let ids: BTreeSet<Uuid> = marks.iter().map(|mark| mark.asset_id).collect();
        let decided = write_txn!(self, |conn| {
            let row = membership_row(conn, id, membership, expected_draft).await?;
            require_scope(conn, row, &ids, false).await?;
            let view = load_view(conn, id).await?;
            projects::write_rejections(conn, view.project_id, marks).await?
        });
        Ok(decided)
    }

    /// One mark of the run's Review step (D-W54): P, X or U writes the frame
    /// copy's library decision, Reject for this Project only (or its
    /// withdrawal) writes the Project-only decision, and the same transaction
    /// moves the frame's member in the draft. X and Reject remove an included
    /// member with the reason Rejected; un-rejecting (P or U for a library
    /// rejection, the withdrawal for a Project one) restores it, unless the
    /// other rejection still holds. With `expected_draft` 0 and no draft, a
    /// draft starts from the latest committed revision. Saved and prepared
    /// revisions never change. A P or X mark hashes the source off the writer
    /// lock first, as `set_quality` does.
    ///
    /// # Errors
    /// `InvalidInput` for a run that is Complete or in the Trash, a frame that
    /// is no member of the draft, or a Retired or Trashed copy; `Conflict` for a
    /// stale draft, asset or Project-only decision; `NotFound` for an unknown
    /// run; source access errors and `IdentityConflict` as for `set_quality`.
    pub async fn view_review_mark<P: SourceProbe>(
        &self,
        id: Uuid,
        expected_draft: Revision,
        mark: &ReviewMark,
        probe: P,
    ) -> Result<ReviewMarkOutcome> {
        let digests = match mark {
            ReviewMark::Library { asset, quality } if *quality != Quality::Unreviewed => {
                {
                    let mut conn = self.reader().await?;
                    let view = load_view(&mut conn, id).await?;
                    require_open(&view)?;
                    require_decidable(&load_asset(&mut conn, asset.asset_id).await?)?;
                }
                self.current_digests(std::slice::from_ref(asset), probe).await?
            }
            _ => HashMap::new(),
        };
        let outcome = write_txn!(self, |conn| {
            let view = load_view(conn, id).await?;
            require_open(&view)?;
            let row = begin_edit(conn, &view, expected_draft).await?;
            let asset_id = match mark {
                ReviewMark::Library { asset, .. } => asset.asset_id,
                ReviewMark::Project { mark } => mark.asset_id,
            };
            let member = member_holding(conn, row, asset_id).await?;
            let decision = write_mark_decision(conn, &view, mark, &digests).await?;
            let member = move_marked_member(conn, &view, row, member, mark).await?;
            ReviewMarkOutcome { record: load_record(conn, id).await?, decision, member }
        });
        Ok(outcome)
    }
}

/// Write a review mark's decision: the copy's library quality, or its
/// Project-only decision.
async fn write_mark_decision(
    conn: &mut SqliteConnection,
    view: &View,
    mark: &ReviewMark,
    digests: &HashMap<Uuid, (String, ObservationFingerprint)>,
) -> Result<ReviewDecision> {
    Ok(match mark {
        ReviewMark::Library { asset, quality } => {
            let current = check_expected_assets(conn, std::slice::from_ref(asset)).await?.remove(0);
            let decided_at = now()?;
            decide_quality(conn, &current, *quality, digests.get(&current.id), &decided_at).await?;
            ReviewDecision::Library { asset: Box::new(load_asset(conn, current.id).await?) }
        }
        ReviewMark::Project { mark } => {
            let rejection =
                projects::write_rejections(conn, view.project_id, std::slice::from_ref(mark))
                    .await?
                    .remove(0);
            ReviewDecision::Project { rejection }
        }
    })
}

/// Move the marked frame's draft member (D-W54): X or Reject removes an
/// included member with the reason Rejected; once a mark leaves no rejection
/// standing, a rejected member is restored, else it keeps the rejection that
/// still holds.
async fn move_marked_member(
    conn: &mut SqliteConnection,
    view: &View,
    row: i64,
    member: ViewMember,
    mark: &ReviewMark,
) -> Result<ViewMember> {
    let library_rejected = library_rejects(conn, row, member.member_key).await?;
    let project_rejected = project_rejects(conn, view.project_id, row, member.member_key).await?;
    let moved = match (member.state, &member.reason, mark) {
        (MemberState::Included, _, ReviewMark::Library { quality, .. })
            if *quality == Quality::Unusable =>
        {
            Some((MemberState::Excluded, MemberReason::Rejected { scope: RejectScope::Library }))
        }
        (MemberState::Included, _, ReviewMark::Project { mark }) if mark.rejected => {
            Some((MemberState::Excluded, MemberReason::Rejected { scope: RejectScope::Project }))
        }
        (
            MemberState::Excluded,
            MemberReason::Rejected { .. } | MemberReason::LibraryUnusable,
            _,
        ) => Some(match (library_rejected, project_rejected) {
            (false, false) => (MemberState::Included, MemberReason::Restored),
            (true, _) => {
                (MemberState::Excluded, MemberReason::Rejected { scope: RejectScope::Library })
            }
            (false, true) => {
                (MemberState::Excluded, MemberReason::Rejected { scope: RejectScope::Project })
            }
        }),
        _ => None,
    };
    let Some((state, reason)) =
        moved.filter(|moved| *moved != (member.state, member.reason.clone()))
    else {
        return Ok(member);
    };
    sqlx::query(
        "UPDATE view_members SET state = ?3, reason = ?4 WHERE revision_row = ?1 AND member_key = ?2",
    )
    .bind(row)
    .bind(member.member_key.to_string())
    .bind(to_text(&state)?)
    .bind(to_json(&reason)?)
    .execute(&mut *conn)
    .await?;
    Ok(ViewMember { state, reason, ..member })
}

impl Catalog {
    /// Durably record a refresh review against the run's latest committed
    /// revision. Changes no membership.
    ///
    /// # Errors
    /// `Conflict` carrying the committed revision when `base_revision` is not
    /// the latest; `InvalidInput` for a run that is Complete (it needs Reopen
    /// first) or in the Trash, a review that is not `reviewed`, repeated item
    /// ids or a review id already recorded; `NotFound` for an unknown run.
    pub async fn record_refresh_review(&self, review: &RefreshReview) -> Result<RefreshReview> {
        if review.state != RefreshState::Reviewed || review.applied_at.is_some() {
            return Err(invalid(format!(
                "refresh review {} must be recorded as reviewed",
                review.id
            )));
        }
        let items: Vec<Uuid> = review.items.iter().map(|item| item.id).collect();
        if !items.is_empty() {
            require_unique("items", &items)?;
        }
        let recorded = write_txn!(self, |conn| {
            let view = load_view(conn, review.view_id).await?;
            require_open(&view)?;
            if view.revision == 0 || review.base_revision != view.revision {
                return Err(conflict(view.id, view.revision));
            }
            let known: Option<i64> =
                sqlx::query_scalar("SELECT 1 FROM view_refresh_reviews WHERE id = ?1")
                    .bind(review.id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?;
            if known.is_some() {
                return Err(invalid(format!("refresh review {} is already recorded", review.id)));
            }
            sqlx::query(
                "INSERT INTO view_refresh_reviews (id, view_id, base_revision, criteria, items, \
                 state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'reviewed', ?6)",
            )
            .bind(review.id.to_string())
            .bind(view.id.to_string())
            .bind(db_revision(view.revision)?)
            .bind(to_json(&review.criteria)?)
            .bind(to_json(&review.items)?)
            .bind(now()?)
            .execute(&mut *conn)
            .await?;
            load_refresh_review(conn, review.id).await?
        });
        Ok(recorded)
    }

    /// Apply a refresh review to the run's draft, starting one from the latest
    /// committed revision when none exists (`expected_draft` 0). Each accepted
    /// item is re-validated against the library and applied (R25); a declined
    /// added session becomes a session exclusion; other declined items change
    /// nothing. The review is applied at most once; committed rows never change.
    ///
    /// # Errors
    /// `Conflict` for a stale run revision, draft or review, an applied
    /// review, or an item whose session or members changed or that is no
    /// longer a candidate; `InvalidInput` for a run that is Complete (it needs
    /// Reopen first) or in the Trash, no or repeated items, an item of another
    /// review or one that is only listed; `NotFound` for an unknown run or review.
    pub async fn apply_refresh(
        &self,
        review: Uuid,
        id: Uuid,
        expected: Revision,
        expected_draft: Revision,
        accept: &[Uuid],
        decline: &[Uuid],
    ) -> Result<ViewRecord> {
        let chosen: Vec<Uuid> = accept.iter().chain(decline).copied().collect();
        require_unique("accept and decline", &chosen)?;
        let record = write_txn!(self, |conn| {
            let reviewed = load_refresh_review(conn, review).await?;
            if reviewed.view_id != id {
                return Err(invalid(format!(
                    "refresh review {review} belongs to view {}",
                    reviewed.view_id
                )));
            }
            let view = load_view(conn, id).await?;
            require_open(&view)?;
            if reviewed.state == RefreshState::Applied {
                return Err(conflict(review, view.revision));
            }
            require_revision(id, view.revision, expected)?;
            if reviewed.base_revision != view.revision {
                return Err(conflict(id, view.revision));
            }
            let item = |item_id: &Uuid| -> Result<&RefreshItem> {
                let item =
                    reviewed.items.iter().find(|item| item.id == *item_id).ok_or_else(|| {
                        invalid(format!("item {item_id} is not in refresh review {review}"))
                    })?;
                if !item.kind.actionable() {
                    return Err(invalid(format!(
                        "item {item_id} ({:?}) is only listed and takes no decision",
                        item.kind
                    )));
                }
                Ok(item)
            };
            let accepted = accept.iter().map(item).collect::<Result<Vec<_>>>()?;
            let declined = decline.iter().map(item).collect::<Result<Vec<_>>>()?;
            if let Some(draft) = draft_row(conn, id).await? {
                if draft.base_revision != view.revision {
                    return Err(conflict(id, view.revision));
                }
            }
            let row = begin_edit(conn, &view, expected_draft).await?;
            let candidates: BTreeSet<Uuid> =
                run_candidates(conn, &view).await?.into_iter().collect();
            for item in accepted {
                accept_item(conn, row, review, item, &candidates).await?;
            }
            for item in declined {
                decline_item(conn, row, review, item).await?;
            }
            let at = now()?;
            sqlx::query("UPDATE view_revisions SET refresh_review_id = ?2 WHERE id = ?1")
                .bind(row)
                .bind(review.to_string())
                .execute(&mut *conn)
                .await?;
            sqlx::query(
                "UPDATE view_refresh_reviews SET state = 'applied', applied_at = ?2 \
                 WHERE id = ?1 AND state = 'reviewed'",
            )
            .bind(review.to_string())
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_record(conn, id).await?
        });
        Ok(record)
    }
}

/// A run in the Project's Trash offers no step until it is restored (D-W72).
fn require_live(view: &View) -> Result<()> {
    if view.trashed_at.is_some() {
        return Err(invalid(format!(
            "run {} is in the Project's Trash; restore it first",
            view.id
        )));
    }
    Ok(())
}

/// A run whose membership may change: outside the Trash and not Complete. A
/// Complete run accepts no membership change until it is reopened (VSEL-FR-17).
fn require_open(view: &View) -> Result<()> {
    require_live(view)?;
    if view.completion == RunCompletion::Complete {
        return Err(invalid(format!(
            "run {} is Complete; reopen it before changing its membership",
            view.id
        )));
    }
    Ok(())
}

/// The revision row of `membership` of a run outside the Trash, after checking
/// `expected_draft` for the draft.
async fn membership_row(
    conn: &mut SqliteConnection,
    id: Uuid,
    membership: Membership,
    expected_draft: Option<Revision>,
) -> Result<i64> {
    let view = load_view(conn, id).await?;
    require_live(&view)?;
    match membership {
        Membership::Draft => {
            let expected = expected_draft.ok_or_else(|| {
                invalid(format!("expectedDraftRevision is required for the draft of view {id}"))
            })?;
            let Some((row, header)) = draft_header(conn, &view).await? else {
                return Err(conflict(id, 0));
            };
            if header.draft_revision != expected {
                return Err(conflict(id, header.draft_revision));
            }
            Ok(row)
        }
        Membership::Committed => {
            if view.revision == 0 {
                return Err(LibraryError::NotFound(format!("committed revision of view {id}")));
            }
            Ok(committed_header(conn, id, view.revision).await?.0)
        }
    }
}

/// Every asked asset is a copy of a member of revision row `row`, and of an
/// included one when `included_only`.
async fn require_scope(
    conn: &mut SqliteConnection,
    row: i64,
    assets: &BTreeSet<Uuid>,
    included_only: bool,
) -> Result<()> {
    let rows = sqlx::query(
        "SELECT c.asset_id, m.state FROM view_member_copies c JOIN view_members m \
         ON m.revision_row = c.revision_row AND m.member_key = c.member_key \
         WHERE c.revision_row = ?1",
    )
    .bind(row)
    .fetch_all(&mut *conn)
    .await?;
    let mut states = HashMap::with_capacity(rows.len());
    for copy in &rows {
        let state: MemberState = from_text(&copy.try_get::<String, _>("state")?)?;
        states.insert(parse_uuid(&copy.try_get::<String, _>("asset_id")?)?, state);
    }
    for asset in assets {
        match states.get(asset) {
            None => return Err(invalid(format!("asset {asset} is not a member of this run"))),
            Some(MemberState::Excluded) if included_only => {
                return Err(invalid(format!(
                    "asset {asset} is an excluded member; Mark included frames usable takes \
                     included members only"
                )))
            }
            Some(_) => {}
        }
    }
    Ok(())
}

/// The member of draft row `row` that holds copy `asset`.
async fn member_holding(conn: &mut SqliteConnection, row: i64, asset: Uuid) -> Result<ViewMember> {
    let key: Option<String> = sqlx::query_scalar(
        "SELECT member_key FROM view_member_copies WHERE revision_row = ?1 AND asset_id = ?2",
    )
    .bind(row)
    .bind(asset.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    let key = key.ok_or_else(|| invalid(format!("asset {asset} is not a member of this run")))?;
    let key = parse_uuid(&key)?;
    load_members(conn, row)
        .await?
        .into_iter()
        .find(|member| member.member_key == key)
        .ok_or_else(|| LibraryError::PersistenceFailure(format!("member {key} has no row")))
}

/// Whether a copy of member `key` of row `row` is library Unusable now.
async fn library_rejects(conn: &mut SqliteConnection, row: i64, key: Uuid) -> Result<bool> {
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM view_member_copies c JOIN assets a ON a.id = c.asset_id \
         WHERE c.revision_row = ?1 AND c.member_key = ?2 AND a.quality = ?3",
    )
    .bind(row)
    .bind(key.to_string())
    .bind(to_text(&Quality::Unusable)?)
    .fetch_one(&mut *conn)
    .await?;
    Ok(count > 0)
}

/// Whether a copy of member `key` of row `row` is rejected for `project` now:
/// its latest Project-only decision rejects.
async fn project_rejects(
    conn: &mut SqliteConnection,
    project: Uuid,
    row: i64,
    key: Uuid,
) -> Result<bool> {
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM view_member_copies c JOIN project_rejections r \
         ON r.asset_id = c.asset_id AND r.project_id = ?3 \
         WHERE c.revision_row = ?1 AND c.member_key = ?2 AND r.rejected = 1 \
         AND r.revision = (SELECT max(x.revision) FROM project_rejections x \
         WHERE x.project_id = r.project_id AND x.asset_id = r.asset_id)",
    )
    .bind(row)
    .bind(key.to_string())
    .bind(project.to_string())
    .fetch_one(&mut *conn)
    .await?;
    Ok(count > 0)
}

async fn load_refresh_review(conn: &mut SqliteConnection, id: Uuid) -> Result<RefreshReview> {
    let row = sqlx::query("SELECT * FROM view_refresh_reviews WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("refresh review {id}")))?;
    Ok(RefreshReview {
        id,
        view_id: parse_uuid(&row.try_get::<String, _>("view_id")?)?,
        base_revision: revision(row.try_get("base_revision")?)?,
        criteria: from_json(&row.try_get::<String, _>("criteria")?)?,
        items: from_json(&row.try_get::<String, _>("items")?)?,
        state: from_text(&row.try_get::<String, _>("state")?)?,
        created_at: row.try_get("created_at")?,
        applied_at: row.try_get("applied_at")?,
    })
}

/// The choice of `session` in draft `row`: its state and raw reason and evidence.
async fn choice_of(
    conn: &mut SqliteConnection,
    row: i64,
    session: Uuid,
) -> Result<Option<(SessionChoiceState, String, Option<String>)>> {
    let choice = sqlx::query(
        "SELECT state, reason, evidence FROM view_session_choices \
         WHERE revision_row = ?1 AND session_id = ?2",
    )
    .bind(row)
    .bind(session.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    choice
        .map(|choice| {
            Ok((
                from_text(&choice.try_get::<String, _>("state")?)?,
                choice.try_get("reason")?,
                choice.try_get("evidence")?,
            ))
        })
        .transpose()
}

/// The item's session as reviewed, still current (Conflict with successors
/// when superseded).
async fn reviewed_session(conn: &mut SqliteConnection, item: &RefreshItem) -> Result<Session> {
    let expected = item
        .session
        .as_ref()
        .ok_or_else(|| invalid(format!("refresh item {} names no session", item.id)))?;
    Ok(check_expected_sessions(conn, std::slice::from_ref(expected)).await?.remove(0))
}

/// [`reviewed_session`] whose members are still exactly those the item assessed.
async fn assessed_session(conn: &mut SqliteConnection, item: &RefreshItem) -> Result<Session> {
    let session = reviewed_session(conn, item).await?;
    let assessed = item
        .assessed
        .as_ref()
        .ok_or_else(|| invalid(format!("refresh item {} names no member basis", item.id)))?;
    let members = current_member_assets(conn, session.id).await?;
    if !members_unchanged(assessed, &members) {
        return Err(conflict(session.id, session.grouping_revision));
    }
    Ok(session)
}

async fn accept_item(
    conn: &mut SqliteConnection,
    row: i64,
    review: Uuid,
    item: &RefreshItem,
    candidates: &BTreeSet<Uuid>,
) -> Result<()> {
    match item.kind {
        RefreshItemKind::AddedSession => {
            let session = assessed_session(conn, item).await?;
            if choice_of(conn, row, session.id).await?.is_some()
                || !candidates.contains(&session.id)
            {
                return Err(conflict(session.id, session.grouping_revision));
            }
            let reason = SelectionReason::RefreshMatch { review_id: review };
            choose(conn, row, &session, &reason, item.evidence.as_ref()).await?;
            add_captures(conn, row, session.id, None, Some(review)).await?;
        }
        RefreshItemKind::AddedCaptures => {
            let session = assessed_session(conn, item).await?;
            let selected = choice_of(conn, row, session.id).await?;
            let keys: BTreeSet<Uuid> = item.member_keys.iter().copied().collect();
            if !matches!(selected, Some((SessionChoiceState::Selected, ..))) || keys.is_empty() {
                return Err(conflict(session.id, session.grouping_revision));
            }
            if add_captures(conn, row, session.id, Some(&keys), Some(review)).await? != keys {
                return Err(conflict(session.id, session.grouping_revision));
            }
            sqlx::query(
                "UPDATE view_session_choices SET grouping_revision = ?3 \
                 WHERE revision_row = ?1 AND session_id = ?2",
            )
            .bind(row)
            .bind(session.id.to_string())
            .bind(db_revision(session.grouping_revision)?)
            .execute(&mut *conn)
            .await?;
        }
        RefreshItemKind::NoLongerMatchesSubject => {
            let session = reviewed_session(conn, item).await?;
            let selected = matches!(
                choice_of(conn, row, session.id).await?,
                Some((SessionChoiceState::Selected, ..))
            );
            if !selected || candidates.contains(&session.id) {
                return Err(conflict(session.id, session.grouping_revision));
            }
            deselect_session(conn, row, session.id).await?;
        }
        RefreshItemKind::Regrouped => regroup(conn, row, item).await?,
        RefreshItemKind::Unavailable | RefreshItemKind::KeptExclusion => {
            return Err(invalid(format!("refresh item {} is only listed", item.id)));
        }
    }
    Ok(())
}

/// A declined added session becomes a session exclusion (R13); declining any
/// other item keeps the membership as it is.
async fn decline_item(
    conn: &mut SqliteConnection,
    row: i64,
    review: Uuid,
    item: &RefreshItem,
) -> Result<()> {
    if item.kind != RefreshItemKind::AddedSession {
        return Ok(());
    }
    let session = reviewed_session(conn, item).await?;
    if choice_of(conn, row, session.id).await?.is_some() {
        return Err(conflict(session.id, session.grouping_revision));
    }
    sqlx::query(
        "INSERT INTO view_session_choices (revision_row, session_id, grouping_revision, state, \
         reason, evidence) VALUES (?1, ?2, ?3, 'excluded', ?4, ?5)",
    )
    .bind(row)
    .bind(session.id.to_string())
    .bind(db_revision(session.grouping_revision)?)
    .bind(to_json(&SelectionReason::RefreshMatch { review_id: review })?)
    .bind(item.evidence.as_ref().map(to_json).transpose()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Point the choice of a superseded member session at its current successors
/// with the same reason; each member keeps its state and copies and is now held
/// by the successor holding its copy.
async fn regroup(conn: &mut SqliteConnection, row: i64, item: &RefreshItem) -> Result<()> {
    let old = load_session_row(conn, item.session_id).await?;
    let Some((SessionChoiceState::Selected, reason, evidence)) =
        choice_of(conn, row, old.session.id).await?
    else {
        return Err(conflict(old.session.id, old.session.grouping_revision));
    };
    let current: BTreeSet<Uuid> = successors_of(conn, &old).await?.into_iter().collect();
    let named: BTreeSet<Uuid> = item.successors.iter().map(|s| s.session_id).collect();
    if current.is_empty() || current != named {
        return Err(LibraryError::Conflict {
            id: old.session.id,
            current: old.session.grouping_revision,
            successors: current.into_iter().collect(),
        });
    }
    let successors = check_expected_sessions(conn, &item.successors).await?;
    sqlx::query("DELETE FROM view_session_choices WHERE revision_row = ?1 AND session_id = ?2")
        .bind(row)
        .bind(old.session.id.to_string())
        .execute(&mut *conn)
        .await?;
    for successor in &successors {
        sqlx::query(
            "INSERT INTO view_session_choices (revision_row, session_id, grouping_revision, \
             state, reason, evidence) VALUES (?1, ?2, ?3, 'selected', ?4, ?5) \
             ON CONFLICT (revision_row, session_id) DO NOTHING",
        )
        .bind(row)
        .bind(successor.id.to_string())
        .bind(db_revision(successor.grouping_revision)?)
        .bind(&reason)
        .bind(evidence.as_deref())
        .execute(&mut *conn)
        .await?;
    }
    sqlx::query(
        "UPDATE view_members SET session_id = (SELECT a.session_id FROM view_member_copies c \
         JOIN assets a ON a.id = c.asset_id WHERE c.revision_row = view_members.revision_row \
         AND c.member_key = view_members.member_key \
         AND a.session_id IN (SELECT value FROM json_each(?3)) ORDER BY a.id LIMIT 1) \
         WHERE revision_row = ?1 AND session_id = ?2 AND EXISTS (SELECT 1 \
         FROM view_member_copies c JOIN assets a ON a.id = c.asset_id \
         WHERE c.revision_row = view_members.revision_row \
         AND c.member_key = view_members.member_key \
         AND a.session_id IN (SELECT value FROM json_each(?3)))",
    )
    .bind(row)
    .bind(old.session.id.to_string())
    .bind(json_ids(&current)?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Subjects, rigs and choices
// ---------------------------------------------------------------------------

/// The Target of subject `subject` of `project`, refusing a mosaic subject:
/// a run on a mosaic subject is a panel run of a run group (D-W38).
async fn run_subject(conn: &mut SqliteConnection, project: Uuid, subject: Uuid) -> Result<Uuid> {
    projects::require_project(conn, project).await?;
    let row = sqlx::query(
        "SELECT target_id, mosaic FROM project_subjects WHERE id = ?1 AND project_id = ?2",
    )
    .bind(subject.to_string())
    .bind(project.to_string())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| {
        LibraryError::NotFound(format!("subject {subject} is not a subject of project {project}"))
    })?;
    if row.try_get::<i64, _>("mosaic")? == 1 {
        return Err(invalid(format!(
            "subject {subject} is a mosaic: a run on it is a run group, one run per panel"
        )));
    }
    parse_uuid(&row.try_get::<String, _>("target_id")?)
}

/// Refuse a rig that is not one of the Project's rigs.
async fn require_project_rig(conn: &mut SqliteConnection, project: Uuid, rig: Uuid) -> Result<()> {
    let listed: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM project_rigs WHERE project_id = ?1 AND equipment_id = ?2",
    )
    .bind(project.to_string())
    .bind(rig.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    if listed.is_none() {
        let name = load_equipment(conn, rig).await?.name;
        return Err(invalid(format!("rig {name} ({rig}) is not one of the Project's rigs")));
    }
    Ok(())
}

/// Which run field a Project removal is checked against.
#[derive(Clone, Copy)]
pub enum RunUse {
    Subject,
    Rig,
    Panel,
}

/// Refuse removing `what` from Project `project` while any run uses it, in the
/// Project's Trash or not (D-W65, D-W72): the refusal names each run.
///
/// # Errors
/// `InvalidInput` naming each run that uses it.
pub async fn refuse_if_used(
    conn: &mut SqliteConnection,
    project: Uuid,
    field: RunUse,
    id: Uuid,
    what: &str,
) -> Result<()> {
    let column = match field {
        RunUse::Subject => "subject_id",
        RunUse::Rig => "rig_id",
        RunUse::Panel => "panel_id",
    };
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT v.id, v.trashed_at, coalesce(c.name, d.name) AS name FROM views v \
         LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
         LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
         WHERE v.project_id = ?1 AND v.{column} = ?2 ORDER BY name, v.id"
    )))
    .bind(project.to_string())
    .bind(id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut runs = Vec::with_capacity(rows.len());
    for row in &rows {
        let name: Option<String> = row.try_get("name")?;
        let id: String = row.try_get("id")?;
        let trashed: Option<String> = row.try_get("trashed_at")?;
        let place = if trashed.is_some() { ", in the Project's Trash" } else { "" };
        runs.push(format!("'{}' ({id}{place})", name.unwrap_or_default()));
    }
    Err(invalid(format!(
        "{what} cannot be removed while a run uses it; used by run{} {}",
        if runs.len() == 1 { "" } else { "s" },
        runs.join(", ")
    )))
}

/// Choose `session` in draft `row` with `reason`, adding each of its logical
/// captures once under D02. Members already in the draft keep their state.
async fn select_session(
    conn: &mut SqliteConnection,
    row: i64,
    session: &Session,
    reason: &SelectionReason,
    evidence: Option<&platevault_model::GeometryEvidence>,
) -> Result<()> {
    choose(conn, row, session, reason, evidence).await?;
    add_captures(conn, row, session.id, None, None).await?;
    Ok(())
}

/// Record `session` as selected in draft `row`, replacing an earlier choice.
async fn choose(
    conn: &mut SqliteConnection,
    row: i64,
    session: &Session,
    reason: &SelectionReason,
    evidence: Option<&platevault_model::GeometryEvidence>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO view_session_choices (revision_row, session_id, grouping_revision, state, \
         reason, evidence) VALUES (?1, ?2, ?3, 'selected', ?4, ?5) \
         ON CONFLICT (revision_row, session_id) DO UPDATE SET \
         grouping_revision = excluded.grouping_revision, state = 'selected', \
         reason = excluded.reason, evidence = excluded.evidence",
    )
    .bind(row)
    .bind(session.id.to_string())
    .bind(db_revision(session.grouping_revision)?)
    .bind(to_json(reason)?)
    .bind(evidence.map(to_json).transpose()?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Add each logical capture of `session` outside the Trash not yet in draft
/// `row` once, with its D02 starting state; only the captures keyed in `only`
/// when given. A capture a refresh review adds and includes records
/// `refresh_added` with the review. Returns the added member keys.
async fn add_captures(
    conn: &mut SqliteConnection,
    row: i64,
    session: Uuid,
    only: Option<&BTreeSet<Uuid>>,
    review: Option<Uuid>,
) -> Result<BTreeSet<Uuid>> {
    let assets = current_member_assets(conn, session).await?;
    let view = CaptureView::read(conn, &[session], &assets).await?;
    let recorded: BTreeSet<Uuid> = recorded_copies(conn, row).await?;
    let mut added = BTreeSet::new();
    for key in view.group(&assets).into_keys() {
        let mut copies = view.copies_of(&key);
        copies.sort_by_key(|copy| copy.id);
        if copies.is_empty() || copies.iter().any(|copy| recorded.contains(&copy.id)) {
            continue;
        }
        let member_key = copies[0].id;
        if only.is_some_and(|only| !only.contains(&member_key)) {
            continue;
        }
        let quality = view.quality(&key);
        let (state, reason) = match (initial_member_state(&quality), review) {
            ((MemberState::Included, _), Some(review_id)) => {
                (MemberState::Included, MemberReason::RefreshAdded { review_id })
            }
            (initial, _) => initial,
        };
        insert_member(conn, row, member_key, session, state, &reason, &quality).await?;
        for copy in copies {
            sqlx::query(
                "INSERT INTO view_member_copies (revision_row, member_key, asset_id, \
                 decision_revision, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(row)
            .bind(member_key.to_string())
            .bind(copy.id.to_string())
            .bind(db_revision(copy.decision_revision)?)
            .bind(to_json(&copy.fingerprint)?)
            .execute(&mut *conn)
            .await?;
        }
        added.insert(member_key);
    }
    Ok(added)
}

async fn insert_member(
    conn: &mut SqliteConnection,
    row: i64,
    member_key: Uuid,
    session: Uuid,
    state: MemberState,
    reason: &MemberReason,
    quality: &ApplicableQuality,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO view_members (revision_row, member_key, session_id, state, reason, \
         quality_when_chosen) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(row)
    .bind(member_key.to_string())
    .bind(session.to_string())
    .bind(to_text(&state)?)
    .bind(to_json(reason)?)
    .bind(to_json(quality)?)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn recorded_copies(conn: &mut SqliteConnection, row: i64) -> Result<BTreeSet<Uuid>> {
    let ids: Vec<String> =
        sqlx::query_scalar("SELECT asset_id FROM view_member_copies WHERE revision_row = ?1")
            .bind(row)
            .fetch_all(&mut *conn)
            .await?;
    ids.iter().map(|id| parse_uuid(id)).collect()
}

/// Remove the choice of `session` and its members: a criteria-based choice
/// becomes an explicit session exclusion, a manual inclusion goes (R13).
async fn deselect_session(conn: &mut SqliteConnection, row: i64, session: Uuid) -> Result<()> {
    let reason: Option<String> = sqlx::query_scalar(
        "SELECT reason FROM view_session_choices \
         WHERE revision_row = ?1 AND session_id = ?2 AND state = 'selected'",
    )
    .bind(row)
    .bind(session.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    let Some(reason) = reason else {
        return Err(invalid(format!("session {session} is not selected")));
    };
    let reason: SelectionReason = from_json(&reason)?;
    sqlx::query(
        "DELETE FROM view_member_copies WHERE revision_row = ?1 AND member_key IN \
         (SELECT member_key FROM view_members WHERE revision_row = ?1 AND session_id = ?2)",
    )
    .bind(row)
    .bind(session.to_string())
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM view_members WHERE revision_row = ?1 AND session_id = ?2")
        .bind(row)
        .bind(session.to_string())
        .execute(&mut *conn)
        .await?;
    let statement = if reason.is_pinned() {
        "DELETE FROM view_session_choices WHERE revision_row = ?1 AND session_id = ?2"
    } else {
        "UPDATE view_session_choices SET state = 'excluded' \
         WHERE revision_row = ?1 AND session_id = ?2"
    };
    sqlx::query(statement).bind(row).bind(session.to_string()).execute(&mut *conn).await?;
    Ok(())
}

/// Set members included or excluded with the reason the change records.
async fn set_frames(
    conn: &mut SqliteConnection,
    row: i64,
    keys: &[Uuid],
    state: MemberState,
) -> Result<()> {
    for key in keys {
        let current = sqlx::query(
            "SELECT state, reason FROM view_members WHERE revision_row = ?1 AND member_key = ?2",
        )
        .bind(row)
        .bind(key.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| invalid(format!("{key} is not a member of this run")))?;
        let was: MemberState = from_text(&current.try_get::<String, _>("state")?)?;
        if was == state {
            continue;
        }
        let reason = match state {
            MemberState::Excluded => MemberReason::ViewExclusion,
            MemberState::Included => match from_json(&current.try_get::<String, _>("reason")?)? {
                MemberReason::ViewExclusion => MemberReason::Restored,
                _ => MemberReason::ExplicitInclusion,
            },
        };
        sqlx::query(
            "UPDATE view_members SET state = ?3, reason = ?4 \
             WHERE revision_row = ?1 AND member_key = ?2",
        )
        .bind(row)
        .bind(key.to_string())
        .bind(to_text(&state)?)
        .bind(to_json(&reason)?)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

fn require_unique<T: Ord + Copy + std::fmt::Display>(field: &str, ids: &[T]) -> Result<()> {
    let mut seen = BTreeSet::new();
    if ids.is_empty() {
        return Err(invalid(format!("{field} must not be empty")));
    }
    if let Some(twice) = ids.iter().find(|id| !seen.insert(**id)) {
        return Err(invalid(format!("{field} names {twice} twice")));
    }
    Ok(())
}

fn validate_edit(edit: &DraftEdit) -> Result<()> {
    match edit {
        DraftEdit::Details { name } => {
            if name.trim().is_empty() {
                return Err(invalid("run name is blank".into()));
            }
            Ok(())
        }
        DraftEdit::SelectMatching { filters, .. } => filters.validate(),
        DraftEdit::DeselectSessions { session_ids } => require_unique("sessionIds", session_ids),
        DraftEdit::SetFrames { member_keys, .. } => require_unique("memberKeys", member_keys),
        DraftEdit::SelectSessions { .. } | DraftEdit::ClearSelection => Ok(()),
    }
}

async fn apply_edit(
    conn: &mut SqliteConnection,
    view: &View,
    row: i64,
    edit: &DraftEdit,
) -> Result<()> {
    match edit {
        DraftEdit::Details { name } => {
            sqlx::query("UPDATE view_revisions SET name = ?2 WHERE id = ?1")
                .bind(row)
                .bind(name.trim())
                .execute(&mut *conn)
                .await?;
        }
        DraftEdit::SelectSessions { sessions } => {
            select_expected(conn, view, row, sessions, &SelectionReason::Manual).await?;
        }
        DraftEdit::SelectMatching { filters, sessions } => {
            let reason = SelectionReason::SelectMatching { filters: filters.clone() };
            select_expected(conn, view, row, sessions, &reason).await?;
        }
        DraftEdit::DeselectSessions { session_ids } => {
            for session in session_ids {
                deselect_session(conn, row, *session).await?;
            }
        }
        DraftEdit::ClearSelection => {
            let selected: Vec<String> = sqlx::query_scalar(
                "SELECT session_id FROM view_session_choices \
                 WHERE revision_row = ?1 AND state = 'selected' ORDER BY session_id",
            )
            .bind(row)
            .fetch_all(&mut *conn)
            .await?;
            for session in selected {
                deselect_session(conn, row, parse_uuid(&session)?).await?;
            }
        }
        DraftEdit::SetFrames { member_keys, state } => {
            set_frames(conn, row, member_keys, *state).await?;
        }
    }
    Ok(())
}

/// Choose expected candidates; a session outside the run's candidates is
/// refused (the picker offers candidates only).
async fn select_expected(
    conn: &mut SqliteConnection,
    view: &View,
    row: i64,
    sessions: &[ExpectedSession],
    reason: &SelectionReason,
) -> Result<()> {
    let candidates: BTreeSet<Uuid> = run_candidates(conn, view).await?.into_iter().collect();
    for session in check_expected_sessions(conn, sessions).await? {
        if !candidates.contains(&session.id) {
            return Err(invalid(format!(
                "session {} is not a candidate of this run's subject on its rig",
                session.id
            )));
        }
        select_session(conn, row, &session, reason, None).await?;
    }
    Ok(())
}

/// The draft row an edit applies to, after checking `expected_draft`: the
/// existing draft one revision further, or a copy of the latest committed
/// revision at draft revision 1.
async fn begin_edit(
    conn: &mut SqliteConnection,
    view: &View,
    expected_draft: Revision,
) -> Result<i64> {
    let at = now()?;
    if let Some(draft) = draft_row(conn, view.id).await? {
        if draft.draft_revision != expected_draft {
            return Err(conflict(view.id, draft.draft_revision));
        }
        sqlx::query("UPDATE view_revisions SET draft_revision = ?2, updated_at = ?3 WHERE id = ?1")
            .bind(draft.row)
            .bind(db_revision(draft.draft_revision + 1)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?;
        return Ok(draft.row);
    }
    if expected_draft != 0 {
        return Err(conflict(view.id, 0));
    }
    let base: i64 =
        sqlx::query_scalar("SELECT id FROM view_revisions WHERE view_id = ?1 AND revision = ?2")
            .bind(view.id.to_string())
            .bind(db_revision(view.revision)?)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| {
                LibraryError::NotFound(format!("revision {} of view {}", view.revision, view.id))
            })?;
    let row = sqlx::query(
        "INSERT INTO view_revisions (view_id, state, draft_revision, base_revision, name, \
         criteria, updated_at) SELECT view_id, 'draft', 1, revision, name, criteria, ?2 \
         FROM view_revisions WHERE id = ?1",
    )
    .bind(base)
    .bind(&at)
    .execute(&mut *conn)
    .await?
    .last_insert_rowid();
    for statement in [
        "INSERT INTO view_session_choices SELECT ?2, session_id, grouping_revision, state, \
         reason, evidence FROM view_session_choices WHERE revision_row = ?1",
        "INSERT INTO view_members SELECT ?2, member_key, session_id, state, reason, \
         quality_when_chosen, added_in_revision FROM view_members WHERE revision_row = ?1",
        "INSERT INTO view_member_copies SELECT ?2, member_key, asset_id, decision_revision, \
         fingerprint FROM view_member_copies WHERE revision_row = ?1",
    ] {
        sqlx::query(statement).bind(base).bind(row).execute(&mut *conn).await?;
    }
    Ok(row)
}

/// The draft after checking `expected_draft`: a run without a draft is at
/// draft revision 0.
async fn require_draft(
    conn: &mut SqliteConnection,
    id: Uuid,
    expected_draft: Revision,
) -> Result<DraftRow> {
    let draft = draft_row(conn, id).await?.ok_or_else(|| conflict(id, 0))?;
    if draft.draft_revision != expected_draft {
        return Err(conflict(id, draft.draft_revision));
    }
    Ok(draft)
}

async fn delete_revision_rows(conn: &mut SqliteConnection, row: i64) -> Result<()> {
    for statement in [
        "DELETE FROM view_member_copies WHERE revision_row = ?1",
        "DELETE FROM view_members WHERE revision_row = ?1",
        "DELETE FROM view_session_choices WHERE revision_row = ?1",
        "DELETE FROM view_revisions WHERE id = ?1",
    ] {
        sqlx::query(statement).bind(row).execute(&mut *conn).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

fn optional_uuid(row: &SqliteRow, column: &str) -> Result<Option<Uuid>> {
    row.try_get::<Option<String>, _>(column)?.as_deref().map(parse_uuid).transpose()
}

fn view_from_row(row: &SqliteRow) -> Result<View> {
    Ok(View {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
        subject_id: parse_uuid(&row.try_get::<String, _>("subject_id")?)?,
        rig_id: parse_uuid(&row.try_get::<String, _>("rig_id")?)?,
        group_id: optional_uuid(row, "group_id")?,
        panel_id: optional_uuid(row, "panel_id")?,
        stage: from_text(&row.try_get::<String, _>("stage")?)?,
        completion: from_text(&row.try_get::<String, _>("completion")?)?,
        stage_before_complete: row
            .try_get::<Option<String>, _>("stage_before_complete")?
            .as_deref()
            .map(from_text)
            .transpose()?,
        trashed_at: row.try_get("trashed_at")?,
        profile_id: optional_uuid(row, "profile_id")?,
        calibration_policy: from_text(&row.try_get::<String, _>("calibration_policy")?)?,
        revision: revision(row.try_get("revision")?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

pub async fn load_view(conn: &mut SqliteConnection, id: Uuid) -> Result<View> {
    let row = sqlx::query("SELECT * FROM views WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("view {id}")))?;
    view_from_row(&row)
}

async fn draft_row(conn: &mut SqliteConnection, id: Uuid) -> Result<Option<DraftRow>> {
    let row = sqlx::query(
        "SELECT id, draft_revision, base_revision FROM view_revisions \
         WHERE view_id = ?1 AND state = 'draft'",
    )
    .bind(id.to_string())
    .fetch_optional(&mut *conn)
    .await?;
    row.map(|row| {
        Ok(DraftRow {
            row: row.try_get("id")?,
            draft_revision: revision(row.try_get("draft_revision")?)?,
            base_revision: revision(row.try_get("base_revision")?)?,
        })
    })
    .transpose()
}

fn header_of(row: &SqliteRow, view_id: Uuid) -> Result<ViewRevisionHeader> {
    Ok(ViewRevisionHeader {
        view_id,
        revision: revision(row.try_get("revision")?)?,
        name: row.try_get("name")?,
        criteria: from_json(&row.try_get::<String, _>("criteria")?)?,
        based_on: revision(row.try_get("base_revision")?)?,
        refresh_review_id: optional_uuid(row, "refresh_review_id")?,
        committed_at: row.try_get("committed_at")?,
    })
}

/// The row id and header of committed `revision`.
pub async fn committed_header(
    conn: &mut SqliteConnection,
    id: Uuid,
    revision: Revision,
) -> Result<(i64, ViewRevisionHeader)> {
    let row = sqlx::query(
        "SELECT * FROM view_revisions WHERE view_id = ?1 AND revision = ?2 AND state = 'committed'",
    )
    .bind(id.to_string())
    .bind(db_revision(revision)?)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| LibraryError::NotFound(format!("revision {revision} of view {id}")))?;
    Ok((row.try_get("id")?, header_of(&row, id)?))
}

/// The row id and header of the draft.
async fn draft_header(
    conn: &mut SqliteConnection,
    view: &View,
) -> Result<Option<(i64, ViewDraftHeader)>> {
    let row = sqlx::query("SELECT * FROM view_revisions WHERE view_id = ?1 AND state = 'draft'")
        .bind(view.id.to_string())
        .fetch_optional(&mut *conn)
        .await?;
    row.map(|row| {
        let base_revision = revision(row.try_get("base_revision")?)?;
        Ok((
            row.try_get("id")?,
            ViewDraftHeader {
                view_id: view.id,
                draft_revision: revision(row.try_get("draft_revision")?)?,
                base_revision,
                name: row.try_get("name")?,
                criteria: from_json(&row.try_get::<String, _>("criteria")?)?,
                refresh_review_id: optional_uuid(&row, "refresh_review_id")?,
                updated_at: row.try_get("updated_at")?,
                stale: base_revision != view.revision,
            },
        ))
    })
    .transpose()
}

async fn load_record(conn: &mut SqliteConnection, id: Uuid) -> Result<ViewRecord> {
    let view = load_view(conn, id).await?;
    let revision = if view.revision == 0 {
        None
    } else {
        Some(committed_header(conn, id, view.revision).await?.1)
    };
    let draft = draft_header(conn, &view).await?.map(|(_, header)| header);
    Ok(ViewRecord { view, revision, draft })
}

async fn load_choices(conn: &mut SqliteConnection, row: i64) -> Result<Vec<SessionChoice>> {
    let rows = sqlx::query(
        "SELECT * FROM view_session_choices WHERE revision_row = ?1 ORDER BY session_id",
    )
    .bind(row)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            let state: SessionChoiceState = from_text(&row.try_get::<String, _>("state")?)?;
            Ok(SessionChoice {
                session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
                grouping_revision: revision(row.try_get("grouping_revision")?)?,
                state,
                reason: from_json(&row.try_get::<String, _>("reason")?)?,
                evidence: row
                    .try_get::<Option<String>, _>("evidence")?
                    .as_deref()
                    .map(from_json)
                    .transpose()?,
            })
        })
        .collect()
}

pub async fn load_members(conn: &mut SqliteConnection, row: i64) -> Result<Vec<ViewMember>> {
    let rows =
        sqlx::query("SELECT * FROM view_members WHERE revision_row = ?1 ORDER BY member_key")
            .bind(row)
            .fetch_all(&mut *conn)
            .await?;
    let copies = sqlx::query(
        "SELECT member_key, asset_id, decision_revision, fingerprint FROM view_member_copies \
         WHERE revision_row = ?1 ORDER BY member_key, asset_id",
    )
    .bind(row)
    .fetch_all(&mut *conn)
    .await?;
    let mut by_member: BTreeMap<String, Vec<MemberCopy>> = BTreeMap::new();
    for copy in &copies {
        by_member.entry(copy.try_get("member_key")?).or_default().push(MemberCopy {
            asset_id: parse_uuid(&copy.try_get::<String, _>("asset_id")?)?,
            decision_revision: revision(copy.try_get("decision_revision")?)?,
            fingerprint: from_json(&copy.try_get::<String, _>("fingerprint")?)?,
        });
    }
    rows.iter()
        .map(|row| {
            let key: String = row.try_get("member_key")?;
            Ok(ViewMember {
                member_key: parse_uuid(&key)?,
                session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
                state: from_text(&row.try_get::<String, _>("state")?)?,
                reason: from_json(&row.try_get::<String, _>("reason")?)?,
                quality_when_chosen: from_json(&row.try_get::<String, _>("quality_when_chosen")?)?,
                added_in_revision: row
                    .try_get::<Option<i64>, _>("added_in_revision")?
                    .map(revision)
                    .transpose()?,
                copies: by_member.remove(&key).unwrap_or_default(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use platevault_model::{
        AssociationState, Equipment, NewView, ProjectInput, Provenance, SubjectInput,
        TargetCandidate,
    };
    use uuid::Uuid;

    use super::Catalog;

    /// A disposable `max_page_count` catalog forces `SQLITE_FULL` on Save: the
    /// draft's long name moves to new overflow pages before its old ones are
    /// freed. Save reports `PersistenceFailure`, the draft stays a draft, no
    /// revision exists after reopen, and an unlimited retry saves.
    #[tokio::test]
    async fn sqlite_full_on_save_reports_persistence_failure_and_keeps_the_draft() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("catalog.sqlite");
        let catalog = Catalog::open(&path).await.unwrap();
        let target = TargetCandidate {
            id: Uuid::new_v4(),
            designation: "NGC 7000".into(),
            aliases: Vec::new(),
            common_name: None,
            object_type: "nebula".into(),
            coordinates: None,
            provenance: Provenance::User,
            provider_id: None,
            angular_size: None,
            catalogues: Vec::new(),
        };
        let target = catalog.save_target(&target, None).await.unwrap();
        let rig = Equipment {
            id: Uuid::new_v4(),
            name: "RedCat 51".into(),
            camera: None,
            telescope: None,
            focal_length_mm: None,
            pixel_size_um: None,
            sensor_width_px: None,
            sensor_height_px: None,
            color_kind: None,
            decision_revision: 0,
            state: AssociationState::Confirmed,
            provenance: Provenance::User,
        };
        let rig = catalog.save_equipment(&rig, None).await.unwrap();
        let project = catalog
            .create_project(&ProjectInput {
                name: "NGC 7000 HOO".into(),
                notes: None,
                subjects: vec![SubjectInput {
                    target_id: target.candidate.id,
                    name: None,
                    mosaic: false,
                    panels: Vec::new(),
                }],
                rig_ids: vec![rig.id],
                goals: Vec::new(),
            })
            .await
            .unwrap();
        let input = NewView {
            project_id: project.id,
            subject_id: project.subjects[0].id,
            rig_id: rig.id,
            name: format!("{} ", "x".repeat(400_000)),
        };
        let record = catalog.create_view(&input).await.unwrap();
        let id = record.view.id;
        catalog.limit_writer_pages_for_test().await.unwrap();
        let error = catalog.save_view(id, 0, 1).await.unwrap_err();
        assert_eq!(error.response(None, None).kind, "persistence_failure");
        assert!(error.to_string().contains("full"), "{error}");
        catalog.close().await.unwrap();
        let reopened = Catalog::open(&path).await.unwrap();
        let unsaved = reopened.view(id).await.unwrap();
        assert_eq!(unsaved, record, "still a draft at revision 0");
        assert_eq!(
            reopened.view_revision(id, 1).await.unwrap_err().response(None, None).kind,
            "not_found"
        );
        let saved = reopened.save_view(id, 0, 1).await.unwrap();
        assert_eq!(
            (saved.view.revision, saved.draft.is_none()),
            (1, true),
            "an unlimited writer saves"
        );
    }
}
