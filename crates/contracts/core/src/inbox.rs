//! Inbox contract DTOs for the Tauri IPC surface (spec 005 / spec 041).
//!
//! Matches `specs/005-inbox-mixed-folder-split/contracts/`:
//!   - `inbox.classify.json` (v1.1.0)
//!   - `inbox.confirm.json`  (v1.1.0)
//!   - `inbox.reclassify.json` (v1.0.0)
//!
//! Extended by spec 041 (inbox plan surface / phase 2):
//!   - `InboxFileMetadata` / `inbox.item.metadata` (US2/FR-010)
//!   - `InboxStats` / `inbox.stats` (US6/FR-021)
//!   - `InboxReclassifyOverride` gains optional `filter` / `exposure_s` / `binning` (R-3)
//!   - `InboxConfirmResponse` gains `actions_summary` + `organization_state` (US4/US5)
//!   - `InboxPlanView` / `inbox.plan` (US1/FR-003/FR-004)
//!   - `InboxListItem` gains `organization_state` (spec 041)

use serde::{Deserialize, Serialize};
use specta::Type;

// ── Legacy scan DTOs (retained for backward compat with spec 030) ─────────────

/// A file entry discovered during an inbox scan.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxFileEntry {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub extension: String,
}

/// Result of an inbox scan operation.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxScanResult {
    pub root_id: String,
    pub entries: Vec<InboxFileEntry>,
    pub total_count: u32,
    pub total_size_bytes: u64,
}

// ── inbox.classify ────────────────────────────────────────────────────────────

/// Request for `inbox.classify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxClassifyRequest {
    pub inbox_item_id: String,
    #[serde(default)]
    pub force_rescan: bool,
    /// Absolute path to the inbox root on disk (needed by the use case to
    /// locate files). Not in the JSON Schema (transport detail).
    pub root_absolute_path: String,
}

/// One frame-type breakdown entry in a classify response.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxBreakdownEntry {
    pub kind: String,
    pub count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_preview: Option<String>,
    pub sample_files: Vec<String>,
}

/// Response from `inbox.classify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxClassifyResponse {
    pub inbox_item_id: String,
    /// `"single_type"` | `"mixed"` | `"unclassified"`
    #[serde(rename = "type")]
    pub classification_type: String,
    /// Present only when `type == "single_type"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_type: Option<String>,
    pub content_signature: String,
    pub breakdown: Vec<InboxBreakdownEntry>,
    /// Relative file paths whose IMAGETYP was absent, unreadable, or unmapped.
    pub unclassified_files: Vec<String>,
    pub sample_files: Vec<String>,
    pub computed_at: String,
}

// ── inbox.confirm ─────────────────────────────────────────────────────────────

/// Request for `inbox.confirm`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxConfirmRequest {
    pub inbox_item_id: String,
    /// `"split"` for mixed items; `"confirm"` for `single_type` items.
    pub action: String,
    pub content_signature: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive_destination: Option<String>,
    /// Absolute path to the inbox root on disk (needed to read FITS/XISF
    /// headers for destination resolution). Not in the JSON Schema contract
    /// (Tauri transport detail only).
    pub root_absolute_path: String,
    /// Caller-selected destination library root (spec 041 US8/FR-029).
    ///
    /// Only consulted for inbox sources whose frame-type category has more than
    /// one candidate library root. When exactly one candidate exists it is
    /// auto-selected and this field is ignored; for non-inbox sources the file
    /// stays in place. Supplying a root that is not a valid candidate for the
    /// item's category is rejected with `inbox.invalid_destination_root`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_id: Option<String>,
}

/// A candidate destination library root for an inbox item's frame-type
/// category (spec 041 US8/FR-029).
///
/// Returned in the `inbox.destination_root_required` error data so the UI can
/// render a picker, with `kind` for grouping/labelling.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxDestinationRoot {
    pub root_id: String,
    pub path: String,
    /// Source kind: `"light_frames"` | `"calibration"` | `"project"` | `"inbox"`.
    pub kind: String,
}

/// Summary of plan actions split by type (spec 041 US4/US5/FR-020).
///
/// Lets the UI show "N move / M catalogue" without iterating plan items.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxConfirmActionsSummary {
    /// Number of plan items with `action = "move"`.
    pub move_count: u32,
    /// Number of plan items with `action = "catalogue"`.
    pub catalogue_count: u32,
}

/// Resolved destination preview for one confirmed plan action (spec 041
/// US8/FR-031).
///
/// Carries the **absolute** destination (chosen root path + resolved relative
/// path) so the UI can show the full on-disk path without re-resolving roots.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxConfirmDestination {
    pub from_path: String,
    /// Resolved relative path under the destination root.
    pub to_relative_path: String,
    /// Absolute destination = chosen root path + `/` + `to_relative_path`
    /// (equals the source location for `catalogue` actions).
    pub to_absolute_path: String,
    /// Id of the chosen destination root.
    pub to_root_id: String,
    /// `"move"` | `"catalogue"`.
    pub action: String,
}

/// Response from `inbox.confirm`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxConfirmResponse {
    pub plan_id: String,
    /// Always `"ready_for_review"` for plans created here; empty string for
    /// master-registration responses.
    pub plan_state: String,
    pub items_total: u32,
    /// True when the item was a detected calibration master that was registered
    /// directly to `calibration_session` + `calibration_fingerprint` (Path 1 —
    /// no file move).  `plan_id` is an empty string in this case.
    pub registered_as_master: bool,
    /// Breakdown of plan actions produced (spec 041 US4/FR-020).
    /// `None` when `registered_as_master` is true (no plan was created).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actions_summary: Option<InboxConfirmActionsSummary>,
    /// Organization state of the source owning this item (spec 041 R-7).
    /// `"organized"` | `"unorganized"`. `None` when `registered_as_master`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_state: Option<String>,
    /// Per-action absolute destination previews (spec 041 US8/FR-031).
    /// Empty for master-registration responses.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub destinations: Vec<InboxConfirmDestination>,
}

// ── inbox.reclassify ──────────────────────────────────────────────────────────

/// A single file override in a reclassify request.
///
/// Extended by spec 041 (R-3) to carry optional filter/exposure/binning
/// overrides alongside frame type. Any subset of fields may be set per file;
/// omitted fields leave the existing persisted override unchanged.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxReclassifyOverride {
    pub file_path: String,
    /// Override for the IMAGETYP / frame type.  `None` = leave unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_type: Option<String>,
    /// Override for the FILTER header value.  `None` = leave unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    /// Override for exposure in seconds (EXPTIME/EXPOSURE).  `None` = leave unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure_s: Option<f64>,
    /// Override for binning as a human-readable string e.g. `"2x2"`.  `None` = leave unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binning: Option<String>,
}

/// Request for `inbox.reclassify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxReclassifyRequest {
    pub inbox_item_id: String,
    pub overrides: Vec<InboxReclassifyOverride>,
}

/// Response from `inbox.reclassify`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxReclassifyResponse {
    pub inbox_item_id: String,
    /// `"single_type"` | `"mixed"` | `"unclassified"` after re-aggregation.
    pub updated_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_type: Option<String>,
    pub remaining_unclassified: u32,
    /// Number of files whose overrides were applied (FR-014).
    pub applied_count: u32,
    /// Rebuilt breakdown after overrides (FR-015).
    pub breakdown: Vec<InboxBreakdownEntry>,
}

// ── inbox.scan.folder ─────────────────────────────────────────────────────────

/// Request to scan a root directory and discover inbox items.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxScanFolderRequest {
    pub root_id: String,
    pub root_absolute_path: String,
    #[serde(default)]
    pub follow_symlinks: bool,
}

/// A discovered inbox item returned from the scan.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemSummary {
    pub inbox_item_id: String,
    pub relative_path: String,
    pub file_count: u32,
    pub lane: String,
    /// Real file format for this item: `"fits"` | `"xisf"` | `"video"` | `"mixed"`.
    ///
    /// Unlike `lane` (which only distinguishes FITS vs video), `format` tells
    /// the UI whether the item contains FITS files, XISF files, a mix of both,
    /// or video files.  Spec 040 FR-006.
    pub format: String,
    pub state: String,
    pub content_signature: String,
    /// `true` when this item represents a single detected calibration master
    /// file (`relative_path` is a file path, not a folder path).  Spec 040 FR-005.
    pub is_master: bool,
    /// Base frame type for master items (`"dark"` | `"flat"` | `"bias"` | …).
    /// `null` for grouped sub-frame folder items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_frame_type: Option<String>,
    /// Filter label extracted from master file metadata (if available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_filter: Option<String>,
    /// Exposure in seconds extracted from master file metadata (if available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_exposure_s: Option<f64>,
}

/// Response from `inbox.scan.folder`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxScanFolderResponse {
    pub root_id: String,
    pub items: Vec<InboxItemSummary>,
}

// ── Cross-root unacknowledged list (spec 039) ─────────────────────────────────

/// One unacknowledged inbox item returned by `inbox.list`.
///
/// Extends `InboxItemSummary` with the root's id and absolute path so the UI
/// can group/label items by root without a second call.
///
/// Spec 041: gains `organization_state` so the list can show
/// move-vs-catalogue intent per item without a separate source lookup.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxListItem {
    pub inbox_item_id: String,
    pub root_id: String,
    /// Absolute path of the registered root (for display and confirm calls).
    pub root_absolute_path: String,
    pub relative_path: String,
    pub file_count: u32,
    pub lane: String,
    /// Real file format: `"fits"` | `"xisf"` | `"video"` | `"mixed"`.  Spec 040 FR-006.
    pub format: String,
    pub state: String,
    pub content_signature: String,
    /// `true` when this row represents a single detected calibration master file.
    pub is_master: bool,
    /// Base frame type for master items; `null` for grouped sub-frame folders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_frame_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub master_exposure_s: Option<f64>,
    /// Organization state of the owning source: `"organized"` | `"unorganized"`.
    /// Spec 041 — lets the list surface move-vs-catalogue intent per item.
    pub organization_state: String,
    // ── Per-item grouping keys (spec 041 — multi-level grouping UI) ─────────────
    //
    // Each is an aggregate LABEL computed across the item's persisted per-file
    // metadata (`inbox_file_metadata`) / classification evidence:
    //   - 0 distinct non-null values  -> `None`     (frontend buckets as "(none)")
    //   - exactly 1 distinct value    -> `Some(value)`
    //   - 2+ distinct values          -> `Some("Mixed")`
    // Exception: `group_frame_type` is the item's DOMINANT frame type (largest
    // group), never `"Mixed"`; `None` only when no frame type is known.
    /// Object / target (FITS `OBJECT`). `Some("Mixed")` if files disagree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_target: Option<String>,
    /// Dominant effective frame type across the item's files (largest group).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_frame_type: Option<String>,
    /// Capture date as `YYYY-MM-DD` from the earliest `DATE-OBS`.
    /// `Some("Mixed")` if files span multiple distinct dates.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_date: Option<String>,
    /// Filter label (FITS `FILTER`). `Some("Mixed")` if files disagree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_filter: Option<String>,
    /// Exposure formatted like `"300s"` (trailing zeros trimmed).
    /// `Some("Mixed")` if files have multiple distinct exposures.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_exposure: Option<String>,
    /// Camera / instrument (FITS `INSTRUME`). `Some("Mixed")` if files disagree.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_instrument: Option<String>,
}

/// Response from `inbox.list`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxListResponse {
    pub items: Vec<InboxListItem>,
    /// Whether the list was capped at `limit` (true = there may be more).
    pub capped: bool,
    /// Maximum items per response (matches the server-side cap).
    pub limit: u32,
}

// ── inbox.item.metadata (spec 041 US2/FR-010) ─────────────────────────────────

/// Per-file metadata entry for one file within an inbox item.
///
/// All header fields are nullable — not every file type carries all headers.
/// `frame_type_effective` reflects override-if-present-else-extracted.
/// `override_stale` is true when the file was changed (size/mtime) since the
/// override was recorded (R-4); the override is surfaced but flagged.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxFileMetadata {
    pub relative_file_path: String,
    /// Effective frame type (override ?? extracted from header).
    /// `None` when the file remains unclassified.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame_type_effective: Option<String>,
    /// Raw `IMAGETYP` header value (before normalization), if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_typ: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exposure_s: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binning_x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binning_y: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature_c: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_obs: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrume: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telescop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naxis1: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naxis2: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_count: Option<i32>,
    /// True when this file has been identified as a stacked calibration master.
    pub is_master: bool,
    /// True when the persisted override no longer matches the file's size/mtime (R-4).
    pub override_stale: bool,
    /// Path-load-bearing attributes the file is missing for its frame type's
    /// destination pattern (spec 041 US9/FR-032/FR-033). Empty when the file can
    /// resolve a destination. These are the pattern token names that fell back to
    /// a registry default (e.g. `["target", "date"]` for a light with no OBJECT /
    /// DATE-OBS). Supplying the value via reclassify clears the gate.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_path_attributes: Vec<String>,
}

/// Request for `inbox.item.metadata`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemMetadataRequest {
    pub inbox_item_id: String,
}

/// Response from `inbox.item.metadata`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxItemMetadataResponse {
    pub inbox_item_id: String,
    pub files: Vec<InboxFileMetadata>,
}

// ── inbox.stats (spec 041 US6/FR-021) ────────────────────────────────────────

/// Per-frame-type queue stats entry.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxStatsPerType {
    pub frame_type: String,
    /// Number of folder-grouped inbox items of this type.
    pub folder_count: u32,
    /// Number of master inbox items of this type.
    pub master_count: u32,
    /// Total image (file) count across all items of this type.
    pub image_count: u32,
}

/// Aggregate totals across all frame types.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxStatsTotals {
    pub folders: u32,
    pub masters: u32,
    pub images: u32,
}

/// Response from `inbox.stats`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxStatsResponse {
    pub per_type: Vec<InboxStatsPerType>,
    pub totals: InboxStatsTotals,
}

// ── inbox.plan (spec 041 US1/FR-003/FR-004) ───────────────────────────────────

/// One plan action entry in the in-context plan panel.
///
/// `action` is `"move"` | `"catalogue"` | `"archive"` | `"trash"`.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxPlanAction {
    /// 1-based ordinal within the plan.
    pub index: u32,
    /// `"move"` | `"catalogue"` | `"archive"` | `"trash"`
    pub action: String,
    pub from_path: String,
    pub to_path: String,
    /// Human-readable resolved destination preview
    /// (equals `from_path` for catalogue actions).
    pub destination_preview: String,
    /// True when this action requires explicit destructive confirmation before apply.
    pub requires_destructive_confirm: bool,
}

/// Response from `inbox.plan` — plan(s) linked to an inbox item (spec 041).
///
/// Read via `inbox_plan_links` so the inbox surface can show plan detail
/// without navigating to the Archive page (FR-004).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxPlanView {
    pub plan_id: String,
    pub state: String,
    /// True when the executor's CAS detected that one or more source files
    /// changed since the plan was created (FR-007 / T011).
    /// When `stale` is true the UI should disable Apply and prompt the user
    /// to re-classify and re-confirm.
    pub stale: bool,
    pub actions: Vec<InboxPlanAction>,
}

/// Per-plan result from `inbox.plan.apply_all` (spec 041, FR-003a).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxPlanApplyResult {
    pub inbox_item_id: String,
    pub plan_id: String,
    pub state: String,
    pub error: Option<String>,
}

/// Response from `inbox.plan.apply_all` (spec 041, FR-003a).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxApplyAllResponse {
    pub results: Vec<InboxPlanApplyResult>,
}

/// Response from `inbox.plan.cancel` (spec 041, FR-006).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxPlanCancelResponse {
    pub inbox_item_id: String,
    pub plan_id: String,
    pub state: String,
}

/// One open plan in the aggregate inbox plan surface (spec 041, US2).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxOpenPlan {
    pub inbox_item_id: String,
    /// Display label for the ingestion group (the item's relative path / folder name).
    pub item_name: String,
    pub plan_id: String,
    pub state: String,
    pub stale: bool,
    pub actions: Vec<InboxPlanAction>,
}

/// Response from `inbox.plan.list_open` — all open plans across roots (spec 041, US2).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxOpenPlansResponse {
    pub plans: Vec<InboxOpenPlan>,
    /// Sum of actions across all plans (for the surface header count).
    pub total_actions: u32,
}

// ── inbox.property_registry (spec 041 R-13 / FR-044) ─────────────────────────

/// Discriminant for the value kind of a property in the property registry.
///
/// Mirrors the `kind` column in the R-13 property table.  The UI uses this to
/// select the appropriate editor widget (number input, enum dropdown, etc.).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PropertyKind {
    /// Free-form text (e.g. camera name, filter label).
    String,
    /// IEEE-754 double (e.g. exposureS, raDeg).
    Number,
    /// Whole number (e.g. offset in ADU).
    Integer,
    /// Either a numeric or text representation (e.g. gain on some cameras).
    NumberOrString,
    /// One of a fixed set of string values (e.g. frameType).
    Enum,
    /// Calendar date (`YYYY-MM-DD`).
    Date,
    /// ISO-8601 date-time (e.g. obsTimeUtc, dateEnd).
    Datetime,
}

/// One entry in the property registry exposed by `inbox.property_registry`.
///
/// Describes a named inbox-file property that the field-agnostic reclassifier
/// (spec 041 R-13) can accept, validate, and persist as an index-side override.
/// The UI uses this registry to render a generic metadata editor without
/// hard-coding field names.
///
/// `sourceHeaders` — the FITS/XISF header keywords that feed this property
/// during extraction; empty for derived or resolve-only properties.
///
/// `overridable` — when `false` the property is informational or derived and
/// the reclassify endpoint will reject an explicit override for it.
///
/// `appliesTo` — frame types for which this property is meaningful; the UI
/// SHOULD hide non-applicable properties rather than blocking on them.
///
/// `validation` — optional human-readable constraint description shown in the
/// UI tooltip; not a machine-parseable expression (use for display only).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PropertyRegistryEntry {
    /// Registry key, camelCase (e.g. `"frameType"`, `"exposureS"`).
    pub key: String,
    /// Value kind discriminant used by the UI for widget selection.
    pub kind: PropertyKind,
    /// Physical unit label for display (e.g. `"s"`, `"deg"`, `"ADU"`).  `None`
    /// when the property is dimensionless or a free-form string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    /// FITS/XISF source header keyword(s), in priority order.  Empty for
    /// properties that are derived or resolved from external sources (e.g.
    /// `target`, `opticTrain`).
    pub source_headers: Vec<String>,
    /// Whether a user override is accepted by the reclassify use case.
    pub overridable: bool,
    /// Frame types for which this property is applicable.
    pub applies_to: Vec<String>,
    /// Human-readable validation constraint for display in the UI.  `None`
    /// means no documented constraint beyond the `kind` type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation: Option<String>,
}

/// Response from `inbox.property_registry` (spec 041 FR-044).
///
/// The full ordered list of known per-file properties, their value kinds, and
/// their editing semantics.  The UI renders this as a generic metadata editor
/// without requiring hard-coded field knowledge.
pub type InboxPropertyRegistryResponse = Vec<PropertyRegistryEntry>;

/// Request for `inbox.plan.apply_selected` (spec 041, US2).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxApplySelectedRequest {
    pub inbox_item_ids: Vec<String>,
}
