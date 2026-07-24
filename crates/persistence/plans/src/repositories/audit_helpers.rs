// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Minimal audit-log insertion helper used by project auto-transitions.
//! Duplicated from persistence_db::repositories::audit to avoid a cycle.

use persistence_core::DbResult;
use sqlx::SqliteConnection;

pub(crate) async fn insert_project_auto_transition_conn(
    conn: &mut SqliteConnection,
    project_id: &str,
    from_state: &str,
    to_state: &str,
    trigger: &str,
) -> DbResult<()> {
    use time::format_description::well_known::Rfc3339;
    use uuid::Uuid;

    let audit_id = Uuid::new_v4().to_string();
    let request_id = Uuid::new_v4().to_string();
    let at = time::OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());

    sqlx::query(
        "INSERT INTO audit_log_entry \
         (audit_id, entity_type, entity_id, from_state, to_state, trigger, actor, \
          outcome, severity, request_id, at, payload) \
         VALUES (?, 'project', ?, ?, ?, ?, 'system', 'applied', 'workflow', ?, ?, NULL)",
    )
    .bind(&audit_id)
    .bind(project_id)
    .bind(from_state)
    .bind(to_state)
    .bind(trigger)
    .bind(&request_id)
    .bind(&at)
    .execute(conn)
    .await?;

    Ok(())
}
