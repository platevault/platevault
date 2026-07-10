//! Spec 049 US4: `sourceview.verify` — read-only pre-processing check that
//! every link in a generated (or spec-026-produced) source view still
//! resolves to a present canonical source.
//!
//! Companion to `crate::source_view_generate` and `crate::prepared_views`:
//! reuses the same `PreparedSourceView`/`PreparedSourceViewItem` entities.
//! FR-014/FR-015: this MUST NOT mutate the filesystem and MUST NOT
//! auto-repair — repair is via explicit `preparedview.regenerate`
//! (spec 026), never here.
//!
//! No project-lifecycle gate: verification is a read-only check, unlike
//! generate/remove/regenerate which mutate plan/view state.

use camino::Utf8Path;
use contracts_core::source_view_verify::{BrokenItem, BrokenItemState, SourceViewVerifyResponse};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};
use persistence_db::repositories::prepared_source_views as views_repo;
use sqlx::SqlitePool;

fn db_err(e: persistence_db::DbError) -> ContractError {
    match e {
        persistence_db::DbError::NotFound(msg) => {
            ContractError::new(ErrorCode::ViewNotFound, msg, ErrorSeverity::Blocking, false)
        }
        other => app_core_errors::db_err(other),
    }
}

/// Resolved canonical-source state for one view item's `inventory_item_id`.
struct SourceResolution {
    /// Absolute path of the canonical source, when the source root and
    /// `file_record` row both resolve.
    abs_path: Option<camino::Utf8PathBuf>,
    /// `true` when the `file_record` row is absent or its state is
    /// `missing`/`rejected` — the source itself is gone from the inventory's
    /// point of view (FR-019-style "moved/removed" signal).
    source_gone: bool,
}

async fn resolve_source(pool: &SqlitePool, inventory_item_id: &str) -> SourceResolution {
    let Ok(Some((root_id, relative_path, state))) = sqlx::query_as::<_, (String, String, String)>(
        "SELECT root_id, relative_path, state FROM file_record WHERE id = ?",
    )
    .bind(inventory_item_id)
    .fetch_optional(pool)
    .await
    else {
        return SourceResolution { abs_path: None, source_gone: true };
    };

    if state == "missing" || state == "rejected" {
        return SourceResolution { abs_path: None, source_gone: true };
    }

    let root_path = persistence_db::repositories::inventory::get_library_root_path(pool, &root_id)
        .await
        .unwrap_or(None);
    let Some(root_path) = root_path else {
        return SourceResolution { abs_path: None, source_gone: true };
    };

    SourceResolution {
        abs_path: Some(camino::Utf8PathBuf::from(root_path).join(&relative_path)),
        source_gone: false,
    }
}

/// Verify a `PreparedSourceView`'s links without mutating anything.
///
/// Per item:
/// 1. The canonical source (`inventory_item_id`) is resolved; a
///    missing/rejected/absent `file_record` row is reported as `moved`
///    (FR-019-style "the source is gone").
/// 2. The destination path (`view_relative_path`, recorded as an absolute
///    path at generation/regeneration time) is inspected with `lstat`
///    (never followed automatically): absent → `missing`.
/// 3. A symlink destination whose target does not resolve (dangling) →
///    `unresolved_link`.
/// 4. The recorded `materialization` disagreeing with the actual on-disk
///    kind (symlink vs. not) → `changed_kind`.
///
/// # Errors
///
/// Returns `view.not_found` or an `internal.*` error on failure.
pub async fn verify_source_view(
    pool: &SqlitePool,
    view_id: &str,
) -> Result<SourceViewVerifyResponse, ContractError> {
    // 1. The view must exist (A4: records are never hard-deleted, so this
    //    only fails for a genuinely unknown id).
    views_repo::get_view(pool, view_id).await.map_err(db_err)?;

    let items = views_repo::list_view_items(pool, view_id).await.map_err(db_err)?;

    let mut broken_items = Vec::new();

    for item in items {
        let source = resolve_source(pool, &item.inventory_item_id).await;

        if source.source_gone {
            broken_items.push(BrokenItem {
                inventory_item_id: item.inventory_item_id,
                view_relative_path: item.view_relative_path,
                state: BrokenItemState::Moved,
            });
            continue;
        }

        let dest = Utf8Path::new(&item.view_relative_path);
        let Ok(lstat) = std::fs::symlink_metadata(dest) else {
            broken_items.push(BrokenItem {
                inventory_item_id: item.inventory_item_id,
                view_relative_path: item.view_relative_path,
                state: BrokenItemState::Missing,
            });
            continue;
        };

        let is_symlink = lstat.file_type().is_symlink();
        let recorded_symlink = item.materialization == "symlink";

        if is_symlink {
            // Dangling check: `metadata` follows the link; NotFound means the
            // target no longer exists (FR-015: report, never auto-repair).
            if std::fs::metadata(dest).is_err() {
                broken_items.push(BrokenItem {
                    inventory_item_id: item.inventory_item_id,
                    view_relative_path: item.view_relative_path,
                    state: BrokenItemState::UnresolvedLink,
                });
                continue;
            }
            // Target resolves — but does it still point at the canonical
            // source (not merely at *some* live file)?
            if let Some(expected) = &source.abs_path {
                let matches_target = std::fs::canonicalize(dest)
                    .ok()
                    .zip(std::fs::canonicalize(expected).ok())
                    .is_some_and(|(actual, expected)| actual == expected);
                if !matches_target {
                    broken_items.push(BrokenItem {
                        inventory_item_id: item.inventory_item_id,
                        view_relative_path: item.view_relative_path,
                        state: BrokenItemState::UnresolvedLink,
                    });
                    continue;
                }
            }
            if !recorded_symlink {
                broken_items.push(BrokenItem {
                    inventory_item_id: item.inventory_item_id,
                    view_relative_path: item.view_relative_path,
                    state: BrokenItemState::ChangedKind,
                });
            }
        } else if recorded_symlink {
            // Recorded as a symlink but the destination is a regular file —
            // the on-disk kind diverged (spec 026 FR-008 mixed-kind concept).
            broken_items.push(BrokenItem {
                inventory_item_id: item.inventory_item_id,
                view_relative_path: item.view_relative_path,
                state: BrokenItemState::ChangedKind,
            });
        }
        // Non-symlink destinations (hardlink/copy) that lstat succeeded on
        // and whose recorded kind wasn't symlink are clean: their bytes are
        // independent of the source's current inventory path.
    }

    let clean = broken_items.is_empty();
    Ok(SourceViewVerifyResponse { clean, broken_items })
}

#[cfg(test)]
mod tests {
    use super::*;
    use persistence_db::Database;

    async fn setup() -> Database {
        let db = Database::in_memory().await.expect("in-memory DB");
        db.migrate().await.expect("migrations");
        db
    }

    async fn insert_project(db: &Database, id: &str, path: &str) {
        sqlx::query(
            "INSERT INTO projects (id, name, tool, lifecycle, path, created_at, updated_at)
             VALUES (?, ?, 'PixInsight', 'ready', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(id)
        .bind(path)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_root(db: &Database, id: &str, path: &str) {
        sqlx::query(
            "INSERT INTO library_root (id, label, current_path, kind, state, created_at)
             VALUES (?, ?, ?, 'local', 'active', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(id)
        .bind(path)
        .execute(db.pool())
        .await
        .unwrap();
    }

    async fn insert_file_record(db: &Database, id: &str, root_id: &str, relative_path: &str) {
        sqlx::query(
            "INSERT INTO file_record (id, root_id, relative_path, size_bytes, mtime, state, first_seen_at, last_seen_at)
             VALUES (?, ?, ?, 100, '2026-01-01T00:00:00Z', 'classified', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        )
        .bind(id)
        .bind(root_id)
        .bind(relative_path)
        .execute(db.pool())
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn view_not_found_surfaces_error() {
        let db = setup().await;
        let err = verify_source_view(db.pool(), "nonexistent").await.unwrap_err();
        assert_eq!(err.code, ErrorCode::ViewNotFound);
    }

    #[tokio::test]
    async fn all_present_view_verifies_clean() {
        let db = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let dest_dir = dir.path().join("dest");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        let source_file = source_dir.join("light1.fits");
        std::fs::write(&source_file, b"x").unwrap();
        let dest_file = dest_dir.join("light1.fits");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source_file, &dest_file).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&source_file, &dest_file).unwrap();

        insert_project(&db, "p1", dir.path().join("proj").to_str().unwrap()).await;
        insert_root(&db, "root1", source_dir.to_str().unwrap()).await;
        insert_file_record(&db, "frame1", "root1", "light1.fits").await;

        views_repo::insert_view(
            db.pool(),
            &views_repo::InsertPreparedSourceView {
                id: "view1",
                project_id: "p1",
                kind: "symlink",
            },
        )
        .await
        .unwrap();
        views_repo::insert_view_item(
            db.pool(),
            &views_repo::InsertPreparedSourceViewItem {
                id: "item1",
                view_id: "view1",
                inventory_item_id: "frame1",
                view_relative_path: dest_file.to_str().unwrap(),
                materialization: "symlink",
            },
        )
        .await
        .unwrap();

        let resp = verify_source_view(db.pool(), "view1").await.unwrap();
        assert!(resp.clean, "expected clean, got broken_items: {:?}", resp.broken_items);
        assert!(resp.broken_items.is_empty());
    }

    #[tokio::test]
    async fn moved_source_is_reported_without_mutation() {
        let db = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let source_dir = dir.path().join("source");
        let dest_dir = dir.path().join("dest");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        let source_file = source_dir.join("light1.fits");
        std::fs::write(&source_file, b"x").unwrap();
        let dest_file = dest_dir.join("light1.fits");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source_file, &dest_file).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(&source_file, &dest_file).unwrap();

        insert_project(&db, "p1", dir.path().join("proj").to_str().unwrap()).await;
        insert_root(&db, "root1", source_dir.to_str().unwrap()).await;
        insert_file_record(&db, "frame1", "root1", "light1.fits").await;

        views_repo::insert_view(
            db.pool(),
            &views_repo::InsertPreparedSourceView {
                id: "view2",
                project_id: "p1",
                kind: "symlink",
            },
        )
        .await
        .unwrap();
        views_repo::insert_view_item(
            db.pool(),
            &views_repo::InsertPreparedSourceViewItem {
                id: "item2",
                view_id: "view2",
                inventory_item_id: "frame1",
                view_relative_path: dest_file.to_str().unwrap(),
                materialization: "symlink",
            },
        )
        .await
        .unwrap();

        // Source removed outside the app (dangling symlink) — no mutation
        // performed by verify itself; the fixture-side removal simulates the
        // "moved/removed source" scenario (US4 AS2).
        std::fs::remove_file(&source_file).unwrap();
        let before_dest_exists = dest_file.symlink_metadata().is_ok();

        let resp = verify_source_view(db.pool(), "view2").await.unwrap();
        assert!(!resp.clean);
        assert_eq!(resp.broken_items.len(), 1);
        assert_eq!(resp.broken_items[0].inventory_item_id, "frame1");
        assert_eq!(resp.broken_items[0].state, BrokenItemState::UnresolvedLink);

        // No filesystem mutation: the dangling symlink itself is untouched.
        assert_eq!(dest_file.symlink_metadata().is_ok(), before_dest_exists);
    }

    #[tokio::test]
    async fn removed_file_record_row_is_reported_as_moved() {
        let db = setup().await;
        let dir = tempfile::tempdir().unwrap();
        let dest_dir = dir.path().join("dest");
        std::fs::create_dir_all(&dest_dir).unwrap();
        let dest_file = dest_dir.join("gone.fits");
        std::fs::write(&dest_file, b"x").unwrap();

        insert_project(&db, "p1", dir.path().join("proj").to_str().unwrap()).await;

        views_repo::insert_view(
            db.pool(),
            &views_repo::InsertPreparedSourceView {
                id: "view3",
                project_id: "p1",
                kind: "hardlink",
            },
        )
        .await
        .unwrap();
        views_repo::insert_view_item(
            db.pool(),
            &views_repo::InsertPreparedSourceViewItem {
                id: "item3",
                view_id: "view3",
                inventory_item_id: "no-such-frame",
                view_relative_path: dest_file.to_str().unwrap(),
                materialization: "hardlink",
            },
        )
        .await
        .unwrap();

        let resp = verify_source_view(db.pool(), "view3").await.unwrap();
        assert!(!resp.clean);
        assert_eq!(resp.broken_items[0].state, BrokenItemState::Moved);
    }
}
