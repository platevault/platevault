// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Done / Archive sheet of a Done Project (spec 065 PRJ-FR-14/15, root
//! FR-021; D-W43, D-W70, D-W72, D-W74) on the composed library: what each
//! offer covers, keeps and refuses, from one catalog snapshot.
//!
//! - Rejected frames: the Project's candidate frames whose applicable library
//!   quality is Unusable, with every live copy. A frame rejected for this
//!   Project only, a frame whose content changed and a Trashed frame are never
//!   included. A frame used in a prepared revision of a run that is not
//!   Complete, in any Project, or held by a prepared revision a Result
//!   records, is refused with that reason. A Complete run's prepared frame is
//!   included.
//! - Intermediates: the recognized intermediates in the Results folders of
//!   the Project's runs, and each adopted master's generated source as a
//!   verified duplicate naming its kept library copy. Accepted Results, the
//!   adopted library master, candidate masters, unknown files and unaccepted
//!   candidates are never offered.
//! - Duplicates: the byte-identical (SHA-256) extra copies of the Project's
//!   candidate, member and calibration frames. One copy of each frame is kept
//!   and named; an extra copy that a run that is not Complete reads, as a
//!   prepared entry's source or a Direct-source path, is refused.
//! - Archive: the Project's member sessions, keeping each one a run of
//!   another Project not marked Done selects.
//! - Empty Trash, while the Project's Trash holds runs.
//!
//! Offers only: nothing here hashes, records an operation or moves a file.
//! PV-STO re-verifies every approved item and adds its custody refusals.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use persistence_library::{
    AdoptedSource, DoneArchiveBasis, PreparedUse, ProjectFrame, RegisteredLocation,
};
use uuid::Uuid;

use crate::library::Library;
use crate::{
    ApplicableQuality, ArchiveOffer, Availability, DoneArchiveSheet, DuplicateFrame,
    DuplicatesOffer, EmptyTrashOffer, FrameCopy, IntermediatesOffer, KeptLibraryCopy, LibraryError,
    LocationRole, OfferRefusal, OfferedIntermediate, ProjectState, RefusedCopy, RefusedFrame,
    RefusedIntermediate, RejectedFrame, RejectedFramesOffer, RunCompletion, TrashedRun,
};

impl Library {
    /// The Done / Archive sheet of Project `project_id`: Archive, the three
    /// trash offers with every refusal and its reason, and Empty Trash while
    /// the Project's Trash holds runs. Read-only: it hashes, records and
    /// moves nothing.
    ///
    /// # Errors
    /// `InvalidInput` for a Project that is not Done; `NotFound` for an
    /// unknown Project; `PersistenceFailure` when the catalog cannot be read.
    pub async fn done_archive_review(
        &self,
        project_id: Uuid,
    ) -> Result<DoneArchiveSheet, LibraryError> {
        let basis = self.catalog().done_archive_basis(project_id).await?;
        if basis.project.state != ProjectState::Done {
            return Err(LibraryError::InvalidInput(format!(
                "Project '{}' is not Done; its Done / Archive sheet opens once it is marked Done",
                basis.project.name
            )));
        }
        let trashed = self.catalog().trashed_views(project_id).await?;
        Ok(sheet(&basis, trashed))
    }
}

fn sheet(basis: &DoneArchiveBasis, trashed: Vec<TrashedRun>) -> DoneArchiveSheet {
    DoneArchiveSheet {
        project_id: basis.project.id,
        project_revision: basis.project.revision,
        archive: archive(basis),
        rejected_frames: rejected_frames(basis),
        intermediates: intermediates(basis),
        duplicates: duplicates(basis),
        empty_trash: (!trashed.is_empty()).then_some(EmptyTrashOffer { runs: trashed }),
    }
}

fn archive(basis: &DoneArchiveBasis) -> ArchiveOffer {
    let kept: BTreeSet<Uuid> = basis.kept_sessions.iter().map(|kept| kept.session_id).collect();
    ArchiveOffer {
        sessions: basis
            .member_sessions
            .iter()
            .filter(|session| !kept.contains(session))
            .copied()
            .collect(),
        kept: basis.kept_sessions.clone(),
    }
}

/// The copies that are still on disk to move: a Missing copy has nothing left.
fn present(copies: &[FrameCopy]) -> impl Iterator<Item = &FrameCopy> {
    copies.iter().filter(|copy| copy.availability != Availability::Missing)
}

fn rejected_frames(basis: &DoneArchiveBasis) -> RejectedFramesOffer {
    let mut offer = RejectedFramesOffer::default();
    let rejected = basis.frames.iter().filter(|frame| {
        frame.candidate && frame.quality == ApplicableQuality::Unusable && !frame.project_rejected
    });
    for frame in rejected {
        let copies: Vec<FrameCopy> = present(&frame.copies).cloned().collect();
        if copies.is_empty() {
            continue;
        }
        let reasons = frame_refusals(basis, frame);
        if reasons.is_empty() {
            let size_bytes = copies.iter().map(|copy| copy.size_bytes).sum();
            offer.n += 1;
            offer.size_bytes += size_bytes;
            offer.frames.push(RejectedFrame { frame_key: frame.key, copies, size_bytes });
        } else {
            offer.refused.push(RefusedFrame { frame_key: frame.key, copies, reasons });
        }
    }
    offer
}

/// Why `frame` stays: each revision of a run that is not Complete, in any
/// Project, that prepared it, then each Result recording a revision that
/// prepared it, whatever its run's state.
fn frame_refusals(basis: &DoneArchiveBasis, frame: &ProjectFrame) -> Vec<OfferRefusal> {
    let copies: BTreeSet<Uuid> = frame.copies.iter().map(|copy| copy.asset_id).collect();
    let mut revisions: BTreeMap<Uuid, &PreparedUse> = BTreeMap::new();
    let mut reasons = Vec::new();
    let holding = basis.uses.iter().filter(|used| {
        used.asset_id.is_some_and(|id| copies.contains(&id))
            || used.member_key.is_some_and(|key| copies.contains(&key))
    });
    for used in holding {
        if revisions.insert(used.revision_id, used).is_some() {
            continue;
        }
        if used.completion != RunCompletion::Complete {
            reasons.push(OfferRefusal::PreparedInOpenRun {
                run: used.run.clone(),
                preparation: used.preparation,
            });
        }
    }
    reasons.extend(basis.recorded_results.iter().filter_map(|result| {
        revisions.get(&result.revision_id).map(|used| OfferRefusal::ResultInput {
            result_id: result.result_id,
            result_name: result.name.clone(),
            run: used.run.clone(),
            preparation: used.preparation,
            inferred: result.inferred,
        })
    }));
    reasons
}

fn intermediates(basis: &DoneArchiveBasis) -> IntermediatesOffer {
    let mut offer = IntermediatesOffer::default();
    for item in &basis.intermediates {
        offer.n += 1;
        offer.size_bytes += item.size_bytes;
        offer.items.push(OfferedIntermediate {
            result_id: item.result_id,
            owner: item.owner,
            path: item.path.clone(),
            size_bytes: item.size_bytes,
            verified_duplicate_of: None,
        });
    }
    for source in &basis.adopted_sources {
        match verified_copy(source) {
            Ok(kept) => {
                offer.n += 1;
                offer.size_bytes += source.size_bytes;
                offer.items.push(OfferedIntermediate {
                    result_id: source.source.id,
                    owner: source.source.owner,
                    path: source.source.path.clone(),
                    size_bytes: source.size_bytes,
                    verified_duplicate_of: Some(kept),
                });
            }
            Err(reason) => offer.refused.push(RefusedIntermediate {
                result_id: source.source.id,
                owner: source.source.owner,
                path: source.source.path.clone(),
                reasons: vec![reason],
            }),
        }
    }
    offer
}

/// The kept library copy an adopted master's generated source duplicates,
/// proven by the recorded digests: the source's latest inspection still
/// reads the adopted digest, and a copy a scan recorded at the master's path
/// is Available with those bytes. A master copy no scan recorded yet stands
/// on its adoption, which verified it when it was installed.
fn verified_copy(source: &AdoptedSource) -> Result<KeptLibraryCopy, OfferRefusal> {
    let refuse = |detail: String| Err(OfferRefusal::UnverifiedDuplicate { detail });
    let name = source.source.name();
    if source.source.sha256.as_deref() != Some(source.adopted_sha256.as_str()) {
        return refuse(format!(
            "the generated source '{name}' no longer reads the digest its master was adopted at; \
             rescan its run's Results"
        ));
    }
    if let Some(asset) = &source.kept_asset {
        let kept = asset.relative_path.display();
        if asset.availability != Availability::Available {
            return refuse(format!(
                "the kept library copy '{kept}' of '{name}' reads {:?}",
                asset.availability
            ));
        }
        if asset
            .fingerprint
            .content_sha256
            .as_deref()
            .is_some_and(|sha256| sha256 != source.adopted_sha256)
        {
            return refuse(format!(
                "the kept library copy '{kept}' of '{name}' no longer holds the adopted bytes"
            ));
        }
    }
    Ok(source.kept.clone())
}

fn duplicates(basis: &DoneArchiveBasis) -> DuplicatesOffer {
    let locations: HashMap<Uuid, &RegisteredLocation> =
        basis.locations.iter().map(|location| (location.id, location)).collect();
    let mut offer = DuplicatesOffer::default();
    for frame in &basis.frames {
        let mut identical: BTreeMap<&str, Vec<&FrameCopy>> = BTreeMap::new();
        for copy in present(&frame.copies) {
            if let Some(sha256) = copy.sha256.as_deref() {
                identical.entry(sha256).or_default().push(copy);
            }
        }
        for (sha256, copies) in identical.into_iter().filter(|(_, copies)| copies.len() > 1) {
            let kept = kept_copy(&copies, &locations);
            let mut duplicate = DuplicateFrame {
                frame_key: frame.key,
                sha256: sha256.to_owned(),
                kept: kept.clone(),
                offered: Vec::new(),
                refused: Vec::new(),
            };
            for copy in copies.into_iter().filter(|copy| copy.asset_id != kept.asset_id) {
                let reasons = source_refusals(basis, copy.asset_id);
                if reasons.is_empty() {
                    offer.n += 1;
                    offer.size_bytes += copy.size_bytes;
                    duplicate.offered.push(copy.clone());
                } else {
                    duplicate.refused.push(RefusedCopy { copy: copy.clone(), reasons });
                }
            }
            offer.frames.push(duplicate);
        }
    }
    offer
}

/// The copy a frame keeps (D-W74): the one in a Captures or Calibration
/// location, the earliest-registered such location when there are several,
/// otherwise the copy in the earliest-registered location. Copies in one
/// location are ordered by path, then id.
fn kept_copy<'a>(
    copies: &[&'a FrameCopy],
    locations: &HashMap<Uuid, &RegisteredLocation>,
) -> &'a FrameCopy {
    copies
        .iter()
        .copied()
        .min_by_key(|copy| {
            let location = locations.get(&copy.location_id);
            let library = location.is_some_and(|location| {
                matches!(location.role, LocationRole::Captures | LocationRole::Calibration)
            });
            let order = location.map_or(usize::MAX, |location| location.order);
            (!library, order, copy.relative_path.display(), copy.asset_id)
        })
        .expect("a duplicate group holds at least two copies")
}

/// Why an extra copy stays: each revision of a run that is not Complete, in
/// any Project, that reads it as a prepared entry's source or Direct-source
/// path.
fn source_refusals(basis: &DoneArchiveBasis, asset_id: Uuid) -> Vec<OfferRefusal> {
    let mut revisions = BTreeSet::new();
    basis
        .uses
        .iter()
        .filter(|used| {
            used.asset_id == Some(asset_id) && used.completion != RunCompletion::Complete
        })
        .filter(|used| revisions.insert(used.revision_id))
        .map(|used| OfferRefusal::PreparedSource {
            run: used.run.clone(),
            preparation: used.preparation,
            direct_source: used.direct_source,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{NativePath, Project, Quality};

    fn location(role: LocationRole, order: usize) -> RegisteredLocation {
        RegisteredLocation { id: Uuid::new_v4(), role, order }
    }

    fn copy(location: &RegisteredLocation, path: &str) -> FrameCopy {
        FrameCopy {
            asset_id: Uuid::new_v4(),
            location_id: location.id,
            relative_path: NativePath::from_path(std::path::Path::new(path)),
            size_bytes: 64,
            sha256: Some("a".repeat(64)),
            availability: Availability::Available,
        }
    }

    fn kept<'a>(copies: &[&'a FrameCopy], locations: &[&RegisteredLocation]) -> &'a FrameCopy {
        let locations = locations.iter().map(|location| (location.id, *location)).collect();
        kept_copy(copies, &locations)
    }

    /// D-W74: a Captures or Calibration copy is kept over a copy in an
    /// earlier-registered location of another role.
    #[test]
    fn library_role_beats_earlier_registration() {
        let results = location(LocationRole::Results, 0);
        let calibration = location(LocationRole::Calibration, 1);
        let (early, library) = (copy(&results, "a.fits"), copy(&calibration, "a.fits"));
        assert_eq!(kept(&[&early, &library], &[&results, &calibration]), &library);
    }

    /// D-W74: among library copies, and among other copies when no library
    /// copy exists, the earliest-registered location's copy is kept.
    #[test]
    fn earliest_registered_location_otherwise() {
        let (first, second) =
            (location(LocationRole::Captures, 0), location(LocationRole::Captures, 3));
        let (a, b) = (copy(&first, "z.fits"), copy(&second, "a.fits"));
        assert_eq!(kept(&[&b, &a], &[&first, &second]), &a);
        let (old, new) = (location(LocationRole::Results, 1), location(LocationRole::Results, 2));
        let (c, d) = (copy(&new, "a.fits"), copy(&old, "z.fits"));
        assert_eq!(kept(&[&c, &d], &[&old, &new]), &d);
    }

    fn basis(frames: Vec<ProjectFrame>) -> DoneArchiveBasis {
        DoneArchiveBasis {
            project: Project {
                id: Uuid::new_v4(),
                name: "NGC 7000 HOO".into(),
                notes: None,
                state: ProjectState::Done,
                done_at: None,
                revision: 1,
                created_at: String::new(),
                updated_at: String::new(),
                subjects: Vec::new(),
                rig_ids: Vec::new(),
                goals: Vec::new(),
            },
            locations: Vec::new(),
            frames,
            uses: Vec::new(),
            recorded_results: Vec::new(),
            intermediates: Vec::new(),
            adopted_sources: Vec::new(),
            member_sessions: Vec::new(),
            kept_sessions: Vec::new(),
        }
    }

    fn frame(
        quality: ApplicableQuality,
        candidate: bool,
        project_rejected: bool,
        availability: Availability,
    ) -> ProjectFrame {
        let captures = location(LocationRole::Captures, 0);
        let mut copy = copy(&captures, "Ha_001.fits");
        copy.availability = availability;
        ProjectFrame {
            key: copy.asset_id,
            candidate,
            quality,
            project_rejected,
            copies: vec![copy],
        }
    }

    /// PRJ-FR-15, root FR-021: only a candidate whose applicable library
    /// quality is Unusable and that is still on disk counts. Changed content,
    /// a pending re-verification, a Project-only reject and a frame that is
    /// no candidate never do.
    #[test]
    fn only_applicable_unusable_candidates_are_rejected_frames() {
        let available = Availability::Available;
        let counted = frame(ApplicableQuality::Unusable, true, false, available);
        let changed = ApplicableQuality::ChangedContent { previous: Quality::Unusable };
        let pending = ApplicableQuality::VerificationPending { previous: Quality::Unusable };
        let frames = vec![
            counted.clone(),
            frame(changed, true, false, available),
            frame(pending, true, false, available),
            frame(ApplicableQuality::Conflicting, true, false, available),
            frame(ApplicableQuality::Unusable, true, true, available),
            frame(ApplicableQuality::Unusable, false, false, available),
            frame(ApplicableQuality::Unusable, true, false, Availability::Missing),
        ];
        let offer = rejected_frames(&basis(frames));
        assert_eq!(
            offer.frames.iter().map(|frame| frame.frame_key).collect::<Vec<_>>(),
            vec![counted.key]
        );
        assert_eq!((offer.n, offer.size_bytes), (1, 64));
        assert!(offer.refused.is_empty());
    }
}
