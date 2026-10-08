//! Bundled catalogue data (spec 072 PLAN-TGT-FR-02 membership, PLAN-TGT-FR-11
//! angular size) exercised against the real committed seed and its manifest.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use platevault_core::targets::TargetIndex;
use platevault_core::{Catalogue, TargetCandidate};
use sha2::{Digest, Sha256};

const SEED_JSON: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/seed/seed.json"));
const SEED_MANIFEST_JSON: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/seed/seed.manifest.json"));

static INDEX: LazyLock<TargetIndex> =
    LazyLock::new(|| TargetIndex::bundled().expect("bundled seed loads"));

fn numbers(rows: &[TargetCandidate], catalogue: Catalogue) -> Vec<u32> {
    rows.iter()
        .map(|row| {
            row.catalogues
                .iter()
                .find(|m| m.catalogue == catalogue)
                .and_then(|m| m.number)
                .unwrap_or_else(|| panic!("{} lists no {catalogue:?} number", row.designation))
        })
        .collect()
}

fn member(rows: &[TargetCandidate], catalogue: Catalogue, number: u32) -> &TargetCandidate {
    rows.iter()
        .find(|row| {
            row.catalogues.iter().any(|m| m.catalogue == catalogue && m.number == Some(number))
        })
        .unwrap_or_else(|| panic!("no {catalogue:?} {number}"))
}

#[test]
fn messier_browse_lists_110() {
    let rows = INDEX.browse(&[Catalogue::Messier]);
    assert_eq!(numbers(&rows, Catalogue::Messier), (1..=110).collect::<Vec<_>>());

    // Regression: the previous builder dropped these seven (LINER galaxies and
    // SIMBAD `?`/`err` object types fell to the "other" cap).
    for n in [40, 63, 73, 91, 98, 104, 105] {
        let row = member(&rows, Catalogue::Messier, n);
        assert!(
            row.catalogues.iter().any(|m| m.designation == format!("M {n}")),
            "M {n} membership names its designation: {:?}",
            row.catalogues
        );
    }
    for n in [63, 91, 98, 104, 105] {
        assert_eq!(member(&rows, Catalogue::Messier, n).object_type, "galaxy", "M {n}");
    }
    assert_eq!(member(&rows, Catalogue::Messier, 73).designation, "NGC 6994");

    assert!(INDEX.browse(&[]).is_empty(), "Browse without a catalogue lists no rows");
}

#[test]
fn caldwell_membership_present() {
    let rows = INDEX.browse(&[Catalogue::Caldwell]);
    assert_eq!(numbers(&rows, Catalogue::Caldwell), (1..=109).collect::<Vec<_>>());

    let double_cluster = member(&rows, Catalogue::Caldwell, 14);
    assert_eq!(double_cluster.designation, "NGC 869");
    let hyades = member(&rows, Catalogue::Caldwell, 41);
    assert!(hyades.designation.contains("Melotte 25"), "{}", hyades.designation);
    let coalsack = member(&rows, Catalogue::Caldwell, 99);
    assert!(coalsack.designation.contains("Coalsack"), "{}", coalsack.designation);

    let ngc7000 = member(&rows, Catalogue::Caldwell, 20);
    let kinds: BTreeSet<_> = ngc7000.catalogues.iter().map(|m| m.catalogue).collect();
    assert!(kinds.contains(&Catalogue::Ngc) && kinds.contains(&Catalogue::Caldwell), "{kinds:?}");
    let caldwell20 = ngc7000.catalogues.iter().find(|m| m.catalogue == Catalogue::Caldwell);
    assert_eq!(caldwell20.map(|m| m.designation.as_str()), Some("Caldwell 20"));

    // Membership is a bundled-catalogue fact, carried by the seed record itself.
    assert_eq!(INDEX.candidate(ngc7000.id).as_ref(), Some(ngc7000));

    // Every catalogue the spec names browses to at least one row.
    for catalogue in [
        Catalogue::Messier,
        Catalogue::Ngc,
        Catalogue::Ic,
        Catalogue::Sharpless,
        Catalogue::Lbn,
        Catalogue::Ldn,
        Catalogue::Caldwell,
        Catalogue::Barnard,
    ] {
        assert!(!INDEX.browse(&[catalogue]).is_empty(), "{catalogue:?} browses empty");
    }
    // A stellar member of a cluster ("NGC 1750 2316") is not an NGC object.
    let ngc = INDEX.browse(&[Catalogue::Ngc]);
    assert!(ngc
        .iter()
        .all(|row| row.catalogues.iter().all(|m| !m.designation.contains("1750 2316"))));
}

#[test]
fn seed_entry_carries_major_minor_axis_or_unknown() {
    let seed: serde_json::Value = serde_json::from_slice(SEED_JSON).unwrap();
    let entries = seed["entries"].as_array().unwrap();
    let mut known = 0_usize;
    for entry in entries {
        let size = entry
            .get("angular_size")
            .unwrap_or_else(|| panic!("{} has no angular_size key", entry["primary_designation"]));
        if size.is_null() {
            continue;
        }
        known += 1;
        let major = size["major_arcmin"].as_f64().expect("major axis is a number");
        assert!(major.is_finite() && major > 0.0, "{entry}");
        if let Some(minor) = size["minor_arcmin"].as_f64() {
            assert!(minor.is_finite() && minor > 0.0, "{entry}");
        } else {
            assert!(size["minor_arcmin"].is_null(), "{entry}");
        }
        if let Some(pa) = size["pa_deg"].as_f64() {
            assert!((0.0..=360.0).contains(&pa), "{entry}");
        } else {
            assert!(size["pa_deg"].is_null(), "{entry}");
        }
    }
    assert!(known * 2 > entries.len(), "most seed objects carry a size: {known}/{}", entries.len());

    let messier = INDEX.browse(&[Catalogue::Messier]);
    let m31 = member(&messier, Catalogue::Messier, 31);
    let size = m31.angular_size.expect("M 31 has a catalogued size");
    assert!((150.0..250.0).contains(&size.major_arcmin), "{size:?}");
    assert!(size.minor_arcmin.is_some_and(|minor| minor < size.major_arcmin), "{size:?}");
    assert!(size.pa_deg.is_some(), "{size:?}");

    let unknown = entries.iter().find(|e| e["angular_size"].is_null()).expect("an unsized entry");
    let designation = unknown["primary_designation"].as_str().unwrap();
    let candidate = INDEX
        .browse(&Catalogue::ALL)
        .into_iter()
        .chain(
            INDEX
                .search(
                    &platevault_core::targets::TargetQuery {
                        text: Some(designation.to_owned()),
                        cone: None,
                        limit: 1,
                    },
                    &[],
                )
                .unwrap()
                .into_iter()
                .map(|hit| hit.candidate),
        )
        .find(|c| c.designation == designation)
        .expect("unsized entry is searchable");
    assert_eq!(candidate.angular_size, None, "unknown size reads as unknown, never zero");
}

#[test]
fn seed_digest_matches_manifest() {
    let manifest: serde_json::Value = serde_json::from_slice(SEED_MANIFEST_JSON).unwrap();
    let digest = hex::encode(Sha256::digest(SEED_JSON));
    assert_eq!(manifest["asset"], "seed.json");
    assert_eq!(manifest["sha256"].as_str(), Some(digest.as_str()), "seed.json digest");
    assert_eq!(manifest["bytes"].as_u64(), Some(SEED_JSON.len() as u64));

    let seed: serde_json::Value = serde_json::from_slice(SEED_JSON).unwrap();
    assert_eq!(manifest["format_version"], seed["version"]);
    assert_eq!(manifest["generated_at"], seed["generated_at"]);
    assert_eq!(
        manifest["entry_count"].as_u64(),
        Some(seed["entries"].as_array().unwrap().len() as u64)
    );
    assert_eq!(
        manifest["caldwell_count"].as_u64(),
        Some(seed["caldwell"].as_array().unwrap().len() as u64)
    );

    // The source is recorded so a rebuild is reproducible offline from the
    // recorded transcript: every query template and the digests of what ran.
    let source = &manifest["source"];
    assert_eq!(source["endpoint"], "https://simbad.cds.unistra.fr/simbad/sim-tap/sync");
    let templates = source["query_templates"].as_array().unwrap();
    assert!(templates.iter().any(|q| q.as_str().is_some_and(|q| q.contains("galdim_majaxis"))));
    assert!(source["query_count"].as_u64().is_some_and(|n| n > 0));
    for key in ["queries_sha256", "responses_sha256"] {
        let value = source[key].as_str().unwrap_or_default();
        assert!(
            value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()),
            "{key}: {value}"
        );
    }

    let provenance = INDEX.provenance();
    assert_eq!(provenance.sha256, digest);
    assert_eq!(provenance.version, 2);
    assert_eq!(provenance.dataset, format!("bundled-seed/v2/sha256:{}", &digest[..16]));
    assert_eq!(Some(provenance.target_count as u64), manifest["entry_count"].as_u64());
}
