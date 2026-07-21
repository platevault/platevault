// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Repository methods for Inbox items, classifications, evidence, and plan links
//! (spec 005, migration 0020).
//!
//! All state-machine enforcement lives in `crates/app/core/src/inbox/`.
//!
//! Split by owning table (#968): [`items`] is `inbox_items`; [`source_groups`]
//! is `inbox_source_groups`; [`classification`] is `inbox_classifications`,
//! `inbox_classification_evidence`, and `inbox_file_overrides`; [`metadata`] is
//! `inbox_file_metadata` and `inbox_classification_breakdown`; [`plan_links`]
//! is `inbox_plan_links`; [`projections`] is the read-only cross-table list,
//! stats, and grouping-key queries.

pub mod classification;
pub mod items;
pub mod metadata;
pub mod plan_links;
pub mod projections;
pub mod source_groups;

#[cfg(test)]
mod tests;

pub use classification::{
    delete_evidence_for_item, get_classification, insert_evidence, list_evidence,
    list_file_overrides_for_group, mark_file_override_stale, mark_override_stale,
    set_file_override, set_manual_override, set_overrides, upsert_classification, FileOverrideRow,
    InboxClassificationRow, InboxEvidenceRow, InsertEvidence, UpsertClassification,
};
pub use items::{
    delete_sub_item_if_unlinked, get_inbox_item, get_source_group_id_for_item, insert_inbox_item,
    link_placeholder_to_source_group, list_inbox_sub_items, list_item_ids_for_source_group,
    reset_inbox_item_to_unconfirmed, update_inbox_item_scan, update_inbox_item_state,
    upsert_inbox_sub_item, InboxItemRow, InsertInboxItem, UpsertInboxSubItem,
};
pub use metadata::{
    delete_breakdown_for_item, delete_file_metadata_for_item, get_file_metadata, list_breakdown,
    list_inbox_attribution_geometry, list_inbox_file_metadata, list_inbox_pointing,
    upsert_breakdown_row, upsert_inbox_file_metadata, InboxAttributionGeometryRow,
    InboxBreakdownRow, InboxFileMetadataRow, InboxPointingRow, UpsertFileMetadata,
};
pub use plan_links::{
    delete_plan_link, find_orphaned_plan_links, get_plan_link, get_plan_link_by_plan_id,
    insert_plan_link, InboxPlanLinkRow,
};
pub use projections::{
    count_distinct_inbox_folders, format_exposure_label, grouping_keys_for_items, inbox_stats,
    list_unacknowledged_across_roots, InboxItemGroupingKeys, InboxListRow, InboxStatsRow,
};
pub use source_groups::{
    get_inbox_source_group_by_path, last_scanned_by_root, list_unclassified_source_groups,
    update_source_group_child_count, upsert_inbox_source_group, InboxSourceGroupListRow,
    InboxSourceGroupRow, UpsertSourceGroup,
};
