// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The once-only Add to calibration library offer (spec 068 CAL-FR-06,
//! CAL-AC-12, D-W55) of a generated master Results discovery found in a run's
//! Results folder, keyed by file and digest. Discovery records it Offered the
//! first time it reads those bytes; Dismiss declines that file and digest, so
//! the offer never returns, and changed content is a new offer. A dismissed
//! master stays listed as a candidate in Calibration and is still adopted
//! through the D05 adoption flow, which marks its offer Adopted.

use platevault_model::{
    LibraryError, Location, LocationLifecycle, MasterOffer, MasterOfferState, MasterOrigin,
    NativePath, ObservationFingerprint, ResultKind, ResultState,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use crate::results::{load_result, DetectedMaster};
use crate::views::{load_view, require_live};
use crate::{
    from_json, from_text, location_from_row, now, parse_uuid, to_json, to_text, Catalog, Result,
};

/// An offer's columns with its run's name, then `$tail`.
macro_rules! offer_sql {
    ($tail:literal) => {
        concat!(
            "SELECT o.id, o.result_id, o.view_id, o.path, o.sha256, o.classification, ",
            "o.observed, o.state, o.offered_at, o.decided_at, ",
            "coalesce(c.name, d.name) AS view_name FROM master_offers o ",
            "JOIN result_candidates r ON r.id = o.result_id ",
            "JOIN views v ON v.id = o.view_id ",
            "LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision ",
            "LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' ",
            $tail
        )
    };
}

/// The master a Result adoption reviews: its offer at the Result's current
/// digest, the inspected fingerprint and the registered location holding it
/// with the path below that root.
pub struct OfferedSource {
    pub offer: MasterOffer,
    pub fingerprint: ObservationFingerprint,
    pub location: Location,
    pub relative_path: NativePath,
}

impl Catalog {
    /// Dismiss an open offer (CAL-AC-12): it is not offered again for this
    /// file and digest, and the master stays listed in Calibration.
    ///
    /// # Errors
    /// `InvalidInput` for an offer already dismissed or adopted; `NotFound`
    /// for an unknown offer.
    pub async fn dismiss_master_offer(&self, id: Uuid) -> Result<MasterOffer> {
        let at = now()?;
        write_txn!(self, |conn| {
            let offer = load_offer(conn, id).await?;
            if offer.state != MasterOfferState::Offered {
                return Err(LibraryError::InvalidInput(format!(
                    "the offer of {} is already {}",
                    offer.path.display(),
                    to_text(&offer.state)?
                )));
            }
            sqlx::query(
                "UPDATE master_offers SET state = 'dismissed', decided_at = ?2 WHERE id = ?1",
            )
            .bind(id.to_string())
            .bind(&at)
            .execute(&mut *conn)
            .await?;
            load_offer(conn, id).await
        })
    }

    /// Generated masters found in Results and not adopted, offered or
    /// dismissed, at their current bytes, of runs outside the Project's
    /// Trash: Calibration lists them as candidates (CAL-FR-06). Read-only.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn result_masters(&self) -> Result<Vec<MasterOffer>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(offer_sql!(
            "WHERE o.state <> 'adopted' AND o.sha256 = r.sha256 \
             AND r.availability = 'available' AND v.trashed_at IS NULL \
             ORDER BY view_name, o.view_id, o.path"
        ))
        .fetch_all(&mut *conn)
        .await?;
        rows.iter().map(offer_row).collect()
    }
}

/// Offer the master discovery found at `path` with `sha256`, once per file
/// and digest: bytes already offered, dismissed or adopted change nothing.
pub async fn offer_master(
    conn: &mut SqliteConnection,
    result_id: Uuid,
    view_id: Uuid,
    path: &NativePath,
    sha256: &str,
    master: &DetectedMaster,
    at: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO master_offers (id, result_id, view_id, path, sha256, classification, \
         observed, state, offered_at, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, \
         'offered', ?8, NULL) ON CONFLICT (path, sha256) DO NOTHING",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(result_id.to_string())
    .bind(view_id.to_string())
    .bind(to_json(path)?)
    .bind(sha256)
    .bind(to_json(&master.classification)?)
    .bind(to_json(&master.observed)?)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// The run's open offers: each still Offered at its master's current bytes.
pub async fn open_offers(conn: &mut SqliteConnection, view_id: Uuid) -> Result<Vec<MasterOffer>> {
    let rows = sqlx::query(offer_sql!(
        "WHERE o.view_id = ?1 AND o.state = 'offered' AND o.sha256 = r.sha256 \
         ORDER BY o.offered_at, o.id"
    ))
    .bind(view_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    rows.iter().map(offer_row).collect()
}

/// The source of adopting Result `result_id`: a detected master of a run
/// outside the Project's Trash whose current bytes carry an offer not yet
/// adopted (a dismissed one included), below an Active registered location.
///
/// # Errors
/// `InvalidInput` for a Result that is no detected master at its current
/// bytes, one already adopted, one of a run in the Trash, or one outside
/// every Active registered location; `NotFound` for an unknown Result.
pub(super) async fn offered_source(
    conn: &mut SqliteConnection,
    result_id: Uuid,
) -> Result<OfferedSource> {
    let record = load_result(conn, result_id).await?;
    let refuse = |why: String| LibraryError::InvalidInput(format!("result {result_id} {why}"));
    let master = matches!(record.kind, Some(ResultKind::CalibrationMaster { .. }));
    let settled = matches!(record.state, ResultState::Candidate | ResultState::Accepted);
    let (Some(sha256), Some(fingerprint), true, true) =
        (record.sha256.as_ref(), record.fingerprint.clone(), master, settled)
    else {
        return Err(refuse(
            "is no detected master at its current bytes; rescan its Results".into(),
        ));
    };
    let row = sqlx::query(offer_sql!("WHERE o.result_id = ?1 AND o.sha256 = ?2"))
        .bind(result_id.to_string())
        .bind(sha256)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| refuse("carries no master offer at its current bytes".into()))?;
    let offer = offer_row(&row)?;
    if offer.state == MasterOfferState::Adopted {
        return Err(refuse("was already adopted at these bytes".into()));
    }
    let MasterOrigin::View { view_id, .. } = offer.origin else {
        return Err(LibraryError::PersistenceFailure(format!("offer {} names no run", offer.id)));
    };
    require_live(&load_view(conn, view_id).await?)?;
    let path = record.path.to_path_buf()?;
    let rows = sqlx::query("SELECT * FROM locations").fetch_all(&mut *conn).await?;
    let mut holder: Option<(Location, std::path::PathBuf)> = None;
    for row in &rows {
        let location = location_from_row(row)?;
        if location.lifecycle != LocationLifecycle::Active {
            continue;
        }
        let root = location.path.to_path_buf()?;
        let deeper = holder.as_ref().is_none_or(|(_, held)| root.starts_with(held));
        if path.starts_with(&root) && deeper {
            holder = Some((location, root));
        }
    }
    let Some((location, root)) = holder else {
        return Err(refuse(format!(
            "at {} lies outside every registered location; register a location holding it to \
             adopt it",
            path.display()
        )));
    };
    let relative = path.strip_prefix(&root).map_err(|_| refuse("escapes its location".into()))?;
    Ok(OfferedSource {
        offer,
        fingerprint,
        location,
        relative_path: NativePath::from_path(relative),
    })
}

/// Inside the adoption's registration: the offer of `result_id` at
/// `sha256` reads Adopted.
pub(super) async fn mark_adopted(
    conn: &mut SqliteConnection,
    result_id: Uuid,
    sha256: &str,
    at: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE master_offers SET state = 'adopted', decided_at = ?3 \
         WHERE result_id = ?1 AND sha256 = ?2",
    )
    .bind(result_id.to_string())
    .bind(sha256)
    .bind(at)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Inside the adoption review's write: the offer is still open or dismissed.
pub(super) async fn require_unadopted_offer(conn: &mut SqliteConnection, id: Uuid) -> Result<()> {
    if load_offer(conn, id).await?.state == MasterOfferState::Adopted {
        return Err(LibraryError::InvalidInput(format!("master offer {id} was already adopted")));
    }
    Ok(())
}

async fn load_offer(conn: &mut SqliteConnection, id: Uuid) -> Result<MasterOffer> {
    let row = sqlx::query(offer_sql!("WHERE o.id = ?1"))
        .bind(id.to_string())
        .fetch_optional(&mut *conn)
        .await?
        .ok_or_else(|| LibraryError::NotFound(format!("master offer {id}")))?;
    offer_row(&row)
}

fn offer_row(row: &SqliteRow) -> Result<MasterOffer> {
    Ok(MasterOffer {
        id: parse_uuid(&row.try_get::<String, _>("id")?)?,
        result_id: parse_uuid(&row.try_get::<String, _>("result_id")?)?,
        path: from_json(&row.try_get::<String, _>("path")?)?,
        sha256: row.try_get("sha256")?,
        classification: from_json(&row.try_get::<String, _>("classification")?)?,
        observed: from_json(&row.try_get::<String, _>("observed")?)?,
        origin: MasterOrigin::View {
            view_id: parse_uuid(&row.try_get::<String, _>("view_id")?)?,
            view_name: row.try_get::<Option<String>, _>("view_name")?.unwrap_or_default(),
        },
        state: from_text(&row.try_get::<String, _>("state")?)?,
        offered_at: row.try_get("offered_at")?,
        decided_at: row.try_get("decided_at")?,
    })
}
