//! Persistence and repository boundary.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! Production backend: sqlx 0.9 + SQLite (ratified stack, wired T003).
//! All migrations live in `./migrations/` and are consumed via `sqlx::migrate!()`.

use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};

pub mod operation_state;
pub mod repositories;

pub const CRATE_NAME: &str = "persistence_db";

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("entity not found: {0}")]
    NotFound(String),
    #[error("compare-and-swap failed: {0}")]
    CasFailed(String),
    #[error("serialisation error: {0}")]
    Serialise(#[from] serde_json::Error),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error("not implemented")]
    NotImplemented,
}

pub trait Repository {
    fn repository_name(&self) -> &'static str;
}

/// Production SQLite connection pool.
///
/// Callers use `Database::connect` for a file-backed store or
/// `Database::in_memory` for ephemeral test fixtures. Both run migrations
/// automatically via [`Database::migrate`].
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Connect to a file-backed SQLite database.
    ///
    /// `connection_string` should be a `sqlite://`-prefixed path or the special
    /// value `sqlite::memory:` for an in-process ephemeral store.
    ///
    /// # Errors
    ///
    /// Returns [`DbError::Database`] if the pool cannot connect to the given URL.
    pub async fn connect(connection_string: &str) -> DbResult<Self> {
        let pool = SqlitePoolOptions::new().max_connections(8).connect(connection_string).await?;
        Ok(Self { pool })
    }

    /// Convenience constructor for in-memory SQLite (test and CI use).
    ///
    /// # Errors
    ///
    /// Returns [`DbError::Database`] if the in-memory pool cannot be created.
    pub async fn in_memory() -> DbResult<Self> {
        Self::connect("sqlite::memory:").await
    }

    /// Run all pending migrations from `./migrations/`.
    ///
    /// # Errors
    ///
    /// Returns [`DbError::Migration`] if any migration script fails.
    pub async fn migrate(&self) -> DbResult<()> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }

    /// Expose the underlying pool for repository constructors.
    #[must_use]
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "persistence_db");
    }

    /// Smoke-test: connect to in-memory SQLite, run migrations, verify the pool is alive.
    #[tokio::test]
    async fn database_connect_in_memory_and_migrate() {
        let db = super::Database::in_memory().await.expect("in-memory connect");
        db.migrate().await.expect("migrations");
        // A trivial query proves the pool is usable after migration.
        let row: (i64,) = sqlx::query_as("SELECT 1").fetch_one(db.pool()).await.unwrap();
        assert_eq!(row.0, 1);
    }
}
