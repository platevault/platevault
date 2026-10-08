// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Composed `SubframeSelector` import acceptance (spec 067: PIX-AC-04,
//! PIX-AC-05, PIX-FR-07, PIX-FR-08, PV-PIX-SC-03): generated frames indexed
//! through a Library scan and measured, then two CSV exports reviewed and
//! confirmed through `FrameReview`. Imported values sit beside built-in ones,
//! never replace them, and no library record or fixture byte changes.
#![allow(clippy::too_many_lines, clippy::cast_possible_truncation)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use persistence_library::SessionQuery;
use platevault_core::frame_review::FrameReview;
use platevault_core::library::Library;
use platevault_core::*;
use platevault_pixels::fixtures::{quantize, write_fits, FitsImage, SyntheticFrame, SyntheticStar};
use platevault_pixels::{SampleFormat as StoredFormat, Scaling as StoredScaling};
use uuid::Uuid;

const COLUMNS_30: &str = "Index,Approved,Locked,File,Weight,PSF Signal Weight,PSF SNR,PSF Scale,\
PSF Scale SNR,PSF Count,M*,N*,SNR,FWHM,Eccentricity,Altitude,Azimuth,Median,Median Mean Deviation,\
Noise,Noise Ratio,Stars,Star Residual,PSF Total Flux,PSF Total Power Flux,PSF Total Mean Flux,\
PSF Total Mean Power Flux,FWHM Mean Deviation,Eccentricity Mean Deviation,\
Star Residual Mean Deviation";

/// The preamble `ExportCSV()` writes in `PixInsight` 1.9.3.
const PREAMBLE: &str = "SubframeSelector module version 1.9.3
Subframe Scale,1.50000
Camera Gain,1.00000
Camera Resolution,\"16-bit [0,65535]\"
Site Local Midnight,24
Scale Unit,\"Arcseconds (arcsec)\"
Data Unit,\"Data Numbers (DN)\"
Trimming Factor,0.10
Structure Layers,5
Noise Layers,0
Hot Pixel Filter Radius,1
Noise Reduction Filter Radius,0
Sensitivity,0.50000
Peak Response,0.500
Maximum Star Distortion,0.600
Upper Limit,1.000
Pedestal,0
Subframe Region,0,0,0,0
PSF Type,\"Moffat beta = 4\"
Circular PSF,false
Approval expression,\"FWHM < 3.5\"
Weighting expression,\"PSFSignalWeight\"";

const FRAMES: [&str; 5] = [
    "night1/Ha_001.fits",
    "night1/Ha_002.fits",
    "night1/Ha_004.fits",
    "night2/Ha_001.fits",
    "night2/Ha_003.fits",
];
/// Not measured, so the review hashes it for its import basis.
const UNMEASURED: &str = "night2/Ha_003.fits";
const BZERO: StoredScaling = StoredScaling { zero: 32768.0, scale: 1.0 };
const BUILT_IN_LABELS: [&str; 2] = ["FWHM (Gaussian fit)", "HFR (half-flux radius)"];

fn write_frames(root: &Path) {
    for (index, name) in FRAMES.iter().enumerate() {
        let path = root.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let frame = SyntheticFrame {
            stars: vec![SyntheticStar {
                x: 30.4,
                y: 28.7,
                amplitude: 3000.0,
                sigma_major: 2.0,
                sigma_minor: 1.8,
                angle_deg: 20.0,
            }],
            ..SyntheticFrame::new(64, 64, index as u64 + 11, 1000.0, 10.0)
        };
        let samples = quantize(&frame.render(), StoredFormat::I16, BZERO);
        let cards = [
            ("IMAGETYP", "'LIGHT'".to_owned()),
            ("INSTRUME", "'ASI2600MM'".into()),
            ("TELESCOP", "'RedCat 51'".into()),
            ("OBJECT", "'NGC 7000'".into()),
            ("FILTER", "'Ha'".into()),
            ("EXPTIME", "300".into()),
            ("DATE-OBS", format!("'2026-09-1{}T22:{:02}:00'", index / 3, index * 5)),
        ];
        let bytes = write_fits(&FitsImage {
            width: 64,
            height: 64,
            channels: 1,
            samples: &samples,
            scaling: BZERO,
            blank: None,
            cards: &cards,
        })
        .unwrap();
        std::fs::write(path, bytes).unwrap();
    }
}

/// One table row: Index, Approved, Locked, the quoted File and a value per
/// remaining column.
fn row(index: u64, file: &str) -> String {
    let mut fields = vec![index.to_string(), "true".into(), "false".into(), format!("\"{file}\"")];
    fields.extend(COLUMNS_30.split(',').skip(4).map(|name| {
        match name {
            "FWHM" => "2.5100e+00",
            "Eccentricity" => "4.1000e-01",
            "Median" => "1.0010e+03",
            "Noise" => "1.0200e+01",
            "Stars" => "812",
            _ => "1.0000e+00",
        }
        .to_owned()
    }));
    fields.join(",")
}

fn export(preamble: Option<&str>, rows: &[String]) -> Vec<u8> {
    let mut lines: Vec<String> = preamble.into_iter().map(str::to_owned).collect();
    lines.push(COLUMNS_30.to_owned());
    lines.extend(rows.iter().cloned());
    lines.push(String::new());
    lines.join("\n").into_bytes()
}

async fn scan_to_end(library: &Arc<Library>, location: Uuid) -> ScanOperation {
    let mut progress = library.subscribe_scan_progress();
    let started = library.start_scan(location, None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            let operation = progress.recv().await.unwrap();
            if operation.id == started.id && operation.state != ScanState::Running {
                return operation;
            }
        }
    })
    .await
    .expect("scan must publish its terminal state")
}

async fn finished(review: &FrameReview, run: Uuid) -> MeasurementRun {
    tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            let status = review.measurement_status(run).await.unwrap();
            if status.state != RunState::Running {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the run must settle")
}

fn column<'a>(review: &'a ImportReview, header: &str) -> &'a ImportColumn {
    review.columns.iter().find(|column| column.header == header).unwrap()
}

fn row_of(rows: &[ImportRow], index: u64) -> &ImportRow {
    rows.iter().find(|row| row.index == Some(index)).unwrap()
}

/// Every asset and session record with quality, decisions, memberships and
/// associations.
async fn library_state(library: &Library, location: Uuid) -> serde_json::Value {
    let catalog = library.catalog();
    let assets = catalog.location_assets(location).await.unwrap();
    let query = SessionQuery { include_superseded: true, ..SessionQuery::default() };
    let mut sessions = Vec::new();
    for summary in catalog.list_sessions(&query).await.unwrap() {
        sessions.push(catalog.session(summary.session.id).await.unwrap());
    }
    serde_json::json!({ "assets": assets, "sessions": sessions })
}

fn manifest(paths: &[PathBuf]) -> BTreeMap<PathBuf, String> {
    paths.iter().map(|path| (path.clone(), support::digest(path))).collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn reviewed_imports_attach_beside_built_in_values_and_change_no_library_record() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("Captures");
    write_frames(&root);
    let mut files: Vec<PathBuf> = FRAMES.iter().map(|name| root.join(name)).collect();
    let mut originals = manifest(&files);
    let exports = temp.path().join("exports");
    std::fs::create_dir(&exports).unwrap();
    let library = Library::open(&temp.path().join("library.sqlite"), None).await.unwrap();
    let location = library
        .register_location(NativePath::from_path(&root), "Captures".into(), LocationRole::Captures)
        .await
        .unwrap();
    assert_eq!(scan_to_end(&library, location.id).await.state, ScanState::Completed);
    // Fixture names use `/`; the scanner records native separators (`\` on Windows).
    let ids: BTreeMap<NativePath, Uuid> = library
        .catalog()
        .location_assets(location.id)
        .await
        .unwrap()
        .into_iter()
        .map(|asset| (asset.relative_path, asset.id))
        .collect();
    let id = |name: &str| ids[&NativePath::from_path(&name.split('/').collect::<PathBuf>())];
    let scope: Vec<Uuid> = FRAMES.iter().map(|name| id(name)).collect();
    let review = library.frame_review();

    // Built-in measurement of every frame but one.
    let measured: Vec<Uuid> =
        scope.iter().copied().filter(|asset| *asset != id(UNMEASURED)).collect();
    let run = review.start_measurement(&measured, &[]).await.unwrap();
    assert_eq!(finished(review, run.operation_id).await.state, RunState::Completed);
    let built_in = review.frame_states(&scope).await.unwrap();
    let before = library_state(&library, location.id).await;

    // CSV A: the 1.9.3 preamble declares arcsec and DN.
    let path = |name: &str| root.join(name).display().to_string();
    let csv_a = exports.join("a.csv");
    std::fs::write(
        &csv_a,
        export(
            Some(PREAMBLE),
            &[
                row(1, &path("night1/Ha_004.fits")),
                row(2, "/Volumes/T7/Ha_003.fits"),
                row(3, "/Volumes/T7/Ha_001.fits"),
                row(4, "/Volumes/T7/Ha_999.fits"),
                row(5, &path("night1/Ha_002.fits")),
            ],
        ),
    )
    .unwrap();
    files.push(csv_a.clone());
    originals.insert(csv_a.clone(), support::digest(&csv_a));
    let reviewed = review.review_import(&NativePath::from_path(&csv_a), &scope).await.unwrap();
    assert_eq!((reviewed.state, reviewed.revision), (ImportReviewState::Reviewed, 1));
    assert_eq!(reviewed.format, ImportFormat::SubframeSelectorCsv);
    assert_eq!(reviewed.module_version.as_deref(), Some("1.9.3"));
    assert_eq!(reviewed.psf_type.as_deref(), Some("Moffat beta = 4"));
    assert_eq!(reviewed.layout, ExportLayout::Columns30);
    assert_eq!(reviewed.source.sha256, support::digest(&csv_a));
    assert_eq!(reviewed.source.size_bytes, std::fs::metadata(&csv_a).unwrap().len());
    assert_eq!(reviewed.scope, scope);
    let fwhm = column(&reviewed, "FWHM");
    assert_eq!((fwhm.class, fwhm.units), (ColumnClass::Mapped, Some(Units::Arcsec)));
    assert!(fwhm.units_basis.iter().any(|entry| entry.key == "Scale Unit"));
    assert_eq!(column(&reviewed, "Median").units, Some(Units::Dn));
    let approved = column(&reviewed, "Approved");
    assert_eq!(approved.class, ColumnClass::Excluded);
    assert_eq!(approved.reason.as_deref(), Some("decision_not_imported"));

    let states: Vec<(u64, RowMatch, Option<Uuid>)> = reviewed
        .rows
        .iter()
        .map(|row| (row.index.unwrap(), row.match_state, row.asset_id))
        .collect();
    assert_eq!(
        states,
        [
            (1, RowMatch::MatchedPath, Some(id("night1/Ha_004.fits"))),
            (2, RowMatch::MatchedName, Some(id(UNMEASURED))),
            (3, RowMatch::Ambiguous, None),
            (4, RowMatch::Unmatched, None),
            (5, RowMatch::MatchedPath, Some(id("night1/Ha_002.fits"))),
        ]
    );
    let ambiguous = row_of(&reviewed.rows, 3);
    let candidates: BTreeSet<Uuid> = ambiguous.candidates.iter().copied().collect();
    let expected: BTreeSet<Uuid> = [id("night1/Ha_001.fits"), id("night2/Ha_001.fits")].into();
    assert_eq!(candidates, expected);
    // Import bases: the recorded measurement digest, and for the unmeasured
    // frame the SHA-256 the review hashed.
    for (index, name) in [(1, "night1/Ha_004.fits"), (2, UNMEASURED), (5, "night1/Ha_002.fits")] {
        let basis = row_of(&reviewed.rows, index).basis.as_ref().unwrap();
        assert_eq!(
            basis.sha256.as_deref(),
            Some(support::digest(&root.join(name)).as_str()),
            "{name}"
        );
    }
    // Nothing is attached before confirmation.
    let unconfirmed = review.frame_states(&scope).await.unwrap();
    assert!(unconfirmed.iter().all(|state| state.imported.is_empty()));
    assert_eq!(review.import_review(reviewed.review_id).await.unwrap(), reviewed);

    // Confirm without resolving.
    let confirmed = review.confirm_import(reviewed.review_id, &[]).await.unwrap();
    assert_eq!(confirmed.review.state, ImportReviewState::Confirmed);
    let attached: Vec<u64> = confirmed.attached.iter().map(|row| row.index.unwrap()).collect();
    let unattached: Vec<u64> = confirmed.unattached.iter().map(|row| row.index.unwrap()).collect();
    assert_eq!((attached, unattached), (vec![1, 2, 5], vec![3, 4]));
    let after = review.frame_states(&scope).await.unwrap();
    for (state, built) in after.iter().zip(&built_in) {
        assert_eq!(state.values, built.values, "no built-in value is replaced");
        assert_eq!((state.state, state.measurement_id), (built.state, built.measurement_id));
    }
    let imported_of = |name: &str| {
        let state = after.iter().find(|state| state.asset_id == id(name)).unwrap();
        state.imported.clone()
    };
    for name in ["night1/Ha_004.fits", UNMEASURED, "night1/Ha_002.fits"] {
        let imported = imported_of(name);
        assert!(!imported.is_empty(), "{name}");
        for value in &imported {
            assert_eq!(value.import_id, reviewed.review_id);
            assert_eq!(value.verification, ImportVerification::Unverified);
            assert_eq!(value.drift, Drift::Matches, "{name}");
            assert!(!BUILT_IN_LABELS.contains(&value.label.as_str()));
            assert!(!["Approved", "Locked", "Index", "File"].contains(&value.column.as_str()));
            assert_eq!(
                value.source,
                ValueSource::Imported {
                    format: ImportFormat::SubframeSelectorCsv,
                    module_version: Some("1.9.3".into()),
                    psf_type: Some("Moffat beta = 4".into()),
                }
            );
        }
        let fwhm = imported.iter().find(|value| value.column == "FWHM").unwrap();
        assert_eq!((fwhm.value, fwhm.units), (Some(2.51), Some(Units::Arcsec)));
        assert_eq!(fwhm.label, "FWHM (SubframeSelector)");
    }
    assert_eq!(imported_of(UNMEASURED)[0].match_state, RowMatch::MatchedName);
    assert!(imported_of("night1/Ha_001.fits").is_empty(), "ambiguous rows stay unattached");
    assert!(imported_of("night2/Ha_001.fits").is_empty());
    let unmeasured = after.iter().find(|state| state.asset_id == id(UNMEASURED)).unwrap();
    assert_eq!(unmeasured.state, FrameStateKind::NotMeasured, "an import is not a measurement");
    assert!(unmeasured.values.is_empty());

    // CSV B: no preamble, so FWHM, Median and Noise have no units.
    let csv_b = exports.join("b.csv");
    std::fs::write(
        &csv_b,
        export(None, &[row(1, &path("night1/Ha_004.fits")), row(3, "/Volumes/T7/Ha_001.fits")]),
    )
    .unwrap();
    files.push(csv_b.clone());
    originals.insert(csv_b.clone(), support::digest(&csv_b));
    let second = review.review_import(&NativePath::from_path(&csv_b), &scope).await.unwrap();
    assert_eq!(second.module_version, None);
    for header in ["FWHM", "Median", "Noise"] {
        let column = column(&second, header);
        assert_eq!(column.class, ColumnClass::Unavailable, "{header}");
        assert_eq!(column.reason.as_deref(), Some("missing_units"), "{header}");
        assert_eq!(column.units, None);
    }
    let outside = review
        .confirm_import(
            second.review_id,
            &[RowResolution { index: 3, asset_id: id("night1/Ha_002.fits") }],
        )
        .await;
    assert!(matches!(outside, Err(LibraryError::InvalidInput(_))), "{outside:?}");
    assert_eq!(review.import_review(second.review_id).await.unwrap(), second, "nothing written");

    let chosen = id("night2/Ha_001.fits");
    let confirmed = review
        .confirm_import(second.review_id, &[RowResolution { index: 3, asset_id: chosen }])
        .await
        .unwrap();
    let resolved = row_of(&confirmed.attached, 3);
    assert_eq!((resolved.match_state, resolved.asset_id), (RowMatch::Resolved, Some(chosen)));
    let after = review.frame_states(&scope).await.unwrap();
    let state = after.iter().find(|state| state.asset_id == chosen).unwrap();
    let built = built_in.iter().find(|state| state.asset_id == chosen).unwrap();
    assert_eq!(state.values, built.values);
    assert!(!state.imported.is_empty());
    for value in &state.imported {
        assert_eq!(value.import_id, second.review_id);
        assert_eq!(value.match_state, RowMatch::Resolved);
        assert!(!["FWHM", "Median", "Noise"].contains(&value.column.as_str()), "{value:?}");
        assert!(!BUILT_IN_LABELS.contains(&value.label.as_str()));
        assert!(matches!(value.source, ValueSource::Imported { module_version: None, .. }));
    }
    let both = after.iter().find(|state| state.asset_id == id("night1/Ha_004.fits")).unwrap();
    let imports: BTreeSet<Uuid> = both.imported.iter().map(|value| value.import_id).collect();
    assert_eq!(imports, [reviewed.review_id, second.review_id].into(), "imports coexist");
    assert_eq!(both.imported[0].import_id, second.review_id, "newest import first");

    // Preview after the imports; still no library or source change.
    let previewed = id("night1/Ha_004.fits");
    let preview = review.open_frame(previewed).await.unwrap();
    assert!(preview.matches_record);
    review
        .preview_tile(&TileRequest {
            asset_id: previewed,
            sha256: preview.sha256,
            plane: 0,
            level: 0,
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            stretch: Stretch::Mtf { shadows: 0.0, midtones: 0.01, highlights: 1.0 },
        })
        .await
        .unwrap();
    assert_eq!(library_state(&library, location.id).await, before);
    assert_eq!(manifest(&files), originals);
    let detail = review.frame_detail(previewed).await.unwrap();
    assert_eq!(detail.imported.len(), both.imported.len());
    assert_eq!(detail.state.values, built_in[2].values);
}
