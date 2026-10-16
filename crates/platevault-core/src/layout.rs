// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Preparation folder layout (spec 069 PREP-FR-06/07/12/13, D-W51, D-W67,
//! D-W73): pure paths, no filesystem access.
//!
//! A run's first preparation revision goes to `<output>/<Project>/<Run>/`,
//! each later one to `<Run> (rev N)/` beside it, and every revision shares the
//! sibling `<Run> Results/` folder, outside every prepared folder, so the
//! application never reads its own output as input. A folder name the user
//! chose for the first revision names its Results folder too. An override
//! parent keeps the `<Project>/` level.
//!
//! A run group's first Prepare all goes to `<output>/<Project>/<Mosaic>/`,
//! each later one to `<Mosaic> (rev N)/`, each holding only one `Panel N/`
//! folder per panel run. Each panel run's Results go to
//! `<Mosaic> Results/Panel N/` and the assembled mosaic to
//! `<Mosaic> Results/Assembled/`, outside every group folder, and every group
//! revision keeps them. A group folder name the user chose for the first
//! Prepare all names that Results folder too.
//!
//! The F4 Project folder (spec 069 PREP-FR-06/16/19, D-W98 to D-W100,
//! D-W108, D-W114) is `<Processing location>/<Project>/` with `View/`,
//! `Processing/<Tool>/` and `Output/`. Apply builds `View (building)/` beside
//! `View/` and keeps the replaced View as `View (previous)/` until it is
//! empty. Folder tokens keep only what WBPP reads in a keyword value, and
//! every generated folder and entry name fits one path component of the
//! platform, shortened with a deterministic suffix when it would not.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{
    GroupKeywords, GroupLocation, GroupName, LibraryError, NativePath, PanelLocation, RunLocation,
};

/// The inputs Apply places.
pub const VIEW_FOLDER: &str = "View";
/// The View Apply is building, beside `View/`.
pub const VIEW_BUILDING_FOLDER: &str = "View (building)";
/// The View an Apply replaced, until everything it holds is retired.
pub const VIEW_PREVIOUS_FOLDER: &str = "View (previous)";
/// Each tool's working and output folder, `Processing/<Tool>/`.
pub const PROCESSING_FOLDER: &str = "Processing";
/// The Project's Results; tools never write here.
pub const OUTPUT_FOLDER: &str = "Output";

/// The longest name of one path component: 255 bytes on Linux and macOS,
/// 255 UTF-16 units on Windows.
pub const COMPONENT_LIMIT: usize = 255;

/// The length of `name` as the platform measures one path component.
#[must_use]
pub fn component_len(name: &str) -> usize {
    if cfg!(windows) {
        name.encode_utf16().count()
    } else {
        name.len()
    }
}

/// `<parent>/<Project>/`, the Project folder Apply, Copy to Output and Wrap
/// up work in.
///
/// # Errors
/// `InvalidInput` for a relative `parent` or a Project name [`segment`]
/// refuses.
pub fn project_folder(parent: &Path, project: &str) -> Result<PathBuf, LibraryError> {
    if !parent.is_absolute() {
        return Err(LibraryError::InvalidInput(format!(
            "the processing location {} is not an absolute path",
            parent.display()
        )));
    }
    Ok(parent.join(segment("Project", project)?))
}

/// A group name's folder token (decision record §2 and §8): spaces become
/// hyphens, and only what WBPP accepts in a keyword value stays: ASCII
/// letters and digits and `- ( ) .`, with accents dropped from their
/// letters. An underscore would end the WBPP value and Windows refuses `:`,
/// so both become hyphens. Runs of hyphens collapse, and leading or trailing
/// hyphens and dots go. A token too long for one path component keeps its
/// start and ends with a suffix taken from the name's digest.
///
/// # Errors
/// `InvalidInput` when nothing usable remains or the token is a Windows
/// device name.
pub fn folder_token(name: &GroupName) -> Result<String, LibraryError> {
    token("group", name.as_str(), COMPONENT_LIMIT)
}

/// A group's folder, `GROUP_<token>` or, for a mosaic panel, `PANEL_<token>`
/// with the Project's keyword names (PREP-FR-16). The View has group folders
/// only when the Project has several groups.
///
/// # Errors
/// As [`folder_token`].
pub fn group_folder(
    keywords: &GroupKeywords,
    name: &GroupName,
    panel: bool,
) -> Result<String, LibraryError> {
    let keyword = if panel { keywords.panel() } else { keywords.group() };
    let prefix = format!("{}_", keyword.as_str());
    let token = token("group", name.as_str(), COMPONENT_LIMIT - component_len(&prefix))?;
    Ok(prefix + &token)
}

/// The WBPP-safe token of `raw` within `limit`, named `label` in errors.
pub(crate) fn token(label: &str, raw: &str, limit: usize) -> Result<String, LibraryError> {
    let cleaned = safe_filename::step1_normalize_and_strip(raw);
    let mut token = String::with_capacity(cleaned.len());
    for c in cleaned.nfkd() {
        let mapped = match c {
            c if c.is_ascii_alphanumeric() || matches!(c, '(' | ')' | '.') => c,
            c if c.is_whitespace() || matches!(c, '-' | '_' | ':') => '-',
            _ => continue,
        };
        if !(mapped == '-' && token.ends_with('-')) {
            token.push(mapped);
        }
    }
    let token = token.trim_matches(|c| c == '-' || c == '.');
    if token.is_empty() {
        return Err(LibraryError::InvalidInput(format!(
            "the {label} name '{raw}' leaves no folder name"
        )));
    }
    safe_filename::step4_reserved_name_check(token).map_err(|error| {
        LibraryError::InvalidInput(format!("the {label} name '{raw}' is no folder name: {error}"))
    })?;
    Ok(capped(token, limit, &digest_suffix(raw)))
}

/// `-` and the first eight hex digits of `text`'s SHA-256.
fn digest_suffix(text: &str) -> String {
    format!("-{}", &hex::encode(Sha256::digest(text.as_bytes()))[..8])
}

/// `name` when it fits `limit`, else its start, without a trailing hyphen
/// or dot, followed by `suffix`. Cuts fall on character boundaries.
fn capped(name: &str, limit: usize, suffix: &str) -> String {
    if component_len(name) <= limit {
        return name.to_owned();
    }
    let room = limit.saturating_sub(component_len(suffix));
    let (mut used, mut end) = (0, 0);
    for (at, c) in name.char_indices() {
        let width = if cfg!(windows) { c.len_utf16() } else { c.len_utf8() };
        if used + width > room {
            break;
        }
        used += width;
        end = at + c.len_utf8();
    }
    format!("{}{suffix}", name[..end].trim_end_matches(['-', '.']))
}

/// One entry's basename for life (PREP-FR-19, D-W114): the source's own
/// name while no other input of the Project holds it, compared without case
/// as the case-insensitive volumes do, else `<stem>-<id>.<ext>` with the
/// first 8 hex digits of the input's id, extended one digit at a time while
/// that is taken too. A name too long for one path component keeps its
/// extension, shortens its stem and always takes the id suffix.
#[must_use]
pub fn entry_basename(source: &str, id: Uuid, taken: impl Fn(&str) -> bool) -> String {
    let source = source.trim_matches(|c: char| c.is_whitespace() || c == '.');
    let source = if source.is_empty() { "entry" } else { source };
    if component_len(source) <= COMPONENT_LIMIT && !taken(source) {
        return source.to_owned();
    }
    let (stem, extension) = match source.rsplit_once('.') {
        Some((stem, extension))
            if !stem.is_empty() && component_len(extension) + 1 < COMPONENT_LIMIT / 2 =>
        {
            (stem, format!(".{extension}"))
        }
        _ => (source, String::new()),
    };
    let id = id.simple().to_string();
    let mut digits = 8;
    loop {
        let suffix = format!("-{}{extension}", &id[..digits]);
        let name = capped(stem, COMPONENT_LIMIT - component_len(&suffix), "") + &suffix;
        if digits == id.len() || !taken(&name) {
            return name;
        }
        digits += 1;
    }
}

/// The key two names of one folder are compared by: NFC and lowercase, as
/// the case-insensitive volumes of macOS and Windows compare them.
#[must_use]
pub fn name_key(name: &str) -> String {
    name.nfc().collect::<String>().to_lowercase()
}

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
    let (project_dir, base, folder) = revision_folder(output, project, "run", run, n, folder_name)?;
    let results = match results {
        Some(recorded) => recorded.to_path_buf()?,
        None => project_dir.join(results_folder_name(&base)),
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
/// kept; one recorded now lies in `<folder_name> Results/` when the user
/// chose a group folder name, as for a run.
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
    let (project_dir, base, folder) =
        revision_folder(output, project, "run group", mosaic, n, folder_name)?;
    let results_dir = project_dir.join(results_folder_name(&base));
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

/// The Project folder, the `<Name>` a Results folder recorded now takes and
/// the folder of revision `n` under `output`: `<Name>`, `<Name> (rev N)`, or
/// the user's `folder_name`, which then names the Results folder too, so
/// another name also resolves a Results folder collision.
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
    if let Some(chosen) = folder_name {
        let chosen = segment("folder", chosen)?;
        let folder = project_dir.join(&chosen);
        return Ok((project_dir, chosen, folder));
    }
    let folder = project_dir.join(revision_folder_name(&name, n));
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
