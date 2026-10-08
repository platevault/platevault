// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Preparation folder layout (spec 069 PREP-FR-06/07, D-W51, D-W67): pure
//! paths, no filesystem access.
//!
//! A run's first preparation revision goes to `<output>/<Project>/<Run>/`,
//! each later one to `<Run> (rev N)/` beside it, and every revision shares the
//! sibling `<Run> Results/` folder, outside every prepared folder, so the
//! application never reads its own output as input. A folder name the user
//! chose for the first revision names its Results folder too. An override
//! parent keeps the `<Project>/` level.

use std::path::Path;

use crate::{LibraryError, NativePath, RunLocation};

/// One folder name from a Project, run or user-entered label: exactly one
/// safe path segment.
///
/// # Errors
/// `InvalidInput` naming `label` when nothing usable remains or the text is a
/// traversal, a reserved device name or confusable.
pub fn segment(label: &str, raw: &str) -> Result<String, LibraryError> {
    safe_filename::sanitize_token_value(label, raw).map_err(|error| {
        LibraryError::InvalidInput(format!("the {label} name '{raw}' is no folder name: {error}"))
    })
}

/// The folder name of revision `n` of a run named `run`: `<Run>` for the
/// first, `<Run> (rev N)` after it.
#[must_use]
pub fn revision_folder_name(run: &str, n: u32) -> String {
    if n <= 1 {
        run.to_owned()
    } else {
        format!("{run} (rev {n})")
    }
}

/// The Results folder name a run shares across its revisions.
#[must_use]
pub fn results_folder_name(run: &str) -> String {
    format!("{run} Results")
}

/// Where revision `n` of run `run` in Project `project` goes under `output`.
/// `folder_name` replaces the proposed `<Run>` or `<Run> (rev N)` name when
/// the user chose another; `results` is the run's recorded Results folder,
/// which every later revision keeps. Without one, the Results folder takes
/// the prepared folder's chosen name, `<folder_name> Results`, so another
/// name also resolves a Results folder collision.
///
/// # Errors
/// `InvalidInput` for a name [`segment`] refuses, a relative `output`, or a
/// prepared folder that would be the Results folder or hold it.
pub fn run_location(
    output: &Path,
    project: &str,
    run: &str,
    n: u32,
    folder_name: Option<&str>,
    results: Option<&NativePath>,
) -> Result<RunLocation, LibraryError> {
    if !output.is_absolute() {
        return Err(LibraryError::InvalidInput(format!(
            "the parent folder {} is not an absolute path",
            output.display()
        )));
    }
    let project_dir = output.join(segment("Project", project)?);
    let run = segment("run", run)?;
    let name = match folder_name {
        Some(name) => segment("folder", name)?,
        None => revision_folder_name(&run, n),
    };
    let folder = project_dir.join(&name);
    let results = if let Some(recorded) = results {
        recorded.to_path_buf()?
    } else {
        let base = if folder_name.is_some() { name.as_str() } else { run.as_str() };
        project_dir.join(results_folder_name(base))
    };
    if inside(&results, &folder) || inside(&folder, &results) {
        return Err(LibraryError::InvalidInput(format!(
            "{} cannot be both a prepared folder and the Results folder {}",
            folder.display(),
            results.display()
        )));
    }
    Ok(RunLocation {
        output: NativePath::from_path(output),
        folder: NativePath::from_path(&folder),
        results: NativePath::from_path(&results),
    })
}

/// Whether `path` is `folder` or lies below it, compared by components.
#[must_use]
pub fn inside(path: &Path, folder: &Path) -> bool {
    path.starts_with(folder)
}
