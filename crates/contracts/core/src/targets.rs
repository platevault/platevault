//! Target contract DTOs for the Tauri IPC surface.
//!
//! This module contains two generations of target types that coexist:
//!
//! ## Spec 029 legacy types (kept for backward compat with existing UI stubs)
//!
//! [`Target`], [`TargetDetail`], [`TargetProjectStub`], [`CatalogIds`],
//! [`Coordinates`], [`TargetKind`] — originally generated for the Targets
//! page fixture surface.  These remain intact until the page is fully wired
//! and the stubs can be removed.
//!
//! ## Spec 023 types (target identity, aliases, history, notes)
//!
//! [`CatalogRef`], [`TargetIdentity`], [`TargetSession`], [`TargetProject`],
//! [`TargetGetResult`] — the five contract DTOs for `target.get`,
//! `target.note.update`, `target.alias.add`, `target.alias.remove`, and
//! `target.primary.rename`.

use crate::lifecycle::ProjectState;
use crate::sessions::AcquisitionSession;
use serde::{Deserialize, Serialize};
use specta::Type;

// ── Enums ───────────────────────────────────────────────────────────────────

/// Classification of an astronomical target.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    DeepSky,
    Planetary,
    Lunar,
    Solar,
    Landscape,
}

// ── Structs ─────────────────────────────────────────────────────────────────

/// Catalog identifiers for a target (NGC, IC, Messier, etc.).
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogIds {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ngc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub messier: Option<String>,
}

/// Equatorial coordinates (J2000).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Coordinates {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ra: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dec: Option<f64>,
}

/// An astronomical target as seen in list views.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub catalog_ids: CatalogIds,
    pub kind: TargetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coordinates: Option<Coordinates>,
    pub session_count: u32,
    pub project_count: u32,
    pub total_integration_hours: f64,
    /// Filter name -> acquired hours.
    pub coverage: std::collections::HashMap<String, f64>,
    /// Filter name -> recommended hours.
    pub recommended_hours: std::collections::HashMap<String, f64>,
}

/// A project stub within the target detail view.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetProjectStub {
    pub id: String,
    pub name: String,
    pub state: ProjectState,
}

/// Extended detail view of a target.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetDetail {
    // Flattened base fields from Target.
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub catalog_ids: CatalogIds,
    pub kind: TargetKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coordinates: Option<Coordinates>,
    pub session_count: u32,
    pub project_count: u32,
    pub total_integration_hours: f64,
    pub coverage: std::collections::HashMap<String, f64>,
    pub recommended_hours: std::collections::HashMap<String, f64>,
    // Detail-only fields.
    pub sessions: Vec<AcquisitionSession>,
    pub projects: Vec<TargetProjectStub>,
}

// ── Spec 023 DTOs ────────────────────────────────────────────────────────────
//
// These types implement the five JSON Schema contracts in
// `specs/023-target-identity-history-notes/contracts/`.

/// Structured catalog reference for a target (spec 023 data-model.md).
///
/// Mirrors `CatalogRef` in `target.get.json`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRef {
    /// Closed enum slug (e.g. `"messier"`, `"openngc"`).
    pub catalog_id: String,
    /// Human-readable catalog name (e.g. `"Messier"`, `"OpenNGC"`).
    pub catalog_display: String,
    /// Catalog-local designation (e.g. `"M31"`, `"NGC 224"`).
    pub designation: String,
}

/// Full target identity returned by `target.get` (spec 023 contract).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetIdentity {
    pub id: String,
    /// Canonical display name (e.g. `"M 31"`).
    pub primary_designation: String,
    /// User-editable aliases (display form, ordered alpha).
    pub aliases: Vec<String>,
    /// Structured catalog identifiers.
    pub catalog_refs: Vec<CatalogRef>,
    /// Per-target free-text note (max 16 KB UTF-8).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A single session row in the target history (spec 023 `TargetSession`).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetSession {
    pub session_id: String,
    /// Night of acquisition per R3 solar-noon formula.
    /// `None` when `observer_location` is null/unreviewed — excluded from
    /// the response entirely by the use case (R-3.1).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frames: Option<u32>,
    /// Deep-link to the Inventory entry.
    pub inventory_id: String,
}

/// A project linked to a target (spec 023 `TargetProject`).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetProject {
    pub project_id: String,
    pub name: String,
    pub lifecycle: String,
    /// Processing tool — REQUIRED per spec 008 R-Tool-Req (GRILL 2026-05-22).
    pub tool: String,
}

/// Full aggregate returned by the `target.get` use case.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetGetResult {
    pub target: TargetIdentity,
    /// Reverse-chronological by `captured_on`. Sessions with `null`
    /// `captured_on` are excluded (R-3.1).
    pub sessions: Vec<TargetSession>,
    /// Ordered by lifecycle then name.
    pub projects: Vec<TargetProject>,
}

// ── Spec 023 mutation request / response types ────────────────────────────────

/// Request for `target.note.update`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetNoteUpdateRequest {
    pub target_id: String,
    /// Replacement note body. Empty string clears the note. Max 16384 bytes.
    pub content: String,
}

/// Response for `target.note.update`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetNoteUpdateResult {
    pub target_id: String,
    pub updated_at: String,
}

/// Request for `target.alias.add`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetAliasAddRequest {
    pub target_id: String,
    /// User-supplied alias display form. Server normalizes for uniqueness.
    pub alias: String,
}

/// Response for `target.alias.add`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetAliasAddResult {
    pub target_id: String,
    /// `true` if newly persisted; `false` if the alias already existed (idempotent).
    pub added: bool,
}

/// Request for `target.alias.remove`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetAliasRemoveRequest {
    pub target_id: String,
    /// Display form of the alias to remove. Server normalizes for lookup.
    pub alias: String,
}

/// Response for `target.alias.remove`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetAliasRemoveResult {
    pub target_id: String,
    pub removed_alias: String,
    pub audit_id: String,
}

/// Request for `target.primary.rename`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetPrimaryRenameRequest {
    pub target_id: String,
    /// Designation to promote. MUST be an existing alias on this target.
    pub new_primary_designation: String,
}

/// Response for `target.primary.rename`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetPrimaryRenameResult {
    pub target_id: String,
    pub prior_primary: String,
    pub new_primary: String,
    pub audit_id: String,
}

/// Generic error envelope for target operations.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetOpError {
    /// Error code string (e.g. `"target.not_found"`, `"alias.duplicate"`).
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<crate::JsonAny>,
}

// ── Spec 035 DTOs — SIMBAD target resolution ──────────────────────────────────
//
// These types implement the three JSON Schema contracts in
// `specs/035-simbad-target-resolution/contracts/`:
// - `target.search.json`
// - `target.resolve.json`
// - `target.resolution-settings.json`
//
// Pure DTOs (no logic): wire parity with the contracts is verified by T009.

/// Closed astronomical object classification (spec 035 `ObjectType`).
///
/// Mapped uniformly from SIMBAD `otype`; unknown values map to `Other`.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum TargetObjectType {
    Galaxy,
    PlanetaryNebula,
    EmissionNebula,
    ReflectionNebula,
    DarkNebula,
    OpenCluster,
    GlobularCluster,
    SupernovaRemnant,
    GalaxyCluster,
    DoubleStar,
    Asterism,
    Other,
}

/// Closed catalogue identifier slug (spec 035 `CatalogId`).
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum TargetCatalogId {
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
}

/// Provenance of a canonical target identity (spec 035).
///
/// `UserOverride` serializes as the hyphenated wire form `user-override`
/// (DTO↔wire parity, T009); the other variants are lower-case words.
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
pub enum TargetSource {
    #[serde(rename = "seed")]
    Seed,
    #[serde(rename = "resolved")]
    Resolved,
    #[serde(rename = "user-override")]
    UserOverride,
}

// ── target.search ─────────────────────────────────────────────────────────────

/// A single ranked typeahead suggestion (`target.search.json` §`Suggestion`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetSuggestion {
    pub target_id: String,
    pub primary_designation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub common_name: Option<String>,
    pub object_type: TargetObjectType,
    /// The alias that matched the query.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_alias: Option<String>,
    pub source: TargetSource,
}

/// Request for `target.search` (`target.search.json` §`Request`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetSearchRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Partial designation or common name.
    pub query: String,
    /// Optional; empty/absent = all catalogues.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub catalog_filter: Vec<TargetCatalogId>,
    /// Optional; empty/absent = all types.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub type_filter: Vec<TargetObjectType>,
    #[serde(default = "default_search_limit")]
    pub limit: u32,
}

fn default_search_limit() -> u32 {
    20
}

/// Response for `target.search` (`target.search.json` §`Response`).
///
/// Local matches only; ordered by match quality. Long-tail/SIMBAD results
/// arrive via `target.resolve`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetSearchResponse {
    pub contract_version: String,
    pub request_id: String,
    pub suggestions: Vec<TargetSuggestion>,
}

// ── target.resolve ────────────────────────────────────────────────────────────

/// Discriminated status for `target.resolve` (`target.resolve.json` §`ResolveStatus`).
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "snake_case")]
pub enum TargetResolveStatus {
    /// A canonical target was determined (from cache or SIMBAD).
    Resolved,
    /// Unknown/garbled, or SIMBAD unreachable with no cached entry — marked
    /// pending, retryable; coordinates never fabricated.
    Unresolved,
}

/// Canonical identity returned by `target.resolve` (`target.resolve.json` §`ResolvedTarget`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTarget {
    pub target_id: String,
    /// SIMBAD physical-object id (dedup key) when resolved online.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub simbad_oid: Option<i64>,
    pub primary_designation: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub common_name: Option<String>,
    pub object_type: TargetObjectType,
    /// ICRS J2000 right ascension in `[0, 360)` decimal degrees.
    pub ra_deg: f64,
    /// ICRS J2000 declination in `[-90, 90]` decimal degrees.
    pub dec_deg: f64,
    pub aliases: Vec<String>,
    pub source: TargetSource,
}

/// Closed error codes for `target.resolve` (`target.resolve.json` §`ErrorCode`).
#[derive(
    Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize, Type,
)]
pub enum TargetResolveErrorCode {
    #[serde(rename = "resolver.unreachable")]
    ResolverUnreachable,
    #[serde(rename = "resolver.disabled")]
    ResolverDisabled,
    #[serde(rename = "resolver.timeout")]
    ResolverTimeout,
    #[serde(rename = "actor.not_authorised")]
    ActorNotAuthorised,
}

/// Error envelope for `target.resolve` (`target.resolve.json` §`ErrorEnvelope`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetResolveError {
    pub code: TargetResolveErrorCode,
    pub message: String,
}

/// Manual user-override directive (`target.resolve.json` §`Request.override`).
///
/// When present, binds `query` to this canonical target; persisted as
/// `source=user-override` and wins over future SIMBAD results (FR-014).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetResolveOverride {
    pub target_id: String,
}

/// Request for `target.resolve` (`target.resolve.json` §`Request`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetResolveSimbadRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Complete designation or common name, or a FITS OBJECT value.
    pub query: String,
    /// When present, records a manual user override.
    #[serde(rename = "override", skip_serializing_if = "Option::is_none")]
    pub override_target: Option<TargetResolveOverride>,
}

/// Response for `target.resolve` (`target.resolve.json` §`Response`).
///
/// `target` is present when `status = Resolved`; `unresolvedReason` is present
/// when `status = Unresolved`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TargetResolveSimbadResponse {
    pub contract_version: String,
    pub request_id: String,
    pub status: TargetResolveStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<ResolvedTarget>,
    /// Present when `status = Unresolved` (e.g. `"unknown"`, `"offline"`,
    /// `"ambiguous"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unresolved_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<TargetResolveError>,
}

// ── target.resolution.settings ────────────────────────────────────────────────

/// SIMBAD resolver settings (`target.resolution-settings.json` §`Settings`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolverSettings {
    /// Enable/disable online SIMBAD resolution (FR-015; default true). When
    /// false, only seed+cache are used.
    pub online_enabled: bool,
    pub simbad_endpoint: String,
    pub debounce_ms: u32,
    pub request_timeout_secs: u32,
}

/// Get request for resolver settings (`target.resolution-settings.json` §`GetRequest`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolverSettingsGetRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Discriminant; always `"get"`.
    pub op: String,
}

/// Update request for resolver settings (`target.resolution-settings.json` §`UpdateRequest`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolverSettingsUpdateRequest {
    pub contract_version: String,
    pub request_id: String,
    /// Discriminant; always `"update"`.
    pub op: String,
    pub settings: ResolverSettings,
}

/// Response for resolver settings get/update (`target.resolution-settings.json` §`Response`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolverSettingsResponse {
    pub contract_version: String,
    pub request_id: String,
    pub settings: ResolverSettings,
}
