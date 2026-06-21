//! One-time offline seed builder for spec 035 (SIMBAD Target Resolution, T015).
//!
//! Queries the SIMBAD TAP sync endpoint (CDS) and emits the bundled seed asset
//! (`assets/seed/seed.json`) that
//! the app loads into its local cache at first run
//! (`targeting_resolver::seed`). This binary is NOT part of the shipped app; it
//! is run by a maintainer when the seed needs (re)building.
//!
//! # What it pulls
//!
//! - The full **Messier** catalogue (`M 1` … `M 110`).
//! - The **Caldwell** objects, via the committed C1–C109 → NGC/IC map
//!   (`targeting_resolver::caldwell`), since Caldwell is not a SIMBAD
//!   designation (research.md R2).
//! - Optionally a slice of **NGC** (`--ngc <N>`), and the full set when run with
//!   the documented prefix list below.
//!
//! For each object it records: SIMBAD `oid` (dedup key), the canonical
//! `main_id` (collapsed to single-space form), ICRS J2000 ra/dec (deg), the
//! mapped `ObjectType`, and the alias set (recognised catalog designations +
//! `NAME …` common names).
//!
//! # Usage
//!
//! ```text
//! # DEFAULT — the curated "popular catalogues" seed (spec 035 scale, ~14k
//! # objects / a few MB). This is what ships as the committed asset:
//! cargo run -p seed-builder --release -- --out assets/seed/seed.json
//! cargo run -p seed-builder --release -- --out assets/seed/seed.json --popular
//!
//! # Fast smoke build: Messier + Caldwell + the first N NGC objects only:
//! cargo run -p seed-builder -- --out assets/seed/seed.json --ngc 500
//! cargo run -p seed-builder -- --out assets/seed/seed.json --slice --ngc 200
//!
//! # COMPLETE seed (everything, ~56k objects / ~19.5 MB). Large + slow; not the
//! # committed asset. Run deliberately:
//! cargo run -p seed-builder --release -- --out assets/seed/seed.json --full
//! ```
//!
//! Modes (Messier + Caldwell map are always pulled):
//!
//! `--popular` (DEFAULT): all NGC + all IC + Sharpless (`SH  2-`) + Barnard +
//! vdB (`VDB`) + Abell-PN (`PN A66`) + Melotte (`Cl Melotte`). Named (`NAME …`)
//! common names ride along via alias enrichment. EXCLUDES the bulk obscure sets
//! that inflated `--full`: ACO (Abell galaxy clusters), and the full LDN / LBN
//! dark/bright-nebula lists (and APG/Arp).
//!
//! `--slice` / `--ngc N`: Messier + Caldwell + the first `N` NGC objects.
//!
//! `--full`: every R2 prefix family incl. `ACO`, `APG`, `LBN`, `LDN`.
//!
//! Network host used: `simbad.cds.unistra.fr` (TAP). `OpenNGC`
//! (`raw.githubusercontent.com`) is reachable and can be folded in for richer
//! NGC/IC coverage when the seed is rebuilt; the committed asset is sourced from
//! SIMBAD alone.

use std::collections::BTreeMap;
use std::time::Duration;

use domain_core::ids::Timestamp;
use targeting_resolver::caldwell;
use targeting_resolver::map_otype;
// Shared SIMBAD `basic`-row tokenizer (US11 T145). Replaces the local copy.
use targeting_resolver::seed::{SeedAlias, SeedAsset, SeedEntry};
use targeting_resolver::simbad::parse_basic_row;
use targeting_resolver::{AliasKind, ObjectType};

const TAP_ENDPOINT: &str = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";
const USER_AGENT: &str = "astro-plan-seed-builder/0.1 (+https://github.com/; spec-035)";

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

/// Build mode (which catalogue families to pull).
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// Messier + Caldwell + a small `--ngc N` slice (fast smoke build).
    Slice,
    /// Curated "popular catalogues" (DEFAULT): all NGC, all IC, Messier,
    /// Caldwell, named (`NAME …`), Sharpless, Barnard, vdB, Abell-PN, Melotte.
    /// EXCLUDES the bulk obscure sets (ACO, LDN, LBN) that bloated `--full`.
    /// Targets the spec's ~14k-object / few-MB scale.
    Popular,
    /// Everything (incl. ACO/LDN/LBN) — ~56k objects / ~19.5 MB. Slow + large.
    Full,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut out = String::from("assets/seed/seed.json");
    let mut ngc_slice: u32 = 200;
    // Default to the curated "popular" set (spec 035 seed scaling).
    let mut mode = Mode::Popular;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                i += 1;
                out = args.get(i).cloned().unwrap_or(out);
            }
            "--ngc" => {
                i += 1;
                ngc_slice = args.get(i).and_then(|v| v.parse().ok()).unwrap_or(ngc_slice);
                mode = Mode::Slice;
            }
            "--slice" => mode = Mode::Slice,
            "--popular" => mode = Mode::Popular,
            "--full" => mode = Mode::Full,
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    if let Err(e) = run(&out, ngc_slice, mode) {
        eprintln!("seed-builder failed: {e}");
        std::process::exit(1);
    }
}

fn run(out: &str, ngc_slice: u32, mode: Mode) -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_mins(2))
        .build()?;

    // oid -> entry, so an object appearing under several catalogues collapses
    // onto one seed row (matches the cache dedup-by-oid invariant, FR-007).
    let mut by_oid: BTreeMap<i64, SeedEntry> = BTreeMap::new();

    // 1) Messier M 1..M 110.
    eprintln!("pulling Messier catalogue (M 1..M 110)…");
    ingest_prefix(&client, "M %", &mut by_oid)?;

    // 2) Caldwell objects via the committed map → their NGC/IC designation.
    eprintln!("pulling Caldwell objects (via C1..C109 map)…");
    let mut caldwell_ids: Vec<String> = Vec::new();
    for n in 1..=109u16 {
        if let Some(desig) = caldwell::caldwell_to_designation(n) {
            // Single-space designation form; SIMBAD's `ident.id` IN-match
            // collapses internal whitespace so this matches the padded store.
            caldwell_ids.push(desig.to_owned());
        }
    }
    ingest_exact_ids(&client, &caldwell_ids, &mut by_oid)?;

    // 3) Catalogue families per mode.
    match mode {
        Mode::Slice => {
            if ngc_slice > 0 {
                eprintln!("pulling NGC slice (NGC 1..NGC {ngc_slice})…");
                let ids: Vec<String> = (1..=ngc_slice).map(|n| format!("NGC {n}")).collect();
                ingest_exact_ids(&client, &ids, &mut by_oid)?;
            }
        }
        Mode::Popular => {
            // Curated "popular catalogues" (DEFAULT). Includes all NGC + all IC
            // + Sharpless + Barnard + vdB + Abell-PN + Melotte. Named (`NAME …`)
            // common names ride along via alias enrichment on these objects.
            // EXCLUDES the bulk obscure sets — ACO (Abell galaxy clusters),
            // LDN and LBN dark/bright-nebula lists — which inflated `--full`.
            eprintln!("--popular: pulling curated catalogue prefixes…");
            for prefix in
                ["NGC %", "IC %", "SH  2-%", "Barnard %", "PN A66 %", "VDB %", "Cl Melotte %"]
            {
                eprintln!("  prefix {prefix}…");
                ingest_prefix(&client, prefix, &mut by_oid)?;
            }
        }
        Mode::Full => {
            eprintln!("--full: pulling ALL catalogue prefixes (slow, large)…");
            for prefix in [
                "NGC %",
                "IC %",
                "SH  2-%",
                "Barnard %",
                "PN A66 %",
                "ACO %",
                "APG %",
                "VDB %",
                "LBN %",
                "LDN %",
                "Cl Melotte %",
            ] {
                eprintln!("  prefix {prefix}…");
                ingest_prefix(&client, prefix, &mut by_oid)?;
            }
        }
    }

    let mut entries: Vec<SeedEntry> = by_oid.into_values().collect();

    // Cap (spec 035 scaling): the curated `--popular` prefix LIKEs match the
    // `basic` row of any object carrying a prefixed cross-ID — which pulls in
    // tens of thousands of stellar/cluster MEMBERS (otype `Other`: HD, 2MASS,
    // BD…) that are not popular imaging targets. Drop unmapped `Other` rows so
    // the popular seed is the recognised DSO set (galaxy/nebula/cluster/…),
    // landing at the spec's intended ~13–14k objects / few-MB scale instead of
    // ~49k / ~17 MB. `--full` and `--slice` keep every row.
    if mode == Mode::Popular {
        let before = entries.len();
        entries.retain(|e| e.object_type != ObjectType::Other);
        eprintln!(
            "--popular cap: kept {} recognised-DSO objects (dropped {} otype=Other members)",
            entries.len(),
            before - entries.len()
        );
    }

    entries.sort_by(|a, b| a.primary_designation.cmp(&b.primary_designation));

    let asset = SeedAsset {
        version: 1,
        generated_at: Timestamp::now_iso(),
        source: "SIMBAD TAP (CDS, https://simbad.cds.unistra.fr) — spec 035 seed-builder"
            .to_owned(),
        entries,
    };

    let json = serde_json::to_string_pretty(&asset)?;
    if let Some(parent) = std::path::Path::new(out).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(out, json)?;
    eprintln!("wrote {} objects to {out}", asset.entries.len());
    Ok(())
}

/// Pull every object whose `ident.id` matches an ADQL `LIKE` pattern, plus its
/// aliases, in batched per-object alias queries.
fn ingest_prefix(
    client: &reqwest::blocking::Client,
    like: &str,
    by_oid: &mut BTreeMap<i64, SeedEntry>,
) -> Result<(), Box<dyn std::error::Error>> {
    let q = format!(
        "SELECT DISTINCT b.oid, b.main_id, b.ra, b.dec, b.otype_txt \
         FROM basic AS b JOIN ident AS i ON i.oidref = b.oid \
         WHERE i.id LIKE '{like}' AND b.ra IS NOT NULL AND b.dec IS NOT NULL"
    );
    let rows = tap_query(client, &q)?;
    let oids: Vec<i64> =
        rows.iter().filter_map(|r| parse_basic_row(r)).map(|(oid, ..)| oid).collect();
    for r in &rows {
        if let Some((oid, main_id, ra, dec, otype)) = parse_basic_row(r) {
            insert_base(by_oid, oid, &main_id, ra, dec, &otype);
        }
    }
    enrich_aliases(client, &oids, by_oid)?;
    Ok(())
}

/// Pull a fixed list of exact identifiers (one batched query per chunk).
fn ingest_exact_ids(
    client: &reqwest::blocking::Client,
    ids: &[String],
    by_oid: &mut BTreeMap<i64, SeedEntry>,
) -> Result<(), Box<dyn std::error::Error>> {
    for chunk in ids.chunks(100) {
        // SIMBAD's `ident.id` matching collapses internal whitespace, so a
        // single-space designation (`NGC 188`) matches the padded stored form
        // (`NGC   188`). No REPLACE UDF needed (SIMBAD TAP has none).
        let list = chunk
            .iter()
            .map(|id| format!("'{}'", id.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(", ");
        let q = format!(
            "SELECT DISTINCT b.oid, b.main_id, b.ra, b.dec, b.otype_txt \
             FROM basic AS b JOIN ident AS i ON i.oidref = b.oid \
             WHERE i.id IN ({list}) AND b.ra IS NOT NULL AND b.dec IS NOT NULL"
        );
        let rows = tap_query(client, &q)?;
        let mut oids = Vec::new();
        for r in &rows {
            if let Some((oid, main_id, ra, dec, otype)) = parse_basic_row(r) {
                insert_base(by_oid, oid, &main_id, ra, dec, &otype);
                oids.push(oid);
            }
        }
        enrich_aliases(client, &oids, by_oid)?;
    }
    Ok(())
}

/// Insert (or keep) the base row for an object.
fn insert_base(
    by_oid: &mut BTreeMap<i64, SeedEntry>,
    oid: i64,
    main_id: &str,
    ra: f64,
    dec: f64,
    otype: &str,
) {
    let primary = collapse_spaces(main_id);
    by_oid.entry(oid).or_insert_with(|| SeedEntry {
        simbad_oid: Some(oid),
        primary_designation: primary.clone(),
        common_name: None,
        object_type: map_otype(otype),
        ra_deg: ra,
        dec_deg: dec,
        aliases: vec![SeedAlias { alias: primary, kind: AliasKind::Designation }],
    });
}

/// Fetch the kept aliases + common names for a batch of oids and attach them.
fn enrich_aliases(
    client: &reqwest::blocking::Client,
    oids: &[i64],
    by_oid: &mut BTreeMap<i64, SeedEntry>,
) -> Result<(), Box<dyn std::error::Error>> {
    for chunk in oids.chunks(200) {
        if chunk.is_empty() {
            continue;
        }
        let list = chunk.iter().map(i64::to_string).collect::<Vec<_>>().join(", ");
        let q = format!("SELECT i.oidref, i.id FROM ident AS i WHERE i.oidref IN ({list})");
        let rows = tap_query(client, &q)?;
        for r in &rows {
            let mut cols = split_tsv(r);
            if cols.len() < 2 {
                continue;
            }
            let id_raw = unquote(&cols.remove(1));
            let oid: i64 = match unquote(&cols.remove(0)).parse() {
                Ok(v) => v,
                Err(_) => continue,
            };
            let Some(entry) = by_oid.get_mut(&oid) else { continue };
            if let Some(name) = id_raw.strip_prefix("NAME ") {
                let name = name.trim();
                if entry.common_name.is_none() {
                    entry.common_name = Some(name.to_owned());
                }
                push_alias(entry, name, AliasKind::CommonName);
            } else if KEPT_ALIAS_PREFIXES.iter().any(|p| id_raw.starts_with(p)) {
                push_alias(entry, &collapse_spaces(&id_raw), AliasKind::Designation);
            }
        }
    }
    Ok(())
}

fn push_alias(entry: &mut SeedEntry, alias: &str, kind: AliasKind) {
    if entry.aliases.iter().any(|a| a.alias == alias) {
        return;
    }
    entry.aliases.push(SeedAlias { alias: alias.to_owned(), kind });
}

/// Run a TAP sync ADQL query, returning the data rows (header stripped).
fn tap_query(
    client: &reqwest::blocking::Client,
    query: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let url =
        format!("{TAP_ENDPOINT}?request=doQuery&lang=ADQL&format=tsv&query={}", url_encode(query));
    let resp = client.get(&url).send()?.error_for_status()?;
    let body = resp.text()?;
    let mut lines: Vec<String> = body.lines().map(str::to_owned).collect();
    if !lines.is_empty() {
        lines.remove(0); // header row
    }
    Ok(lines.into_iter().filter(|l| !l.trim().is_empty()).collect())
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

fn split_tsv(line: &str) -> Vec<String> {
    line.split('\t').map(str::to_owned).collect()
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
