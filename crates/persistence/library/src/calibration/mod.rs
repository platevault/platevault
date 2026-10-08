// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs (spec 068): Tier 1 calibration rows in the clean catalog.
//!
//! Raw sets, detected candidates, evaluations, requirement states and the
//! handoff are recomputed on read from one reader snapshot and never stored;
//! reads hash nothing. The product rules arrive as a [`CalibrationRules`]
//! implementation, the way the grouping callback does, so the semantics stay
//! pure and outside storage.

mod adoption;
mod contained_write;
mod custody;
mod decisions;
mod inventory;

use std::collections::BTreeSet;

use platevault_model::{
    AdoptedMaster, ApplicableQuality, AssociationKind, AssociationState, Availability,
    CalibrationPlan, CalibrationPolicy, CalibrationRules, CalibrationViewBasis, CandidateRef,
    CaptureEvidence, CaptureKey, EvidenceField, ExpectedSession, InputForm, InputKind, InputState,
    LibraryError, LightBasis, LightEvidence, MasterEvidence, MasterOrigin, MasterProvenance,
    NativePath, ObservationFingerprint, Requirement,
};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    check_expected_sessions, from_json, from_text, load_assets, load_associations,
    load_session_row, parse_uuid, path_from_key, revision, Catalog, Result, MAX_PAGE,
};

pub use adoption::recover_adoptions;
pub use decisions::group_policy_changed;
use inventory::Listed;

// ---------------------------------------------------------------------------
// Wire types of the inventory reads
// ---------------------------------------------------------------------------

/// Filters of the inventory listing; a zero limit reads one full page.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputQuery {
    #[serde(default)]
    pub kind: Option<InputKind>,
    #[serde(default)]
    pub form: Option<InputForm>,
    #[serde(default)]
    pub location_id: Option<Uuid>,
    #[serde(default)]
    pub offset: u32,
    #[serde(default)]
    pub limit: u32,
}

/// The listing groups: kind, camera, gain/offset, channel (flats) and
/// dimensions/binning. `None` is the unknown value, never a default.
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputGroup {
    pub kind: InputKind,
    pub camera: Option<String>,
    pub gain: Option<String>,
    pub offset: Option<String>,
    pub channel: Option<String>,
    pub dimensions: Option<String>,
    pub binning: Option<String>,
}

/// One recorded copy of an input member.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputCopy {
    pub asset_id: Uuid,
    pub location_id: Uuid,
    pub relative_path: NativePath,
    pub availability: Availability,
    pub fingerprint: ObservationFingerprint,
}

/// One logical capture (D16) of an input with every recorded copy.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMember {
    pub member_key: Uuid,
    pub quality: ApplicableQuality,
    pub copies: Vec<InputCopy>,
}

/// One listed input: a raw set, an adopted master or a detected candidate.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationInputSummary {
    pub input: CandidateRef,
    pub kind: InputKind,
    pub form: InputForm,
    pub group: InputGroup,
    pub evidence: CaptureEvidence,
    /// Evidence the kind's criteria need that this input does not record.
    pub missing: Vec<EvidenceField>,
    pub state: InputState,
    /// The master determination and its basis; `None` for a raw set.
    pub master: Option<MasterEvidence>,
    pub origin: Option<MasterOrigin>,
    /// An adopted master's provenance.
    pub provenance: Option<MasterProvenance>,
    /// Raw sets and adopted masters; a detected candidate never is.
    pub reusable: bool,
    pub location_ids: Vec<Uuid>,
    /// Every copy of the included members.
    pub member_assets: Vec<Uuid>,
}

/// One input with its members and its Library-Unusable members.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationInputDetail {
    #[serde(flatten)]
    pub summary: CalibrationInputSummary,
    pub members: Vec<InputMember>,
    pub excluded: Vec<InputMember>,
}

// ---------------------------------------------------------------------------
// Inventory and matching reads
// ---------------------------------------------------------------------------

impl Catalog {
    /// Raw sets, adopted masters and detected candidates from indexed Active
    /// locations, in group order. Retired copies are omitted; offline members
    /// are counted with their last-observed state. Hashes and writes nothing.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn calibration_inputs<R: CalibrationRules + ?Sized>(
        &self,
        query: &InputQuery,
        rules: &R,
    ) -> Result<Vec<CalibrationInputSummary>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let listed = inventory::list_inputs(&mut snapshot, rules).await?;
        snapshot.rollback().await?;
        let limit = if query.limit == 0 { MAX_PAGE } else { query.limit.min(MAX_PAGE) };
        Ok(listed
            .into_iter()
            .map(|listed| listed.summary)
            .filter(|row| query.kind.is_none_or(|kind| row.kind == kind))
            .filter(|row| query.form.is_none_or(|form| row.form == form))
            .filter(|row| query.location_id.is_none_or(|id| row.location_ids.contains(&id)))
            .skip(query.offset as usize)
            .take(limit as usize)
            .collect())
    }

    /// One listed input with its members, excluded members and provenance.
    ///
    /// # Errors
    /// `NotFound` for an input that is not listed at that revision.
    pub async fn calibration_input<R: CalibrationRules + ?Sized>(
        &self,
        input: &CandidateRef,
        rules: &R,
    ) -> Result<CalibrationInputDetail> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let listed = inventory::list_inputs(&mut snapshot, rules).await?;
        snapshot.rollback().await?;
        let listed = listed
            .into_iter()
            .find(|listed| listed.summary.input == *input)
            .ok_or_else(|| LibraryError::NotFound(format!("calibration input {input:?}")))?;
        Ok(CalibrationInputDetail {
            summary: listed.summary,
            members: listed.members,
            excluded: listed.excluded,
        })
    }

    /// Per light group and kind of these current Sessions, every listed
    /// candidate with its criteria and the single top input. Takes no run,
    /// assigns nothing and writes nothing.
    ///
    /// # Errors
    /// `Conflict` (with successors) for a stale or superseded Session;
    /// `InvalidInput` for repeated sessions or kinds.
    pub async fn calibration_match<R: CalibrationRules + ?Sized>(
        &self,
        sessions: &[ExpectedSession],
        kinds: &[InputKind],
        rules: &R,
    ) -> Result<Vec<Requirement>> {
        let kinds = platevault_model::required_kinds(kinds)?;
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let mut lights = Vec::new();
        for session in check_expected_sessions(&mut snapshot, sessions).await? {
            let members: BTreeSet<Uuid> = session.asset_ids.iter().copied().collect();
            lights.extend(light_basis(&mut snapshot, session.id, &members).await?);
        }
        let listed = inventory::list_inputs(&mut snapshot, rules).await?;
        snapshot.rollback().await?;
        let basis = CalibrationViewBasis {
            view_id: Uuid::nil(),
            view_revision: 0,
            plan: CalibrationPlan {
                required_kinds: kinds,
                policy: CalibrationPolicy::Manual,
                ..CalibrationPlan::unplanned(Uuid::nil())
            },
            lights,
            candidates: listed.iter().map(Listed::candidate).collect(),
            decisions: Vec::new(),
        };
        Ok(rules.plan(&basis).requirements)
    }
}

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

/// The light side of one Session from the given member copies: `None` when the
/// Session's own type is known and not a light.
pub async fn light_basis(
    conn: &mut SqliteConnection,
    session_id: Uuid,
    assets: &BTreeSet<Uuid>,
) -> Result<Option<LightBasis>> {
    let row = load_session_row(conn, session_id).await?;
    let loaded = load_assets(conn, assets).await?;
    let Some(asset) = loaded
        .iter()
        .find(|asset| asset.availability != Availability::Retired)
        .or_else(|| loaded.first())
    else {
        return Ok(None);
    };
    let light_type_known = match asset.effective.is_light() {
        Some(true) => true,
        Some(false) => return Ok(None),
        None => false,
    };
    let capture = CaptureEvidence::from_metadata(
        &asset.effective,
        &corrected_fields(conn, asset.id).await?,
        night_of(&row.session.key).as_deref(),
        confirmed_equipment(conn, session_id).await?,
    );
    Ok(Some(LightBasis {
        evidence: LightEvidence {
            session_id,
            grouping_revision: row.session.grouping_revision,
            capture,
        },
        included_assets: assets.clone(),
        light_type_known,
        product: false,
    }))
}

/// The `night` value of a `capture-v1` Session key, e.g. `2026-09-18@date-loc-noon`.
pub fn night_of(key: &CaptureKey) -> Option<String> {
    key.0
        .split('|')
        .find_map(|field| field.strip_prefix("night="))
        .map(|night| night.replace("%7C", "|").replace("%25", "%"))
}

/// The capture fields a reviewed correction set on this asset.
pub async fn corrected_fields(
    conn: &mut SqliteConnection,
    asset_id: Uuid,
) -> Result<BTreeSet<String>> {
    let fields: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT field FROM corrections WHERE asset_id = ?1")
            .bind(asset_id.to_string())
            .fetch_all(&mut *conn)
            .await?;
    Ok(fields.into_iter().collect())
}

/// The Session's Confirmed Equipment; suggested associations never count (R8).
pub async fn confirmed_equipment(
    conn: &mut SqliteConnection,
    session_id: Uuid,
) -> Result<Option<Uuid>> {
    Ok(load_associations(conn, session_id).await?.into_iter().find_map(|association| {
        (association.kind == AssociationKind::Equipment
            && association.state == AssociationState::Confirmed)
            .then_some(association.subject_id)
            .flatten()
    }))
}

/// Adopted masters with the indexed destination asset a scan recorded at the
/// master's location and path with the same digest.
macro_rules! master_sql {
    () => {
        "SELECT m.*, (SELECT a.id FROM assets a WHERE a.location_id = m.location_id \
         AND a.path_key = m.path_key AND a.content_sha256 = m.content_sha256) AS asset_id \
         FROM adopted_masters m"
    };
}

/// Every adopted master, with its indexed destination asset when a scan
/// recorded the copy at its location and path with the same digest.
pub async fn load_masters(conn: &mut SqliteConnection) -> Result<Vec<AdoptedMaster>> {
    let rows = sqlx::query(concat!(master_sql!(), " ORDER BY m.id")).fetch_all(&mut *conn).await?;
    rows.iter().map(master_from_row).collect()
}

/// One adopted master by id.
pub async fn load_master(conn: &mut SqliteConnection, id: Uuid) -> Result<AdoptedMaster> {
    let row = sqlx::query(concat!(master_sql!(), " WHERE m.id = ?1"))
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("adopted master {id}")))?;
    master_from_row(&row)
}

pub fn master_from_row(row: &SqliteRow) -> Result<AdoptedMaster> {
    Ok(AdoptedMaster {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        revision: revision(row.try_get("revision")?)?,
        kind: from_text(&row.try_get::<String, _>("kind")?)?,
        location_id: parse_uuid(&row.try_get::<String, _>("location_id")?)?,
        relative_path: path_from_key(&row.try_get::<Vec<u8>, _>("path_key")?)?,
        fingerprint: from_json(&row.try_get::<String, _>("fingerprint")?)?,
        classification: from_json(&row.try_get::<String, _>("classification")?)?,
        observed: from_json(&row.try_get::<String, _>("observed")?)?,
        provenance: from_json(&row.try_get::<String, _>("provenance")?)?,
        asset_id: row
            .try_get::<Option<String>, _>("asset_id")?
            .as_deref()
            .map(parse_uuid)
            .transpose()?,
    })
}
