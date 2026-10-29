// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Fixture devices for each recognised capture layout and a generic one
//! (STO-IMP-AC-14), and the device list through connection and removal over
//! a faked mount table and volume probe (STO-IMP-AC-15).

use std::collections::HashSet;
use std::fs::Metadata;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;
use crate::inventory::Probed;
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

fn recognised(files: &[&str]) -> Option<(CaptureLayout, String)> {
    let root = device(files);
    recognise(root.path()).map(|found| (found.layout, found.matched))
}

#[test]
fn an_asiair_card_is_recognised_by_its_autorun_and_plan_folders() {
    let found = recognised(&[
        "Autorun/Light/NGC 7000/Light_NGC 7000_300.0s_Bin1_H_gain100_20261002-203000_-10.0C_0001.fit",
        "Plan/",
    ]);
    assert_eq!(found, Some((CaptureLayout::Asiair, "Autorun".into())));
    let nested = recognised(&["ASIAIR/Live/Light/M31/Live_M31_10.0s_0001.fit"]);
    assert_eq!(nested, Some((CaptureLayout::Asiair, "ASIAIR/Live".into())));
}

#[test]
fn a_nina_card_is_recognised_by_its_capitalised_frame_type_folders() {
    let found = recognised(&[
        "2026-10-02/LIGHT/2026-10-02_20-30-00_Ha_-10.00_300.00s_0001.fits",
        "2026-10-02/FLAT/2026-10-02_06-10-00_Ha_-10.00_1.20s_0001.fits",
    ]);
    assert_eq!(found, Some((CaptureLayout::Nina, "2026-10-02/FLAT".into())));
}

#[test]
fn a_sharpcap_card_is_recognised_by_its_captures_folder_or_settings_sidecars() {
    let found = recognised(&[
        "SharpCap Captures/2026-10-02/M31/20_30_00/Capture_00001.fits",
        "SharpCap Captures/2026-10-02/M31/20_30_00/Capture_00001.CameraSettings.txt",
    ]);
    assert_eq!(found, Some((CaptureLayout::SharpCap, "SharpCap Captures".into())));
    let sidecar = recognised(&["M31/Capture_00001.fits", "M31/Capture_00001.CameraSettings.txt"]);
    assert_eq!(
        sidecar,
        Some((CaptureLayout::SharpCap, "M31/Capture_00001.CameraSettings.txt".into()))
    );
}

#[test]
fn an_ekos_card_is_recognised_by_its_frame_names_or_sequence_files() {
    let found =
        recognised(&["NGC7000/Light/Ha/NGC7000_Light_Ha_300_secs_2026-10-02T20-30-00_001.fits"]);
    assert_eq!(
        found,
        Some((
            CaptureLayout::Ekos,
            "NGC7000/Light/Ha/NGC7000_Light_Ha_300_secs_2026-10-02T20-30-00_001.fits".into()
        ))
    );
    let queue = recognised(&["NGC7000.esq", "NGC7000/frame_001.fits"]);
    assert_eq!(queue, Some((CaptureLayout::Ekos, "NGC7000.esq".into())));
}

#[test]
fn an_sgp_card_is_recognised_by_its_sequence_file() {
    let found = recognised(&["NGC7000.sgf", "NGC7000/NGC7000_Ha_300s_frame1.fit"]);
    assert_eq!(found, Some((CaptureLayout::Sgp, "NGC7000.sgf".into())));
}

#[test]
fn a_voyager_card_is_recognised_by_its_frame_names() {
    let name = "NGC7000/NGC7000_LIGHT_Ha_300s_BIN1_-10C_GA100_20261002_203000_001_PA0.00_W.FIT";
    assert_eq!(recognised(&[name]), Some((CaptureLayout::Voyager, name.into())));
    let dark = "Darks/DARK_300s_BIN1_-10C_GA100_20261002_063000_001.fit";
    assert_eq!(recognised(&[dark]), Some((CaptureLayout::Voyager, dark.into())));
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
fn the_most_specific_layout_wins_where_several_match() {
    let found = recognised(&["LIGHT/frame.fits", "SharpCap Captures/"]);
    assert_eq!(found, Some((CaptureLayout::SharpCap, "SharpCap Captures".into())));
    let found = recognised(&["Autorun/", "M31/M31_LIGHT_L_60s_BIN1_x.fit", "x.sgf"]);
    assert_eq!(found, Some((CaptureLayout::Sgp, "x.sgf".into())));
}

#[test]
fn recognition_skips_hidden_and_deep_entries() {
    assert_eq!(recognised(&[".Trashes/LIGHT/", ".Spotlight-V100/x.sgf"]), None);
    assert_eq!(recognised(&["a/b/c/d/LIGHT/frame.fits"]), None, "deeper than the walk reads");
    assert_eq!(
        recognised(&["a/b/c/LIGHT/frame.fits"]),
        Some((CaptureLayout::Nina, "a/b/c/LIGHT".into()))
    );
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

#[test]
fn mac_mount_listings_keep_local_disk_volumes_under_volumes() {
    let listing = "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)\n\
         devfs on /dev (devfs, local, nobrowse)\n\
         /dev/disk4s1 on /Volumes/Card-1 (msdos, local, nodev, nosuid, noowners)\n\
         /dev/disk5s2 on /Volumes/Astro T7 (apfs, local, nodev, nosuid, journaled, noowners)\n\
         //guest@nas.local/astro on /Volumes/astro (smbfs, nodev, nosuid, mounted by me)\n\
         map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)";
    assert_eq!(
        mac_mounts(listing),
        vec![
            Mount { root: "/Volumes/Card-1".into(), instance: "/dev/disk4s1".into() },
            Mount { root: "/Volumes/Astro T7".into(), instance: "/dev/disk5s2".into() },
        ]
    );
}

#[test]
fn linux_mountinfo_keeps_device_mounts_by_mount_id() {
    let mountinfo = "22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw\n\
         25 22 0:5 / /proc rw shared:12 - proc proc rw\n\
         36 22 8:17 / /media/sjors/Card\\0401 rw,nosuid shared:20 - vfat /dev/sdb1 rw,uid=1000\n\
         37 22 0:52 / /mnt/nas rw shared:21 - nfs4 nas:/export/astro rw";
    assert_eq!(
        linux_mounts(mountinfo),
        vec![
            Mount { root: "/".into(), instance: "22".into() },
            Mount { root: "/media/sjors/Card 1".into(), instance: "36".into() },
        ]
    );
}

#[test]
fn drive_roots_are_named_by_their_drive() {
    assert_eq!(device_name(Path::new("/Volumes/Card-1")), "Card-1");
    assert_eq!(device_name(Path::new(r"E:\")), if cfg!(windows) { "E:" } else { r"E:\" });
}

/// The host's table is read without touching any volume; only the parse is
/// asserted, never which volumes this machine has mounted.
#[cfg(any(target_os = "macos", target_os = "linux", windows))]
#[test]
fn this_hosts_mount_table_is_read() {
    let mounts = OsMounts.mounts().expect("the host's mount table");
    assert!(mounts.iter().all(|mount| mount.root.is_absolute() && !mount.instance.is_empty()));
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
    Mount { root: root.to_path_buf(), instance: instance.into() }
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
    let mut expected = vec![
        (device_name(card.path()), Some(CaptureLayout::Asiair)),
        (device_name(generic.path()), None),
    ];
    expected.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(names(&listed), expected);
    let card_device =
        listed.iter().find(|device| device.root == NativePath::from_path(card.path()));
    assert_eq!(card_device.unwrap().layout.as_ref().unwrap().matched, "Autorun");

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
    assert_eq!(names(&listed), vec![(device_name(card.path()), Some(CaptureLayout::Nina))]);
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
    assert_eq!(names(&listed), vec![(device_name(card.path()), Some(CaptureLayout::Sgp))]);

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
    assert_eq!(
        names(&watch.devices()),
        vec![(device_name(card.path()), Some(CaptureLayout::Asiair))]
    );

    rig.table.set(&[]);
    tokio::time::timeout(wait, updates.changed()).await.unwrap().unwrap();
    assert_eq!(watch.devices(), Vec::new());

    watch.shutdown().await;
    rig.table.set(&[&mount(card.path(), "disk5s1")]);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(watch.devices(), Vec::new(), "a stopped watch polls no more");
}
