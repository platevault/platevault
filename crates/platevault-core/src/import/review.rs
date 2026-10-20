// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Import review of the sessions intake will form (LIB-FR-04, LIB-FR-24,
//! D-W107): the import's lights are grouped from their recorded headers
//! exactly as indexing will group them, with the frame type the user set and
//! the import's split limits, so the review shows each split by framing
//! before anything is written. A merge gives the chosen sessions' lights one
//! framing label, which indexing records as their framing correction; a
//! re-split takes it off again, and the split by framing returns. Choosing a
//! session's Target records the choice on each of its lights (D-W129).

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use super::image_type_text;
use crate::grouping::{file_name, group_frames, observing_night, Frame};
use crate::{
    CaptureMetadata, FramingMargins, ImportItemPhase, ImportItemRecord, ImportSession,
    ImportTargetChoice, LibraryError, NamingFrameType,
};

/// A light this import brings in, as intake will read it once indexed.
struct Light {
    seq: u32,
    name: String,
    metadata: CaptureMetadata,
    choice: Option<ImportTargetChoice>,
}

/// A session the lights form, with what decides its Target: its lights'
/// headers and the user's choice. Its `session` names no Target yet.
pub(super) struct Formed {
    pub session: ImportSession,
    pub frames: Vec<CaptureMetadata>,
    pub choice: Option<ImportTargetChoice>,
}

/// The phases of a light that is, or once started will be, imported.
const fn imports(phase: ImportItemPhase) -> bool {
    matches!(phase, ImportItemPhase::Ready | ImportItemPhase::Pending) || phase.imported()
}

/// A light that is, or once started will be, imported: the lights import
/// review shows.
pub(super) fn imported_light(record: &ImportItemRecord) -> bool {
    imports(record.item.phase)
}

fn lights(items: &[ImportItemRecord], include: impl Fn(&ImportItemRecord) -> bool) -> Vec<Light> {
    items
        .iter()
        .filter(|record| {
            record.item.frame_type() == Some(NamingFrameType::Light) && include(record)
        })
        .filter_map(|record| {
            let item = &record.item;
            let mut metadata = record.metadata.clone()?;
            if let Some(frame_type) = item.user_type {
                metadata.image_type = Some(image_type_text(frame_type).to_owned());
            }
            metadata.framing_label.clone_from(&item.framing_label);
            Some(Light {
                seq: item.seq,
                name: file_name(&item.relative_path),
                metadata,
                choice: item.target_choice,
            })
        })
        .collect()
}

fn frame_id(seq: u32) -> Uuid {
    Uuid::from_u128(u128::from(seq))
}

/// The sessions the lights `include` takes form within `margins`, ordered as
/// intake orders them.
pub(super) fn sessions(
    items: &[ImportItemRecord],
    margins: &FramingMargins,
    include: impl Fn(&ImportItemRecord) -> bool,
) -> Vec<Formed> {
    let lights = lights(items, include);
    let by_id: HashMap<Uuid, &Light> =
        lights.iter().map(|light| (frame_id(light.seq), light)).collect();
    let frames: Vec<Frame<'_>> = lights
        .iter()
        .map(|light| Frame {
            id: frame_id(light.seq),
            name: &light.name,
            metadata: &light.metadata,
        })
        .collect();
    group_frames(&frames, margins)
        .sessions
        .into_iter()
        .filter_map(|candidate| {
            let members: Vec<&Light> =
                candidate.asset_ids.iter().filter_map(|id| by_id.get(id).copied()).collect();
            let lead = candidate
                .framing
                .as_ref()
                .and_then(|framing| by_id.get(&framing.anchor_asset_id).copied())
                .or_else(|| members.first().copied())?;
            let metadata = &lead.metadata;
            let session = ImportSession {
                key: candidate.key,
                items: members.iter().map(|light| light.seq).collect(),
                framing: candidate.framing.as_ref().map(|framing| framing.ordinal),
                merged: members.iter().any(|light| light.metadata.framing_label.is_some()),
                object: metadata.object.clone(),
                filter: metadata.filter.clone(),
                exposure_seconds: metadata.exposure_seconds,
                night: observing_night(metadata),
                target: None,
                target_chosen: false,
            };
            Some(Formed {
                session,
                frames: members.iter().map(|light| light.metadata.clone()).collect(),
                choice: members.iter().find_map(|light| light.choice),
            })
        })
        .collect()
}

/// The sessions holding `seqs`, each once.
fn chosen<'a>(
    sessions: &'a [Formed],
    seqs: &[u32],
) -> Result<Vec<&'a ImportSession>, LibraryError> {
    let mut chosen: Vec<&ImportSession> = Vec::new();
    for seq in seqs {
        let session = sessions
            .iter()
            .map(|formed| &formed.session)
            .find(|session| session.items.contains(seq))
            .ok_or_else(|| {
                LibraryError::InvalidInput(format!(
                    "item {seq} is in no session of the import's lights"
                ))
            })?;
        if !chosen.iter().any(|known| std::ptr::eq(*known, session)) {
            chosen.push(session);
        }
    }
    Ok(chosen)
}

fn members_of(sessions: &[&ImportSession]) -> HashSet<u32> {
    sessions.iter().flat_map(|session| session.items.iter().copied()).collect()
}

fn label_items(items: &mut [ImportItemRecord], members: &HashSet<u32>, label: Option<&str>) {
    for record in items.iter_mut().filter(|record| members.contains(&record.item.seq)) {
        record.item.framing_label = label.map(str::to_owned);
    }
}

/// Merge the sessions holding `seqs` into one under `label`. Only sessions
/// that differ in framing alone merge: night, filter, exposure and the other
/// capture fields still split sessions.
pub(super) fn merge(
    items: &mut [ImportItemRecord],
    seqs: &[u32],
    margins: &FramingMargins,
    label: &str,
) -> Result<(), LibraryError> {
    let sessions = sessions(items, margins, imported_light);
    let chosen = chosen(&sessions, seqs)?;
    let [first, rest @ ..] = chosen.as_slice() else {
        return Err(LibraryError::InvalidInput("choose sessions to merge".into()));
    };
    if rest.is_empty() {
        return Err(LibraryError::InvalidInput("a merge needs two or more sessions".into()));
    }
    if rest.iter().any(|session| session.key != first.key) {
        return Err(LibraryError::InvalidInput(
            "only sessions that differ in framing merge; night, filter, exposure and equipment \
             keep sessions apart"
                .into(),
        ));
    }
    label_items(items, &members_of(&chosen), Some(label));
    Ok(())
}

/// Re-split the merged session holding `seq`: its lights lose their framing
/// label and split by framing again.
pub(super) fn resplit(
    items: &mut [ImportItemRecord],
    seq: u32,
    margins: &FramingMargins,
) -> Result<(), LibraryError> {
    let sessions = sessions(items, margins, imported_light);
    let session = chosen(&sessions, &[seq])?;
    if !session[0].merged {
        return Err(LibraryError::InvalidInput(format!(
            "the session holding item {seq} was not merged, so it has nothing to re-split"
        )));
    }
    label_items(items, &members_of(&session), None);
    Ok(())
}

/// Record `choice` on every light of the session holding `seq`, so that
/// choice alone files the session (D-W129).
pub(super) fn choose_target(
    items: &mut [ImportItemRecord],
    seq: u32,
    margins: &FramingMargins,
    choice: ImportTargetChoice,
) -> Result<(), LibraryError> {
    let sessions = sessions(items, margins, imported_light);
    let members = members_of(&chosen(&sessions, &[seq])?);
    for record in items.iter_mut().filter(|record| members.contains(&record.item.seq)) {
        record.item.target_choice = Some(choice);
    }
    Ok(())
}
