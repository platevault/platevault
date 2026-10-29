// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Fixture devices for each recognised capture layout and a generic one
//! (STO-IMP-AC-14), the host mount-table parsers, and the device list through
//! connection and removal over a faked mount table and volume probe
//! (STO-IMP-AC-15).

use std::collections::HashSet;
use std::fs::Metadata;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use super::*;
use crate::inventory::Probed;
use crate::LayoutMarker::{
    AutorunFolder, CameraSettingsFiles, EkosFrameNames, EkosScheduleFiles, EkosSequenceFiles,
    FlatFolder, LightFolder, LiveFolder, PlanFolder, SgpSequenceFiles, SharpcapCapturesFolder,
    VoyagerFrameNames,
};
use crate::{LibraryError, PathSensitivity, VolumeIdentity};

/// A device folder holding `files` (relative paths; a trailing `/` makes a
/// folder), as a capture application leaves its storage.
fn device(files: &[&str]) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    for file in files {
        let path = root.path().join(file);
        if file.ends_with('/') {
            fs::create_dir_all(&path).unwrap();
        } else {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"SIMPLE  =                    T").unwrap();
        }
    }
    root
}

fn recognised(files: &[&str]) -> Option<(CaptureLayout, Vec<LayoutMarker>)> {
    let root = device(files);
    recognise(root.path()).map(|found| (found.layout, found.matched))
}

#[test]
fn an_asiair_card_is_recognised_by_its_autorun_and_plan_folders() {
    let found = recognised(&[
        "Autorun/Light/NGC 7000/Light_NGC 7000_300.0s_Bin1_H_gain100_20261002-203000_-10.0C_0001.fit",
        "Plan/",
    ]);
    assert_eq!(found, Some((CaptureLayout::Asiair, vec![AutorunFolder, PlanFolder])));
    let nested = recognised(&["ASIAIR/Live/Light/M31/Live_M31_10.0s_0001.fit"]);
    assert_eq!(nested, Some((CaptureLayout::Asiair, vec![LiveFolder])));
}

#[test]
fn a_nina_card_is_recognised_by_its_capitalised_frame_type_folders() {
    let found = recognised(&[
        "2026-10-02/LIGHT/2026-10-02_20-30-00_Ha_-10.00_300.00s_0001.fits",
        "2026-10-02/FLAT/2026-10-02_06-10-00_Ha_-10.00_1.20s_0001.fits",
    ]);
    assert_eq!(found, Some((CaptureLayout::Nina, vec![LightFolder, FlatFolder])));
}

#[test]
fn a_sharpcap_card_is_recognised_by_its_captures_folder_or_settings_sidecars() {
    // SharpCap's default nesting puts the sidecars five levels down, below
    // the walk; the folder alone names the layout there.
    let found = recognised(&[
        "SharpCap Captures/2026-10-02/M31/20_30_00/Capture_00001.fits",
        "SharpCap Captures/2026-10-02/M31/20_30_00/Capture_00001.CameraSettings.txt",
    ]);
    assert_eq!(found, Some((CaptureLayout::SharpCap, vec![SharpcapCapturesFolder])));
    let both = recognised(&[
        "SharpCap Captures/M31/Capture_00001.fits",
        "SharpCap Captures/M31/Capture_00001.CameraSettings.txt",
    ]);
    assert_eq!(
        both,
        Some((CaptureLayout::SharpCap, vec![SharpcapCapturesFolder, CameraSettingsFiles]))
    );
    let sidecar = recognised(&["M31/Capture_00001.fits", "M31/Capture_00001.CameraSettings.txt"]);
    assert_eq!(sidecar, Some((CaptureLayout::SharpCap, vec![CameraSettingsFiles])));
}

#[test]
fn an_ekos_card_is_recognised_by_its_frame_names_or_sequence_files() {
    let found =
        recognised(&["NGC7000/Light/Ha/NGC7000_Light_Ha_300_secs_2026-10-02T20-30-00_001.fits"]);
    assert_eq!(found, Some((CaptureLayout::Ekos, vec![EkosFrameNames])));
    let queue = recognised(&["NGC7000.esq", "NGC7000.esl", "NGC7000/frame_001.fits"]);
    assert_eq!(queue, Some((CaptureLayout::Ekos, vec![EkosSequenceFiles, EkosScheduleFiles])));
}

#[test]
fn an_sgp_card_is_recognised_by_its_sequence_file() {
    let found = recognised(&["NGC7000.sgf", "NGC7000/NGC7000_Ha_300s_frame1.fit"]);
    assert_eq!(found, Some((CaptureLayout::Sgp, vec![SgpSequenceFiles])));
}

#[test]
fn a_voyager_card_is_recognised_by_its_frame_names() {
    let name = "NGC7000/NGC7000_LIGHT_Ha_300s_BIN1_-10C_GA100_20261002_203000_001_PA0.00_W.FIT";
    assert_eq!(recognised(&[name]), Some((CaptureLayout::Voyager, vec![VoyagerFrameNames])));
    let dark = "Darks/DARK_300s_BIN1_-10C_GA100_20261002_063000_001.fit";
    assert_eq!(recognised(&[dark]), Some((CaptureLayout::Voyager, vec![VoyagerFrameNames])));
}

#[test]
fn an_unrecognised_layout_is_a_generic_device() {
    assert_eq!(
        recognised(&["Night 2026-10-04/light_001.fits", "Night 2026-10-04/notes.txt"]),
        None
    );
    assert_eq!(recognised(&[]), None);
    // Lower-case type folders and words in other names mark no layout.
    assert_eq!(recognised(&["light/Light frames.fits", "Plans/Autorun notes/"]), None);
}

#[test]
fn the_most_specific_layout_wins_and_names_only_its_own_markers() {
    let found = recognised(&["LIGHT/frame.fits", "SharpCap Captures/"]);
    assert_eq!(found, Some((CaptureLayout::SharpCap, vec![SharpcapCapturesFolder])));
    let found = recognised(&["Autorun/", "M31/M31_LIGHT_L_60s_BIN1_x.fit", "x.sgf"]);
    assert_eq!(found, Some((CaptureLayout::Sgp, vec![SgpSequenceFiles])));
}

#[test]
fn recognition_skips_hidden_and_deep_entries() {
    assert_eq!(recognised(&[".Trashes/LIGHT/", ".Spotlight-V100/x.sgf"]), None);
    assert_eq!(recognised(&["a/b/c/d/LIGHT/frame.fits"]), None, "deeper than the walk reads");
    assert_eq!(
        recognised(&["a/b/c/LIGHT/frame.fits"]),
        Some((CaptureLayout::Nina, vec![LightFolder]))
    );
}

#[test]
fn recognition_stops_reading_at_its_entry_budget() {
    const BUDGET: usize = 12;
    // The root's two folders, then `a`'s files, are read before `b`.
    let root = device(&["b/x.sgf"]);
    fs::create_dir(root.path().join("a")).unwrap();
    let walk = |files_in_a: usize| {
        for index in 0..files_in_a {
            fs::File::create(root.path().join("a").join(format!("{index:02}.txt"))).unwrap();
        }
        recognise_within(root.path(), BUDGET).map(|found| found.layout)
    };
    assert_eq!(walk(BUDGET - 3), Some(CaptureLayout::Sgp), "within the budget");
    assert_eq!(walk(BUDGET), None, "the budget runs out inside `a`; `b` is never read");
}

#[cfg(unix)]
#[test]
fn recognition_follows_no_link() {
    let elsewhere = device(&["Autorun/", "x.sgf"]);
    let root = device(&["frames/light_001.fits"]);
    std::os::unix::fs::symlink(elsewhere.path().join("Autorun"), root.path().join("Autorun"))
        .unwrap();
    std::os::unix::fs::symlink(elsewhere.path(), root.path().join("linked")).unwrap();
    assert_eq!(recognise(root.path()), None);
}

// ── Host mount tables ───────────────────────────────────────────────────────

fn mounted(root: &str, name: &str, instance: &str) -> Mount {
    Mount { root: root.into(), name: name.into(), instance: instance.into() }
}

fn os_names(list: &[&str]) -> BTreeSet<std::ffi::OsString> {
    list.iter().map(std::ffi::OsString::from).collect()
}

#[test]
fn mac_mount_listings_keep_browsable_local_disk_volumes_and_every_volumes_root() {
    let listing = "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n\
         devfs on /dev (devfs, local, nobrowse)\n\
         /dev/disk4s1 on /Volumes/Card-1 (msdos, local, nodev, nosuid, noowners)\n\
         /dev/disk5s2 on /Volumes/Astro T7 (apfs, local, nodev, nosuid, journaled, noowners)\n\
         /dev/disk7s1 on /Volumes/Recovery (apfs, local, journaled, nobrowse)\n\
         /dev/disk9s1 on /Volumes/Helper (hfs, local, nodev, nosuid, read-only, nobrowse)\n\
         //guest@nas.local/astro on /Volumes/astro (smbfs, nodev, nosuid, mounted by me)\n\
         /dev/disk8s1 on /Volumes/Astro T7/nested (apfs, local, nodev)\n\
         map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)";
    let table = mac_table(listing);
    assert_eq!(
        table.mounts,
        vec![
            mounted("/Volumes/Card-1", "Card-1", "/dev/disk4s1"),
            mounted("/Volumes/Astro T7", "Astro T7", "/dev/disk5s2"),
        ]
    );
    assert_eq!(table.roots, os_names(&["Card-1", "Astro T7", "Recovery", "Helper", "astro"]));
}

#[test]
fn mac_listings_run_again_only_when_volumes_names_change_mount_or_grow_old() {
    let card = vec![mounted("/Volumes/Card-1", "Card-1", "/dev/disk4s1")];
    let listings = std::cell::Cell::new(0);
    let list = |mounts: Vec<Mount>| {
        let listings = &listings;
        move || {
            listings.set(listings.get() + 1);
            let roots = mounts.iter().map(|mount| mount.name.clone().into()).collect();
            Ok(MacTable { mounts, roots })
        }
    };
    let start = Instant::now();
    let mut kept = None;

    assert_eq!(gated(&mut kept, os_names(&["Card-1"]), start, list(card.clone())).unwrap(), card);
    let later = start + Duration::from_secs(10);
    assert_eq!(gated(&mut kept, os_names(&["Card-1"]), later, list(Vec::new())).unwrap(), card);
    assert_eq!(listings.get(), 1, "the same names within the window reuse the listing");

    assert_eq!(gated(&mut kept, os_names(&[]), later, list(Vec::new())).unwrap(), Vec::new());
    assert_eq!(listings.get(), 2, "a removed name lists again");

    let swapped = vec![mounted("/Volumes/Card-1", "Card-1", "/dev/disk6s1")];
    let stale = later + MAC_SAFETY_POLL;
    assert_eq!(gated(&mut kept, os_names(&[]), stale, list(swapped.clone())).unwrap(), swapped);
    assert_eq!(listings.get(), 3, "the safety poll lists again with the same names");

    let failed = gated(&mut kept, os_names(&["Card-2"]), stale, || {
        Err(std::io::Error::other("mount did not answer"))
    });
    assert!(failed.is_err());
    let retried = gated(&mut kept, os_names(&["Card-2"]), stale, list(Vec::new()));
    assert_eq!(retried.unwrap(), Vec::new(), "a failed listing is not kept");
}

#[test]
fn a_volumes_name_not_yet_mounted_lists_again_on_the_next_poll() {
    let card = vec![mounted("/Volumes/Card-1", "Card-1", "/dev/disk4s1")];
    let listings = std::cell::Cell::new(0);
    let list = |mounts: Vec<Mount>| {
        let listings = &listings;
        move || {
            listings.set(listings.get() + 1);
            let roots = mounts.iter().map(|mount| mount.name.clone().into()).collect();
            Ok(MacTable { mounts, roots })
        }
    };
    let start = Instant::now();
    let mut kept = None;

    // `Card-1` is in /Volumes a moment before its volume is mounted there.
    let early = gated(&mut kept, os_names(&["Card-1"]), start, list(Vec::new())).unwrap();
    assert_eq!(early, Vec::new());
    let next = start + POLL;
    let mounted = gated(&mut kept, os_names(&["Card-1"]), next, list(card.clone())).unwrap();
    assert_eq!(mounted, card, "the next poll lists again, so the card shows at once");
    assert_eq!(listings.get(), 2);

    let after = next + POLL;
    assert_eq!(gated(&mut kept, os_names(&["Card-1"]), after, list(Vec::new())).unwrap(), card);
    assert_eq!(listings.get(), 2, "once every name is a mount root the listing is reused");
}

#[test]
fn linux_mountinfo_keeps_device_mounts_by_mount_id() {
    let mountinfo = "22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw\n\
         25 22 0:5 / /proc rw shared:12 - proc proc rw\n\
         36 22 8:17 / /media/sjors/Card\\0401 rw,nosuid shared:20 - vfat /dev/sdb1 rw,uid=1000\n\
         37 22 0:52 / /mnt/nas rw shared:21 - nfs4 nas:/export/astro rw\n\
         38 22 179:1 / /mnt/sd rw shared:22 - exfat /dev/mmcblk0p1 rw";
    assert_eq!(
        linux_mounts(mountinfo),
        vec![
            mounted("/", "nvme0n1p2", "22"),
            mounted("/media/sjors/Card 1", "Card 1", "36"),
            mounted("/mnt/sd", "sd", "38"),
        ],
        "a volume mounted at / is named by its device"
    );
}

/// The host's table is read without touching any volume; only the parse is
/// asserted, never which volumes this machine has mounted.
#[cfg(any(target_os = "macos", target_os = "linux", windows))]
#[test]
fn this_hosts_mount_table_is_read() {
    let table = OsMounts::default();
    let mounts = table.mounts().expect("the host's mount table");
    assert!(mounts.iter().all(|mount| {
        mount.root.is_absolute() && !mount.name.is_empty() && !mount.instance.is_empty()
    }));
    assert_eq!(table.mounts().unwrap(), mounts, "an unchanged table reads the same");
}

// ── The device list through connection and removal ──────────────────────────

/// A mount table the test sets.
#[derive(Default)]
struct FakeTable {
    mounts: Mutex<Vec<Mount>>,
    broken: Mutex<bool>,
}

impl FakeTable {
    fn set(&self, mounts: &[&Mount]) {
        *self.mounts.lock().unwrap() = mounts.iter().map(|mount| (*mount).clone()).collect();
    }
}

impl MountTable for FakeTable {
    fn mounts(&self) -> std::io::Result<Vec<Mount>> {
        if *self.broken.lock().unwrap() {
            return Err(std::io::Error::other("mount table unreadable"));
        }
        Ok(self.mounts.lock().unwrap().clone())
    }
}

/// A volume probe reading the roots the test names as removable, refusing
/// those it names unqualified, and counting its probes.
#[derive(Default)]
struct FakeVolumes {
    removable: Mutex<HashSet<PathBuf>>,
    unqualified: Mutex<HashSet<PathBuf>>,
    probes: AtomicUsize,
}

impl VolumeProbe for FakeVolumes {
    fn probe(&self, path: &Path, _meta: &Metadata) -> Result<Probed, LibraryError> {
        self.probes.fetch_add(1, Ordering::SeqCst);
        if self.unqualified.lock().unwrap().contains(path) {
            return Err(LibraryError::InvalidInput("still mounting".into()));
        }
        let kind = if self.removable.lock().unwrap().contains(path) {
            VolumeKind::Removable
        } else {
            VolumeKind::Local
        };
        let volume = VolumeIdentity {
            filesystem: "exfat".into(),
            stable_id: Some("fake".into()),
            file_ids_stable: false,
            case: PathSensitivity::Unknown,
            normalization: PathSensitivity::Unknown,
        };
        Ok(Probed { volume, kind })
    }

    fn handle_volume_id(&self, _path: &Path) -> Option<String> {
        None
    }
}

struct Rig {
    table: Arc<FakeTable>,
    volumes: Arc<FakeVolumes>,
}

impl Rig {
    fn new() -> Self {
        Self { table: Arc::default(), volumes: Arc::default() }
    }

    fn devices(&self) -> Devices {
        Devices::new(self.table.clone(), self.volumes.clone())
    }

    fn removable(&self, root: &Path) {
        self.volumes.removable.lock().unwrap().insert(root.to_path_buf());
    }

    fn probes(&self) -> usize {
        self.volumes.probes.load(Ordering::SeqCst)
    }
}

fn mount(root: &Path, instance: &str) -> Mount {
    Mount { root: root.to_path_buf(), name: folder_name(root).unwrap(), instance: instance.into() }
}

fn name_of(root: &Path) -> String {
    folder_name(root).unwrap()
}

fn names(devices: &[RemovableDevice]) -> Vec<(String, Option<CaptureLayout>)> {
    devices
        .iter()
        .map(|device| (device.name.clone(), device.layout.as_ref().map(|found| found.layout)))
        .collect()
}

#[test]
fn connected_removable_volumes_are_listed_with_their_layout_and_local_ones_are_not() {
    let rig = Rig::new();
    let card = device(&["Autorun/", "Plan/"]);
    let generic = device(&["Night 2026-10-04/light_001.fits"]);
    let internal = device(&["LIGHT/"]);
    rig.removable(card.path());
    rig.removable(generic.path());
    let (card_mount, generic_mount) =
        (mount(card.path(), "disk4s1"), mount(generic.path(), "disk5s1"));
    rig.table.set(&[&card_mount, &generic_mount, &mount(internal.path(), "disk3s1")]);

    let mut devices = rig.devices();
    let listed = devices.refresh().expect("the first poll lists the connected devices");
    let mut expected =
        vec![(name_of(card.path()), Some(CaptureLayout::Asiair)), (name_of(generic.path()), None)];
    expected.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(names(&listed), expected);
    let card_device =
        listed.iter().find(|device| device.root == NativePath::from_path(card.path()));
    assert_eq!(
        card_device.unwrap().layout.as_ref().unwrap().matched,
        vec![AutorunFolder, PlanFolder]
    );

    // An unchanged table changes nothing and probes no mount again.
    let probes = rig.probes();
    assert_eq!(devices.refresh(), None);
    assert_eq!(rig.probes(), probes);
}

#[test]
fn a_removed_device_leaves_the_list_and_one_inserted_again_is_recognised_afresh() {
    let rig = Rig::new();
    let card = device(&["Autorun/"]);
    rig.removable(card.path());
    rig.table.set(&[&mount(card.path(), "disk4s1")]);
    let mut devices = rig.devices();
    assert_eq!(names(&devices.refresh().unwrap()).len(), 1);

    rig.table.set(&[]);
    assert_eq!(devices.refresh(), Some(Vec::new()), "the removal is published");
    assert_eq!(devices.refresh(), None);

    // Another card at the same mount folder is a new mount instance.
    fs::remove_dir(card.path().join("Autorun")).unwrap();
    fs::create_dir(card.path().join("LIGHT")).unwrap();
    rig.table.set(&[&mount(card.path(), "disk6s1")]);
    let listed = devices.refresh().unwrap();
    assert_eq!(names(&listed), vec![(name_of(card.path()), Some(CaptureLayout::Nina))]);
}

#[test]
fn a_mount_still_mounting_is_tried_again_a_few_times() {
    let rig = Rig::new();
    let card = device(&["x.sgf"]);
    rig.removable(card.path());
    rig.volumes.unqualified.lock().unwrap().insert(card.path().to_path_buf());
    rig.table.set(&[&mount(card.path(), "disk4s1")]);
    let mut devices = rig.devices();
    assert_eq!(devices.refresh(), None);
    rig.volumes.unqualified.lock().unwrap().clear();
    let listed = devices.refresh().expect("the second poll qualifies it");
    assert_eq!(names(&listed), vec![(name_of(card.path()), Some(CaptureLayout::Sgp))]);

    let stuck = device(&[]);
    rig.removable(stuck.path());
    rig.volumes.unqualified.lock().unwrap().insert(stuck.path().to_path_buf());
    rig.table.set(&[&mount(card.path(), "disk4s1"), &mount(stuck.path(), "disk7s1")]);
    let before = rig.probes();
    for _ in 0..5 {
        assert_eq!(devices.refresh(), None);
    }
    assert_eq!(rig.probes() - before, usize::from(QUALIFY_ATTEMPTS), "then it is ignored");
}

#[test]
fn an_unreadable_mount_table_keeps_the_list() {
    let rig = Rig::new();
    let card = device(&["Autorun/"]);
    rig.removable(card.path());
    rig.table.set(&[&mount(card.path(), "disk4s1")]);
    let mut devices = rig.devices();
    assert!(devices.refresh().is_some());
    *rig.table.broken.lock().unwrap() = true;
    assert_eq!(devices.refresh(), None);
    assert_eq!(names(&devices.listed()).len(), 1);
}

#[tokio::test]
async fn the_watch_publishes_connection_and_removal() {
    let rig = Rig::new();
    let card = device(&["Autorun/"]);
    rig.removable(card.path());
    let watch =
        DeviceWatch::start_with(rig.table.clone(), rig.volumes.clone(), Duration::from_millis(10));
    let mut updates = watch.subscribe();
    assert_eq!(watch.devices(), Vec::new());

    rig.table.set(&[&mount(card.path(), "disk4s1")]);
    let wait = Duration::from_secs(5);
    tokio::time::timeout(wait, updates.changed()).await.unwrap().unwrap();
    assert_eq!(names(&watch.devices()), vec![(name_of(card.path()), Some(CaptureLayout::Asiair))]);

    rig.table.set(&[]);
    tokio::time::timeout(wait, updates.changed()).await.unwrap().unwrap();
    assert_eq!(watch.devices(), Vec::new());

    watch.shutdown().await;
    rig.table.set(&[&mount(card.path(), "disk5s1")]);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(watch.devices(), Vec::new(), "a stopped watch polls no more");
}
