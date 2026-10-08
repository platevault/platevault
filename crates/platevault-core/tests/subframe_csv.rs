// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! `SubframeSelector` CSV parsing, column classification and row matching
//! (spec 067: PIX-FR-07, PIX-AC-04, PIX-AC-05; research R16-R18). The
//! layouts and the 22-line preamble follow `ExportCSV()` in PCL at
//! `aad4c99e69` (30 columns), `e587c1af` (28) and `8bfef895` (23).
#![allow(clippy::too_many_lines)]

use platevault_core::subframe_csv::{match_rows, parse, SubframeExport};
use platevault_model::{
    reasons, ColumnClass, ExportLayout, FileIdentity, ImportCandidate, ImportColumn, LibraryError,
    NativePath, ObservationFingerprint, PathSensitivity, PreambleEntry, RowMatch, Units,
    VolumeIdentity,
};
use uuid::Uuid;

const COLUMNS_30: &str = "Index,Approved,Locked,File,Weight,PSF Signal Weight,PSF SNR,PSF Scale,\
PSF Scale SNR,PSF Count,M*,N*,SNR,FWHM,Eccentricity,Altitude,Azimuth,Median,Median Mean Deviation,\
Noise,Noise Ratio,Stars,Star Residual,PSF Total Flux,PSF Total Power Flux,PSF Total Mean Flux,\
PSF Total Mean Power Flux,FWHM Mean Deviation,Eccentricity Mean Deviation,\
Star Residual Mean Deviation";
const COLUMNS_28: &str = "Index,Approved,Locked,File,Weight,PSF Signal Weight,PSF SNR,PSF Count,\
M*,N*,SNR,FWHM,Eccentricity,Altitude,Azimuth,Median,Median Mean Deviation,Noise,Noise Ratio,Stars,\
Star Residual,PSF Total Flux,PSF Total Power Flux,PSF Total Mean Flux,PSF Total Mean Power Flux,\
FWHM Mean Deviation,Eccentricity Mean Deviation,Star Residual Mean Deviation";
const COLUMNS_23: &str = "Index,Approved,Locked,File,Weight,SNR Weight,PSF Signal Weight,\
PSF Signal Power Weight,PSF Flux,PSF Flux Power,FWHM,Eccentricity,Altitude,Azimuth,Median,\
Median Mean Deviation,Noise,Noise Ratio,Stars,Star Residual,FWHM Mean Deviation,\
Eccentricity Mean Deviation,Star Residual Mean Deviation";

const APPROVAL: &str = "FWHM < 3.5 && Notes != \"bad \"seeing\"\"";

struct Preamble<'a> {
    version: &'a str,
    scale: &'a str,
    scale_unit: &'a str,
    data_unit: &'a str,
    circular: &'a str,
}

const PREAMBLE: Preamble<'static> = Preamble {
    version: "1.9.3",
    scale: "1.50000",
    scale_unit: "Arcseconds (arcsec)",
    data_unit: "Data Numbers (DN)",
    circular: "false",
};

/// The 22 preamble lines `ExportCSV()` writes before the table header.
fn preamble(p: &Preamble<'_>) -> String {
    [
        format!("SubframeSelector module version {}", p.version),
        format!("Subframe Scale,{}", p.scale),
        "Camera Gain,1.00000".into(),
        "Camera Resolution,\"16-bit [0,65535]\"".into(),
        "Site Local Midnight,24".into(),
        format!("Scale Unit,\"{}\"", p.scale_unit),
        format!("Data Unit,\"{}\"", p.data_unit),
        "Trimming Factor,0.10".into(),
        "Structure Layers,5".into(),
        "Noise Layers,0".into(),
        "Hot Pixel Filter Radius,1".into(),
        "Noise Reduction Filter Radius,0".into(),
        "Sensitivity,0.50000".into(),
        "Peak Response,0.500".into(),
        "Maximum Star Distortion,0.600".into(),
        "Upper Limit,1.000".into(),
        "Pedestal,0".into(),
        "Subframe Region,0,0,0,0".into(),
        "PSF Type,\"Moffat beta = 4\"".into(),
        format!("Circular PSF,{}", p.circular),
        format!("Approval expression,\"{APPROVAL}\""),
        "Weighting expression,\"PSFSignalWeight\"".into(),
    ]
    .join("\n")
}

/// One table row: Index, Approved, Locked, the quoted File and a numeric
/// value per remaining header, `value(header)` or `1.0000e+00`.
fn table_row(
    header: &str,
    index: u64,
    file: &str,
    approved: bool,
    value: impl Fn(&str) -> Option<String>,
) -> String {
    let mut fields = vec![
        index.to_string(),
        approved.to_string(),
        (!approved).to_string(),
        format!("\"{file}\""),
    ];
    fields.extend(
        header.split(',').skip(4).map(|name| value(name).unwrap_or_else(|| "1.0000e+00".into())),
    );
    fields.join(",")
}

fn export(preamble_text: Option<&str>, header: &str, rows: &[String]) -> Vec<u8> {
    let mut lines = Vec::new();
    if let Some(text) = preamble_text {
        lines.push(text.to_owned());
    }
    lines.push(header.to_owned());
    lines.extend(rows.iter().cloned());
    lines.push(String::new());
    lines.join("\n").into_bytes()
}

fn fwhm_value(name: &str) -> Option<String> {
    match name {
        "FWHM" => Some("2.5100e+00".into()),
        "Stars" => Some("812".into()),
        _ => None,
    }
}

fn column<'a>(parsed: &'a SubframeExport, header: &str) -> &'a ImportColumn {
    parsed
        .columns
        .iter()
        .find(|column| column.header == header)
        .unwrap_or_else(|| panic!("column {header} missing"))
}

fn entry(key: &str, value: &str) -> PreambleEntry {
    PreambleEntry { key: key.into(), value: value.into() }
}

#[test]
fn the_three_layouts_with_the_preamble_parse_and_keep_the_preamble_as_written() {
    let quoted_path = "/Volumes/Astro \"T7\"/Ha, night 1/Ha_001.fits";
    for (header, layout, count, version) in [
        (COLUMNS_30, ExportLayout::Columns30, 30, "1.9.3"),
        (COLUMNS_28, ExportLayout::Columns28, 28, "1.8.0"),
        (COLUMNS_23, ExportLayout::Columns23, 23, "1.7.3"),
    ] {
        let text = preamble(&Preamble { version, ..PREAMBLE });
        let rows = [
            table_row(header, 1, quoted_path, true, fwhm_value),
            table_row(header, 2, "C:/lights/OIII_001.fits", false, fwhm_value),
        ];
        let parsed = parse(&export(Some(&text), header, &rows)).unwrap();
        assert_eq!(parsed.layout, layout);
        assert_eq!(parsed.columns.len(), count);
        assert_eq!(
            parsed.columns.iter().map(|column| column.header.as_str()).collect::<Vec<_>>(),
            header.split(',').collect::<Vec<_>>()
        );
        assert_eq!(parsed.module_version.as_deref(), Some(version));
        assert_eq!(parsed.psf_type.as_deref(), Some("Moffat beta = 4"));
        assert_eq!(parsed.preamble.len(), 21, "every keyed preamble row is kept");
        for expected in [
            entry("Subframe Scale", "1.50000"),
            entry("Scale Unit", "Arcseconds (arcsec)"),
            entry("Data Unit", "Data Numbers (DN)"),
            entry("PSF Type", "Moffat beta = 4"),
            entry("Circular PSF", "false"),
            entry("Subframe Region", "0,0,0,0"),
            entry("Approval expression", APPROVAL),
        ] {
            assert!(parsed.preamble.contains(&expected), "{expected:?} in {:?}", parsed.preamble);
        }
        assert_eq!(parsed.rows.len(), 2);
        assert_eq!(parsed.rows[0].line, 24, "1-based line after 22 preamble lines and the header");
        assert_eq!(parsed.rows[0].index, Some(1));
        assert_eq!(parsed.rows[0].file, quoted_path, "unescaped quotes and commas as written");
        assert_eq!(parsed.rows[1].file, "C:/lights/OIII_001.fits");
        let fwhm = column(&parsed, "FWHM");
        let cell = parsed.rows[0].values.iter().find(|cell| cell.position == fwhm.position);
        assert_eq!(
            cell.map(|cell| (cell.raw.as_str(), cell.value)),
            Some(("2.5100e+00", Some(2.51)))
        );
    }
}

#[test]
fn units_follow_the_declared_scale_and_data_unit_rows() {
    let rows = [table_row(COLUMNS_30, 1, "/a/Ha_001.fits", true, fwhm_value)];
    let parsed = parse(&export(Some(&preamble(&PREAMBLE)), COLUMNS_30, &rows)).unwrap();
    for header in ["FWHM", "FWHM Mean Deviation"] {
        let fwhm = column(&parsed, header);
        assert_eq!((fwhm.class, fwhm.units), (ColumnClass::Mapped, Some(Units::Arcsec)));
        assert!(fwhm.units_basis.contains(&entry("Scale Unit", "Arcseconds (arcsec)")));
        assert!(fwhm.units_basis.contains(&entry("Subframe Scale", "1.50000")));
        assert!(fwhm.warnings.is_empty());
    }
    for header in ["Median", "Median Mean Deviation", "Noise"] {
        let median = column(&parsed, header);
        assert_eq!((median.class, median.units), (ColumnClass::Mapped, Some(Units::Dn)));
        assert!(median.units_basis.contains(&entry("Data Unit", "Data Numbers (DN)")));
    }
    for header in ["Eccentricity", "Eccentricity Mean Deviation"] {
        let eccentricity = column(&parsed, header);
        assert_eq!(
            (eccentricity.class, eccentricity.units),
            (ColumnClass::Mapped, Some(Units::Dimensionless))
        );
    }
    for header in ["Stars", "PSF Count"] {
        assert_eq!(column(&parsed, header).units, Some(Units::Count));
    }
}

#[test]
fn default_scale_electrons_circular_psf_and_pixel_units_are_read_as_declared() {
    let rows = [table_row(COLUMNS_30, 1, "/a/Ha_001.fits", true, fwhm_value)];
    let default_scale =
        Preamble { scale: "1.00000", data_unit: "Electrons (e-)", circular: "true", ..PREAMBLE };
    let parsed = parse(&export(Some(&preamble(&default_scale)), COLUMNS_30, &rows)).unwrap();
    let fwhm = column(&parsed, "FWHM");
    assert_eq!(fwhm.units, Some(Units::Arcsec));
    assert_eq!(fwhm.warnings, vec![reasons::DEFAULT_SUBFRAME_SCALE.to_owned()]);
    assert_eq!(column(&parsed, "Noise").units, Some(Units::Electrons));
    for header in ["Eccentricity", "Eccentricity Mean Deviation"] {
        let eccentricity = column(&parsed, header);
        assert_eq!(
            (eccentricity.class, eccentricity.reason.as_deref()),
            (ColumnClass::Unavailable, Some(reasons::CIRCULAR_PSF))
        );
    }

    let pixels =
        Preamble { scale_unit: "Pixels (pixel)", data_unit: "Normalized to [0,1]", ..PREAMBLE };
    let parsed = parse(&export(Some(&preamble(&pixels)), COLUMNS_30, &rows)).unwrap();
    assert_eq!(column(&parsed, "FWHM").units, Some(Units::Px));
    assert!(column(&parsed, "FWHM").warnings.is_empty());
    assert_eq!(column(&parsed, "Median").units, Some(Units::Normalized));
}

#[test]
fn columns_without_matching_rows_or_declared_units_read_unavailable() {
    let header = format!("{COLUMNS_30},Custom Score");
    let rows = [table_row(&header, 1, "/a/Ha_001.fits", true, fwhm_value)];
    let parsed = parse(&export(None, &header, &rows)).unwrap();
    assert_eq!(parsed.layout, ExportLayout::Columns30);
    assert_eq!(parsed.module_version, None);
    assert!(parsed.preamble.is_empty());
    let class = |name: &str| {
        let column = column(&parsed, name);
        (column.class, column.reason.clone(), column.units)
    };
    let unavailable =
        |reason: &str| (ColumnClass::Unavailable, Some(reason.to_owned()), None::<Units>);
    for name in ["FWHM", "FWHM Mean Deviation", "Median", "Median Mean Deviation", "Noise"] {
        assert_eq!(class(name), unavailable(reasons::MISSING_UNITS), "{name}");
    }
    for name in [
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
    ] {
        assert_eq!(class(name), unavailable(reasons::NO_DECLARED_UNITS), "{name}");
    }
    for name in ["Altitude", "Azimuth"] {
        assert_eq!(class(name), unavailable(reasons::NOT_SUPPORTED), "{name}");
    }
    assert_eq!(class("Custom Score"), unavailable(reasons::UNKNOWN_COLUMN));
    assert_eq!(class("Eccentricity"), (ColumnClass::Mapped, None, Some(Units::Dimensionless)));
    assert_eq!(class("Stars"), (ColumnClass::Mapped, None, Some(Units::Count)));
    let mapped: Vec<u32> = parsed
        .columns
        .iter()
        .filter(|column| column.class == ColumnClass::Mapped)
        .map(|column| column.position)
        .collect();
    assert_eq!(
        parsed.rows[0].values.iter().map(|cell| cell.position).collect::<Vec<_>>(),
        mapped,
        "values exist for mapped columns only"
    );
    assert!(
        parsed.columns.iter().all(|column| column.header != "FWHM (Gaussian fit)"
            && column.header != "HFR (half-flux radius)"
            && column.units != Some(Units::Px)),
        "no column is labelled or unit-assigned as a built-in width"
    );

    let older = [table_row(COLUMNS_23, 1, "/a/Ha_001.fits", true, fwhm_value)];
    let parsed = parse(&export(None, COLUMNS_23, &older)).unwrap();
    for name in ["SNR Weight", "PSF Signal Power Weight", "PSF Flux", "PSF Flux Power"] {
        assert_eq!(column(&parsed, name).reason.as_deref(), Some(reasons::NO_DECLARED_UNITS));
    }
}

#[test]
fn decisions_are_never_imported_and_rows_that_do_not_parse_are_kept() {
    let rows = [
        table_row(COLUMNS_30, 1, "/a/Ha_001.fits", true, |name| match name {
            "Median" => Some("abc".into()),
            "Noise" => Some(String::new()),
            _ => None,
        }),
        "2,true,false,\"/a/Ha_002.fits\",1.0".to_owned(),
        table_row(COLUMNS_30, 3, "/a/Ha_003.fits", false, fwhm_value).replacen('3', "x", 1),
        table_row(COLUMNS_30, 4, "/a/Ha_004.fits", false, fwhm_value),
    ];
    let parsed = parse(&export(Some(&preamble(&PREAMBLE)), COLUMNS_30, &rows)).unwrap();
    for name in ["Approved", "Locked"] {
        let decision = column(&parsed, name);
        assert_eq!(
            (decision.class, decision.reason.as_deref()),
            (ColumnClass::Excluded, Some(reasons::DECISION_NOT_IMPORTED))
        );
        assert!(
            parsed
                .rows
                .iter()
                .flat_map(|row| &row.values)
                .all(|cell| cell.position != decision.position),
            "no value is produced for {name}"
        );
    }
    assert_eq!(column(&parsed, "Index").class, ColumnClass::Identity);
    assert_eq!(column(&parsed, "File").class, ColumnClass::Identity);
    assert_eq!(parsed.rows.len(), 4, "no row is dropped");
    assert_eq!(parsed.rows.iter().map(|row| row.line).collect::<Vec<_>>(), vec![24, 25, 26, 27]);
    let median = column(&parsed, "Median").position;
    let noise = column(&parsed, "Noise").position;
    let first = &parsed.rows[0];
    let cell = |position: u32| first.values.iter().find(|cell| cell.position == position).unwrap();
    assert_eq!(
        (cell(median).value, cell(median).reason.as_deref()),
        (None, Some(reasons::UNPARSED_VALUE))
    );
    assert_eq!(
        (cell(noise).value, cell(noise).reason.as_deref()),
        (None, Some(reasons::EMPTY_VALUE))
    );
    for unparsed in &parsed.rows[1..3] {
        assert_eq!(unparsed.index, None, "line {} is unparsed", unparsed.line);
        assert!(unparsed.reason.is_some());
        assert!(unparsed.values.is_empty());
    }
    assert_eq!(parsed.rows[3].index, Some(4));

    for header in [COLUMNS_30.replacen("Index,", "", 1), COLUMNS_30.replacen(",File", "", 1)] {
        let error = parse(&export(Some(&preamble(&PREAMBLE)), &header, &[])).unwrap_err();
        assert!(matches!(error, LibraryError::UnsupportedFormat(_)), "{error:?}");
    }
}

fn volume() -> VolumeIdentity {
    VolumeIdentity {
        filesystem: "apfs".into(),
        stable_id: Some("vol-csv".into()),
        file_ids_stable: false,
        case: PathSensitivity::Sensitive,
        normalization: PathSensitivity::Sensitive,
    }
}

fn candidate(path: NativePath, text: &str, basename: &str, size: u64) -> ImportCandidate {
    ImportCandidate {
        asset_id: Uuid::new_v4(),
        path,
        path_text: Some(text.into()),
        basename: Some(basename.into()),
        fingerprint: ObservationFingerprint {
            identity: FileIdentity { volume: volume(), file_id: None },
            size_bytes: size,
            modified_ns: 1,
            content_sha256: None,
        },
        sha256: Some(format!("{size:064x}")),
    }
}

fn unix(text: &str, basename: &str, size: u64) -> ImportCandidate {
    candidate(NativePath::UnixBytes(text.as_bytes().to_vec()), text, basename, size)
}

#[test]
fn rows_match_exact_paths_then_unique_basenames_without_folding() {
    let ha_one = unix("/lights/night1/Ha_001.fits", "Ha_001.fits", 1);
    let ha_two = unix("/lights/night1/Ha_002.fits", "Ha_002.fits", 2);
    let windows_text = "C:\\lights\\OIII_001.fits";
    let oiii = candidate(
        NativePath::WindowsUtf16(windows_text.encode_utf16().collect()),
        windows_text,
        "OIII_001.fits",
        3,
    );
    let twin_a = unix("/lights/a/Twin.fits", "Twin.fits", 4);
    let twin_b = unix("/lights/b/Twin.fits", "Twin.fits", 5);
    let single = unix("/lights/c/Single.fits", "Single.fits", 6);
    let candidates = [
        ha_one.clone(),
        ha_two.clone(),
        oiii.clone(),
        twin_a.clone(),
        twin_b.clone(),
        single.clone(),
    ];
    let rows = [
        table_row(COLUMNS_30, 1, "/lights/night1/Ha_001.fits", true, fwhm_value),
        table_row(COLUMNS_30, 2, "C:/lights/OIII_001.fits", true, fwhm_value),
        table_row(COLUMNS_30, 3, "/other/machine/Ha_002.fits", true, fwhm_value),
        table_row(COLUMNS_30, 4, "/other/Twin.fits", true, fwhm_value),
        table_row(COLUMNS_30, 5, "/x/Single.fits", true, fwhm_value),
        table_row(COLUMNS_30, 6, "/y/Single.fits", true, fwhm_value),
        table_row(COLUMNS_30, 7, "/lights/night1/ha_002.fits", true, fwhm_value),
        table_row(COLUMNS_30, 8, "/lights/night1/Ha_002_c.fits", true, fwhm_value),
        table_row(COLUMNS_30, 9, "/nowhere/Unknown.fits", true, fwhm_value),
        "10,true,false".to_owned(),
    ];
    let parsed = parse(&export(Some(&preamble(&PREAMBLE)), COLUMNS_30, &rows)).unwrap();
    let matched = match_rows(&parsed, &candidates);
    assert_eq!(matched.len(), 10);
    let states: Vec<RowMatch> = matched.iter().map(|row| row.match_state).collect();
    assert_eq!(
        states,
        vec![
            RowMatch::MatchedPath,
            RowMatch::MatchedPath,
            RowMatch::MatchedName,
            RowMatch::Ambiguous,
            RowMatch::Ambiguous,
            RowMatch::Ambiguous,
            RowMatch::Unmatched,
            RowMatch::Unmatched,
            RowMatch::Unmatched,
            RowMatch::Unparsed,
        ]
    );
    let attached = |index: usize, expected: &ImportCandidate| {
        let row = &matched[index];
        assert_eq!(row.asset_id, Some(expected.asset_id));
        assert_eq!(row.candidates, vec![expected.asset_id]);
        let basis = row.basis.as_ref().expect("attached rows carry their basis");
        assert_eq!(basis.fingerprint, expected.fingerprint);
        assert_eq!(basis.sha256, expected.sha256);
    };
    attached(0, &ha_one);
    attached(1, &oiii);
    attached(2, &ha_two);
    assert_eq!(matched[3].candidates, vec![twin_a.asset_id, twin_b.asset_id]);
    assert_eq!(matched[3].asset_id, None);
    for duplicate in &matched[4..6] {
        assert_eq!(duplicate.reason.as_deref(), Some(reasons::DUPLICATE_ASSET_MATCH));
        assert_eq!(duplicate.candidates, vec![single.asset_id]);
        assert_eq!((duplicate.asset_id.as_ref(), duplicate.basis.as_ref()), (None, None));
    }
    for unmatched in &matched[6..9] {
        assert!(unmatched.candidates.is_empty() && unmatched.asset_id.is_none());
    }
    assert_eq!(matched[9].index, None);
    assert_eq!(matched[0].values, parsed.rows[0].values, "rows keep their parsed cells");
}
