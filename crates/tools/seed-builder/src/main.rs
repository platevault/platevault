// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Seed builder for the bundled target catalogue (spec 035 T015; spec 072
//! PLAN-TGT-FR-02 catalogue membership, PLAN-TGT-FR-11 angular size).
//!
//! Queries the SIMBAD TAP sync endpoint (CDS) and emits the bundled seed asset
//! (`assets/seed/seed.json`) plus its manifest (`assets/seed/seed.manifest.json`).
//! The app embeds the committed asset with `include_bytes!`, so building the
//! app never touches the network. This binary is NOT part of the shipped app;
//! a maintainer runs it when the seed needs (re)building.
//!
//! # What it pulls
//!
//! - The full **Messier** catalogue (`M 1` … `M 110`), kept whatever SIMBAD's
//!   object type (M 40 is `?`, M 73 is `err`).
//! - The **Caldwell** objects, via the committed C1–C109 → NGC/IC map
//!   (`targeting_resolver::caldwell`), since Caldwell is not a SIMBAD
//!   designation (research.md R2). Each resolves to a SIMBAD oid, written to
//!   the seed's `caldwell` cross-ID table; the build fails if any does not.
//! - Catalogue families per mode (below).
//!
//! For each object it records: SIMBAD `oid` (dedup key), the canonical
//! `main_id` (collapsed to single-space form), ICRS J2000 ra/dec (deg), the
//! mapped `ObjectType`, V magnitude, the angular size from SIMBAD
//! `galdim_majaxis`/`galdim_minaxis` (arcmin) and `galdim_angle` (deg), or
//! `null` when SIMBAD records no major axis, and the alias set (recognised
//! catalogue designations + `NAME …` common names).
//!
//! # Reproducibility
//!
//! The base-row queries order their rows. The alias query keeps SIMBAD's
//! own identifier order, because the first `NAME …` alias becomes the
//! common name and SIMBAD lists the established name first ("Andromeda",
//! not the alphabetical "And Nebula"). `--record <file>` writes the full
//! query/response transcript; `--replay <file>` rebuilds byte-identical
//! output from that transcript with no network access. The manifest records
//! the asset digest, the query templates, and SHA-256 digests of the executed
//! queries, the responses and the transcript, so a rebuild can be checked
//! against the committed asset.
//!
//! # Usage
//!
//! ```text
//! # DEFAULT — the curated "popular catalogues" seed. This is what ships:
//! cargo run -p seed-builder --release -- --out assets/seed/seed.json \
//!     --record ~/tmp/seed-transcript.json
//! # Rebuild offline from a recorded transcript:
//! cargo run -p seed-builder --release -- --out assets/seed/seed.json \
//!     --replay ~/tmp/seed-transcript.json
//!
//! # Fast smoke build: Messier + Caldwell + the first N NGC objects only:
//! cargo run -p seed-builder -- --out /tmp/seed.json --ngc 500
//!
//! # COMPLETE seed (everything, much larger; not the committed asset):
//! cargo run -p seed-builder --release -- --out /tmp/seed.json --full
//! ```
//!
//! Modes (Messier + Caldwell are always pulled):
//!
//! `--popular` (DEFAULT): all NGC + IC + Sharpless (`SH  2-`) + LBN + LDN +
//! Barnard + vdB (`VDB`) + Abell-PN (`PN A66`) + Melotte (`Cl Melotte`).
//! Rows SIMBAD types as "other" (mostly stellar members carrying a prefixed
//! cross-ID) are dropped unless they are Messier or Caldwell objects.
//!
//! `--slice` / `--ngc N`: Messier + Caldwell + the first `N` NGC objects.
//!
//! `--full`: the popular families plus `ACO` and `APG`, keeping "other" rows.
//!
//! `--generated-at <RFC 3339>` pins the recorded build time (default: now;
//! a replay reuses the transcript's).

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;
use std::time::Duration;

use domain_core::ids::Timestamp;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use targeting_resolver::caldwell;
use targeting_resolver::map_otype;
// Shared SIMBAD `basic`-row tokenizer (US11 T145).
use targeting_resolver::simbad::parse_basic_row;
use targeting_resolver::{AliasKind, ObjectType};

type BoxError = Box<dyn std::error::Error>;

const TAP_ENDPOINT: &str = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";
const USER_AGENT: &str = "astro-plan-seed-builder/0.2 (+https://github.com/; spec-072)";
/// Seed document format: 2 adds `angular_size` per entry and the `caldwell`
/// cross-ID table.
const FORMAT_VERSION: u32 = 2;

/// Base-row columns; `parse_basic_row` reads the first six, the builder reads
/// the three `galdim_*` columns after them.
const BASIC_COLUMNS: &str = "b.oid, b.main_id, b.ra, b.dec, b.otype_txt, f.V, \
     b.galdim_majaxis, b.galdim_minaxis, b.galdim_angle";
const BASIC_FROM: &str = "FROM basic AS b JOIN ident AS i ON i.oidref = b.oid \
     LEFT OUTER JOIN allfluxes AS f ON f.oidref = b.oid";
/// `{like}`: one ADQL `LIKE` pattern per catalogue family.
const PREFIX_TEMPLATE: &str = "SELECT DISTINCT {columns} {from} WHERE i.id LIKE '{like}' \
     AND b.ra IS NOT NULL AND b.dec IS NOT NULL ORDER BY oid";
/// `{ids}`: up to 100 quoted identifiers.
const EXACT_TEMPLATE: &str = "SELECT DISTINCT {columns}, i.id {from} WHERE i.id IN ({ids}) \
     AND b.ra IS NOT NULL AND b.dec IS NOT NULL ORDER BY oid, id";
/// `{oids}`: up to 200 SIMBAD oids. Unordered on purpose (see Reproducibility).
const ALIAS_TEMPLATE: &str = "SELECT i.oidref, i.id FROM ident AS i WHERE i.oidref IN ({oids})";

/// Alias prefixes we keep in the seed (recognised catalogue designations). All
/// other SIMBAD cross-IDs (survey/instrument identifiers) are dropped to keep
/// the asset small and the typeahead clean. `NAME ` aliases are handled
/// separately as common names.
const KEPT_ALIAS_PREFIXES: &[&str] = &[
    "M ",
    "NGC ",
    "IC ",
    "SH 2-",
    "Sh 2-",
    "Barnard ",
    "PN A66 ",
    "ACO ",
    "APG ",
    "VDB ",
    "vdB ",
    "LBN ",
    "LDN ",
    "Cl Melotte ",
    "Mel ",
    "C ",
];

const POPULAR_PREFIXES: &[&str] = &[
    "NGC %",
    "IC %",
    // SIMBAD stores Sharpless padded (`SH  2-155`); `LIKE` does not collapse it.
    "SH  2-%",
    "LBN %",
    "LDN %",
    "Barnard %",
    "PN A66 %",
    "VDB %",
    "Cl Melotte %",
];
const FULL_EXTRA_PREFIXES: &[&str] = &["ACO %", "APG %"];

/// Build mode (which catalogue families to pull).
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Mode {
    /// Messier + Caldwell + a small `--ngc N` slice (fast smoke build).
    Slice,
    /// Curated "popular catalogues" (DEFAULT, the committed asset).
    Popular,
    /// Every family, keeping "other" rows. Slow + large.
    Full,
}

// ── Output documents ────────────────────────────────────────────────────────

#[derive(Serialize)]
struct SeedDocument {
    version: u32,
    generated_at: String,
    source: String,
    caldwell: Vec<CaldwellRow>,
    entries: Vec<SeedRow>,
}

/// One Caldwell cross-ID: the Caldwell number and the SIMBAD object it names.
#[derive(Serialize)]
struct CaldwellRow {
    number: u16,
    /// The SIMBAD identifier queried for this Caldwell object.
    designation: String,
    simbad_oid: i64,
}

#[derive(Serialize)]
struct SeedRow {
    simbad_oid: Option<i64>,
    primary_designation: String,
    common_name: Option<String>,
    object_type: ObjectType,
    ra_deg: f64,
    dec_deg: f64,
    v_mag: Option<f64>,
    /// Always written: `null` records that SIMBAD has no catalogued size.
    angular_size: Option<AngularSize>,
    aliases: Vec<SeedAlias>,
}

#[derive(Clone, Copy, Serialize)]
struct AngularSize {
    major_arcmin: f64,
    minor_arcmin: Option<f64>,
    pa_deg: Option<f64>,
}

#[derive(Serialize)]
struct SeedAlias {
    alias: String,
    kind: AliasKind,
}

#[derive(Serialize)]
struct Manifest {
    asset: String,
    sha256: String,
    bytes: usize,
    format_version: u32,
    generated_at: String,
    mode: Mode,
    entry_count: usize,
    caldwell_count: usize,
    source: ManifestSource,
}

#[derive(Serialize)]
struct ManifestSource {
    service: &'static str,
    endpoint: &'static str,
    query_templates: Vec<String>,
    like_patterns: Vec<String>,
    query_count: usize,
    /// SHA-256 over every executed ADQL query, in order, each followed by a NUL.
    queries_sha256: String,
    /// SHA-256 over every TAP response body, in order, each followed by a NUL.
    responses_sha256: String,
    /// SHA-256 of the `--record` transcript JSON this build wrote or replayed.
    transcript_sha256: String,
}

/// Every query and response of one build, replayable offline.
#[derive(Serialize, Deserialize)]
struct Transcript {
    generated_at: String,
    mode: Mode,
    ngc_slice: u32,
    exchanges: Vec<Exchange>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Exchange {
    query: String,
    response: String,
}

// ── TAP access (live or replayed) ───────────────────────────────────────────

struct Tap {
    client: Option<reqwest::blocking::Client>,
    replay: Option<VecDeque<Exchange>>,
    exchanges: Vec<Exchange>,
}

impl Tap {
    fn live() -> Result<Self, BoxError> {
        let client = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_mins(2))
            .build()?;
        Ok(Self { client: Some(client), replay: None, exchanges: Vec::new() })
    }

    fn replay(exchanges: Vec<Exchange>) -> Self {
        Self { client: None, replay: Some(exchanges.into()), exchanges: Vec::new() }
    }

    /// Run one ADQL query, returning the data rows (header stripped).
    fn query(&mut self, query: &str) -> Result<Vec<String>, BoxError> {
        let response = if let Some(replay) = &mut self.replay {
            let next = replay.pop_front().ok_or("the replay transcript ran out of responses")?;
            if next.query != query {
                return Err(format!(
                    "replay diverged at query {}: the transcript recorded a different query",
                    self.exchanges.len() + 1
                )
                .into());
            }
            next.response
        } else {
            let client = self.client.as_ref().ok_or("no TAP client")?;
            let url = format!(
                "{TAP_ENDPOINT}?request=doQuery&lang=ADQL&format=tsv&query={}",
                url_encode(query)
            );
            client.get(&url).send()?.error_for_status()?.text()?
        };
        if response.trim_start().starts_with('<') {
            return Err(format!("SIMBAD rejected the query: {}", first_line(&response)).into());
        }
        let rows = response
            .lines()
            .skip(1) // header row
            .filter(|l| !l.trim().is_empty())
            .map(str::to_owned)
            .collect();
        self.exchanges.push(Exchange { query: query.to_owned(), response });
        Ok(rows)
    }

    fn finish(&self) -> Result<(), BoxError> {
        match &self.replay {
            Some(rest) if !rest.is_empty() => {
                Err(format!("{} recorded responses were never replayed", rest.len()).into())
            }
            _ => Ok(()),
        }
    }
}

fn first_line(s: &str) -> &str {
    s.lines().find(|l| l.contains("QUERY_STATUS")).unwrap_or_else(|| s.lines().next().unwrap_or(""))
}

// ── Build ───────────────────────────────────────────────────────────────────

struct Options {
    out: String,
    ngc_slice: u32,
    mode: Mode,
    generated_at: Option<String>,
    record: Option<String>,
    replay: Option<String>,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut options = Options {
        out: String::from("assets/seed/seed.json"),
        ngc_slice: 200,
        mode: Mode::Popular,
        generated_at: None,
        record: None,
        replay: None,
    };
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].clone();
        let mut value = || {
            i += 1;
            args.get(i).cloned().unwrap_or_else(|| {
                eprintln!("{arg} needs a value");
                std::process::exit(2);
            })
        };
        match arg.as_str() {
            "--out" => options.out = value(),
            "--ngc" => {
                options.ngc_slice = value().parse().unwrap_or(options.ngc_slice);
                options.mode = Mode::Slice;
            }
            "--generated-at" => options.generated_at = Some(value()),
            "--record" => options.record = Some(value()),
            "--replay" => options.replay = Some(value()),
            "--slice" => options.mode = Mode::Slice,
            "--popular" => options.mode = Mode::Popular,
            "--full" => options.mode = Mode::Full,
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    if let Err(e) = run(options) {
        eprintln!("seed-builder failed: {e}");
        std::process::exit(1);
    }
}

/// Object accumulated across queries, keyed by SIMBAD oid.
struct Found {
    primary: String,
    common_name: Option<String>,
    object_type: ObjectType,
    ra_deg: f64,
    dec_deg: f64,
    v_mag: Option<f64>,
    angular_size: Option<AngularSize>,
    aliases: Vec<SeedAlias>,
}

/// Everything one build pulled, ready to write.
struct Pulled {
    caldwell: Vec<CaldwellRow>,
    entries: Vec<SeedRow>,
    like_patterns: Vec<String>,
}

fn run(mut options: Options) -> Result<(), BoxError> {
    let mut tap = match &options.replay {
        Some(path) => {
            let transcript: Transcript = serde_json::from_slice(&std::fs::read(path)?)?;
            options.generated_at = Some(transcript.generated_at);
            options.mode = transcript.mode;
            options.ngc_slice = transcript.ngc_slice;
            Tap::replay(transcript.exchanges)
        }
        None => Tap::live()?,
    };
    let generated_at = options.generated_at.clone().unwrap_or_else(Timestamp::now_iso);
    let mode = options.mode;
    let Pulled { caldwell, entries, like_patterns } = pull(&mut tap, mode, options.ngc_slice)?;

    let document = SeedDocument {
        version: FORMAT_VERSION,
        generated_at: generated_at.clone(),
        source: format!("SIMBAD TAP (CDS, {TAP_ENDPOINT}) — seed-builder"),
        caldwell,
        entries,
    };
    let mut json = serde_json::to_string_pretty(&document)?;
    json.push('\n');

    let transcript = Transcript {
        generated_at: generated_at.clone(),
        mode,
        ngc_slice: options.ngc_slice,
        exchanges: tap.exchanges,
    };
    let transcript_json = serde_json::to_vec(&transcript)?;
    if let Some(path) = &options.record {
        std::fs::write(path, &transcript_json)?;
        eprintln!("recorded {} exchanges to {path}", transcript.exchanges.len());
    }

    let manifest = Manifest {
        asset: Path::new(&options.out)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("--out names no file")?
            .to_owned(),
        sha256: hex::encode(Sha256::digest(json.as_bytes())),
        bytes: json.len(),
        format_version: FORMAT_VERSION,
        generated_at,
        mode,
        entry_count: document.entries.len(),
        caldwell_count: document.caldwell.len(),
        source: ManifestSource {
            service: "SIMBAD TAP (CDS)",
            endpoint: TAP_ENDPOINT,
            query_templates: [PREFIX_TEMPLATE, EXACT_TEMPLATE, ALIAS_TEMPLATE]
                .iter()
                .map(|t| t.replace("{columns}", BASIC_COLUMNS).replace("{from}", BASIC_FROM))
                .collect(),
            like_patterns,
            query_count: transcript.exchanges.len(),
            queries_sha256: digest_all(transcript.exchanges.iter().map(|e| e.query.as_str())),
            responses_sha256: digest_all(transcript.exchanges.iter().map(|e| e.response.as_str())),
            transcript_sha256: hex::encode(Sha256::digest(&transcript_json)),
        },
    };
    let mut manifest_json = serde_json::to_string_pretty(&manifest)?;
    manifest_json.push('\n');

    let out = Path::new(&options.out);
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(out, &json)?;
    let manifest_path = out.with_file_name("seed.manifest.json");
    std::fs::write(&manifest_path, manifest_json)?;
    eprintln!(
        "wrote {} objects ({} Caldwell) to {} (sha256 {}) and {}",
        document.entries.len(),
        document.caldwell.len(),
        out.display(),
        manifest.sha256,
        manifest_path.display()
    );
    Ok(())
}

/// Run every query for `mode` and assemble the sorted seed rows.
fn pull(tap: &mut Tap, mode: Mode, ngc_slice: u32) -> Result<Pulled, BoxError> {
    // oid → object, so an object appearing under several catalogues collapses
    // onto one seed row (matches the cache dedup-by-oid invariant, FR-007).
    let mut by_oid: BTreeMap<i64, Found> = BTreeMap::new();
    let mut like_patterns = vec!["M %".to_owned()];

    eprintln!("pulling Messier catalogue (M 1..M 110)...");
    ingest_prefix(tap, "M %", &mut by_oid)?;

    eprintln!("pulling Caldwell objects (via C1..C109 map)...");
    let caldwell_ids: Vec<(u16, String)> = (1..=109u16)
        .map(|n| caldwell_simbad_id(n).map(|id| (n, id)))
        .collect::<Option<_>>()
        .ok_or("a Caldwell number has no SIMBAD identifier")?;
    let ids: Vec<String> = caldwell_ids.iter().map(|(_, id)| id.clone()).collect();
    let resolved = ingest_exact_ids(tap, &ids, &mut by_oid)?;
    let mut caldwell = Vec::with_capacity(caldwell_ids.len());
    for (number, designation) in caldwell_ids {
        let simbad_oid = *resolved.get(&designation).ok_or_else(|| {
            format!("Caldwell {number} ({designation}) did not resolve in SIMBAD")
        })?;
        caldwell.push(CaldwellRow { number, designation, simbad_oid });
    }

    match mode {
        Mode::Slice => {
            if ngc_slice > 0 {
                eprintln!("pulling NGC slice (NGC 1..NGC {ngc_slice})...");
                let ids: Vec<String> = (1..=ngc_slice).map(|n| format!("NGC {n}")).collect();
                ingest_exact_ids(tap, &ids, &mut by_oid)?;
            }
        }
        Mode::Popular | Mode::Full => {
            let extra = if mode == Mode::Full { FULL_EXTRA_PREFIXES } else { &[] };
            for prefix in POPULAR_PREFIXES.iter().chain(extra) {
                eprintln!("  prefix {prefix}...");
                ingest_prefix(tap, prefix, &mut by_oid)?;
                like_patterns.push((*prefix).to_owned());
            }
        }
    }

    let oids: Vec<i64> = by_oid.keys().copied().collect();
    enrich_aliases(tap, &oids, &mut by_oid)?;
    tap.finish()?;

    // The `basic` row of any object carrying a prefixed cross-ID matches the
    // family LIKEs, which pulls in stellar/cluster MEMBERS (SIMBAD type
    // "other": HD, 2MASS, BD…). The popular seed drops them, except Messier
    // and Caldwell objects, which are kept whatever SIMBAD types them.
    let pinned: BTreeSet<i64> = caldwell
        .iter()
        .map(|c| c.simbad_oid)
        .chain(by_oid.iter().filter(|(_, o)| is_messier(o)).map(|(&oid, _)| oid))
        .collect();
    if mode == Mode::Popular {
        let before = by_oid.len();
        by_oid.retain(|oid, o| o.object_type != ObjectType::Other || pinned.contains(oid));
        eprintln!("--popular cap: dropped {} otype=other members", before - by_oid.len());
    }

    let mut entries: Vec<SeedRow> = by_oid
        .into_iter()
        .map(|(oid, o)| SeedRow {
            simbad_oid: Some(oid),
            primary_designation: o.primary,
            common_name: o.common_name,
            object_type: o.object_type,
            ra_deg: o.ra_deg,
            dec_deg: o.dec_deg,
            v_mag: o.v_mag,
            angular_size: o.angular_size,
            aliases: o.aliases,
        })
        .collect();
    entries.sort_by(|a, b| {
        a.primary_designation.cmp(&b.primary_designation).then(a.simbad_oid.cmp(&b.simbad_oid))
    });
    Ok(Pulled { caldwell, entries, like_patterns })
}

/// The SIMBAD identifier for a Caldwell number. The committed map uses
/// common short forms SIMBAD does not index (`Sh2 155`, `Mel 25`) and lists no
/// designation for C99, the Coalsack, which SIMBAD names.
fn caldwell_simbad_id(number: u16) -> Option<String> {
    if number == 99 {
        return Some("NAME Coalsack Nebula".to_owned());
    }
    let designation = caldwell::caldwell_to_designation(number)?;
    Some(if let Some(n) = designation.strip_prefix("Sh2 ") {
        format!("SH 2-{n}")
    } else if let Some(n) = designation.strip_prefix("Mel ") {
        format!("Cl Melotte {n}")
    } else {
        designation.to_owned()
    })
}

fn is_messier(object: &Found) -> bool {
    object.aliases.iter().any(|a| {
        a.alias
            .strip_prefix("M ")
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
    })
}

/// SIMBAD's object type, with LINER galaxies (`LIN`, M 63/91/98/104/105) and
/// blue compact galaxies (`bCG`) read as galaxies.
fn seed_object_type(otype: &str) -> ObjectType {
    match otype.trim() {
        "LIN" | "bCG" => ObjectType::Galaxy,
        other => map_otype(other),
    }
}

/// Pull every object whose `ident.id` matches an ADQL `LIKE` pattern.
fn ingest_prefix(
    tap: &mut Tap,
    like: &str,
    by_oid: &mut BTreeMap<i64, Found>,
) -> Result<(), BoxError> {
    let q = PREFIX_TEMPLATE
        .replace("{columns}", BASIC_COLUMNS)
        .replace("{from}", BASIC_FROM)
        .replace("{like}", like);
    for row in tap.query(&q)? {
        insert_base(by_oid, &row);
    }
    Ok(())
}

/// Pull a fixed list of exact identifiers (one batched query per chunk),
/// returning each requested identifier's oid.
fn ingest_exact_ids(
    tap: &mut Tap,
    ids: &[String],
    by_oid: &mut BTreeMap<i64, Found>,
) -> Result<BTreeMap<String, i64>, BoxError> {
    let mut resolved = BTreeMap::new();
    for chunk in ids.chunks(100) {
        // SIMBAD's `ident.id` matching collapses internal whitespace, so a
        // single-space designation (`NGC 188`) matches the padded stored form
        // (`NGC   188`).
        let list =
            chunk.iter().map(|id| format!("'{}'", id.replace('\'', "''"))).collect::<Vec<_>>();
        let q = EXACT_TEMPLATE
            .replace("{columns}", BASIC_COLUMNS)
            .replace("{from}", BASIC_FROM)
            .replace("{ids}", &list.join(", "));
        for row in tap.query(&q)? {
            if let Some(oid) = insert_base(by_oid, &row) {
                if let Some(id) = split_tsv(&row).get(9) {
                    resolved.insert(collapse_spaces(&unquote(id)), oid);
                }
            }
        }
    }
    Ok(resolved)
}

/// Insert (or keep) the base row for an object, returning its oid.
fn insert_base(by_oid: &mut BTreeMap<i64, Found>, row: &str) -> Option<i64> {
    let (oid, main_id, ra, dec, otype, v_mag) = parse_basic_row(row)?;
    let cols = split_tsv(row);
    let column = |i: usize| -> Option<f64> {
        unquote(cols.get(i)?).parse::<f64>().ok().filter(|v| v.is_finite())
    };
    let positive = |v: &f64| *v > 0.0;
    let angular_size = column(6).filter(positive).map(|major_arcmin| AngularSize {
        major_arcmin,
        minor_arcmin: column(7).filter(positive),
        pa_deg: column(8).filter(|pa| (0.0..=360.0).contains(pa)),
    });
    let primary = collapse_spaces(&main_id);
    by_oid.entry(oid).or_insert_with(|| Found {
        primary: primary.clone(),
        common_name: None,
        object_type: seed_object_type(&otype),
        ra_deg: ra,
        dec_deg: dec,
        v_mag,
        angular_size,
        aliases: vec![SeedAlias { alias: primary, kind: AliasKind::Designation }],
    });
    Some(oid)
}

/// Fetch the kept aliases + common names for a batch of oids and attach them.
fn enrich_aliases(
    tap: &mut Tap,
    oids: &[i64],
    by_oid: &mut BTreeMap<i64, Found>,
) -> Result<(), BoxError> {
    for chunk in oids.chunks(200) {
        let list = chunk.iter().map(i64::to_string).collect::<Vec<_>>().join(", ");
        let q = ALIAS_TEMPLATE.replace("{oids}", &list);
        for r in tap.query(&q)? {
            let cols = split_tsv(&r);
            let (Some(oid), Some(id_raw)) = (cols.first(), cols.get(1)) else { continue };
            let Ok(oid) = unquote(oid).parse::<i64>() else { continue };
            let id_raw = unquote(id_raw);
            let Some(entry) = by_oid.get_mut(&oid) else { continue };
            if let Some(name) = id_raw.strip_prefix("NAME ") {
                let name = name.trim();
                if entry.common_name.is_none() {
                    entry.common_name = Some(name.to_owned());
                }
                push_alias(entry, name, AliasKind::CommonName);
            } else {
                // Match the collapsed form: SIMBAD pads some families
                // (`SH  2-155`), which a raw prefix test would drop.
                let id = collapse_spaces(&id_raw);
                if KEPT_ALIAS_PREFIXES.iter().any(|p| id.starts_with(p)) {
                    push_alias(entry, &id, AliasKind::Designation);
                }
            }
        }
    }
    Ok(())
}

fn push_alias(entry: &mut Found, alias: &str, kind: AliasKind) {
    if entry.aliases.iter().any(|a| a.alias == alias) {
        return;
    }
    entry.aliases.push(SeedAlias { alias: alias.to_owned(), kind });
}

fn digest_all<'a>(parts: impl Iterator<Item = &'a str>) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    hex::encode(hasher.finalize())
}

/// Percent-encode an ADQL query for use in a URL query string.
fn url_encode(s: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push(HEX[(b >> 4) as usize] as char);
                out.push(HEX[(b & 0x0f) as usize] as char);
            }
        }
    }
    out
}

fn split_tsv(line: &str) -> Vec<&str> {
    line.split('\t').collect()
}

/// Strip SIMBAD's surrounding double quotes (TSV string columns are quoted).
fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').to_owned()
}

/// Collapse internal whitespace runs to single spaces and trim
/// (e.g. SIMBAD `"M   1"` → `"M 1"`, `"NGC  1952"` → `"NGC 1952"`).
fn collapse_spaces(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}
