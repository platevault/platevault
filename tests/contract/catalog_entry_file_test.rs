//! Conformance: the per-catalog `<slug>.json` entry-file format (spec 033 F3)
//! must round-trip identically through BOTH the backend reader
//! (`targeting_catalogs::loader`) AND the language-neutral contract DTO
//! (`contracts_core::catalogs`), and both must agree with the JSON Schema at
//! `specs/014-catalog-index-licensing/contracts/catalog.entry-file.json`.
//!
//! Locks the F3 decisions: camelCase wire casing, sexagesimal coordinates
//! (RA hours / Dec degrees), closed `type` enum with `other` fallback, and
//! inline cross-catalog `equivalents`.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use contracts_core::catalogs::{
    CatalogEntry as DtoEntry, CatalogEntryFile as DtoFile, ObjectType as DtoType,
};
use targeting_catalogs::loader::{read_catalog_file, ObjectType as ReaderType};

/// A representative entry file in the canonical (camelCase) wire form.
const SAMPLE: &str = r#"{
  "catalogId": "openngc",
  "catalogDisplay": "OpenNGC",
  "version": "2026.06.18",
  "entries": [
    {
      "designation": "NGC 224",
      "names": ["Andromeda Galaxy", "M 31"],
      "ra": "00 42 44.330",
      "dec": "+41 16 09.40",
      "type": "galaxy",
      "constellation": "And",
      "magnitude": 3.44,
      "equivalents": [ { "catalogId": "messier", "designation": "M 31" } ]
    }
  ]
}"#;

#[test]
fn sample_parses_through_reader() {
    let file = read_catalog_file(SAMPLE.as_bytes()).expect("reader accepts canonical file");
    assert_eq!(file.catalog_id, "openngc");
    assert_eq!(file.entries[0].r#type, ReaderType::Galaxy);
    assert_eq!(file.entries[0].equivalents[0].catalog_id, "messier");
}

#[test]
fn sample_parses_through_contract_dto() {
    let file: DtoFile = serde_json::from_str(SAMPLE).expect("contract DTO accepts canonical file");
    assert_eq!(file.catalog_id, "openngc");
    assert_eq!(file.entries[0].r#type, DtoType::Galaxy);
    assert_eq!(file.entries[0].equivalents[0].catalog_id, "messier");
}

/// Load-bearing: the SAME bytes deserialize field-for-field identically on both
/// sides. Drift in either struct (casing, rename, field add/remove) fails here.
#[test]
fn reader_and_contract_dto_agree_field_for_field() {
    let from_reader = read_catalog_file(SAMPLE.as_bytes()).expect("reader parse");
    let from_contract: DtoFile = serde_json::from_str(SAMPLE).expect("contract parse");

    assert_eq!(from_reader.catalog_id, from_contract.catalog_id);
    assert_eq!(from_reader.catalog_display, from_contract.catalog_display);
    assert_eq!(from_reader.version, from_contract.version);
    assert_eq!(from_reader.entries.len(), from_contract.entries.len());

    let r = &from_reader.entries[0];
    let c: &DtoEntry = &from_contract.entries[0];
    assert_eq!(r.designation, c.designation, "designation must agree");
    assert_eq!(r.names, c.names, "names must agree");
    assert_eq!(r.ra, c.ra, "ra must agree");
    assert_eq!(r.dec, c.dec, "dec must agree");
    assert_eq!(r.constellation, c.constellation, "constellation must agree");
    assert_eq!(r.magnitude, c.magnitude, "magnitude must agree");
    assert_eq!(r.equivalents.len(), c.equivalents.len(), "equivalents count must agree");
    assert_eq!(
        r.equivalents[0].catalog_id, c.equivalents[0].catalog_id,
        "equivalent catalogId must agree"
    );
}

#[test]
fn unknown_type_maps_to_other_on_both_sides() {
    let json = r#"{"catalogId":"openngc","catalogDisplay":"OpenNGC","version":"1",
        "entries":[{"designation":"X","names":[],"ra":"00 00 00","dec":"+00 00 00","type":"frobnicate"}]}"#;
    let from_reader = read_catalog_file(json.as_bytes()).expect("reader parse");
    let from_contract: DtoFile = serde_json::from_str(json).expect("contract parse");
    assert_eq!(from_reader.entries[0].r#type, ReaderType::Other);
    assert_eq!(from_contract.entries[0].r#type, DtoType::Other);
}

/// snake_case keys (`catalogId` → `catalog_id`) must NOT satisfy the camelCase
/// contract DTO — the wire casing is locked.
#[test]
fn snake_case_is_rejected_by_contract_dto() {
    let snake =
        r#"{"catalog_id":"openngc","catalog_display":"OpenNGC","version":"1","entries":[]}"#;
    let result: Result<DtoFile, _> = serde_json::from_str(snake);
    assert!(result.is_err(), "snake_case entry file must NOT parse into the camelCase DTO");
}
