// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! [`CodeSigning`] through `/usr/bin/codesign`, which every macOS ships.

use std::path::Path;
use std::process::{Command, Output};

use super::bundle::{CodeSigning, Identity};
use crate::update::UpdateError;

const CODESIGN: &str = "/usr/bin/codesign";
/// `codesign --verify` exit status for code that does not satisfy the
/// `--test-requirement` it was given (codesign(1)).
const REQUIREMENT_FAILED: i32 = 3;

pub(super) struct Codesign;

impl CodeSigning for Codesign {
    fn identity(&self, bundle: &Path) -> Result<Identity, UpdateError> {
        let info = run(Command::new(CODESIGN).args(["--display", "--verbose=2"]).arg(bundle))?;
        let details = String::from_utf8_lossy(&info.stderr);
        if !info.status.success() {
            if details.contains("is not signed at all") {
                return Ok(Identity::Unsigned);
            }
            return Err(signature_unreadable(bundle, &details));
        }
        if details.lines().any(|line| line.trim() == "Signature=adhoc") {
            return Ok(Identity::AdHoc);
        }
        let requirements =
            run(Command::new(CODESIGN).args(["--display", "--requirements", "-"]).arg(bundle))?;
        // codesign prints the requirement on stdout and its path header on
        // stderr; read both so a change of stream does not lose it.
        let text = [&requirements.stdout, &requirements.stderr]
            .map(|stream| String::from_utf8_lossy(stream).into_owned())
            .join("\n");
        text.lines()
            .find_map(|line| line.trim().strip_prefix("designated => "))
            .map(|requirement| Identity::Designated(requirement.to_owned()))
            .ok_or_else(|| signature_unreadable(bundle, &text))
    }

    fn satisfies(&self, bundle: &Path, requirement: &str) -> Result<bool, UpdateError> {
        let check = run(Command::new(CODESIGN)
            .args(["--verify", "--deep", "--strict", "--test-requirement"])
            .arg(format!("={requirement}"))
            .arg(bundle))?;
        match check.status.code() {
            Some(0) => Ok(true),
            Some(REQUIREMENT_FAILED) => Ok(false),
            _ => Err(UpdateError::Identity(format!(
                "the update's code signature is not valid: {}",
                String::from_utf8_lossy(&check.stderr).trim()
            ))),
        }
    }
}

fn run(command: &mut Command) -> Result<Output, UpdateError> {
    command
        .output()
        .map_err(|error| UpdateError::Install(format!("cannot run {CODESIGN}: {error}")))
}

fn signature_unreadable(bundle: &Path, details: &str) -> UpdateError {
    UpdateError::Install(format!(
        "cannot read the code signature of {}: {}",
        bundle.display(),
        details.trim()
    ))
}

/// A minimal `dir/Probe.app` running `/usr/bin/true`, signed ad hoc as
/// `identifier` when one is given, for the tests against the real
/// `codesign`. Its `Contents/Resources/marker` holds the identifier, to tell
/// bundles apart after a swap.
#[cfg(test)]
pub(super) fn probe_bundle(dir: &Path, identifier: Option<&str>) -> std::path::PathBuf {
    let app = dir.join("Probe.app");
    let macos = app.join("Contents/MacOS");
    std::fs::create_dir_all(&macos).expect("bundle dirs");
    std::fs::create_dir_all(app.join("Contents/Resources")).expect("resources");
    std::fs::write(app.join("Contents/Resources/marker"), identifier.unwrap_or("unsigned"))
        .expect("marker");
    std::fs::copy("/usr/bin/true", macos.join("probe")).expect("executable");
    std::fs::write(
        app.join("Contents/Info.plist"),
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>probe</string>
<key>CFBundleIdentifier</key><string>{}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
"#,
            identifier.unwrap_or("dev.example.probe")
        ),
    )
    .expect("Info.plist");
    // The copied system binary keeps Apple's signature; re-sign or strip it.
    let status = match identifier {
        Some(identifier) => Command::new(CODESIGN)
            .args(["--force", "--sign", "-", "--identifier", identifier])
            .arg(&app)
            .status(),
        None => Command::new(CODESIGN).arg("--remove-signature").arg(macos.join("probe")).status(),
    };
    assert!(status.expect("codesign").success(), "codesign the probe bundle");
    app
}

#[cfg(test)]
mod tests {
    //! Against the real `codesign`, with throwaway ad-hoc signed bundles: an
    //! ad-hoc signature still carries the identifier a requirement names.
    //!
    //! No certificate-signed bundle can be made here: `codesign` refuses an
    //! untrusted self-signed identity, and trusting one needs an
    //! administrator prompt. Apple's own `/usr/bin/true` and `/usr/bin/false`
    //! stand in for certificate-signed code.

    use std::path::Path;

    use flate2::write::GzEncoder;
    use flate2::Compression;

    use super::{probe_bundle as bundle, CodeSigning, Codesign, Identity};
    use crate::update::install::bundle::{install_bundle, LaunchedBundle};
    use crate::update::{Package, UpdateError};

    /// The designated requirement of Apple's `/usr/bin/true`.
    const TRUE_REQUIREMENT: &str = r#"identifier "com.apple.true" and anchor apple"#;

    #[test]
    fn an_ad_hoc_signed_app_reads_as_ad_hoc() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app = bundle(dir.path(), Some("dev.example.a"));
        assert_eq!(Codesign.identity(&app).expect("identity"), Identity::AdHoc);
    }

    #[test]
    fn an_unsigned_app_reads_as_unsigned() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app = bundle(dir.path(), None);
        assert_eq!(Codesign.identity(&app).expect("identity"), Identity::Unsigned);
    }

    #[test]
    fn a_bundle_satisfies_a_requirement_that_matches_it() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app = bundle(dir.path(), Some("dev.example.a"));
        assert!(Codesign.satisfies(&app, r#"identifier "dev.example.a""#).expect("verify"));
    }

    #[test]
    fn a_bundle_does_not_satisfy_another_identity() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app = bundle(dir.path(), Some("dev.example.a"));
        assert!(!Codesign.satisfies(&app, r#"identifier "dev.example.b""#).expect("verify"));
    }

    /// `app` as the `.app.tar.gz` a release ships, staged and verified as a
    /// download would leave it.
    async fn staged_archive(app: &Path) -> crate::update::signature::Staged {
        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        builder.append_dir_all("Probe.app", app).expect("archive the bundle");
        let archive = builder.into_inner().expect("tar").finish().expect("gzip");
        crate::update::tests::stage(Package::App, &archive).await
    }

    fn marker(app: &Path) -> String {
        std::fs::read_to_string(app.join("Contents/Resources/marker")).expect("marker")
    }

    #[test]
    fn certificate_signed_code_reads_as_its_designated_requirement() {
        assert_eq!(
            Codesign.identity(Path::new("/usr/bin/true")).expect("identity"),
            Identity::Designated(TRUE_REQUIREMENT.to_owned())
        );
    }

    #[test]
    fn certificate_signed_code_satisfies_its_own_requirement_and_no_other() {
        assert!(Codesign.satisfies(Path::new("/usr/bin/true"), TRUE_REQUIREMENT).expect("verify"));
        assert!(!Codesign
            .satisfies(Path::new("/usr/bin/false"), TRUE_REQUIREMENT)
            .expect("verify"));
    }

    #[test]
    fn an_ad_hoc_bundle_does_not_satisfy_a_certificate_requirement() {
        let dir = tempfile::tempdir().expect("tempdir");
        let app = bundle(dir.path(), Some("com.apple.true"));
        assert!(!Codesign.satisfies(&app, TRUE_REQUIREMENT).expect("verify"));
    }

    /// The whole macOS install in a temp dir: real `codesign`, the unpack, and
    /// the swap. The installed copy is ad hoc, so no requirement is checked.
    #[tokio::test]
    async fn an_ad_hoc_install_takes_the_update_through_the_real_swap() {
        let dir = tempfile::tempdir().expect("tempdir");
        let applications = dir.path().join("Applications");
        std::fs::create_dir(&applications).expect("Applications");
        let installed = bundle(&applications, Some("dev.example.installed"));
        let release = tempfile::tempdir().expect("release");
        let update = bundle(release.path(), Some("dev.example.update"));
        let staged = staged_archive(&update).await;

        let launched = LaunchedBundle::at(installed.clone()).expect("launch");
        install_bundle(&launched, &mut staged.reverify().expect("verified"), &Codesign, "")
            .expect("install");

        assert_eq!(marker(&installed), "dev.example.update");
        assert!(
            Codesign.satisfies(&installed, r#"identifier "dev.example.update""#).expect("verify"),
            "the swapped-in bundle keeps a valid signature"
        );
        assert_eq!(std::fs::read_dir(&applications).expect("dir").count(), 1, "no backup is left");
    }

    /// The designated-requirement check against certificate-signed installed
    /// code (Apple's `/usr/bin/true`, see the module note): an update signed
    /// by anyone else is refused before the swap, and the installed code stays.
    #[tokio::test]
    async fn an_update_without_the_installed_certificate_identity_is_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = dir.path().join("PlateVault.app");
        std::fs::copy("/usr/bin/true", &installed).expect("installed code");
        let release = tempfile::tempdir().expect("release");
        let update = bundle(release.path(), Some("com.apple.true"));
        let staged = staged_archive(&update).await;

        let launched = LaunchedBundle::at(installed.clone()).expect("launch");
        let error =
            install_bundle(&launched, &mut staged.reverify().expect("verified"), &Codesign, "")
                .expect_err("refused");

        assert!(
            matches!(&error, UpdateError::Identity(message) if message.contains(TRUE_REQUIREMENT)),
            "{error}"
        );
        assert_eq!(
            std::fs::read(&installed).expect("installed"),
            std::fs::read("/usr/bin/true").expect("true"),
            "the installed code is untouched"
        );
    }
}
