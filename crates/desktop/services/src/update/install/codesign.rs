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

#[cfg(test)]
mod tests {
    //! Against the real `codesign`, with throwaway ad-hoc signed bundles: an
    //! ad-hoc signature still carries the identifier a requirement names.

    use std::path::{Path, PathBuf};
    use std::process::Command;

    use super::{CodeSigning, Codesign, Identity};

    /// A minimal `.app` running `/usr/bin/true`, signed ad hoc as
    /// `identifier` when one is given.
    fn bundle(dir: &Path, identifier: Option<&str>) -> PathBuf {
        let app = dir.join("Probe.app");
        let macos = app.join("Contents/MacOS");
        std::fs::create_dir_all(&macos).expect("bundle dirs");
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
            Some(identifier) => Command::new("/usr/bin/codesign")
                .args(["--force", "--sign", "-", "--identifier", identifier])
                .arg(&app)
                .status(),
            None => Command::new("/usr/bin/codesign")
                .arg("--remove-signature")
                .arg(macos.join("probe"))
                .status(),
        };
        assert!(status.expect("codesign").success(), "codesign the probe bundle");
        app
    }

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
}
