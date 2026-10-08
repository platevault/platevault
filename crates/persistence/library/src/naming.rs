// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Naming template overrides (spec 071 STO-IMP-FR-07) on the catalog's single
//! writer. Only overridden frame types have a row; the built-in defaults and
//! template validation live in the application layer, which validates before a
//! write and again on every resolve.

use platevault_model::{LibraryError, NamingFrameType};
use sqlx::sqlite::SqliteConnection;
use sqlx::{Connection, Row};

use super::{Catalog, Result};

impl Catalog {
    /// Stored overrides in frame-type order.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read or holds an unknown
    /// frame type.
    pub async fn naming_overrides(&self) -> Result<Vec<(NamingFrameType, String)>> {
        let mut conn = self.reader().await?;
        let rows = sqlx::query("SELECT frame_type, template FROM naming_templates")
            .fetch_all(&mut *conn)
            .await?;
        let mut overrides = rows
            .iter()
            .map(|row| {
                let name: String = row.try_get("frame_type")?;
                let class = NamingFrameType::from_stored(&name).ok_or_else(|| {
                    LibraryError::PersistenceFailure(format!("unknown naming frame type {name}"))
                })?;
                Ok((class, row.try_get("template")?))
            })
            .collect::<Result<Vec<_>>>()?;
        overrides.sort_unstable_by_key(|(class, _)| *class);
        Ok(overrides)
    }

    /// Store `template` as the frame type's override, or delete the override
    /// when `None`.
    ///
    /// # Errors
    /// `PersistenceFailure` when the write cannot commit.
    pub async fn set_naming_override(
        &self,
        frame_type: NamingFrameType,
        template: Option<&str>,
    ) -> Result<()> {
        write_txn!(self, |conn| {
            match template {
                Some(template) => {
                    sqlx::query(
                        "INSERT INTO naming_templates (frame_type, template) VALUES (?1, ?2) \
                         ON CONFLICT (frame_type) DO UPDATE SET template = excluded.template",
                    )
                    .bind(frame_type.as_str())
                    .bind(template)
                    .execute(&mut *conn)
                    .await?
                }
                None => {
                    sqlx::query("DELETE FROM naming_templates WHERE frame_type = ?1")
                        .bind(frame_type.as_str())
                        .execute(&mut *conn)
                        .await?
                }
            };
        });
        Ok(())
    }

    /// Delete every override, so each frame type reads its default.
    ///
    /// # Errors
    /// `PersistenceFailure` when the write cannot commit.
    pub async fn clear_naming_overrides(&self) -> Result<()> {
        write_txn!(self, |conn| {
            sqlx::query("DELETE FROM naming_templates").execute(&mut *conn).await?;
        });
        Ok(())
    }
}
