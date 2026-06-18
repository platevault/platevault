//! Conformance: the signed catalog manifest wire format must round-trip
//! identically through BOTH the backend download parser
//! (`targeting_catalogs::download`) AND the language-neutral contract DTO
//! (`contracts_core::catalogs`).
//!
//! Spec 033 Phase 0 / F1: the two structs previously disagreed on field
//! casing — `download.rs` had no `#[serde(rename_all)]` (snake_case wire:
//! `catalog_id`, `size_bytes`) while the published contract DTO is camelCase
//! (`catalogId`, `sizeBytes`). The canonical wire casing is **camelCase**
//! (matches the published contract + generated TS bindings). The build script
//! in `astro-plan-catalogs` emits — and the minisign signature covers — these
//! same camelCase bytes (see `manifest_signed_bytes`).
//!
//! These tests lock that decision so a future drift on either side fails CI.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

use contracts_core::catalogs::{CatalogManifest, ManifestCatalogEntry};
use targeting_catalogs::download::{parse_manifest, Manifest};

/// A representative real-shape manifest in the canonical (camelCase) wire form,
/// covering the three v1 catalogs from the closed slug enum.
const CANONICAL_MANIFEST_CAMEL: &str = r#"{
  "version": "2026.06.18",
  "signature": "untrusted comment: signature\nRWQ=\n",
  "catalogs": [
    {
      "catalogId": "openngc",
      "version": "2026.06.18",
      "url": "https://github.com/sjors/astro-plan-catalogs/releases/latest/download/openngc.json",
      "checksum": "0000000000000000000000000000000000000000000000000000000000000000",
      "license": "cc-by-sa-4.0",
      "sizeBytes": 1048576
    },
    {
      "catalogId": "common",
      "version": "2026.06.18",
      "url": "https://github.com/sjors/astro-plan-catalogs/releases/latest/download/common.json",
      "checksum": "1111111111111111111111111111111111111111111111111111111111111111",
      "license": "public-domain",
      "sizeBytes": 4096
    },
    {
      "catalogId": "abell_pn",
      "version": "2026.06.18",
      "url": "https://github.com/sjors/astro-plan-catalogs/releases/latest/download/abell_pn.json",
      "checksum": "2222222222222222222222222222222222222222222222222222222222222222",
      "license": "public-domain",
      "sizeBytes": 8192
    }
  ]
}"#;

/// The same payload in the OLD snake_case shape that F1 eliminated. Both
/// parsers must REJECT it so the wire casing cannot silently regress.
const LEGACY_MANIFEST_SNAKE: &str = r#"{
  "version": "2026.06.18",
  "signature": "sig",
  "catalogs": [
    {
      "catalog_id": "openngc",
      "version": "2026.06.18",
      "url": "https://example.com/openngc.json",
      "checksum": "0000000000000000000000000000000000000000000000000000000000000000",
      "license": "cc-by-sa-4.0",
      "size_bytes": 1048576
    }
  ]
}"#;

#[test]
fn canonical_manifest_parses_through_download_parser() {
    let parsed: Manifest = parse_manifest(CANONICAL_MANIFEST_CAMEL.as_bytes())
        .expect("download parser must accept camelCase");
    assert_eq!(parsed.version, "2026.06.18");
    assert_eq!(parsed.catalogs.len(), 3);
    assert_eq!(parsed.catalogs[0].catalog_id, "openngc");
    assert_eq!(parsed.catalogs[0].size_bytes, 1_048_576);
    assert_eq!(parsed.catalogs[2].catalog_id, "abell_pn");
}

#[test]
fn canonical_manifest_parses_through_contract_dto() {
    let parsed: CatalogManifest =
        serde_json::from_str(CANONICAL_MANIFEST_CAMEL).expect("contract DTO must accept camelCase");
    assert_eq!(parsed.version, "2026.06.18");
    assert_eq!(parsed.catalogs.len(), 3);
    assert_eq!(parsed.catalogs[0].catalog_id, "openngc");
    assert_eq!(parsed.catalogs[0].size_bytes, 1_048_576);
}

/// The load-bearing assertion: the SAME bytes deserialize to field-identical
/// values on both sides. If either struct drifts (renames a field, changes
/// casing, adds/removes a wire field), this fails.
#[test]
fn download_parser_and_contract_dto_agree_field_for_field() {
    let from_download: Manifest =
        parse_manifest(CANONICAL_MANIFEST_CAMEL.as_bytes()).expect("download parse");
    let from_contract: CatalogManifest =
        serde_json::from_str(CANONICAL_MANIFEST_CAMEL).expect("contract parse");

    assert_eq!(from_download.version, from_contract.version);
    assert_eq!(from_download.signature, from_contract.signature);
    assert_eq!(from_download.catalogs.len(), from_contract.catalogs.len());

    for (d, c) in from_download.catalogs.iter().zip(from_contract.catalogs.iter()) {
        let c: &ManifestCatalogEntry = c;
        assert_eq!(d.catalog_id, c.catalog_id, "catalogId must agree");
        assert_eq!(d.version, c.version, "version must agree");
        assert_eq!(d.url, c.url, "url must agree");
        assert_eq!(d.checksum, c.checksum, "checksum must agree");
        assert_eq!(d.license, c.license, "license must agree");
        assert_eq!(d.size_bytes, c.size_bytes, "sizeBytes must agree");
    }
}

#[test]
fn legacy_snake_case_is_rejected_by_download_parser() {
    // Required camelCase field `catalogId` is absent → serde "missing field".
    assert!(
        parse_manifest(LEGACY_MANIFEST_SNAKE.as_bytes()).is_err(),
        "snake_case manifest must NOT parse — wire casing is locked to camelCase"
    );
}

#[test]
fn legacy_snake_case_is_rejected_by_contract_dto() {
    let result: Result<CatalogManifest, _> = serde_json::from_str(LEGACY_MANIFEST_SNAKE);
    assert!(result.is_err(), "snake_case manifest must NOT parse into the contract DTO either");
}
