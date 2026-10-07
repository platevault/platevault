// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `SubframeSelector` CSV exports (spec 067, research R16-R18): preamble,
//! table layout, column classification and row matching. Pure: no I/O.
//!
//! The preamble is read line by line by key, and each row's File field is
//! cut between the fields around it, because `ExportCSV()` quotes paths and
//! expressions without escaping. Values keep the units the export declares
//! and are never converted.

use std::collections::{HashMap, HashSet};

use platevault_model::{
    reasons, ColumnClass, ExportLayout, ImportBasis, ImportCandidate, ImportCell, ImportColumn,
    ImportRow, LibraryError, NativePath, PreambleEntry, RowMatch, Units,
};
use uuid::Uuid;

/// The largest export read.
pub const MAX_EXPORT_BYTES: usize = 16 << 20;

/// `PixInsight` 1.9.x (module 1.8.3 and later).
const COLUMNS_30: [&str; 30] = [
    "Index",
    "Approved",
    "Locked",
    "File",
    "Weight",
    "PSF Signal Weight",
    "PSF SNR",
    "PSF Scale",
    "PSF Scale SNR",
    "PSF Count",
    "M*",
    "N*",
    "SNR",
    "FWHM",
    "Eccentricity",
    "Altitude",
    "Azimuth",
    "Median",
    "Median Mean Deviation",
    "Noise",
    "Noise Ratio",
    "Stars",
    "Star Residual",
    "PSF Total Flux",
    "PSF Total Power Flux",
    "PSF Total Mean Flux",
    "PSF Total Mean Power Flux",
    "FWHM Mean Deviation",
    "Eccentricity Mean Deviation",
    "Star Residual Mean Deviation",
];

/// `PixInsight` 1.8.9 (module 1.8.0): the 30 columns without PSF Scale and
/// PSF Scale SNR.
const COLUMNS_28: [&str; 28] = [
    "Index",
    "Approved",
    "Locked",
    "File",
    "Weight",
    "PSF Signal Weight",
    "PSF SNR",
    "PSF Count",
    "M*",
    "N*",
    "SNR",
    "FWHM",
    "Eccentricity",
    "Altitude",
    "Azimuth",
    "Median",
    "Median Mean Deviation",
    "Noise",
    "Noise Ratio",
    "Stars",
    "Star Residual",
    "PSF Total Flux",
    "PSF Total Power Flux",
    "PSF Total Mean Flux",
    "PSF Total Mean Power Flux",
    "FWHM Mean Deviation",
    "Eccentricity Mean Deviation",
    "Star Residual Mean Deviation",
];

/// `PixInsight` 1.8.8-12 (module 1.7.3).
const COLUMNS_23: [&str; 23] = [
    "Index",
    "Approved",
    "Locked",
    "File",
    "Weight",
    "SNR Weight",
    "PSF Signal Weight",
    "PSF Signal Power Weight",
    "PSF Flux",
    "PSF Flux Power",
    "FWHM",
    "Eccentricity",
    "Altitude",
    "Azimuth",
    "Median",
    "Median Mean Deviation",
    "Noise",
    "Noise Ratio",
    "Stars",
    "Star Residual",
    "FWHM Mean Deviation",
    "Eccentricity Mean Deviation",
    "Star Residual Mean Deviation",
];

/// Module columns the export writes without declared units.
const NO_DECLARED_UNITS: [&str; 19] = [
    "Weight",
    "PSF Signal Weight",
    "PSF SNR",
    "PSF Scale",
    "PSF Scale SNR",
    "PSF Total Flux",
    "PSF Total Power Flux",
    "PSF Total Mean Flux",
    "PSF Total Mean Power Flux",
    "M*",
    "N*",
    "SNR",
    "Noise Ratio",
    "Star Residual",
    "Star Residual Mean Deviation",
    "SNR Weight",
    "PSF Signal Power Weight",
    "PSF Flux",
    "PSF Flux Power",
];

const MODULE_VERSION: &str = " module version ";

/// A parsed export: the preamble as recorded, the layout, every column with
/// its class and units, and every data row in file order.
#[derive(Clone, Debug, PartialEq)]
pub struct SubframeExport {
    /// The version after `module version` on the first line.
    pub module_version: Option<String>,
    /// The `PSF Type` row as written.
    pub psf_type: Option<String>,
    /// Every keyed preamble row in file order, values without their outer quotes.
    pub preamble: Vec<PreambleEntry>,
    pub layout: ExportLayout,
    pub columns: Vec<ImportColumn>,
    pub rows: Vec<ExportRow>,
}

/// One data row; `index` is `None` for a row that does not parse.
#[derive(Clone, Debug, PartialEq)]
pub struct ExportRow {
    /// 1-based line in the file.
    pub line: u64,
    pub index: Option<u64>,
    /// The File field as written, without its outer quotes.
    pub file: String,
    /// Cells of the mapped columns only.
    pub values: Vec<ImportCell>,
    /// Why the row does not parse.
    pub reason: Option<String>,
}

/// Parse a `SubframeSelector` export.
///
/// # Errors
/// `UnsupportedFormat` for an export larger than 16 MiB, text that is not
/// UTF-8, a table without Index or File columns or a header that matches no
/// 30-, 28- or 23-column layout.
pub fn parse(bytes: &[u8]) -> Result<SubframeExport, LibraryError> {
    let unsupported = |message: &str| LibraryError::UnsupportedFormat(message.into());
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err(unsupported("a SubframeSelector export is at most 16 MiB"));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| unsupported("a SubframeSelector export is UTF-8 text"))?;
    let lines: Vec<&str> =
        text.split('\n').map(|line| line.strip_suffix('\r').unwrap_or(line)).collect();
    let header_at = lines
        .iter()
        .position(|line| line.split(',').any(|field| matches!(field.trim(), "Index" | "File")))
        .ok_or_else(|| unsupported("the export has no table header with Index and File"))?;
    let headers = header_fields(lines[header_at])?;
    let position = |name: &str| headers.iter().position(|header| header == name);
    let (Some(index_at), Some(file_at)) = (position("Index"), position("File")) else {
        return Err(unsupported("the table needs both an Index and a File column"));
    };
    let layout = layout_of(&headers).ok_or_else(|| {
        unsupported("the table header matches no 30-, 28- or 23-column SubframeSelector layout")
    })?;
    let (module_version, preamble) = read_preamble(&lines[..header_at]);
    let keyed = Preamble(&preamble);
    let columns: Vec<ImportColumn> = (0_u32..)
        .zip(&headers)
        .map(|(position, header)| classify(header, position, &keyed))
        .collect();
    let mapped: Vec<u32> = columns
        .iter()
        .filter(|column| column.class == ColumnClass::Mapped)
        .map(|column| column.position)
        .collect();
    let shape = RowShape { fields: headers.len(), index_at, file_at, mapped: &mapped };
    let rows = (1_u64..)
        .zip(&lines)
        .skip(header_at + 1)
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(line, text)| shape.parse(line, text))
        .collect();
    Ok(SubframeExport {
        module_version,
        psf_type: keyed.value("PSF Type").map(str::to_owned),
        preamble,
        layout,
        columns,
        rows,
    })
}

/// Match each row against non-Retired scope candidates (R18): an exact
/// native path, with `/` read as the separator for Windows paths, then a
/// unique exact basename. Several candidates, or two rows on one asset, make
/// a row ambiguous. No case folding, normalization or suffix stripping.
#[must_use]
pub fn match_rows(export: &SubframeExport, candidates: &[ImportCandidate]) -> Vec<ImportRow> {
    let mut rows: Vec<ImportRow> =
        export.rows.iter().map(|row| first_match(row, candidates)).collect();
    let mut attached: HashMap<Uuid, usize> = HashMap::new();
    for asset in rows.iter().filter_map(|row| row.asset_id) {
        *attached.entry(asset).or_default() += 1;
    }
    for row in &mut rows {
        if row.asset_id.is_some_and(|asset| attached[&asset] > 1) {
            row.match_state = RowMatch::Ambiguous;
            row.reason = Some(reasons::DUPLICATE_ASSET_MATCH.to_owned());
            row.asset_id = None;
            row.basis = None;
        }
    }
    rows
}

fn header_fields(line: &str) -> Result<Vec<String>, LibraryError> {
    let mut reader =
        csv::ReaderBuilder::new().has_headers(false).flexible(true).from_reader(line.as_bytes());
    let record = reader
        .records()
        .next()
        .transpose()
        .map_err(|error| LibraryError::UnsupportedFormat(format!("table header: {error}")))?
        .unwrap_or_default();
    Ok(record.iter().map(|field| field.trim().to_owned()).collect())
}

/// The largest layout whose every column is present; other columns read
/// `unknown_column`.
fn layout_of(headers: &[String]) -> Option<ExportLayout> {
    let present: HashSet<&str> = headers.iter().map(String::as_str).collect();
    let layouts: [(ExportLayout, &[&str]); 3] = [
        (ExportLayout::Columns30, &COLUMNS_30),
        (ExportLayout::Columns28, &COLUMNS_28),
        (ExportLayout::Columns23, &COLUMNS_23),
    ];
    layouts
        .into_iter()
        .find(|(_, names)| names.iter().all(|name| present.contains(name)))
        .map(|(layout, _)| layout)
}

/// The module version line and every keyed row. A quoted value continues
/// over following lines until its closing quote, as older modules wrote
/// multi-line expressions raw.
fn read_preamble(lines: &[&str]) -> (Option<String>, Vec<PreambleEntry>) {
    let mut version = None;
    let mut entries: Vec<PreambleEntry> = Vec::new();
    let mut open = false;
    for line in lines {
        if open {
            let last = entries.last_mut().expect("an open value has an entry");
            last.value.push('\n');
            last.value.push_str(line);
            open = !line.ends_with('"');
            if !open {
                last.value = unquote(&last.value).to_owned();
            }
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        match line.split_once(',') {
            None if version.is_none() && line.contains(MODULE_VERSION) => {
                version = line.split_once(MODULE_VERSION).map(|(_, text)| text.trim().to_owned());
            }
            None => {
                entries.push(PreambleEntry { key: line.trim().to_owned(), value: String::new() });
            }
            Some((key, value)) => {
                open = value.starts_with('"') && (value.len() == 1 || !value.ends_with('"'));
                let value = if open { value.to_owned() } else { unquote(value).to_owned() };
                entries.push(PreambleEntry { key: key.trim().to_owned(), value });
            }
        }
    }
    (version, entries)
}

fn unquote(value: &str) -> &str {
    value.strip_prefix('"').and_then(|inner| inner.strip_suffix('"')).unwrap_or(value)
}

struct Preamble<'a>(&'a [PreambleEntry]);

impl<'a> Preamble<'a> {
    fn entry(&self, key: &str) -> Option<&'a PreambleEntry> {
        self.0.iter().find(|entry| entry.key == key)
    }

    fn value(&self, key: &str) -> Option<&'a str> {
        self.entry(key).map(|entry| entry.value.as_str())
    }
}

fn classify(header: &str, position: u32, preamble: &Preamble<'_>) -> ImportColumn {
    let mut column = ImportColumn {
        header: header.to_owned(),
        position,
        class: ColumnClass::Unavailable,
        units: None,
        units_basis: Vec::new(),
        reason: None,
        warnings: Vec::new(),
    };
    let reason = match header {
        "Index" | "File" => {
            column.class = ColumnClass::Identity;
            None
        }
        "Approved" | "Locked" => {
            column.class = ColumnClass::Excluded;
            Some(reasons::DECISION_NOT_IMPORTED)
        }
        "FWHM" | "FWHM Mean Deviation" => scale_units(&mut column, preamble),
        "Median" | "Median Mean Deviation" | "Noise" => data_units(&mut column, preamble),
        "Eccentricity" | "Eccentricity Mean Deviation" => {
            if let Some(circular) = preamble.entry("Circular PSF").filter(|e| e.value == "true") {
                column.units_basis.push(circular.clone());
                Some(reasons::CIRCULAR_PSF)
            } else {
                mapped(&mut column, Units::Dimensionless)
            }
        }
        "Stars" | "PSF Count" => mapped(&mut column, Units::Count),
        "Altitude" | "Azimuth" => Some(reasons::NOT_SUPPORTED),
        name if NO_DECLARED_UNITS.contains(&name) => Some(reasons::NO_DECLARED_UNITS),
        _ => Some(reasons::UNKNOWN_COLUMN),
    };
    column.reason = reason.map(str::to_owned);
    column
}

const fn mapped(column: &mut ImportColumn, units: Units) -> Option<&'static str> {
    column.class = ColumnClass::Mapped;
    column.units = Some(units);
    None
}

/// FWHM units from `Scale Unit`, recorded with `Subframe Scale`; a scale of
/// exactly 1 with arcsec units warns `default_subframe_scale`.
fn scale_units(column: &mut ImportColumn, preamble: &Preamble<'_>) -> Option<&'static str> {
    let Some(unit) = preamble.entry("Scale Unit") else {
        return Some(reasons::MISSING_UNITS);
    };
    let units = if unit.value.contains("(arcsec)") {
        Units::Arcsec
    } else if unit.value.contains("(pixel)") {
        Units::Px
    } else {
        return Some(reasons::MISSING_UNITS);
    };
    column.units_basis.push(unit.clone());
    if units == Units::Arcsec {
        if let Some(scale) = preamble.entry("Subframe Scale") {
            column.units_basis.push(scale.clone());
            // Exactly 1: the module's default scale, not a measured plate scale.
            if scale
                .value
                .trim()
                .parse::<f64>()
                .is_ok_and(|value| value.to_bits() == 1_f64.to_bits())
            {
                column.warnings.push(reasons::DEFAULT_SUBFRAME_SCALE.to_owned());
            }
        }
    }
    mapped(column, units)
}

/// Median and Noise units from `Data Unit`, recorded with the gain or
/// resolution row the module converted with.
fn data_units(column: &mut ImportColumn, preamble: &Preamble<'_>) -> Option<&'static str> {
    let Some(unit) = preamble.entry("Data Unit") else {
        return Some(reasons::MISSING_UNITS);
    };
    let (units, conversion) = if unit.value.contains("(e-)") {
        (Units::Electrons, Some("Camera Gain"))
    } else if unit.value.contains("(DN)") {
        (Units::Dn, None)
    } else if unit.value.starts_with("Normalized") {
        (Units::Normalized, Some("Camera Resolution"))
    } else {
        return Some(reasons::MISSING_UNITS);
    };
    column.units_basis.push(unit.clone());
    if let Some(row) = conversion.and_then(|key| preamble.entry(key)) {
        column.units_basis.push(row.clone());
    }
    mapped(column, units)
}

/// Where a row's fields are: every field but File is free of commas, so File
/// is what lies between the fields before and after it.
struct RowShape<'a> {
    fields: usize,
    index_at: usize,
    file_at: usize,
    mapped: &'a [u32],
}

impl RowShape<'_> {
    fn parse(&self, line: u64, text: &str) -> ExportRow {
        let unparsed = |reason: String| ExportRow {
            line,
            index: None,
            file: String::new(),
            values: Vec::new(),
            reason: Some(reason),
        };
        let Some(fields) = self.split(text) else {
            return unparsed(format!("the row does not have the header's {} fields", self.fields));
        };
        let Ok(index) = fields[self.index_at].trim().parse::<u64>() else {
            return unparsed(format!("Index {:?} is not a whole number", fields[self.index_at]));
        };
        let values = self
            .mapped
            .iter()
            .map(|&position| {
                let raw = fields[position as usize].trim();
                let (value, reason) = if raw.is_empty() {
                    (None, Some(reasons::EMPTY_VALUE))
                } else {
                    match raw.parse::<f64>() {
                        Ok(value) if value.is_finite() => (Some(value), None),
                        _ => (None, Some(reasons::UNPARSED_VALUE)),
                    }
                };
                ImportCell {
                    position,
                    raw: raw.to_owned(),
                    value,
                    reason: reason.map(str::to_owned),
                }
            })
            .collect();
        ExportRow {
            line,
            index: Some(index),
            file: unquote(fields[self.file_at]).to_owned(),
            values,
            reason: None,
        }
    }

    fn split<'t>(&self, text: &'t str) -> Option<Vec<&'t str>> {
        let after = self.fields - self.file_at - 1;
        let mut leading = text.splitn(self.file_at + 1, ',');
        let mut fields: Vec<&str> = leading.by_ref().take(self.file_at).collect();
        let rest = leading.next()?;
        if fields.len() != self.file_at {
            return None;
        }
        let mut trailing: Vec<&str> = rest.rsplitn(after + 1, ',').collect();
        if trailing.len() != after + 1 {
            return None;
        }
        trailing.reverse();
        fields.extend(trailing);
        Some(fields)
    }
}

fn first_match(row: &ExportRow, candidates: &[ImportCandidate]) -> ImportRow {
    let mut matched = ImportRow {
        line: row.line,
        index: row.index,
        file: row.file.clone(),
        match_state: RowMatch::Unmatched,
        reason: None,
        candidates: Vec::new(),
        asset_id: None,
        basis: None,
        values: row.values.clone(),
    };
    if row.index.is_none() {
        matched.match_state = RowMatch::Unparsed;
        matched.reason.clone_from(&row.reason);
        return matched;
    }
    let by_path: Vec<&ImportCandidate> =
        candidates.iter().filter(|candidate| path_matches(&row.file, candidate)).collect();
    let basename = row.file.rsplit(['/', '\\']).next().unwrap_or(&row.file);
    let (found, state) = if by_path.is_empty() {
        let by_name = candidates
            .iter()
            .filter(|candidate| candidate.basename.as_deref() == Some(basename))
            .collect();
        (by_name, RowMatch::MatchedName)
    } else {
        (by_path, RowMatch::MatchedPath)
    };
    matched.candidates = found.iter().map(|candidate| candidate.asset_id).collect();
    match found.as_slice() {
        [] => {}
        [only] => {
            matched.match_state = state;
            matched.asset_id = Some(only.asset_id);
            matched.basis = Some(ImportBasis {
                fingerprint: only.fingerprint.clone(),
                sha256: only.sha256.clone(),
            });
        }
        _ => matched.match_state = RowMatch::Ambiguous,
    }
    matched
}

fn path_matches(file: &str, candidate: &ImportCandidate) -> bool {
    let Some(text) = candidate.path_text.as_deref() else {
        return false;
    };
    match candidate.path {
        NativePath::WindowsUtf16(_) => file.replace('/', "\\") == text,
        NativePath::UnixBytes(_) => file == text,
    }
}
