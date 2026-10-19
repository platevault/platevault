// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The View layout (spec 069 PREP-FR-16/19, D-W99, D-W108, D-W114; decision
//! record §4, §8 and §9): pure paths from a Project basis, no filesystem
//! access.
//!
//! `View/` has a `GROUP_<name>/` or `PANEL_<name>/` folder per group only
//! when the Project has several groups. Lights and flats always sit in
//! `NIGHT_YYYY-MM-DD/` folders, in `Lights/<folder>/` and `Flats/<folder>/`.
//! A light folder is named by its FILTER value, then `GAIN_<g>` and
//! `OFFSET_<o>` when the Project mixes them, then the exposure, as in
//! `Ha_GAIN_120_OFFSET_50_300s` (token order provisional). A flat folder is
//! the same without the exposure, so the flats sit under the gain of the
//! lights they calibrate, in the night of those lights. A second flat set for
//! one night, filter and group takes its own `NIGHT_<date>-2/` with the
//! lights it calibrates (provisional). Darks and bias sit in `Darks/` and
//! `Bias/`, at the top with one camera and inside each group with several,
//! under the gain and offset folder when those are mixed; when lights with
//! the same settings use different versions, every one of those goes into
//! the night folders of the lights that use it. In Copies mode a file
//! placed twice is two copies of its original, never a hard link (D-W81).

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use persistence_library::SourcePath;
use time::Date;
use uuid::Uuid;

use crate::layout::{self, name_key, COMPONENT_LIMIT};
use crate::patched_copy::HeaderPatch;
use crate::{
    ApplyBlocker, BasisGroup, BasisSession, CaptureMetadata, EntryInput, EntryName, EntryPlacement,
    EntrySource, InputKind, InputRef, ObservationFingerprint, PinTarget, ProjectBasis, Revision,
    SettledPin, ViewMode,
};

/// Room a filter token may take in a light folder name, leaving the rest
/// (`_GAIN_<g>_OFFSET_<o>_<exposure>s`) inside one path component.
const FILTER_ROOM: usize = COMPONENT_LIMIT - 64;

/// What the layout reads.
pub struct PlanInput<'a> {
    pub basis: &'a ProjectBasis,
    /// One included light's effective metadata per session.
    pub metadata: &'a BTreeMap<Uuid, CaptureMetadata>,
    pub sources: &'a BTreeMap<Uuid, SourcePath>,
    /// Names reserved for life.
    pub names: &'a BTreeMap<EntryInput, String>,
    /// The copy each included capture places, by capture key.
    pub chosen: &'a BTreeMap<Uuid, Uuid>,
}

/// One entry the build places.
#[derive(Clone, Debug)]
pub struct PlanEntry {
    pub seq: u32,
    /// Relative to `View/`.
    pub path: PathBuf,
    pub group_id: Option<Uuid>,
    pub night: Option<Date>,
    pub source: EntrySource,
    /// The asset or master id `sources` holds the original under.
    pub source_id: Uuid,
    pub placement: EntryPlacement,
    /// The recorded D19 basis the original must still match.
    pub basis: ObservationFingerprint,
    pub sha256: Option<String>,
    /// The reviewed header change of an isolated patched copy (PREP-FR-03):
    /// set by the preflight from the recorded corrections, never by the
    /// layout.
    pub patch: Option<HeaderPatch>,
}

/// The layout of one build and the names newcomers take.
#[derive(Clone, Debug)]
pub struct Plan {
    pub entries: Vec<PlanEntry>,
    pub names: Vec<EntryName>,
}

/// The settings a session's folders are named and matched by.
#[derive(Clone, Debug, Default)]
struct Settings {
    /// The FILTER comparison key.
    filter: Option<String>,
    exposure: Option<String>,
    gain: Option<String>,
    offset: Option<String>,
    camera: String,
    binning: Option<(u32, u32)>,
}

impl Settings {
    fn of(metadata: Option<&CaptureMetadata>) -> Self {
        let Some(meta) = metadata else { return Self::default() };
        Self {
            filter: filter_raw(meta).map(name_key),
            exposure: meta.exposure_seconds.map(number),
            gain: meta.gain.map(number),
            offset: meta.offset.map(|offset| offset.to_string()),
            camera: name_key(&format!(
                "{}|{}",
                meta.camera.as_deref().unwrap_or_default(),
                meta.camera_id.as_deref().unwrap_or_default()
            )),
            binning: meta.binning_x.zip(meta.binning_y),
        }
    }

    /// What a dark must match: camera, exposure, gain, offset and binning.
    fn dark_key(&self) -> String {
        format!(
            "{}|{:?}|{:?}|{:?}|{:?}",
            self.camera, self.exposure, self.gain, self.offset, self.binning
        )
    }

    /// What a bias must match: the dark's settings without the exposure.
    fn bias_key(&self) -> String {
        format!("{}|{:?}|{:?}|{:?}", self.camera, self.gain, self.offset, self.binning)
    }
}

fn filter_raw(meta: &CaptureMetadata) -> Option<&str> {
    meta.filter.as_deref().map(str::trim).filter(|filter| !filter.is_empty())
}

/// A decimal as the folder names write it: `300`, `0.5`.
fn number(value: f64) -> String {
    format!("{value}")
}

/// A pin target's identity: a raw set at its grouping revision or a master
/// version.
type TargetKey = (u8, Uuid, Revision);

fn target_key(target: &PinTarget) -> TargetKey {
    match target.input {
        InputRef::RawSet { session_id, grouping_revision } => (0, session_id, grouping_revision),
        InputRef::Master { master_id, revision } => (1, master_id, revision),
    }
}

/// Folder names the whole Project shares.
struct Names {
    group_folders: BTreeMap<Uuid, Option<String>>,
    /// Filter comparison key to its folder token.
    filters: BTreeMap<String, String>,
    mixed_gain: bool,
    mixed_offset: bool,
    /// Darks and bias sit in each group's folder.
    calibration_in_groups: bool,
}

impl Names {
    fn new(
        basis: &ProjectBasis,
        lit: &[(&BasisGroup, &BasisSession, Settings)],
        metadata: &BTreeMap<Uuid, CaptureMetadata>,
    ) -> Result<Self, ApplyBlocker> {
        let group_folders = group_folders(basis)?;
        let mut raws: BTreeMap<String, String> = BTreeMap::new();
        for (_, session, _) in lit {
            if let Some(raw) = metadata.get(&session.session_id).and_then(filter_raw) {
                raws.entry(name_key(raw))
                    .and_modify(|kept| {
                        if raw < kept.as_str() {
                            raw.clone_into(kept);
                        }
                    })
                    .or_insert_with(|| raw.to_owned());
            }
        }
        let clash =
            |error: crate::LibraryError| ApplyBlocker::FolderClash { detail: error.to_string() };
        let mut filters = BTreeMap::new();
        let mut used = BTreeSet::new();
        for (key, raw) in &raws {
            let plain = layout::token("filter", raw, FILTER_ROOM).map_err(clash)?;
            let token = if used.contains(&name_key(&plain)) {
                layout::token_suffixed("filter", raw, FILTER_ROOM).map_err(clash)?
            } else {
                plain
            };
            used.insert(name_key(&token));
            filters.insert(key.clone(), token);
        }
        let distinct = |pick: fn(&Settings) -> Option<String>| {
            lit.iter().map(|(_, _, settings)| pick(settings)).collect::<BTreeSet<_>>().len() > 1
        };
        let cameras: BTreeSet<&str> =
            lit.iter().map(|(_, _, settings)| settings.camera.as_str()).collect();
        Ok(Self {
            group_folders,
            filters,
            mixed_gain: distinct(|settings| settings.gain.clone()),
            mixed_offset: distinct(|settings| settings.offset.clone()),
            calibration_in_groups: basis.has_group_folders() && cameras.len() > 1,
        })
    }

    /// The `GAIN_<g>` and `OFFSET_<o>` parts this Project names.
    fn gain_offset(&self, settings: &Settings) -> Vec<String> {
        let mut parts = Vec::new();
        if self.mixed_gain {
            parts.extend(settings.gain.as_ref().map(|gain| format!("GAIN_{gain}")));
        }
        if self.mixed_offset {
            parts.extend(settings.offset.as_ref().map(|offset| format!("OFFSET_{offset}")));
        }
        parts
    }

    fn filter(&self, settings: &Settings) -> Option<String> {
        settings.filter.as_ref().and_then(|key| self.filters.get(key)).cloned()
    }

    /// `<filter>[_GAIN_g][_OFFSET_o]_<exposure>s`.
    fn light_folder(&self, settings: &Settings) -> Option<String> {
        let mut parts: Vec<String> = self.filter(settings).into_iter().collect();
        parts.extend(self.gain_offset(settings));
        parts.extend(settings.exposure.as_ref().map(|exposure| format!("{exposure}s")));
        joined(&parts)
    }

    /// `<filter>[_GAIN_g][_OFFSET_o]`.
    fn flat_folder(&self, settings: &Settings) -> Option<String> {
        let mut parts: Vec<String> = self.filter(settings).into_iter().collect();
        parts.extend(self.gain_offset(settings));
        joined(&parts)
    }

    /// `[GAIN_g][_OFFSET_o]` below `Darks/` or `Bias/`.
    fn calibration_folder(&self, settings: &Settings) -> Option<String> {
        joined(&self.gain_offset(settings))
    }
}

fn joined(parts: &[String]) -> Option<String> {
    (!parts.is_empty()).then(|| parts.join("_"))
}

/// Each group's folder, `None` without the group level (D-W114). Two groups
/// whose folders would read the same are refused.
fn group_folders(basis: &ProjectBasis) -> Result<BTreeMap<Uuid, Option<String>>, ApplyBlocker> {
    if !basis.has_group_folders() {
        return Ok(basis.groups.iter().map(|group| (group.id, None)).collect());
    }
    let mut folders = BTreeMap::new();
    let mut taken: BTreeMap<String, &str> = BTreeMap::new();
    for group in &basis.groups {
        let folder = layout::group_folder(&basis.keywords, &group.name, group.panel)
            .map_err(|error| ApplyBlocker::FolderClash { detail: error.to_string() })?;
        if let Some(other) = taken.insert(name_key(&folder), group.name.as_str()) {
            return Err(ApplyBlocker::FolderClash {
                detail: format!(
                    "the groups '{other}' and '{}' would share the folder {folder}; rename one",
                    group.name.as_str()
                ),
            });
        }
        folders.insert(group.id, Some(folder));
    }
    Ok(folders)
}

fn night_folder(night: Option<Date>, index: usize) -> String {
    let base = night.map_or_else(
        || "NIGHT_unknown".to_owned(),
        |date| format!("NIGHT_{:04}-{:02}-{:02}", date.year(), u8::from(date.month()), date.day()),
    );
    if index == 0 {
        base
    } else {
        format!("{base}-{}", index + 1)
    }
}

/// One placement before names are known.
struct Draft {
    folder: PathBuf,
    group_id: Option<Uuid>,
    night: Option<Date>,
    source: EntrySource,
    source_id: Uuid,
    input: EntryInput,
    basis: ObservationFingerprint,
    sha256: Option<String>,
}

/// Lay out the build.
///
/// # Errors
/// [`ApplyBlocker::FolderClash`] for two groups or filter values that would
/// share a folder, or a name that leaves no folder name.
pub fn plan(input: &PlanInput<'_>) -> Result<Plan, ApplyBlocker> {
    let basis = input.basis;
    let lit: Vec<(&BasisGroup, &BasisSession, Settings)> = basis
        .groups
        .iter()
        .flat_map(|group| group.sessions.iter().map(move |session| (group, session)))
        .filter(|(_, session)| session.captures.iter().any(|capture| capture.included))
        .map(|(group, session)| {
            (group, session, Settings::of(input.metadata.get(&session.session_id)))
        })
        .collect();
    let names = Names::new(basis, &lit, input.metadata)?;
    let flat_index = flat_nights(&names, &lit);
    let per_night = |kind: InputKind| per_night_calibration(&names, &lit, kind);
    let (dark_per_night, bias_per_night) = (per_night(InputKind::Dark), per_night(InputKind::Bias));

    let mut drafts: Vec<Draft> = Vec::new();
    for (index, (group, session, settings)) in lit.iter().enumerate() {
        let group_root: PathBuf = names
            .group_folders
            .get(&group.id)
            .cloned()
            .flatten()
            .map(PathBuf::from)
            .unwrap_or_default();
        let night_dir = group_root.join(night_folder(session.night, flat_index[index]));
        let mut lights = night_dir.join("Lights");
        lights.extend(names.light_folder(settings));
        for capture in session.captures.iter().filter(|capture| capture.included) {
            let Some(asset_id) = input.chosen.get(&capture.capture_key).copied() else {
                continue;
            };
            let Some(copy) = capture.copies.iter().find(|copy| copy.asset_id == asset_id) else {
                continue;
            };
            drafts.push(Draft {
                folder: lights.clone(),
                group_id: Some(group.id),
                night: session.night,
                source: EntrySource::Light { capture_key: capture.capture_key, asset_id },
                source_id: asset_id,
                input: EntryInput::Capture { capture_key: capture.capture_key },
                basis: copy.fingerprint.clone(),
                sha256: copy.fingerprint.content_sha256.clone(),
            });
        }
        let in_night = Placed { group_id: Some(group.id), night: session.night };
        let mut flats = night_dir.join("Flats");
        flats.extend(names.flat_folder(settings));
        place_pin(&mut drafts, &session.calibration.flat, InputKind::Flat, &flats, in_night);
        for (kind, per_night, folder) in [
            (InputKind::Dark, &dark_per_night, "Darks"),
            (InputKind::Bias, &bias_per_night, "Bias"),
        ] {
            let (mut target, placed) = if per_night.contains(&index) {
                (night_dir.join(folder), in_night)
            } else if names.calibration_in_groups {
                (group_root.join(folder), Placed { group_id: Some(group.id), night: None })
            } else {
                (PathBuf::from(folder), Placed { group_id: None, night: None })
            };
            target.extend(names.calibration_folder(settings));
            place_pin(&mut drafts, session.calibration.kind(kind), kind, &target, placed);
        }
    }
    Ok(finish(input, drafts))
}

/// Each lit session's night index: 0 for the first flat set of its group,
/// night and flat folder, 1 for the second (`NIGHT_<date>-2`), and so on,
/// ordered by capture date and then identity. Sessions with No flats stay
/// in the first.
fn flat_nights(names: &Names, lit: &[(&BasisGroup, &BasisSession, Settings)]) -> Vec<usize> {
    type Bucket = (Uuid, Option<Date>, Option<String>);
    let bucket = |(group, session, settings): &(&BasisGroup, &BasisSession, Settings)| -> Bucket {
        (group.id, session.night, names.flat_folder(settings))
    };
    let mut sets: BTreeMap<Bucket, BTreeSet<(Option<Date>, TargetKey)>> = BTreeMap::new();
    for item in lit {
        if let Some(target) = item.1.calibration.flat.target() {
            sets.entry(bucket(item)).or_default().insert((target.captured, target_key(target)));
        }
    }
    lit.iter()
        .map(|item| {
            item.1.calibration.flat.target().map_or(0, |target| {
                let key = (target.captured, target_key(target));
                sets[&bucket(item)].iter().position(|set| *set == key).unwrap_or(0)
            })
        })
        .collect()
}

/// The lit sessions whose `kind` goes into their night folder: lights with
/// the same settings in one place use more than one version.
fn per_night_calibration(
    names: &Names,
    lit: &[(&BasisGroup, &BasisSession, Settings)],
    kind: InputKind,
) -> BTreeSet<usize> {
    let key = |(group, _, settings): &(&BasisGroup, &BasisSession, Settings)| {
        let scope = names.calibration_in_groups.then_some(group.id);
        let settings =
            if kind == InputKind::Dark { settings.dark_key() } else { settings.bias_key() };
        (scope, settings)
    };
    let mut versions: BTreeMap<(Option<Uuid>, String), BTreeSet<TargetKey>> = BTreeMap::new();
    for item in lit {
        if let Some(target) = item.1.calibration.kind(kind).target() {
            versions.entry(key(item)).or_default().insert(target_key(target));
        }
    }
    lit.iter()
        .enumerate()
        .filter(|(_, item)| {
            item.1.calibration.kind(kind).target().is_some() && versions[&key(item)].len() > 1
        })
        .map(|(index, _)| index)
        .collect()
}

/// The group and night an entry belongs to; shared darks and bias belong to
/// neither.
#[derive(Clone, Copy)]
struct Placed {
    group_id: Option<Uuid>,
    night: Option<Date>,
}

/// Every file of a pinned kind, in `folder`.
fn place_pin(
    drafts: &mut Vec<Draft>,
    pin: &SettledPin,
    kind: InputKind,
    folder: &std::path::Path,
    placed: Placed,
) {
    let Some(target) = pin.target() else { return };
    for file in &target.files {
        let (source, source_id, input) = match (target.input, file.asset_id) {
            (InputRef::Master { master_id, revision }, _) => (
                EntrySource::Master { kind, master_id, revision },
                master_id,
                EntryInput::Master { master_id },
            ),
            (InputRef::RawSet { session_id, .. }, Some(asset_id)) => (
                EntrySource::CalibrationFrame { kind, session_id, asset_id },
                asset_id,
                EntryInput::CalibrationFrame { asset_id },
            ),
            (InputRef::RawSet { .. }, None) => continue,
        };
        drafts.push(Draft {
            folder: folder.to_path_buf(),
            group_id: placed.group_id,
            night: placed.night,
            source,
            source_id,
            input,
            basis: file.fingerprint.clone(),
            sha256: Some(file.sha256.clone()),
        });
    }
}

/// Name every input, drop repeats of one input in one folder, order by path
/// and place: links in Symlinks mode, a copy of the original for every entry
/// in Copies mode.
fn finish(input: &PlanInput<'_>, drafts: Vec<Draft>) -> Plan {
    let mut taken: BTreeSet<String> = input.names.values().map(|name| name_key(name)).collect();
    let mut assigned: BTreeMap<EntryInput, String> = BTreeMap::new();
    let mut newcomers: BTreeMap<EntryInput, Uuid> = BTreeMap::new();
    for draft in &drafts {
        if !input.names.contains_key(&draft.input) {
            newcomers.entry(draft.input).or_insert(draft.source_id);
        }
    }
    let mut names = Vec::new();
    for (entry_input, source_id) in newcomers {
        let source = input
            .sources
            .get(&source_id)
            .and_then(|source| source.path.to_path_buf().ok())
            .and_then(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
            .unwrap_or_default();
        let id = match entry_input {
            EntryInput::Capture { capture_key } => capture_key,
            EntryInput::CalibrationFrame { asset_id } => asset_id,
            EntryInput::Master { master_id } => master_id,
        };
        let basename =
            layout::entry_basename(&source, id, |candidate| taken.contains(&name_key(candidate)));
        taken.insert(name_key(&basename));
        if let Ok(name) = EntryName::new(entry_input, &basename) {
            names.push(name);
        }
        assigned.insert(entry_input, basename);
    }
    let mut placed: BTreeMap<PathBuf, Draft> = BTreeMap::new();
    for draft in drafts {
        let Some(name) = input.names.get(&draft.input).or_else(|| assigned.get(&draft.input))
        else {
            continue;
        };
        placed.entry(draft.folder.join(name)).or_insert(draft);
    }
    // Copies mode: every entry is its own copy of the original, also where
    // one source sits in several night folders (D-W81, 063 FR-005).
    let placement = match input.basis.mode {
        ViewMode::Symlinks => EntryPlacement::Symlink,
        ViewMode::Copies => EntryPlacement::Copy,
    };
    let mut entries = Vec::with_capacity(placed.len());
    for (seq, (path, draft)) in (0_u32..).zip(placed) {
        entries.push(PlanEntry {
            seq,
            path,
            group_id: draft.group_id,
            night: draft.night,
            source: draft.source,
            source_id: draft.source_id,
            placement,
            basis: draft.basis,
            sha256: draft.sha256,
            patch: None,
        });
    }
    Plan { entries, names }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use time::macros::date;

    use super::*;
    use crate::{
        ApplicableQuality, BasisCapture, CaptureInclusion, CopyBasis, Evaluation, FileIdentity,
        GroupKeywords, GroupName, GroupOrigin, InclusionBasis, NativePath, OpticsSignature,
        PathSensitivity, PinnedFile, SessionPlacement, SettledCalibration, Verdict, VolumeIdentity,
    };

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn fingerprint(n: u128) -> ObservationFingerprint {
        ObservationFingerprint {
            identity: FileIdentity {
                volume: VolumeIdentity {
                    filesystem: "apfs".into(),
                    stable_id: Some("vol".into()),
                    file_ids_stable: true,
                    case: PathSensitivity::Insensitive,
                    normalization: PathSensitivity::Insensitive,
                },
                file_id: Some(n.to_string()),
            },
            size_bytes: 2880,
            modified_ns: 1,
            content_sha256: None,
        }
    }

    /// A raw set pin of `session` on `files`, captured on `captured`.
    fn raw(session: u128, files: &[u128], captured: Date) -> SettledPin {
        SettledPin::Pinned {
            target: PinTarget {
                input: InputRef::RawSet { session_id: id(session), grouping_revision: 1 },
                captured: Some(captured),
                files: files
                    .iter()
                    .map(|file| PinnedFile {
                        asset_id: Some(id(*file)),
                        sha256: "a".repeat(64),
                        fingerprint: fingerprint(*file),
                    })
                    .collect(),
                evaluation: Evaluation {
                    verdict: Verdict::Compatible,
                    criteria: Vec::new(),
                    evidence: Vec::new(),
                },
            },
        }
    }

    struct Session {
        id: u128,
        night: Date,
        lights: Vec<u128>,
        flat: SettledPin,
        dark: SettledPin,
        meta: CaptureMetadata,
    }

    fn meta(filter: &str, exposure: f64, camera: &str) -> CaptureMetadata {
        CaptureMetadata {
            filter: Some(filter.into()),
            exposure_seconds: Some(exposure),
            gain: Some(100.0),
            offset: Some(50),
            camera: Some(camera.into()),
            binning_x: Some(1),
            binning_y: Some(1),
            ..CaptureMetadata::default()
        }
    }

    fn session(
        id: u128,
        night: Date,
        lights: &[u128],
        flat: SettledPin,
        dark: SettledPin,
    ) -> Session {
        Session {
            id,
            night,
            lights: lights.to_vec(),
            flat,
            dark,
            meta: meta("Ha", 300.0, "ASI2600MM"),
        }
    }

    struct Layout {
        basis: ProjectBasis,
        metadata: BTreeMap<Uuid, CaptureMetadata>,
        sources: BTreeMap<Uuid, SourcePath>,
        chosen: BTreeMap<Uuid, Uuid>,
    }

    fn layout(groups: Vec<(&str, Vec<Session>)>) -> Layout {
        let mut metadata = BTreeMap::new();
        let mut sources = BTreeMap::new();
        let mut chosen = BTreeMap::new();
        let mut basis_groups = Vec::new();
        for (index, (name, sessions)) in groups.into_iter().enumerate() {
            let mut basis_sessions = Vec::new();
            for session in sessions {
                metadata.insert(id(session.id), session.meta);
                let captures = session
                    .lights
                    .iter()
                    .map(|light| {
                        chosen.insert(id(*light), id(*light));
                        BasisCapture {
                            capture_key: id(*light),
                            included: true,
                            inclusion: CaptureInclusion::Included { basis: InclusionBasis::Usable },
                            copies: vec![CopyBasis {
                                asset_id: id(*light),
                                decision_revision: 1,
                                fingerprint: fingerprint(*light),
                            }],
                            quality_when_added: ApplicableQuality::Usable,
                        }
                    })
                    .collect();
                for pin in [&session.flat, &session.dark] {
                    for file in pin.target().into_iter().flat_map(|target| &target.files) {
                        let asset = file.asset_id.unwrap();
                        sources.insert(asset, source(&format!("cal-{}.fits", asset.as_u128())));
                    }
                }
                for light in &session.lights {
                    sources.insert(id(*light), source(&format!("light-{light}.fits")));
                }
                basis_sessions.push(BasisSession {
                    session_id: id(session.id),
                    night: Some(session.night),
                    placement: SessionPlacement::Framing,
                    target_id: id(3000),
                    captures,
                    calibration: SettledCalibration {
                        dark: session.dark,
                        flat: session.flat,
                        bias: SettledPin::Declined,
                    },
                });
            }
            basis_groups.push(BasisGroup {
                id: id(1000 + index as u128),
                name: GroupName::new(name).unwrap(),
                panel: false,
                rig_id: id(2000 + index as u128),
                origin: GroupOrigin::Framing,
                optics: OpticsSignature::new(None, Some(250.0), None).unwrap(),
                framing: None,
                position: u32::try_from(index).unwrap(),
                sessions: basis_sessions,
            });
        }
        Layout {
            basis: ProjectBasis {
                mode: ViewMode::Symlinks,
                keywords: GroupKeywords::default(),
                groups: basis_groups,
            },
            metadata,
            sources,
            chosen,
        }
    }

    fn source(name: &str) -> SourcePath {
        SourcePath {
            location_id: id(9),
            path: NativePath::from_path(&Path::new("/library").join(name)),
        }
    }

    fn plan_of(layout: &Layout) -> Result<Vec<String>, ApplyBlocker> {
        let names = BTreeMap::new();
        let plan = plan(&PlanInput {
            basis: &layout.basis,
            metadata: &layout.metadata,
            sources: &layout.sources,
            names: &names,
            chosen: &layout.chosen,
        })?;
        Ok(plan.entries.iter().map(|entry| entry.path.to_string_lossy().into_owned()).collect())
    }

    #[test]
    fn two_groups_that_would_share_a_folder_are_refused() {
        let night = date!(2026 - 10 - 12);
        let layout = layout(vec![
            ("Red Cat", vec![session(1, night, &[10], raw(5, &[50], night), SettledPin::Declined)]),
            ("Red_Cat", vec![session(2, night, &[11], raw(5, &[50], night), SettledPin::Declined)]),
        ]);
        assert!(matches!(plan_of(&layout), Err(ApplyBlocker::FolderClash { .. })));
    }

    #[test]
    fn several_cameras_put_darks_inside_each_group() {
        let night = date!(2026 - 10 - 12);
        let mut esprit = session(2, night, &[11], raw(6, &[60], night), raw(8, &[80], night));
        esprit.meta = meta("OIII", 300.0, "ASI294MM");
        let layout = layout(vec![
            ("RedCat", vec![session(1, night, &[10], raw(5, &[50], night), raw(7, &[70], night))]),
            ("Esprit", vec![esprit]),
        ]);
        let paths = plan_of(&layout).unwrap();
        assert!(
            paths
                .contains(&"GROUP_RedCat/NIGHT_2026-10-12/Lights/Ha_300s/light-10.fits".to_owned()),
            "{paths:#?}"
        );
        assert!(paths.contains(&"GROUP_RedCat/NIGHT_2026-10-12/Flats/Ha/cal-50.fits".to_owned()));
        assert!(paths.contains(&"GROUP_RedCat/Darks/cal-70.fits".to_owned()));
        assert!(paths.contains(&"GROUP_Esprit/Darks/cal-80.fits".to_owned()));
        assert!(!paths.iter().any(|path| path.starts_with("Darks/")));
    }

    #[test]
    fn a_second_flat_set_for_one_night_takes_its_own_night_folder() {
        let night = date!(2026 - 10 - 14);
        let mut later = session(2, night, &[11], raw(6, &[60], night), SettledPin::Declined);
        later.meta = meta("Ha", 600.0, "ASI2600MM");
        let layout = layout(vec![(
            "RedCat",
            vec![
                session(
                    1,
                    night,
                    &[10],
                    raw(5, &[50], date!(2026 - 10 - 13)),
                    SettledPin::Declined,
                ),
                later,
            ],
        )]);
        let paths = plan_of(&layout).unwrap();
        assert!(
            paths.contains(&"NIGHT_2026-10-14/Lights/Ha_300s/light-10.fits".to_owned()),
            "{paths:#?}"
        );
        assert!(paths.contains(&"NIGHT_2026-10-14/Flats/Ha/cal-50.fits".to_owned()));
        assert!(paths.contains(&"NIGHT_2026-10-14-2/Lights/Ha_600s/light-11.fits".to_owned()));
        assert!(paths.contains(&"NIGHT_2026-10-14-2/Flats/Ha/cal-60.fits".to_owned()));
    }

    #[test]
    fn two_dark_versions_with_the_same_settings_go_to_their_nights() {
        let (first, second) = (date!(2024 - 10 - 12), date!(2026 - 10 - 13));
        let mut short = session(3, second, &[12], raw(5, &[50], second), raw(9, &[90], second));
        short.meta = meta("Ha", 120.0, "ASI2600MM");
        let layout = layout(vec![(
            "RedCat",
            vec![
                session(1, first, &[10], raw(5, &[50], first), raw(7, &[70], first)),
                session(2, second, &[11], raw(5, &[50], second), raw(8, &[80], second)),
                short,
            ],
        )]);
        let paths = plan_of(&layout).unwrap();
        assert!(paths.contains(&"NIGHT_2024-10-12/Darks/cal-70.fits".to_owned()), "{paths:#?}");
        assert!(paths.contains(&"NIGHT_2026-10-13/Darks/cal-80.fits".to_owned()));
        assert!(paths.contains(&"Darks/cal-90.fits".to_owned()), "another setting stays shared");
        assert!(!paths
            .iter()
            .any(|path| path == "Darks/cal-70.fits" || path == "Darks/cal-80.fits"));
    }

    #[test]
    fn a_long_filter_name_fits_one_path_component() {
        let night = date!(2026 - 10 - 12);
        let mut long = session(1, night, &[10], raw(5, &[50], night), SettledPin::Declined);
        long.meta = meta(&"Hydrogen alpha narrowband ".repeat(16), 300.0, "ASI2600MM");
        let paths = plan_of(&layout(vec![("RedCat", vec![long])])).unwrap();
        for path in &paths {
            for part in Path::new(path).components() {
                let part = part.as_os_str().to_string_lossy();
                assert!(layout::component_len(&part) <= COMPONENT_LIMIT, "{part}");
            }
        }
        assert!(
            paths.iter().any(|path| path.contains("Lights/Hydrogen-alpha-narrowband-")
                && path.contains("_300s/")),
            "{paths:#?}"
        );
    }

    #[test]
    fn filter_values_that_share_a_token_stay_apart() {
        let night = date!(2026 - 10 - 12);
        let mut greek = session(2, night, &[11], raw(6, &[60], night), SettledPin::Declined);
        greek.meta = meta("Hα", 300.0, "ASI2600MM");
        let mut plain = session(1, night, &[10], raw(5, &[50], night), SettledPin::Declined);
        plain.meta = meta("H", 300.0, "ASI2600MM");
        let paths = plan_of(&layout(vec![("RedCat", vec![plain, greek])])).unwrap();
        let lights: BTreeSet<&str> = paths
            .iter()
            .filter_map(|path| path.strip_prefix("NIGHT_2026-10-12/Lights/"))
            .filter_map(|rest| rest.split('/').next())
            .collect();
        assert_eq!(lights.len(), 2, "{paths:#?}");
        assert!(lights.contains("H_300s"));
    }
}
