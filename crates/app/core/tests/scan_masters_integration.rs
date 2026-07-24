// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Integration tests for spec 040 Phase 2a — master detection during scan.
//!
//! Tests that:
//! 1. A folder containing detected calibration master files yields individual
//!    `ScannedMasterFile` entries plus a separate non-master group.
//! 2. XISF files are recorded with `FileFormat::Xisf`, not `FileFormat::Fits`.
//! 3. A folder with only non-master frames produces no master entries.
//! 4. A video folder produces no master entries.

use std::fs;
use std::io::Write;
use std::path::Path;

use app_core::inbox::scan::{scan_root, FileFormat, Lane, ScanOptions};

// ── FITS writer helpers ───────────────────────────────────────────────────────

/// Pad a string to exactly 80 ASCII bytes.
fn pad80(s: &str) -> Vec<u8> {
    let mut v: Vec<u8> = s.as_bytes().to_vec();
    v.resize(80, b' ');
    v
}

/// Build a minimal FITS header block (2880 bytes) from a list of keyword
/// card strings.  `END` is appended automatically.
fn minimal_fits_header(cards: &[&str]) -> Vec<u8> {
    let mut bytes: Vec<u8> = Vec::new();
    for card in cards {
        bytes.extend_from_slice(&pad80(card));
    }
    bytes.extend_from_slice(&pad80("END"));
    // Pad to next 2880-byte boundary.
    let rem = bytes.len() % 2880;
    if rem != 0 {
        bytes.resize(bytes.len() + (2880 - rem), b' ');
    }
    bytes
}

/// Write a minimal valid FITS file with the given IMAGETYP and optional STACKCNT.
fn write_fits(dir: &Path, name: &str, imagetyp: &str, stackcnt: Option<u32>) {
    let mut cards: Vec<String> = vec![
        "SIMPLE  =                    T / file conforms to FITS standard".to_owned(),
        "BITPIX  =                   16 / bits per data value".to_owned(),
        "NAXIS   =                    0 / no image data".to_owned(),
        format!("IMAGETYP= '{imagetyp:<8}' / frame type"),
    ];
    if let Some(n) = stackcnt {
        cards.push(format!("STACKCNT=                  {n:3} / number of stacked frames"));
    }

    let card_refs: Vec<&str> = cards.iter().map(String::as_str).collect();
    let header = minimal_fits_header(&card_refs);

    let path = dir.join(name);
    let mut f = fs::File::create(path).unwrap();
    f.write_all(&header).unwrap();
}

/// Write a non-FITS dummy file (e.g. a sub-frame without real FITS content).
fn write_dummy(dir: &Path, name: &str) {
    let path = dir.join(name);
    let mut f = fs::File::create(path).unwrap();
    f.write_all(b"not a real fits file").unwrap();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn master_dark_by_stackcnt_produces_individual_master_entry() {
    let tmp = tempfile::tempdir().unwrap();
    let darks = tmp.path().join("darks");
    fs::create_dir_all(&darks).unwrap();

    // A master dark (STACKCNT > 1) and two plain sub-frames
    write_fits(&darks, "masterDark.fits", "DARK", Some(30));
    write_fits(&darks, "dark_001.fits", "DARK", None);
    write_fits(&darks, "dark_002.fits", "DARK", None);

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    assert_eq!(items.len(), 1, "one leaf folder");

    let item = &items[0];
    assert_eq!(item.lane, Lane::Fits);
    assert_eq!(item.format, FileFormat::Fits);

    // One master detected
    assert_eq!(item.masters.len(), 1, "one master file detected");
    let master = &item.masters[0];
    assert!(master.detection.is_master);
    assert_eq!(master.format, FileFormat::Fits);

    // relative_path for the master should be the file path (not the folder)
    assert!(
        master.relative_path.ends_with("masterDark.fits"),
        "master relative_path = {}",
        master.relative_path
    );
}

#[test]
fn xisf_only_folder_has_format_xisf() {
    // Tests that a folder containing only .xisf files is recorded with
    // FileFormat::Xisf at the folder level (spec 040 FR-006 format tracking).
    //
    // Note: XISF master detection at scan time requires a real parseable XISF
    // header (our dummy bytes are unreadable by XisfExtractor), so this test
    // only validates format, not master detection.  Master detection for XISF
    // is validated in the calibration_master_detect unit tests.
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("masterDark.xisf");
    let mut f = fs::File::create(&path).unwrap();
    f.write_all(b"not a real xisf header").unwrap();

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    assert_eq!(items.len(), 1);

    let item = &items[0];
    // format at the folder level: xisf (only xisf files, no fits)
    assert_eq!(item.format, FileFormat::Xisf, "XISF-only folder must have format=Xisf");
    assert_eq!(item.xisf_files.len(), 1);
    assert_eq!(item.fits_files.len(), 0);
    // No masters because the file is unreadable
    assert!(item.masters.is_empty());
}

#[test]
fn fits_master_detected_has_format_fits() {
    // Verify that when a FITS master IS detected, its ScannedMasterFile carries
    // FileFormat::Fits (not Xisf or Video).
    let tmp = tempfile::tempdir().unwrap();
    write_fits(tmp.path(), "masterDark.fits", "DARK", Some(30));

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].masters.len(), 1);
    assert_eq!(
        items[0].masters[0].format,
        FileFormat::Fits,
        "master file from a .fits file must have format=Fits"
    );
}

#[test]
fn non_master_subs_produce_no_masters() {
    let tmp = tempfile::tempdir().unwrap();

    // Plain sub-frames: no STACKCNT, no master name
    write_fits(tmp.path(), "dark_001.fits", "DARK", None);
    write_fits(tmp.path(), "dark_002.fits", "DARK", None);

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    assert_eq!(items.len(), 1);
    assert!(items[0].masters.is_empty(), "plain subs must not be detected as masters");
}

#[test]
fn video_folder_produces_no_masters() {
    let tmp = tempfile::tempdir().unwrap();
    let planetary = tmp.path().join("planetary");
    fs::create_dir_all(&planetary).unwrap();

    let mut f = fs::File::create(planetary.join("jupiter.ser")).unwrap();
    f.write_all(b"SER data").unwrap();

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].lane, Lane::Video);
    assert!(items[0].masters.is_empty(), "video folder must not have masters");
}

#[test]
fn folder_with_only_masters_produces_all_master_entries() {
    let tmp = tempfile::tempdir().unwrap();
    let cal = tmp.path().join("masters");
    fs::create_dir_all(&cal).unwrap();

    // Two masters: one dark by STACKCNT, one flat by STACKCNT
    write_fits(&cal, "masterDark.fits", "DARK", Some(30));
    write_fits(&cal, "masterFlat.fits", "FLAT", Some(20));

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].masters.len(), 2, "both files detected as masters");
}

#[test]
fn dummy_content_files_in_fits_lane_produce_no_masters() {
    // Files with FITS extension but unreadable content → extraction fails →
    // no master entries (graceful degradation).
    let tmp = tempfile::tempdir().unwrap();
    write_dummy(tmp.path(), "dark_001.fits");
    write_dummy(tmp.path(), "dark_002.fits");

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    assert_eq!(items.len(), 1);
    assert!(items[0].masters.is_empty(), "unreadable files must not yield masters");
}

// ── Spec 058 FR-015 — the master carve-out arithmetic ─────────────────────────

#[test]
fn masters_only_folder_has_no_sub_frames_left_to_classify() {
    // FR-015: a folder whose every file is a detected master must score 0, so
    // `list_unclassified_source_groups` does not surface it in addition to the
    // master item rows that already represent it.
    let tmp = tempfile::tempdir().unwrap();
    let masters = tmp.path().join("masters");
    fs::create_dir_all(&masters).unwrap();

    write_fits(&masters, "masterDark.fits", "DARK", Some(30));
    write_fits(&masters, "masterFlat.fits", "FLAT", Some(20));

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    assert_eq!(items.len(), 1, "one leaf folder");
    let item = &items[0];
    assert_eq!(item.masters.len(), 2, "both files detected as masters");
    assert_eq!(
        item.sub_frame_count(),
        0,
        "a masters-only folder has nothing left for classification to split (FR-015)"
    );
}

#[test]
fn mixed_master_and_sub_folder_counts_only_the_subs() {
    // The other side of FR-015: masters are excluded from the folder's count,
    // but the remaining sub-frames still are counted, so the folder keeps
    // appearing as scanned-but-unclassified.
    let tmp = tempfile::tempdir().unwrap();
    let darks = tmp.path().join("darks");
    fs::create_dir_all(&darks).unwrap();

    write_fits(&darks, "masterDark.fits", "DARK", Some(30));
    write_fits(&darks, "dark_001.fits", "DARK", None);
    write_fits(&darks, "dark_002.fits", "DARK", None);

    let items = scan_root(tmp.path(), &ScanOptions::default()).unwrap().items;
    let item = &items[0];
    assert_eq!(item.masters.len(), 1);
    assert_eq!(item.fits_files.len(), 3, "masters are a subset of fits_files");
    assert_eq!(
        item.sub_frame_count(),
        2,
        "the two plain darks remain to be classified; the master does not (FR-015)"
    );
}
