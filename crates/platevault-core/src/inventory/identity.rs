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

use std::fs::{self, Metadata};
use std::path::Path;
use std::time::SystemTime;

use crate::{FileIdentity, LibraryError, NativePath, PathSensitivity, VolumeIdentity};

/// Root identity plus its same-session continuity stamp.
pub(super) struct RootObservation {
    pub(super) identity: FileIdentity,
    pub(super) stamp: Stamp,
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
/// the working directory. Linked ancestors (such as macOS `/var`) are allowed:
/// the recorded volume and folder ID bind the folder they resolved to, so a
/// retargeted ancestor fails the comparison instead of being trusted.
pub(super) fn observe(root: &Path) -> Result<RootObservation, LibraryError> {
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
    let volume = volume_of(root, &meta)?;
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
    Ok(RootObservation { identity: FileIdentity { volume, file_id }, stamp: stamp(&meta) })
}

/// Qualified remount-stable identity of the volume holding an entry.
pub(super) fn volume_of(path: &Path, meta: &Metadata) -> Result<VolumeIdentity, LibraryError> {
    let volume = probe_volume(path, meta)?;
    volume.validate().map_err(|error| scoped(error, path))?;
    Ok(volume)
}

/// Refuse an observed root that is not the registered volume and folder.
pub(super) fn compare(
    recorded: &FileIdentity,
    observed: &FileIdentity,
    root: &Path,
) -> Result<(), LibraryError> {
    recorded.volume.validate().map_err(|_| {
        scoped(
            LibraryError::IdentityConflict("registered volume identity is unqualified".into()),
            root,
        )
    })?;
    if recorded.volume != observed.volume {
        return Err(scoped(
            LibraryError::IdentityConflict(format!(
                "location volume {} {} is not the registered volume {} {}",
                observed.volume.filesystem,
                observed.volume.stable_id.as_deref().unwrap_or("?"),
                recorded.volume.filesystem,
                recorded.volume.stable_id.as_deref().unwrap_or("?"),
            )),
            root,
        ));
    }
    if !recorded.volume.file_ids_stable
        || recorded.file_id.is_none()
        || recorded.file_id != observed.file_id
    {
        return Err(scoped(
            LibraryError::IdentityConflict(
                "location root folder is not the registered folder".into(),
            ),
            root,
        ));
    }
    Ok(())
}

// ── macOS: df device + diskutil VolumeUUID ───────────────────────────────────

#[cfg(target_os = "macos")]
fn probe_volume(root: &Path, meta: &Metadata) -> Result<VolumeIdentity, LibraryError> {
    use std::os::unix::fs::MetadataExt;
    use std::process::Command;

    const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

    let mut df = Command::new("/bin/df");
    df.arg("-P").arg(root);
    let listing =
        run_bounded(df, TIMEOUT).map_err(|why| unqualified(root, &format!("df {why}")))?;
    let listing = String::from_utf8_lossy(&listing);
    let device = listing
        .lines()
        .nth(1)
        .and_then(|line| line.split_whitespace().next())
        .filter(|device| device.starts_with("/dev/"))
        .ok_or_else(|| unqualified(root, "the volume is not backed by a local disk device"))?;

    let mut diskutil = Command::new("/usr/sbin/diskutil");
    diskutil.args(["info", "-plist"]).arg(device);
    let plist = run_bounded(diskutil, TIMEOUT)
        .map_err(|why| unqualified(root, &format!("diskutil {why}")))?;
    let info = plist_strings(&String::from_utf8_lossy(&plist));
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
    Ok(VolumeIdentity {
        filesystem,
        stable_id: field("VolumeUUID").map(str::to_ascii_uppercase),
        file_ids_stable,
        case,
        normalization,
    })
}

/// Top-level `<key>`/`<string>` pairs of an XML property list.
#[cfg(target_os = "macos")]
fn plist_strings(xml: &str) -> std::collections::BTreeMap<String, String> {
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
            _ if depth == 1 && !name.starts_with('/') => key = None,
            _ => {}
        }
    }
    values
}

// ── Linux: /dev/disk/by-uuid + /proc/self/mountinfo ─────────────────────────

#[cfg(target_os = "linux")]
fn probe_volume(root: &Path, meta: &Metadata) -> Result<VolumeIdentity, LibraryError> {
    use std::os::unix::fs::MetadataExt;

    let device = meta.dev();
    let major = ((device >> 32) & 0xffff_f000) | ((device >> 8) & 0x0000_0fff);
    let minor = ((device >> 12) & 0xffff_ff00) | (device & 0x0000_00ff);
    let wanted = format!("{major}:{minor}");
    let mountinfo = fs::read_to_string("/proc/self/mountinfo")
        .map_err(|error| unqualified(root, &format!("mountinfo {error}")))?;
    let filesystem = mountinfo
        .lines()
        .find_map(|line| {
            let fields: Vec<&str> = line.split(' ').collect();
            if fields.get(2) != Some(&wanted.as_str()) {
                return None;
            }
            let separator = fields.iter().position(|field| *field == "-")?;
            fields.get(separator + 1).map(|kind| kind.to_ascii_lowercase())
        })
        .ok_or_else(|| unqualified(root, "no mount entry describes the root's device"))?;

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
    Ok(VolumeIdentity { filesystem, stable_id, file_ids_stable, case, normalization })
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
if ($null -eq $v) { exit 3 }
@{ fileSystem = $v.FileSystem; serialNumber = $v.SerialNumber } | ConvertTo-Json -Compress";

#[cfg(windows)]
fn probe_volume(root: &Path, _meta: &Metadata) -> Result<VolumeIdentity, LibraryError> {
    use std::process::Command;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Volume {
        file_system: Option<String>,
        serial_number: Option<u32>,
    }

    let system_root =
        std::env::var_os("SystemRoot").ok_or_else(|| unqualified(root, "SystemRoot is not set"))?;
    let shell = Path::new(&system_root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
    let mut query = Command::new(shell);
    query
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_VOLUME_QUERY])
        .env("PLATEVAULT_IDENTITY_PATH", root);
    let output = run_bounded(query, std::time::Duration::from_secs(30))
        .map_err(|why| unqualified(root, &format!("Win32_Volume query {why}")))?;
    let volume: Volume = serde_json::from_slice(output.trim_ascii())
        .map_err(|error| unqualified(root, &format!("Win32_Volume answer {error}")))?;
    let filesystem = volume.file_system.unwrap_or_default().trim().to_ascii_lowercase();
    let stable_id = volume.serial_number.map(|serial| format!("{serial:08X}"));

    // The CIM answer must describe the volume the entry itself is on: the
    // no-follow handle's serial has to agree with it.
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
    Ok(VolumeIdentity {
        file_ids_stable: filesystem == "ntfs",
        filesystem,
        stable_id,
        case,
        normalization,
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
fn probe_volume(root: &Path, _meta: &Metadata) -> Result<VolumeIdentity, LibraryError> {
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
