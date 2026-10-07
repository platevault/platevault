// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Frame review lists (spec 067 PIX-FR-14, PIX-FR-17, PIX-FR-18, D-W41,
//! D-W42, D-W43): the logical captures (D16) of a run's membership, of every
//! panel run of a run group, or of a Project's candidate sessions, read in one
//! catalog snapshot. Each capture comes with the copy it is reviewed through,
//! its applicable quality, the listed Project's latest Project-only decisions
//! and, in a run group, its panel run. Trashed copies are never listed, so a
//! capture whose copies are all Trashed is left out. Reads no source and
//! writes nothing.

use std::collections::hash_map::Entry;
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;

use platevault_model::{
    ApplicableQuality, Asset, Availability, LibraryError, MemberReason, MemberState, Membership,
    NativePath, ProjectDecision, ReviewContext, ReviewMember, ReviewPanel, ReviewPanelRun,
    ReviewRun, RunCompletion,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::view_groups::panel_number;
use super::{
    asset_from_row, from_json, from_text, json_ids, load_assets, load_location, parse_uuid,
    projects, revision, CaptureView, Catalog, Result,
};

/// One logical capture of a review context, outside the Trash.
#[derive(Clone, Debug)]
pub struct ReviewCapture {
    /// The copy the capture is reviewed and marked through: the copy whose
    /// library decision applies, else one rejected for the Project, else an
    /// Available copy, else the smallest id.
    pub asset: Asset,
    /// The copy's absolute path.
    pub path: NativePath,
    pub session_id: Uuid,
    /// The capture's applicable quality over its copies outside the Trash.
    pub quality: ApplicableQuality,
    /// The reviewed copy's latest decision in the listed Project.
    pub project: ProjectDecision,
    /// The latest decision of some copy outside the Trash rejects it for the
    /// listed Project.
    pub project_rejected: bool,
    pub other_copies: Vec<Uuid>,
    /// A run's member holding the capture.
    pub member: Option<ReviewMember>,
    /// In a run group, the panel run whose membership holds the capture.
    pub panel: Option<ReviewPanel>,
}

/// A review context's Project, its run or panel runs and its live captures.
#[derive(Clone, Debug)]
pub struct ReviewBasis {
    pub project_id: Uuid,
    pub run: Option<ReviewRun>,
    /// A run group's panel runs outside the Trash, by panel number.
    pub panels: Vec<ReviewPanelRun>,
    pub captures: Vec<ReviewCapture>,
}

/// An asset outside the Trash with its absolute path.
#[derive(Clone, Debug)]
pub struct ReviewAsset {
    pub asset: Asset,
    pub path: NativePath,
}

impl Catalog {
    /// The context's live captures from one catalog snapshot. A run lists the
    /// members of its draft while it is open and has one, else of its latest
    /// committed revision; a run group lists each panel run outside the Trash
    /// that way, by panel number; a Project lists its candidate sessions'
    /// frames.
    ///
    /// # Errors
    /// `NotFound` for an unknown run, run group or Project; `InvalidInput` for
    /// a run in the Project's Trash; `PersistenceFailure` when the catalog
    /// cannot be read.
    pub async fn review_basis(&self, context: ReviewContext) -> Result<ReviewBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let basis = match context {
            ReviewContext::Run { view_id } => run_basis(&mut snapshot, view_id).await?,
            ReviewContext::ViewGroup { group_id } => group_basis(&mut snapshot, group_id).await?,
            ReviewContext::ProjectCandidates { project_id } => {
                candidates_basis(&mut snapshot, project_id).await?
            }
        };
        snapshot.rollback().await?;
        Ok(basis)
    }

    /// The panel run of run group `group` whose listed membership holds copy
    /// `asset`: the run a Review all mark of that frame routes through.
    ///
    /// # Errors
    /// `NotFound` for an unknown run group; `InvalidInput` when no panel run
    /// outside the Trash, or more than one, lists the copy.
    pub async fn review_group_run(&self, group: Uuid, asset: Uuid) -> Result<Uuid> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let mut holding = Vec::new();
        for panel in group_panels(&mut snapshot, group).await?.1 {
            let Some(row) = listed_run(&mut snapshot, panel.view_id).await?.row else {
                continue;
            };
            let held: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM view_member_copies WHERE revision_row = ?1 AND asset_id = ?2",
            )
            .bind(row)
            .bind(asset.to_string())
            .fetch_optional(&mut *snapshot)
            .await?;
            if held.is_some() {
                holding.push(panel.view_id);
            }
        }
        snapshot.rollback().await?;
        match holding.as_slice() {
            [run] => Ok(*run),
            [] => Err(LibraryError::InvalidInput(format!(
                "asset {asset} is a member of no panel run of run group {group}"
            ))),
            _ => Err(LibraryError::InvalidInput(format!(
                "asset {asset} is a member of more than one panel run of run group {group}; \
                 mark it in its panel run's Review step"
            ))),
        }
    }

    /// Each asset in request order with its absolute path.
    ///
    /// # Errors
    /// `InvalidInput` for an asset listed twice or a Trashed frame, which
    /// frame review never lists; `NotFound` for an unknown asset.
    pub async fn review_assets(&self, ids: &[Uuid]) -> Result<Vec<ReviewAsset>> {
        let mut unique = BTreeSet::new();
        if let Some(twice) = ids.iter().find(|id| !unique.insert(**id)) {
            return Err(LibraryError::InvalidInput(format!("asset {twice} is listed twice")));
        }
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let assets = load_assets(&mut snapshot, &unique).await?;
        if let Some(trashed) =
            assets.iter().find(|asset| asset.availability == Availability::Trashed)
        {
            return Err(LibraryError::InvalidInput(format!(
                "asset {} is in the Trash and is never listed in frame review",
                trashed.id
            )));
        }
        let mut roots = Roots::new();
        let mut by_id = HashMap::with_capacity(assets.len());
        for asset in assets {
            let path = absolute(&mut snapshot, &mut roots, &asset).await?;
            by_id.insert(asset.id, ReviewAsset { asset, path });
        }
        snapshot.rollback().await?;
        ids.iter()
            .map(|id| by_id.remove(id).ok_or_else(|| LibraryError::NotFound(format!("asset {id}"))))
            .collect()
    }
}

/// Location roots by id, each read once.
type Roots = HashMap<Uuid, PathBuf>;

async fn absolute(
    conn: &mut SqliteConnection,
    roots: &mut Roots,
    asset: &Asset,
) -> Result<NativePath> {
    let root = match roots.entry(asset.location_id) {
        Entry::Occupied(root) => root.into_mut(),
        Entry::Vacant(slot) => {
            slot.insert(load_location(conn, asset.location_id).await?.path.to_path_buf()?)
        }
    };
    Ok(NativePath::from_path(&root.join(asset.relative_path.relative_path()?)))
}

/// One member of the listed membership with its recorded copies.
struct RunMember {
    member: ReviewMember,
    session_id: Uuid,
    copies: Vec<Uuid>,
}

/// The membership a run's Review step lists: the run and the revision row it
/// reads, if any.
struct ListedRun {
    project_id: Uuid,
    run: ReviewRun,
    row: Option<i64>,
}

async fn run_basis(conn: &mut SqliteConnection, id: Uuid) -> Result<ReviewBasis> {
    let ListedRun { project_id, run, row } = listed_run(conn, id).await?;
    let captures = run_captures(conn, project_id, row, None).await?;
    Ok(ReviewBasis { project_id, run: Some(run), panels: Vec::new(), captures })
}

/// Every panel run of run group `group` outside the Trash, by panel number,
/// each listed as its own Review step lists it; each capture names its panel.
async fn group_basis(conn: &mut SqliteConnection, group: Uuid) -> Result<ReviewBasis> {
    let (project_id, group_panels) = group_panels(conn, group).await?;
    let mut panels = Vec::with_capacity(group_panels.len());
    let mut captures = Vec::new();
    for panel in group_panels {
        let ListedRun { run, row, .. } = listed_run(conn, panel.view_id).await?;
        captures.extend(run_captures(conn, project_id, row, Some(panel)).await?);
        panels.push(ReviewPanelRun { panel_id: panel.panel_id, number: panel.number, run });
    }
    Ok(ReviewBasis { project_id, run: None, panels, captures })
}

/// Run group `group`'s Project and its panel runs outside the Trash, by panel
/// number; a panel run in the Trash has no Review step.
async fn group_panels(
    conn: &mut SqliteConnection,
    group: Uuid,
) -> Result<(Uuid, Vec<ReviewPanel>)> {
    let project: String = sqlx::query_scalar("SELECT project_id FROM view_groups WHERE id = ?1")
        .bind(group.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("run group {group}")))?;
    let rows = sqlx::query(
        "SELECT v.id, v.panel_id, p.number FROM views v \
         JOIN subject_panels p ON p.id = v.panel_id \
         WHERE v.group_id = ?1 AND v.trashed_at IS NULL ORDER BY p.number",
    )
    .bind(group.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let panels = rows
        .iter()
        .map(|row| {
            Ok(ReviewPanel {
                panel_id: parse_uuid(&row.try_get::<String, _>("panel_id")?)?,
                number: panel_number(row.try_get("number")?)?,
                view_id: parse_uuid(&row.try_get::<String, _>("id")?)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok((parse_uuid(&project)?, panels))
}

/// The run's Review step membership: its draft while it is open and has one,
/// else its latest committed revision.
async fn listed_run(conn: &mut SqliteConnection, id: Uuid) -> Result<ListedRun> {
    let row =
        sqlx::query("SELECT project_id, completion, trashed_at, revision FROM views WHERE id = ?1")
            .bind(id.to_string())
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| LibraryError::NotFound(format!("run {id}")))?;
    if row.try_get::<Option<String>, _>("trashed_at")?.is_some() {
        return Err(LibraryError::InvalidInput(format!(
            "run {id} is in the Project's Trash and has no Review step"
        )));
    }
    let project_id = parse_uuid(&row.try_get::<String, _>("project_id")?)?;
    let completion: RunCompletion = from_text(&row.try_get::<String, _>("completion")?)?;
    let committed: i64 = row.try_get("revision")?;
    // A Complete run's membership is its fixed latest revision.
    let draft = if completion == RunCompletion::Open {
        sqlx::query(
            "SELECT id, draft_revision FROM view_revisions WHERE view_id = ?1 AND state = 'draft'",
        )
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
    } else {
        None
    };
    let (revision_row, membership, draft_revision) = match draft {
        Some(draft) => {
            let row: i64 = draft.try_get("id")?;
            (Some(row), Membership::Draft, revision(draft.try_get("draft_revision")?)?)
        }
        None if committed > 0 => {
            let row: i64 = sqlx::query_scalar(
                "SELECT id FROM view_revisions WHERE view_id = ?1 AND revision = ?2",
            )
            .bind(id.to_string())
            .bind(committed)
            .fetch_one(&mut *conn)
            .await?;
            (Some(row), Membership::Committed, 0)
        }
        // Neither a draft nor a saved revision: nothing is selected.
        None => (None, Membership::Draft, 0),
    };
    let run = ReviewRun { view_id: id, completion, membership, draft_revision };
    Ok(ListedRun { project_id, run, row: revision_row })
}

/// The live captures of revision row `row` of a run of `project_id`, each in
/// `panel` when the run is a listed panel run.
async fn run_captures(
    conn: &mut SqliteConnection,
    project_id: Uuid,
    row: Option<i64>,
    panel: Option<ReviewPanel>,
) -> Result<Vec<ReviewCapture>> {
    let members = match row {
        Some(row) => run_members(conn, row).await?,
        None => Vec::new(),
    };
    let ids: BTreeSet<Uuid> =
        members.iter().flat_map(|member| member.copies.iter().copied()).collect();
    let all = live_assets(conn, &ids).await?;
    let live: HashMap<Uuid, &Asset> = all.iter().map(|asset| (asset.id, asset)).collect();
    let sessions: Vec<Uuid> = members
        .iter()
        .map(|member| member.session_id)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let captures_of = CaptureView::read(conn, &sessions, &all).await?;
    let mut listing = Listing::read(conn, project_id, &ids).await?;
    let mut captures = Vec::with_capacity(members.len());
    for RunMember { member, session_id, copies } in members {
        let present: Vec<&Asset> =
            copies.iter().filter_map(|copy| live.get(copy).copied()).collect();
        let Some(asset) = reviewed_copy(&present, &listing.decisions) else {
            continue;
        };
        let quality = captures_of.quality(captures_of.key(asset));
        let member = Some(member);
        let mut capture =
            listing.capture(conn, &present, asset, quality, session_id, member).await?;
        capture.panel = panel;
        captures.push(capture);
    }
    Ok(captures)
}

/// The members of revision row `row`, each with its recorded copies, by key.
async fn run_members(conn: &mut SqliteConnection, row: i64) -> Result<Vec<RunMember>> {
    let rows = sqlx::query(
        "SELECT m.member_key, m.session_id, m.state, m.reason, c.asset_id FROM view_members m \
         JOIN view_member_copies c ON c.revision_row = m.revision_row \
         AND c.member_key = m.member_key \
         WHERE m.revision_row = ?1 ORDER BY m.member_key, c.asset_id",
    )
    .bind(row)
    .fetch_all(&mut *conn)
    .await?;
    let mut members: Vec<RunMember> = Vec::new();
    for row in &rows {
        let key = parse_uuid(&row.try_get::<String, _>("member_key")?)?;
        let copy = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
        if let Some(member) = members.last_mut().filter(|member| member.member.member_key == key) {
            member.copies.push(copy);
            continue;
        }
        let state: MemberState = from_text(&row.try_get::<String, _>("state")?)?;
        let reason: MemberReason = from_json(&row.try_get::<String, _>("reason")?)?;
        members.push(RunMember {
            member: ReviewMember { member_key: key, state, reason },
            session_id: parse_uuid(&row.try_get::<String, _>("session_id")?)?,
            copies: vec![copy],
        });
    }
    Ok(members)
}

async fn candidates_basis(conn: &mut SqliteConnection, project: Uuid) -> Result<ReviewBasis> {
    projects::require_project(conn, project).await?;
    let candidates = projects::candidates(conn, project).await?;
    let mut session_of: HashMap<Uuid, Uuid> = HashMap::new();
    let mut sessions = BTreeSet::new();
    for candidate in &candidates {
        sessions.insert(candidate.session_id);
        for asset in &candidate.asset_ids {
            session_of.entry(*asset).or_insert(candidate.session_id);
        }
    }
    let sessions: Vec<Uuid> = sessions.into_iter().collect();
    let ids: BTreeSet<Uuid> = session_of.keys().copied().collect();
    let all = live_assets(conn, &ids).await?;
    let captures_of = CaptureView::read(conn, &sessions, &all).await?;
    let mut listing = Listing::read(conn, project, &ids).await?;
    let mut captures = Vec::new();
    for (key, present) in captures_of.group(&all) {
        let Some(asset) = reviewed_copy(&present, &listing.decisions) else {
            continue;
        };
        let quality = captures_of.quality(&key);
        let session_id = session_of[&asset.id];
        captures.push(listing.capture(conn, &present, asset, quality, session_id, None).await?);
    }
    Ok(ReviewBasis { project_id: project, run: None, panels: Vec::new(), captures })
}

/// What every capture of one listing reads beside its copies: the listed
/// Project's decisions and the location roots.
struct Listing {
    decisions: HashMap<Uuid, ProjectDecision>,
    roots: Roots,
}

impl Listing {
    async fn read(
        conn: &mut SqliteConnection,
        project: Uuid,
        ids: &BTreeSet<Uuid>,
    ) -> Result<Self> {
        Ok(Self { decisions: project_decisions(conn, project, ids).await?, roots: Roots::new() })
    }

    /// The capture of `present`, the copies outside the Trash, reviewed
    /// through `asset`.
    async fn capture(
        &mut self,
        conn: &mut SqliteConnection,
        present: &[&Asset],
        asset: &Asset,
        quality: ApplicableQuality,
        session_id: Uuid,
        member: Option<ReviewMember>,
    ) -> Result<ReviewCapture> {
        let rejects =
            |copy: &&Asset| self.decisions.get(&copy.id).is_some_and(|decision| decision.rejected);
        Ok(ReviewCapture {
            project: self.decisions.get(&asset.id).copied().unwrap_or_default(),
            project_rejected: present.iter().any(rejects),
            path: absolute(conn, &mut self.roots, asset).await?,
            session_id,
            quality,
            other_copies: present.iter().map(|copy| copy.id).filter(|id| *id != asset.id).collect(),
            member,
            panel: None,
            asset: asset.clone(),
        })
    }
}

/// The copy a capture is reviewed and marked through, so a mark updates the
/// decision that speaks for the capture instead of conflicting with it.
fn reviewed_copy<'a>(
    copies: &[&'a Asset],
    decisions: &HashMap<Uuid, ProjectDecision>,
) -> Option<&'a Asset> {
    copies.iter().copied().min_by_key(|copy| {
        let decided = matches!(
            copy.applicable_quality(),
            ApplicableQuality::Usable
                | ApplicableQuality::Unusable
                | ApplicableQuality::VerificationPending { .. }
        );
        let rejected = decisions.get(&copy.id).is_some_and(|decision| decision.rejected);
        (!decided, !rejected, copy.availability != Availability::Available, copy.id)
    })
}

/// The assets of `ids` outside the Trash, in id order.
async fn live_assets(conn: &mut SqliteConnection, ids: &BTreeSet<Uuid>) -> Result<Vec<Asset>> {
    let query = asset_sql!(live "WHERE a.id IN (SELECT value FROM json_each(?1)) ORDER BY a.id");
    let rows = sqlx::query(query).bind(json_ids(ids)?).fetch_all(&mut *conn).await?;
    rows.iter().map(asset_from_row).collect()
}

/// The latest Project-only decision of each of `ids` in `project`.
async fn project_decisions(
    conn: &mut SqliteConnection,
    project: Uuid,
    ids: &BTreeSet<Uuid>,
) -> Result<HashMap<Uuid, ProjectDecision>> {
    let rows = sqlx::query(
        "SELECT r.asset_id, r.revision, r.rejected FROM project_rejections r \
         WHERE r.project_id = ?1 AND r.asset_id IN (SELECT value FROM json_each(?2)) \
         AND r.revision = (SELECT max(x.revision) FROM project_rejections x \
         WHERE x.project_id = r.project_id AND x.asset_id = r.asset_id)",
    )
    .bind(project.to_string())
    .bind(json_ids(ids)?)
    .fetch_all(&mut *conn)
    .await?;
    rows.iter()
        .map(|row| {
            let decision = ProjectDecision {
                revision: revision(row.try_get("revision")?)?,
                rejected: row.try_get::<i64, _>("rejected")? == 1,
            };
            Ok((parse_uuid(&row.try_get::<String, _>("asset_id")?)?, decision))
        })
        .collect()
}
