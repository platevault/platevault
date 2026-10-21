// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! A catalog entry reached from its registered root (spec 071 STO-FR-07,
//! astro-plan-9w4qm C4): every folder between the root and the entry is
//! entered one component at a time, never following a link or junction, at
//! the moment the entry is read or checked. A folder swapped for a link after
//! indexing is refused rather than followed out of the location.
//!
//! On Unix each folder is opened with `openat(O_DIRECTORY | O_NOFOLLOW)`
//! through the handle of the one above it, and the entry is opened through
//! the last handle with `O_NOFOLLOW`. The bytes read are therefore those of
//! an entry below the root, whatever the path names meanwhile.
//!
//! Windows has no `openat` in std. Each folder is opened by its path with
//! `FILE_FLAG_OPEN_REPARSE_POINT`, so a junction or symlink opens as itself
//! and is refused, and every handle is held without `FILE_SHARE_DELETE`
//! until the entry is no longer needed: none of those folders can be
//! renamed, removed or replaced meanwhile. The remaining Windows race is the
//! root's own ancestors, which are not below the root and are checked by the
//! root's registered identity instead (`inventory::validate_location_root`).
//!
//! On both, what happens after the handles are dropped is outside this
//! module: a move to the OS Trash names the entry by its path again, right
//! after the re-verification that used these handles.

use std::ffi::OsStr;
use std::fs::File;
use std::path::{Component, Path, PathBuf};

use super::transfer::{self, Moved};
use super::{is_link, same_entry, unavailable, Check};

/// The folder holding an entry, entered from the entry's registered root
/// without following a link, and the handles that keep it so.
pub(super) struct Below {
    /// The entry's folder.
    folder: File,
    /// Windows: every folder from the root down to the entry's, held so that
    /// none of them can be renamed or replaced while the entry is used.
    #[cfg(windows)]
    _held: Vec<File>,
    /// The entry's full path.
    path: PathBuf,
}

impl Below {
    /// Enter every folder from `root` down to the folder of `path`'s entry.
    ///
    /// # Errors
    /// [`Check::Changed`] when `path` is not below `root`, or the root or a
    /// folder below it is a link, a junction or no folder;
    /// [`Check::Unavailable`] when one cannot be opened for another reason.
    pub(super) fn enter(root: &Path, path: &Path) -> Result<Self, Check> {
        let names = names_below(root, path)?;
        let (_, folders) = names.split_last().ok_or_else(|| outside(root, path))?;
        let mut at = root.to_path_buf();
        let mut folder = open_folder(None, &at, None)?;
        #[cfg(windows)]
        let mut held = Vec::with_capacity(folders.len());
        for name in folders {
            at.push(name);
            let next = open_folder(Some(&folder), &at, Some(name))?;
            #[cfg(windows)]
            held.push(folder);
            folder = next;
        }
        Ok(Self {
            folder,
            #[cfg(windows)]
            _held: held,
            path: path.to_path_buf(),
        })
    }

    /// Open the entry itself for reading, never following a link.
    ///
    /// # Errors
    /// [`Check::Changed`] for a link; [`Check::Unavailable`] when the entry
    /// cannot be opened.
    pub(super) fn open_entry(&self) -> Result<File, Check> {
        open_entry(&self.folder, &self.path)
    }

    /// Whether the entry's path still names it through the folder entered:
    /// its folder, observed by path without following that folder, is the
    /// one this holds. A path-only observation of the entry made before this
    /// answers `true` was made below the root.
    pub(super) fn holds_path(&self) -> bool {
        let Some(parent) = self.path.parent() else { return false };
        let (Ok(held), Ok(named)) = (self.folder.metadata(), std::fs::symlink_metadata(parent))
        else {
            return false;
        };
        same_entry(&held, &named) && !is_link(&named)
    }
}

/// The names from `root` down to `path`'s entry, which must all be plain.
fn names_below<'a>(root: &Path, path: &'a Path) -> Result<Vec<&'a OsStr>, Check> {
    let relative = path.strip_prefix(root).map_err(|_| outside(root, path))?;
    relative
        .components()
        .map(|part| match part {
            Component::Normal(name) => Ok(name),
            _ => Err(outside(root, path)),
        })
        .collect()
}

fn outside(root: &Path, path: &Path) -> Check {
    Check::Changed(format!("{} is not below its location root {}", path.display(), root.display()))
}

fn not_a_folder(path: &Path) -> Check {
    Check::Changed(format!(
        "{} is no longer a real folder below its location root; links are not followed",
        path.display()
    ))
}

/// A folder below the root, through `parent`, or the root itself.
#[cfg(unix)]
fn open_folder(parent: Option<&File>, path: &Path, name: Option<&OsStr>) -> Result<File, Check> {
    use rustix::fs::{openat, Mode, OFlags, CWD};
    use rustix::io::Errno;
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let opened = match (parent, name) {
        (Some(parent), Some(name)) => openat(parent, name, flags, Mode::empty()),
        _ => openat(CWD, path, flags, Mode::empty()),
    };
    match opened {
        Ok(folder) => Ok(File::from(folder)),
        Err(Errno::LOOP | Errno::NOTDIR) => Err(not_a_folder(path)),
        Err(errno) => Err(unavailable(path, &std::io::Error::from(errno))),
    }
}

#[cfg(unix)]
fn open_entry(folder: &File, path: &Path) -> Result<File, Check> {
    use rustix::fs::{openat, Mode, OFlags};
    use rustix::io::Errno;
    let name = path.file_name().ok_or_else(|| not_a_folder(path))?;
    // Non-blocking, so an entry swapped for a FIFO cannot hang the open; a
    // regular file reads as it would otherwise.
    let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
    match openat(folder, name, flags, Mode::empty()) {
        Ok(entry) => Ok(File::from(entry)),
        Err(Errno::LOOP) => {
            Err(Check::Changed(format!("{} is a link; links are not followed", path.display())))
        }
        Err(errno) => Err(unavailable(path, &std::io::Error::from(errno))),
    }
}

#[cfg(windows)]
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

/// A folder below the root, or the root itself, opened by path as itself
/// and held without `FILE_SHARE_DELETE`.
#[cfg(windows)]
fn open_folder(_parent: Option<&File>, path: &Path, _name: Option<&OsStr>) -> Result<File, Check> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const FILE_SHARE_READ: u32 = 0x0001;
    const FILE_SHARE_WRITE: u32 = 0x0002;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    let folder = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| unavailable(path, &error))?;
    let metadata = folder.metadata().map_err(|error| unavailable(path, &error))?;
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(not_a_folder(path));
    }
    Ok(folder)
}

/// The entry, opened by its path through the held folders, as itself.
#[cfg(windows)]
fn open_entry(_folder: &File, path: &Path) -> Result<File, Check> {
    use std::os::windows::fs::OpenOptionsExt;
    let entry = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| unavailable(path, &error))?;
    let metadata = entry.metadata().map_err(|error| unavailable(path, &error))?;
    if is_link(&metadata) {
        return Err(Check::Changed(format!(
            "{} is a link; links are not followed",
            path.display()
        )));
    }
    Ok(entry)
}

#[cfg(not(any(unix, windows)))]
fn open_folder(_parent: Option<&File>, path: &Path, _name: Option<&OsStr>) -> Result<File, Check> {
    Err(Check::Unavailable(format!("{}: no rooted lookup on this platform", path.display())))
}

#[cfg(not(any(unix, windows)))]
fn open_entry(_folder: &File, path: &Path) -> Result<File, Check> {
    Err(Check::Unavailable(format!("{}: no rooted lookup on this platform", path.display())))
}

// ── Folders walked through their handles ────────────────────────────────────

/// Why a folder could not be entered as itself.
#[derive(Debug)]
pub enum Unentered {
    /// A link, a junction or no folder: nothing below it is read.
    NotAFolder,
    Io(std::io::Error),
}

/// One entry a [`Folder`] lists: its name and whether it was a real folder,
/// never a link or junction, when it was listed.
pub struct Listed {
    pub name: std::ffi::OsString,
    pub folder: bool,
}

/// A folder opened as itself, never through a link. It is listed through
/// its handle and its subfolders are entered through it, so a walk stays
/// below the folder it began at whatever its path names meanwhile (spec 071
/// STO-FR-04/05/16, astro-plan-yb133). On Windows the handle is held
/// without `FILE_SHARE_DELETE` while the folder is listed and walked below,
/// so it can't be renamed or replaced meanwhile.
pub struct Folder {
    handle: File,
    path: PathBuf,
}

impl Folder {
    /// Open `path` itself as a folder.
    ///
    /// # Errors
    /// [`Unentered::NotAFolder`] for a link, a junction or no folder.
    pub fn open(path: &Path) -> Result<Self, Unentered> {
        Ok(Self { handle: open_dir(None, path)?, path: path.to_path_buf() })
    }

    /// Enter the subfolder `name` through this folder's handle.
    ///
    /// # Errors
    /// [`Unentered::NotAFolder`] when `name` is now a link, a junction or no
    /// folder.
    pub fn child(&self, name: &OsStr) -> Result<Self, Unentered> {
        let path = self.path.join(name);
        Ok(Self { handle: open_dir(Some((&self.handle, name)), &path)?, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Every entry of this folder but `.` and `..`, as listed now.
    ///
    /// # Errors
    /// The folder or an entry of it can't be read.
    #[cfg(unix)]
    pub fn list(&self) -> std::io::Result<Vec<Listed>> {
        use std::os::unix::ffi::OsStrExt as _;

        use rustix::fs::{statat, AtFlags, Dir, FileType};
        let mut listed = Vec::new();
        for entry in Dir::read_from(&self.handle)? {
            let entry = entry?;
            let name = OsStr::from_bytes(entry.file_name().to_bytes());
            if name == "." || name == ".." {
                continue;
            }
            let kind = match entry.file_type() {
                FileType::Unknown => {
                    match statat(&self.handle, name, AtFlags::SYMLINK_NOFOLLOW) {
                        Ok(stat) => FileType::from_raw_mode(stat.st_mode),
                        // Gone since it was listed: nothing to account for.
                        Err(rustix::io::Errno::NOENT) => continue,
                        Err(errno) => return Err(errno.into()),
                    }
                }
                kind => kind,
            };
            listed.push(Listed { name: name.to_os_string(), folder: kind == FileType::Directory });
        }
        Ok(listed)
    }

    /// Every entry of this folder, listed by its path while its handle keeps
    /// it from being renamed or replaced.
    ///
    /// # Errors
    /// The folder or an entry of it can't be read.
    #[cfg(not(unix))]
    pub fn list(&self) -> std::io::Result<Vec<Listed>> {
        let mut listed = Vec::new();
        for entry in std::fs::read_dir(&self.path)? {
            let entry = entry?;
            let folder = match std::fs::symlink_metadata(entry.path()) {
                Ok(metadata) => metadata.is_dir() && !is_link(&metadata),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            listed.push(Listed { name: entry.file_name(), folder });
        }
        Ok(listed)
    }

    /// Whether the regular file `name` of this folder begins with `magic`;
    /// a link is never opened.
    pub fn file_starts_with(&self, name: &OsStr, magic: &[u8]) -> bool {
        use std::io::Read as _;
        let path = self.path.join(name);
        let Ok(mut file) = open_entry(&self.handle, &path) else { return false };
        let mut head = vec![0_u8; magic.len()];
        file.metadata().is_ok_and(|metadata| metadata.is_file())
            && file.read_exact(&mut head).is_ok()
            && head == magic
    }

    /// Move this folder's entry `name` to `to` without replacing anything
    /// ([`transfer::move_noreplace`]), the entry named through this folder.
    /// On macOS and Linux the no-replace rename is made relative to its
    /// handle, so a folder above it swapped for a link meanwhile is never
    /// followed. Where the volume has no no-replace rename (macOS exFAT) the
    /// move goes by path once the path still names this folder, which
    /// leaves the moment between that check and the move; on Windows the
    /// caller holds every folder from the root down to this one, none of
    /// which can be renamed or replaced meanwhile.
    ///
    /// # Errors
    /// `AlreadyExists` when `to` is taken; `NotADirectory` when this
    /// folder's path no longer names it; the platform's rename error.
    pub fn move_entry(&self, name: &OsStr, to: &Path) -> std::io::Result<Moved> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            use rustix::fs::{renameat_with, RenameFlags, CWD};
            use rustix::io::Errno;
            match renameat_with(&self.handle, name, CWD, to, RenameFlags::NOREPLACE) {
                Ok(()) => return Ok(Moved::Renamed),
                // As `transfer::move_noreplace` classifies a volume without it.
                Err(errno)
                    if [Errno::INVAL, Errno::NOTSUP, Errno::OPNOTSUPP, Errno::NOSYS]
                        .contains(&errno) => {}
                Err(error) => return Err(error.into()),
            }
        }
        if !self.named_by_its_path() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotADirectory,
                format!("{} is no longer the folder entered", self.path.display()),
            ));
        }
        transfer::move_noreplace(&self.path.join(name), to)
    }

    /// Whether this folder's path, observed without following its last
    /// component, names the folder this handle holds.
    fn named_by_its_path(&self) -> bool {
        match (self.handle.metadata(), std::fs::symlink_metadata(&self.path)) {
            (Ok(held), Ok(named)) => same_entry(&held, &named) && !is_link(&named),
            _ => false,
        }
    }
}

#[cfg(unix)]
fn open_dir(parent: Option<(&File, &OsStr)>, path: &Path) -> Result<File, Unentered> {
    use rustix::fs::{openat, Mode, OFlags, CWD};
    use rustix::io::Errno;
    let flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let opened = match parent {
        Some((parent, name)) => openat(parent, name, flags, Mode::empty()),
        None => openat(CWD, path, flags, Mode::empty()),
    };
    match opened {
        Ok(folder) => Ok(File::from(folder)),
        Err(Errno::LOOP | Errno::NOTDIR) => Err(Unentered::NotAFolder),
        Err(errno) => Err(Unentered::Io(errno.into())),
    }
}

/// The folder opened by its path as itself, and refused when it is a
/// reparse point; the caller holds the parent's handle meanwhile.
#[cfg(windows)]
fn open_dir(_parent: Option<(&File, &OsStr)>, path: &Path) -> Result<File, Unentered> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_LIST_DIRECTORY: u32 = 0x0001;
    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const FILE_SHARE_READ: u32 = 0x0001;
    const FILE_SHARE_WRITE: u32 = 0x0002;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    let folder = std::fs::OpenOptions::new()
        .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(Unentered::Io)?;
    let metadata = folder.metadata().map_err(Unentered::Io)?;
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(Unentered::NotAFolder);
    }
    Ok(folder)
}

#[cfg(not(any(unix, windows)))]
fn open_dir(_parent: Option<(&File, &OsStr)>, path: &Path) -> Result<File, Unentered> {
    Err(Unentered::Io(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        format!("{}: no rooted lookup on this platform", path.display()),
    )))
}

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::io::Read;
    use std::os::unix::fs::symlink;

    use super::*;

    /// `root/night/Light.fits` holding `inside`, and the temp folder above.
    fn tree() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        fs::create_dir_all(root.join("night")).unwrap();
        let entry = root.join("night").join("Light.fits");
        fs::write(&entry, b"inside").unwrap();
        (temp, root, entry)
    }

    /// Replace `root/night` with a link to a folder outside holding
    /// `outside` under the same name.
    fn swap(temp: &tempfile::TempDir, root: &Path) {
        fs::rename(root.join("night"), temp.path().join("away")).unwrap();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("Light.fits"), b"outside").unwrap();
        symlink(&outside, root.join("night")).unwrap();
    }

    #[test]
    fn a_folder_swapped_for_a_link_is_refused() {
        let (temp, root, entry) = tree();
        swap(&temp, &root);
        assert!(matches!(Below::enter(&root, &entry), Err(Check::Changed(_))));
    }

    #[test]
    fn an_entry_outside_its_root_or_a_linked_root_is_refused() {
        let (temp, root, entry) = tree();
        let other = temp.path().join("other");
        assert!(matches!(Below::enter(&other, &entry), Err(Check::Changed(_))));
        assert!(matches!(Below::enter(&root, &root.join("night/../x")), Err(Check::Changed(_))));
        let linked = temp.path().join("linked");
        symlink(&root, &linked).unwrap();
        let through = linked.join("night").join("Light.fits");
        assert!(matches!(Below::enter(&linked, &through), Err(Check::Changed(_))));
    }

    #[test]
    fn an_entry_link_is_never_opened() {
        let (temp, root, entry) = tree();
        let target = temp.path().join("target.fits");
        fs::write(&target, b"outside").unwrap();
        fs::remove_file(&entry).unwrap();
        symlink(&target, &entry).unwrap();
        let below = Below::enter(&root, &entry).unwrap();
        assert!(matches!(below.open_entry(), Err(Check::Changed(_))));
    }

    /// The race the handles close: a folder swapped after it was entered is
    /// not followed, and the swap is seen.
    #[test]
    fn a_swap_after_entering_reads_the_entry_below_the_root() {
        let (temp, root, entry) = tree();
        let below = Below::enter(&root, &entry).unwrap();
        assert!(below.holds_path());
        swap(&temp, &root);
        let mut read = String::new();
        below.open_entry().unwrap().read_to_string(&mut read).unwrap();
        assert_eq!(read, "inside");
        assert!(!below.holds_path(), "the path now names a folder outside");
    }
}
