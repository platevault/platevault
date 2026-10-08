// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! What a Project's Done / Archive sheet reads (spec 065 PRJ-FR-14/15, root
//! FR-021; D-W43, D-W70, D-W72, D-W74), from one catalog snapshot:
//!
//! - the Project's frames as logical captures (D16) outside the Trash: its
//!   candidates, the included members of the latest saved revision of each of
//!   its runs outside the Trash, and the calibration inputs those runs' latest
//!   decisions chose, each with every live copy, its applicable library
//!   quality and whether this Project rejects it for this Project only;
//! - every prepared entry of any Project's run that reads one of those
//!   copies, with its run, and the Results that record those entries'
//!   prepared revisions;
//! - the recognized intermediates and the adopted masters' generated sources
//!   in the Results folders of the Project's runs outside the Trash and of its
//!   run groups;
//! - the Project's member sessions with the other Projects not marked Done
//!   whose runs keep them.
//!
//! The offer rules are core's. Nothing here hashes, records or moves.

use std::collections::{BTreeMap, BTreeSet};

use platevault_model::{
    ApplicableQuality, Asset, Availability, FrameCopy, KeptLibraryCopy, KeptSession, LibraryError,
    LocationRole, NativePath, ObservationFingerprint, OfferRun, Project, ProjectName, ResultOwner,
    ResultRecord, RevisionAttribution, RunCompletion,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    capture_quality, from_json, from_text, instant, json_ids, load_asset, load_assets,
    logical_captures, parse_uuid, path_from_key, projects, results, Catalog, Result,
};

/// A registered location's role and its place in registration order, which
/// decides the kept copy of a duplicate (D-W74).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegisteredLocation {
    pub id: Uuid,
    pub role: LocationRole,
    /// 0 for the earliest-registered location.
    pub order: usize,
}

/// One frame of the Project: a logical capture (D16) with a live copy.
#[derive(Clone, Debug)]
pub struct ProjectFrame {
    /// The capture key: its smallest copy asset id.
    pub key: Uuid,
    /// A copy belongs to one of the Project's candidate sessions.
    pub candidate: bool,
    /// The capture's applicable library quality.
    pub quality: ApplicableQuality,
    /// A copy carries an effective "Reject for this Project only" of this Project.
    pub project_rejected: bool,
    /// Every live copy, Missing ones included, by location then asset id.
    pub copies: Vec<FrameCopy>,
}

/// A prepared entry of a run in any Project that reads one of the frames'
/// copies: as its recorded asset, its member key, or the indexed library copy
/// of the adopted master it reads.
#[derive(Clone, Debug)]
pub struct PreparedUse {
    pub revision_id: Uuid,
    /// The preparation revision's number.
    pub preparation: u32,
    pub run: OfferRun,
    pub completion: RunCompletion,
    pub asset_id: Option<Uuid>,
    pub member_key: Option<Uuid>,
    /// The entry is the Direct-source path itself (PREP-FR-04).
    pub direct_source: bool,
}

/// A Result that records the prepared revision it came from (RES-FR-01): a
/// candidate, an attached product or an accepted one, never a Pending file
/// or an intermediate.
#[derive(Clone, Debug)]
pub struct RecordedResult {
    pub result_id: Uuid,
    pub name: String,
    pub revision_id: Uuid,
    /// Attributed by the revision's time window rather than tool evidence.
    pub inferred: bool,
}

/// A recognized processing intermediate still recorded at its path.
#[derive(Clone, Debug)]
pub struct ResultsIntermediate {
    pub result_id: Uuid,
    pub owner: ResultOwner,
    pub path: NativePath,
    pub size_bytes: u64,
}

/// An adopted master's generated source (CAL-FR-06, D-W70): an unaccepted
/// candidate in a run's Results folder whose master was adopted into the
/// library.
#[derive(Clone, Debug)]
pub struct AdoptedSource {
    pub source: ResultRecord,
    pub size_bytes: u64,
    /// The digest the master was offered and adopted at.
    pub adopted_sha256: String,
    /// The adopted library copy; its `asset_id` is set when a scan recorded
    /// the copy with the adopted digest.
    pub kept: KeptLibraryCopy,
    /// Whatever a scan recorded at the kept copy's path, any digest or state.
    pub kept_asset: Option<Asset>,
}

/// Everything the Done / Archive sheet of one Project reads.
#[derive(Clone, Debug)]
pub struct DoneArchiveBasis {
    pub project: Project,
    /// Every registered location, in registration order.
    pub locations: Vec<RegisteredLocation>,
    /// In capture key order.
    pub frames: Vec<ProjectFrame>,
    /// By Project name, run name, run and revision number.
    pub uses: Vec<PreparedUse>,
    pub recorded_results: Vec<RecordedResult>,
    pub intermediates: Vec<ResultsIntermediate>,
    pub adopted_sources: Vec<AdoptedSource>,
    /// The sessions selected in the latest saved revision of the Project's
    /// runs outside the Trash.
    pub member_sessions: Vec<Uuid>,
    /// The member sessions a run outside the Trash of another Project not
    /// marked Done selects, naming those Projects.
    pub kept_sessions: Vec<KeptSession>,
}

/// The copies the included members of each run's latest saved revision hold.
const MEMBER_COPIES: &str = "SELECT DISTINCT mc.asset_id AS id FROM views v \
     JOIN view_revisions r ON r.view_id = v.id AND r.revision = v.revision \
     JOIN view_members m ON m.revision_row = r.id AND m.state = 'included' \
     JOIN view_member_copies mc ON mc.revision_row = m.revision_row \
     AND mc.member_key = m.member_key \
     WHERE v.project_id = ?1 AND v.trashed_at IS NULL";

/// The calibration inputs the latest decision per light group and kind of
/// each run chose: a raw frame's asset, or an adopted master's indexed copy.
const CALIBRATION_INPUTS: &str = "SELECT DISTINCT coalesce(json_extract(i.value, '$.assetId'), \
     (SELECT a.id FROM assets a JOIN adopted_masters m ON a.location_id = m.location_id \
     AND a.path_key = m.path_key WHERE m.id = json_extract(i.value, '$.masterId'))) AS id \
     FROM views v JOIN calibration_decisions d ON d.view_id = v.id, json_each(d.inputs) i \
     WHERE v.project_id = ?1 AND v.trashed_at IS NULL AND d.input IS NOT NULL \
     AND d.rowid = (SELECT max(x.rowid) FROM calibration_decisions x \
     WHERE x.view_id = d.view_id AND x.light_group = d.light_group AND x.kind = d.kind)";

/// Every prepared entry, of any run in any Project, reading one of the given
/// assets by recorded asset, member key or adopted master copy, with its run.
const USES: &str = "WITH u AS (SELECT e.prep_id, e.member_key, e.kind, \
     coalesce(e.asset_id, (SELECT a.id FROM assets a JOIN adopted_masters m \
     ON a.location_id = m.location_id AND a.path_key = m.path_key WHERE m.id = e.master_id)) \
     AS asset_id FROM prepared_entries e) \
     SELECT DISTINCT u.prep_id, u.member_key, u.asset_id, u.kind = 'direct_source' AS direct, \
     p.n, v.id AS view_id, v.stage, v.completion, v.project_id, pj.name AS project_name, \
     coalesce(c.name, d.name) AS run_name \
     FROM u JOIN preparation_revisions p ON p.id = u.prep_id \
     JOIN views v ON v.id = p.view_id JOIN projects pj ON pj.id = v.project_id \
     LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
     LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
     WHERE u.asset_id IN (SELECT value FROM json_each(?1)) \
     OR u.member_key IN (SELECT value FROM json_each(?1)) \
     ORDER BY pj.name, v.project_id, run_name, v.id, p.n, u.asset_id, u.member_key";

/// The inspected Results recording one of the given prepared revisions.
const RECORDED_RESULTS: &str = "SELECT r.id, r.path, r.attribution, r.prepared_revision_id \
     FROM result_candidates r WHERE r.state IN ('candidate', 'attached', 'accepted') \
     AND r.prepared_revision_id IN (SELECT value FROM json_each(?1)) ORDER BY r.path, r.id";

/// The recognized intermediates still recorded at their path in the Results
/// folders of the Project's runs outside the Trash and of its run groups.
const INTERMEDIATES: &str = "SELECT r.id, r.view_id, r.group_id, r.path, r.fingerprint \
     FROM result_candidates r LEFT JOIN views v ON v.id = r.view_id \
     LEFT JOIN view_groups g ON g.id = r.group_id \
     WHERE r.state = 'intermediate' AND r.availability <> 'missing' \
     AND ((v.project_id = ?1 AND v.trashed_at IS NULL) OR g.project_id = ?1) \
     ORDER BY r.path, r.id";

/// The unaccepted generated masters in the Results folders of the Project's
/// runs outside the Trash whose offer was adopted, with the adopted master.
const ADOPTED_SOURCES: &str = "SELECT o.result_id, o.sha256, m.id AS master_id, m.location_id, \
     m.path_key, (SELECT a.id FROM assets a WHERE a.location_id = m.location_id \
     AND a.path_key = m.path_key) AS kept_asset_id FROM master_offers o \
     JOIN views v ON v.id = o.view_id JOIN result_candidates r ON r.id = o.result_id \
     JOIN adoption_reviews rv ON rv.state = 'adopted' \
     AND json_extract(rv.source, '$.resultId') = o.result_id \
     JOIN adopted_masters m ON m.review_id = rv.id AND m.content_sha256 = o.sha256 \
     WHERE o.state = 'adopted' AND v.project_id = ?1 AND v.trashed_at IS NULL \
     AND r.state = 'candidate' AND r.association = 'results_folder' \
     AND r.availability <> 'missing' ORDER BY r.path, m.id";

/// The sessions selected in the latest saved revision of the Project's runs
/// outside the Trash.
const MEMBER_SESSIONS: &str = "SELECT DISTINCT c.session_id AS id FROM views v \
     JOIN view_revisions r ON r.view_id = v.id AND r.revision = v.revision \
     JOIN view_session_choices c ON c.revision_row = r.id AND c.state = 'selected' \
     WHERE v.project_id = ?1 AND v.trashed_at IS NULL ORDER BY c.session_id";

/// The given sessions a run outside the Trash of another Project not marked
/// Done selects in its latest saved revision, with that Project.
const KEEPING_PROJECTS: &str = "SELECT DISTINCT c.session_id, p.id AS project_id, p.name \
     FROM views v JOIN projects p ON p.id = v.project_id \
     JOIN view_revisions r ON r.view_id = v.id AND r.revision = v.revision \
     JOIN view_session_choices c ON c.revision_row = r.id AND c.state = 'selected' \
     WHERE v.project_id <> ?1 AND p.state <> 'done' AND v.trashed_at IS NULL \
     AND c.session_id IN (SELECT value FROM json_each(?2)) \
     ORDER BY c.session_id, p.name, p.id";

impl Catalog {
    /// Everything the Done / Archive sheet of Project `id` reads, from one
    /// catalog snapshot. Hashes, records and moves nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown Project; `PersistenceFailure` when the
    /// catalog cannot be read.
    pub async fn done_archive_basis(&self, id: Uuid) -> Result<DoneArchiveBasis> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let project = projects::load_project(&mut snapshot, id).await?;
        let locations = registered_locations(&mut snapshot).await?;
        let frames = project_frames(&mut snapshot, id).await?;
        let copies: BTreeSet<Uuid> =
            frames.iter().flat_map(|frame| frame.copies.iter().map(|copy| copy.asset_id)).collect();
        let uses = prepared_uses(&mut snapshot, &copies).await?;
        let revisions: BTreeSet<Uuid> = uses.iter().map(|used| used.revision_id).collect();
        let recorded_results = recorded_results(&mut snapshot, &revisions).await?;
        let intermediates = intermediates(&mut snapshot, id).await?;
        let adopted_sources = adopted_sources(&mut snapshot, id).await?;
        let member_sessions = ids(&mut snapshot, MEMBER_SESSIONS, id).await?;
        let kept_sessions = kept_sessions(&mut snapshot, id, &member_sessions).await?;
        snapshot.rollback().await?;
        Ok(DoneArchiveBasis {
            project,
            locations,
            frames,
            uses,
            recorded_results,
            intermediates,
            adopted_sources,
            member_sessions: member_sessions.into_iter().collect(),
            kept_sessions,
        })
    }
}

fn corrupt(what: &str) -> LibraryError {
    LibraryError::PersistenceFailure(format!("corrupt record: {what}"))
}

/// The distinct non-null `id` column of a query on Project `project`.
async fn ids(
    conn: &mut SqliteConnection,
    sql: &'static str,
    project: Uuid,
) -> Result<BTreeSet<Uuid>> {
    let found: Vec<Option<String>> =
        sqlx::query_scalar(sql).bind(project.to_string()).fetch_all(&mut *conn).await?;
    found.iter().flatten().map(|id| parse_uuid(id)).collect()
}

fn optional_uuid(row: &SqliteRow, column: &str) -> Result<Option<Uuid>> {
    row.try_get::<Option<String>, _>(column)?.as_deref().map(parse_uuid).transpose()
}

/// Every registered location by registration time, then id.
async fn registered_locations(conn: &mut SqliteConnection) -> Result<Vec<RegisteredLocation>> {
    let rows =
        sqlx::query("SELECT id, role, created_at FROM locations").fetch_all(&mut *conn).await?;
    let mut located = rows
        .iter()
        .map(|row| {
            let created: String = row.try_get("created_at")?;
            let registered =
                instant(&created).ok_or_else(|| corrupt("location registration time"))?;
            let id = parse_uuid(&row.try_get::<String, _>("id")?)?;
            let role: LocationRole = from_text(&row.try_get::<String, _>("role")?)?;
            Ok((registered, id, role))
        })
        .collect::<Result<Vec<_>>>()?;
    located.sort_by_key(|(registered, id, _)| (*registered, *id));
    Ok(located
        .into_iter()
        .enumerate()
        .map(|(order, (_, id, role))| RegisteredLocation { id, role, order })
        .collect())
}

fn frame_copy(asset: &Asset) -> FrameCopy {
    FrameCopy {
        asset_id: asset.id,
        location_id: asset.location_id,
        relative_path: asset.relative_path.clone(),
        size_bytes: asset.fingerprint.size_bytes,
        sha256: asset.fingerprint.content_sha256.clone(),
        availability: asset.availability,
    }
}

const fn live(asset: &Asset) -> bool {
    !matches!(asset.availability, Availability::Trashed | Availability::Retired)
}

/// The Project's candidate, member and calibration frames as logical captures.
async fn project_frames(conn: &mut SqliteConnection, project: Uuid) -> Result<Vec<ProjectFrame>> {
    let candidates: BTreeSet<Uuid> = projects::candidates(conn, project)
        .await?
        .into_iter()
        .flat_map(|candidate| candidate.asset_ids)
        .collect();
    let mut seeds = candidates.clone();
    seeds.extend(ids(conn, MEMBER_COPIES, project).await?);
    seeds.extend(ids(conn, CALIBRATION_INPUTS, project).await?);
    let rejected: BTreeSet<Uuid> = projects::latest_rejections(conn, project)
        .await?
        .into_iter()
        .filter(|decision| decision.rejected)
        .map(|decision| decision.asset_id)
        .collect();
    let assets: Vec<Asset> = load_assets(conn, &seeds).await?.into_iter().filter(live).collect();
    let (key_of, copies) = logical_captures(conn, &assets).await?;
    let keys: BTreeSet<&String> = key_of.values().collect();
    let mut frames = Vec::with_capacity(keys.len());
    for key in keys {
        let group: Vec<&Asset> =
            copies.get(key).into_iter().flatten().filter(|asset| live(asset)).collect();
        if group.is_empty() {
            continue;
        }
        frames.push(ProjectFrame {
            key: parse_uuid(key)?,
            candidate: group.iter().any(|asset| candidates.contains(&asset.id)),
            quality: capture_quality(&group),
            project_rejected: group.iter().any(|asset| rejected.contains(&asset.id)),
            copies: group.iter().map(|asset| frame_copy(asset)).collect(),
        });
    }
    frames.sort_by_key(|frame| frame.key);
    Ok(frames)
}

async fn prepared_uses(
    conn: &mut SqliteConnection,
    copies: &BTreeSet<Uuid>,
) -> Result<Vec<PreparedUse>> {
    if copies.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(USES).bind(json_ids(copies)?).fetch_all(&mut *conn).await?;
    rows.iter()
        .map(|row| {
            let n: i64 = row.try_get("n")?;
            Ok(PreparedUse {
                revision_id: parse_uuid(&row.try_get::<String, _>("prep_id")?)?,
                preparation: u32::try_from(n).map_err(|_| corrupt("preparation number"))?,
                run: OfferRun {
                    view_id: parse_uuid(&row.try_get::<String, _>("view_id")?)?,
                    name: row.try_get::<Option<String>, _>("run_name")?.unwrap_or_default(),
                    project_id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
                    project_name: row.try_get("project_name")?,
                    stage: from_text(&row.try_get::<String, _>("stage")?)?,
                },
                completion: from_text(&row.try_get::<String, _>("completion")?)?,
                asset_id: optional_uuid(row, "asset_id")?,
                member_key: optional_uuid(row, "member_key")?,
                direct_source: row.try_get("direct")?,
            })
        })
        .collect()
}

/// The file name a refusal names a Result by, as [`ResultRecord::name`].
fn file_name(path: &NativePath) -> String {
    path.to_path_buf()
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
        .unwrap_or_else(|| path.display())
}

async fn recorded_results(
    conn: &mut SqliteConnection,
    revisions: &BTreeSet<Uuid>,
) -> Result<Vec<RecordedResult>> {
    if revisions.is_empty() {
        return Ok(Vec::new());
    }
    let rows =
        sqlx::query(RECORDED_RESULTS).bind(json_ids(revisions)?).fetch_all(&mut *conn).await?;
    rows.iter()
        .map(|row| {
            let path: NativePath = from_json(&row.try_get::<String, _>("path")?)?;
            let attribution: RevisionAttribution =
                from_json(&row.try_get::<String, _>("attribution")?)?;
            Ok(RecordedResult {
                result_id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                name: file_name(&path),
                revision_id: parse_uuid(&row.try_get::<String, _>("prepared_revision_id")?)?,
                inferred: matches!(attribution, RevisionAttribution::TimeWindow { .. }),
            })
        })
        .collect()
}

async fn intermediates(
    conn: &mut SqliteConnection,
    project: Uuid,
) -> Result<Vec<ResultsIntermediate>> {
    let rows = sqlx::query(INTERMEDIATES).bind(project.to_string()).fetch_all(&mut *conn).await?;
    rows.iter()
        .map(|row| {
            let owner = match (optional_uuid(row, "view_id")?, optional_uuid(row, "group_id")?) {
                (Some(view_id), None) => ResultOwner::Run { view_id },
                (None, Some(group_id)) => ResultOwner::Group { group_id },
                _ => return Err(corrupt("result owner")),
            };
            let fingerprint: ObservationFingerprint = from_json(
                &row.try_get::<Option<String>, _>("fingerprint")?
                    .ok_or_else(|| corrupt("intermediate fingerprint"))?,
            )?;
            Ok(ResultsIntermediate {
                result_id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                owner,
                path: from_json(&row.try_get::<String, _>("path")?)?,
                size_bytes: fingerprint.size_bytes,
            })
        })
        .collect()
}

async fn adopted_sources(conn: &mut SqliteConnection, project: Uuid) -> Result<Vec<AdoptedSource>> {
    let rows = sqlx::query(ADOPTED_SOURCES).bind(project.to_string()).fetch_all(&mut *conn).await?;
    let mut sources = Vec::with_capacity(rows.len());
    for row in &rows {
        let source =
            results::load_result(conn, parse_uuid(&row.try_get::<String, _>("result_id")?)?)
                .await?;
        let size_bytes = source
            .fingerprint
            .as_ref()
            .map(|fingerprint| fingerprint.size_bytes)
            .ok_or_else(|| corrupt("generated master fingerprint"))?;
        let kept_asset = match optional_uuid(row, "kept_asset_id")? {
            Some(id) => Some(load_asset(conn, id).await?),
            None => None,
        };
        let adopted_sha256: String = row.try_get("sha256")?;
        let kept = KeptLibraryCopy {
            master_id: parse_uuid(&row.try_get::<String, _>("master_id")?)?,
            asset_id: kept_asset
                .as_ref()
                .filter(|asset| {
                    asset.fingerprint.content_sha256.as_deref() == Some(adopted_sha256.as_str())
                })
                .map(|asset| asset.id),
            location_id: parse_uuid(&row.try_get::<String, _>("location_id")?)?,
            relative_path: path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?,
            sha256: adopted_sha256.clone(),
        };
        sources.push(AdoptedSource { source, size_bytes, adopted_sha256, kept, kept_asset });
    }
    Ok(sources)
}

async fn kept_sessions(
    conn: &mut SqliteConnection,
    project: Uuid,
    members: &BTreeSet<Uuid>,
) -> Result<Vec<KeptSession>> {
    if members.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query(KEEPING_PROJECTS)
        .bind(project.to_string())
        .bind(json_ids(members)?)
        .fetch_all(&mut *conn)
        .await?;
    let mut kept: BTreeMap<Uuid, Vec<ProjectName>> = BTreeMap::new();
    for row in &rows {
        kept.entry(parse_uuid(&row.try_get::<String, _>("session_id")?)?).or_default().push(
            ProjectName {
                id: parse_uuid(&row.try_get::<String, _>("project_id")?)?,
                name: row.try_get("name")?,
            },
        );
    }
    Ok(kept
        .into_iter()
        .map(|(session_id, projects)| KeptSession { session_id, projects })
        .collect())
}
