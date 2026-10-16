// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Linux installs (decision D6: the `AppImage`, deb and rpm channels stay as
//! they are). Both run only once the user chose Install, so the deb/rpm
//! polkit prompt never appears before a click.
//!
//! Compiled on every Unix for tests; only Linux installs through it.

use std::fs::{self, File};
use std::path::Path;
use std::process::{Command, ExitStatus};

use super::Installed;
#[cfg(target_os = "linux")]
use crate::update::signature::Payload;
use crate::update::{Package, UpdateError};

const PKEXEC: &str = "/usr/bin/pkexec";
/// pkexec's exit status when the user dismissed the authentication dialog,
/// and when authorization was refused or could not be obtained (pkexec(1)).
const PKEXEC_NOT_AUTHORIZED: [i32; 2] = [126, 127];
/// [`PRIVILEGED_INSTALL`]'s exit status when root's copy of the payload is not
/// the one the app verified.
const PAYLOAD_CHANGED: i32 = 65;
/// `$0` of [`PRIVILEGED_INSTALL`], which `sh` reports its errors under.
const SCRIPT_NAME: &str = "platevault-update";

/// The root shell `pkexec` runs to install a deb or rpm (astro-plan-ryj83).
/// The payload arrives on standard input, the verified handle, so root never
/// opens a path the user can write. `$1` is the SHA-256 of the bytes the app
/// verified, `$2` the package tool, `$3` its install flag and `$4` the file
/// name. The script copies the payload into a directory of its own under the
/// sticky `/tmp`, which only root can enter, checks the copy against `$1`,
/// and only then hands the copy to the package manager.
///
/// It exits with the tool's status, [`PAYLOAD_CHANGED`] (65) for a copy that
/// differs, or 1 for a failure of its own steps; never 126 or 127, which are
/// pkexec's own ([`PKEXEC_NOT_AUTHORIZED`]), so `sh`'s "not found" for a
/// missing tool is not read as a dismissed prompt.
const PRIVILEGED_INSTALL: &str = r#"d=$(/bin/mktemp -d /tmp/platevault-update.XXXXXXXXXX) || exit 1
trap '/bin/rm -rf -- "$d"' EXIT
f="$d/$4"
/bin/cat > "$f" || exit 1
s=$(/usr/bin/sha256sum < "$f") || exit 1
[ "${s%% *}" = "$1" ] || exit 65
"$2" "$3" "$f"
s=$?
[ "$s" -lt 126 ] || s=1
exit "$s""#;

/// Replace the running `AppImage`, which its runtime names in `$APPIMAGE`.
#[cfg(target_os = "linux")]
pub(super) fn replace_appimage(payload: &mut File) -> Result<Installed, UpdateError> {
    let target = std::env::var_os("APPIMAGE").map(std::path::PathBuf::from).ok_or_else(|| {
        UpdateError::Unsupported(
            "PlateVault is not running as an AppImage ($APPIMAGE is unset)".to_owned(),
        )
    })?;
    replace_file(&target, payload)?;
    Ok(Installed::Relaunch)
}

/// Write `payload` next to `target` and rename it over `target`, with
/// `target`'s permissions, so the path always holds a complete file and a
/// process running the old one keeps its open inode.
pub(super) fn replace_file(target: &Path, payload: &mut File) -> Result<(), UpdateError> {
    let dir = target.parent().ok_or_else(|| {
        UpdateError::Install(format!("{} has no parent directory", target.display()))
    })?;
    let permissions = fs::metadata(target)?.permissions();
    let mut replacement =
        tempfile::Builder::new().prefix(".platevault-update-").tempfile_in(dir)?;
    std::io::copy(payload, replacement.as_file_mut())?;
    replacement.as_file().sync_all()?;
    fs::set_permissions(replacement.path(), permissions)?;
    replacement.persist(target).map_err(|error| UpdateError::Io(error.error))?;
    Ok(())
}

/// Install a deb or rpm with `pkexec`, the polkit prompt the plugin used,
/// through [`PRIVILEGED_INSTALL`].
#[cfg(target_os = "linux")]
pub(super) fn install_package(
    payload: &mut Payload<'_>,
    package: Package,
) -> Result<Installed, UpdateError> {
    run_package(package_command(package, payload.sha256()), payload)
}

/// Run `command`, a [`package_command`], with the verified `payload` on its
/// standard input. The handle shares its position with `payload`'s, which
/// `reverify` and `check_format` leave at the start.
#[cfg(target_os = "linux")]
fn run_package(mut command: Command, payload: &mut Payload<'_>) -> Result<Installed, UpdateError> {
    let stdin = payload.reader().try_clone()?;
    let status = command.stdin(stdin).status().map_err(|error| {
        UpdateError::Install(format!(
            "cannot run {} to install the update: {error}",
            command.get_program().to_string_lossy()
        ))
    })?;
    package_outcome(status)
}

/// `pkexec` running [`PRIVILEGED_INSTALL`] for `package`, which checks its
/// copy against `sha256` before `dpkg -i` or `rpm -U` installs it. Every
/// program is named by absolute path, so nothing is looked up on the caller's
/// `PATH`.
pub(super) fn package_command(package: Package, sha256: &str) -> Command {
    let (tool, flag) =
        if package == Package::Rpm { ("/usr/bin/rpm", "-U") } else { ("/usr/bin/dpkg", "-i") };
    let mut command = Command::new(PKEXEC);
    command
        .args(["/bin/sh", "-c", PRIVILEGED_INSTALL, SCRIPT_NAME, sha256, tool, flag])
        .arg(package.payload_file_name());
    command
}

/// What the `pkexec` run's `status` means for the install.
fn package_outcome(status: ExitStatus) -> Result<Installed, UpdateError> {
    match status.code() {
        Some(0) => Ok(Installed::Relaunch),
        Some(code) if PKEXEC_NOT_AUTHORIZED.contains(&code) => Err(UpdateError::Permission(
            format!("{PKEXEC} was not authorized to install the update ({status})"),
        )),
        Some(PAYLOAD_CHANGED) => Err(UpdateError::Signature(
            "the update changed before the package manager could read it".to_owned(),
        )),
        _ => Err(UpdateError::Install(format!(
            "the package manager did not install the update ({status})"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;
    use std::fs;
    use std::io::{Read as _, Seek as _, Write as _};
    use std::os::unix::fs::PermissionsExt as _;
    use std::os::unix::process::ExitStatusExt as _;
    use std::process::ExitStatus;

    use super::{package_command, package_outcome, replace_file, PRIVILEGED_INSTALL, SCRIPT_NAME};
    use crate::update::install::Installed;
    use crate::update::{Package, UpdateError};

    const SHA256: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    fn args(command: &std::process::Command) -> Vec<&OsStr> {
        command.get_args().collect()
    }

    #[test]
    fn a_deb_installs_through_pkexec_running_the_checking_script() {
        let command = package_command(Package::Deb, SHA256);
        assert_eq!(command.get_program(), "/usr/bin/pkexec");
        // One argument each, and no path at all: the payload is on stdin.
        assert_eq!(
            args(&command),
            [
                "/bin/sh",
                "-c",
                PRIVILEGED_INSTALL,
                SCRIPT_NAME,
                SHA256,
                "/usr/bin/dpkg",
                "-i",
                "update.deb"
            ]
        );
    }

    #[test]
    fn an_rpm_installs_through_pkexec_running_the_checking_script() {
        let command = package_command(Package::Rpm, SHA256);
        assert_eq!(command.get_program(), "/usr/bin/pkexec");
        assert_eq!(args(&command)[3..], [SCRIPT_NAME, SHA256, "/usr/bin/rpm", "-U", "update.rpm"]);
    }

    /// Every program the root script runs is named by absolute path, and it
    /// reads the payload from standard input only.
    #[test]
    fn the_root_script_names_its_programs_and_reads_no_payload_path() {
        for program in ["/bin/mktemp", "/bin/rm", "/bin/cat", "/usr/bin/sha256sum"] {
            assert!(PRIVILEGED_INSTALL.contains(program), "{program}");
        }
        assert!(PRIVILEGED_INSTALL.contains(r#"/bin/cat > "$f""#));
        assert!(!PRIVILEGED_INSTALL.contains("$5"), "no further argument");
    }

    #[test]
    fn each_pkexec_status_maps_to_its_outcome() {
        let status = |code: i32| ExitStatus::from_raw(code << 8);
        assert!(matches!(package_outcome(status(0)), Ok(Installed::Relaunch)));
        for not_authorized in [126, 127] {
            assert!(
                matches!(package_outcome(status(not_authorized)), Err(UpdateError::Permission(_))),
                "{not_authorized}"
            );
        }
        assert!(matches!(package_outcome(status(65)), Err(UpdateError::Signature(_))));
        for failed in [1, 2] {
            assert!(
                matches!(package_outcome(status(failed)), Err(UpdateError::Install(_))),
                "{failed}"
            );
        }
    }

    #[test]
    fn the_appimage_is_replaced_in_place_with_its_permissions() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("PlateVault.AppImage");
        fs::write(&target, b"old image").expect("old image");
        fs::set_permissions(&target, fs::Permissions::from_mode(0o750)).expect("mode");
        let mut running = fs::File::open(&target).expect("the running copy");
        let mut payload = tempfile::tempfile().expect("payload");
        payload.write_all(b"new image").expect("payload bytes");
        payload.rewind().expect("rewind");

        replace_file(&target, &mut payload).expect("replace");

        assert_eq!(fs::read(&target).expect("target"), b"new image");
        assert_eq!(
            fs::metadata(&target).expect("metadata").permissions().mode() & 0o777,
            0o750,
            "the permissions carry over"
        );
        let mut old = Vec::new();
        running.read_to_end(&mut old).expect("read the old inode");
        assert_eq!(old, b"old image", "the running copy keeps its inode");
        let left: Vec<_> = fs::read_dir(dir.path()).expect("dir").collect();
        assert_eq!(left.len(), 1, "no temporary file is left next to the image");
    }

    #[test]
    fn a_missing_appimage_is_not_replaced() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("PlateVault.AppImage");
        let mut payload = tempfile::tempfile().expect("payload");
        assert!(replace_file(&target, &mut payload).is_err());
        assert!(!target.exists());
        assert_eq!(fs::read_dir(dir.path()).expect("dir").count(), 0);
    }

    /// The script's tests run it as `pkexec` would, only without root: the
    /// `/bin` and `/usr/bin` programs it names are the Linux ones.
    #[cfg(target_os = "linux")]
    mod root_script {
        use std::fs;
        use std::io::{Seek as _, Write as _};
        use std::os::unix::fs::PermissionsExt as _;
        use std::path::{Path, PathBuf};
        use std::process::Command;

        use sha2::{Digest as _, Sha256};

        use super::super::{
            package_command, run_package, PAYLOAD_CHANGED, PRIVILEGED_INSTALL, SCRIPT_NAME,
        };
        use crate::update::install::{check_format, Installed};
        use crate::update::Package;

        const PACKAGE: &[u8] = b"!<arch>\ndebian-binary 2.0";

        fn sha256(bytes: &[u8]) -> String {
            format!("{:x}", Sha256::digest(bytes))
        }

        /// A stand-in package tool in `dir` that exits with `status` after
        /// recording its flag (`flag`), the path it was given (`given`) and a
        /// copy of that file (`installed`).
        fn package_tool(dir: &Path, status: i32) -> PathBuf {
            let tool = dir.join("tool");
            let out = dir.display();
            fs::write(
                &tool,
                format!(
                    "#!/bin/sh\nprintf '%s' \"$1\" > '{out}/flag'\nprintf '%s' \"$2\" > '{out}/given'\n/bin/cp \"$2\" '{out}/installed'\nexit {status}\n"
                ),
            )
            .expect("tool");
            fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).expect("tool mode");
            tool
        }

        /// Run the script with `payload` on standard input, as the copy the
        /// app verified with digest `sha256`.
        fn run(payload: &[u8], sha256: &str, tool: &Path) -> Option<i32> {
            let mut stdin = tempfile::tempfile().expect("payload");
            stdin.write_all(payload).expect("payload bytes");
            stdin.rewind().expect("rewind");
            Command::new("/bin/sh")
                .args(["-c", PRIVILEGED_INSTALL, SCRIPT_NAME, sha256])
                .arg(tool)
                .args(["-i", "update.deb"])
                .stdin(stdin)
                .status()
                .expect("sh")
                .code()
        }

        #[test]
        fn the_package_manager_gets_the_scripts_own_checked_copy() {
            let dir = tempfile::tempdir().expect("tempdir");
            let tool = package_tool(dir.path(), 0);

            assert_eq!(run(PACKAGE, &sha256(PACKAGE), &tool), Some(0));

            assert_eq!(fs::read(dir.path().join("installed")).expect("installed"), PACKAGE);
            assert_eq!(fs::read_to_string(dir.path().join("flag")).expect("flag"), "-i");
            let given = PathBuf::from(fs::read_to_string(dir.path().join("given")).expect("given"));
            assert!(given.starts_with("/tmp"), "{}", given.display());
            assert!(
                given
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name.to_string_lossy().starts_with("platevault-update.")),
                "{}",
                given.display()
            );
            assert_eq!(given.file_name().expect("name"), "update.deb");
            assert!(!given.parent().expect("dir").exists(), "the copy is removed afterwards");
        }

        /// The swap the re-review describes: the user-writable file changed
        /// after the app verified it, so root's copy no longer matches.
        #[test]
        fn a_payload_swapped_after_the_check_never_reaches_the_package_manager() {
            let dir = tempfile::tempdir().expect("tempdir");
            let tool = package_tool(dir.path(), 0);

            let status = run(b"!<arch>\nswapped in by malware", &sha256(PACKAGE), &tool);

            assert_eq!(status, Some(PAYLOAD_CHANGED));
            assert!(!dir.path().join("given").exists(), "the package manager never ran");
        }

        #[test]
        fn the_package_managers_status_passes_through_but_never_as_pkexecs_own() {
            let dir = tempfile::tempdir().expect("tempdir");
            let failing = package_tool(dir.path(), 2);
            assert_eq!(run(PACKAGE, &sha256(PACKAGE), &failing), Some(2));

            // `sh` answers 127 for a program that is not there, which would
            // read as a dismissed polkit prompt.
            let missing = dir.path().join("no-such-tool");
            assert_eq!(run(PACKAGE, &sha256(PACKAGE), &missing), Some(1));
        }

        /// The install as `OsInstaller` runs it, from a real verified
        /// payload after the format check, with `sh` in place of `pkexec`
        /// and a stand-in for `dpkg`: the script gets the whole payload, so
        /// its copy matches the digest.
        #[tokio::test]
        async fn the_package_install_hands_the_whole_checked_payload_to_the_script() {
            let dir = tempfile::tempdir().expect("tempdir");
            let tool = package_tool(dir.path(), 0);
            let staged = crate::update::tests::stage(Package::Deb, PACKAGE).await;
            let mut payload = staged.reverify().expect("verified");
            check_format(payload.reader(), Package::Deb).expect("a deb");
            let pkexec = package_command(Package::Deb, payload.sha256());
            let mut args: Vec<std::ffi::OsString> =
                pkexec.get_args().map(std::ffi::OsStr::to_os_string).collect();
            assert_eq!(args[5], "/usr/bin/dpkg");
            args[5] = tool.into_os_string();
            let mut command = Command::new(&args[0]);
            command.args(&args[1..]);

            let installed = run_package(command, &mut payload);

            assert!(matches!(installed, Ok(Installed::Relaunch)), "{installed:?}");
            assert_eq!(fs::read(dir.path().join("installed")).expect("installed"), PACKAGE);
        }
    }
}
