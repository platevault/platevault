// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Read-only, remount-stable volume and root identity probes.
//!
//! Device numbers and mount paths are session-local, so they never become
//! stable identity; they only provide same-session continuity [`Stamp`]s and
//! nested-volume boundaries. Each platform asks the operating system for the
//! volume UUID or serial through a bounded read-only query. Anything that
//! cannot be qualified fails closed with `IdentityConflict`.
//!
//! A root folder is qualified only by a remount-stable file ID that no other
//! live entry on the volume can hold: APFS/HFS+ object IDs, ext*/XFS/btrfs/
//! F2FS inode numbers and NTFS file reference numbers (which embed a reuse
//! sequence). FAT, `exFAT` and `ReFS` (whose 128-bit IDs have no safe query here)
//! cannot qualify a folder, so their roots are refused. An ext*/XFS inode can
//! be reused once the original folder is deleted; that residual is not
//! claimed as collision proof.
//!
//! A network share the OS already mounted is identified by the server and
//! share it was mounted from. Its folders qualify only through server file IDs:
//! NFS and AFP keep them, an SMB server must report them, and `WebDAV` never
//! does. Every probe also reports whether the volume is local, removable or a
//! network share (LIB-FR-01, LIB-FR-19).

use std::fs::{self, Metadata};
use std::path::Path;
use std::time::SystemTime;

use crate::{
    FileIdentity, LibraryError, Location, NativePath, PathSensitivity, VolumeIdentity, VolumeKind,
    NETWORK_ADDRESS_REFUSED,
};

/// Root identity plus its same-session continuity stamp.
pub(super) struct RootObservation {
    pub(super) identity: FileIdentity,
    pub(super) stamp: Stamp,
    /// The kind of volume the root is on.
    pub(super) kind: VolumeKind,
}

/// A qualified volume and the kind of volume it is.
struct Probed {
    volume: VolumeIdentity,
    kind: VolumeKind,
}

/// Same-session continuity evidence for one directory entry.
///
/// Unix compares device and inode numbers; other platforms compare the
/// creation time because stable Rust exposes no file index there. A stamp is
/// never persisted or used as remount identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Stamp {
    device: Option<u64>,
    file: Option<u64>,
    created: Option<SystemTime>,
}

impl Stamp {
    /// Whether two entries live on the same mounted volume. Platforms without
    /// device numbers surface mounted folders as reparse points instead, which
    /// the walker never follows.
    pub(super) fn same_device(&self, other: &Self) -> bool {
        self.device == other.device
    }
}

pub(super) fn stamp(meta: &Metadata) -> Stamp {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Stamp { device: Some(meta.dev()), file: Some(meta.ino()), created: None }
    }
    #[cfg(not(unix))]
    {
        Stamp { device: None, file: None, created: meta.created().ok() }
    }
}

/// Remount-stable file ID of an entry, recorded only where the volume
/// qualifies its file IDs as stable.
///
/// Unix uses the decimal inode number. Windows opens the entry itself (never
/// a reparse target) and uses the 64-bit file index as 16 hex digits after
/// checking the handle's volume serial against the qualified volume.
// Only the Windows branch can fail; the shared signature keeps callers uniform.
#[cfg_attr(unix, allow(clippy::unnecessary_wraps))]
pub(super) fn file_id(
    path: &Path,
    meta: &Metadata,
    volume: &VolumeIdentity,
) -> std::io::Result<Option<String>> {
    if !volume.file_ids_stable {
        return Ok(None);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = path;
        Ok(Some(meta.ino().to_string()))
    }
    #[cfg(windows)]
    {
        let info = windows_handle::information(path)?;
        if Some(windows_handle::serial(&info)) != volume.stable_id {
            return Err(std::io::Error::other("entry is not on the qualified volume"));
        }
        if !meta.is_dir() && info.file_size() != meta.len() {
            return Err(std::io::Error::other("entry changed while its file ID was read"));
        }
        Ok(Some(format!("{:016X}", info.file_index())))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, meta);
        Err(std::io::Error::from(std::io::ErrorKind::Unsupported))
    }
}

pub(super) fn scoped(error: LibraryError, path: &Path) -> LibraryError {
    LibraryError::Context {
        error: Box::new(error),
        scope: NativePath::from_path(path),
        identity: None,
    }
}

fn unqualified(root: &Path, why: &str) -> LibraryError {
    scoped(LibraryError::IdentityConflict(format!("volume identity is unqualified: {why}")), root)
}

/// Observe the identity of a location root without following a link.
///
/// The root must be absolute without `..`, so its meaning never depends on
/// the working directory, and a folder rather than an SMB or URL address:
/// `PlateVault` mounts nothing, so it never touches such an address. Linked
/// ancestors (such as macOS `/var`) are allowed: the recorded volume and folder
/// ID bind the folder they resolved to, so a retargeted ancestor fails the
/// comparison instead of being trusted.
pub(super) fn observe(root: &Path) -> Result<RootObservation, LibraryError> {
    if NativePath::from_path(root).is_network_address() {
        return Err(scoped(LibraryError::InvalidInput(NETWORK_ADDRESS_REFUSED.into()), root));
    }
    if !root.is_absolute()
        || root.components().any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(scoped(
            LibraryError::InvalidInput("location root must be an absolute path without ..".into()),
            root,
        ));
    }
    let meta = fs::symlink_metadata(root).map_err(|error| {
        let error = match error.kind() {
            std::io::ErrorKind::NotFound => LibraryError::SourceUnavailable(
                "location root is not present; its volume may be offline".into(),
            ),
            std::io::ErrorKind::PermissionDenied => LibraryError::AccessDenied(error.to_string()),
            _ => LibraryError::SourceUnavailable(error.to_string()),
        };
        scoped(error, root)
    })?;
    if fs_pathsafe::is_link_or_junction_metadata(&meta) {
        return Err(scoped(
            LibraryError::InvalidInput(
                "location root is a link or junction; links are not followed".into(),
            ),
            root,
        ));
    }
    if !meta.is_dir() {
        return Err(scoped(
            LibraryError::IdentityConflict("location root is not a directory".into()),
            root,
        ));
    }
    let Probed { volume, kind } = probe(root, &meta)?;
    let file_id = file_id(root, &meta, &volume)
        .map_err(|error| unqualified(root, &format!("root folder ID {error}")))?;
    if file_id.is_none() {
        return Err(scoped(
            LibraryError::IdentityConflict(format!(
                "the {} filesystem has no remount-stable folder ID; a replacement folder \
                 at this path could not be told apart, so it cannot be a location root",
                volume.filesystem
            )),
            root,
        ));
    }
    Ok(RootObservation { identity: FileIdentity { volume, file_id }, stamp: stamp(&meta), kind })
}

/// Qualified remount-stable identity of the volume holding an entry.
pub(super) fn volume_of(path: &Path, meta: &Metadata) -> Result<VolumeIdentity, LibraryError> {
    probe(path, meta).map(|probed| probed.volume)
}

fn probe(path: &Path, meta: &Metadata) -> Result<Probed, LibraryError> {
    let probed = probe_volume(path, meta)?;
    probed.volume.validate().map_err(|error| scoped(error, path))?;
    Ok(probed)
}

/// Refuse an observed root that is not the registered volume and folder.
///
/// A network location whose folder now resolves onto a volume that is not a
/// network share reads Offline instead (`SourceUnavailable`): its share is not
/// mounted, and a folder left at the mount point says nothing about the share's
/// files (LIB-FR-19).
pub(super) fn compare(
    location: &Location,
    observed: &RootObservation,
    root: &Path,
) -> Result<(), LibraryError> {
    let recorded = &location.identity;
    recorded.volume.validate().map_err(|_| {
        scoped(
            LibraryError::IdentityConflict("registered volume identity is unqualified".into()),
            root,
        )
    })?;
    let refusal = if recorded.volume != observed.identity.volume {
        format!(
            "location volume {} {} is not the registered volume {} {}",
            observed.identity.volume.filesystem,
            observed.identity.volume.stable_id.as_deref().unwrap_or("?"),
            recorded.volume.filesystem,
            recorded.volume.stable_id.as_deref().unwrap_or("?"),
        )
    } else if !recorded.volume.file_ids_stable
        || recorded.file_id.is_none()
        || recorded.file_id != observed.identity.file_id
    {
        "location root folder is not the registered folder".into()
    } else {
        return Ok(());
    };
    if share_unmounted(location.volume_kind, observed.kind) {
        return Err(scoped(LibraryError::SourceUnavailable(SHARE_UNMOUNTED.into()), root));
    }
    Err(scoped(LibraryError::IdentityConflict(refusal), root))
}

pub(super) const SHARE_UNMOUNTED: &str =
    "the network share of this location is not mounted; its folder is not on a network volume";

/// A network location observed on a volume that is not a network share: the
/// share is unmounted, so the location reads Offline, never Missing.
pub(super) fn share_unmounted(registered: VolumeKind, observed: VolumeKind) -> bool {
    registered == VolumeKind::Network && observed != VolumeKind::Network
}

// ── macOS: statfs, then diskutil VolumeUUID or the mounted share ─────────────

#[cfg(any(target_os = "macos", test))]
const MNT_LOCAL: u32 = 0x0000_1000;

#[cfg(target_os = "macos")]
fn probe_volume(root: &Path, meta: &Metadata) -> Result<Probed, LibraryError> {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;
    use std::process::Command;

    const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

    fn text(field: &[std::ffi::c_char]) -> Vec<u8> {
        field.iter().map(|byte| byte.to_ne_bytes()[0]).take_while(|byte| *byte != 0).collect()
    }

    let stat =
        rustix::fs::statfs(root).map_err(|error| unqualified(root, &format!("statfs {error}")))?;
    let fstype = String::from_utf8_lossy(&text(&stat.f_fstypename)).to_ascii_lowercase();
    let source = String::from_utf8_lossy(&text(&stat.f_mntfromname)).into_owned();
    let mount_point = text(&stat.f_mntonname);
    let mount_point = Path::new(std::ffi::OsStr::from_bytes(&mount_point));
    let mounted = fs::symlink_metadata(mount_point)
        .map_err(|error| unqualified(root, &format!("mount point {error}")))?;
    if mounted.dev() != meta.dev() {
        return Err(unqualified(root, "the mount does not hold the root's volume"));
    }

    if stat.f_flags & MNT_LOCAL == 0 {
        let smb_server_file_ids = || {
            let mut statshares = Command::new("/usr/bin/smbutil");
            statshares.args(["statshares", "-m"]).arg(mount_point);
            run_bounded(statshares, TIMEOUT)
                .is_ok_and(|listing| smb_file_ids(&String::from_utf8_lossy(&listing)))
        };
        let volume = mac_share(&fstype, &source, smb_server_file_ids).ok_or_else(|| {
            unqualified(
                root,
                &format!("the {fstype} network volume has no remount-stable identity"),
            )
        })?;
        return Ok(Probed { volume, kind: VolumeKind::Network });
    }
    if !source.starts_with("/dev/") {
        return Err(unqualified(root, "the volume is not backed by a local disk device"));
    }

    let mut diskutil = Command::new("/usr/sbin/diskutil");
    diskutil.args(["info", "-plist"]).arg(&source);
    let plist = run_bounded(diskutil, TIMEOUT)
        .map_err(|why| unqualified(root, &format!("diskutil {why}")))?;
    let info = plist_values(&String::from_utf8_lossy(&plist));
    let field =
        |name: &str| info.get(name).map(|value| value.trim()).filter(|value| !value.is_empty());

    // The answer must describe the volume the root lives on, not merely a
    // volume that once had this device node.
    let mount =
        field("MountPoint").ok_or_else(|| unqualified(root, "disk info names no mount point"))?;
    let mounted = fs::symlink_metadata(mount)
        .map_err(|error| unqualified(root, &format!("mount point {error}")))?;
    if mounted.dev() != meta.dev() {
        return Err(unqualified(root, "disk info does not describe the root's volume"));
    }

    let filesystem = field("FilesystemType").map(str::to_ascii_lowercase).unwrap_or_default();
    let personality = format!(
        "{} {}",
        field("FilesystemName").unwrap_or_default(),
        field("FilesystemUserVisibleName").unwrap_or_default()
    )
    .to_ascii_lowercase();
    let case_sensitive = personality.contains("case-sensitive");
    let (file_ids_stable, case, normalization) = match filesystem.as_str() {
        "apfs" | "hfs" => (
            true,
            if case_sensitive { PathSensitivity::Sensitive } else { PathSensitivity::Insensitive },
            PathSensitivity::Insensitive,
        ),
        "msdos" | "exfat" => (false, PathSensitivity::Insensitive, PathSensitivity::Unknown),
        _ => (false, PathSensitivity::Unknown, PathSensitivity::Unknown),
    };
    Ok(Probed {
        volume: VolumeIdentity {
            filesystem,
            stable_id: field("VolumeUUID").map(str::to_ascii_uppercase),
            file_ids_stable,
            case,
            normalization,
        },
        kind: mac_disk_kind(&info),
    })
}

/// A share macOS mounted, identified by the server and share it came from.
/// NFS and AFP keep server file IDs; an SMB server qualifies its folders only
/// when it reports file IDs, and `WebDAV` never does. Path case is unknown.
#[cfg(any(target_os = "macos", test))]
fn mac_share(
    fstype: &str,
    source: &str,
    smb_server_file_ids: impl FnOnce() -> bool,
) -> Option<VolumeIdentity> {
    let (scheme, file_ids_stable) = match fstype {
        "smbfs" => ("smb", smb_server_file_ids()),
        "afpfs" => ("afp", true),
        "nfs" => ("nfs", true),
        "webdav" => ("webdav", false),
        _ => return None,
    };
    Some(VolumeIdentity {
        stable_id: Some(share_address(scheme, source)?),
        filesystem: fstype.to_owned(),
        file_ids_stable,
        case: PathSensitivity::Unknown,
        normalization: PathSensitivity::Unknown,
    })
}

/// Whether `smbutil statshares` reports that the server keeps file IDs.
#[cfg(any(target_os = "macos", test))]
fn smb_file_ids(listing: &str) -> bool {
    listing.lines().any(|line| {
        let mut words = line.split_whitespace().skip_while(|word| *word != "FILE_IDS_SUPPORTED");
        words.next().is_some()
            && words.next().is_some_and(|value| value.eq_ignore_ascii_case("true"))
    })
}

/// An external, ejectable or removable-media disk reads removable.
#[cfg(any(target_os = "macos", test))]
fn mac_disk_kind(info: &std::collections::BTreeMap<String, String>) -> VolumeKind {
    let is = |key: &str, value: &str| info.get(key).is_some_and(|found| found == value);
    if is("RemovableMediaOrExternalDevice", "true")
        || is("RemovableMedia", "true")
        || is("Ejectable", "true")
        || is("Internal", "false")
    {
        VolumeKind::Removable
    } else {
        VolumeKind::Local
    }
}

/// Top-level `<key>`/`<string>` pairs of an XML property list, and its
/// booleans as `"true"`/`"false"`.
#[cfg(any(target_os = "macos", test))]
fn plist_values(xml: &str) -> std::collections::BTreeMap<String, String> {
    fn unescape(text: &str) -> String {
        text.replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&")
    }

    let mut values = std::collections::BTreeMap::new();
    let mut depth = 0_usize;
    let mut key: Option<String> = None;
    let mut rest = xml;
    while let Some(open) = rest.find('<') {
        rest = &rest[open + 1..];
        let Some(close) = rest.find('>') else { break };
        let tag = &rest[..close];
        rest = &rest[close + 1..];
        let empty = tag.ends_with('/');
        let name = tag.trim_end_matches('/').split_whitespace().next().unwrap_or_default();
        match name {
            "dict" | "array" => {
                key = None;
                if !empty {
                    depth += 1;
                }
            }
            "/dict" | "/array" => depth = depth.saturating_sub(1),
            "key" | "string" if depth == 1 => {
                let text = if empty {
                    ""
                } else {
                    let end = format!("</{name}>");
                    let Some(length) = rest.find(&end) else { break };
                    let text = &rest[..length];
                    rest = &rest[length + end.len()..];
                    text
                };
                if name == "key" {
                    key = Some(unescape(text));
                } else if let Some(key) = key.take() {
                    values.insert(key, unescape(text));
                }
            }
            "true" | "false" if depth == 1 && empty => {
                if let Some(key) = key.take() {
                    values.insert(key, name.to_owned());
                }
            }
            _ if depth == 1 && !name.starts_with('/') => key = None,
            _ => {}
        }
    }
    values
}

// ── Linux: /dev/disk/by-uuid + /proc/self/mountinfo ─────────────────────────

#[cfg(target_os = "linux")]
fn probe_volume(root: &Path, meta: &Metadata) -> Result<Probed, LibraryError> {
    use std::os::unix::fs::MetadataExt;

    let device = meta.dev();
    let major = ((device >> 32) & 0xffff_f000) | ((device >> 8) & 0x0000_0fff);
    let minor = ((device >> 12) & 0xffff_ff00) | (device & 0x0000_00ff);
    let wanted = format!("{major}:{minor}");
    let mountinfo = fs::read_to_string("/proc/self/mountinfo")
        .map_err(|error| unqualified(root, &format!("mountinfo {error}")))?;
    let mount = mountinfo
        .lines()
        .find_map(|line| mount_entry(line, &wanted))
        .ok_or_else(|| unqualified(root, "no mount entry describes the root's device"))?;
    if let Some(volume) = linux_share(&mount) {
        return Ok(Probed { volume, kind: VolumeKind::Network });
    }
    let filesystem = mount.filesystem;

    let mut stable_id = None;
    let links = fs::read_dir("/dev/disk/by-uuid")
        .map_err(|error| unqualified(root, &format!("/dev/disk/by-uuid {error}")))?;
    for link in links.flatten() {
        if fs::metadata(link.path()).is_ok_and(|node| node.rdev() == device) {
            stable_id = link.file_name().to_str().map(str::to_ascii_lowercase);
            break;
        }
    }

    let (file_ids_stable, case, normalization) = match filesystem.as_str() {
        "ext2" | "ext3" | "ext4" | "xfs" | "btrfs" | "f2fs" => {
            (true, PathSensitivity::Sensitive, PathSensitivity::Sensitive)
        }
        "vfat" | "exfat" => (false, PathSensitivity::Insensitive, PathSensitivity::Unknown),
        _ => (false, PathSensitivity::Unknown, PathSensitivity::Unknown),
    };
    // A USB disk or a disk the kernel flags removable; partitions inherit it.
    let kind =
        fs::canonicalize(format!("/sys/dev/block/{wanted}")).map_or(VolumeKind::Local, |node| {
            let flag = |dir: &Path| fs::read_to_string(dir.join("removable")).ok();
            let removable = flag(&node).or_else(|| node.parent().and_then(flag));
            sysfs_kind(&node.to_string_lossy(), removable.as_deref())
        });
    Ok(Probed {
        volume: VolumeIdentity { filesystem, stable_id, file_ids_stable, case, normalization },
        kind,
    })
}

/// One `/proc/self/mountinfo` entry: file system type, source and super options.
#[cfg(any(target_os = "linux", test))]
struct MountEntry {
    filesystem: String,
    source: String,
    options: String,
}

/// The entry of the mount with `device` (`major:minor`), if this line is it.
#[cfg(any(target_os = "linux", test))]
fn mount_entry(line: &str, device: &str) -> Option<MountEntry> {
    let fields: Vec<&str> = line.split(' ').collect();
    if fields.get(2) != Some(&device) {
        return None;
    }
    let separator = fields.iter().position(|field| *field == "-")?;
    let field = |offset: usize| fields.get(separator + offset).copied().unwrap_or_default();
    Some(MountEntry {
        filesystem: field(1).to_ascii_lowercase(),
        source: field(2).to_owned(),
        options: field(3).to_owned(),
    })
}

/// A mounted NFS or SMB share, identified by the server and share it was
/// mounted from. Server inode numbers qualify NFS folders; SMB folders qualify
/// only with `serverino`, the server's file IDs, instead of client-made ones.
#[cfg(any(target_os = "linux", test))]
fn linux_share(mount: &MountEntry) -> Option<VolumeIdentity> {
    let (scheme, file_ids_stable) = match mount.filesystem.as_str() {
        "nfs" | "nfs4" => ("nfs", true),
        "cifs" | "smb3" | "smbfs" => {
            ("smb", mount.options.split(',').any(|option| option == "serverino"))
        }
        _ => return None,
    };
    Some(VolumeIdentity {
        stable_id: Some(share_address(scheme, &mount.source)?),
        filesystem: mount.filesystem.clone(),
        file_ids_stable,
        case: PathSensitivity::Unknown,
        normalization: PathSensitivity::Unknown,
    })
}

#[cfg(any(target_os = "linux", test))]
fn sysfs_kind(node: &str, removable: Option<&str>) -> VolumeKind {
    if node.contains("/usb") || removable.is_some_and(|flag| flag.trim() == "1") {
        VolumeKind::Removable
    } else {
        VolumeKind::Local
    }
}

/// The server and share a network volume was mounted from, without the user it
/// was mounted as, so it stays the same across remounts. SMB and AFP names are
/// case-insensitive; NFS export paths keep their case.
#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn share_address(scheme: &str, source: &str) -> Option<String> {
    let source = source.trim().replace('\\', "/");
    let authority_path = |rest: &str| match rest.split_once('/') {
        Some((authority, path)) => (authority.to_owned(), format!("/{path}")),
        None => (rest.to_owned(), String::new()),
    };
    let (authority, path) = if let Some((_, rest)) = source.split_once("://") {
        authority_path(rest)
    } else if let Some(rest) = source.strip_prefix("//") {
        authority_path(rest)
    } else {
        let (host, path) = source.split_once(":/")?;
        (host.to_owned(), format!("/{path}"))
    };
    let host = authority.rsplit_once('@').map_or(authority.as_str(), |(_, host)| host);
    if host.is_empty() {
        return None;
    }
    let path = path.trim_end_matches('/');
    let path = if matches!(scheme, "smb" | "afp") { path.to_lowercase() } else { path.to_owned() };
    Some(format!("{scheme}://{}{path}", host.to_ascii_lowercase()))
}

// ── Windows: Win32_Volume serial via bounded PowerShell CIM query ────────────

#[cfg(windows)]
const WINDOWS_VOLUME_QUERY: &str = r"$ErrorActionPreference = 'Stop'
$p = $env:PLATEVAULT_IDENTITY_PATH
if ($p.StartsWith('\\?\UNC\')) { exit 3 }
if ($p.StartsWith('\\?\')) { $p = $p.Substring(4) }
$p = [System.IO.Path]::GetFullPath($p)
if (-not $p.EndsWith('\')) { $p = $p + '\' }
$v = Get-CimInstance -ClassName Win32_Volume |
  Where-Object { $_.Name -and $p.StartsWith($_.Name, [System.StringComparison]::OrdinalIgnoreCase) } |
  Sort-Object -Property { $_.Name.Length } -Descending |
  Select-Object -First 1
if ($null -ne $v) {
  @{ fileSystem = $v.FileSystem; serialNumber = $v.SerialNumber; driveType = $v.DriveType } | ConvertTo-Json -Compress
  exit 0
}
$d = Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType = 4' |
  Where-Object { $_.DeviceID -and $_.VolumeSerialNumber -and $p.StartsWith($_.DeviceID + '\', [System.StringComparison]::OrdinalIgnoreCase) } |
  Select-Object -First 1
if ($null -eq $d) { exit 3 }
@{ fileSystem = $d.FileSystem; serialNumber = [Convert]::ToUInt32($d.VolumeSerialNumber, 16); driveType = 4 } | ConvertTo-Json -Compress";

/// Win32 drive type: 2 removable, 4 network (a mapped share), 5 optical.
#[cfg(any(windows, test))]
const fn windows_kind(drive_type: Option<u32>) -> VolumeKind {
    match drive_type {
        Some(2 | 5) => VolumeKind::Removable,
        Some(4) => VolumeKind::Network,
        _ => VolumeKind::Local,
    }
}

#[cfg(windows)]
fn probe_volume(root: &Path, _meta: &Metadata) -> Result<Probed, LibraryError> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    /// The desktop release build is a GUI-subsystem process; without this
    /// flag every console child it spawns opens a visible console window.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Volume {
        file_system: Option<String>,
        serial_number: Option<u32>,
        drive_type: Option<u32>,
    }

    let system_root =
        std::env::var_os("SystemRoot").ok_or_else(|| unqualified(root, "SystemRoot is not set"))?;
    let shell = Path::new(&system_root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    let mut query = Command::new(shell);
    query
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_VOLUME_QUERY])
        .env("PLATEVAULT_IDENTITY_PATH", root)
        .creation_flags(CREATE_NO_WINDOW);
    let output = run_bounded(query, std::time::Duration::from_secs(30))
        .map_err(|why| unqualified(root, &format!("Win32_Volume query {why}")))?;
    let volume: Volume = serde_json::from_slice(output.trim_ascii())
        .map_err(|error| unqualified(root, &format!("Win32_Volume answer {error}")))?;
    let filesystem = volume.file_system.unwrap_or_default().trim().to_ascii_lowercase();
    let stable_id = volume.serial_number.map(|serial| format!("{serial:08X}"));

    // The CIM answer must describe the volume the entry itself is on: the
    // no-follow handle's serial has to agree with it. A mapped network drive
    // reports the serial its server gives the share.
    let info = windows_handle::information(root)
        .map_err(|error| unqualified(root, &format!("volume handle {error}")))?;
    if stable_id.as_deref() != Some(windows_handle::serial(&info).as_str()) {
        return Err(unqualified(root, "Win32_Volume does not describe the entry's volume"));
    }

    // Windows stores names without Unicode normalization and compares case
    // insensitively on these filesystems. Only NTFS file reference numbers
    // (64-bit, with a reuse sequence) qualify as stable file IDs; ReFS uses
    // 128-bit IDs and FAT/exFAT derive IDs from directory-entry positions.
    let (case, normalization) = match filesystem.as_str() {
        "ntfs" | "refs" | "fat" | "fat32" | "exfat" => {
            (PathSensitivity::Insensitive, PathSensitivity::Sensitive)
        }
        _ => (PathSensitivity::Unknown, PathSensitivity::Unknown),
    };
    Ok(Probed {
        volume: VolumeIdentity {
            file_ids_stable: filesystem == "ntfs",
            filesystem,
            stable_id,
            case,
            normalization,
        },
        kind: windows_kind(volume.drive_type),
    })
}

/// No-follow handle queries through the safe `winapi-util` wrapper.
#[cfg(windows)]
mod windows_handle {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::Path;

    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u64 = 0x0400;

    /// `GetFileInformationByHandle` for the entry itself, never a reparse
    /// target, opened without read or write access.
    pub(super) fn information(path: &Path) -> std::io::Result<winapi_util::file::Information> {
        let handle = OpenOptions::new()
            .access_mode(0)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)?;
        let info = winapi_util::file::information(&handle)?;
        if info.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "entry is a reparse point; links and junctions are not followed",
            ));
        }
        Ok(info)
    }

    /// Volume serial in the `Win32_Volume.SerialNumber` encoding.
    pub(super) fn serial(info: &winapi_util::file::Information) -> String {
        format!("{:08X}", info.volume_serial_number())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn probe_volume(root: &Path, _meta: &Metadata) -> Result<Probed, LibraryError> {
    Err(unqualified(root, "no stable volume identity probe exists for this platform"))
}

/// Run a read-only system query with a deadline; stdout only, capped at 1 MiB.
#[cfg(any(target_os = "macos", windows))]
fn run_bounded(
    mut command: std::process::Command,
    timeout: std::time::Duration,
) -> Result<Vec<u8>, String> {
    use std::io::Read;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| format!("could not start: {error}"))?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("produced no output pipe".into());
    };
    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        stdout.take(1 << 20).read_to_end(&mut output).map(|_| output)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(5)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("did not answer within {} s", timeout.as_secs()));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.to_string());
            }
        }
    };
    let output = reader
        .join()
        .map_err(|_| "output reader panicked".to_owned())?
        .map_err(|error| format!("output unreadable: {error}"))?;
    if !status.success() {
        return Err(format!("exited with {status}"));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mounted_shares_are_identified_by_server_and_share_without_the_user() {
        let smb = mac_share("smbfs", "//Astro@NAS.local/Captures", || true).unwrap();
        assert_eq!(smb.stable_id.as_deref(), Some("smb://nas.local/captures"));
        assert!(smb.file_ids_stable);
        assert_eq!(smb.case, PathSensitivity::Unknown);
        let other_user = mac_share("smbfs", "//guest;WORK@nas.local/CAPTURES/", || true).unwrap();
        assert_eq!(
            other_user.stable_id, smb.stable_id,
            "a remount as another user is the same share"
        );
        assert!(!mac_share("smbfs", "//nas/Captures", || false).unwrap().file_ids_stable);
        let nfs = mac_share("nfs", "NAS:/export/Astro", || unreachable!()).unwrap();
        assert_eq!(nfs.stable_id.as_deref(), Some("nfs://nas/export/Astro"));
        assert!(nfs.file_ids_stable);
        let dav = mac_share("webdav", "https://user@nas.local/dav/", || unreachable!()).unwrap();
        assert_eq!(dav.stable_id.as_deref(), Some("webdav://nas.local/dav"));
        assert!(!dav.file_ids_stable, "WebDAV folder IDs are made per mount");
        assert!(mac_share("autofs", "map auto_home", || true).is_none());
        assert_eq!(share_address("smb", "//@/x"), None);
    }

    #[test]
    fn smb_servers_qualify_folders_only_when_they_report_file_ids() {
        let listing = "==========\nSHARE   ATTRIBUTE TYPE   VALUE\n==========\nCaptures\n  \
                       SERVER_NAME   nas.local\n  FILE_IDS_SUPPORTED   TRUE\n";
        assert!(smb_file_ids(listing));
        assert!(!smb_file_ids(&listing.replace("TRUE", "FALSE")));
        assert!(!smb_file_ids("Captures\n  SERVER_NAME nas.local\n"));
    }

    #[test]
    fn macos_disk_info_classifies_removable_and_internal_disks() {
        let plist = "<plist><dict><key>Internal</key><true/><key>RemovableMedia</key><false/>\
                     <key>VolumeUUID</key><string>ABC</string><key>Nested</key><dict>\
                     <key>Internal</key><false/></dict></dict></plist>";
        let info = plist_values(plist);
        assert_eq!(info.get("Internal").map(String::as_str), Some("true"));
        assert_eq!(info.get("VolumeUUID").map(String::as_str), Some("ABC"));
        assert_eq!(mac_disk_kind(&info), VolumeKind::Local);
        let external = plist_values(&plist.replacen("<true/>", "<false/>", 1));
        assert_eq!(mac_disk_kind(&external), VolumeKind::Removable);
        let card = plist_values(
            &plist.replace("<key>RemovableMedia</key><false/>", "<key>RemovableMedia</key><true/>"),
        );
        assert_eq!(mac_disk_kind(&card), VolumeKind::Removable);
        assert_eq!(MNT_LOCAL, 0x1000);
    }

    #[test]
    fn linux_mountinfo_names_network_shares_and_removable_disks() {
        let nfs = "36 25 0:52 / /mnt/nas rw,relatime shared:1 - nfs4 nas:/export/astro rw,vers=4.2";
        let entry = mount_entry(nfs, "0:52").unwrap();
        assert!(mount_entry(nfs, "0:53").is_none());
        let share = linux_share(&entry).unwrap();
        assert_eq!(share.stable_id.as_deref(), Some("nfs://nas/export/astro"));
        assert!(share.file_ids_stable);
        let cifs = "40 25 0:60 / /mnt/smb rw - cifs //NAS/Astro rw,vers=3.1.1,serverino,mapposix";
        let share = linux_share(&mount_entry(cifs, "0:60").unwrap()).unwrap();
        assert_eq!(share.stable_id.as_deref(), Some("smb://nas/astro"));
        assert!(share.file_ids_stable);
        let client_ids = cifs.replace("serverino", "noserverino");
        assert!(!linux_share(&mount_entry(&client_ids, "0:60").unwrap()).unwrap().file_ids_stable);
        let ext4 = "29 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw,errors=remount-ro";
        assert!(linux_share(&mount_entry(ext4, "8:1").unwrap()).is_none());

        let usb = "/sys/devices/pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host0/block/sdb/sdb1";
        assert_eq!(sysfs_kind(usb, Some("0\n")), VolumeKind::Removable);
        assert_eq!(
            sysfs_kind("/sys/devices/virtual/block/mmcblk0/mmcblk0p1", Some("1\n")),
            VolumeKind::Removable
        );
        assert_eq!(
            sysfs_kind("/sys/devices/pci0000:00/nvme/nvme0n1/nvme0n1p2", Some("0\n")),
            VolumeKind::Local
        );
        assert_eq!(sysfs_kind("/sys/devices/pci0000:00/nvme0n1", None), VolumeKind::Local);
    }

    #[test]
    fn windows_drive_types_name_removable_and_mapped_network_drives() {
        assert_eq!(windows_kind(Some(3)), VolumeKind::Local);
        assert_eq!(windows_kind(Some(2)), VolumeKind::Removable);
        assert_eq!(windows_kind(Some(4)), VolumeKind::Network);
        assert_eq!(windows_kind(None), VolumeKind::Local);
    }

    fn observation(stable_id: &str, kind: VolumeKind) -> RootObservation {
        let meta = fs::symlink_metadata(std::env::temp_dir()).unwrap();
        RootObservation {
            identity: FileIdentity {
                volume: VolumeIdentity {
                    filesystem: "smbfs".into(),
                    stable_id: Some(stable_id.into()),
                    file_ids_stable: true,
                    case: PathSensitivity::Unknown,
                    normalization: PathSensitivity::Unknown,
                },
                file_id: Some("7".into()),
            },
            stamp: stamp(&meta),
            kind,
        }
    }

    #[test]
    fn an_unmounted_share_reads_offline_and_another_share_conflicts() {
        let registered = observation("smb://nas/astro", VolumeKind::Network);
        let location = Location {
            id: uuid::Uuid::new_v4(),
            name: "NAS".into(),
            path: NativePath::from_path(Path::new("/mnt/nas")),
            role: crate::LocationRole::Captures,
            identity: registered.identity.clone(),
            decision_revision: 1,
            availability: crate::Availability::Available,
            last_observed_at: None,
            lifecycle: crate::LocationLifecycle::Active,
            volume_kind: VolumeKind::Network,
        };
        let root = Path::new("/mnt/nas");
        assert!(compare(&location, &registered, root).is_ok());
        let kind = |error: LibraryError| error.response(None, None).kind;

        // The mount point folder left on the local disk: the share is unmounted.
        let mut left_behind = observation("LOCAL-UUID", VolumeKind::Local);
        left_behind.identity.volume.filesystem = "apfs".into();
        assert_eq!(kind(compare(&location, &left_behind, root).unwrap_err()), "source_unavailable");
        // Another share mounted there, or another folder on the share, is a conflict.
        let other = observation("smb://nas/other", VolumeKind::Network);
        assert_eq!(kind(compare(&location, &other, root).unwrap_err()), "identity_conflict");
        let mut replaced = observation("smb://nas/astro", VolumeKind::Network);
        replaced.identity.file_id = Some("8".into());
        assert_eq!(kind(compare(&location, &replaced, root).unwrap_err()), "identity_conflict");
        // A local location never reads a changed volume as merely offline.
        let local = Location { volume_kind: VolumeKind::Removable, ..location };
        assert_eq!(kind(compare(&local, &left_behind, root).unwrap_err()), "identity_conflict");
        assert!(!share_unmounted(VolumeKind::Local, VolumeKind::Local));
    }

    #[test]
    fn share_addresses_are_refused_before_the_filesystem_is_touched() {
        for address in ["smb://nas/astro", "//nas/astro", "afp://nas/astro"] {
            let refused = observe(Path::new(address)).err().unwrap();
            assert_eq!(refused.response(None, None).kind, "invalid_input", "{address}");
            assert!(refused.to_string().contains("mounts no share"), "{address}: {refused}");
        }
    }
}
