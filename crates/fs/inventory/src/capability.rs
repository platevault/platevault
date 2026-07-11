//! Spec 049 (T008): filesystem link-capability probe for source-view
//! generation (FR-004/FR-004c).

use camino::Utf8Path;
use domain_core::source_view::FilesystemCapability;

/// Probe destination-directory link capability: symlink privilege and
/// same-volume hardlink support.
///
/// `destination_dir` MUST already exist — the probe writes and removes a
/// small scratch fixture there. Best-effort: any I/O failure while probing is
/// treated as "capability not available" (never panics; a conservative
/// unavailable result keeps `resolve_link_kind` on a safe fallback path
/// rather than blocking plan building).
///
/// Junction support is Windows-only and always reported unavailable here: the
/// executor does not yet implement junction materialization (a directory
/// reparse point), so this probe never advertises a kind the apply step
/// cannot deliver (Constitution II — never silently produce a wrong result).
#[must_use]
pub fn probe(destination_dir: &Utf8Path) -> FilesystemCapability {
    FilesystemCapability {
        symlink_available: probe_symlink(destination_dir),
        junction_available: false,
        hardlink_available: probe_hardlink(destination_dir),
    }
}

fn probe_symlink(dir: &Utf8Path) -> bool {
    let target = dir.join(".astro-plan-symlink-probe-target");
    let link = dir.join(".astro-plan-symlink-probe-link");
    let wrote = std::fs::write(&target, b"probe").is_ok();
    let ok = wrote && fs_pathsafe::create_symlink(target.as_std_path(), link.as_std_path()).is_ok();
    let _ = std::fs::remove_file(&link);
    let _ = std::fs::remove_file(&target);
    ok
}

fn probe_hardlink(dir: &Utf8Path) -> bool {
    let target = dir.join(".astro-plan-hardlink-probe-target");
    let link = dir.join(".astro-plan-hardlink-probe-link");
    let wrote = std::fs::write(&target, b"probe").is_ok();
    let ok = wrote && std::fs::hard_link(&target, &link).is_ok();
    let _ = std::fs::remove_file(&link);
    let _ = std::fs::remove_file(&target);
    ok
}

#[cfg(test)]
mod tests {
    use super::probe;

    #[test]
    fn probe_reports_capability_matrix_on_local_temp_dir() {
        let dir = tempfile::tempdir().unwrap();
        let path = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
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
        let path = camino::Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        let _ = probe(&path);
        let remaining: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert!(remaining.is_empty(), "probe left scratch files: {remaining:?}");
    }
}
