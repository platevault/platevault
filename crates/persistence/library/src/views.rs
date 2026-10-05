// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Views (spec 066): Tier 1 reviewed membership in the clean catalog.
//!
//! A View holds immutable committed revisions and at most one durable draft.
//! Every write is one `BEGIN IMMEDIATE` transaction on the FULL-synchronous
//! writer that checks the expected revisions and every referenced record
//! first, so a refusal writes nothing. View writes touch only the View tables:
//! no library quality, session, association, Target or Project row, and no
//! file. Members are logical captures (D16) whose starting state comes from
//! their applicable quality inside the write transaction (D02) and is then kept.

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    initial_member_state, ApplicableQuality, AssessedMembers, Asset, AssetReference,
    AssociationKind, Availability, CandidateBasis, CandidateCapture, CandidateSession, CaptureCopy,
    ChoiceBasis, CopyState, CriteriaInput, DraftEdit, ExpectedAsset, ExpectedSession,
    FrameEvidence, FramingPanel, FramingSnapshot, FramingSource, FramingTarget, GeometryEvidence,
    LibraryError, MemberBasis, MemberCopy, MemberReason, MemberState, Membership, MembershipBasis,
    NewView, ReferenceKind, Revision, SelectionReason, Session, SessionChoice, SessionChoiceState,
    SuggestedChoice, View, ViewCriteria, ViewDraftHeader, ViewListing, ViewMember, ViewOrigin,
    ViewOriginInput, ViewQuery, ViewRecord, ViewRevision, ViewRevisionHeader,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    check_expected_sessions, conflict, current_member_assets, db_revision, fingerprint_matches,
    from_json, from_text, is_light, json_ids, load_assets, load_associations, load_equipment,
    load_session_row, load_target, members_unchanged, now, parse_uuid, projects, require_revision,
    revision, summarize_rows, to_json, to_text, CaptureView, Catalog, Result, MAX_PAGE,
};

fn invalid(message: String) -> LibraryError {
    LibraryError::InvalidInput(message)
}

/// The draft row of a View.
struct DraftRow {
    row: i64,
    draft_revision: Revision,
    base_revision: Revision,
    name: String,
}

impl Catalog {
    /// Create a View at revision 0 with unsaved work at draft revision 1. A
    /// Project origin snapshots the Project's framing, panels and equipment and
    /// holds the preselected suggestions; a Target origin snapshots the Target
    /// at the revision the user saw; a Sessions origin holds exactly those
    /// sessions. Writes only View rows.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project, Target or session; `Conflict` for a
    /// stale Target, Project or session (with successors when superseded) or a
    /// suggestion whose assessed members changed; `InvalidInput` for invalid
    /// criteria or suggestions without a Project origin.
    pub async fn create_view(&self, input: &NewView) -> Result<ViewRecord> {
        input.criteria.validate()?;
        if !input.suggestions.is_empty() && !matches!(input.origin, ViewOriginInput::Project { .. })
        {
            return Err(invalid("only a Project origin preselects suggestions".into()));
        }
        let record = write_txn!(self, |conn| {
            let (origin, framing, equipment_ids, project_id) =
                origin_snapshot(conn, &input.origin, input.framing_revision).await?;
            let id = Uuid::new_v4();
            let at = now()?;
            let (origin_project, origin_target) = match &input.origin {
                ViewOriginInput::Project { project_id } => (Some(*project_id), None),
                ViewOriginInput::Target { target_id, .. } => (None, Some(*target_id)),
                ViewOriginInput::Sessions { .. } => (None, None),
            };
            sqlx::query(
                "INSERT INTO views (id, origin, origin_project_id, origin_target_id, revision, \
                 created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
            )
            .bind(id.to_string())
            .bind(to_text(&origin)?)
            .bind(origin_project.map(|id| id.to_string()))
            .bind(origin_target.map(|id| id.to_string()))
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            let criteria = input.criteria.criteria(framing, equipment_ids);
            let row = sqlx::query(
                "INSERT INTO view_revisions (view_id, state, draft_revision, base_revision, name, \
                 project_id, criteria, updated_at) VALUES (?1, 'draft', 1, 0, ?2, ?3, ?4, ?5)",
            )
            .bind(id.to_string())
            .bind(input.name.as_deref().unwrap_or_default())
            .bind(project_id.map(|id| id.to_string()))
            .bind(to_json(&criteria)?)
            .bind(&at)
            .execute(&mut *conn)
            .await?
            .last_insert_rowid();
            if let ViewOriginInput::Sessions { sessions } = &input.origin {
                for session in check_expected_sessions(conn, sessions).await? {
                    select_session(conn, row, &session, &SelectionReason::OriginSessions, None)
                        .await?;
                }
            }
            for suggestion in &input.suggestions {
                choose_suggestion(conn, row, suggestion).await?;
            }
            load_record(conn, id).await?
        });
        Ok(record)
    }

    /// Apply one edit to the View's unsaved work. With `expected_draft` 0 and no
    /// draft, the edit starts a draft from the latest committed revision.
    /// Committed revisions never change.
    ///
    /// # Errors
    /// `Conflict` carrying the current draft revision (0 without a draft) for a
    /// stale `expected_draft`, and for stale or superseded sessions;
    /// `InvalidInput` for invalid criteria or filters, empty or repeated ids,
    /// unselected sessions or non-member keys; `NotFound` for an unknown View,
    /// Project or session.
    pub async fn edit_view_draft(
        &self,
        id: Uuid,
        expected_draft: Revision,
        edit: &DraftEdit,
    ) -> Result<ViewRecord> {
        validate_edit(edit)?;
        let record = write_txn!(self, |conn| {
            let view = load_view(conn, id).await?;
            let row = begin_edit(conn, &view, expected_draft).await?;
            apply_edit(conn, row, edit).await?;
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
    /// `expected_draft`; `InvalidInput` naming `name` for a blank name;
    /// `NotFound` for an unknown View.
    pub async fn save_view(
        &self,
        id: Uuid,
        expected: Revision,
        expected_draft: Revision,
    ) -> Result<ViewRecord> {
        let record = write_txn!(self, |conn| {
            let view = load_view(conn, id).await?;
            require_revision(id, view.revision, expected)?;
            let draft = require_draft(conn, id, expected_draft).await?;
            if draft.base_revision != view.revision {
                return Err(conflict(id, view.revision));
            }
            let name = draft.name.trim();
            if name.is_empty() {
                return Err(invalid(format!("name of view {id} is blank")));
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
                "UPDATE view_revisions SET state = 'committed', revision = ?2, name = ?3, \
                 committed_at = ?4, updated_at = ?4 WHERE id = ?1 AND state = 'draft'",
            )
            .bind(draft.row)
            .bind(db_revision(next)?)
            .bind(name)
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

    /// Remove the unsaved work. A View that was never saved is removed with
    /// it, and `None` is returned.
    ///
    /// # Errors
    /// `Conflict` carrying the current draft revision for a stale
    /// `expected_draft`; `NotFound` for an unknown View.
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

    /// The View with its latest committed revision and its draft, read separately.
    ///
    /// # Errors
    /// `NotFound` for an unknown View.
    pub async fn view(&self, id: Uuid) -> Result<ViewRecord> {
        let mut conn = self.reader().await?;
        load_record(&mut conn, id).await
    }

    /// View summaries by name. A View's Project is that of its latest revision,
    /// or of its draft before the first Save. Computes no totals.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn list_views(&self, query: &ViewQuery) -> Result<Vec<ViewListing>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT v.id, v.origin, v.origin_target_id, v.revision, c.committed_at, \
             coalesce(c.name, d.name) AS name, \
             CASE WHEN c.id IS NULL THEN d.project_id ELSE c.project_id END AS project_id, \
             d.id IS NOT NULL AS has_draft, \
             coalesce(d.base_revision != v.revision, 0) AS draft_stale \
             FROM views v \
             LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
             LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
             WHERE (?1 IS NULL OR (CASE WHEN c.id IS NULL THEN d.project_id \
             ELSE c.project_id END) = ?1) AND (?2 IS NULL OR v.origin_target_id = ?2) \
             ORDER BY name, v.id LIMIT ?3 OFFSET ?4",
        )
        .bind(query.project_id.map(|id| id.to_string()))
        .bind(query.target_id.map(|id| id.to_string()))
        .bind(i64::from(if query.limit == 0 { MAX_PAGE } else { query.limit.min(MAX_PAGE) }))
        .bind(i64::from(query.offset))
        .fetch_all(&mut *conn)
        .await?;
        rows.iter()
            .map(|row| {
                Ok(ViewListing {
                    id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                    name: row.try_get("name")?,
                    origin: from_text(&row.try_get::<String, _>("origin")?)?,
                    project_id: optional_uuid(row, "project_id")?,
                    target_id: optional_uuid(row, "origin_target_id")?,
                    revision: revision(row.try_get("revision")?)?,
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
    /// `NotFound` for an unknown View or revision.
    pub async fn view_revision(&self, id: Uuid, revision: Revision) -> Result<ViewRevision> {
        let mut conn = self.reader().await?;
        let (row, header) = committed_header(&mut conn, id, revision).await?;
        Ok(ViewRevision {
            header,
            sessions: load_choices(&mut conn, row).await?,
            members: load_members(&mut conn, row).await?,
        })
    }
}

// ---------------------------------------------------------------------------
// Candidate and membership reads
// ---------------------------------------------------------------------------

impl Catalog {
    /// Everything candidate evaluation reads, from one catalog snapshot: each
    /// current session with a light or unknown-image-type capture (R20) and its
    /// summary, its logical captures (D16) with their copies, applicable quality
    /// and header evidence, its associations and the member observations the
    /// evidence describes, plus every equipment record an association names.
    /// Hashes, measures and writes nothing.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn candidate_basis(&self) -> Result<CandidateBasis> {
        let mut conn = self.reader().await?;
        // One deferred transaction, so every read below sees the same snapshot.
        let mut snapshot = conn.begin().await?;
        let basis = read_candidate_basis(&mut snapshot).await?;
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
    /// `NotFound` for an unknown View, or for a membership it does not have.
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

    /// Each View whose committed revisions or draft hold any of `assets` as a
    /// member copy, naming the asked assets it holds. The reference revision
    /// is the View's latest committed revision, 0 for a never-saved draft.
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

/// Views holding asked assets in any revision row, committed or draft, with
/// the latest committed name (else the draft's) and revision.
const VIEW_REFERENCES: &str = "\
    SELECT DISTINCT v.id AS view_id, v.revision, coalesce(c.name, d.name) AS name, \
    m.asset_id FROM view_member_copies m \
    JOIN view_revisions r ON r.id = m.revision_row JOIN views v ON v.id = r.view_id \
    LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
    LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
    WHERE m.asset_id IN (SELECT value FROM json_each(?1)) ORDER BY v.id, m.asset_id";

async fn read_candidate_basis(conn: &mut SqliteConnection) -> Result<CandidateBasis> {
    let ids: Vec<String> =
        sqlx::query_scalar("SELECT id FROM sessions WHERE superseded_by IS NULL ORDER BY id")
            .fetch_all(&mut *conn)
            .await?;
    let mut rows = Vec::with_capacity(ids.len());
    let mut members = Vec::with_capacity(ids.len());
    let mut all = Vec::new();
    for id in &ids {
        let id = parse_uuid(id)?;
        let assets = current_member_assets(conn, id).await?;
        // Calibration sessions belong to CAL: a candidate has a light or
        // unknown-type capture.
        if !assets.iter().any(|asset| is_light(&asset.effective) != Some(false)) {
            continue;
        }
        rows.push(load_session_row(conn, id).await?);
        all.extend(assets.iter().cloned());
        members.push(assets);
    }
    let session_ids: Vec<Uuid> = rows.iter().map(|row| row.session.id).collect();
    let view = CaptureView::read(conn, &session_ids, &all).await?;
    let mut sessions = Vec::with_capacity(rows.len());
    let mut equipment_ids = BTreeSet::new();
    for (row, assets) in rows.into_iter().zip(members) {
        let associations = load_associations(conn, row.session.id).await?;
        equipment_ids.extend(
            associations
                .iter()
                .filter(|association| association.kind == AssociationKind::Equipment)
                .filter_map(|association| association.subject_id),
        );
        let captures = view
            .group(&assets)
            .into_iter()
            .filter_map(|(key, present)| candidate_capture(&view, &key, &present))
            .collect();
        sessions.push(CandidateSession {
            captures,
            associations,
            assessed: assessed_members(&assets),
            summary: view.summary(row, &assets, Vec::new()),
        });
    }
    let mut equipment = Vec::with_capacity(equipment_ids.len());
    for id in equipment_ids {
        equipment.push(load_equipment(conn, id).await?);
    }
    Ok(CandidateBasis { sessions, equipment })
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

/// The member observations a criteria-based choice binds (R11).
fn assessed_members(assets: &[Asset]) -> AssessedMembers {
    AssessedMembers {
        observations: assets.iter().map(|a| (a.id, a.fingerprint.clone())).collect(),
        decisions: assets.iter().map(|a| (a.id, a.decision_revision)).collect(),
        observation_revisions: assets.iter().map(|a| (a.id, a.observation_revision)).collect(),
    }
}

/// Header evidence projected from a copy's effective metadata.
fn frame_evidence(asset: &Asset) -> FrameEvidence {
    let m = &asset.effective;
    FrameEvidence {
        asset_id: asset.id,
        light: is_light(m),
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
    let (row, revision, project_id, criteria) = match membership {
        Membership::Draft => {
            let (row, header) = draft_header(conn, &view)
                .await?
                .ok_or_else(|| LibraryError::NotFound(format!("draft of view {id}")))?;
            (row, header.draft_revision, header.project_id, header.criteria)
        }
        Membership::Committed => {
            if view.revision == 0 {
                return Err(LibraryError::NotFound(format!("committed revision of view {id}")));
            }
            let (row, header) = committed_header(conn, id, view.revision).await?;
            (row, header.revision, header.project_id, header.criteria)
        }
    };
    let choices = load_choices(conn, row).await?;
    let mut session_rows = Vec::with_capacity(choices.len());
    for choice in &choices {
        session_rows.push(load_session_row(conn, choice.session_id).await?);
    }
    let summaries = summarize_rows(conn, session_rows).await?;
    let sessions = choices
        .into_iter()
        .zip(summaries)
        .map(|(choice, current)| ChoiceBasis { choice, current })
        .collect();
    let members = load_members(conn, row).await?;
    let ids: BTreeSet<Uuid> =
        members.iter().flat_map(|m| m.copies.iter().map(|copy| copy.asset_id)).collect();
    let assets = load_assets(conn, &ids).await?;
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
        .map(|member| member_basis(member, &by_id, &locations, &captures))
        .collect::<Result<_>>()?;
    Ok(MembershipBasis {
        view_id: id,
        membership,
        revision,
        project_id,
        criteria,
        sessions,
        members,
    })
}

fn member_basis(
    member: ViewMember,
    assets: &HashMap<Uuid, &Asset>,
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
        changed |= !fingerprint_matches(&current.fingerprint, &recorded.fingerprint);
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
// Origins and choices
// ---------------------------------------------------------------------------

type Snapshot = (ViewOrigin, FramingSnapshot, Vec<Uuid>, Option<Uuid>);

/// The origin's framing and equipment snapshots and the draft's Project.
async fn origin_snapshot(
    conn: &mut SqliteConnection,
    origin: &ViewOriginInput,
    framing_revision: Option<Revision>,
) -> Result<Snapshot> {
    Ok(match origin {
        ViewOriginInput::Project { project_id } => {
            let project = projects::load_project(conn, *project_id).await?;
            if let Some(expected) = framing_revision {
                require_revision(project.id, project.revision, expected)?;
            }
            let framing = FramingSnapshot {
                source: FramingSource::Project,
                project_revision: Some(project.revision),
                targets: project
                    .targets
                    .iter()
                    .map(|target| FramingTarget {
                        target_id: target.target_id,
                        revision: target.confirmed_revision,
                        designation: target.designation.clone(),
                        coordinates: target.coordinates.clone(),
                    })
                    .collect(),
                panels: project
                    .panels
                    .iter()
                    .map(|panel| FramingPanel {
                        id: panel.id,
                        name: panel.name.clone(),
                        ra_deg: panel.ra_deg,
                        dec_deg: panel.dec_deg,
                        width_deg: panel.width_deg,
                        height_deg: panel.height_deg,
                        position_angle_deg: panel.position_angle_deg,
                    })
                    .collect(),
            };
            (ViewOrigin::Project, framing, project.equipment_ids, Some(project.id))
        }
        ViewOriginInput::Target { target_id, expected_revision } => {
            let record = load_target(conn, *target_id).await?;
            require_revision(*target_id, record.decision_revision, *expected_revision)?;
            let framing = FramingSnapshot {
                source: FramingSource::Target,
                project_revision: None,
                targets: vec![FramingTarget {
                    target_id: *target_id,
                    revision: record.decision_revision,
                    designation: record.candidate.designation,
                    coordinates: record.candidate.coordinates,
                }],
                panels: Vec::new(),
            };
            (ViewOrigin::Target, framing, Vec::new(), None)
        }
        ViewOriginInput::Sessions { .. } => {
            (ViewOrigin::Sessions, FramingSnapshot::none(), Vec::new(), None)
        }
    })
}

/// Choose a criteria-based suggestion after checking the session and the
/// member observations its evidence was computed from (R11).
async fn choose_suggestion(
    conn: &mut SqliteConnection,
    row: i64,
    suggestion: &SuggestedChoice,
) -> Result<()> {
    let session =
        check_expected_sessions(conn, std::slice::from_ref(&suggestion.session)).await?.remove(0);
    let members = current_member_assets(conn, session.id).await?;
    let assessed = &suggestion.assessed;
    if !members_unchanged(
        &assessed.observations,
        &assessed.decisions,
        &assessed.observation_revisions,
        &members,
    ) {
        return Err(conflict(session.id, session.grouping_revision));
    }
    select_session(conn, row, &session, &suggestion.reason, Some(&suggestion.evidence)).await
}

/// Choose `session` in draft `row` with `reason`, adding each of its logical
/// captures once under D02. Members already in the draft keep their state.
async fn select_session(
    conn: &mut SqliteConnection,
    row: i64,
    session: &Session,
    reason: &SelectionReason,
    evidence: Option<&GeometryEvidence>,
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
    let assets = current_member_assets(conn, session.id).await?;
    let view = CaptureView::read(conn, &[session.id], &assets).await?;
    let recorded: BTreeSet<Uuid> = recorded_copies(conn, row).await?;
    for key in view.group(&assets).into_keys() {
        let mut copies = view.copies_of(&key);
        copies.sort_by_key(|copy| copy.id);
        if copies.is_empty() || copies.iter().any(|copy| recorded.contains(&copy.id)) {
            continue;
        }
        let quality = view.quality(&key);
        let (state, reason) = initial_member_state(&quality);
        let member_key = copies[0].id;
        insert_member(conn, row, member_key, session.id, state, &reason, &quality).await?;
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
    }
    Ok(())
}

async fn insert_member(
    conn: &mut SqliteConnection,
    row: i64,
    member_key: Uuid,
    session_id: Uuid,
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
    .bind(session_id.to_string())
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
        .ok_or_else(|| invalid(format!("{key} is not a member of this View")))?;
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
        DraftEdit::Details { criteria, .. } => criteria.validate(),
        DraftEdit::SelectMatching { filters, .. } => filters.validate(),
        DraftEdit::DeselectSessions { session_ids } => require_unique("sessionIds", session_ids),
        DraftEdit::SetFrames { member_keys, .. } => require_unique("memberKeys", member_keys),
        DraftEdit::SelectSessions { .. } | DraftEdit::ClearSelection => Ok(()),
    }
}

async fn apply_edit(conn: &mut SqliteConnection, row: i64, edit: &DraftEdit) -> Result<()> {
    match edit {
        DraftEdit::Details { name, project_id, criteria } => {
            set_details(conn, row, name, *project_id, criteria).await
        }
        DraftEdit::SelectSessions { sessions } => {
            select_expected(conn, row, sessions, &SelectionReason::Manual).await
        }
        DraftEdit::SelectMatching { filters, sessions } => {
            let reason = SelectionReason::SelectMatching { filters: filters.clone() };
            select_expected(conn, row, sessions, &reason).await
        }
        DraftEdit::DeselectSessions { session_ids } => {
            for session in session_ids {
                deselect_session(conn, row, *session).await?;
            }
            Ok(())
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
            Ok(())
        }
        DraftEdit::SetFrames { member_keys, state } => {
            set_frames(conn, row, member_keys, *state).await
        }
    }
}

async fn select_expected(
    conn: &mut SqliteConnection,
    row: i64,
    sessions: &[ExpectedSession],
    reason: &SelectionReason,
) -> Result<()> {
    for session in check_expected_sessions(conn, sessions).await? {
        select_session(conn, row, &session, reason, None).await?;
    }
    Ok(())
}

/// Name, Project and criteria settings; the framing and equipment snapshots
/// stay as the origin recorded them, so nothing is selected.
async fn set_details(
    conn: &mut SqliteConnection,
    row: i64,
    name: &str,
    project_id: Option<Uuid>,
    input: &CriteriaInput,
) -> Result<()> {
    if let Some(project) = project_id {
        projects::load_project(conn, project).await?;
    }
    let criteria: String = sqlx::query_scalar("SELECT criteria FROM view_revisions WHERE id = ?1")
        .bind(row)
        .fetch_one(&mut *conn)
        .await?;
    let current: ViewCriteria = from_json(&criteria)?;
    let criteria = input.criteria(current.framing, current.equipment_ids);
    sqlx::query(
        "UPDATE view_revisions SET name = ?2, project_id = ?3, criteria = ?4 WHERE id = ?1",
    )
    .bind(row)
    .bind(name)
    .bind(project_id.map(|id| id.to_string()))
    .bind(to_json(&criteria)?)
    .execute(&mut *conn)
    .await?;
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
     project_id, criteria, updated_at) SELECT view_id, 'draft', 1, revision, name, \
     project_id, criteria, ?2 FROM view_revisions WHERE id = ?1",
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

/// The draft after checking `expected_draft`; a View without a draft is at
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

async fn load_view(conn: &mut SqliteConnection, id: Uuid) -> Result<View> {
    let row = sqlx::query("SELECT * FROM views WHERE id = ?1")
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("view {id}")))?;
    Ok(View {
        id,
        origin: from_text(&row.try_get::<String, _>("origin")?)?,
        origin_project_id: optional_uuid(&row, "origin_project_id")?,
        origin_target_id: optional_uuid(&row, "origin_target_id")?,
        revision: revision(row.try_get("revision")?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn draft_row(conn: &mut SqliteConnection, id: Uuid) -> Result<Option<DraftRow>> {
    let row = sqlx::query(
        "SELECT id, draft_revision, base_revision, name FROM view_revisions \
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
            name: row.try_get("name")?,
        })
    })
    .transpose()
}

fn header_of(row: &SqliteRow, view_id: Uuid) -> Result<ViewRevisionHeader> {
    Ok(ViewRevisionHeader {
        view_id,
        revision: revision(row.try_get("revision")?)?,
        name: row.try_get("name")?,
        project_id: optional_uuid(row, "project_id")?,
        criteria: from_json(&row.try_get::<String, _>("criteria")?)?,
        based_on: revision(row.try_get("base_revision")?)?,
        refresh_review_id: optional_uuid(row, "refresh_review_id")?,
        committed_at: row.try_get("committed_at")?,
    })
}

/// The row id and header of committed `revision`.
async fn committed_header(
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
                project_id: optional_uuid(&row, "project_id")?,
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

async fn load_members(conn: &mut SqliteConnection, row: i64) -> Result<Vec<ViewMember>> {
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
    let mut by_member: std::collections::BTreeMap<String, Vec<MemberCopy>> =
        std::collections::BTreeMap::new();
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
    use platevault_model::{CriteriaInput, FramingSource, NewView, ViewOriginInput};

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
        let project = catalog
            .create_project(&platevault_model::ProjectInput {
                name: "NGC 7000 mosaic".into(),
                notes: None,
                targets: Vec::new(),
                panels: vec![platevault_model::PanelInput {
                    id: None,
                    name: "East".into(),
                    ra_deg: 314.75,
                    dec_deg: 44.33,
                    width_deg: 2.5,
                    height_deg: 1.7,
                    position_angle_deg: Some(0.0),
                }],
                equipment_ids: Vec::new(),
            })
            .await
            .unwrap();
        let input = NewView {
            origin: ViewOriginInput::Project { project_id: project.id },
            name: Some(format!("{} ", "x".repeat(400_000))),
            criteria: CriteriaInput::default(),
            framing_revision: Some(project.revision),
            suggestions: Vec::new(),
        };
        let record = catalog.create_view(&input).await.unwrap();
        let id = record.view.id;
        assert_eq!(record.draft.as_ref().unwrap().criteria.framing.source, FramingSource::Project);
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
