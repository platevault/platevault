// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Custody facts (the STO seam) and Retire location references (R19).
//!
//! Both are catalog reads from one reader snapshot; they hash and open no file.
//! Every fact carries the no-follow fingerprint the catalog recorded.

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    AssetReference, Availability, CalibrationRules, CandidateRef, CustodyFact, CustodyKind,
    KeptCopy, LocationLifecycle, ReferenceKind,
};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{inventory, load_masters};
use crate::views::load_view;
use crate::{json_ids, load_assets, load_location, parse_uuid, revision, Catalog, Result};

/// Views whose effective (latest, not withdrawn) decision per light Session and
/// kind holds an asked asset as a light member or a hashed input, with the
/// View's latest committed name and its plan revision.
const DECISION_REFERENCES: &str = "\
    WITH asked(id) AS (SELECT value FROM json_each(?1)), \
    effective AS (SELECT d.view_id, d.light_asset_ids, d.inputs FROM calibration_decisions d \
        WHERE d.resolution != 'withdrawn' AND d.rowid = (SELECT MAX(e.rowid) \
        FROM calibration_decisions e WHERE e.view_id = d.view_id \
        AND e.light_session_id = d.light_session_id AND e.kind = d.kind)), \
    held(view_id, asset_id) AS ( \
        SELECT f.view_id, l.value FROM effective f, json_each(f.light_asset_ids) l \
        WHERE l.value IN (SELECT id FROM asked) \
        UNION SELECT f.view_id, json_extract(i.value, '$.assetId') \
        FROM effective f, json_each(f.inputs) i \
        WHERE json_extract(i.value, '$.assetId') IN (SELECT id FROM asked)) \
    SELECT h.view_id, h.asset_id, coalesce(p.revision, 0) AS revision, \
    coalesce(c.name, d.name) AS name FROM held h JOIN views v ON v.id = h.view_id \
    LEFT JOIN calibration_plans p ON p.view_id = h.view_id \
    LEFT JOIN view_revisions c ON c.view_id = v.id AND c.revision = v.revision \
    LEFT JOIN view_revisions d ON d.view_id = v.id AND d.state = 'draft' \
    ORDER BY h.view_id, h.asset_id";

impl Catalog {
    /// The calibration files STO keeps in protected Keep: candidate masters,
    /// adopted masters and adoption sources retained after adoption, each
    /// with its recorded no-follow fingerprint; a retained source names its
    /// kept copy, the adopted master.
    ///
    /// Until results discovery (070) identifies a View's outputs, the facts
    /// are library-wide: every listed candidate master, every adopted master in
    /// an Active location and every adopted master's source still recorded
    /// outside a Retired location. A source whose adoption failed stays a
    /// candidate master. Hashes and opens nothing.
    ///
    /// # Errors
    /// `NotFound` for an unknown View; `PersistenceFailure` when the catalog
    /// cannot be read.
    pub async fn calibration_custody_facts<R: CalibrationRules + ?Sized>(
        &self,
        view: Uuid,
        rules: &R,
    ) -> Result<Vec<CustodyFact>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        load_view(&mut snapshot, view).await?;
        let listed = inventory::list_inputs(&mut snapshot, rules).await?;
        let masters = load_masters(&mut snapshot).await?;
        let sources: BTreeSet<Uuid> =
            masters.iter().filter_map(|master| master.provenance.source.asset_id).collect();
        let sources: HashMap<Uuid, _> = load_assets(&mut snapshot, &sources)
            .await?
            .into_iter()
            .map(|asset| (asset.id, asset))
            .collect();
        let mut lifecycles = HashMap::new();
        for master in &masters {
            if let Entry::Vacant(entry) = lifecycles.entry(master.location_id) {
                entry.insert(load_location(&mut snapshot, master.location_id).await?.lifecycle);
            }
        }
        snapshot.rollback().await?;

        let mut facts = Vec::new();
        for input in &listed {
            let CandidateRef::Candidate { asset_id } = input.summary.input else {
                continue;
            };
            for copy in input.members.iter().flat_map(|member| &member.copies) {
                facts.push(CustodyFact {
                    kind: CustodyKind::CandidateMaster,
                    asset_id: Some(asset_id),
                    master_id: None,
                    result_id: None,
                    location_id: copy.location_id,
                    relative_path: copy.relative_path.clone(),
                    fingerprint: copy.fingerprint.clone(),
                    kept_copy: None,
                });
            }
        }
        for master in &masters {
            if lifecycles[&master.location_id] == LocationLifecycle::Active {
                facts.push(CustodyFact {
                    kind: CustodyKind::AdoptedMaster,
                    asset_id: master.asset_id,
                    master_id: Some(master.id),
                    result_id: None,
                    location_id: master.location_id,
                    relative_path: master.relative_path.clone(),
                    fingerprint: master.fingerprint.clone(),
                    kept_copy: None,
                });
            }
            let source = master.provenance.source.asset_id.and_then(|id| sources.get(&id));
            let Some(source) = source.filter(|source| source.availability != Availability::Retired)
            else {
                continue;
            };
            facts.push(CustodyFact {
                kind: CustodyKind::GeneratedSource,
                asset_id: Some(source.id),
                master_id: None,
                result_id: master.provenance.source.result_id,
                location_id: source.location_id,
                relative_path: source.relative_path.clone(),
                fingerprint: source.fingerprint.clone(),
                kept_copy: Some(KeptCopy {
                    master_id: master.id,
                    location_id: master.location_id,
                    relative_path: master.relative_path.clone(),
                    fingerprint: master.fingerprint.clone(),
                }),
            });
        }
        Ok(facts)
    }

    /// The calibration records holding any of `assets`, kind Calibration: each
    /// View whose effective decisions hold them as light members or hashed
    /// inputs, at its plan revision, and each adopted master whose source or
    /// indexed destination is asked, at the master revision. A withdrawn
    /// decision names nothing.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn calibration_references(
        &self,
        assets: &BTreeSet<Uuid>,
    ) -> Result<Vec<AssetReference>> {
        if assets.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
        let rows = sqlx::query(DECISION_REFERENCES)
            .bind(json_ids(assets)?)
            .fetch_all(&mut *snapshot)
            .await?;
        let masters = load_masters(&mut snapshot).await?;
        snapshot.rollback().await?;

        let mut views: BTreeMap<Uuid, AssetReference> = BTreeMap::new();
        for row in &rows {
            let id = parse_uuid(&row.try_get::<String, _>("view_id")?)?;
            let asset = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
            if let Some(reference) = views.get_mut(&id) {
                reference.asset_ids.push(asset);
                continue;
            }
            views.insert(
                id,
                AssetReference {
                    kind: ReferenceKind::Calibration,
                    id,
                    name: row.try_get("name")?,
                    revision: revision(row.try_get("revision")?)?,
                    asset_ids: vec![asset],
                },
            );
        }
        let mut references: Vec<AssetReference> = views.into_values().collect();
        for master in masters {
            let held: BTreeSet<Uuid> = [master.provenance.source.asset_id, master.asset_id]
                .into_iter()
                .flatten()
                .filter(|id| assets.contains(id))
                .collect();
            if held.is_empty() {
                continue;
            }
            references.push(AssetReference {
                kind: ReferenceKind::Calibration,
                id: master.id,
                name: format!("{} master {}", master.kind.as_str(), master.relative_path.display()),
                revision: master.revision,
                asset_ids: held.into_iter().collect(),
            });
        }
        Ok(references)
    }
}
