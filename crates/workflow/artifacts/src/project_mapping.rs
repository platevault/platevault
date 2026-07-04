//! Path → project attribution (spec 012, package WP-012-A).
//!
//! The retired global artifact watcher (spec 033 T028, removed by #400 in
//! favour of per-project watchers) observed entire registered library roots
//! and stored the *root's* id as `project_id` (see `watcher.rs` history) —
//! a placeholder that never matched a real project, so watcher-detected
//! artifacts were recorded under an id that `artifact.list` and the UI never
//! queried. Rows written by that watcher still exist in the wild, and any
//! caller that only has a path (not an already-known project) needs the same
//! resolution.
//!
//! This module is pure (no filesystem or DB access): it takes a candidate
//! artifact path and a list of project root paths and returns the id of the
//! project whose root is the longest (most specific / deepest nested)
//! matching prefix. Callers are responsible for supplying paths in a
//! comparable form (e.g. both canonicalized, or both raw) — see
//! `app_core::artifact::resolve_project_id_for_path` for the DB-backed
//! wrapper used by the startup re-attribution fix-up.

use std::path::{Component, Path, PathBuf};

/// A minimal (id, root path) view of a project needed for path attribution.
#[derive(Clone, Debug)]
pub struct ProjectPathRef {
    pub id: String,
    pub path: String,
}

/// Lexically normalize a path string: unify separators to `/` and collapse
/// `.` / `..` components without touching the filesystem (no `canonicalize`
/// — this module never does I/O).
fn lexical_normalize(path: &str) -> PathBuf {
    let unified = path.replace('\\', "/");
    let mut out = PathBuf::new();
    for component in Path::new(&unified).components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Component-wise, case-insensitive prefix check. Cross-platform safety net
/// (Constitution / product constraints on case sensitivity): a project root
/// registered with one case and an artifact path reported by the OS with
/// different case (common on Windows/macOS default filesystems) must still
/// resolve, without false-positives from naive string prefixing (e.g.
/// `/lib/Project` must NOT match `/lib/ProjectX`).
fn starts_with_ci(child: &Path, root: &Path) -> bool {
    let mut child_components = child.components();
    for root_component in root.components() {
        let Some(child_component) = child_components.next() else {
            return false;
        };
        let root_lower = root_component.as_os_str().to_string_lossy().to_lowercase();
        let child_lower = child_component.as_os_str().to_string_lossy().to_lowercase();
        if root_lower != child_lower {
            return false;
        }
    }
    true
}

/// Resolve which project (if any) owns `artifact_path`, choosing the
/// longest-prefix (most deeply nested) match among all candidate project
/// root paths.
///
/// Returns `None` when no project's root contains the path — callers MUST
/// NOT fabricate an id in that case (see the spec 012 WP-012-A fix notes on
/// `app_core::artifact::detect`).
#[must_use]
pub fn resolve_project_for_path(
    artifact_path: &str,
    projects: &[ProjectPathRef],
) -> Option<String> {
    let artifact_norm = lexical_normalize(artifact_path);

    let mut best: Option<(usize, &str)> = None;
    for project in projects {
        if project.path.trim().is_empty() {
            continue;
        }
        let root_norm = lexical_normalize(&project.path);
        let depth = root_norm.components().count();
        if depth == 0 {
            continue;
        }
        let is_match =
            artifact_norm.starts_with(&root_norm) || starts_with_ci(&artifact_norm, &root_norm);
        if !is_match {
            continue;
        }
        if best.is_none_or(|(best_depth, _)| depth > best_depth) {
            best = Some((depth, project.id.as_str()));
        }
    }
    best.map(|(_, id)| id.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(id: &str, path: &str) -> ProjectPathRef {
        ProjectPathRef { id: id.to_owned(), path: path.to_owned() }
    }

    #[test]
    fn matches_single_project() {
        let projects = vec![proj("p1", "/mnt/library/root/projects/M31")];
        let result = resolve_project_for_path(
            "/mnt/library/root/projects/M31/output/MasterDark.xisf",
            &projects,
        );
        assert_eq!(result, Some("p1".to_owned()));
    }

    #[test]
    fn root_with_multiple_projects_picks_the_owning_one() {
        let projects = vec![
            proj("p1", "/mnt/library/root/projects/M31"),
            proj("p2", "/mnt/library/root/projects/NGC7000"),
        ];
        let result = resolve_project_for_path(
            "/mnt/library/root/projects/NGC7000/output/final.tif",
            &projects,
        );
        assert_eq!(result, Some("p2".to_owned()));
    }

    #[test]
    fn nested_projects_pick_longest_prefix() {
        // A project nested inside another project's folder tree must win
        // over the shallower ancestor project.
        let projects = vec![
            proj("outer", "/mnt/library/root/projects"),
            proj("inner", "/mnt/library/root/projects/M31/sub-project"),
        ];
        let result = resolve_project_for_path(
            "/mnt/library/root/projects/M31/sub-project/output/final.tif",
            &projects,
        );
        assert_eq!(result, Some("inner".to_owned()));
    }

    #[test]
    fn no_match_returns_none() {
        let projects = vec![proj("p1", "/mnt/library/root/projects/M31")];
        let result =
            resolve_project_for_path("/mnt/library/root/inbox/unsorted/random.fits", &projects);
        assert!(result.is_none());
    }

    #[test]
    fn empty_project_list_returns_none() {
        let result = resolve_project_for_path("/mnt/library/root/anything.fits", &[]);
        assert!(result.is_none());
    }

    #[test]
    fn case_insensitive_fallback_matches_windows_style_drift() {
        let projects = vec![proj("p1", "D:/Astro/Projects/M31")];
        let result =
            resolve_project_for_path("d:/astro/projects/m31/output/MasterFlat.xisf", &projects);
        assert_eq!(result, Some("p1".to_owned()));
    }

    #[test]
    fn case_insensitive_fallback_respects_component_boundary() {
        // "Project" must not prefix-match "ProjectX" just because the
        // lowercased strings share a prefix — component-wise comparison
        // must not collapse to raw string starts_with.
        let projects = vec![proj("p1", "/mnt/library/root/Project")];
        let result =
            resolve_project_for_path("/mnt/library/root/ProjectX/output/final.tif", &projects);
        assert!(result.is_none());
    }

    #[test]
    fn mixed_separators_are_normalized() {
        let projects = vec![proj("p1", r"D:\Astro\Projects\M31")];
        let result = resolve_project_for_path(r"D:\Astro\Projects\M31\output\final.tif", &projects);
        assert_eq!(result, Some("p1".to_owned()));
    }

    #[test]
    fn dotdot_traversal_in_artifact_path_is_normalized_before_matching() {
        let projects = vec![proj("p1", "/mnt/library/root/projects/M31")];
        let result = resolve_project_for_path(
            "/mnt/library/root/projects/other/../M31/output/final.tif",
            &projects,
        );
        assert_eq!(result, Some("p1".to_owned()));
    }
}
