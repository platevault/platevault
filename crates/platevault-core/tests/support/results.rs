// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixtures of the RES tests (spec 070): the PREP world's prepared
//! run and settled and growing files in its Results folder. The run group
//! tests prepare `group_support`'s run group with Prepare all, which records
//! its panel and Assembled Results folders. Included with
//! `#[path = "support/results.rs"] mod results_support;` beside
//! `prepare_support` and `support`.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use platevault_core::library::Library;
use platevault_core::*;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::Connection;
use uuid::Uuid;

use super::prepare_support::{Watch, World, PROJECT, RUN};

/// Set `path`'s modification time an hour back: a settled file.
pub fn settle(path: &Path) {
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_modified(SystemTime::now() - Duration::from_secs(3600)).unwrap();
}

/// A settled FITS file with `keywords`.
pub fn stack(path: &Path, keywords: &[(&str, &str)]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    super::support::fits(path, keywords).unwrap();
    settle(path);
}

/// A settled non-image file with `text`.
pub fn text(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
    settle(path);
}

/// Record `path` as run `view`'s Results folder the way its first
/// preparation records it, without preparing the run.
pub async fn record_results_folder(database: &Path, view: Uuid, path: &Path) {
    fs::create_dir_all(path).unwrap();
    let options = SqliteConnectOptions::new().filename(database).foreign_keys(true);
    let mut conn = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::query(
        "INSERT INTO results_folders (id, view_id, group_id, kind, path, created_at) \
         VALUES (?1, ?2, NULL, 'run', ?3, '2026-10-08T00:00:00Z')",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(view.to_string())
    .bind(serde_json::to_string(&NativePath::from_path(path)).unwrap())
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();
}

pub fn database(world: &World) -> PathBuf {
    world.temp.path().join("library.sqlite")
}

/// `<output>/<Project>/<Run> Results/`.
pub fn results_dir(world: &World) -> PathBuf {
    world.output.join(PROJECT).join(format!("{RUN} Results"))
}

/// Prepare the world's run once with a Siril profile.
pub async fn prepared(world: &World) -> PreparationOutcome {
    let profile = world.siril("exit 0").await;
    let request = world.request(&profile, InputMode::LinkedView, None);
    let outcome = world.prepare(&request, &Watch::quiet()).await;
    assert_eq!(outcome.revision.state, PreparationState::Prepared, "{outcome:#?}");
    outcome
}

pub fn path(record: &ResultRecord) -> PathBuf {
    record.path.to_path_buf().unwrap()
}

pub fn paths(records: &[ResultRecord]) -> Vec<PathBuf> {
    records.iter().map(path).collect()
}

pub fn find<'a>(records: &'a [ResultRecord], file: &Path) -> &'a ResultRecord {
    records
        .iter()
        .find(|record| path(record) == file)
        .unwrap_or_else(|| panic!("{} is not listed in {:?}", file.display(), paths(records)))
}

/// Rescan the run and accept `file` as `kind`.
pub async fn accept(library: &Library, owner: ResultOwner, file: &Path, kind: ResultKind) -> Uuid {
    let listing = library.rescan_results(owner).await.unwrap();
    let id = find(&listing.candidates, file).id;
    let outcome =
        library.accept_results(&[AcceptResult { result_id: id, kind: Some(kind) }]).await.unwrap();
    assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
    id
}
