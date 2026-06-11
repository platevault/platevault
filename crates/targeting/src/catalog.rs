//! Core catalog types for spec 013 — Target Lookup From FITS OBJECT.
//!
//! These types mirror the data-model.md entities: [`CatalogEntry`],
//! [`CatalogEquivalence`], [`TargetCatalog`], and the match types
//! [`TargetMatch`] and [`MatchEvidence`].
//!
//! The in-memory [`TargetCatalog`] is built from SQLite rows at startup
//! (see [`crate::load`]) and rebuilt on `catalog.download.completed` events.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── CatalogId ─────────────────────────────────────────────────────────────────

/// Closed enum of v1 catalog slugs (data-model.md §CatalogRef, research.md R1).
///
/// String slugs that do not match any variant are represented by `Unknown`.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogId {
    Messier,
    Caldwell,
    Sharpless,
    AbellPn,
    AbellGalaxies,
    Arp,
    Vdb,
    Barnard,
    Lbn,
    Ldn,
    Melotte,
    Common,
    Openngc,
    /// A slug not in the v1 closed set; rejected at index-build time.
    Unknown(String),
}

impl CatalogId {
    /// Parse a catalog slug string into a `CatalogId`.
    #[must_use]
    pub fn from_slug(s: &str) -> Self {
        match s {
            "messier" => Self::Messier,
            "caldwell" => Self::Caldwell,
            "sharpless" => Self::Sharpless,
            "abell_pn" => Self::AbellPn,
            "abell_galaxies" => Self::AbellGalaxies,
            "arp" => Self::Arp,
            "vdb" => Self::Vdb,
            "barnard" => Self::Barnard,
            "lbn" => Self::Lbn,
            "ldn" => Self::Ldn,
            "melotte" => Self::Melotte,
            "common" => Self::Common,
            "openngc" => Self::Openngc,
            other => Self::Unknown(other.to_owned()),
        }
    }

    /// Return the canonical slug string.
    #[must_use]
    pub fn as_slug(&self) -> &str {
        match self {
            Self::Messier => "messier",
            Self::Caldwell => "caldwell",
            Self::Sharpless => "sharpless",
            Self::AbellPn => "abell_pn",
            Self::AbellGalaxies => "abell_galaxies",
            Self::Arp => "arp",
            Self::Vdb => "vdb",
            Self::Barnard => "barnard",
            Self::Lbn => "lbn",
            Self::Ldn => "ldn",
            Self::Melotte => "melotte",
            Self::Common => "common",
            Self::Openngc => "openngc",
            Self::Unknown(s) => s.as_str(),
        }
    }

    /// Return the display name for this catalog.
    #[must_use]
    pub fn display_name(&self) -> &str {
        match self {
            Self::Messier => "Messier",
            Self::Caldwell => "Caldwell",
            Self::Sharpless => "Sharpless 2",
            Self::AbellPn => "Abell Planetary Nebulae",
            Self::AbellGalaxies => "Abell Galaxy Clusters",
            Self::Arp => "Arp",
            Self::Vdb => "van den Bergh",
            Self::Barnard => "Barnard",
            Self::Lbn => "Lynds Bright Nebulae",
            Self::Ldn => "Lynds Dark Nebulae",
            Self::Melotte => "Melotte",
            Self::Common => "Common Names",
            Self::Openngc => "OpenNGC",
            Self::Unknown(_) => "Unknown",
        }
    }

    /// Return the numeric precedence for this catalog (lower = higher precedence).
    ///
    /// Precedence table (data-model.md):
    /// `messier > caldwell > openngc[ngc] > openngc[ic] > sharpless > abell_pn >
    ///  abell_galaxies > arp > vdb > barnard > lbn > ldn > melotte > common`
    #[must_use]
    pub fn precedence(&self) -> u8 {
        match self {
            Self::Messier => 0,
            Self::Caldwell => 1,
            Self::Openngc => 2,
            Self::Sharpless => 3,
            Self::AbellPn => 4,
            Self::AbellGalaxies => 5,
            Self::Arp => 6,
            Self::Vdb => 7,
            Self::Barnard => 8,
            Self::Lbn => 9,
            Self::Ldn => 10,
            Self::Melotte => 11,
            Self::Common => 12,
            Self::Unknown(_) => 255,
        }
    }

    /// Return `true` when the slug is in the v1 closed set.
    #[must_use]
    pub fn is_known(&self) -> bool {
        !matches!(self, Self::Unknown(_))
    }
}

// ── CatalogRef ────────────────────────────────────────────────────────────────

/// A reference to an entry in a specific source catalog (data-model.md §CatalogRef).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogRef {
    pub catalog_id: CatalogId,
    /// Human-readable catalog display name, e.g. `"Messier"`.
    pub catalog_display: String,
    /// Catalog-local designation, e.g. `"M31"` or `"NGC 224"`.
    pub designation: String,
}

// ── CatalogEntry ──────────────────────────────────────────────────────────────

/// An in-memory entry representing one canonical target and all its aliases.
///
/// Built from the `targets`, `target_catalog_refs`, and `catalog_equivalences`
/// rows at startup. [`TargetCatalog`] holds one entry per target.
#[derive(Clone, Debug)]
pub struct CatalogEntry {
    /// Stable UUIDv5 target identity.
    pub target_id: Uuid,
    /// Canonical display designation chosen by precedence table.
    pub primary_designation: String,
    /// Display name of the precedence-winning catalog.
    pub primary_catalog_display: String,
    /// All catalog refs for this target.
    pub refs: Vec<CatalogRef>,
}

// ── Confidence / Strategy ─────────────────────────────────────────────────────

/// Confidence bucket for a target match (data-model.md §TargetMatch).
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

/// Which matching stage produced the score (data-model.md §MatchEvidence).
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchStrategy {
    Exact,
    TokenSet,
    EditDistance,
}

// ── MatchEvidence ─────────────────────────────────────────────────────────────

/// Traceability evidence for a single match (data-model.md §MatchEvidence).
///
/// `f64` fields use bitwise equality (not IEEE 754 NaN-aware equality) since
/// scores are always finite values in `[0, 100]` produced by this module.
#[derive(Clone, Debug, PartialEq)]
pub struct MatchEvidence {
    pub matched_alias: String,
    pub normalized_query: String,
    pub strategy: MatchStrategy,
    /// Raw similarity score in `[0, 100]`; `100` for exact matches.
    pub score: f64,
}

// ── TargetMatch ───────────────────────────────────────────────────────────────

/// The result of evaluating a query against the catalog (data-model.md §TargetMatch).
///
/// `PartialEq` is derived; `f64` score fields are finite in `[0, 100]` so
/// bitwise equality is acceptable within tests.
#[derive(Clone, Debug, PartialEq)]
pub struct TargetMatch {
    pub target_id: Uuid,
    pub primary_designation: String,
    pub primary_catalog_display: String,
    pub confidence: Confidence,
    /// Raw score in `[0, 100]`.
    pub score: f64,
    pub evidence: MatchEvidence,
}

// ── TargetCatalog ─────────────────────────────────────────────────────────────

/// In-memory index of all catalog entries for fast lookup.
///
/// Keyed by normalized alias string → [`CatalogEntry`] index position.
/// Rebuilt from SQLite at startup and on `catalog.download.completed`.
#[derive(Clone, Debug, Default)]
pub struct TargetCatalog {
    /// All catalog entries, indexed by position for cheap cloning.
    entries: Vec<CatalogEntry>,
    /// Normalized alias → entry index into `entries`.
    alias_index: HashMap<String, usize>,
}

impl TargetCatalog {
    /// Create a new empty catalog.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Build the catalog from a list of entries.
    ///
    /// Each entry contributes all of its aliases (the primary designation plus
    /// every catalog designation) under their normalized forms. Duplicate
    /// normalized aliases are silently ignored (first entry wins).
    #[must_use]
    pub fn from_entries(entries: Vec<CatalogEntry>) -> Self {
        let mut catalog = Self::new();
        for (idx, entry) in entries.iter().enumerate() {
            // Index primary designation.
            let norm = crate::normalize::normalize(&entry.primary_designation);
            catalog.alias_index.entry(norm).or_insert(idx);

            // Index every catalog ref designation.
            for r in &entry.refs {
                let norm = crate::normalize::normalize(&r.designation);
                catalog.alias_index.entry(norm).or_insert(idx);
            }
        }
        catalog.entries = entries;
        catalog
    }

    /// Return the number of entries in the catalog.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Return `true` when the catalog has no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Look up an already-normalized query in the exact alias index.
    ///
    /// Returns a reference to the matching [`CatalogEntry`] or `None`.
    #[must_use]
    pub fn exact_lookup(&self, normalized: &str) -> Option<&CatalogEntry> {
        self.alias_index.get(normalized).map(|&idx| &self.entries[idx])
    }

    /// Iterate over all entries for fuzzy scoring.
    pub fn iter_entries(&self) -> impl Iterator<Item = &CatalogEntry> {
        self.entries.iter()
    }

    /// Return all (normalized_alias, entry_index) pairs for fuzzy iteration.
    pub fn iter_aliases(&self) -> impl Iterator<Item = (&str, &CatalogEntry)> {
        self.alias_index.iter().map(|(alias, &idx)| (alias.as_str(), &self.entries[idx]))
    }
}
