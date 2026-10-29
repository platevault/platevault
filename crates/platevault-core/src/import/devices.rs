// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Removable import devices (spec 071 STO-IMP-FR-10, STO-IMP-AC-14,
//! STO-IMP-AC-15): the USB and SD volumes Import lists under Removable
//! devices without a folder pick, each named by the capture layout it holds.
//!
//! [`DeviceWatch`] polls the operating system's mount table ([`MountTable`];
//! [`OsMounts`] on the host). Reading it touches no volume, so a network
//! share whose server went away never stalls a poll:
//! - macOS lists the kernel's cached table (`mount`), dropping `nobrowse`
//!   mounts. The names in `/Volumes` are read on every poll, without a
//!   `stat`, and `mount` runs only when that set of names changed or the
//!   last listing is 30 s old. The trade-off: a card swapped for another of
//!   the same name within that window keeps the old card's answer until the
//!   next listing.
//! - Linux reads `/proc/self/mountinfo`, mounts of a `/dev/` device only.
//! - Windows asks each drive letter's type and volume serial, with the
//!   no-disk dialog of an empty card-reader slot suppressed.
//!
//! A mount seen for the first time is qualified once by the inventory's
//! volume probe ([`VolumeProbe`]), and only a volume it reads as
//! [`VolumeKind::Removable`] is listed; a disk image reads local. A Windows
//! USB disk that reports itself fixed is local to that probe, so it is chosen
//! through Choose folder. A mount that cannot be qualified yet (it is still
//! mounting) is tried again on the next polls, a few times at most; one that
//! never qualifies (no remount-stable volume identity) stays unlisted, like a
//! fixed disk.
//!
//! A listed device's layout is recognised once ([`recognise`]) by folder
//! structure and file names, never by file contents, over a bounded
//! breadth-first walk that follows no link. A device whose layout no rule
//! matches is a generic device. A mount keeps its answer until it goes;
//! the same card inserted again, or another volume mounted at the same
//! folder, is a new mount instance and is qualified and recognised afresh.
//!
//! The watch publishes the device list whenever it changes; the shell
//! forwards it as an event, and its query reads the current list. Nothing
//! here writes to a device or holds a handle on it between polls, so a device
//! still ejects.

use std::collections::{BTreeSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::{interval, MissedTickBehavior};

use crate::inventory::{OsVolumes, VolumeProbe};
use crate::{
    CaptureLayout, LayoutMarker, LayoutRecognition, NativePath, RemovableDevice, VolumeKind,
};

/// How often the mount table is read.
const POLL: Duration = Duration::from_secs(2);
/// How old a macOS `mount` listing may grow while `/Volumes` keeps the same
/// names.
#[cfg(any(target_os = "macos", test))]
const MAC_SAFETY_POLL: Duration = Duration::from_secs(30);
/// How long [`DeviceWatch::shutdown`] waits for a poll in flight.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);
/// How many polls qualify a mount the volume probe could not answer for.
const QUALIFY_ATTEMPTS: u8 = 3;
/// How deep below a device's root recognition reads: each layout's markers
/// sit within the first few levels.
const MAX_DEPTH: usize = 4;
/// How many entries recognition reads on one device at most.
const MAX_ENTRIES: usize = 4096;

/// One volume the operating system has mounted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mount {
    /// The folder the volume is mounted at.
    pub root: PathBuf,
    /// The volume's name: its mount folder (`Card-1`), the device (`sdb1`)
    /// of a volume mounted at `/`, or the drive (`E:`) on Windows.
    pub name: String,
    /// What tells this mount from another at the same folder: the device
    /// node on macOS, the mount ID on Linux, the volume GUID and serial on
    /// Windows.
    pub instance: String,
}

/// The operating system's mount table: the seam [`DeviceWatch`] polls, and
/// that tests replace.
pub trait MountTable: Send + Sync {
    /// The volumes on local disk devices mounted now. Reading it touches no
    /// volume.
    ///
    /// # Errors
    /// The table could not be read; the watch keeps its last list.
    fn mounts(&self) -> std::io::Result<Vec<Mount>>;
}

/// This host's mount table.
#[derive(Debug, Default)]
pub struct OsMounts {
    /// The last `mount` listing and the `/Volumes` names it was taken with.
    #[cfg(target_os = "macos")]
    listed: Mutex<Option<MacListing>>,
}

impl MountTable for OsMounts {
    fn mounts(&self) -> std::io::Result<Vec<Mount>> {
        self.read()
    }
}

/// The connected removable devices, kept current by a poll of the mount
/// table until [`DeviceWatch::shutdown`] or drop.
pub struct DeviceWatch {
    devices: watch::Receiver<Vec<RemovableDevice>>,
    stop: watch::Sender<bool>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl DeviceWatch {
    /// Start polling this host's mount table. Call it inside a Tokio runtime.
    #[must_use]
    pub fn start() -> Self {
        Self::start_with(Arc::new(OsMounts::default()), Arc::new(OsVolumes), POLL)
    }

    pub(crate) fn start_with(
        table: Arc<dyn MountTable>,
        volumes: Arc<dyn VolumeProbe>,
        every: Duration,
    ) -> Self {
        let (publish, devices) = watch::channel(Vec::new());
        let (stop, mut stopped) = watch::channel(false);
        let task = tokio::spawn(async move {
            let mut state = Some(Devices::new(table, volumes));
            let mut tick = interval(every);
            tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
            loop {
                tokio::select! {
                    // An error means the watch was dropped, which stops it too.
                    _ = stopped.wait_for(|stop| *stop) => break,
                    _ = tick.tick() => {}
                }
                let Some(mut devices) = state.take() else { break };
                // The probe and the walk read the file system; keep them off
                // the runtime's workers.
                let polled = tokio::task::spawn_blocking(move || {
                    let changed = quiet(|| devices.refresh());
                    (devices, changed)
                })
                .await;
                let Ok((devices, changed)) = polled else {
                    tracing::error!("the removable device poll panicked; devices stop updating");
                    break;
                };
                if let Some(list) = changed {
                    publish.send_replace(list);
                }
                state = Some(devices);
            }
        });
        Self { devices, stop, task: Mutex::new(Some(task)) }
    }

    /// The connected removable devices, by name.
    #[must_use]
    pub fn devices(&self) -> Vec<RemovableDevice> {
        self.devices.borrow().clone()
    }

    /// The device list now and after each change.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<Vec<RemovableDevice>> {
        self.devices.clone()
    }

    /// Stop polling, waiting a short grace for a poll in flight.
    pub async fn shutdown(&self) {
        let _ = self.stop.send(true);
        let task = self.task.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(mut task) = task {
            if tokio::time::timeout(SHUTDOWN_GRACE, &mut task).await.is_err() {
                task.abort();
            }
        }
    }
}

impl Drop for DeviceWatch {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

/// Run one poll with Windows' critical-error dialogs off, so an empty
/// card-reader slot fails quietly instead of asking for a disk.
#[cfg(windows)]
fn quiet<T>(work: impl FnOnce() -> T) -> T {
    fs_volume_windows::without_error_dialogs(work)
}

#[cfg(not(windows))]
fn quiet<T>(work: impl FnOnce() -> T) -> T {
    work()
}

/// What a mount was qualified as.
enum Answer {
    Device(RemovableDevice),
    /// Not a removable volume, or not a folder that can be read.
    Ignored,
    /// The probe could not answer yet; tried again on the next polls.
    Unqualified {
        attempts: u8,
    },
}

/// The mounts one watch has seen, each with its answer.
struct Devices {
    table: Arc<dyn MountTable>,
    volumes: Arc<dyn VolumeProbe>,
    known: Vec<(Mount, Answer)>,
}

impl Devices {
    fn new(table: Arc<dyn MountTable>, volumes: Arc<dyn VolumeProbe>) -> Self {
        Self { table, volumes, known: Vec::new() }
    }

    /// Read the mount table once: the device list when it changed.
    fn refresh(&mut self) -> Option<Vec<RemovableDevice>> {
        let mounts = match self.table.mounts() {
            Ok(mounts) => mounts,
            Err(error) => {
                tracing::warn!(%error, "the mount table could not be read; devices kept");
                return None;
            }
        };
        let before = self.listed();
        self.known.retain(|(mount, _)| mounts.contains(mount));
        for mount in mounts {
            if let Some(index) = self.known.iter().position(|(known, _)| *known == mount) {
                if let Answer::Unqualified { attempts } = self.known[index].1 {
                    self.known[index].1 = self.qualify(&mount, attempts);
                }
            } else {
                let answer = self.qualify(&mount, 0);
                self.known.push((mount, answer));
            }
        }
        let after = self.listed();
        (after != before).then_some(after)
    }

    /// The listed devices, by name and then root.
    fn listed(&self) -> Vec<RemovableDevice> {
        let mut devices: Vec<RemovableDevice> = self
            .known
            .iter()
            .filter_map(|(_, answer)| match answer {
                Answer::Device(device) => Some(device.clone()),
                Answer::Ignored | Answer::Unqualified { .. } => None,
            })
            .collect();
        devices.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.root.cmp(&b.root)));
        devices
    }

    /// Qualify `mount`, which `attempts` earlier polls could not.
    fn qualify(&self, mount: &Mount, attempts: u8) -> Answer {
        let retry = || {
            let attempts = attempts + 1;
            if attempts < QUALIFY_ATTEMPTS {
                Answer::Unqualified { attempts }
            } else {
                Answer::Ignored
            }
        };
        let Ok(meta) = fs::symlink_metadata(&mount.root) else { return retry() };
        if !meta.is_dir() {
            return Answer::Ignored;
        }
        match self.volumes.probe(&mount.root, &meta) {
            Ok(probed) if probed.kind == VolumeKind::Removable => Answer::Device(RemovableDevice {
                root: NativePath::from_path(&mount.root),
                name: mount.name.clone(),
                layout: recognise(&mount.root),
            }),
            Ok(_) => Answer::Ignored,
            Err(error) => {
                tracing::debug!(root = %mount.root.display(), %error, "mount not qualified");
                retry()
            }
        }
    }
}

/// The last component of a mount point, if it has a non-empty one.
#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn folder_name(root: &Path) -> Option<String> {
    root.file_name().map(|name| name.to_string_lossy().into_owned()).filter(|name| !name.is_empty())
}

// ── Layout recognition ──────────────────────────────────────────────────────

/// The capture layout the folder `root` holds, by folder structure and file
/// names; `None` for a generic device.
///
/// The walk reads at most [`MAX_ENTRIES`] entries, counted as each folder is
/// read, [`MAX_DEPTH`] levels deep, breadth first and in name order, and
/// follows no link. Hidden entries and the operating systems' own folders are
/// skipped, and an unreadable folder is passed over. Where several layouts
/// match, the most specific wins in this order: `SharpCap`, SGP, ASIAIR,
/// Voyager, Ekos, NINA. The recognition names every marker of the winning
/// layout the walk found.
#[must_use]
pub fn recognise(root: &Path) -> Option<LayoutRecognition> {
    recognise_within(root, MAX_ENTRIES)
}

/// [`recognise`], reading at most `budget` entries.
fn recognise_within(root: &Path, mut budget: usize) -> Option<LayoutRecognition> {
    let mut found = BTreeSet::new();
    let mut folders = VecDeque::from([(root.to_path_buf(), String::new(), 0_usize)]);
    while let Some((folder, relative, depth)) = folders.pop_front() {
        let Ok(listing) = fs::read_dir(&folder) else { continue };
        let mut entries = Vec::new();
        let mut cut = false;
        for entry in listing {
            if budget == 0 {
                cut = true;
                break;
            }
            budget -= 1;
            let Ok(entry) = entry else { continue };
            // A link is never followed, nor read as what it names.
            let Ok(kind) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().into_owned();
            if !kind.is_symlink() && !skipped(&name) {
                entries.push((name, kind.is_dir()));
            }
        }
        entries.sort();
        for (name, is_dir) in entries {
            found.extend(marker_of(&name, &relative, is_dir, depth));
            if is_dir && depth + 1 < MAX_DEPTH {
                let path =
                    if relative.is_empty() { name.clone() } else { format!("{relative}/{name}") };
                folders.push_back((folder.join(&name), path, depth + 1));
            }
        }
        if cut {
            break;
        }
    }
    let layout = PRECEDENCE
        .into_iter()
        .find(|layout| found.iter().any(|marker: &LayoutMarker| marker.layout() == *layout))?;
    let matched = found.into_iter().filter(|marker| marker.layout() == layout).collect();
    Some(LayoutRecognition { layout, matched })
}

/// Layouts from the most specific marker to the least.
const PRECEDENCE: [CaptureLayout; 6] = [
    CaptureLayout::SharpCap,
    CaptureLayout::Sgp,
    CaptureLayout::Asiair,
    CaptureLayout::Voyager,
    CaptureLayout::Ekos,
    CaptureLayout::Nina,
];

/// Hidden entries and the folders operating systems keep on a volume.
fn skipped(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "System Volume Information" | "$RECYCLE.BIN")
}

/// The marker the entry `name` in the folder `parent` (relative to the
/// device root, `depth` levels down) is, if any.
fn marker_of(name: &str, parent: &str, is_dir: bool, depth: usize) -> Option<LayoutMarker> {
    if is_dir {
        folder_marker(name, parent, depth)
    } else {
        file_marker(name)
    }
}

fn folder_marker(name: &str, parent: &str, depth: usize) -> Option<LayoutMarker> {
    // ASIAIR writes Autorun, Plan and Live at the root of its storage, or
    // inside an `ASIAIR` folder there.
    let asiair_top = depth == 0 || (depth == 1 && parent == "ASIAIR");
    match name {
        "SharpCap Captures" => Some(LayoutMarker::SharpcapCapturesFolder),
        "Autorun" if asiair_top => Some(LayoutMarker::AutorunFolder),
        "Plan" if asiair_top => Some(LayoutMarker::PlanFolder),
        "Live" if asiair_top => Some(LayoutMarker::LiveFolder),
        // N.I.N.A.'s `$$IMAGETYPE$$` folders are in capitals.
        "LIGHT" => Some(LayoutMarker::LightFolder),
        "FLAT" => Some(LayoutMarker::FlatFolder),
        "DARK" => Some(LayoutMarker::DarkFolder),
        "BIAS" => Some(LayoutMarker::BiasFolder),
        "DARKFLAT" => Some(LayoutMarker::DarkflatFolder),
        _ => None,
    }
}

fn file_marker(name: &str) -> Option<LayoutMarker> {
    if name.to_ascii_lowercase().ends_with(".camerasettings.txt") {
        return Some(LayoutMarker::CameraSettingsFiles);
    }
    let (stem, extension) = name.rsplit_once('.')?;
    match extension.to_ascii_lowercase().as_str() {
        "sgf" => Some(LayoutMarker::SgpSequenceFiles),
        "esq" => Some(LayoutMarker::EkosSequenceFiles),
        "esl" => Some(LayoutMarker::EkosScheduleFiles),
        "fit" | "fits" | "fts" | "xisf" => {
            let tokens: Vec<&str> = stem.split('_').collect();
            if voyager_name(&tokens) {
                Some(LayoutMarker::VoyagerFrameNames)
            } else if ekos_name(&tokens) {
                Some(LayoutMarker::EkosFrameNames)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Voyager's `{target}_{TYPE}[_{filter}]_{exposure}s_BIN{n}_…`, with the
/// frame type in capitals.
fn voyager_name(tokens: &[&str]) -> bool {
    let exposure = |token: &str| {
        token.strip_suffix('s').is_some_and(|value| {
            !value.is_empty() && value.chars().all(|c| c.is_ascii_digit() || c == '.')
        })
    };
    let binning = |token: &str| {
        token
            .strip_prefix("BIN")
            .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
    };
    tokens.iter().enumerate().any(|(index, token)| {
        matches!(*token, "LIGHT" | "FLAT" | "DARK" | "BIAS")
            && [1, 2].iter().any(|offset| {
                let at = |shift: usize| tokens.get(index + offset + shift).copied();
                at(0).is_some_and(exposure) && at(1).is_some_and(binning)
            })
    })
}

/// Ekos's `{target}_{Type}_{filter}_{exposure}_secs_{timestamp}_{n}`, with the
/// frame type capitalised.
fn ekos_name(tokens: &[&str]) -> bool {
    tokens.iter().enumerate().any(|(index, token)| {
        matches!(*token, "Light" | "Flat" | "Dark" | "Bias")
            && tokens.iter().skip(index + 2).any(|later| *later == "secs")
    })
}

// ── Host mount tables ───────────────────────────────────────────────────────

/// A macOS `mount` listing and the `/Volumes` names it was taken with.
#[cfg(any(target_os = "macos", test))]
#[derive(Debug)]
struct MacListing {
    names: BTreeSet<std::ffi::OsString>,
    at: std::time::Instant,
    mounts: Vec<Mount>,
}

/// The mounts for the `/Volumes` entries `names` at `now`: `previous`'s
/// while it was taken with the same names less than [`MAC_SAFETY_POLL`] ago,
/// else a fresh `listing`, which `previous` then keeps. A failed listing
/// keeps nothing, so the next poll lists again.
#[cfg(any(target_os = "macos", test))]
fn gated(
    previous: &mut Option<MacListing>,
    names: BTreeSet<std::ffi::OsString>,
    now: std::time::Instant,
    listing: impl FnOnce() -> std::io::Result<Vec<Mount>>,
) -> std::io::Result<Vec<Mount>> {
    if let Some(kept) = previous.as_ref().filter(|kept| {
        kept.names == names && now.saturating_duration_since(kept.at) < MAC_SAFETY_POLL
    }) {
        return Ok(kept.mounts.clone());
    }
    let mounts = listing()?;
    *previous = Some(MacListing { names, at: now, mounts: mounts.clone() });
    Ok(mounts)
}

#[cfg(target_os = "macos")]
impl OsMounts {
    /// `mount` only when `/Volumes` holds other names than at the last
    /// listing, or that listing is [`MAC_SAFETY_POLL`] old. Reading the
    /// names stats no mount.
    fn read(&self) -> std::io::Result<Vec<Mount>> {
        let names =
            fs::read_dir("/Volumes")?.filter_map(Result::ok).map(|e| e.file_name()).collect();
        let mut last = self.listed.lock().unwrap_or_else(PoisonError::into_inner);
        gated(&mut last, names, std::time::Instant::now(), || {
            let listing = crate::inventory::run_bounded(
                std::process::Command::new("/sbin/mount"),
                Duration::from_secs(5),
            )
            .map_err(std::io::Error::other)?;
            Ok(mac_mounts(&String::from_utf8_lossy(&listing)))
        })
    }
}

/// The browsable local disk volumes under `/Volumes` in a `mount` listing,
/// whose lines read `/dev/disk4s1 on /Volumes/Card-1 (msdos, local, nodev, …)`.
/// A `nobrowse` mount (a system or helper volume Finder hides) is left out.
#[cfg(any(target_os = "macos", test))]
fn mac_mounts(listing: &str) -> Vec<Mount> {
    listing
        .lines()
        .filter_map(|line| {
            let (source, rest) = line.split_once(" on ")?;
            let (root, options) = rest.rsplit_once(" (")?;
            let options: Vec<&str> = options.trim_end_matches(')').split(", ").collect();
            if !source.starts_with("/dev/")
                || !options.contains(&"local")
                || options.contains(&"nobrowse")
                || !root.starts_with("/Volumes/")
            {
                return None;
            }
            let root = PathBuf::from(root);
            Some(Mount { name: folder_name(&root)?, root, instance: source.to_owned() })
        })
        .collect()
}

#[cfg(target_os = "linux")]
impl OsMounts {
    /// `/proc/self/mountinfo`, mounts of a `/dev/` device only.
    #[allow(clippy::unused_self)] // macOS keeps its last listing here
    fn read(&self) -> std::io::Result<Vec<Mount>> {
        Ok(linux_mounts(&fs::read_to_string("/proc/self/mountinfo")?))
    }
}

/// The mounts of a `/dev/` device in a `mountinfo` listing, keyed by mount
/// ID; mount points are unescaped (`\040` is a space). A volume mounted at
/// `/` is named by its device (`sdb1`).
#[cfg(any(target_os = "linux", test))]
fn linux_mounts(mountinfo: &str) -> Vec<Mount> {
    mountinfo
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(' ').collect();
            let separator = fields.iter().position(|field| *field == "-")?;
            let source = fields.get(separator + 2)?;
            let device = source.strip_prefix("/dev/")?;
            let root = unescape_mount_point(fields.get(4)?);
            let name = folder_name(&root)
                .unwrap_or_else(|| device.rsplit('/').next().unwrap_or(device).to_owned());
            Some(Mount { root, name, instance: (*fields.first()?).to_owned() })
        })
        .collect()
}

/// A `mountinfo` path, whose space, tab, newline and backslash are written as
/// three octal digits after a backslash.
#[cfg(any(target_os = "linux", test))]
fn unescape_mount_point(field: &str) -> PathBuf {
    let bytes = field.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let octal = bytes.get(index + 1..index + 4).filter(|digits| {
            bytes[index] == b'\\' && digits.iter().all(|digit| (b'0'..=b'7').contains(digit))
        });
        if let Some(digits) = octal {
            let value =
                digits.iter().fold(0_u32, |value, digit| value * 8 + u32::from(digit - b'0'));
            out.push(u8::try_from(value).unwrap_or(b'?'));
            index += 4;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    path_from_bytes(out)
}

#[cfg(all(any(target_os = "linux", test), unix))]
fn path_from_bytes(bytes: Vec<u8>) -> PathBuf {
    use std::os::unix::ffi::OsStringExt;
    PathBuf::from(std::ffi::OsString::from_vec(bytes))
}

#[cfg(all(test, not(unix)))]
fn path_from_bytes(bytes: Vec<u8>) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(windows)]
impl OsMounts {
    /// Each drive letter `GetDriveTypeW` reads as removable (2), keyed by the
    /// volume's GUID name and serial. Neither call opens the volume; the
    /// poll runs with the no-disk dialog off ([`quiet`]).
    #[allow(clippy::unused_self)] // macOS keeps its last listing here
    fn read(&self) -> std::io::Result<Vec<Mount>> {
        const DRIVE_REMOVABLE: u32 = 2;
        Ok((b'A'..=b'Z')
            .filter_map(|letter| {
                let root = PathBuf::from(format!(r"{}:\", char::from(letter)));
                if fs_volume_windows::drive_type(&root).ok()? != DRIVE_REMOVABLE {
                    return None;
                }
                // A card reader with no card answers no volume.
                let volume = fs_volume_windows::volume(&root).ok()?;
                let guid = volume.name?;
                Some(Mount {
                    root,
                    name: format!("{}:", char::from(letter)),
                    instance: format!("{} {:08X}", guid.to_string_lossy(), volume.serial),
                })
            })
            .collect())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
impl OsMounts {
    #[allow(clippy::unused_self, clippy::unnecessary_wraps)]
    fn read(&self) -> std::io::Result<Vec<Mount>> {
        Ok(Vec::new())
    }
}

#[cfg(test)]
mod tests;
