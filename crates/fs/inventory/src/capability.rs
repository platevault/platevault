// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 049 (T008): filesystem link-capability probe for source-view
//! generation (FR-004/FR-004c).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use camino::Utf8Path;
use domain_core::source_view::FilesystemCapability;

/// The name prefix of every probe entry. It and the `{prefix}{unix-secs}-{uuid}`
/// name shape match the rebuild's link probe (`platevault-core`
/// `prepare::PROBE_PREFIX`), so that probe's stale-entry sweep recognises a
/// leftover from this one and spares a fresh one.
const PROBE_PREFIX: &str = ".platevault-link-probe-";

/// Probe link capability where source-view links will be written: symlink
/// privilege and same-volume hardlink support.
///
/// `destination_dir` need not exist. Plans are generated before the executor
/// creates the view folder, so the probe runs in the nearest existing
/// ancestor: the folder the view will be created in, on the same volume.
///
/// The probe never writes to, truncates or removes an entry it did not
/// create. It creates one empty file under a fresh unique name with
/// create-new semantics, links to it under names derived from that one
/// (link creation never replaces an existing entry), and removes exactly the
/// entries whose creation succeeded.
///
/// Best-effort: any I/O failure while probing is treated as "capability not
/// available" (never panics; a conservative unavailable result keeps
/// `resolve_link_kind` on a safe fallback path rather than blocking plan
/// building).
///
/// Junction support is Windows-only and always reported unavailable here: the
/// executor does not yet implement junction materialization (a directory
/// reparse point), so this probe never advertises a kind the apply step
/// cannot deliver (Constitution II — never silently produce a wrong result).
#[must_use]
pub fn probe(destination_dir: &Utf8Path) -> FilesystemCapability {
    nearest_existing_dir(destination_dir.as_std_path())
        .map(|dir| probe_in(dir, &fresh_probe_name()))
        .unwrap_or_default()
}

/// The nearest existing ancestor of `path`, itself included, when that entry
/// is a directory. `None` when it is anything else or cannot be inspected.
fn nearest_existing_dir(path: &Path) -> Option<&Path> {
    for candidate in path.ancestors() {
        match fs::metadata(candidate) {
            Ok(meta) => return meta.is_dir().then_some(candidate),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => return None,
        }
    }
    None
}

fn fresh_probe_name() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_secs());
    format!("{PROBE_PREFIX}{now}-{}", domain_core::ids::new_id())
}

/// Probe in `dir`: create the file `name`, then the links `name.symlink`
/// and `name.hardlink` to it. An existing entry at any of those names makes
/// that step report unavailable and is left as it was.
fn probe_in(dir: &Path, name: &str) -> FilesystemCapability {
    /// Removes what the probe created, last first, however the probe ends.
    struct Created(Vec<PathBuf>);
    impl Drop for Created {
        fn drop(&mut self) {
            for path in self.0.iter().rev() {
                let _ = fs::remove_file(path);
            }
        }
    }

    let target = dir.join(name);
    if fs::OpenOptions::new().write(true).create_new(true).open(&target).is_err() {
        return FilesystemCapability::default();
    }
    let mut created = Created(vec![target.clone()]);
    let mut link = |kind: &str, make: fn(&Path, &Path) -> io::Result<()>| {
        let path = dir.join(format!("{name}.{kind}"));
        let made = make(&target, &path).is_ok();
        if made {
            created.0.push(path);
        }
        made
    };
    FilesystemCapability {
        symlink_available: link("symlink", fs_pathsafe::create_symlink),
        junction_available: false,
        hardlink_available: link("hardlink", |target, path| fs::hard_link(target, path)),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    use camino::Utf8PathBuf;
    use domain_core::source_view::FilesystemCapability;

    use super::{probe, probe_in, PROBE_PREFIX};

    fn utf8(path: &Path) -> Utf8PathBuf {
        Utf8PathBuf::from_path_buf(path.to_path_buf()).unwrap()
    }

    /// One directory entry as read without following a link.
    #[derive(Debug, PartialEq, Eq)]
    enum Entry {
        File(Vec<u8>),
        Link(PathBuf),
        Dir,
    }

    /// Every entry directly in `dir`, by name.
    fn snapshot(dir: &Path) -> BTreeMap<String, Entry> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                let meta = std::fs::symlink_metadata(&path).unwrap();
                let state = if meta.file_type().is_symlink() {
                    Entry::Link(std::fs::read_link(&path).unwrap())
                } else if meta.is_dir() {
                    Entry::Dir
                } else {
                    Entry::File(std::fs::read(&path).unwrap())
                };
                (path.file_name().unwrap().to_string_lossy().into_owned(), state)
            })
            .collect()
    }

    #[test]
    fn probe_reports_capability_matrix_on_local_temp_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = utf8(dir.path());
        let cap = probe(&path);
        // Junction is never advertised (executor does not implement it yet).
        assert!(!cap.junction_available);
        // On a normal local temp dir on Linux/macOS CI, both symlink and
        // hardlink are expected to be available.
        #[cfg(unix)]
        {
            assert!(cap.symlink_available);
            assert!(cap.hardlink_available);
        }
    }

    #[test]
    fn probe_leaves_no_scratch_files_behind() {
        let dir = tempfile::tempdir().unwrap();
        let path = utf8(dir.path());
        let _ = probe(&path);
        let remaining: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert!(remaining.is_empty(), "probe left scratch files: {remaining:?}");
    }

    /// Regression (astro-plan-g2co): the probe wrote and then removed fixed
    /// names, so a user entry at one of them was truncated through a symlink
    /// or deleted outright while a plan was only being generated.
    #[cfg(unix)]
    #[test]
    fn probe_leaves_entries_at_the_former_fixed_names_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let user_file = outside.path().join("user.txt");
        std::fs::write(&user_file, b"user data").unwrap();
        let at = |name: &str| dir.path().join(name);
        std::os::unix::fs::symlink(&user_file, at(".astro-plan-symlink-probe-target")).unwrap();
        for name in [
            ".astro-plan-symlink-probe-link",
            ".astro-plan-hardlink-probe-target",
            ".astro-plan-hardlink-probe-link",
        ] {
            std::fs::write(at(name), name.as_bytes()).unwrap();
        }
        let before = snapshot(dir.path());

        let _ = probe(&utf8(dir.path()));

        assert_eq!(snapshot(dir.path()), before);
        assert_eq!(std::fs::read(&user_file).unwrap(), b"user data");
    }

    /// Source-view links land in a destination the executor has not created
    /// yet, so its nearest existing ancestor decides the volume probed.
    #[test]
    fn missing_destination_is_probed_in_its_nearest_existing_ancestor() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("source-views").join("plan-1");

        let cap = probe(&utf8(&destination));

        assert_eq!(cap, probe(&utf8(dir.path())));
        #[cfg(unix)]
        assert!(cap.symlink_available && cap.hardlink_available);
        assert!(snapshot(dir.path()).is_empty(), "the probe creates no destination folder");
    }

    #[test]
    fn destination_below_a_file_reports_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("file"), b"data").unwrap();
        let before = snapshot(dir.path());

        let cap = probe(&utf8(&dir.path().join("file").join("view")));

        assert_eq!(cap, FilesystemCapability::default());
        assert_eq!(snapshot(dir.path()), before);
    }

    /// A folder that cannot hold a new entry supports no link, and the probe's
    /// failed creates remove nothing that was already there.
    #[cfg(unix)]
    #[test]
    fn unwritable_directory_reports_unavailable_and_changes_nothing() {
        use std::os::unix::fs::PermissionsExt as _;

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("kept.txt"), b"kept").unwrap();
        let before = snapshot(dir.path());
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
        // Root ignores the mode bits; there is nothing to prove then.
        let enforced = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.path().join("sentinel"))
            .is_err();

        let cap = probe(&utf8(dir.path()));
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        if !enforced {
            return;
        }

        assert_eq!(cap, FilesystemCapability::default());
        assert_eq!(snapshot(dir.path()), before);
    }

    /// A name collision must refuse the probe file, never reuse or truncate
    /// what is already there.
    #[test]
    fn existing_entry_at_the_probe_name_is_refused_and_kept() {
        let dir = tempfile::tempdir().unwrap();
        let name = format!("{PROBE_PREFIX}0-taken");
        std::fs::write(dir.path().join(&name), b"user data").unwrap();
        let before = snapshot(dir.path());

        let cap = probe_in(dir.path(), &name);

        assert_eq!(cap, FilesystemCapability::default());
        assert_eq!(snapshot(dir.path()), before);
    }

    /// A failed link must not remove the entry already at the link's name;
    /// only the probe's own file goes.
    #[test]
    fn failed_link_keeps_the_entry_at_its_name() {
        let dir = tempfile::tempdir().unwrap();
        let name = format!("{PROBE_PREFIX}0-links-taken");
        for kind in ["symlink", "hardlink"] {
            std::fs::write(dir.path().join(format!("{name}.{kind}")), kind.as_bytes()).unwrap();
        }
        let before = snapshot(dir.path());

        let cap = probe_in(dir.path(), &name);

        assert!(!cap.symlink_available && !cap.hardlink_available);
        assert_eq!(snapshot(dir.path()), before);
    }
}
