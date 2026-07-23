// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Corpus equivalence guard for #701.
//!
//! `targeting::normalize::normalize` (used for the SQLite alias lookup/
//! override path, e.g. `target_resolve.rs`/`ingest_resolution.rs`) and
//! `simbad_resolver::normalize::normalize` (used for cache writes/dedup, e.g.
//! `targeting_resolver::cache`/`cone_search`) were two independently
//! maintained copies of the same normalization pipeline. `targeting::normalize`
//! now delegates to `simbad_resolver::normalize` (spec 052 D6/T004; #701), but
//! this test stays as the permanent drift guard: it fails loudly the moment
//! the two diverge for any designation in the corpus below, rather than
//! silently splitting alias lookups against SQLite `target_alias` rows.
#![allow(clippy::doc_markdown)] // "SQLite" is not suited for backticks

const CORPUS: &[&str] = &[
    // Messier
    "M31",
    "m31",
    "M 31",
    "Messier 31",
    "MESSIER 31",
    "  M31  ",
    "M101",
    "M101 LRGB",
    // NGC / IC
    "NGC224",
    "ngc 224",
    "NGC-224",
    "NGC7000",
    "IC1396",
    "ic1396",
    // Sharpless
    "Sh2-155",
    "SH2 155",
    "sh2155",
    // Barnard
    "Barnard 33",
    "B33",
    "b33",
    // LBN / LDN
    "LBN500",
    "LDN1250",
    "lbn 500",
    "ldn1250",
    // Caldwell
    "C14",
    "Caldwell 14",
    "caldwell14",
    // vdB / Melotte / Arp / Abell / OpenNGC
    "vdB1",
    "Mel15",
    "Arp273",
    "Abell2151",
    "OpenNGC42",
    // Common names
    "Veil Nebula",
    "veil nebula",
    "VEIL NEBULA",
    "Andromeda Galaxy",
    // Whitespace / punctuation variants
    "  NGC   224  ",
    "ngc-224",
    "ngc_224",
    // Unicode (NFKC-normalizable forms)
    "\u{FF2D}\u{FF13}\u{FF11}", // fullwidth "M31"
    "M\u{00A0}31",              // NBSP between prefix and digits
    "Andromeda\u{00A0}Galaxy",
    // Edge cases
    "",
    "   ",
    "M",
    "IC",
    "Light",
];

#[test]
fn repo_and_crate_normalizers_agree_on_corpus() {
    let mismatches: Vec<(&str, String, String)> = CORPUS
        .iter()
        .filter_map(|&input| {
            let repo = targeting::normalize::normalize(input);
            let published = simbad_resolver::normalize::normalize(input);
            (repo != published).then_some((input, repo, published))
        })
        .collect();

    assert!(
        mismatches.is_empty(),
        "targeting::normalize diverges from simbad_resolver::normalize for: {mismatches:#?}"
    );
}
