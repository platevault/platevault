//! One-time offline seed builder for spec 035 (SIMBAD Target Resolution, T015).
//!
//! Queries the SIMBAD TAP sync endpoint (CDS) and emits the bundled seed asset
//! (`assets/seed/seed.json`) that
//! the app loads into its local cache at first run
//! (`targeting::resolver::seed`). This binary is NOT part of the shipped app; it
//! is run by a maintainer when the seed needs (re)building.
//!
//! # What it pulls
//!
//! - The full **Messier** catalogue (`M 1` … `M 110`).
//! - The **Caldwell** objects, via the committed C1–C109 → NGC/IC map
//!   (`targeting::resolver::caldwell`), since Caldwell is not a SIMBAD
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
//! # Build the committed MVP subset (Messier + Caldwell + a small NGC slice):
//! cargo run -p seed-builder -- --out assets/seed/seed.json
//!
//! # Build the MVP subset plus the first N NGC objects:
//! cargo run -p seed-builder -- --out assets/seed/seed.json --ngc 500
//!
//! # Regenerate the COMPLETE seed (~14k objects). This pulls every popular
//! # catalogue by SIMBAD prefix (research.md R2) and the full NGC/IC range.
//! # It is large and slow (minutes; many TAP round-trips). Run deliberately:
//! cargo run -p seed-builder --release -- --out assets/seed/seed.json --full
//! ```
//!
//! `--full` enumerates the R2 prefix families: `M `, `NGC `, `IC `, `SH  2-`,
//! `Barnard `, `PN A66 `, `ACO `, `APG `, `VDB `, `LBN `, `LDN `,
//! `Cl Melotte ` (plus the Caldwell map). It is gated behind the flag because it
//! hammers CDS; the committed asset in the repo is the MVP subset.
//!
//! Network host used: `simbad.cds.unistra.fr` (TAP). `OpenNGC`
//! (`raw.githubusercontent.com`) is reachable and can be folded in for richer
//! NGC/IC coverage when the complete seed is rebuilt; the committed asset is
//! sourced from SIMBAD alone.

use std::collections::BTreeMap;
use std::time::Duration;

use targeting::resolver::caldwell;
use targeting::resolver::map_otype;
use targeting::resolver::seed::{SeedAlias, SeedAsset, SeedEntry};
use targeting::resolver::AliasKind;

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

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut out = String::from("assets/seed/seed.json");
    let mut ngc_slice: u32 = 200;
    let mut full = false;
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
            }
            "--full" => full = true,
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(2);
            }
        }
        i += 1;
    }

    if let Err(e) = run(&out, ngc_slice, full) {
        eprintln!("seed-builder failed: {e}");
        std::process::exit(1);
    }
}

fn run(out: &str, ngc_slice: u32, full: bool) -> Result<(), Box<dyn std::error::Error>> {
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

    // 3) NGC slice (or full range with --full).
    if full {
        eprintln!("--full: pulling all popular catalogue prefixes (slow)…");
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
    } else if ngc_slice > 0 {
        eprintln!("pulling NGC slice (NGC 1..NGC {ngc_slice})…");
        let ids: Vec<String> = (1..=ngc_slice).map(|n| format!("NGC {n}")).collect();
        ingest_exact_ids(&client, &ids, &mut by_oid)?;
    }

    let mut entries: Vec<SeedEntry> = by_oid.into_values().collect();
    entries.sort_by(|a, b| a.primary_designation.cmp(&b.primary_designation));

    let asset = SeedAsset {
        version: 1,
        generated_at: now_iso(),
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

/// Parse a `basic`-row TSV line into `(oid, main_id, ra, dec, otype)`.
fn parse_basic_row(line: &str) -> Option<(i64, String, f64, f64, String)> {
    let cols = split_tsv(line);
    if cols.len() < 5 {
        return None;
    }
    let oid: i64 = unquote(&cols[0]).parse().ok()?;
    let main_id = unquote(&cols[1]);
    let ra: f64 = unquote(&cols[2]).parse().ok()?;
    let dec: f64 = unquote(&cols[3]).parse().ok()?;
    let otype = unquote(&cols[4]);
    Some((oid, main_id, ra, dec, otype))
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

fn now_iso() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}
