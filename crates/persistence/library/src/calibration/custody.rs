// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Custody facts (the STO seam) and Retire location references (R19).
//!
//! Both are catalog reads from one reader snapshot; they hash and open no file.
//! Every fact carries the no-follow fingerprint the catalog recorded.

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap};

use platevault_model::{
    Asset, AssetReference, Availability, CalibrationRules, CandidateRef, CustodyFact, CustodyKind,
    InputKind, LocationLifecycle, MasterKeptCopy, ReferenceKind, Revision,
};
use sqlx::sqlite::{SqliteConnection, SqliteRow};
use sqlx::{Connection, Row};
use uuid::Uuid;

use super::{inventory, load_masters};
use crate::{
    from_text, json_ids, load_assets, load_location, parse_uuid, revision, Catalog, Result,
};

/// The pinned kinds whose raw-set pin binds an asked frame, by the frame ids
/// the pin recorded, and those pinning an adopted master whose file at the
/// master's location and path is asked. Suggestions and No hold nothing.
const PINNED_FILES: &str = "\
    SELECT k.session_id, k.kind, c.generation, json_extract(f.value, '$.assetId') AS asset_id \
    FROM session_calibration_kinds k \
    JOIN session_calibration c ON c.session_id = k.session_id \
    JOIN json_each(k.pin, '$.target.files') f \
    WHERE k.state = 'pinned' AND k.input_session_id IS NOT NULL \
    AND json_extract(f.value, '$.assetId') IN (SELECT value FROM json_each(?1)) \
    UNION ALL \
    SELECT k.session_id, k.kind, c.generation, a.id AS asset_id \
    FROM assets a \
    JOIN adopted_masters m ON m.location_id = a.location_id AND m.path_key = a.path_key \
    JOIN session_calibration_kinds k ON k.input_master_id = m.id \
    JOIN session_calibration c ON c.session_id = k.session_id \
    WHERE k.state = 'pinned' AND a.id IN (SELECT value FROM json_each(?1))";

impl Catalog {
    /// The calibration files STO keeps in protected Keep: candidate masters,
    /// adopted masters and adoption sources retained after adoption, each
    /// with its recorded no-follow fingerprint; a retained source names its
    /// kept copy, the adopted master.
    ///
    /// The facts are library-wide: every listed candidate master, every
    /// adopted master in an Active location and every adopted master's source
    /// still recorded outside a Retired location and outside the Trash. A
    /// source whose adoption failed stays a candidate master. Hashes and opens
    /// nothing.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn calibration_custody_facts<R: CalibrationRules + ?Sized>(
        &self,
        rules: &R,
    ) -> Result<Vec<CustodyFact>> {
        let mut conn = self.reader().await?;
        let mut snapshot = conn.begin().await?;
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
                    location_id: master.location_id,
                    relative_path: master.relative_path.clone(),
                    fingerprint: master.fingerprint.clone(),
                    kept_copy: None,
                });
            }
            let source = master.provenance.source.asset_id.and_then(|id| sources.get(&id));
            let retained = |source: &&Asset| {
                !matches!(source.availability, Availability::Retired | Availability::Trashed)
            };
            let Some(source) = source.filter(retained) else {
                continue;
            };
            facts.push(CustodyFact {
                kind: CustodyKind::GeneratedSource,
                asset_id: Some(source.id),
                master_id: None,
                location_id: source.location_id,
                relative_path: source.relative_path.clone(),
                fingerprint: source.fingerprint.clone(),
                kept_copy: Some(MasterKeptCopy {
                    master_id: master.id,
                    location_id: master.location_id,
                    relative_path: master.relative_path.clone(),
                    fingerprint: master.fingerprint.clone(),
                }),
            });
        }
        Ok(facts)
    }

    /// The calibration records holding any of `assets`, kind Calibration:
    /// each adopted master whose source or indexed destination is asked, at
    /// the master revision, then each session whose calibration pins an
    /// asked file, at its calibration generation. A pin is the session's use
    /// of the file (record §6: Hide and Move to Trash of a master list the
    /// sessions that use it), so a review names it and goes stale when the
    /// session's pins change.
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
        let masters = load_masters(&mut snapshot).await?;
        let pins = pin_references(&mut snapshot, assets).await?;
        snapshot.rollback().await?;

        let mut references = Vec::new();
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
        references.extend(pins);
        Ok(references)
    }
}

/// What one session's pins hold of the asked files.
struct SessionPins {
    generation: Revision,
    kinds: BTreeSet<InputKind>,
    assets: BTreeSet<Uuid>,
}

/// One reference per session whose pinned kinds bind an asked file, in
/// session id order: named by its pinned kinds, at its calibration
/// generation, holding the asked files its pins bind.
async fn pin_references(
    conn: &mut SqliteConnection,
    assets: &BTreeSet<Uuid>,
) -> Result<Vec<AssetReference>> {
    let rows: Vec<SqliteRow> =
        sqlx::query(PINNED_FILES).bind(json_ids(assets)?).fetch_all(&mut *conn).await?;
    let mut sessions: BTreeMap<Uuid, SessionPins> = BTreeMap::new();
    for row in &rows {
        let session_id = parse_uuid(&row.try_get::<String, _>("session_id")?)?;
        let kind: InputKind = from_text(&row.try_get::<String, _>("kind")?)?;
        let asset = parse_uuid(&row.try_get::<String, _>("asset_id")?)?;
        let generation = revision(row.try_get("generation")?)?;
        let pins = sessions.entry(session_id).or_insert_with(|| SessionPins {
            generation,
            kinds: BTreeSet::new(),
            assets: BTreeSet::new(),
        });
        pins.kinds.insert(kind);
        pins.assets.insert(asset);
    }
    Ok(sessions
        .into_iter()
        .map(|(session_id, pins)| {
            let kinds: Vec<&str> = pins.kinds.iter().map(|kind| kind.as_str()).collect();
            AssetReference {
                kind: ReferenceKind::Calibration,
                id: session_id,
                name: format!("{} pinned on session {session_id}", kinds.join(", ")),
                revision: pins.generation,
                asset_ids: pins.assets.into_iter().collect(),
            }
        })
        .collect())
}
