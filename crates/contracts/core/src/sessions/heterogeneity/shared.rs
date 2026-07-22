// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared bounded scalars, envelopes, pagination, authorization, and command contracts.

use std::fmt;
use std::ops::Deref;

use schemars::JsonSchema;
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use specta::Type;

pub const MAX_REQUEST_BYTES: u64 = 1_048_576;
pub const MAX_RESPONSE_BYTES: u64 = 4_194_304;
pub const MAX_CURSOR_BYTES: usize = 4_096;
pub const MAX_SAFE_TEXT_SCALARS: usize = 4_096;
pub const MAX_SAFE_TEXT_BYTES: usize = 16_384;
pub const MAX_PAGE_ITEMS: usize = 500;
const MAX_PAGE_ITEMS_U32: u32 = 500;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidationError {
    pub field: &'static str,
    pub reason_code: &'static str,
}

impl ValidationError {
    #[must_use]
    pub const fn new(field: &'static str, reason_code: &'static str) -> Self {
        Self { field, reason_code }
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.field, self.reason_code)
    }
}

impl std::error::Error for ValidationError {}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Type, JsonSchema)]
#[serde(transparent)]
#[specta(transparent)]
pub struct BoundedList<T, const MAX: usize>(Vec<T>);

impl<T, const MAX: usize> BoundedList<T, MAX> {
    /// # Errors
    ///
    /// Returns an error when `items` contains more than `MAX` entries.
    pub fn try_new(items: Vec<T>) -> Result<Self, ValidationError> {
        if items.len() > MAX {
            return Err(ValidationError::new("items", "list_too_long"));
        }
        Ok(Self(items))
    }

    #[must_use]
    pub fn as_slice(&self) -> &[T] {
        &self.0
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    #[must_use]
    pub fn into_inner(self) -> Vec<T> {
        self.0
    }
}

impl<T, const MAX: usize> Default for BoundedList<T, MAX> {
    fn default() -> Self {
        Self(Vec::new())
    }
}

impl<T, const MAX: usize> Deref for BoundedList<T, MAX> {
    type Target = [T];

    fn deref(&self) -> &Self::Target {
        self.as_slice()
    }
}

impl<T, const MAX: usize> IntoIterator for BoundedList<T, MAX> {
    type Item = T;
    type IntoIter = std::vec::IntoIter<T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<'a, T, const MAX: usize> IntoIterator for &'a BoundedList<T, MAX> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

impl<'a, T, const MAX: usize> IntoIterator for &'a mut BoundedList<T, MAX> {
    type Item = &'a mut T;
    type IntoIter = std::slice::IterMut<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter_mut()
    }
}

impl<'de, T, const MAX: usize> Deserialize<'de> for BoundedList<T, MAX>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let items = Vec::<T>::deserialize(deserializer)?;
        Self::try_new(items).map_err(D::Error::custom)
    }
}

macro_rules! validated_string {
    ($name:ident, $validator:ident) => {
        #[derive(
            Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Type, JsonSchema,
        )]
        #[serde(transparent)]
        #[specta(transparent)]
        pub struct $name(String);

        impl $name {
            /// # Errors
            ///
            /// Returns an error when the value violates this scalar's portable contract.
            pub fn try_new(value: impl Into<String>) -> Result<Self, ValidationError> {
                let value = value.into();
                $validator(&value)?;
                Ok(Self(value))
            }

            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }

            #[must_use]
            pub fn into_inner(self) -> String {
                self.0
            }
        }

        impl Deref for $name {
            type Target = str;

            fn deref(&self) -> &Self::Target {
                self.as_str()
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::try_new(value).map_err(D::Error::custom)
            }
        }
    };
}

fn validate_safe_text(value: &str) -> Result<(), ValidationError> {
    if value.len() > MAX_SAFE_TEXT_BYTES || value.chars().count() > MAX_SAFE_TEXT_SCALARS {
        return Err(ValidationError::new("text", "text_too_long"));
    }
    if value.chars().any(char::is_control) {
        return Err(ValidationError::new("text", "control_character"));
    }
    Ok(())
}

fn validate_non_blank_safe_text(value: &str) -> Result<(), ValidationError> {
    validate_safe_text(value)?;
    if value.trim().is_empty() {
        return Err(ValidationError::new("text", "blank"));
    }
    Ok(())
}

fn validate_canonical_id(value: &str) -> Result<(), ValidationError> {
    let parsed =
        uuid::Uuid::parse_str(value).map_err(|_| ValidationError::new("id", "uuid_invalid"))?;
    if value.len() != 36 || parsed.hyphenated().to_string() != value {
        return Err(ValidationError::new("id", "uuid_not_canonical"));
    }
    Ok(())
}

fn validate_digest(value: &str) -> Result<(), ValidationError> {
    let hex = value
        .strip_prefix("sha256:")
        .ok_or_else(|| ValidationError::new("digest", "digest_algorithm_invalid"))?;
    if hex.len() != 64
        || !hex.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ValidationError::new("digest", "digest_invalid"));
    }
    Ok(())
}

fn validate_cursor(value: &str) -> Result<(), ValidationError> {
    if value.is_empty() || value.len() > MAX_CURSOR_BYTES {
        return Err(ValidationError::new("cursor", "cursor_length_invalid"));
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<(), ValidationError> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .map_err(|_| ValidationError::new("timestamp", "timestamp_invalid"))?;
    Ok(())
}

fn validate_local_date(value: &str) -> Result<(), ValidationError> {
    let format = time::macros::format_description!("[year]-[month]-[day]");
    time::Date::parse(value, &format).map_err(|_| ValidationError::new("date", "date_invalid"))?;
    if value.len() != 10 {
        return Err(ValidationError::new("date", "date_not_canonical"));
    }
    Ok(())
}

fn validate_stable_identity(value: &str) -> Result<(), ValidationError> {
    if value.is_empty() || value.len() > 1_024 {
        return Err(ValidationError::new("stableIdentity", "length_invalid"));
    }
    Ok(())
}

fn validate_collision_key(value: &str) -> Result<(), ValidationError> {
    if value.is_empty() || value.len() > 4_096 {
        return Err(ValidationError::new("destinationCollisionKey", "length_invalid"));
    }
    Ok(())
}

fn validate_relative_path(value: &str) -> Result<(), ValidationError> {
    if value.is_empty() || value.len() > 4_096 || value.starts_with('/') || value.contains('\\') {
        return Err(ValidationError::new("relativePath", "path_invalid"));
    }
    let segments: Vec<&str> = value.split('/').collect();
    if !(1..=64).contains(&segments.len())
        || segments.iter().any(|segment| {
            segment.is_empty()
                || segment.len() > 255
                || *segment == "."
                || *segment == ".."
                || segment.contains('\0')
        })
    {
        return Err(ValidationError::new("relativePath", "path_segment_invalid"));
    }
    if value.len() >= 2 && value.as_bytes()[1] == b':' {
        return Err(ValidationError::new("relativePath", "path_drive_invalid"));
    }
    Ok(())
}

validated_string!(SafeText, validate_safe_text);
validated_string!(NonBlankSafeText, validate_non_blank_safe_text);
validated_string!(CanonicalId, validate_canonical_id);
validated_string!(Digest, validate_digest);
validated_string!(Cursor, validate_cursor);
validated_string!(Rfc3339Timestamp, validate_timestamp);
validated_string!(LocalDate, validate_local_date);
validated_string!(StableIdentity, validate_stable_identity);
validated_string!(DestinationCollisionKey, validate_collision_key);
validated_string!(CanonicalRelativePath, validate_relative_path);

#[derive(Clone, Copy, Debug, PartialEq, PartialOrd, Serialize, Type, JsonSchema)]
#[serde(transparent)]
#[specta(transparent)]
pub struct FiniteDecimal(f64);

impl FiniteDecimal {
    /// # Errors
    ///
    /// Returns an error when `value` is NaN or infinite.
    pub fn try_new(value: f64) -> Result<Self, ValidationError> {
        if !value.is_finite() {
            return Err(ValidationError::new("decimal", "decimal_not_finite"));
        }
        Ok(Self(value))
    }

    #[must_use]
    pub const fn get(self) -> f64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for FiniteDecimal {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::try_new(f64::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityRef {
    pub entity_type: SafeText,
    pub entity_id: CanonicalId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RevisionRef {
    pub entity_type: SafeText,
    pub entity_id: CanonicalId,
    pub revision_id: CanonicalId,
    pub revision_number: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractRange<T> {
    pub min: T,
    pub max: T,
    pub min_inclusive: bool,
    pub max_inclusive: bool,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SupportedFrameKind {
    Light,
    Dark,
    Bias,
    Flat,
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum MaterializationKind {
    InboxIngestion,
    MetadataReclassification,
}

fn default_page_limit() -> u32 {
    100
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<Cursor>,
    pub limit: u32,
}

impl Default for PageRequest {
    fn default() -> Self {
        Self { cursor: None, limit: default_page_limit() }
    }
}

impl PageRequest {
    /// # Errors
    ///
    /// Returns an error when `limit` is outside the inclusive range 1 through 500.
    pub fn try_new(cursor: Option<Cursor>, limit: u32) -> Result<Self, ValidationError> {
        if !(1..=MAX_PAGE_ITEMS_U32).contains(&limit) {
            return Err(ValidationError::new("page.limit", "page_limit_out_of_range"));
        }
        Ok(Self { cursor, limit })
    }
}

impl<'de> Deserialize<'de> for PageRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Wire {
            cursor: Option<Cursor>,
            #[serde(default = "default_page_limit")]
            limit: u32,
        }

        let wire = Wire::deserialize(deserializer)?;
        Self::try_new(wire.cursor, wire.limit).map_err(D::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum PageBasis {
    Snapshot { snapshot_id: CanonicalId },
    Watermark { watermark: SafeText },
}

#[derive(Clone, Debug, PartialEq, Serialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: BoundedList<T, MAX_PAGE_ITEMS>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watermark: Option<SafeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<Cursor>,
}

impl<'de, T> Deserialize<'de> for Page<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Wire<T> {
            items: BoundedList<T, MAX_PAGE_ITEMS>,
            snapshot_id: Option<CanonicalId>,
            watermark: Option<SafeText>,
            next_cursor: Option<Cursor>,
        }

        let wire = Wire::deserialize(deserializer)?;
        let page = Self {
            items: wire.items,
            snapshot_id: wire.snapshot_id,
            watermark: wire.watermark,
            next_cursor: wire.next_cursor,
        };
        page.validate().map_err(D::Error::custom)?;
        Ok(page)
    }
}

impl<T> Page<T> {
    /// # Errors
    ///
    /// Returns an error if the page does not have exactly one snapshot basis.
    pub fn try_new(
        items: BoundedList<T, MAX_PAGE_ITEMS>,
        basis: PageBasis,
        next_cursor: Option<Cursor>,
    ) -> Result<Self, ValidationError> {
        let (snapshot_id, watermark) = match basis {
            PageBasis::Snapshot { snapshot_id } => (Some(snapshot_id), None),
            PageBasis::Watermark { watermark } => (None, Some(watermark)),
        };
        let page = Self { items, snapshot_id, watermark, next_cursor };
        page.validate()?;
        Ok(page)
    }

    /// # Errors
    ///
    /// Returns an error unless exactly one of `snapshot_id` or `watermark` is present.
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.snapshot_id.is_some() == self.watermark.is_some() {
            return Err(ValidationError::new("page", "page_basis_invalid"));
        }
        Ok(())
    }
}

pub trait KeysetListOperation {
    fn query_name(&self) -> &'static str;
    fn unique_order(&self) -> &'static [&'static str];
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CursorBinding {
    pub principal_binding: Digest,
    pub query_name: SafeText,
    pub normalized_filters_digest: Digest,
    pub sort_order_digest: Digest,
    pub basis: PageBasis,
    pub authorization_projection: SafeText,
    pub last_unique_sort_key: BoundedList<SafeText, 100>,
}

impl CursorBinding {
    #[must_use]
    pub fn matches_context(&self, other: &Self) -> bool {
        self.principal_binding == other.principal_binding
            && self.query_name == other.query_name
            && self.normalized_filters_digest == other.normalized_filters_digest
            && self.sort_order_digest == other.sort_order_digest
            && self.basis == other.basis
            && self.authorization_projection == other.authorization_projection
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustedAuthorization {
    actor_id: CanonicalId,
    principal_binding: Digest,
    scope_binding: Digest,
}

impl TrustedAuthorization {
    #[must_use]
    pub const fn new(
        actor_id: CanonicalId,
        principal_binding: Digest,
        scope_binding: Digest,
    ) -> Self {
        Self { actor_id, principal_binding, scope_binding }
    }

    #[must_use]
    pub const fn actor_id(&self) -> &CanonicalId {
        &self.actor_id
    }

    #[must_use]
    pub const fn principal_binding(&self) -> &Digest {
        &self.principal_binding
    }

    #[must_use]
    pub const fn scope_binding(&self) -> &Digest {
        &self.scope_binding
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtectedResourceState {
    Authorized,
    Unauthorized,
    Missing,
}

impl ProtectedResourceState {
    #[must_use]
    pub fn projected_error(self) -> Option<PortableContractError> {
        match self {
            Self::Authorized => None,
            Self::Unauthorized | Self::Missing => {
                Some(PortableContractError::resource_unavailable())
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MutationContext {
    pub command_id: CanonicalId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<SafeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_digest: Option<Digest>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommandFence {
    pub command_id: CanonicalId,
    pub lease_generation: u64,
}

impl CommandFence {
    #[must_use]
    pub fn is_current(&self, current: &Self) -> bool {
        self == current
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CommandExecutionState {
    Received,
    Executing,
    Applied,
    Refused,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(
    tag = "state",
    content = "result",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum IdempotencyOutcome<T> {
    Recorded(T),
    InProgress { operation_id: CanonicalId },
    PayloadMismatch,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub field: SafeText,
    pub reason_code: SafeText,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Violation {
    pub code: SafeText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<SafeText>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_ref: Option<EntityRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_ref: Option<SafeText>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum SafeScalar {
    Text(SafeText),
    Unsigned(u64),
    Boolean(bool),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NamedSafeValue {
    pub name: SafeText,
    pub value: SafeScalar,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SafeErrorDetails {
    FieldErrors {
        fields: BoundedList<FieldError, 100>,
    },
    PayloadLimit {
        field: SafeText,
        limit_name: SafeText,
        limit: u64,
    },
    Entity {
        entity_type: SafeText,
        entity_id: CanonicalId,
    },
    StaleEntity {
        entity_type: SafeText,
        entity_id: CanonicalId,
        expected_revision: u64,
        actual_revision: u64,
    },
    StaleRevisions {
        revisions: BoundedList<RevisionRef, 500>,
        total_count: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        decision_snapshot_id: Option<CanonicalId>,
    },
    Violations {
        violations: BoundedList<Violation, 100>,
        total_count: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        decision_snapshot_id: Option<CanonicalId>,
    },
    Idempotency {
        command_id: CanonicalId,
    },
    Operation {
        command_id: CanonicalId,
        operation_id: CanonicalId,
    },
    AuthorizedPath {
        item_id: CanonicalId,
        #[serde(skip_serializing_if = "Option::is_none")]
        relative_path: Option<CanonicalRelativePath>,
    },
    Domain {
        code: SafeText,
        values: BoundedList<NamedSafeValue, 100>,
        #[serde(skip_serializing_if = "Option::is_none")]
        decision_snapshot_id: Option<CanonicalId>,
    },
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub enum ErrorCode {
    #[serde(rename = "validation.request_invalid")]
    ValidationRequestInvalid,
    #[serde(rename = "validation.payload_too_large")]
    ValidationPayloadTooLarge,
    #[serde(rename = "pagination.cursor_invalid")]
    PaginationCursorInvalid,
    #[serde(rename = "pagination.snapshot_unavailable")]
    PaginationSnapshotUnavailable,
    #[serde(rename = "entity.not_found")]
    EntityNotFound,
    #[serde(rename = "resource.unavailable")]
    ResourceUnavailable,
    #[serde(rename = "concurrency.stale_revision")]
    ConcurrencyStaleRevision,
    #[serde(rename = "idempotency.payload_mismatch")]
    IdempotencyPayloadMismatch,
    #[serde(rename = "operation.in_progress")]
    OperationInProgress,
    #[serde(rename = "session.not_found")]
    SessionNotFound,
    #[serde(rename = "panel_group.not_found")]
    PanelGroupNotFound,
    #[serde(rename = "panel_group.revision_not_found")]
    PanelGroupRevisionNotFound,
    #[serde(rename = "mosaic.not_found")]
    MosaicNotFound,
    #[serde(rename = "mosaic.revision_not_found")]
    MosaicRevisionNotFound,
    #[serde(rename = "relation_proposal.not_found")]
    RelationProposalNotFound,
    #[serde(rename = "relation_proposal.not_pending")]
    RelationProposalNotPending,
    #[serde(rename = "relation_proposal.stale")]
    RelationProposalStale,
    #[serde(rename = "relation_proposal.invalid_membership")]
    RelationProposalInvalidMembership,
    #[serde(rename = "relation_proposal.lineage_cycle")]
    RelationProposalLineageCycle,
    #[serde(rename = "relation_proposal.merge_required")]
    RelationProposalMergeRequired,
    #[serde(rename = "relation_proposal.cross_target_review_required")]
    RelationProposalCrossTargetReviewRequired,
    #[serde(rename = "relation_proposal.evidence_missing")]
    RelationProposalEvidenceMissing,
    #[serde(rename = "relation_proposal.manual_evidence_disclosure_incomplete")]
    RelationProposalManualEvidenceDisclosureIncomplete,
    #[serde(rename = "traversal.operation_not_found")]
    TraversalOperationNotFound,
    #[serde(rename = "traversal.result_not_ready")]
    TraversalResultNotReady,
    #[serde(rename = "traversal.node_ceiling_exceeded")]
    TraversalNodeCeilingExceeded,
    #[serde(rename = "traversal.edge_ceiling_exceeded")]
    TraversalEdgeCeilingExceeded,
    #[serde(rename = "traversal.depth_ceiling_exceeded")]
    TraversalDepthCeilingExceeded,
    #[serde(rename = "traversal.cancellation_deadline_exceeded")]
    TraversalCancellationDeadlineExceeded,
    #[serde(rename = "inbox.plan_not_found")]
    InboxPlanNotFound,
    #[serde(rename = "inbox.plan_not_open")]
    InboxPlanNotOpen,
    #[serde(rename = "inbox.plan_not_approved")]
    InboxPlanNotApproved,
    #[serde(rename = "inbox.plan_digest_mismatch")]
    InboxPlanDigestMismatch,
    #[serde(rename = "inbox.plan_stale")]
    InboxPlanStale,
    #[serde(rename = "inbox.site_resolution_not_found")]
    InboxSiteResolutionNotFound,
    #[serde(rename = "inbox.plan_result_snapshot_not_found")]
    InboxPlanResultSnapshotNotFound,
    #[serde(rename = "inbox.proposed_session_not_found")]
    InboxProposedSessionNotFound,
    #[serde(rename = "inbox.site_selection_required")]
    InboxSiteSelectionRequired,
    #[serde(rename = "inbox.site_timezone_invalid")]
    InboxSiteTimezoneInvalid,
    #[serde(rename = "inbox.timestamp_conflict")]
    InboxTimestampConflict,
    #[serde(rename = "materialization.operation_not_found")]
    MaterializationOperationNotFound,
    #[serde(rename = "materialization.result_snapshot_not_found")]
    MaterializationResultSnapshotNotFound,
    #[serde(rename = "metadata.evidence_not_found")]
    MetadataEvidenceNotFound,
    #[serde(rename = "metadata.identity_blocked")]
    MetadataIdentityBlocked,
    #[serde(rename = "metadata.observing_night_conflict")]
    MetadataObservingNightConflict,
    #[serde(rename = "equipment.resolution_not_found")]
    EquipmentResolutionNotFound,
    #[serde(rename = "equipment.not_registered")]
    EquipmentNotRegistered,
    #[serde(rename = "equipment.optical_profile_review_required")]
    EquipmentOpticalProfileReviewRequired,
    #[serde(rename = "calibration.cooling_set_point_required")]
    CalibrationCoolingSetPointRequired,
    #[serde(rename = "calibration.flat_gain_required")]
    CalibrationFlatGainRequired,
    #[serde(rename = "calibration.dark_flat_unsupported")]
    CalibrationDarkFlatUnsupported,
    #[serde(rename = "reclassification.plan_not_found")]
    ReclassificationPlanNotFound,
    #[serde(rename = "reclassification.plan_not_open")]
    ReclassificationPlanNotOpen,
    #[serde(rename = "reclassification.plan_stale")]
    ReclassificationPlanStale,
    #[serde(rename = "reclassification.invalid_partition")]
    ReclassificationInvalidPartition,
    #[serde(rename = "reclassification.replacement_not_found")]
    ReclassificationReplacementNotFound,
    #[serde(rename = "reclassification.panel_consequence_not_found")]
    ReclassificationPanelConsequenceNotFound,
    #[serde(rename = "reclassification.result_snapshot_not_found")]
    ReclassificationResultSnapshotNotFound,
    #[serde(rename = "reclassification.apply_result_snapshot_not_found")]
    ReclassificationApplyResultSnapshotNotFound,
    #[serde(rename = "matching_settings.revision_not_found")]
    MatchingSettingsRevisionNotFound,
    #[serde(rename = "matching_settings.out_of_bounds")]
    MatchingSettingsOutOfBounds,
    #[serde(rename = "matching_settings.cross_constraint")]
    MatchingSettingsCrossConstraint,
    #[serde(rename = "matching_settings.warning_unacknowledged")]
    MatchingSettingsWarningUnacknowledged,
    #[serde(rename = "calibration.requirement_invalid")]
    CalibrationRequirementInvalid,
    #[serde(rename = "calibration.candidate_not_found")]
    CalibrationCandidateNotFound,
    #[serde(rename = "calibration.candidate_blocked")]
    CalibrationCandidateBlocked,
    #[serde(rename = "calibration.handoff_too_large")]
    CalibrationHandoffTooLarge,
    #[serde(rename = "calibration.handoff_operation_not_cancellable")]
    CalibrationHandoffOperationNotCancellable,
    #[serde(rename = "calibration.candidate_incompatible")]
    CalibrationCandidateIncompatible,
    #[serde(rename = "calibration.warning_unacknowledged")]
    CalibrationWarningUnacknowledged,
    #[serde(rename = "calibration.selection_duplicate")]
    CalibrationSelectionDuplicate,
    #[serde(rename = "calibration.handoff_not_found")]
    CalibrationHandoffNotFound,
    #[serde(rename = "calibration.handoff_stale_basis")]
    CalibrationHandoffStaleBasis,
    #[serde(rename = "calibration.source_unavailable")]
    CalibrationSourceUnavailable,
    #[serde(rename = "calibration.source_identity_changed")]
    CalibrationSourceIdentityChanged,
    #[serde(rename = "calibration.page_invalid")]
    CalibrationPageInvalid,
    #[serde(rename = "calibration.page_stale")]
    CalibrationPageStale,
    #[serde(rename = "project.not_found")]
    ProjectNotFound,
    #[serde(rename = "project.session_not_found")]
    ProjectSessionNotFound,
    #[serde(rename = "project.session_already_pinned")]
    ProjectSessionAlreadyPinned,
    #[serde(rename = "project.session_not_pinned")]
    ProjectSessionNotPinned,
    #[serde(rename = "project.lifecycle_disallows_session_add")]
    ProjectLifecycleDisallowsSessionAdd,
    #[serde(rename = "project.reclassification_revision_invalid")]
    ProjectReclassificationRevisionInvalid,
    #[serde(rename = "project.update_view_no_additions")]
    ProjectUpdateViewNoAdditions,
    #[serde(rename = "project.update_view_plan_not_found")]
    ProjectUpdateViewPlanNotFound,
    #[serde(rename = "project.update_view_plan_not_open")]
    ProjectUpdateViewPlanNotOpen,
    #[serde(rename = "project.update_view_plan_not_approved")]
    ProjectUpdateViewPlanNotApproved,
    #[serde(rename = "project.update_view_plan_stale")]
    ProjectUpdateViewPlanStale,
    #[serde(rename = "project.update_view_path_conflict")]
    ProjectUpdateViewPathConflict,
    #[serde(rename = "project.update_view_source_unavailable")]
    ProjectUpdateViewSourceUnavailable,
    #[serde(rename = "project.update_view_root_changed")]
    ProjectUpdateViewRootChanged,
    #[serde(rename = "project.update_view_plan_digest_mismatch")]
    ProjectUpdateViewPlanDigestMismatch,
    #[serde(rename = "project.update_view_session_too_large")]
    ProjectUpdateViewSessionTooLarge,
    #[serde(rename = "project.update_view_operation_not_cancellable")]
    ProjectUpdateViewOperationNotCancellable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PortableContractError {
    pub code: ErrorCode,
    pub message: SafeText,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<SafeErrorDetails>,
}

impl<'de> Deserialize<'de> for PortableContractError {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Wire {
            code: ErrorCode,
            message: SafeText,
            details: Option<SafeErrorDetails>,
        }

        let wire = Wire::deserialize(deserializer)?;
        Self::try_new(wire.code, wire.message, wire.details).map_err(D::Error::custom)
    }
}

impl PortableContractError {
    /// # Errors
    ///
    /// Returns an error when `details` is not allowlisted for `code`.
    pub fn try_new(
        code: ErrorCode,
        message: SafeText,
        details: Option<SafeErrorDetails>,
    ) -> Result<Self, ValidationError> {
        let valid = match code {
            ErrorCode::ResourceUnavailable
            | ErrorCode::PaginationCursorInvalid
            | ErrorCode::PaginationSnapshotUnavailable => details.is_none(),
            ErrorCode::ValidationRequestInvalid => {
                matches!(details, Some(SafeErrorDetails::FieldErrors { .. }))
            }
            ErrorCode::ValidationPayloadTooLarge => {
                matches!(details, Some(SafeErrorDetails::PayloadLimit { .. }))
            }
            ErrorCode::ConcurrencyStaleRevision => {
                matches!(details, Some(SafeErrorDetails::StaleEntity { .. }))
            }
            ErrorCode::IdempotencyPayloadMismatch => {
                matches!(details, Some(SafeErrorDetails::Idempotency { .. }))
            }
            ErrorCode::OperationInProgress => {
                matches!(details, Some(SafeErrorDetails::Operation { .. }))
            }
            ErrorCode::ProjectUpdateViewPathConflict => {
                matches!(details, Some(SafeErrorDetails::AuthorizedPath { .. }))
            }
            _ => matches!(details, Some(SafeErrorDetails::Domain { .. })),
        };
        if !valid {
            return Err(ValidationError::new("details", "error_details_not_allowlisted"));
        }
        Ok(Self { code, message, details })
    }

    #[must_use]
    pub fn resource_unavailable() -> Self {
        Self {
            code: ErrorCode::ResourceUnavailable,
            message: SafeText("Resource unavailable.".to_owned()),
            details: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuditOutcome {
    Applied,
    Rejected,
    Refused,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditRecord {
    pub audit_id: CanonicalId,
    pub occurred_at: Rfc3339Timestamp,
    pub actor_id: CanonicalId,
    pub command_id: CanonicalId,
    pub operation: SafeText,
    pub outcome: AuditOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<SafeText>,
    pub entity_refs: BoundedList<EntityRef, 500>,
    pub before_revision_count: u64,
    pub after_revision_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision_snapshot_id: Option<CanonicalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<ErrorCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_ref: Option<SafeText>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContractEvent<T> {
    pub event_id: CanonicalId,
    pub occurred_at: Rfc3339Timestamp,
    pub actor_id: CanonicalId,
    pub command_id: CanonicalId,
    pub entity_refs: BoundedList<EntityRef, 500>,
    pub payload: T,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn id(value: &str) -> CanonicalId {
        CanonicalId::try_new(value).expect("fixture id")
    }

    fn digest(byte: char) -> Digest {
        Digest::try_new(format!("sha256:{}", byte.to_string().repeat(64))).expect("fixture digest")
    }

    #[test]
    fn bounded_list_rejects_max_plus_one_during_deserialization() {
        let value = serde_json::to_value(vec![0_u8; 101]).expect("fixture");
        assert!(serde_json::from_value::<BoundedList<u8, 100>>(value).is_err());
    }

    #[test]
    fn page_request_enforces_limit_and_cursor_bounds() {
        assert!(serde_json::from_value::<PageRequest>(json!({ "limit": 0 })).is_err());
        assert!(serde_json::from_value::<PageRequest>(json!({ "limit": 501 })).is_err());
        assert_eq!(
            serde_json::from_value::<PageRequest>(json!({})).expect("default page").limit,
            100
        );
        assert!(Cursor::try_new("x".repeat(MAX_CURSOR_BYTES + 1)).is_err());
    }

    #[test]
    fn page_requires_exactly_one_snapshot_basis() {
        let page = Page::<u8> {
            items: BoundedList::default(),
            snapshot_id: None,
            watermark: None,
            next_cursor: None,
        };
        assert!(page.validate().is_err());
    }

    #[test]
    fn protected_missing_and_unauthorized_resources_have_identical_errors() {
        let missing = ProtectedResourceState::Missing.projected_error().expect("missing error");
        let unauthorized =
            ProtectedResourceState::Unauthorized.projected_error().expect("unauthorized error");
        assert_eq!(
            serde_json::to_value(missing).unwrap(),
            serde_json::to_value(unauthorized).unwrap()
        );
    }

    #[test]
    fn mutation_context_cannot_assert_actor_or_scope() {
        let context = MutationContext {
            command_id: id("018f22b2-7f7f-7f7f-8f7f-7f7f7f7f7f7f"),
            reason: None,
            approval_digest: Some(digest('a')),
        };
        let value = serde_json::to_value(context).expect("serialize context");
        assert!(value.get("actorId").is_none());
        assert!(value.get("authorizationScope").is_none());
    }

    #[test]
    fn stale_fence_never_matches_current_generation() {
        let command_id = id("018f22b2-7f7f-7f7f-8f7f-7f7f7f7f7f7f");
        let stale = CommandFence { command_id: command_id.clone(), lease_generation: 3 };
        let current = CommandFence { command_id, lease_generation: 4 };
        assert!(!stale.is_current(&current));
    }
}
