// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Rig filter lists (spec 072 PLAN-EQ-FR-01, -04, -06): each saved equipment
//! row's list of filters, replaced whole in one writer transaction, and the
//! FILTER values observed on the sessions confirmed to each rig.

use platevault_model::{
    normalize_rig_filters, LibraryError, Revision, RigFilter, RigFilterValue, RigFilterValues,
    RigFilters,
};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{
    conflict, db_revision, from_json, load_equipment, now, parse_uuid, revision, to_json, Catalog,
    Result,
};

impl Catalog {
    /// A rig's saved filter list; revision 0 and no filters until first saved.
    ///
    /// # Errors
    /// `NotFound` for unknown equipment.
    pub async fn rig_filters(&self, equipment_id: Uuid) -> Result<RigFilters> {
        let mut conn = self.reader().await?;
        load_equipment(&mut conn, equipment_id).await?;
        load_rig_filters(&mut conn, equipment_id).await
    }

    /// Replace a rig's filter list. The list is replaced whole or not at all, so
    /// a failed save leaves the previous list in effect. Only this rig's list
    /// changes: neither the equipment record nor any session, association or
    /// observation is written.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid list or a filter id another rig holds;
    /// `NotFound` for unknown equipment; `Conflict` when `expected_revision` is
    /// not the list's current revision.
    pub async fn save_rig_filters(
        &self,
        equipment_id: Uuid,
        filters: &[RigFilter],
        expected_revision: Revision,
    ) -> Result<RigFilters> {
        let filters = normalize_rig_filters(filters)?;
        let saved = write_txn!(self, |conn| {
            load_equipment(conn, equipment_id).await?;
            let current: Option<i64> =
                sqlx::query_scalar("SELECT revision FROM rig_filter_lists WHERE equipment_id = ?1")
                    .bind(equipment_id.to_string())
                    .fetch_optional(&mut *conn)
                    .await?;
            let current = current.map(revision).transpose()?.unwrap_or(0);
            if current != expected_revision {
                return Err(conflict(equipment_id, current));
            }
            replace_rig_filters(conn, equipment_id, &filters, current + 1).await?;
            load_rig_filters(conn, equipment_id).await?
        });
        Ok(saved)
    }

    /// FILTER values seen on the live frames of current sessions whose rig is
    /// confirmed, per rig, for one rig or all. Values are trimmed and listed
    /// as observed; whether a rig's filters match them is the caller's reading.
    ///
    /// # Errors
    /// `PersistenceFailure` for an unreadable catalog.
    pub async fn rig_filter_values(
        &self,
        equipment_id: Option<Uuid>,
    ) -> Result<Vec<RigFilterValues>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query(
            "SELECT DISTINCT x.equipment_id, e.name, \
             trim(json_extract(a.effective, '$.filter')) AS value, s.id AS session_id \
             FROM associations x \
             JOIN equipment e ON e.id = x.equipment_id \
             JOIN sessions s ON s.id = x.session_id AND s.superseded_by IS NULL \
             JOIN live_assets a ON a.session_id = s.id \
             JOIN locations l ON l.id = a.location_id AND l.lifecycle = 'active' \
             WHERE x.kind = 'equipment' AND x.state = 'confirmed' \
             AND (?1 IS NULL OR x.equipment_id = ?1) \
             AND trim(json_extract(a.effective, '$.filter')) <> '' \
             ORDER BY e.name, x.equipment_id, value, s.id",
        )
        .bind(equipment_id.map(|id| id.to_string()))
        .fetch_all(&mut *conn)
        .await?;
        let mut rigs: Vec<RigFilterValues> = Vec::new();
        for row in rows {
            let rig = parse_uuid(&row.try_get::<String, _>("equipment_id")?)?;
            let value: String = row.try_get("value")?;
            let session = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
            let seen = RigFilterValue { value, session_ids: vec![session] };
            match rigs.last_mut() {
                Some(last) if last.equipment_id == rig => match last.values.last_mut() {
                    Some(same) if same.value == seen.value => same.session_ids.push(session),
                    _ => last.values.push(seen),
                },
                _ => rigs.push(RigFilterValues {
                    equipment_id: rig,
                    rig_name: row.try_get("name")?,
                    values: vec![seen],
                }),
            }
        }
        Ok(rigs)
    }
}

async fn load_rig_filters(conn: &mut SqliteConnection, equipment_id: Uuid) -> Result<RigFilters> {
    let current: Option<i64> =
        sqlx::query_scalar("SELECT revision FROM rig_filter_lists WHERE equipment_id = ?1")
            .bind(equipment_id.to_string())
            .fetch_optional(&mut *conn)
            .await?;
    let rows = sqlx::query(
        "SELECT id, name, match_values, bands FROM rig_filters WHERE equipment_id = ?1 \
         ORDER BY position",
    )
    .bind(equipment_id.to_string())
    .fetch_all(&mut *conn)
    .await?;
    let filters = rows
        .iter()
        .map(|row| {
            Ok(RigFilter {
                id: parse_uuid(&row.try_get::<String, _>("id")?)?,
                name: row.try_get("name")?,
                match_values: from_json(&row.try_get::<String, _>("match_values")?)?,
                bands: from_json(&row.try_get::<String, _>("bands")?)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(RigFilters {
        equipment_id,
        revision: current.map(revision).transpose()?.unwrap_or(0),
        filters,
    })
}

async fn replace_rig_filters(
    conn: &mut SqliteConnection,
    equipment_id: Uuid,
    filters: &[RigFilter],
    next: Revision,
) -> Result<()> {
    let rig = equipment_id.to_string();
    for filter in filters {
        let owner: Option<String> =
            sqlx::query_scalar("SELECT equipment_id FROM rig_filters WHERE id = ?1")
                .bind(filter.id.to_string())
                .fetch_optional(&mut *conn)
                .await?;
        if let Some(owner) = owner.filter(|owner| *owner != rig) {
            return Err(LibraryError::InvalidInput(format!(
                "filter {} belongs to another rig ({owner})",
                filter.id
            )));
        }
    }
    sqlx::query(
        "INSERT INTO rig_filter_lists (equipment_id, revision, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT (equipment_id) DO UPDATE SET revision = excluded.revision, \
         updated_at = excluded.updated_at",
    )
    .bind(&rig)
    .bind(db_revision(next)?)
    .bind(now()?)
    .execute(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM rig_filters WHERE equipment_id = ?1")
        .bind(&rig)
        .execute(&mut *conn)
        .await?;
    for (position, filter) in filters.iter().enumerate() {
        sqlx::query(
            "INSERT INTO rig_filters (id, equipment_id, name, match_values, bands, position) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(filter.id.to_string())
        .bind(&rig)
        .bind(&filter.name)
        .bind(to_json(&filter.match_values)?)
        .bind(to_json(&filter.bands)?)
        .bind(
            i64::try_from(position)
                .map_err(|_| LibraryError::InvalidInput("filter list too long".into()))?,
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}
