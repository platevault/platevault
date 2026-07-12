//! `inbox.target_recommendations` use case (spec 041 R-17 / FR-052, T074).
//!
//! Resolves a light sub-group's **target by sky-coordinate proximity**, never by
//! the free-text `OBJECT` header (R-17). Given an inbox item (or its source
//! group), it:
//!
//! 1. loads the sub-group's per-file pointing + optics from `inbox_file_metadata`
//!    (the T062 extended columns) and derives a single sub-group pointing,
//! 2. builds a **rectangular frame membership** from the sub-group's optics
//!    (focal length + pixel size + sensor dims, via `target_match::Field`),
//!    rotated by `ROTATANG`/`ROTATOR` (`rotator_angle_deg`) when present,
//!    falling back to an axis-aligned rectangle and then to a **configurable
//!    fixed circular radius** when optics are absent (R-17 C5),
//! 3. ranks every catalog entry (`canonical_target`, via the resolver cache) by
//!    great-circle separation, ascending, keeping only those on the frame (or,
//!    in the fixed-radius fallback, within the radius).
//!
//! The `OBJECT` header is returned only as `object_hint` for display — it is
//! never used for matching or search. Coordinate/geometry primitives come from
//! [`targeting::coords`] and `target_match`'s `Constraint`/`rank`; this module
//! is orchestration only (DB load + map).
//!
//! # Frame membership: rotated rectangle when a rotator angle is known
//!
//! Membership uses `target_match::Constraint::frame_rotated` — a rectangle
//! sized from the sub-group's optics and rotated by the mechanical rotator
//! angle — instead of the wider circumscribed-circle radius used previously,
//! so a target near the frame's corner but off-sensor (or off-sensor only
//! because of camera rotation) is correctly excluded. Falls back to an
//! axis-aligned `Constraint::frame` when `rotator_angle_deg` is absent/
//! non-finite, and to the fixed circular radius when optics are absent
//! entirely.
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

/// Identifies the light sub-group to resolve a target for: either a concrete
/// inbox item, or a source group whose (single light) item is resolved here.
#[derive(Clone, Debug)]
pub enum RecommendationTarget {
    /// A concrete single-type inbox item id.
    InboxItem(String),
    /// A source group id; its constituent item(s) are looked up (R-12).
    SourceGroup(String),
}

/// Recommend canonical targets for a light sub-group by coordinate proximity
/// (R-17). See the module docs for the algorithm.
///
/// `fixed_radius_deg` is the fallback radius used when a FOV-aware radius cannot
/// be derived from the sub-group's optics; pass [`DEFAULT_FIXED_RADIUS_DEG`] for
/// the baked-in default.
///
/// # Errors
///
/// - [`ErrorCode::InboxItemNotFound`] — the item / source group has no resolvable
///   inbox item.
/// - [`ErrorCode::InternalDatabase`] — a query failed.
pub async fn target_recommendations(
    pool: &SqlitePool,
    target: &RecommendationTarget,
    fixed_radius_deg: f64,
) -> Result<InboxTargetRecommendationsResponse, ContractError> {
    // 1. Resolve to a concrete inbox item id.
    let item_id = resolve_item_id(pool, target).await?;

    // 2. Load per-file pointing + optics for the sub-group.
    let rows = repo::list_inbox_pointing(pool, &item_id).await.map_err(db_err)?;

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

    // 4. Frame membership: a rectangle sized from the sub-group's optics —
    //    rotated by the rotator angle when known, else axis-aligned — else the
    //    configurable fixed circular fallback (R-17 C5).
    let constraint = coords::field_from_optics(
        pointing_row.focal_length_mm,
        pointing_row.pixel_size_um,
        pointing_row.naxis1,
        pointing_row.naxis2,
    )
    .map_or_else(
        || Constraint::circular(Angle::from_degrees(fixed_radius_deg)),
        |field| {
            pointing_row.rotator_angle_deg.filter(|v| v.is_finite()).map_or_else(
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

/// Resolve a [`RecommendationTarget`] to a concrete inbox item id.
///
/// For a source group, the first constituent item is used (a single-type light
/// source group has one light item; R-9/R-12).
async fn resolve_item_id(
    pool: &SqlitePool,
    target: &RecommendationTarget,
) -> Result<String, ContractError> {
    match target {
        RecommendationTarget::InboxItem(id) => {
            // Confirm it exists for a clean not-found rather than empty results.
            repo::get_inbox_item(pool, id)
                .await
                .map_err(|_| not_found(format!("InboxItem not found: {id}")))?;
            Ok(id.clone())
        }
        RecommendationTarget::SourceGroup(sg) => {
            let ids = repo::list_item_ids_for_source_group(pool, sg).await.map_err(db_err)?;
            ids.into_iter()
                .next()
                .ok_or_else(|| not_found(format!("no inbox items for source group: {sg}")))
        }
    }
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
            aliases: vec![ResolvedAlias::new(designation, AliasKind::Designation)],
            source: TargetSource::Seed,
        };
        cache::upsert_resolved(db.pool(), &identity).await.unwrap();
    }

    /// Create a light item with one file carrying pointing + optics + OBJECT.
    /// `naxis` sets both `naxis1`/`naxis2` (square sensor) and no rotator angle
    /// is set; see [`seed_light_item_full`] for asymmetric/rotated frames.
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
        seed_light_item_full(db, item_id, ra, dec, focal, pixel, naxis, naxis, None, object).await;
    }

    /// [`seed_light_item`], generalized to independent `naxis1`/`naxis2` (an
    /// elongated, non-square frame) and an optional rotator angle.
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
                 naxis1 = ?, naxis2 = ?, rotator_angle_deg = ?
             WHERE inbox_item_id = ? AND relative_file_path = ?",
        )
        .bind(ra)
        .bind(dec)
        .bind(focal)
        .bind(pixel)
        .bind(naxis1)
        .bind(naxis2)
        .bind(rotator_angle_deg)
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

        let resp = target_recommendations(
            db.pool(),
            &RecommendationTarget::InboxItem("item-1".to_owned()),
            DEFAULT_FIXED_RADIUS_DEG,
        )
        .await
        .unwrap();

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

    /// A target due East of the pointing sits inside an elongated (landscape)
    /// un-rotated frame but falls off a 90°-rotated frame (rotation swaps which
    /// axis is "wide") — proves `rotator_angle_deg` actually drives membership,
    /// not just an axis-aligned rectangle regardless of camera rotation.
    #[tokio::test]
    async fn rotator_angle_changes_frame_membership() {
        let db = test_db().await;
        let (ra0, dec0): (f64, f64) = (10.684_708, 41.268_75); // M31 pointing
                                                               // ~0.5° due East (same Dec), accounting for RA compression at this Dec.
        let east_ra = ra0 + 0.5 / dec0.to_radians().cos();
        seed_target(&db, "East Target", 1, east_ra, dec0).await;

        // Elongated landscape frame: naxis1=6248 (width ~1.68°), naxis2=1200
        // (height ~0.32°) at 800mm/3.76µm — half-width 0.84°, half-height 0.16°.
        // The 0.5° East target is inside the un-rotated rectangle (0.5 < 0.84,
        // ~0 North offset < 0.16) but outside once rotated 90° (axes swap: the
        // East offset now falls along the narrow 0.16°-half axis).
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
        )
        .await;
        let unrotated = target_recommendations(
            db.pool(),
            &RecommendationTarget::InboxItem("item-unrotated".to_owned()),
            DEFAULT_FIXED_RADIUS_DEG,
        )
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
            "item-rotated",
            Some(ra0),
            Some(dec0),
            Some(800.0),
            Some(3.76),
            Some(6248),
            Some(1200),
            Some(90.0),
            None,
        )
        .await;
        let rotated = target_recommendations(
            db.pool(),
            &RecommendationTarget::InboxItem("item-rotated".to_owned()),
            DEFAULT_FIXED_RADIUS_DEG,
        )
        .await
        .unwrap();
        assert!(
            rotated.candidates.is_empty(),
            "the same East target falls outside the 90°-rotated frame: {:?}",
            rotated.candidates
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
        let tight = target_recommendations(
            db.pool(),
            &RecommendationTarget::InboxItem("item-2".to_owned()),
            0.1,
        )
        .await
        .unwrap();
        assert_eq!(tight.candidates.len(), 1, "tight fixed radius keeps only M31");
        assert_eq!(tight.candidates[0].name, "M 31");

        let wide = target_recommendations(
            db.pool(),
            &RecommendationTarget::InboxItem("item-2".to_owned()),
            5.0,
        )
        .await
        .unwrap();
        assert_eq!(wide.candidates.len(), 2, "wide fixed radius keeps M31 + M110");
    }

    #[tokio::test]
    async fn no_pointing_yields_empty_candidates_with_hint() {
        let db = test_db().await;
        seed_target(&db, "M 31", 1, 10.684_708, 41.268_75).await;
        // Light item with OBJECT but no RA/Dec → needs-review (no coord match).
        seed_light_item(&db, "item-3", None, None, None, None, None, Some("M31")).await;

        let resp = target_recommendations(
            db.pool(),
            &RecommendationTarget::InboxItem("item-3".to_owned()),
            DEFAULT_FIXED_RADIUS_DEG,
        )
        .await
        .unwrap();
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

        let resp = target_recommendations(
            db.pool(),
            &RecommendationTarget::InboxItem("item-4".to_owned()),
            DEFAULT_FIXED_RADIUS_DEG,
        )
        .await
        .unwrap();
        // Coordinates win: nearest is M31, NOT the OBJECT-named M42.
        assert_eq!(resp.candidates.first().map(|c| c.name.as_str()), Some("M 31"));
        assert!(
            !resp.candidates.iter().any(|c| c.name == "M 42"),
            "M42 is far from the pointing and must not appear"
        );
        assert_eq!(resp.object_hint.as_deref(), Some("M42"), "OBJECT only a hint");
    }

    #[tokio::test]
    async fn resolves_via_source_group() {
        let db = test_db().await;
        seed_target(&db, "M 31", 1, 10.684_708, 41.268_75).await;

        // Create a source group and attach the light item to it.
        let sg_id = "sg-1";
        sqlx::query(
            "INSERT INTO inbox_source_groups
                (id, root_id, relative_path, discovered_at, last_scanned_at, child_count)
             VALUES (?, 'root-1', 'lights', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 1)",
        )
        .bind(sg_id)
        .execute(db.pool())
        .await
        .unwrap();

        seed_light_item(
            &db,
            "item-sg",
            Some(10.684_708),
            Some(41.268_75),
            Some(800.0),
            Some(3.76),
            Some(6248),
            None,
        )
        .await;
        sqlx::query("UPDATE inbox_items SET source_group_id = ? WHERE id = 'item-sg'")
            .bind(sg_id)
            .execute(db.pool())
            .await
            .unwrap();

        let resp = target_recommendations(
            db.pool(),
            &RecommendationTarget::SourceGroup(sg_id.to_owned()),
            DEFAULT_FIXED_RADIUS_DEG,
        )
        .await
        .unwrap();
        assert_eq!(resp.candidates.first().map(|c| c.name.as_str()), Some("M 31"));
    }

    #[tokio::test]
    async fn unknown_item_is_not_found() {
        let db = test_db().await;
        let err = target_recommendations(
            db.pool(),
            &RecommendationTarget::InboxItem("nope".to_owned()),
            DEFAULT_FIXED_RADIUS_DEG,
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::InboxItemNotFound);
    }

    #[tokio::test]
    async fn empty_source_group_is_not_found() {
        let db = test_db().await;
        sqlx::query(
            "INSERT INTO inbox_source_groups
                (id, root_id, relative_path, discovered_at, last_scanned_at, child_count)
             VALUES ('sg-empty', 'root-1', 'lights', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 0)",
        )
        .execute(db.pool())
        .await
        .unwrap();
        let err = target_recommendations(
            db.pool(),
            &RecommendationTarget::SourceGroup("sg-empty".to_owned()),
            DEFAULT_FIXED_RADIUS_DEG,
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::InboxItemNotFound);
    }
}
