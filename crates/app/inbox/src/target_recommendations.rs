// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `inbox.target_recommendations` use case (spec 041 R-17 / FR-052, T074).
//!
//! Resolves a light sub-group's **target by sky-coordinate proximity**, never by
//! the free-text `OBJECT` header (R-17). Given one inbox item, it:
//!
//! 1. loads the sub-group's per-file pointing + optics from `inbox_file_metadata`
//!    (the T062 extended columns) and derives a single sub-group pointing,
//! 2. builds a **rectangular frame membership** from the sub-group's optics
//!    (focal length + pixel size + sensor dims, via `target_match::Field`),
//!    rotated by the sky position angle when known, falling back to an
//!    axis-aligned rectangle and then to a **configurable fixed circular
//!    radius** when optics are absent (R-17 C5),
//! 3. ranks every catalog entry (`canonical_target`, via the resolver cache) by
//!    great-circle separation, ascending, keeping only those on the frame (or,
//!    in the fixed-radius fallback, within the radius).
//!
//! The `OBJECT` header is returned only as `object_hint` for display — it is
//! never used for matching or search. Coordinate/geometry primitives come from
//! [`targeting::coords`] and `target_match`'s `Constraint`/`rank`; this module
//! is orchestration only (DB load + map).
//!
//! # Frame rotation angle: sky PA (`OBJCTROT`), never the mechanical rotator
//!
//! `target_match::Constraint::frame_rotated` expects a **sky** position angle
//! (East of North) — the frame's orientation on the sky, not the camera's
//! mechanical orientation. `sky_rotation_deg` (`OBJCTROT`) is that sky PA;
//! `rotator_angle_deg` (`ROTATANG`/`ROTATOR`) is the mechanical rotator
//! angle — the flat↔light match key elsewhere in this codebase (R-18,
//! `grouping`), NOT a sky-frame angle, and NOT usable here. Precedence:
//! `sky_rotation_deg` → `rotator_angle_deg` → axis-aligned `Constraint::frame`
//! → fixed circular radius. The `rotator_angle_deg` middle rung is a
//! best-effort fallback (mechanical ≈ sky PA only when the optical train has
//! no field-derotation offset baked in) — better than the un-rotated
//! rectangle, but not as correct as the true sky PA.
//!
//! # A recommendation belongs to exactly one inbox item (spec 058, #1102)
//!
//! There is no source-group entry point. A folder splits into N independent
//! single-type siblings with no parent row, so "the item for this folder" does
//! not exist: resolving a source group to one representative sibling would
//! designate that sibling primary, which FR-006/D-002 forbid. Merging siblings
//! is worse — a light/dark/flat split genuinely wants different answers, and one
//! merged result hides that disagreement. Callers wanting per-sibling
//! recommendations call this once per `inbox_item_id`.
//!
//! This operation is **read-only**: it recommends, it does not write the chosen
//! target (that is reclassify, T068). Propagation to a linked project (T075)
//! happens downstream of this module, at live light ingestion: once a light's
//! resolved `canonical_target_id` lands on its `acquisition_session`, any
//! project linked to that session via `project_sources` is kept in sync — see
//! `app_core_targets::ingest_sessions::propagate_target_to_projects`.
#![allow(clippy::doc_markdown)] // RA/Dec, FOV, OBJECT are domain terms

use app_core_errors::db_err;
use persistence_db::repositories::inbox::{self as repo, InboxPointingRow};
use sqlx::SqlitePool;

use contracts_core::error_code::ErrorCode;
use contracts_core::inbox::{
    InboxPointing, InboxTargetCandidate, InboxTargetRecommendationsResponse,
};
use contracts_core::{ContractError, ErrorSeverity};
use target_match::{rank, Constraint, SkyObject};
use targeting::coords::{self, Pointing};
use targeting::{Angle, Equatorial};
use targeting_resolver::cache;

/// Default fixed search radius (degrees) used when a FOV-aware radius cannot be
/// derived (pixel size / optics / sensor dims unavailable), per R-17 C5.
///
/// Chosen to comfortably cover a wide-field frame (a few degrees) so a target is
/// still recommended when optics metadata is missing, without flooding the list
/// with the whole sky. The use-case accepts an override so callers/settings can
/// tune it later; this is the baked-in default.
pub const DEFAULT_FIXED_RADIUS_DEG: f64 = 5.0;

fn not_found(msg: String) -> ContractError {
    ContractError::new(ErrorCode::InboxItemNotFound, msg, ErrorSeverity::Blocking, false)
}

/// Recommend canonical targets for one light inbox item by coordinate proximity
/// (R-17). See the module docs for the algorithm, and for why this takes an item
/// id rather than a source group.
///
/// `fixed_radius_deg` is the fallback radius used when a FOV-aware radius cannot
/// be derived from the sub-group's optics; pass [`DEFAULT_FIXED_RADIUS_DEG`] for
/// the baked-in default.
///
/// # Errors
///
/// - [`ErrorCode::InboxItemNotFound`] — no such inbox item.
/// - [`ErrorCode::InternalDatabase`] — a query failed.
pub async fn target_recommendations(
    pool: &SqlitePool,
    inbox_item_id: &str,
    fixed_radius_deg: f64,
) -> Result<InboxTargetRecommendationsResponse, ContractError> {
    // 1. Confirm the item exists, for a clean not-found rather than empty results.
    repo::get_inbox_item(pool, inbox_item_id)
        .await
        .map_err(|_| not_found(format!("InboxItem not found: {inbox_item_id}")))?;

    // 2. Load per-file pointing + optics for this item.
    let rows = repo::list_inbox_pointing(pool, inbox_item_id).await.map_err(db_err)?;

    // Display hint only (R-17): first non-blank OBJECT, never used for matching.
    let object_hint = rows
        .iter()
        .find_map(|r| r.object.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .map(str::to_owned);

    // 3. Derive the sub-group pointing (first file carrying a finite RA/Dec). All
    //    files in a single-type light group share a pointing within tolerance, so
    //    any representative file is fine.
    let Some(pointing_row) = rows.iter().find(|r| has_pointing(r)) else {
        // No pointing → no coordinate match possible (R-17: needs-review path).
        return Ok(InboxTargetRecommendationsResponse {
            candidates: Vec::new(),
            pointing: None,
            object_hint,
        });
    };
    // Safe: has_pointing guarantees both are Some + finite.
    let ra = pointing_row.ra_deg.unwrap_or_default();
    let dec = pointing_row.dec_deg.unwrap_or_default();
    let pointing = coords::to_equatorial(Pointing::new(ra, dec));

    // 4. Frame membership: a rectangle sized from the sub-group's optics,
    //    rotated by the best available sky PA — sky_rotation_deg (OBJCTROT,
    //    the true sky PA) preferred over rotator_angle_deg (ROTATANG, a
    //    mechanical-angle approximation) — else axis-aligned, else the
    //    configurable fixed circular fallback (R-17 C5). See the module docs.
    let sky_pa_deg = pointing_row
        .sky_rotation_deg
        .filter(|v| v.is_finite())
        .or_else(|| pointing_row.rotator_angle_deg.filter(|v| v.is_finite()));
    let constraint = coords::field_from_optics(
        pointing_row.focal_length_mm,
        pointing_row.pixel_size_um,
        pointing_row.naxis1,
        pointing_row.naxis2,
    )
    .map_or_else(
        || Constraint::circular(Angle::from_degrees(fixed_radius_deg)),
        |field| {
            sky_pa_deg.map_or_else(
                || Constraint::frame(&field),
                |pa_deg| Constraint::frame_rotated(&field, Angle::from_degrees(pa_deg)),
            )
        },
    );

    // 5. Load the catalog and rank by frame membership (coordinate-only).
    let catalog = cache::list_all(pool).await.map_err(|e| cache_err(&e))?;
    let objects: Vec<CatalogObject> = catalog
        .into_iter()
        // A non-finite catalog coordinate can't build an Equatorial; exclude it
        // (mirrors the previous NaN-never-compares-within-radius behaviour).
        .filter(|t| t.ra_deg.is_finite() && t.dec_deg.is_finite())
        .map(|t| CatalogObject {
            target_id: t.id.to_string(),
            // Effective label: user display_alias wins, else primary designation.
            name: t.display_alias.unwrap_or(t.primary_designation),
            position: coords::to_equatorial(Pointing::new(t.ra_deg, t.dec_deg)),
        })
        .collect();

    let candidates = rank(pointing, &objects, constraint)
        .into_iter()
        .map(|m| InboxTargetCandidate {
            target_id: m.object.target_id.clone(),
            name: m.object.name.clone(),
            separation_deg: m.separation.degrees(),
        })
        .collect();

    Ok(InboxTargetRecommendationsResponse {
        candidates,
        pointing: Some(InboxPointing { ra_deg: ra, dec_deg: dec }),
        object_hint,
    })
}

/// A catalog entry adapted to `target_match::SkyObject` for frame ranking.
/// Matching is coordinate-only (R-17): `name` rides along for display and is
/// never read by [`rank`]/[`Constraint`] membership.
struct CatalogObject {
    target_id: String,
    name: String,
    position: Equatorial,
}

impl SkyObject for CatalogObject {
    fn position(&self) -> Equatorial {
        self.position
    }
}

/// A pointing row is usable when both RA and Dec are present and finite.
fn has_pointing(r: &InboxPointingRow) -> bool {
    matches!((r.ra_deg, r.dec_deg), (Some(ra), Some(dec)) if ra.is_finite() && dec.is_finite())
}

/// Map a resolver-cache error onto a contract error.
fn cache_err(e: &cache::CacheError) -> ContractError {
    ContractError::new(ErrorCode::InternalDatabase, e.to_string(), ErrorSeverity::Fatal, true)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::repositories::inbox::{InsertInboxItem, UpsertFileMetadata};
    use persistence_db::Database;
    use targeting_resolver::{
        AliasKind, ObjectType, ResolvedAlias, ResolvedIdentity, TargetSource,
    };

    async fn test_db() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    /// Seed a canonical target into the resolution cache.
    async fn seed_target(db: &Database, designation: &str, oid: i64, ra: f64, dec: f64) {
        let identity = ResolvedIdentity {
            simbad_oid: Some(oid),
            primary_designation: designation.to_owned(),
            common_name: None,
            object_type: ObjectType::Galaxy,
            ra_deg: ra,
            dec_deg: dec,
            v_mag: None,
            aliases: vec![ResolvedAlias::new(designation, AliasKind::Designation)],
            source: TargetSource::Seed,
        };
        cache::upsert_resolved(db.pool(), &identity).await.unwrap();
    }

    /// Create a light item with one file carrying pointing + optics + OBJECT.
    /// `naxis` sets both `naxis1`/`naxis2` (square sensor) and no rotation
    /// angle is set; see [`seed_light_item_full`] for asymmetric/rotated frames.
    #[allow(clippy::too_many_arguments)]
    async fn seed_light_item(
        db: &Database,
        item_id: &str,
        ra: Option<f64>,
        dec: Option<f64>,
        focal: Option<f64>,
        pixel: Option<f64>,
        naxis: Option<i64>,
        object: Option<&str>,
    ) {
        seed_light_item_full(db, item_id, ra, dec, focal, pixel, naxis, naxis, None, None, object)
            .await;
    }

    /// [`seed_light_item`], generalized to independent `naxis1`/`naxis2` (an
    /// elongated, non-square frame) and the two rotation fields
    /// (`rotator_angle_deg` = mechanical `ROTATANG`, `sky_rotation_deg` = the
    /// true sky PA `OBJCTROT` — see the module docs on why they differ).
    #[allow(clippy::too_many_arguments)]
    async fn seed_light_item_full(
        db: &Database,
        item_id: &str,
        ra: Option<f64>,
        dec: Option<f64>,
        focal: Option<f64>,
        pixel: Option<f64>,
        naxis1: Option<i64>,
        naxis2: Option<i64>,
        rotator_angle_deg: Option<f64>,
        sky_rotation_deg: Option<f64>,
        object: Option<&str>,
    ) {
        // Distinct per item_id: `inbox_items` is UNIQUE(root_id, relative_path),
        // and a caller may seed several items in one db (e.g. an un-rotated vs
        // rotated pair to compare frame membership).
        let relative_path = format!("lights-{item_id}");
        let relative_file_path = format!("{relative_path}/light_001.fits");
        repo::insert_inbox_item(
            db.pool(),
            &InsertInboxItem {
                id: item_id,
                root_id: "root-1",
                relative_path: &relative_path,
                file_count: 1,
                content_signature: Some("sig"),
                lane: "fits",
            },
        )
        .await
        .unwrap();
        repo::upsert_inbox_file_metadata(
            db.pool(),
            &UpsertFileMetadata {
                inbox_item_id: item_id,
                relative_file_path: &relative_file_path,
                object,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        // Patch the T062 pointing/optics columns directly (the typed upsert
        // helper predates these columns; we set them via UPDATE).
        sqlx::query(
            "UPDATE inbox_file_metadata
             SET ra_deg = ?, dec_deg = ?, focal_length_mm = ?, pixel_size_um = ?,
                 naxis1 = ?, naxis2 = ?, rotator_angle_deg = ?, sky_rotation_deg = ?
             WHERE inbox_item_id = ? AND relative_file_path = ?",
        )
        .bind(ra)
        .bind(dec)
        .bind(focal)
        .bind(pixel)
        .bind(naxis1)
        .bind(naxis2)
        .bind(rotator_angle_deg)
        .bind(sky_rotation_deg)
        .bind(item_id)
        .bind(&relative_file_path)
        .execute(db.pool())
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn ranks_nearest_target_first_within_fov_radius() {
        let db = test_db().await;
        // M31 at (10.6847, 41.2688); M110 ~0.62° away; M33 ~14.7° away.
        seed_target(&db, "M 31", 1, 10.684_708, 41.268_75).await;
        seed_target(&db, "M 110", 2, 10.092_08, 41.685_28).await;
        seed_target(&db, "M 33", 3, 23.462_1, 30.659_9).await;

        // Pointing at M31 with full optics → ~1° FOV radius keeps M31 + M110.
        seed_light_item(
            &db,
            "item-1",
            Some(10.684_708),
            Some(41.268_75),
            Some(800.0),
            Some(3.76),
            Some(6248),
            Some("Andromeda"),
        )
        .await;

        let resp =
            target_recommendations(db.pool(), "item-1", DEFAULT_FIXED_RADIUS_DEG).await.unwrap();

        assert_eq!(
            resp.candidates.len(),
            2,
            "M31 + M110 within FOV, not M33: {:?}",
            resp.candidates
        );
        assert_eq!(resp.candidates[0].name, "M 31");
        assert!(resp.candidates[0].separation_deg < 1e-6);
        assert_eq!(resp.candidates[1].name, "M 110");
        // Pointing echoed back; OBJECT carried as hint only.
        let p = resp.pointing.unwrap();
        assert!((p.ra_deg - 10.684_708).abs() < 1e-9);
        assert_eq!(resp.object_hint.as_deref(), Some("Andromeda"));
    }

    /// M31 pointing + a target ~0.5° due East (same Dec, RA-compression
    /// corrected) + an elongated landscape frame (naxis1=6248 ~1.68° wide,
    /// naxis2=1200 ~0.32° tall at 800mm/3.76µm — half-width 0.84°, half-height
    /// 0.16°). The East target sits inside the un-rotated rectangle (0.5 <
    /// 0.84 width, ~0 < 0.16 height) but outside once the frame is rotated
    /// 90° (axes swap: the East offset now falls along the narrow axis).
    fn east_target_and_landscape_field() -> (f64, f64, f64) {
        let (ra0, dec0): (f64, f64) = (10.684_708, 41.268_75);
        let east_ra = ra0 + 0.5 / dec0.to_radians().cos();
        (ra0, dec0, east_ra)
    }

    /// `sky_rotation_deg` (`OBJCTROT`) alone drives rotated frame membership.
    #[tokio::test]
    async fn sky_rotation_deg_changes_frame_membership() {
        let db = test_db().await;
        let (ra0, dec0, east_ra) = east_target_and_landscape_field();
        seed_target(&db, "East Target", 1, east_ra, dec0).await;

        seed_light_item_full(
            &db,
            "item-unrotated",
            Some(ra0),
            Some(dec0),
            Some(800.0),
            Some(3.76),
            Some(6248),
            Some(1200),
            None,
            None,
            None,
        )
        .await;
        let unrotated =
            target_recommendations(db.pool(), "item-unrotated", DEFAULT_FIXED_RADIUS_DEG)
                .await
                .unwrap();
        assert_eq!(
            unrotated.candidates.len(),
            1,
            "East target is inside the un-rotated landscape frame: {:?}",
            unrotated.candidates
        );

        seed_light_item_full(
            &db,
            "item-sky-rotated",
            Some(ra0),
            Some(dec0),
            Some(800.0),
            Some(3.76),
            Some(6248),
            Some(1200),
            None,       // no mechanical rotator angle
            Some(90.0), // sky_rotation_deg (OBJCTROT) alone
            None,
        )
        .await;
        let rotated =
            target_recommendations(db.pool(), "item-sky-rotated", DEFAULT_FIXED_RADIUS_DEG)
                .await
                .unwrap();
        assert!(
            rotated.candidates.is_empty(),
            "the same East target falls outside the sky_rotation_deg=90° frame: {:?}",
            rotated.candidates
        );
    }

    /// When both rotation fields are present, `sky_rotation_deg` (the true sky
    /// PA) wins over `rotator_angle_deg` (mechanical) — a deliberately
    /// misleading `rotator_angle_deg=0` (which would keep the frame
    /// un-rotated if it were used) must NOT override the real 90° sky PA.
    #[tokio::test]
    async fn sky_rotation_deg_takes_precedence_over_rotator_angle_deg() {
        let db = test_db().await;
        let (ra0, dec0, east_ra) = east_target_and_landscape_field();
        seed_target(&db, "East Target", 1, east_ra, dec0).await;

        seed_light_item_full(
            &db,
            "item-conflict",
            Some(ra0),
            Some(dec0),
            Some(800.0),
            Some(3.76),
            Some(6248),
            Some(1200),
            Some(0.0),  // misleading mechanical angle — must be ignored
            Some(90.0), // true sky PA — must govern
            None,
        )
        .await;
        let resp = target_recommendations(db.pool(), "item-conflict", DEFAULT_FIXED_RADIUS_DEG)
            .await
            .unwrap();
        assert!(
            resp.candidates.is_empty(),
            "sky_rotation_deg=90 must govern over the misleading rotator_angle_deg=0: {:?}",
            resp.candidates
        );
    }

    /// `rotator_angle_deg` is used as a fallback when `sky_rotation_deg` is
    /// absent — better than an un-rotated rectangle, per the module docs.
    #[tokio::test]
    async fn rotator_angle_deg_used_as_fallback_when_sky_rotation_absent() {
        let db = test_db().await;
        let (ra0, dec0, east_ra) = east_target_and_landscape_field();
        seed_target(&db, "East Target", 1, east_ra, dec0).await;

        seed_light_item_full(
            &db,
            "item-fallback",
            Some(ra0),
            Some(dec0),
            Some(800.0),
            Some(3.76),
            Some(6248),
            Some(1200),
            Some(90.0), // mechanical angle, no sky PA available
            None,
            None,
        )
        .await;
        let resp = target_recommendations(db.pool(), "item-fallback", DEFAULT_FIXED_RADIUS_DEG)
            .await
            .unwrap();
        assert!(
            resp.candidates.is_empty(),
            "rotator_angle_deg=90 fallback still excludes the East target: {:?}",
            resp.candidates
        );
    }

    #[tokio::test]
    async fn fixed_radius_fallback_when_pixel_size_absent() {
        let db = test_db().await;
        seed_target(&db, "M 31", 1, 10.684_708, 41.268_75).await;
        seed_target(&db, "M 110", 2, 10.092_08, 41.685_28).await;

        // No pixel size / optics → FOV radius unavailable → fixed fallback used.
        seed_light_item(&db, "item-2", Some(10.684_708), Some(41.268_75), None, None, None, None)
            .await;

        // A tight fixed radius (0.1°) keeps only the exact match; a wide one (5°)
        // keeps both — proving the fixed fallback governs membership.
        let tight = target_recommendations(db.pool(), "item-2", 0.1).await.unwrap();
        assert_eq!(tight.candidates.len(), 1, "tight fixed radius keeps only M31");
        assert_eq!(tight.candidates[0].name, "M 31");

        let wide = target_recommendations(db.pool(), "item-2", 5.0).await.unwrap();
        assert_eq!(wide.candidates.len(), 2, "wide fixed radius keeps M31 + M110");
    }

    #[tokio::test]
    async fn no_pointing_yields_empty_candidates_with_hint() {
        let db = test_db().await;
        seed_target(&db, "M 31", 1, 10.684_708, 41.268_75).await;
        // Light item with OBJECT but no RA/Dec → needs-review (no coord match).
        seed_light_item(&db, "item-3", None, None, None, None, None, Some("M31")).await;

        let resp =
            target_recommendations(db.pool(), "item-3", DEFAULT_FIXED_RADIUS_DEG).await.unwrap();
        assert!(resp.candidates.is_empty(), "no pointing ⇒ no candidates");
        assert!(resp.pointing.is_none(), "pointing is None when RA/Dec absent");
        // OBJECT is still surfaced as a display hint — but it did not match.
        assert_eq!(resp.object_hint.as_deref(), Some("M31"));
    }

    /// OBJECT is never a search key: a mislabelled file whose OBJECT names a
    /// distant target still resolves to the coordinate-nearest catalog entry.
    #[tokio::test]
    async fn object_header_never_drives_matching() {
        let db = test_db().await;
        seed_target(&db, "M 31", 1, 10.684_708, 41.268_75).await;
        seed_target(&db, "M 42", 2, 83.822_08, -5.391_11).await;

        // Pointing is at M31 but OBJECT wrongly says "M42".
        seed_light_item(
            &db,
            "item-4",
            Some(10.684_708),
            Some(41.268_75),
            Some(800.0),
            Some(3.76),
            Some(6248),
            Some("M42"),
        )
        .await;

        let resp =
            target_recommendations(db.pool(), "item-4", DEFAULT_FIXED_RADIUS_DEG).await.unwrap();
        // Coordinates win: nearest is M31, NOT the OBJECT-named M42.
        assert_eq!(resp.candidates.first().map(|c| c.name.as_str()), Some("M 31"));
        assert!(
            !resp.candidates.iter().any(|c| c.name == "M 42"),
            "M42 is far from the pointing and must not appear"
        );
        assert_eq!(resp.object_hint.as_deref(), Some("M42"), "OBJECT only a hint");
    }

    /// Spec 058 / #1102 (FR-006/D-002): a source group with N>1 siblings yields
    /// one recommendation **per sibling**, computed from that sibling's own
    /// pointing — no sibling is designated primary for the others.
    ///
    /// This guards the per-item invariant, not the removed source-group entry
    /// point. That regression is now a compile error instead: the
    /// `RecommendationTarget::SourceGroup` arm which collapsed a group to
    /// `ids.next()` was deleted, not fixed. Resolution by item id was unchanged
    /// by that deletion, so this test would also pass on the pre-change code.
    #[tokio::test]
    async fn siblings_of_one_source_group_each_get_their_own_recommendation() {
        let db = test_db().await;
        seed_target(&db, "M 31", 1, 10.684_708, 41.268_75).await;
        seed_target(&db, "M 42", 2, 83.822_08, -5.391_11).await;

        let sg_id = "sg-1";
        sqlx::query(
            "INSERT INTO inbox_source_groups
                (id, root_id, relative_path, discovered_at, last_scanned_at, child_count)
             VALUES (?, 'root-1', 'lights', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 2)",
        )
        .bind(sg_id)
        .execute(db.pool())
        .await
        .unwrap();

        // Two siblings of ONE folder, pointed at different targets.
        for (item_id, ra, dec) in
            [("item-sg-a", 10.684_708, 41.268_75), ("item-sg-b", 83.822_08, -5.391_11)]
        {
            seed_light_item(
                &db,
                item_id,
                Some(ra),
                Some(dec),
                Some(800.0),
                Some(3.76),
                Some(6248),
                None,
            )
            .await;
            sqlx::query("UPDATE inbox_items SET source_group_id = ? WHERE id = ?")
                .bind(sg_id)
                .bind(item_id)
                .execute(db.pool())
                .await
                .unwrap();
        }

        let a =
            target_recommendations(db.pool(), "item-sg-a", DEFAULT_FIXED_RADIUS_DEG).await.unwrap();
        let b =
            target_recommendations(db.pool(), "item-sg-b", DEFAULT_FIXED_RADIUS_DEG).await.unwrap();

        assert_eq!(
            a.candidates.first().map(|c| c.name.as_str()),
            Some("M 31"),
            "sibling A must be answered from ITS OWN pointing: {:?}",
            a.candidates
        );
        assert_eq!(
            b.candidates.first().map(|c| c.name.as_str()),
            Some("M 42"),
            "sibling B must be answered from ITS OWN pointing, not sibling A's: {:?}",
            b.candidates
        );
    }

    #[tokio::test]
    async fn unknown_item_is_not_found() {
        let db = test_db().await;
        let err =
            target_recommendations(db.pool(), "nope", DEFAULT_FIXED_RADIUS_DEG).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::InboxItemNotFound);
    }
}
