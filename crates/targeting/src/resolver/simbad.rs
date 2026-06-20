//! SIMBAD TAP client: maps SIMBAD responses to canonical target identity.
//!
//! Talks to the SIMBAD TAP `sim-tap/sync` endpoint (ADQL, TSV) over HTTPS via an
//! async `reqwest` client, with polite usage (configurable timeout + an
//! identifying `User-Agent`). Never fabricates coordinates (spec 035 FR-009): a
//! query with no `basic` row returns [`ResolveError::NotFound`]; a query that
//! maps to several distinct physical objects returns [`ResolveError::Ambiguous`].
//!
//! # Query shape (proven live by the seed-builder, T015)
//!
//! Resolution is two ADQL round-trips against the TAP sync endpoint:
//!
//! 1. `basic ⋈ ident` to find the object(s) whose `ident.id` matches the query
//!    and pull `oid, main_id, ra, dec, otype_txt` (ICRS J2000 degrees):
//!
//!    ```sql
//!    SELECT DISTINCT b.oid, b.main_id, b.ra, b.dec, b.otype_txt
//!    FROM basic AS b JOIN ident AS i ON i.oidref = b.oid
//!    WHERE i.id IN ('<query>', '<collapsed>') AND b.ra IS NOT NULL AND b.dec IS NOT NULL
//!    ```
//!
//! 2. `ident` for the winning oid to pull the full alias set, where `NAME …`
//!    rows are curated common names.
//!
//! ## Gotchas (carried over from the seed-builder)
//!
//! - **`format=tsv`**: string columns are double-quoted; numeric columns are
//!   not. We strip quotes ([`unquote`]) and collapse internal whitespace runs
//!   ([`collapse_spaces`]) — SIMBAD emits space-padded ids like `"M   31"`.
//! - **No `REPLACE` UDF**: SIMBAD TAP has no string UDFs; `ident.id` matching
//!   collapses internal whitespace itself, so a single-space query (`NGC 224`)
//!   matches the padded stored form.
//! - **Manual percent-encoding** ([`url_encode`]): the workspace builds reqwest
//!   with `default-features = false`, so the high-level query builder is absent;
//!   the ADQL is encoded by hand into the URL.
//! - The first TSV line is the column header and is stripped.

use std::time::Duration;

use async_trait::async_trait;

use crate::resolver::{
    map_otype, AliasKind, ResolveError, ResolvedAlias, ResolvedIdentity, Resolver, TargetSource,
};

/// Default SIMBAD TAP sync endpoint (CDS).
pub const DEFAULT_TAP_ENDPOINT: &str = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync";

/// Polite identifying `User-Agent` (CDS norm).
pub const DEFAULT_USER_AGENT: &str = "astro-plan/0.1 (+https://github.com/; spec-035 resolver)";

/// Hard cap on a single TAP response body (FIX-5b). A resolve query targets one
/// object plus its alias list; even rich objects are well under 1 MB, so 8 MB is
/// a generous bound that still prevents memory exhaustion from a hostile body.
const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;

/// Configuration for a [`SimbadResolver`].
///
/// Built from the persisted `resolver_settings` row by the use-case layer
/// (T020), or from [`SimbadConfig::default`] for ad-hoc use.
#[derive(Clone, Debug)]
pub struct SimbadConfig {
    /// TAP sync endpoint URL.
    pub endpoint: String,
    /// Per-request timeout; on expiry the resolver returns
    /// [`ResolveError::Timeout`] so callers degrade to seed+cache.
    pub timeout: Duration,
    /// Identifying `User-Agent` header value.
    pub user_agent: String,
}

impl Default for SimbadConfig {
    fn default() -> Self {
        Self {
            endpoint: DEFAULT_TAP_ENDPOINT.to_owned(),
            timeout: Duration::from_secs(10),
            user_agent: DEFAULT_USER_AGENT.to_owned(),
        }
    }
}

impl SimbadConfig {
    /// Build a config from the persisted settings (`resolver_settings`).
    #[must_use]
    pub fn from_settings(endpoint: impl Into<String>, request_timeout_secs: u64) -> Self {
        Self {
            endpoint: endpoint.into(),
            timeout: Duration::from_secs(request_timeout_secs.max(1)),
            user_agent: DEFAULT_USER_AGENT.to_owned(),
        }
    }
}

/// Live SIMBAD resolver: the production [`Resolver`] implementation.
pub struct SimbadResolver {
    client: reqwest::Client,
    endpoint: String,
    timeout: Duration,
}

impl SimbadResolver {
    /// Construct a resolver from a [`SimbadConfig`].
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the underlying `reqwest` client
    /// cannot be built (e.g. TLS backend init failure).
    pub fn new(config: &SimbadConfig) -> Result<Self, ResolveError> {
        let client = reqwest::Client::builder()
            .user_agent(config.user_agent.clone())
            .timeout(config.timeout)
            .build()
            .map_err(|e| ResolveError::Network(e.to_string()))?;
        Ok(Self { client, endpoint: config.endpoint.clone(), timeout: config.timeout })
    }

    /// Convenience constructor using [`SimbadConfig::default`].
    ///
    /// # Errors
    ///
    /// Returns [`ResolveError::Network`] if the client cannot be built.
    pub fn with_defaults() -> Result<Self, ResolveError> {
        Self::new(&SimbadConfig::default())
    }

    /// Run a TAP sync ADQL query, returning the data rows (header stripped).
    async fn tap_query(&self, query: &str) -> Result<Vec<String>, ResolveError> {
        let url = format!(
            "{}?request=doQuery&lang=ADQL&format=tsv&query={}",
            self.endpoint,
            url_encode(query)
        );
        let resp =
            self.client.get(&url).send().await.map_err(|e| classify_reqwest(&e, self.timeout))?;
        let mut resp = resp.error_for_status().map_err(|e| classify_reqwest(&e, self.timeout))?;

        // FIX-5b: bound the response read. Reject an advertised oversize body up
        // front, then stream chunks with a hard cap so a misbehaving/hostile
        // endpoint can't exhaust memory with an unbounded `text()`.
        if let Some(len) = resp.content_length() {
            if len > MAX_RESPONSE_BYTES {
                return Err(ResolveError::Parse(format!(
                    "SIMBAD response too large ({len} bytes > {MAX_RESPONSE_BYTES} cap)"
                )));
            }
        }
        let mut buf: Vec<u8> = Vec::new();
        let mut total: u64 = 0;
        while let Some(chunk) =
            resp.chunk().await.map_err(|e| classify_reqwest(&e, self.timeout))?
        {
            total += chunk.len() as u64;
            if total > MAX_RESPONSE_BYTES {
                return Err(ResolveError::Parse(format!(
                    "SIMBAD response exceeded {MAX_RESPONSE_BYTES} byte cap"
                )));
            }
            buf.extend_from_slice(&chunk);
        }
        let body = String::from_utf8_lossy(&buf).into_owned();

        // A TAP error is returned as a VOTable/text body with HTTP 200 in some
        // cases; treat an obviously non-tabular error body as a parse error.
        if body.contains("<VOTABLE") && body.contains("ERROR") {
            return Err(ResolveError::Parse("SIMBAD returned a VOTable error".to_owned()));
        }

        let mut lines: Vec<String> = body.lines().map(str::to_owned).collect();
        if lines.is_empty() {
            return Ok(Vec::new());
        }
        lines.remove(0); // header row
        Ok(lines.into_iter().filter(|l| !l.trim().is_empty()).collect())
    }

    /// Find the distinct `basic` rows matching the query identifier.
    async fn find_objects(
        &self,
        query: &str,
    ) -> Result<Vec<(i64, String, f64, f64, String)>, ResolveError> {
        // Match on the verbatim query and its single-space-collapsed form; the
        // SQL-quote the literals. SIMBAD's `ident.id` match collapses internal
        // whitespace so a padded stored id is still matched.
        let collapsed = collapse_spaces(query);
        let mut id_forms: Vec<String> = vec![query.to_owned()];
        if collapsed != query {
            id_forms.push(collapsed);
        }
        let list = id_forms
            .iter()
            .map(|id| format!("'{}'", id.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(", ");

        let q = format!(
            "SELECT DISTINCT b.oid, b.main_id, b.ra, b.dec, b.otype_txt \
             FROM basic AS b JOIN ident AS i ON i.oidref = b.oid \
             WHERE i.id IN ({list}) AND b.ra IS NOT NULL AND b.dec IS NOT NULL"
        );
        let rows = self.tap_query(&q).await?;
        Ok(rows.iter().filter_map(|r| parse_basic_row(r)).collect())
    }

    /// Pull the alias set (designations + `NAME …` common names) for one oid.
    async fn fetch_aliases(
        &self,
        oid: i64,
    ) -> Result<(Vec<ResolvedAlias>, Option<String>), ResolveError> {
        let q = format!("SELECT i.id FROM ident AS i WHERE i.oidref = {oid}");
        let rows = self.tap_query(&q).await?;

        let mut aliases: Vec<ResolvedAlias> = Vec::new();
        let mut common_name: Option<String> = None;
        for r in &rows {
            // Single-column query: the whole line is the (quoted) id.
            let id_raw = unquote(r);
            if id_raw.is_empty() {
                continue;
            }
            if let Some(name) = id_raw.strip_prefix("NAME ") {
                let name = name.trim();
                if common_name.is_none() {
                    common_name = Some(name.to_owned());
                }
                push_unique(&mut aliases, name, AliasKind::CommonName);
            } else {
                push_unique(&mut aliases, &collapse_spaces(&id_raw), AliasKind::Designation);
            }
        }
        Ok((aliases, common_name))
    }
}

#[async_trait]
impl Resolver for SimbadResolver {
    async fn resolve(&self, query: &str) -> Result<ResolvedIdentity, ResolveError> {
        let query = query.trim();
        if query.is_empty() {
            return Err(ResolveError::NotFound(String::new()));
        }

        // FIX-2: Caldwell is NOT a SIMBAD designation. Translate a Caldwell query
        // (`C 14`, `Caldwell 14`) to its NGC/IC designation via the committed map,
        // resolve THAT, and attach the original `C n` as an alias. C99 (the
        // Coalsack) maps to None → NotFound (no single resolvable designation).
        let (simbad_query, caldwell_alias) = match parse_caldwell_number(query) {
            Some(n) => match crate::resolver::caldwell::caldwell_to_designation(n) {
                Some(desig) => (desig.to_owned(), Some(format!("C {n}"))),
                None => return Err(ResolveError::NotFound(query.to_owned())),
            },
            None => (query.to_owned(), None),
        };

        let objects = self.find_objects(&simbad_query).await?;
        match objects.len() {
            0 => Err(ResolveError::NotFound(query.to_owned())),
            1 => {
                let (oid, main_id, ra_deg, dec_deg, otype) = objects.into_iter().next().unwrap();
                let primary_designation = collapse_spaces(&main_id);
                let (mut aliases, common_name) = self.fetch_aliases(oid).await?;
                // Guarantee the primary designation is present as a designation alias.
                push_unique(&mut aliases, &primary_designation, AliasKind::Designation);
                // FIX-2: bind the original Caldwell designation so future lookups
                // of `C n` are cache hits pointing at this object.
                if let Some(c) = &caldwell_alias {
                    push_unique(&mut aliases, c, AliasKind::Designation);
                }

                Ok(ResolvedIdentity {
                    simbad_oid: Some(oid),
                    primary_designation,
                    common_name,
                    object_type: map_otype(&otype),
                    ra_deg,
                    dec_deg,
                    aliases,
                    source: TargetSource::Resolved,
                })
            }
            n => Err(ResolveError::Ambiguous { query: query.to_owned(), count: n }),
        }
    }
}

/// A zero-cost [`Resolver`] that never reaches the network (FIX-3).
///
/// Used when online resolution is disabled in settings, so the command layer
/// can run the cache-first use case without constructing a `reqwest`/TLS client.
/// Every call reports [`ResolveError::Disabled`], which the use case maps to an
/// `unresolved("offline")` outcome (FR-015).
pub struct OfflineResolver;

#[async_trait]
impl Resolver for OfflineResolver {
    async fn resolve(&self, _query: &str) -> Result<ResolvedIdentity, ResolveError> {
        Err(ResolveError::Disabled)
    }
}

/// Detect a Caldwell query and extract its number.
///
/// Recognizes the normalized prefix forms `c <n>` / `caldwell <n>` (spec-013
/// `normalize` expands `C14`→`c 14`, `Caldwell14`→`caldwell 14`). Returns the
/// Caldwell number when the query is a bare Caldwell designation, else `None`.
fn parse_caldwell_number(query: &str) -> Option<u16> {
    let norm = crate::normalize::normalize(query);
    let mut parts = norm.split_whitespace();
    let prefix = parts.next()?;
    if prefix != "c" && prefix != "caldwell" {
        return None;
    }
    let num: u16 = parts.next()?.parse().ok()?;
    // Reject trailing tokens (e.g. "c 14 foo") so only bare designations match.
    if parts.next().is_some() {
        return None;
    }
    Some(num)
}

// ── Helpers (ported from the seed-builder, T015) ─────────────────────────────────

/// Classify a `reqwest` error into the right [`ResolveError`] so callers can
/// degrade to seed+cache on transport failure / timeout (FR-009).
fn classify_reqwest(e: &reqwest::Error, timeout: Duration) -> ResolveError {
    if e.is_timeout() {
        ResolveError::Timeout(timeout.as_secs())
    } else {
        ResolveError::Network(e.to_string())
    }
}

/// Parse a `basic`-row TSV line into `(oid, main_id, ra, dec, otype)`.
///
/// Tokenization (T204) uses the `csv` crate as a tab-delimited, header-less,
/// flexible RFC-4180 reader: SIMBAD's double-quoted string columns are unquoted
/// by the reader (equivalent to the prior per-field [`unquote`]), while numeric
/// columns pass through untouched. The RA/Dec finiteness + range validation is
/// preserved exactly (FIX-5c).
fn parse_basic_row(line: &str) -> Option<(i64, String, f64, f64, String)> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .flexible(true)
        .from_reader(line.as_bytes());
    let record = reader.records().next()?.ok()?;
    if record.len() < 5 {
        return None;
    }
    let oid: i64 = record[0].trim().parse().ok()?;
    let main_id = record[1].trim().to_owned();
    let ra: f64 = record[2].trim().parse().ok()?;
    let dec: f64 = record[3].trim().parse().ok()?;
    let otype = record[4].trim().to_owned();
    // FIX-5c: range-validate ICRS coords so an out-of-range value degrades to a
    // no-result row (NotFound) instead of hitting the DB CHECK on cache write.
    if !ra.is_finite() || !(0.0..360.0).contains(&ra) {
        return None;
    }
    if !dec.is_finite() || !(-90.0..=90.0).contains(&dec) {
        return None;
    }
    Some((oid, main_id, ra, dec, otype))
}

/// Append `alias` to `out` unless an equal display form is already present.
fn push_unique(out: &mut Vec<ResolvedAlias>, alias: &str, kind: AliasKind) {
    if alias.is_empty() || out.iter().any(|a| a.alias == alias) {
        return;
    }
    out.push(ResolvedAlias::new(alias, kind));
}

/// The set of bytes that must be percent-encoded in an ADQL URL query string.
///
/// Equivalent to the prior hand-rolled rule: the RFC 3986 *unreserved* set
/// (`A–Z a–z 0–9 - _ . ~`) passes through untouched; every other byte is
/// `%XX`-encoded (uppercase hex). `percent-encoding`'s `NON_ALPHANUMERIC`
/// encodes everything except `A–Za–z0–9`, so we *remove* the four unreserved
/// punctuation marks to reproduce the unreserved passthrough exactly.
const ADQL_QUERY_ENCODE: &percent_encoding::AsciiSet =
    &percent_encoding::NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

/// Percent-encode an ADQL query for use in a URL query string.
///
/// The workspace builds `reqwest` with `default-features = false`, so the
/// high-level query builder is unavailable; encode via `percent-encoding`
/// against [`ADQL_QUERY_ENCODE`] (RFC 3986 unreserved set passes through,
/// everything else is `%XX`).
fn url_encode(s: &str) -> String {
    percent_encoding::utf8_percent_encode(s, ADQL_QUERY_ENCODE).to_string()
}

/// Strip SIMBAD's surrounding double quotes (TSV string columns are quoted).
fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').to_owned()
}

/// Collapse internal whitespace runs to single spaces and trim
/// (e.g. SIMBAD `"M   31"` → `"M 31"`, `"NGC  224"` → `"NGC 224"`).
fn collapse_spaces(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_encode_passes_unreserved_and_escapes_rest() {
        assert_eq!(url_encode("M 31"), "M%2031");
        assert_eq!(url_encode("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(url_encode("SELECT b.oid"), "SELECT%20b.oid");
    }

    #[test]
    fn unquote_strips_tsv_quotes() {
        assert_eq!(unquote("\"M 31\""), "M 31");
        assert_eq!(unquote("  12345  "), "12345");
    }

    #[test]
    fn collapse_spaces_normalizes_padding() {
        assert_eq!(collapse_spaces("M   31"), "M 31");
        assert_eq!(collapse_spaces("  NGC  224 "), "NGC 224");
    }

    #[test]
    fn parse_basic_row_extracts_columns() {
        let line = "1575544\t\"M  31\"\t10.6847083\t41.26875\t\"G\"";
        let (oid, main_id, ra, dec, otype) = parse_basic_row(line).unwrap();
        assert_eq!(oid, 1_575_544);
        assert_eq!(main_id, "M  31");
        assert!((ra - 10.684_708_3).abs() < 1e-6);
        assert!((dec - 41.268_75).abs() < 1e-6);
        assert_eq!(otype, "G");
    }

    #[test]
    fn parse_basic_row_rejects_short_lines() {
        assert!(parse_basic_row("1\t2\t3").is_none());
    }

    #[test]
    fn push_unique_dedupes_by_display() {
        let mut v = Vec::new();
        push_unique(&mut v, "M 31", AliasKind::Designation);
        push_unique(&mut v, "M 31", AliasKind::Designation);
        push_unique(&mut v, "", AliasKind::Designation);
        assert_eq!(v.len(), 1);
    }

    #[test]
    fn config_from_settings_clamps_timeout() {
        let c = SimbadConfig::from_settings("https://example/tap", 0);
        assert_eq!(c.timeout, Duration::from_secs(1));
        assert_eq!(c.endpoint, "https://example/tap");
    }

    #[test]
    fn resolver_builds_from_config() {
        let r = SimbadResolver::new(&SimbadConfig::default());
        assert!(r.is_ok());
    }

    // ── FIX-2: Caldwell query detection + translation ──────────────────────────

    #[test]
    fn parse_caldwell_number_recognizes_forms() {
        assert_eq!(parse_caldwell_number("C 14"), Some(14));
        assert_eq!(parse_caldwell_number("C14"), Some(14));
        assert_eq!(parse_caldwell_number("Caldwell 14"), Some(14));
        assert_eq!(parse_caldwell_number("caldwell14"), Some(14));
    }

    #[test]
    fn parse_caldwell_number_rejects_non_caldwell() {
        assert_eq!(parse_caldwell_number("M 31"), None);
        assert_eq!(parse_caldwell_number("NGC 224"), None);
        // A common name starting with C must not be mistaken for Caldwell.
        assert_eq!(parse_caldwell_number("Cassiopeia"), None);
        assert_eq!(parse_caldwell_number("C 14 extra"), None);
    }

    #[test]
    fn caldwell_translates_to_resolvable_designation() {
        // C 14 → the Double Cluster (NGC 869) per the committed map.
        let n = parse_caldwell_number("C 14").unwrap();
        assert!(crate::resolver::caldwell::caldwell_to_designation(n).is_some());
        // C 99 (Coalsack) has no single resolvable designation → None.
        assert_eq!(crate::resolver::caldwell::caldwell_to_designation(99), None);
    }
}
