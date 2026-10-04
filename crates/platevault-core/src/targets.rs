// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Offline target catalog, shared alias normalization, the SIMBAD provider
//! adapter and target-association evidence.
//!
//! The bundled `assets/seed/seed.json` dataset is searched in memory: no
//! network, cache file or database participates in local search. Alias
//! normalization, stable target identities and text-rank buckets come from
//! `simbad-resolver`; cone membership and in-frame tests come from
//! `target-match`, which is built on skymath 0.6, while coordinate validation
//! and averaging use this crate's skymath 0.7.2. The two skymath versions never
//! share types: every crossing goes through `f64` degrees.
//!
//! Nothing here persists state. The catalog owns saved targets; callers pass
//! saved [`TargetCandidate`]s back in so one ranking applies to seed and saved
//! records alike.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use simbad_resolver::identity::{namespace, target_id_from_designation};
use simbad_resolver::{
    AliasKind, CacheBackend, CachedTarget, OfflineResolver, Resolution, ResolvedAlias, Resolver,
    ResolverConfig, SimbadResolver, TapResolver, TargetSource, UnresolvedReason, RANK_EXACT,
    RANK_PREFIX, RANK_SUBSTRING,
};
pub use simbad_resolver::{ObjectType, SimbadConfig};
use target_match::skymath as match_sky;
use target_match::{
    is_framed, Constraint, Field, Matcher, Membership, Optics, RadiusPolicy, SkyObject,
};
use uuid::Uuid;

use crate::{
    AssociationState, CaptureMetadata, EvidenceItem, LibraryError, Provenance, SkyCoordinates,
    TargetAlias, TargetCandidate, TargetCone,
};

/// Namespace seed for seed and provider target ids (`UUIDv5` of the designation).
pub const TARGET_ID_NAMESPACE: &str = "platevault.library.targets";
/// Namespace seed for explicit user targets, so they never share a catalog id.
pub const USER_TARGET_ID_NAMESPACE: &str = "platevault.library.user-targets";
/// Provider name recorded on SIMBAD-resolved candidates.
pub const SIMBAD_PROVIDER: &str = "simbad";
/// Frame label of every coordinate this module produces or accepts.
pub const ICRS_FRAME: &str = "icrs";
/// Rule recorded as [`Provenance::Inferred`] on every [`TargetAssessment`].
pub const ASSOCIATION_RULE: &str = "observed-alias-and-inscribed-field/v1";

const SEED_JSON: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/seed/seed.json"));

/// Normalize free text into the shared alias key used by seed, provider, user
/// and saved targets. Delegates to `simbad_resolver::normalize::normalize`.
#[must_use]
pub fn normalize_alias(text: &str) -> String {
    simbad_resolver::normalize::normalize(text)
}

// ── Seed asset ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SeedAsset {
    version: u32,
    generated_at: String,
    source: String,
    entries: Vec<SeedEntry>,
}

#[derive(Deserialize)]
struct SeedEntry {
    simbad_oid: Option<i64>,
    primary_designation: String,
    common_name: Option<String>,
    object_type: ObjectType,
    ra_deg: f64,
    dec_deg: f64,
    aliases: Vec<SeedAlias>,
}

#[derive(Deserialize)]
struct SeedAlias {
    alias: String,
    kind: AliasKind,
}

/// Identity of the bundled seed dataset every seed candidate cites.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeedProvenance {
    /// Label stored in [`Provenance::Seed`] on seed candidates and aliases.
    pub dataset: String,
    pub version: u32,
    pub generated_at: String,
    pub source: String,
    /// SHA-256 of the embedded asset bytes.
    pub sha256: String,
    pub target_count: usize,
    pub alias_count: usize,
}

struct SeedRecord {
    id: Uuid,
    simbad_oid: Option<i64>,
    designation: String,
    common_name: Option<String>,
    object_type: ObjectType,
    coordinates: Option<SkyCoordinates>,
    aliases: Vec<ResolvedAlias>,
}

/// A position handed to `target-match`; `index` points back into the caller's slice.
#[derive(Clone, Copy)]
struct Positioned {
    index: usize,
    position: match_sky::Equatorial,
}

impl SkyObject for Positioned {
    fn position(&self) -> match_sky::Equatorial {
        self.position
    }
}

/// Validate ICRS degrees with skymath 0.7.2.
fn validated_coordinates(ra_deg: f64, dec_deg: f64) -> Option<SkyCoordinates> {
    skymath::Equatorial::j2000(
        skymath::Angle::from_degrees(ra_deg),
        skymath::Angle::from_degrees(dec_deg),
    )
    .ok()
    .map(|_| SkyCoordinates { ra_deg, dec_deg, frame: ICRS_FRAME.to_owned() })
}

/// Bridge degrees into target-match's skymath 0.6 coordinate type.
fn match_position(ra_deg: f64, dec_deg: f64) -> Option<match_sky::Equatorial> {
    match_sky::Equatorial::j2000(
        match_sky::Angle::from_degrees(ra_deg),
        match_sky::Angle::from_degrees(dec_deg),
    )
    .ok()
}

fn candidate_position(candidate: &TargetCandidate) -> Option<match_sky::Equatorial> {
    let coordinates = candidate.coordinates.as_ref().filter(|c| c.frame == ICRS_FRAME)?;
    match_position(coordinates.ra_deg, coordinates.dec_deg)
}

// ── Search ───────────────────────────────────────────────────────────────────

/// Offline target search request: text, a typed cone, or both.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetQuery {
    /// Free text matched against normalized aliases. Blank text counts as absent.
    #[serde(default)]
    pub text: Option<String>,
    /// Sky cone; only targets with known coordinates inside it match.
    #[serde(default)]
    pub cone: Option<TargetCone>,
    pub limit: usize,
}

impl TargetQuery {
    /// Normalized alias key for `Catalog::find_targets`, when text is present.
    #[must_use]
    pub fn alias_key(&self) -> Option<String> {
        self.text.as_deref().map(normalize_alias).filter(|key| !key.is_empty())
    }

    fn prepare(&self) -> Result<PreparedQuery, LibraryError> {
        if self.limit == 0 {
            return Err(LibraryError::InvalidInput(
                "target search limit must be at least 1".into(),
            ));
        }
        let key = match self.text.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
            Some(text) => {
                let key = normalize_alias(text);
                if key.is_empty() {
                    return Err(LibraryError::InvalidInput(format!(
                        "target query {text:?} has no searchable characters"
                    )));
                }
                Some(key)
            }
            None => None,
        };
        let cone = match self.cone {
            Some(cone) => {
                cone.validate()?;
                let center = match_position(cone.ra_deg, cone.dec_deg).ok_or_else(|| {
                    LibraryError::InvalidInput("invalid sky cone in degrees".into())
                })?;
                Some((center, match_sky::Angle::from_degrees(cone.radius_deg)))
            }
            None => None,
        };
        if key.is_none() && cone.is_none() {
            return Err(LibraryError::InvalidInput(
                "target search needs text or a sky cone".into(),
            ));
        }
        Ok(PreparedQuery { key, cone })
    }
}

struct PreparedQuery {
    key: Option<String>,
    /// Cone centre and radius in target-match's skymath types.
    cone: Option<(match_sky::Equatorial, match_sky::Angle)>,
}

/// Text-filter outcome for a record whose aliases passed the filter.
#[derive(Clone, Copy)]
enum TextFilter<'a> {
    /// The query has no text.
    Unfiltered,
    Matched(TextMatch<'a>),
}

impl<'a> TextFilter<'a> {
    const fn matched(self) -> Option<TextMatch<'a>> {
        match self {
            Self::Unfiltered => None,
            Self::Matched(found) => Some(found),
        }
    }
}

impl PreparedQuery {
    /// `None` when the query has text and no alias of the record matches it.
    fn text_filter<'a>(
        &self,
        aliases: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Option<TextFilter<'a>> {
        match &self.key {
            Some(key) => best_alias(key, aliases).map(TextFilter::Matched),
            None => Some(TextFilter::Unfiltered),
        }
    }
}

/// One search result with the evidence that matched it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSearchHit {
    pub candidate: TargetCandidate,
    /// Display alias that matched the text query.
    pub matched_alias: Option<String>,
    /// `simbad_resolver` rank bucket: exact, prefix or substring.
    pub rank: Option<u8>,
    /// Great-circle separation from the cone centre, in degrees.
    pub separation_deg: Option<f64>,
}

#[derive(Clone, Copy)]
struct TextMatch<'a> {
    rank: u8,
    normalized_len: usize,
    alias: &'a str,
}

/// Best alias of one target, ranked like `simbad_resolver`'s cache search:
/// exact before prefix before substring, then the shorter normalized alias.
fn best_alias<'a>(
    key: &str,
    aliases: impl IntoIterator<Item = (&'a str, &'a str)>,
) -> Option<TextMatch<'a>> {
    let mut best: Option<TextMatch<'a>> = None;
    for (alias, normalized) in aliases {
        let rank = if normalized == key {
            RANK_EXACT
        } else if normalized.starts_with(key) {
            RANK_PREFIX
        } else if normalized.contains(key) {
            RANK_SUBSTRING
        } else {
            continue;
        };
        let found = TextMatch { rank, normalized_len: normalized.len(), alias };
        if best.is_none_or(|b| (found.rank, found.normalized_len) < (b.rank, b.normalized_len)) {
            best = Some(found);
        }
    }
    best
}

#[derive(Clone, Copy)]
enum HitSource {
    Seed(usize),
    Saved(usize),
}

struct RankedHit<'a> {
    source: HitSource,
    id: Uuid,
    designation: &'a str,
    text: Option<TextMatch<'a>>,
    separation_deg: Option<f64>,
}

impl RankedHit<'_> {
    fn order(&self, other: &Self) -> Ordering {
        let text = |hit: &Self| hit.text.map(|t| (t.rank, t.normalized_len, t.alias));
        text(self)
            .cmp(&text(other))
            .then_with(|| {
                self.separation_deg.unwrap_or(0.0).total_cmp(&other.separation_deg.unwrap_or(0.0))
            })
            .then_with(|| self.designation.cmp(other.designation))
            .then_with(|| self.id.cmp(&other.id))
    }
}

fn record_aliases(record: &SeedRecord) -> impl Iterator<Item = (&str, &str)> {
    record.aliases.iter().map(|a| (a.alias.as_str(), a.normalized.as_str()))
}

fn candidate_aliases(candidate: &TargetCandidate) -> impl Iterator<Item = (&str, &str)> {
    candidate.aliases.iter().map(|a| (a.text.as_str(), a.normalized.as_str()))
}

// ── Target index ─────────────────────────────────────────────────────────────

/// In-memory offline catalog over the bundled seed dataset.
pub struct TargetIndex {
    provenance: SeedProvenance,
    seed_provenance: Provenance,
    records: Vec<SeedRecord>,
    positions: Matcher<Positioned>,
}

impl TargetIndex {
    /// Load the seed dataset embedded from `assets/seed/seed.json`.
    ///
    /// # Errors
    /// `InvalidInput` when the asset is not a seed document, an entry has no
    /// searchable designation, or two entries share a designation.
    pub fn bundled() -> Result<Self, LibraryError> {
        Self::from_seed_json(SEED_JSON)
    }

    fn from_seed_json(bytes: &[u8]) -> Result<Self, LibraryError> {
        let asset: SeedAsset = serde_json::from_slice(bytes)?;
        let sha256 = hex::encode(Sha256::digest(bytes));
        let dataset = format!("bundled-seed/v{}/sha256:{}", asset.version, &sha256[..16]);
        let ns = namespace(TARGET_ID_NAMESPACE);
        let mut ids = HashSet::with_capacity(asset.entries.len());
        let mut records = Vec::with_capacity(asset.entries.len());
        let mut positions = Vec::with_capacity(asset.entries.len());
        let mut alias_count = 0;
        for entry in asset.entries {
            let record = seed_record(&ns, entry)?;
            if !ids.insert(record.id) {
                return Err(LibraryError::InvalidInput(format!(
                    "duplicate seed designation {:?}",
                    record.designation
                )));
            }
            if let Some(position) =
                record.coordinates.as_ref().and_then(|c| match_position(c.ra_deg, c.dec_deg))
            {
                positions.push(Positioned { index: records.len(), position });
            }
            alias_count += record.aliases.len();
            records.push(record);
        }
        Ok(Self {
            provenance: SeedProvenance {
                dataset: dataset.clone(),
                version: asset.version,
                generated_at: asset.generated_at,
                source: asset.source,
                sha256,
                target_count: records.len(),
                alias_count,
            },
            seed_provenance: Provenance::Seed { dataset },
            records,
            positions: Matcher::from_objects(positions),
        })
    }

    /// Provenance and counts of the loaded seed dataset.
    #[must_use]
    pub fn provenance(&self) -> &SeedProvenance {
        &self.provenance
    }

    /// Seed target by stable id.
    #[must_use]
    pub fn candidate(&self, id: Uuid) -> Option<TargetCandidate> {
        self.records.iter().find(|r| r.id == id).map(|r| self.materialize(r))
    }

    fn materialize(&self, record: &SeedRecord) -> TargetCandidate {
        TargetCandidate {
            id: record.id,
            designation: record.designation.clone(),
            aliases: record
                .aliases
                .iter()
                .map(|a| TargetAlias {
                    text: a.alias.clone(),
                    normalized: a.normalized.clone(),
                    kind: a.kind.as_wire().to_owned(),
                    provenance: self.seed_provenance.clone(),
                })
                .collect(),
            common_name: record.common_name.clone(),
            object_type: record.object_type.as_wire().to_owned(),
            coordinates: record.coordinates.clone(),
            provenance: self.seed_provenance.clone(),
            provider_id: record.simbad_oid.map(|oid| oid.to_string()),
        }
    }

    /// Search seed and saved targets together without network access.
    ///
    /// `saved` are durable catalog records (for example from
    /// `Catalog::find_targets`); a saved record shadows the seed record with
    /// the same id. Results rank by text match, then cone separation, and keep
    /// each record's own provenance.
    ///
    /// # Errors
    /// `InvalidInput` for a zero limit, text without searchable characters,
    /// an invalid cone, or a query with neither text nor cone.
    pub fn search(
        &self,
        query: &TargetQuery,
        saved: &[TargetCandidate],
    ) -> Result<Vec<TargetSearchHit>, LibraryError> {
        let prepared = query.prepare()?;
        let mut shadowed = HashSet::with_capacity(saved.len());
        let mut hits = Vec::new();
        for (index, candidate) in saved.iter().enumerate() {
            if shadowed.insert(candidate.id) {
                if let Some(hit) = saved_hit(&prepared, index, candidate) {
                    hits.push(hit);
                }
            }
        }
        self.seed_hits(&prepared, &shadowed, &mut hits);
        hits.sort_by(RankedHit::order);
        hits.truncate(query.limit);
        Ok(hits
            .into_iter()
            .map(|hit| TargetSearchHit {
                candidate: match hit.source {
                    HitSource::Seed(index) => self.materialize(&self.records[index]),
                    HitSource::Saved(index) => saved[index].clone(),
                },
                matched_alias: hit.text.map(|t| t.alias.to_owned()),
                rank: hit.text.map(|t| t.rank),
                separation_deg: hit.separation_deg,
            })
            .collect())
    }

    fn seed_hits<'a>(
        &'a self,
        prepared: &PreparedQuery,
        shadowed: &HashSet<Uuid>,
        hits: &mut Vec<RankedHit<'a>>,
    ) {
        let mut push = |index: usize, separation_deg: Option<f64>| {
            let record = &self.records[index];
            if shadowed.contains(&record.id) {
                return;
            }
            if let Some(filter) = prepared.text_filter(record_aliases(record)) {
                hits.push(RankedHit {
                    source: HitSource::Seed(index),
                    id: record.id,
                    designation: &record.designation,
                    text: filter.matched(),
                    separation_deg,
                });
            }
        };
        match prepared.cone {
            Some((center, radius)) => {
                for found in self.positions.query(center, Constraint::circular(radius)) {
                    if found.in_frame {
                        push(found.object.index, Some(found.separation.degrees()));
                    }
                }
            }
            None => (0..self.records.len()).for_each(|index| push(index, None)),
        }
    }

    /// Known targets with association evidence for one session's light frames.
    ///
    /// Candidates come from exact normalized `OBJECT` aliases and from targets
    /// inside a frame's inscribed field; each is assessed by [`assess_target`].
    /// Saved records shadow seed records with the same id. Results order
    /// Suggested, then `NeedsReview`, then by designation.
    #[must_use]
    pub fn candidates_for_frames(
        &self,
        frames: &[CaptureMetadata],
        saved: &[TargetCandidate],
    ) -> Vec<TargetAssessment> {
        let keys: BTreeSet<String> = frames
            .iter()
            .filter_map(|frame| frame.object.as_deref())
            .map(normalize_alias)
            .filter(|key| !key.is_empty())
            .collect();
        let fields: Vec<(match_sky::Equatorial, match_sky::Angle)> =
            frames.iter().filter_map(frame_field).collect();
        let in_any_field = |position: match_sky::Equatorial| {
            fields.iter().any(|&(pointing, radius)| {
                is_framed(
                    pointing,
                    &Positioned { index: 0, position },
                    Membership::Circular { radius },
                )
                .in_frame
            })
        };

        let mut seen = HashSet::new();
        let mut candidates: Vec<TargetCandidate> = Vec::new();
        for candidate in saved {
            if seen.insert(candidate.id)
                && (candidate.aliases.iter().any(|a| keys.contains(&a.normalized))
                    || candidate_position(candidate).is_some_and(in_any_field))
            {
                candidates.push(candidate.clone());
            }
        }
        let mut seed_indices: BTreeSet<usize> = BTreeSet::new();
        if !keys.is_empty() {
            for (index, record) in self.records.iter().enumerate() {
                if record.aliases.iter().any(|a| keys.contains(&a.normalized)) {
                    seed_indices.insert(index);
                }
            }
        }
        for &(pointing, radius) in &fields {
            for found in self.positions.query(pointing, Constraint::circular(radius)) {
                if found.in_frame {
                    seed_indices.insert(found.object.index);
                }
            }
        }
        for index in seed_indices {
            let record = &self.records[index];
            if seen.insert(record.id) {
                candidates.push(self.materialize(record));
            }
        }

        let mut assessments: Vec<TargetAssessment> =
            candidates.iter().map(|candidate| assess_target(candidate, frames)).collect();
        assessments.sort_by(|a, b| {
            state_order(&a.state)
                .cmp(&state_order(&b.state))
                .then_with(|| a.candidate.designation.cmp(&b.candidate.designation))
                .then_with(|| a.candidate.id.cmp(&b.candidate.id))
        });
        assessments
    }
}

fn seed_record(ns: &Uuid, entry: SeedEntry) -> Result<SeedRecord, LibraryError> {
    let designation = entry.primary_designation;
    if normalize_alias(&designation).is_empty() {
        return Err(LibraryError::InvalidInput(format!(
            "seed entry {:?} has no searchable designation",
            entry.simbad_oid
        )));
    }
    let mut aliases: Vec<ResolvedAlias> = Vec::with_capacity(entry.aliases.len() + 1);
    if !entry.aliases.iter().any(|a| a.alias == designation) {
        aliases.push(ResolvedAlias::new(designation.clone(), AliasKind::Designation));
    }
    for seed_alias in entry.aliases {
        if !aliases.iter().any(|a| a.alias == seed_alias.alias) {
            let alias = ResolvedAlias::new(seed_alias.alias, seed_alias.kind);
            if !alias.normalized.is_empty() {
                aliases.push(alias);
            }
        }
    }
    let located = validated_coordinates(entry.ra_deg, entry.dec_deg)
        .filter(|_| match_position(entry.ra_deg, entry.dec_deg).is_some());
    Ok(SeedRecord {
        id: target_id_from_designation(ns, &designation),
        simbad_oid: entry.simbad_oid,
        designation,
        common_name: entry.common_name,
        object_type: entry.object_type,
        coordinates: located,
        aliases,
    })
}

fn saved_hit<'a>(
    prepared: &PreparedQuery,
    index: usize,
    candidate: &'a TargetCandidate,
) -> Option<RankedHit<'a>> {
    let separation_deg = match prepared.cone {
        Some((center, radius)) => {
            let object = Positioned { index, position: candidate_position(candidate)? };
            let found = is_framed(center, &object, Membership::Circular { radius });
            if !found.in_frame {
                return None;
            }
            Some(found.separation.degrees())
        }
        None => None,
    };
    Some(RankedHit {
        source: HitSource::Saved(index),
        id: candidate.id,
        designation: &candidate.designation,
        text: prepared.text_filter(candidate_aliases(candidate))?.matched(),
        separation_deg,
    })
}

// ── User targets ─────────────────────────────────────────────────────────────

/// Fields of an explicit user-defined target.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTargetInput {
    pub designation: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub common_name: Option<String>,
    pub object_type: ObjectType,
    /// ICRS degrees; `None` keeps the position unknown.
    #[serde(default)]
    pub coordinates: Option<SkyCoordinates>,
}

/// Build an explicit user target with [`Provenance::User`].
///
/// Its id derives from the normalized designation in the user namespace, so it
/// never equals a seed or provider id. Nothing is persisted.
///
/// # Errors
/// `InvalidInput` when the designation or an alias has no searchable
/// characters, or coordinates are outside ICRS ranges or another frame.
pub fn user_target(input: &UserTargetInput) -> Result<TargetCandidate, LibraryError> {
    let designation = input.designation.trim();
    let key = normalize_alias(designation);
    if key.is_empty() {
        return Err(LibraryError::InvalidInput(format!(
            "user target designation {designation:?} has no searchable characters"
        )));
    }
    let coordinates = match &input.coordinates {
        Some(c) if c.frame != ICRS_FRAME => {
            return Err(LibraryError::InvalidInput(format!(
                "user target coordinates must use the {ICRS_FRAME} frame, not {:?}",
                c.frame
            )));
        }
        Some(c) => Some(validated_coordinates(c.ra_deg, c.dec_deg).ok_or_else(|| {
            LibraryError::InvalidInput(format!(
                "user target coordinates ({}, {}) are outside ICRS degree ranges",
                c.ra_deg, c.dec_deg
            ))
        })?),
        None => None,
    };
    let common_name = input.common_name.as_deref().map(str::trim).filter(|name| !name.is_empty());
    let mut aliases = Vec::with_capacity(input.aliases.len() + 2);
    push_user_alias(&mut aliases, designation, AliasKind::Designation)?;
    if let Some(name) = common_name {
        push_user_alias(&mut aliases, name, AliasKind::CommonName)?;
    }
    for alias in &input.aliases {
        push_user_alias(&mut aliases, alias.trim(), AliasKind::User)?;
    }
    Ok(TargetCandidate {
        id: target_id_from_designation(&namespace(USER_TARGET_ID_NAMESPACE), &key),
        designation: designation.to_owned(),
        aliases,
        common_name: common_name.map(str::to_owned),
        object_type: input.object_type.as_wire().to_owned(),
        coordinates,
        provenance: Provenance::User,
        provider_id: None,
    })
}

fn push_user_alias(
    aliases: &mut Vec<TargetAlias>,
    text: &str,
    kind: AliasKind,
) -> Result<(), LibraryError> {
    let normalized = normalize_alias(text);
    if normalized.is_empty() {
        return Err(LibraryError::InvalidInput(format!(
            "user target alias {text:?} has no searchable characters"
        )));
    }
    if !aliases.iter().any(|a| a.normalized == normalized) {
        aliases.push(TargetAlias {
            text: text.to_owned(),
            normalized,
            kind: kind.as_wire().to_owned(),
            provenance: Provenance::User,
        });
    }
    Ok(())
}

// ── Provider adapter ─────────────────────────────────────────────────────────

/// SIMBAD provider behind the `simbad_resolver` cache-first facade.
///
/// The facade cache is in-memory and holds provider rows only; local search
/// never depends on this type.
pub struct TargetResolver<R: Resolver> {
    facade: SimbadResolver<R>,
    namespace: Uuid,
}

/// Online SIMBAD TAP provider.
pub type SimbadTargetResolver = TargetResolver<TapResolver>;
/// Provider for disabled online resolution.
pub type OfflineTargetResolver = TargetResolver<OfflineResolver>;

impl TargetResolver<TapResolver> {
    /// Online SIMBAD TAP provider for `config`.
    ///
    /// # Errors
    /// `ProviderUnavailable` when the endpoint or HTTP client is invalid.
    pub fn simbad(config: &SimbadConfig) -> Result<Self, LibraryError> {
        let resolver = TapResolver::new(config).map_err(|error| {
            LibraryError::ProviderUnavailable(format!("{SIMBAD_PROVIDER}: {error}"))
        })?;
        Self::new(resolver, true)
    }
}

impl TargetResolver<OfflineResolver> {
    /// Provider used when online resolution is disabled; every resolve is
    /// `ProviderUnavailable`.
    ///
    /// # Errors
    /// `ProviderUnavailable` when the in-memory facade cache cannot open.
    pub fn offline() -> Result<Self, LibraryError> {
        Self::new(OfflineResolver, false)
    }
}

impl<R: Resolver> TargetResolver<R> {
    /// Wrap any `simbad_resolver` backend; `online = false` never calls it.
    ///
    /// # Errors
    /// `ProviderUnavailable` when the in-memory facade cache cannot open.
    pub fn new(resolver: R, online: bool) -> Result<Self, LibraryError> {
        let config = ResolverConfig::new(TARGET_ID_NAMESPACE).with_online(online);
        let namespace = config.namespace;
        let facade =
            SimbadResolver::new(resolver, CacheBackend::InMemory, config).map_err(|error| {
                LibraryError::ProviderUnavailable(format!("{SIMBAD_PROVIDER} cache: {error}"))
            })?;
        Ok(Self { facade, namespace })
    }

    /// Resolve `query` to a provider candidate.
    ///
    /// The candidate id equals the seed id for the same designation, so a
    /// saved provider record shadows that seed record.
    ///
    /// # Errors
    /// - `InvalidInput`: no searchable characters, or several provider objects match.
    /// - `NotFound`: the provider knows no such object.
    /// - `ProviderUnavailable`: offline, transport/timeout failure, or a non-provider row.
    pub async fn resolve(&self, query: &str) -> Result<TargetCandidate, LibraryError> {
        let query = query.trim();
        if normalize_alias(query).is_empty() {
            return Err(LibraryError::InvalidInput(format!(
                "target query {query:?} has no searchable characters"
            )));
        }
        match self.facade.resolve(query).await {
            Ok(Resolution::Resolved(target)) => provider_candidate(&self.namespace, &target),
            Ok(Resolution::Unresolved { reason, .. }) => Err(match reason {
                UnresolvedReason::Offline => LibraryError::ProviderUnavailable(format!(
                    "{SIMBAD_PROVIDER} is unavailable for {query:?}"
                )),
                UnresolvedReason::Unknown => {
                    LibraryError::NotFound(format!("{SIMBAD_PROVIDER} has no object for {query:?}"))
                }
                UnresolvedReason::Ambiguous => LibraryError::InvalidInput(format!(
                    "{query:?} matches several {SIMBAD_PROVIDER} objects"
                )),
            }),
            Err(error) => {
                Err(LibraryError::ProviderUnavailable(format!("{SIMBAD_PROVIDER}: {error}")))
            }
        }
    }
}

fn provider_candidate(ns: &Uuid, target: &CachedTarget) -> Result<TargetCandidate, LibraryError> {
    if target.source != TargetSource::Resolved {
        return Err(LibraryError::ProviderUnavailable(format!(
            "{SIMBAD_PROVIDER} returned a {} row instead of a provider identity",
            target.source.as_wire()
        )));
    }
    let provider_id = target.simbad_oid.map(|oid| oid.to_string());
    let provenance =
        Provenance::Provider { name: SIMBAD_PROVIDER.to_owned(), id: provider_id.clone() };
    let mut aliases: Vec<TargetAlias> = Vec::with_capacity(target.aliases.len() + 1);
    let designation =
        ResolvedAlias::new(target.primary_designation.clone(), AliasKind::Designation);
    for alias in std::iter::once(&designation).chain(&target.aliases) {
        if !alias.normalized.is_empty() && !aliases.iter().any(|a| a.text == alias.alias) {
            aliases.push(TargetAlias {
                text: alias.alias.clone(),
                normalized: alias.normalized.clone(),
                kind: alias.kind.as_wire().to_owned(),
                provenance: provenance.clone(),
            });
        }
    }
    Ok(TargetCandidate {
        id: target_id_from_designation(ns, &target.primary_designation),
        designation: target.primary_designation.clone(),
        aliases,
        common_name: target.common_name.clone(),
        object_type: target.object_type.as_wire().to_owned(),
        coordinates: validated_coordinates(target.ra_deg, target.dec_deg),
        provenance,
        provider_id,
    })
}

// ── Association evidence ─────────────────────────────────────────────────────

/// Association evidence for one candidate against one session's frames.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetAssessment {
    pub candidate: TargetCandidate,
    pub state: AssociationState,
    pub evidence: Vec<EvidenceItem>,
    pub provenance: Provenance,
}

#[derive(Clone, Copy)]
struct Support {
    supports: bool,
    qualified: bool,
}

/// Assess whether `frames` (one session's light frames) show `candidate`.
///
/// Suggested requires both an `OBJECT` alias on every frame that agrees
/// with the candidate, and the candidate inside every frame's inscribed field
/// (`target-match` [`RadiusPolicy::Inscribed`]) around its plate-solved or
/// header pointing. Either alone, or with missing or conflicting evidence, is
/// `NeedsReview`; no agreeing evidence is Unresolved. Never Confirmed.
#[must_use]
pub fn assess_target(candidate: &TargetCandidate, frames: &[CaptureMetadata]) -> TargetAssessment {
    let mut evidence = Vec::new();
    let alias = alias_evidence(candidate, frames, &mut evidence);
    let coordinates = coordinate_evidence(candidate, frames, &mut evidence);
    let state = if alias.qualified && coordinates.qualified {
        AssociationState::Suggested
    } else if alias.supports || coordinates.supports {
        AssociationState::NeedsReview
    } else {
        AssociationState::Unresolved
    };
    TargetAssessment {
        candidate: candidate.clone(),
        state,
        evidence,
        provenance: Provenance::Inferred { rule: ASSOCIATION_RULE.to_owned() },
    }
}

fn alias_evidence(
    candidate: &TargetCandidate,
    frames: &[CaptureMetadata],
    evidence: &mut Vec<EvidenceItem>,
) -> Support {
    let mut observed: BTreeMap<String, &str> = BTreeMap::new();
    let mut missing = frames.is_empty();
    for frame in frames {
        let raw = frame.object.as_deref().unwrap_or_default();
        let key = normalize_alias(raw);
        if key.is_empty() {
            missing = true;
        } else {
            observed.entry(key).or_insert(raw);
        }
    }
    let agreement: Vec<(&String, bool)> = observed
        .keys()
        .map(|key| (key, candidate.aliases.iter().any(|a| a.normalized == *key)))
        .collect();
    let supports = agreement.iter().any(|&(_, agrees)| agrees);
    let all_agree = !agreement.is_empty() && agreement.iter().all(|&(_, agrees)| agrees);
    // Different spellings of this candidate's aliases agree; any other value conflicts.
    if observed.len() > 1 && !all_agree {
        evidence.push(EvidenceItem::Conflict {
            field: "OBJECT".into(),
            values: observed.values().map(|raw| (*raw).to_owned()).collect(),
        });
    }
    for (key, agrees) in agreement {
        evidence.push(EvidenceItem::Alias { normalized: key.clone(), agrees });
    }
    if missing {
        evidence.push(EvidenceItem::Unknown { field: "OBJECT".into() });
    }
    Support { supports, qualified: all_agree && !missing }
}

fn coordinate_evidence(
    candidate: &TargetCandidate,
    frames: &[CaptureMetadata],
    evidence: &mut Vec<EvidenceItem>,
) -> Support {
    let target = candidate_position(candidate);
    if target.is_none() {
        evidence.push(EvidenceItem::Unknown { field: "target_coordinates".into() });
    }
    let mut ra_mean = skymath::CircularMean::new();
    let (mut dec_sum, mut located) = (0.0, 0.0);
    let (mut missing_pointing, mut missing_field) = (frames.is_empty(), false);
    let (mut all_framed, mut any_framed) = (!frames.is_empty() && target.is_some(), false);
    for frame in frames {
        let Some((ra_deg, dec_deg, pointing)) = frame_pointing(frame) else {
            missing_pointing = true;
            all_framed = false;
            continue;
        };
        ra_mean.push(skymath::Angle::from_degrees(ra_deg));
        dec_sum += dec_deg;
        located += 1.0;
        let radius = inscribed_radius(frame);
        missing_field |= radius.is_none();
        let inside = target.zip(radius).is_some_and(|(position, radius)| {
            is_framed(pointing, &Positioned { index: 0, position }, Membership::Circular { radius })
                .in_frame
        });
        all_framed &= inside;
        any_framed |= inside;
    }
    if let Some(ra) = ra_mean.mean() {
        evidence.push(EvidenceItem::Coordinates {
            ra_deg: ra.degrees(),
            dec_deg: dec_sum / located,
            qualified: all_framed,
        });
    }
    if missing_pointing {
        evidence.push(EvidenceItem::Unknown { field: "pointing".into() });
    }
    if missing_field {
        evidence.push(EvidenceItem::Unknown { field: "field_of_view".into() });
    }
    Support { supports: any_framed, qualified: all_framed }
}

/// Plate-solved centre when valid, else the header pointing.
fn frame_pointing(frame: &CaptureMetadata) -> Option<(f64, f64, match_sky::Equatorial)> {
    [(frame.wcs_ra_deg, frame.wcs_dec_deg), (frame.ra_deg, frame.dec_deg)].into_iter().find_map(
        |(ra, dec)| {
            let (ra, dec) = (ra?, dec?);
            match_position(ra, dec).map(|pointing| (ra, dec, pointing))
        },
    )
}

/// Radius of the circle inscribed in the frame, which holds for any sky
/// rotation. Binning stays 1×1 because pixel counts are already binned: a
/// writer reporting the pixel size either before or after binning then never
/// overstates the field.
fn inscribed_radius(frame: &CaptureMetadata) -> Option<match_sky::Angle> {
    let pixel = frame.pixel_size_um?;
    Field::from_optics(Optics {
        focal_mm: frame.focal_length_mm?,
        pixel_um: (pixel, pixel),
        binning: (1, 1),
        pixels: (frame.width?, frame.height?),
    })
    .ok()
    .map(|field| field.radius(RadiusPolicy::Inscribed))
}

fn frame_field(frame: &CaptureMetadata) -> Option<(match_sky::Equatorial, match_sky::Angle)> {
    Some((frame_pointing(frame)?.2, inscribed_radius(frame)?))
}

const fn state_order(state: &AssociationState) -> u8 {
    match state {
        AssociationState::Confirmed => 0,
        AssociationState::Suggested => 1,
        AssociationState::NeedsReview => 2,
        AssociationState::Unresolved => 3,
    }
}
