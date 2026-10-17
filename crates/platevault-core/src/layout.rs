// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 Project folder layout (spec 069 PREP-FR-06/16/19, D-W98 to D-W100,
//! D-W108, D-W114): pure paths, no filesystem access.
//!
//! The Project folder is `<Processing location>/<Project>/` with `View/`,
//! `Processing/<Tool>/` and `Output/`. Apply builds `View (building)/` beside
//! `View/` and keeps the replaced View as `View (previous)/` until it is
//! empty. Folder tokens keep only what WBPP reads in a keyword value, and
//! every generated folder and entry name fits one path component of the
//! platform, shortened with a deterministic suffix when it would not.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{GroupKeywords, GroupName, LibraryError};

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

/// [`token`] that always ends with the suffix from `raw`'s digest: the
/// deterministic name of a value whose plain token another value took.
///
/// # Errors
/// As [`token`].
pub(crate) fn token_suffixed(label: &str, raw: &str, limit: usize) -> Result<String, LibraryError> {
    let suffix = digest_suffix(raw);
    let plain = token(label, raw, limit)?;
    let room = limit.saturating_sub(component_len(&suffix));
    Ok(capped(&plain, room, "") + &suffix)
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

/// One folder name from a Project name: exactly one safe path segment.
///
/// # Errors
/// `InvalidInput` naming `label` when nothing usable remains or the text is a
/// traversal, a reserved device name or confusable.
pub fn segment(label: &str, raw: &str) -> Result<String, LibraryError> {
    safe_filename::sanitize_token_value(label, raw).map_err(|error| {
        LibraryError::InvalidInput(format!("the {label} name '{raw}' is no folder name: {error}"))
    })
}

/// Whether `path` is `folder` or lies below it, compared by components.
#[must_use]
pub fn inside(path: &Path, folder: &Path) -> bool {
    path.starts_with(folder)
}
