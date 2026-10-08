// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Preparation folder layout (spec 069 PREP-FR-06/07/12/13, D-W51, D-W67,
//! D-W73): pure paths, no filesystem access.
//!
//! A run's first preparation revision goes to `<output>/<Project>/<Run>/`,
//! each later one to `<Run> (rev N)/` beside it, and every revision shares the
//! sibling `<Run> Results/` folder, outside every prepared folder, so the
//! application never reads its own output as input. An override parent keeps
//! the `<Project>/` level.
//!
//! A run group's first Prepare all goes to `<output>/<Project>/<Mosaic>/`,
//! each later one to `<Mosaic> (rev N)/`, each holding only one `Panel N/`
//! folder per panel run. Each panel run's Results go to
//! `<Mosaic> Results/Panel N/` and the assembled mosaic to
//! `<Mosaic> Results/Assembled/`, outside every group folder, and every group
//! revision keeps them.

use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::{GroupLocation, LibraryError, NativePath, PanelLocation, RunLocation};

/// The folder of the group Result, the assembled mosaic, in
/// `<Mosaic> Results/`.
pub const ASSEMBLED_FOLDER: &str = "Assembled";

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
/// which every later revision keeps.
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
    let (project_dir, run, folder) = revision_folder(output, project, "run", run, n, folder_name)?;
    let results = match results {
        Some(recorded) => recorded.to_path_buf()?,
        None => project_dir.join(results_folder_name(&run)),
    };
    apart(&folder, &results)?;
    Ok(RunLocation {
        output: NativePath::from_path(output),
        folder: NativePath::from_path(&folder),
        results: NativePath::from_path(&results),
    })
}

/// The `Panel N` folder name of panel `number`, inside a group folder and
/// inside `<Mosaic> Results/`.
#[must_use]
pub fn panel_folder_name(number: u32) -> String {
    format!("Panel {number}")
}

/// One panel run as [`group_location`] places it: its panel number, its run
/// and its recorded Results folder, which every group revision keeps.
#[derive(Clone, Copy, Debug)]
pub struct PanelPaths<'a> {
    pub number: u32,
    pub view_id: Uuid,
    pub results: Option<&'a NativePath>,
}

/// Where group revision `n` of run group `mosaic` in Project `project` goes
/// under `output`: the group folder `<Mosaic>/` or `<Mosaic> (rev N)/`
/// (`folder_name` when the user chose another) with one `Panel N/` per panel
/// run, each panel run's `<Mosaic> Results/Panel N/` and the group's
/// `<Mosaic> Results/Assembled/`. A recorded Results or Assembled folder is
/// kept.
///
/// # Errors
/// `InvalidInput` for a name [`segment`] refuses, a relative `output`, or a
/// group folder that would be a Results folder, lie inside one or hold one.
pub fn group_location(
    output: &Path,
    project: &str,
    mosaic: &str,
    n: u32,
    folder_name: Option<&str>,
    panels: &[PanelPaths<'_>],
    assembled: Option<&NativePath>,
) -> Result<GroupLocation, LibraryError> {
    let (project_dir, mosaic, folder) =
        revision_folder(output, project, "run group", mosaic, n, folder_name)?;
    let results_dir = project_dir.join(results_folder_name(&mosaic));
    let mut placed = Vec::with_capacity(panels.len());
    for panel in panels {
        let results = match panel.results {
            Some(recorded) => recorded.to_path_buf()?,
            None => results_dir.join(panel_folder_name(panel.number)),
        };
        apart(&folder, &results)?;
        placed.push(PanelLocation {
            number: panel.number,
            view_id: panel.view_id,
            folder: NativePath::from_path(&folder.join(panel_folder_name(panel.number))),
            results: NativePath::from_path(&results),
        });
    }
    let assembled = match assembled {
        Some(recorded) => recorded.to_path_buf()?,
        None => results_dir.join(ASSEMBLED_FOLDER),
    };
    apart(&folder, &assembled)?;
    Ok(GroupLocation {
        output: NativePath::from_path(output),
        folder: NativePath::from_path(&folder),
        panels: placed,
        assembled: NativePath::from_path(&assembled),
    })
}

/// The Project folder, the `<Name>` segment and the folder of revision `n`
/// under `output`: `<Name>`, `<Name> (rev N)`, or the user's `folder_name`.
fn revision_folder(
    output: &Path,
    project: &str,
    label: &str,
    name: &str,
    n: u32,
    folder_name: Option<&str>,
) -> Result<(PathBuf, String, PathBuf), LibraryError> {
    if !output.is_absolute() {
        return Err(LibraryError::InvalidInput(format!(
            "the parent folder {} is not an absolute path",
            output.display()
        )));
    }
    let project_dir = output.join(segment("Project", project)?);
    let name = segment(label, name)?;
    let folder = match folder_name {
        Some(chosen) => project_dir.join(segment("folder", chosen)?),
        None => project_dir.join(revision_folder_name(&name, n)),
    };
    Ok((project_dir, name, folder))
}

/// A prepared folder never is a Results folder, holds one or lies inside one.
fn apart(folder: &Path, results: &Path) -> Result<(), LibraryError> {
    if inside(results, folder) || inside(folder, results) {
        return Err(LibraryError::InvalidInput(format!(
            "{} cannot be both a prepared folder and the Results folder {}",
            folder.display(),
            results.display()
        )));
    }
    Ok(())
}

/// Whether `path` is `folder` or lies below it, compared by components.
#[must_use]
pub fn inside(path: &Path, folder: &Path) -> bool {
    path.starts_with(folder)
}
