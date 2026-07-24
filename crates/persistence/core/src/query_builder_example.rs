// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Canonical dynamic-query pattern for the centralized persistence layer.
//!
//! This module is **not** wired into any real repository. It exists as the
//! reference implementation for the persistence-layer hardening refactor
//! (see `docs/development/persistence-layer-hardening.md`): relocate dynamic
//! SQL into `persistence/db`, build it with [`sea_query`], and bind the result
//! onto sqlx 0.9 manually.
//!
//! ## Why manual binding (no `sea-query-binder`)
//!
//! `sea-query-binder` is the "official" bridge from sea-query to sqlx, but its
//! current release pins `sqlx = "0.8"`, which conflicts with our ratified
//! sqlx 0.9. Pulling it in would drag a second, incompatible sqlx into the tree.
//! `sea-query` itself has **no** sqlx dependency — it is a pure builder that
//! emits `(String, Values)`. We bind those `Values` onto a sqlx 0.9 query
//! ourselves via [`bind_values`], which keeps us on a single, ratified sqlx.
//!
//! ## sqlx 0.9 dynamic-SQL guard
//!
//! sqlx 0.9 changed `query`/`query_as` to accept `impl SqlSafeStr`. A runtime
//! `String` is not implicitly safe, so a builder-produced statement must be
//! wrapped in [`sqlx::AssertSqlSafe`] to opt in. This is sound here: sea-query
//! emits parameterized SQL with `?` placeholders and never interpolates
//! user values into the statement text — the values travel in `Values` and are
//! bound out-of-band.
//!
//! The pattern is exercised by the `#[cfg(test)]` smoke test at the bottom.

#![allow(dead_code)] // reference module; helpers are exercised only by the smoke test

use sea_query::{Iden, Value, Values};
use sqlx::sqlite::SqliteArguments;
use sqlx::{AssertSqlSafe, Sqlite};

/// Column/table identifiers for the example table.
///
/// Real repositories would derive one `Iden` enum per table next to its
/// `FromRow` row struct.
#[derive(Iden)]
pub enum Widget {
    Table,
    Id,
    Name,
    Kind,
}

/// Typed row mapped from the dynamic query via sqlx `FromRow`.
#[derive(Debug, sqlx::FromRow, PartialEq, Eq)]
pub struct WidgetRow {
    pub id: i64,
    pub name: String,
    pub kind: String,
}

/// Fold a sea-query [`Values`] payload onto a sqlx [`Query`] in order.
///
/// Only the variants the persistence layer actually emits are handled. Exotic
/// variants (chrono/decimal/uuid/array/...) are intentionally `unimplemented!()`
/// so an accidental use surfaces loudly rather than silently mis-binding.
///
/// [`Query`]: sqlx::query::Query
pub fn bind_values(
    mut query: sqlx::query::Query<'_, Sqlite, SqliteArguments>,
    values: Values,
) -> sqlx::query::Query<'_, Sqlite, SqliteArguments> {
    for value in values {
        query = match value {
            Value::Bool(v) => query.bind(v),
            Value::TinyInt(v) => query.bind(v.map(i64::from)),
            Value::SmallInt(v) => query.bind(v.map(i64::from)),
            Value::Int(v) => query.bind(v.map(i64::from)),
            Value::BigInt(v) => query.bind(v),
            Value::Float(v) => query.bind(v.map(f64::from)),
            Value::Double(v) => query.bind(v),
            Value::String(v) => query.bind(v),
            Value::Char(v) => query.bind(v.map(|c| c.to_string())),
            Value::Bytes(v) => query.bind(v),
            other => unimplemented!(
                "persistence query builder: unhandled sea-query Value variant: {other:?}"
            ),
        };
    }
    query
}

/// Same fold, for the typed `query_as` path that maps onto a `FromRow` struct.
pub fn bind_values_as<O>(
    mut query: sqlx::query::QueryAs<'_, Sqlite, O, SqliteArguments>,
    values: Values,
) -> sqlx::query::QueryAs<'_, Sqlite, O, SqliteArguments> {
    for value in values {
        query = match value {
            Value::Bool(v) => query.bind(v),
            Value::TinyInt(v) => query.bind(v.map(i64::from)),
            Value::SmallInt(v) => query.bind(v.map(i64::from)),
            Value::Int(v) => query.bind(v.map(i64::from)),
            Value::BigInt(v) => query.bind(v),
            Value::Float(v) => query.bind(v.map(f64::from)),
            Value::Double(v) => query.bind(v),
            Value::String(v) => query.bind(v),
            Value::Char(v) => query.bind(v.map(|c| c.to_string())),
            Value::Bytes(v) => query.bind(v),
            other => unimplemented!(
                "persistence query builder: unhandled sea-query Value variant: {other:?}"
            ),
        };
    }
    query
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_query::{Expr, ExprTrait, Order, Query, SqliteQueryBuilder};
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::SqlitePool;

    /// Build a dynamic SELECT with optional WHERE clauses and run it through the
    /// manual binder against in-memory SQLite, mapping into `WidgetRow`.
    async fn fetch_widgets(
        pool: &SqlitePool,
        kind: Option<&str>,
        min_id: Option<i64>,
    ) -> Vec<WidgetRow> {
        let mut stmt = Query::select();
        stmt.columns([Widget::Id, Widget::Name, Widget::Kind])
            .from(Widget::Table)
            .order_by(Widget::Id, Order::Asc);
        if let Some(kind) = kind {
            stmt.and_where(Expr::col(Widget::Kind).eq(kind));
        }
        if let Some(min_id) = min_id {
            stmt.and_where(Expr::col(Widget::Id).gte(min_id));
        }

        // sea-query produces parameterized SQL (`?` placeholders) + a Values
        // payload; the text never contains user data, so AssertSqlSafe is sound.
        let (sql, values) = stmt.build(SqliteQueryBuilder);
        let query = sqlx::query_as::<_, WidgetRow>(AssertSqlSafe(sql));
        bind_values_as(query, values).fetch_all(pool).await.expect("dynamic select runs")
    }

    #[tokio::test]
    async fn dynamic_select_round_trips_through_manual_binder() {
        let pool =
            SqlitePoolOptions::new().connect("sqlite::memory:").await.expect("in-memory sqlite");
        sqlx::query(
            "CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("create table");
        sqlx::query(
            "INSERT INTO widget (id, name, kind) VALUES (1,'a','x'),(2,'b','y'),(3,'c','x')",
        )
        .execute(&pool)
        .await
        .expect("seed rows");

        // No filters: all three rows.
        let all = fetch_widgets(&pool, None, None).await;
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].id, 1);

        // One optional WHERE (kind = 'x').
        let only_x = fetch_widgets(&pool, Some("x"), None).await;
        assert_eq!(only_x.len(), 2);
        assert!(only_x.iter().all(|row| row.kind == "x"));

        // Two optional WHERE clauses combined (kind = 'x' AND id >= 3).
        let x_high = fetch_widgets(&pool, Some("x"), Some(3)).await;
        assert_eq!(x_high, vec![WidgetRow { id: 3, name: "c".to_string(), kind: "x".to_string() }]);
    }

    #[tokio::test]
    async fn untyped_binder_executes_insert() {
        let pool =
            SqlitePoolOptions::new().connect("sqlite::memory:").await.expect("in-memory sqlite");
        sqlx::query(
            "CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL)",
        )
        .execute(&pool)
        .await
        .expect("create table");

        let (sql, values) = Query::insert()
            .into_table(Widget::Table)
            .columns([Widget::Name, Widget::Kind])
            .values_panic(["dynamic".into(), "z".into()])
            .build(SqliteQueryBuilder);
        let rows = bind_values(sqlx::query(AssertSqlSafe(sql)), values)
            .execute(&pool)
            .await
            .expect("dynamic insert runs")
            .rows_affected();
        assert_eq!(rows, 1);
    }
}
