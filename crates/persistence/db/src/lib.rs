//! Persistence and repository boundary.

pub mod operation_state;

use std::collections::BTreeSet;

use rusqlite::{Connection, Transaction};

pub const CRATE_NAME: &str = "persistence_db";

pub type DbResult<T> = Result<T, DbError>;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("duplicate migration id: {0}")]
    DuplicateMigrationId(String),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Migration {
    pub id: &'static str,
    pub description: &'static str,
    pub sql: &'static str,
}

impl Migration {
    #[must_use]
    pub const fn new(id: &'static str, description: &'static str, sql: &'static str) -> Self {
        Self { id, description, sql }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppliedMigration {
    pub id: String,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationRunner {
    migrations: Vec<Migration>,
}

impl MigrationRunner {
    pub fn new(mut migrations: Vec<Migration>) -> DbResult<Self> {
        let mut seen = BTreeSet::new();
        for migration in &migrations {
            if !seen.insert(migration.id) {
                return Err(DbError::DuplicateMigrationId(migration.id.to_owned()));
            }
        }

        migrations.sort_by_key(|migration| migration.id);
        Ok(Self { migrations })
    }

    pub fn apply_pending(&self, connection: &mut Connection) -> DbResult<Vec<AppliedMigration>> {
        ensure_migration_table(connection)?;
        let applied_ids = applied_migration_ids(connection)?;
        let transaction = connection.transaction()?;
        let mut applied = Vec::new();

        for migration in &self.migrations {
            if applied_ids.contains(migration.id) {
                continue;
            }

            transaction.execute_batch(migration.sql)?;
            transaction.execute(
                "INSERT INTO alm_schema_migrations (id, description) VALUES (?1, ?2)",
                (migration.id, migration.description),
            )?;
            applied.push(AppliedMigration {
                id: migration.id.to_owned(),
                description: migration.description.to_owned(),
            });
        }

        transaction.commit()?;
        Ok(applied)
    }
}

pub trait Repository {
    fn repository_name(&self) -> &'static str;
}

pub trait TransactionBoundary {
    fn with_transaction<T>(
        &mut self,
        operation: impl FnOnce(&Transaction<'_>) -> DbResult<T>,
    ) -> DbResult<T>;
}

pub struct SqliteDatabase {
    connection: Connection,
}

impl SqliteDatabase {
    pub fn open(path: impl AsRef<std::path::Path>) -> DbResult<Self> {
        let connection = Connection::open(path)?;
        configure_connection(&connection)?;
        Ok(Self { connection })
    }

    pub fn in_memory() -> DbResult<Self> {
        let connection = Connection::open_in_memory()?;
        configure_connection(&connection)?;
        Ok(Self { connection })
    }

    #[must_use]
    pub const fn connection(&self) -> &Connection {
        &self.connection
    }

    pub fn connection_mut(&mut self) -> &mut Connection {
        &mut self.connection
    }
}

impl TransactionBoundary for SqliteDatabase {
    fn with_transaction<T>(
        &mut self,
        operation: impl FnOnce(&Transaction<'_>) -> DbResult<T>,
    ) -> DbResult<T> {
        let transaction = self.connection.transaction()?;
        let result = operation(&transaction)?;
        transaction.commit()?;
        Ok(result)
    }
}

fn configure_connection(connection: &Connection) -> DbResult<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

fn ensure_migration_table(connection: &Connection) -> DbResult<()> {
    connection.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS alm_schema_migrations (
            id TEXT PRIMARY KEY NOT NULL,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        ",
    )?;
    Ok(())
}

fn applied_migration_ids(connection: &Connection) -> DbResult<BTreeSet<String>> {
    let mut statement = connection.prepare("SELECT id FROM alm_schema_migrations")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut ids = BTreeSet::new();

    for row in rows {
        ids.insert(row?);
    }

    Ok(ids)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{
        DbError, Migration, MigrationRunner, SqliteDatabase, TransactionBoundary, CRATE_NAME,
    };

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "persistence_db");
    }

    #[test]
    fn configures_foreign_keys_for_new_connections() {
        let database = SqliteDatabase::in_memory().unwrap();
        let enabled: bool =
            database.connection().query_row("PRAGMA foreign_keys", [], |row| row.get(0)).unwrap();

        assert!(enabled);
    }

    #[test]
    fn applies_pending_migrations_once_in_id_order() {
        let mut database = SqliteDatabase::in_memory().unwrap();
        let runner = MigrationRunner::new(vec![
            Migration::new(
                "002_insert",
                "insert sample",
                "INSERT INTO sample (name) VALUES ('M31');",
            ),
            Migration::new(
                "001_create",
                "create sample",
                "CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
            ),
        ])
        .unwrap();

        let first = runner.apply_pending(database.connection_mut()).unwrap();
        let second = runner.apply_pending(database.connection_mut()).unwrap();
        let count: u32 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM sample", [], |row| row.get(0))
            .unwrap();

        assert_eq!(
            first.iter().map(|migration| migration.id.as_str()).collect::<Vec<_>>(),
            vec!["001_create", "002_insert"]
        );
        assert!(second.is_empty());
        assert_eq!(count, 1);
    }

    #[test]
    fn rejects_duplicate_migration_ids() {
        let error = MigrationRunner::new(vec![
            Migration::new("001", "first", "SELECT 1;"),
            Migration::new("001", "duplicate", "SELECT 2;"),
        ])
        .unwrap_err();

        assert!(matches!(error, DbError::DuplicateMigrationId(id) if id == "001"));
    }

    #[test]
    fn transaction_boundary_commits_successful_work() {
        let mut database = SqliteDatabase::in_memory().unwrap();
        database
            .with_transaction(|transaction| {
                transaction.execute("CREATE TABLE tx_test (name TEXT NOT NULL)", [])?;
                transaction.execute("INSERT INTO tx_test (name) VALUES ('ok')", [])?;
                Ok(())
            })
            .unwrap();
        let count: u32 = database
            .connection()
            .query_row("SELECT COUNT(*) FROM tx_test", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 1);
    }

    #[test]
    fn transaction_boundary_rolls_back_failed_work() {
        let mut database = SqliteDatabase { connection: Connection::open_in_memory().unwrap() };
        super::configure_connection(database.connection()).unwrap();
        let result: super::DbResult<()> = database.with_transaction(|transaction| {
            transaction.execute("CREATE TABLE tx_test (name TEXT NOT NULL)", [])?;
            Err(DbError::Sqlite(rusqlite::Error::InvalidQuery))
        });

        assert!(result.is_err());
        assert!(database
            .connection()
            .query_row("SELECT COUNT(*) FROM tx_test", [], |row| row.get::<_, u32>(0))
            .is_err());
    }
}
