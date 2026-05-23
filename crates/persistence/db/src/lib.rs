//! Persistence and repository boundary.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks
//!
//! Production backend: sqlx 0.8 + SQLite (ratified stack).
//! The `sqlx` crate is intentionally not listed in Cargo.toml during initial scaffolding
//! so that domain crate unit tests compile in network-restricted environments.
//! Wire `sqlx.workspace = true` in this Cargo.toml and uncomment the `Database` impl
//! below once the crate is built with network access (T003).
//!
//! All migrations live in `./migrations/` and are consumed via `sqlx::migrate!()`.

pub mod operation_state;
pub mod repositories;

pub const CRATE_NAME: &str = "persistence_db";

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("entity not found: {0}")]
    NotFound(String),
    #[error("serialisation error: {0}")]
    Serialise(#[from] serde_json::Error),
    /// Placeholder for sqlx errors once the dep is wired.
    #[error("database error: {0}")]
    Database(String),
}

pub trait Repository {
    fn repository_name(&self) -> &'static str;
}

// ── TODO T003: Uncomment Database struct once sqlx is added to Cargo.toml ────
//
// pub struct Database { pub pool: sqlx::SqlitePool }
// impl Database {
//     pub async fn new(connection_string: &str) -> DbResult<Self> { ... }
//     pub async fn in_memory() -> DbResult<Self> { ... }
//     pub async fn migrate(&self) -> DbResult<()> {
//         sqlx::migrate!("./migrations").run(&self.pool).await?;
//         Ok(())
//     }
// }

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "persistence_db");
    }
}
