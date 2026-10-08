// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! OS Trash adapter (STO-FR-04, STO-FR-05).
//!
//! Support is decided per location before anything moves, and an OS removal
//! that would delete immediately counts as unsupported: a network volume on
//! macOS, a removable, network or nuke-on-delete drive on Windows, or an entry
//! larger than the Recycle Bin holds. A link is moved itself, never its target.
//! There is no fallback of any kind: when the OS Trash cannot take an entry,
//! the entry stays where it is and the item reports why.
//!
//! - macOS: `NSFileManager trashItemAtURL`, which moves the entry itself and
//!   refuses instead of deleting where a volume has no Trash; support comes
//!   from the volume's `statfs` flags.
//! - Linux: the freedesktop.org Trash, by a no-replace rename on the entry's
//!   own device only. A cross-device or unsupported rename is refused; nothing
//!   is copied and deleted. A missing home Trash is created owner-only, with
//!   its data home, as the Trash and base directory specifications ask.
//! - Windows: the Shell Recycle Bin, after a bounded volume and Recycle Bin
//!   policy query proves the drive keeps what it receives.

use std::path::Path;

use crate::{EntryEvidence, ItemReason, KeptCopy, ReasonCode, TrashSupport, TrashUnsupported};

/// The OS Trash of the host, or a stand-in with the same contract.
pub trait OsTrash: Send + Sync {
    /// Whether moving the entry at `entry` (of `size_bytes`) to the OS Trash
    /// keeps it restorable. An OS action that deletes immediately is unsupported.
    fn support(&self, entry: &Path, size_bytes: u64) -> TrashSupport;
    /// Move the entry itself, never a link's target, to the OS Trash.
    ///
    /// # Errors
    /// The OS refusal; the entry must then still be in place.
    fn move_to_trash(&self, entry: &Path) -> Result<(), String>;
}

/// The host operating system's Trash.
#[derive(Default)]
pub struct SystemTrash {
    /// Recycle Bin facts per folder, queried once per adapter.
    #[cfg(windows)]
    bins:
        std::sync::Mutex<std::collections::HashMap<std::path::PathBuf, Result<RecycleBin, String>>>,
    /// The data home whose `Trash` is the home Trash; `None` reads
    /// `$XDG_DATA_HOME`, then `$HOME/.local/share`.
    #[cfg(target_os = "linux")]
    data_home: Option<std::path::PathBuf>,
}

impl SystemTrash {
    /// The host Trash with its freedesktop home Trash under `data_home`
    /// instead of the user's, which a test or sandbox must leave untouched.
    #[cfg(target_os = "linux")]
    #[must_use]
    pub fn with_data_home(data_home: std::path::PathBuf) -> Self {
        Self { data_home: Some(data_home) }
    }
}

impl OsTrash for SystemTrash {
    fn support(&self, entry: &Path, size_bytes: u64) -> TrashSupport {
        platform::support(self, entry, size_bytes)
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        platform::move_entry(self, entry)
    }
}

/// How retiring one entry to the OS Trash ended.
pub(crate) enum Retirement {
    /// The entry left its path through the OS Trash.
    Moved,
    /// The volume cannot take it to the OS Trash; nothing was attempted.
    Unsupported(ItemReason),
    /// A check failed or the OS refused; the entry is in place.
    Blocked(ItemReason),
    /// The outcome cannot be proven from the entry's path.
    Uncertain(ItemReason),
}

/// Retire one reviewed entry: decide support for its location, run
/// `before_move`, re-verify every kept copy and then the entry itself (D19),
/// and only then ask the OS Trash to move the entry. Links are re-verified
/// and moved without following them.
pub(crate) fn retire(
    trash: &dyn OsTrash,
    source: &EntryEvidence,
    relied_on: &[KeptCopy],
    before_move: impl FnOnce() -> Result<(), ItemReason>,
) -> Retirement {
    let path = match super::path_of(&source.path) {
        Ok(path) => path,
        Err(reason) => return Retirement::Blocked(reason),
    };
    if let TrashSupport::Unsupported { reason, detail } =
        trash.support(&path, source.fingerprint.size_bytes)
    {
        return Retirement::Unsupported(ItemReason::new(
            ReasonCode::TrashUnsupported,
            format!("{detail} ({reason:?}); {} stays in place", path.display()),
        ));
    }
    if let Err(reason) = before_move() {
        return Retirement::Blocked(reason);
    }
    for kept in relied_on {
        if let Err(reason) = super::verify_kept(kept) {
            return Retirement::Blocked(reason);
        }
    }
    if let Err(reason) = super::verify_source(source) {
        return Retirement::Blocked(reason);
    }
    let refused = trash.move_to_trash(&path).err();
    let gone = matches!(
        std::fs::symlink_metadata(&path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    );
    match (refused, gone) {
        (None, true) => Retirement::Moved,
        (Some(refusal), false) if super::in_place(source) => Retirement::Blocked(ItemReason::new(
            ReasonCode::TrashFailed,
            format!("the OS Trash refused: {refusal}"),
        )),
        (None, false) if super::in_place(source) => Retirement::Blocked(ItemReason::new(
            ReasonCode::TrashFailed,
            "the OS Trash reported the move but the entry is still in place",
        )),
        (Some(refusal), _) => Retirement::Uncertain(ItemReason::new(
            ReasonCode::TrashFailed,
            format!("the OS Trash refused ({refusal}) but the entry is no longer in place"),
        )),
        (None, false) => Retirement::Uncertain(ItemReason::new(
            ReasonCode::TrashFailed,
            "another entry appeared at the path after the move",
        )),
    }
}

fn unsupported(reason: TrashUnsupported, detail: impl Into<String>) -> TrashSupport {
    TrashSupport::Unsupported { reason, detail: detail.into() }
}

// ── macOS ─────────────────────────────────────────────────────────────────────

#[cfg(any(target_os = "macos", test))]
const MNT_RDONLY: u32 = 0x0000_0001;
#[cfg(any(target_os = "macos", test))]
const MNT_LOCAL: u32 = 0x0000_1000;

/// Classify a macOS volume from its `statfs` flags and file system type.
#[cfg(any(target_os = "macos", test))]
fn mac_volume(flags: u32, filesystem: &str) -> TrashSupport {
    if flags & MNT_LOCAL == 0 {
        return unsupported(
            TrashUnsupported::DeletesImmediately,
            format!(
                "the {filesystem} network volume has no Trash: macOS deletes items there \
                 immediately"
            ),
        );
    }
    if flags & MNT_RDONLY != 0 {
        return unsupported(TrashUnsupported::ReadOnly, "the volume is read-only");
    }
    match filesystem {
        "apfs" | "hfs" | "msdos" | "exfat" => TrashSupport::Supported,
        other => unsupported(
            TrashUnsupported::Unqualified,
            format!("the Trash of {other} volumes is not established on macOS"),
        ),
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::path::Path;

    use super::{mac_volume, unsupported, SystemTrash};
    use crate::{TrashSupport, TrashUnsupported};

    pub(super) fn support(_trash: &SystemTrash, entry: &Path, _size_bytes: u64) -> TrashSupport {
        let Some(folder) = entry.parent() else {
            return unsupported(TrashUnsupported::Unqualified, "the entry has no folder");
        };
        match rustix::fs::statfs(folder) {
            Ok(stat) => {
                let filesystem: Vec<u8> = stat
                    .f_fstypename
                    .iter()
                    .map(|byte| byte.to_ne_bytes()[0])
                    .take_while(|byte| *byte != 0)
                    .collect();
                mac_volume(stat.f_flags, &String::from_utf8_lossy(&filesystem))
            }
            Err(error) => unsupported(
                TrashUnsupported::Unqualified,
                format!("the volume of {} cannot be inspected: {error}", folder.display()),
            ),
        }
    }

    pub(super) fn move_entry(_trash: &SystemTrash, entry: &Path) -> Result<(), String> {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        // NSFileManager moves the entry itself and fails where a volume has no
        // Trash; the Finder method could prompt or delete immediately instead.
        let mut context = trash::TrashContext::new();
        context.set_delete_method(DeleteMethod::NsFileManager);
        context.delete(entry).map_err(|error| error.to_string())
    }
}

// ── Linux: freedesktop.org Trash ──────────────────────────────────────────────

/// RFC 2396 escaping of an absolute path for a `.trashinfo` `Path=` key.
#[cfg(any(target_os = "linux", test))]
fn trashinfo_path(path: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut encoded = String::with_capacity(path.len());
    for byte in path {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(*byte));
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

#[cfg(target_os = "linux")]
mod platform {
    use std::ffi::OsString;
    use std::fs;
    use std::io::Write as _;
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
    use std::path::{Path, PathBuf};

    use super::{trashinfo_path, unsupported, SystemTrash};
    use crate::{TrashSupport, TrashUnsupported};

    /// A Trash folder on the entry's own device.
    struct TrashDir {
        path: PathBuf,
        device: u64,
        /// The home Trash, whose missing data home may be created with it.
        home: bool,
    }

    pub(super) fn support(trash: &SystemTrash, entry: &Path, _size_bytes: u64) -> TrashSupport {
        match locate(trash, entry) {
            Ok(_) => TrashSupport::Supported,
            Err(refusal) => refusal,
        }
    }

    pub(super) fn move_entry(system: &SystemTrash, entry: &Path) -> Result<(), String> {
        let (source, trash) = locate(system, entry).map_err(|refusal| match refusal {
            TrashSupport::Unsupported { detail, .. } => detail,
            TrashSupport::Supported => "no Trash folder".into(),
        })?;
        if trash.home {
            // The Trash specification creates a missing home Trash; the base
            // directory specification creates a missing data home owner-only.
            if let Some(data_home) = trash.path.parent() {
                fs::DirBuilder::new()
                    .recursive(true)
                    .mode(0o700)
                    .create(data_home)
                    .map_err(|error| format!("{}: {error}", data_home.display()))?;
            }
        }
        let files = trash.path.join("files");
        let info = trash.path.join("info");
        for folder in [&trash.path, &files, &info] {
            ensure_folder(folder, trash.device)?;
        }
        let name = source.file_name().ok_or("the entry has no name")?.to_owned();
        let encoded = trashinfo_path(source.as_os_str().as_bytes());
        // Local time needs a time zone database read this process does not
        // make; the deletion date is recorded in UTC instead.
        let date = time::OffsetDateTime::now_utc()
            .format(time::macros::format_description!(
                "[year]-[month]-[day]T[hour]:[minute]:[second]"
            ))
            .map_err(|error| error.to_string())?;
        for attempt in 1_u32..=10_000 {
            let mut stem: OsString = name.clone();
            if attempt > 1 {
                stem.push(format!(".{attempt}"));
            }
            let mut info_name = stem.clone().into_vec();
            info_name.extend_from_slice(b".trashinfo");
            let info_path = info.join(OsString::from_vec(info_name));
            let mut record = match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&info_path)
            {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("{}: {error}", info_path.display())),
            };
            let written = write!(record, "[Trash Info]\nPath={encoded}\nDeletionDate={date}\n")
                .and_then(|()| record.sync_all());
            if let Err(error) = written {
                let _ = fs::remove_file(&info_path);
                return Err(format!("{}: {error}", info_path.display()));
            }
            let destination = files.join(&stem);
            match rustix::fs::renameat_with(
                rustix::fs::CWD,
                &source,
                rustix::fs::CWD,
                &destination,
                rustix::fs::RenameFlags::NOREPLACE,
            ) {
                Ok(()) => {
                    let _ = sync_folder(&files);
                    let _ = sync_folder(source.parent().unwrap_or_else(|| Path::new("/")));
                    return Ok(());
                }
                Err(rustix::io::Errno::EXIST) => {
                    let _ = fs::remove_file(&info_path);
                }
                Err(error) => {
                    // Never copy and delete: a rename the volume refuses
                    // leaves the entry where it is.
                    let _ = fs::remove_file(&info_path);
                    return Err(format!(
                        "{} could not be moved to the Trash: {error}",
                        source.display()
                    ));
                }
            }
        }
        Err("no free name in the Trash".into())
    }

    /// The entry with its folder resolved, and the Trash folder on its device.
    fn locate(system: &SystemTrash, entry: &Path) -> Result<(PathBuf, TrashDir), TrashSupport> {
        let unqualified = |detail: String| unsupported(TrashUnsupported::Unqualified, detail);
        let (Some(folder), Some(name)) = (entry.parent(), entry.file_name()) else {
            return Err(unqualified("the entry has no folder".into()));
        };
        let folder = fs::canonicalize(folder)
            .map_err(|error| unqualified(format!("{}: {error}", folder.display())))?;
        let device = fs::metadata(&folder)
            .map_err(|error| unqualified(format!("{}: {error}", folder.display())))?
            .dev();
        let flags = rustix::fs::statvfs(&folder)
            .map_err(|error| unqualified(format!("{}: {error}", folder.display())))?
            .f_flag;
        if flags.contains(rustix::fs::StatVfsMountFlags::RDONLY) {
            return Err(unsupported(TrashUnsupported::ReadOnly, "the volume is read-only"));
        }
        let source = folder.join(name);
        if let Some(home) = home_trash(system) {
            if device_of_nearest(&home) == Some(device) {
                return Ok((source, TrashDir { path: home, device, home: true }));
            }
        }
        let top = top_folder(&folder, device);
        let uid = rustix::process::getuid().as_raw();
        let shared = top.join(".Trash");
        if let Ok(metadata) = fs::symlink_metadata(&shared) {
            let sticky = metadata.mode() & 0o1000 != 0;
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && sticky
                && metadata.dev() == device
            {
                return Ok((
                    source,
                    TrashDir { path: shared.join(uid.to_string()), device, home: false },
                ));
            }
        }
        let own = top.join(format!(".Trash-{uid}"));
        match fs::symlink_metadata(&own) {
            Ok(metadata)
                if metadata.is_dir()
                    && !metadata.file_type().is_symlink()
                    && metadata.uid() == uid
                    && metadata.dev() == device =>
            {
                Ok((source, TrashDir { path: own, device, home: false }))
            }
            Ok(_) => Err(unsupported(
                TrashUnsupported::NoTrash,
                format!("{} is not this user's Trash folder", own.display()),
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if rustix::fs::access(&top, rustix::fs::Access::WRITE_OK).is_ok() {
                    Ok((source, TrashDir { path: own, device, home: false }))
                } else {
                    Err(unsupported(
                        TrashUnsupported::NoTrash,
                        format!(
                            "the volume at {} has no Trash this user can create",
                            top.display()
                        ),
                    ))
                }
            }
            Err(error) => Err(unqualified(format!("{}: {error}", own.display()))),
        }
    }

    fn home_trash(system: &SystemTrash) -> Option<PathBuf> {
        if let Some(data_home) = &system.data_home {
            return Some(data_home.join("Trash"));
        }
        let data = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute())
                    .map(|home| home.join(".local/share"))
            })?;
        Some(data.join("Trash"))
    }

    /// Device of the nearest existing ancestor of `path`.
    fn device_of_nearest(path: &Path) -> Option<u64> {
        path.ancestors().find_map(|ancestor| fs::metadata(ancestor).ok()).map(|meta| meta.dev())
    }

    /// The highest folder above `folder` that is still on `device`.
    fn top_folder(folder: &Path, device: u64) -> PathBuf {
        let mut top = folder;
        while let Some(parent) = top.parent() {
            if fs::metadata(parent).is_ok_and(|meta| meta.dev() == device) {
                top = parent;
            } else {
                break;
            }
        }
        top.to_path_buf()
    }

    /// A real folder (not a link) on `device`, created owner-only when missing.
    fn ensure_folder(folder: &Path, device: u64) -> Result<(), String> {
        match fs::DirBuilder::new().mode(0o700).create(folder) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(format!("{}: {error}", folder.display())),
        }
        let metadata = fs::symlink_metadata(folder)
            .map_err(|error| format!("{}: {error}", folder.display()))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || metadata.dev() != device {
            return Err(format!(
                "{} is not a Trash folder on the entry's volume",
                folder.display()
            ));
        }
        Ok(())
    }

    fn sync_folder(folder: &Path) -> std::io::Result<()> {
        fs::File::open(folder)?.sync_all()
    }
}

// ── Windows: Shell Recycle Bin ────────────────────────────────────────────────

/// What the bounded volume query reports about a folder's Recycle Bin.
#[cfg(any(windows, test))]
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecycleBin {
    /// `Win32_Volume.DriveType` (`Win32_LogicalDisk` for mapped drives).
    drive_type: Option<u32>,
    /// Volume size in bytes.
    capacity: Option<u64>,
    /// Per-volume "remove files immediately when deleted".
    nuke_on_delete: Option<u32>,
    /// Per-volume Recycle Bin limit in MiB.
    max_capacity_mb: Option<u64>,
    /// `NoRecycleFiles` policy.
    no_recycle_files: Option<u32>,
}

/// Classify a Windows drive's Recycle Bin for an entry of `size_bytes`.
#[cfg(any(windows, test))]
fn windows_volume(bin: &RecycleBin, size_bytes: u64) -> TrashSupport {
    match bin.drive_type {
        Some(3) => {}
        Some(2) => {
            return unsupported(
                TrashUnsupported::DeletesImmediately,
                "removable drives have no Recycle Bin: Windows deletes items there immediately",
            );
        }
        Some(4) => {
            return unsupported(
                TrashUnsupported::DeletesImmediately,
                "network drives have no Recycle Bin: Windows deletes items there immediately",
            );
        }
        Some(5) => return unsupported(TrashUnsupported::ReadOnly, "the drive is read-only"),
        other => {
            return unsupported(
                TrashUnsupported::Unqualified,
                format!("the Recycle Bin of drive type {other:?} is not established"),
            );
        }
    }
    if bin.no_recycle_files == Some(1) {
        return unsupported(
            TrashUnsupported::DeletesImmediately,
            "a policy makes Windows delete files immediately instead of recycling them",
        );
    }
    if bin.nuke_on_delete == Some(1) {
        return unsupported(
            TrashUnsupported::DeletesImmediately,
            "this drive's Recycle Bin removes files immediately when deleted",
        );
    }
    // Without a configured limit the Recycle Bin holds at least 5% of the volume.
    let limit = bin
        .max_capacity_mb
        .map(|mib| mib.saturating_mul(1 << 20))
        .or_else(|| bin.capacity.map(|bytes| bytes / 20));
    match limit {
        Some(limit) if size_bytes <= limit => TrashSupport::Supported,
        Some(_) => unsupported(
            TrashUnsupported::DeletesImmediately,
            "the entry is larger than this drive's Recycle Bin holds: Windows would delete it \
             immediately",
        ),
        None => unsupported(TrashUnsupported::Unqualified, "the Recycle Bin size is unknown"),
    }
}

#[cfg(windows)]
mod platform {
    use std::path::Path;

    use super::{unsupported, windows_volume, RecycleBin, SystemTrash};
    use crate::{TrashSupport, TrashUnsupported};

    const RECYCLE_BIN_QUERY: &str = r#"$ErrorActionPreference = 'Stop'
$p = $env:PLATEVAULT_TRASH_PATH
if ($p.StartsWith('\\?\UNC\') -or ($p.StartsWith('\\') -and -not $p.StartsWith('\\?\'))) { @{ driveType = 4 } | ConvertTo-Json -Compress; exit 0 }
if ($p.StartsWith('\\?\')) { $p = $p.Substring(4) }
$p = [System.IO.Path]::GetFullPath($p)
if (-not $p.EndsWith('\')) { $p = $p + '\' }
$v = Get-CimInstance -ClassName Win32_Volume |
  Where-Object { $_.Name -and $p.StartsWith($_.Name, [System.StringComparison]::OrdinalIgnoreCase) } |
  Sort-Object -Property { $_.Name.Length } -Descending |
  Select-Object -First 1
if ($null -eq $v) {
  $d = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $p.Substring(0, 2) + "'")
  if ($null -eq $d) { exit 3 }
  @{ driveType = [int]$d.DriveType } | ConvertTo-Json -Compress
  exit 0
}
$r = @{ driveType = [int]$v.DriveType }
if ($null -ne $v.Capacity) { $r.capacity = [int64]$v.Capacity }
if ($v.DeviceID -match '\{[0-9A-Fa-f-]+\}') {
  $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\' + $Matches[0]
  if (Test-Path -LiteralPath $k) {
    $b = Get-ItemProperty -LiteralPath $k
    if ($null -ne $b.NukeOnDelete) { $r.nukeOnDelete = [int]$b.NukeOnDelete }
    if ($null -ne $b.MaxCapacity) { $r.maxCapacityMb = [int64]$b.MaxCapacity }
  }
}
foreach ($h in 'HKCU:', 'HKLM:') {
  $k = $h + '\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer'
  if (Test-Path -LiteralPath $k) {
    if ((Get-ItemProperty -LiteralPath $k).NoRecycleFiles -eq 1) { $r.noRecycleFiles = 1 }
  }
}
$r | ConvertTo-Json -Compress"#;

    pub(super) fn support(trash: &SystemTrash, entry: &Path, size_bytes: u64) -> TrashSupport {
        let Some(folder) = entry.parent() else {
            return unsupported(TrashUnsupported::Unqualified, "the entry has no folder");
        };
        let answer = {
            let mut bins = match trash.bins.lock() {
                Ok(bins) => bins,
                Err(poisoned) => poisoned.into_inner(),
            };
            bins.entry(folder.to_path_buf()).or_insert_with(|| query(folder)).clone()
        };
        match answer {
            Ok(bin) => windows_volume(&bin, size_bytes),
            Err(why) => unsupported(TrashUnsupported::Unqualified, why),
        }
    }

    pub(super) fn move_entry(_trash: &SystemTrash, entry: &Path) -> Result<(), String> {
        trash::delete(entry).map_err(|error| error.to_string())
    }

    fn query(folder: &Path) -> Result<RecycleBin, String> {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        /// The desktop release build is a GUI-subsystem process; without this
        /// flag every console child it spawns opens a visible console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let system_root = std::env::var_os("SystemRoot").ok_or("SystemRoot is not set")?;
        let shell = Path::new(&system_root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
        let mut command = Command::new(shell);
        command
            .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", RECYCLE_BIN_QUERY])
            .env("PLATEVAULT_TRASH_PATH", folder)
            .creation_flags(CREATE_NO_WINDOW);
        let output = run_bounded(command, std::time::Duration::from_secs(30))
            .map_err(|why| format!("Recycle Bin query {why}"))?;
        serde_json::from_slice(output.trim_ascii())
            .map_err(|error| format!("Recycle Bin answer unreadable: {error}"))
    }

    /// Run a read-only system query with a deadline; stdout only, capped at 1 MiB.
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
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(5))
                }
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
}

// ── Other platforms ───────────────────────────────────────────────────────────

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod platform {
    use std::path::Path;

    use super::{unsupported, SystemTrash};
    use crate::{TrashSupport, TrashUnsupported};

    pub(super) fn support(_trash: &SystemTrash, _entry: &Path, _size_bytes: u64) -> TrashSupport {
        unsupported(TrashUnsupported::NoTrash, "no OS Trash adapter exists for this platform")
    }

    pub(super) fn move_entry(_trash: &SystemTrash, _entry: &Path) -> Result<(), String> {
        Err("no OS Trash adapter exists for this platform".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reason(support: &TrashSupport) -> Option<TrashUnsupported> {
        match support {
            TrashSupport::Supported => None,
            TrashSupport::Unsupported { reason, .. } => Some(*reason),
        }
    }

    #[test]
    fn macos_network_volumes_delete_immediately_so_they_are_unsupported() {
        for filesystem in ["smbfs", "afpfs", "nfs", "webdav"] {
            assert_eq!(
                reason(&mac_volume(0, filesystem)),
                Some(TrashUnsupported::DeletesImmediately),
                "{filesystem}"
            );
        }
        assert_eq!(reason(&mac_volume(MNT_LOCAL, "apfs")), None);
        assert_eq!(reason(&mac_volume(MNT_LOCAL, "exfat")), None);
        assert_eq!(
            reason(&mac_volume(MNT_LOCAL | MNT_RDONLY, "apfs")),
            Some(TrashUnsupported::ReadOnly)
        );
        assert_eq!(reason(&mac_volume(MNT_LOCAL, "ntfs")), Some(TrashUnsupported::Unqualified));
    }

    #[test]
    fn windows_drives_that_delete_immediately_are_unsupported() {
        let fixed =
            RecycleBin { drive_type: Some(3), capacity: Some(100 << 30), ..RecycleBin::default() };
        assert_eq!(reason(&windows_volume(&fixed, 60 << 20)), None);
        for drive_type in [2, 4] {
            let bin = RecycleBin { drive_type: Some(drive_type), ..fixed.clone() };
            assert_eq!(
                reason(&windows_volume(&bin, 1)),
                Some(TrashUnsupported::DeletesImmediately),
                "drive type {drive_type}"
            );
        }
        let nuke = RecycleBin { nuke_on_delete: Some(1), ..fixed };
        assert_eq!(reason(&windows_volume(&nuke, 1)), Some(TrashUnsupported::DeletesImmediately));
        let policy = RecycleBin { no_recycle_files: Some(1), ..fixed };
        assert_eq!(reason(&windows_volume(&policy, 1)), Some(TrashUnsupported::DeletesImmediately));
        let small = RecycleBin { max_capacity_mb: Some(10), ..fixed };
        assert_eq!(
            reason(&windows_volume(&small, 11 << 20)),
            Some(TrashUnsupported::DeletesImmediately)
        );
        assert_eq!(reason(&windows_volume(&small, 10 << 20)), None);
        let unknown = RecycleBin { drive_type: None, ..fixed };
        assert_eq!(reason(&windows_volume(&unknown, 1)), Some(TrashUnsupported::Unqualified));
    }

    #[test]
    fn trashinfo_paths_escape_reserved_bytes() {
        assert_eq!(trashinfo_path(b"/data/M 31/a%b.fits"), "/data/M%2031/a%25b.fits");
        assert_eq!(trashinfo_path(&[b'/', 0xff]), "/%FF");
    }

    /// A missing home Trash, with the data home above it, is created
    /// owner-only on the first move instead of refusing the move.
    #[cfg(target_os = "linux")]
    #[test]
    fn linux_missing_home_trash_is_created_owner_only() {
        use std::os::unix::ffi::OsStrExt;
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(temp.path()).unwrap();
        let data_home = root.join("home/.local/share");
        let entry = root.join("light_001.fits");
        std::fs::write(&entry, b"frame").unwrap();
        let trash = SystemTrash::with_data_home(data_home.clone());

        assert_eq!(reason(&trash.support(&entry, 5)), None);
        trash.move_to_trash(&entry).unwrap();

        let home = data_home.join("Trash");
        for folder in [data_home, home.clone(), home.join("files"), home.join("info")] {
            let mode = std::fs::metadata(&folder).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700, "{}", folder.display());
        }
        assert!(std::fs::symlink_metadata(&entry).is_err(), "the entry left its folder");
        assert_eq!(std::fs::read(home.join("files/light_001.fits")).unwrap(), b"frame");
        let record = std::fs::read_to_string(home.join("info/light_001.fits.trashinfo")).unwrap();
        let path = trashinfo_path(entry.as_os_str().as_bytes());
        assert!(record.starts_with(&format!("[Trash Info]\nPath={path}\n")), "{record}");
    }
}
