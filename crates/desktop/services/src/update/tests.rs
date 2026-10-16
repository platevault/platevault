// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Updater tests: signature verification, the check and its D8 setting, the
//! port's install flow and the quit gate, against a fake network, installer
//! and host. Payloads are signed with throwaway minisign keys.

use std::collections::VecDeque;
use std::io::{Cursor, Read as _};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use reqwest::Url;
use semver::Version;
use serde_json::json;

use super::http::{BoxFuture, ChunkSink, Source};
use super::install::{InstallMode, Installed, Installer};
use super::manifest::Release;
use super::signature::{self, Payload, Staged, TrustedKey};
use super::{
    manifest, Package, Parts, Platform, QuitDecision, UpdateError, UpdateFailure, UpdateHost,
    UpdatePhase, UpdatePort, Updater, UpdaterConfig,
};

const RUNNING: &str = "0.6.0";
const RELEASE: &str = "0.7.0";
const PAYLOAD_URL: &str = "https://example.test/PlateVault_0.7.0_amd64.AppImage";
const NOTES: &str = "Faster imports.";
/// How long a test waits for something a background thread does.
const WAIT: Duration = Duration::from_secs(10);

fn base64(text: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(text)
}

/// A throwaway minisign key pair.
struct Signer(minisign::KeyPair);

impl Signer {
    fn new() -> Self {
        Self(minisign::KeyPair::generate_unencrypted_keypair().expect("key pair"))
    }

    /// The public key as `tauri.conf.json` stores it.
    fn public_key(&self) -> String {
        base64(&self.0.pk.to_box().expect("public key box").into_string())
    }

    /// A manifest `signature` value for `data`, made like `tauri build` makes
    /// it: prehashed, with the signed version in the trusted comment.
    fn sign_with_comment(&self, data: &[u8], trusted_comment: &str) -> String {
        let signature = minisign::sign(
            Some(&self.0.pk),
            &self.0.sk,
            Cursor::new(data),
            Some(trusted_comment),
            None,
        )
        .expect("sign");
        base64(&signature.into_string())
    }

    fn sign(&self, data: &[u8]) -> String {
        self.sign_with_comment(
            data,
            &format!("timestamp:1760000000\tfile:update\tversion:{RELEASE}"),
        )
    }
}

fn manifest_json(version: &str, platforms: &[(&str, &str, &str)]) -> Vec<u8> {
    let platforms: serde_json::Map<_, _> = platforms
        .iter()
        .map(|(key, url, signature)| {
            ((*key).to_owned(), json!({ "url": url, "signature": signature }))
        })
        .collect();
    serde_json::to_vec(&json!({
        "version": version,
        "notes": NOTES,
        "pub_date": "2026-10-15T00:00:00Z",
        "platforms": platforms,
    }))
    .expect("manifest json")
}

/// The network: one manifest (`None` answers 204) and one payload.
struct FakeSource {
    manifest: Option<Vec<u8>>,
    payload: Vec<u8>,
    manifest_requests: AtomicUsize,
    downloads: Mutex<Vec<Url>>,
}

impl FakeSource {
    fn new(manifest: Option<Vec<u8>>, payload: &[u8]) -> Arc<Self> {
        Arc::new(Self {
            manifest,
            payload: payload.to_vec(),
            manifest_requests: AtomicUsize::new(0),
            downloads: Mutex::default(),
        })
    }

    /// A release of `payload` signed by `signer` for the `AppImage` entry.
    fn release(signer: &Signer, payload: &[u8]) -> Arc<Self> {
        let signature = signer.sign(payload);
        Self::new(
            Some(manifest_json(RELEASE, &[("linux-x86_64-appimage", PAYLOAD_URL, &signature)])),
            payload,
        )
    }

    fn manifest_requests(&self) -> usize {
        self.manifest_requests.load(Ordering::SeqCst)
    }

    fn downloads(&self) -> usize {
        self.downloads.lock().expect("downloads").len()
    }
}

impl Source for Arc<FakeSource> {
    fn manifest<'a>(
        &'a self,
        _url: &'a Url,
    ) -> BoxFuture<'a, Result<Option<Vec<u8>>, UpdateError>> {
        self.manifest_requests.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move { Ok(self.manifest.clone()) })
    }

    fn download<'a>(
        &'a self,
        url: &'a Url,
        sink: &'a mut ChunkSink<'_>,
    ) -> BoxFuture<'a, Result<(), UpdateError>> {
        self.downloads.lock().expect("downloads").push(url.clone());
        Box::pin(async move {
            // Two chunks, so the streaming verifier sees a split payload.
            let (head, tail) = self.payload.split_at(self.payload.len() / 2);
            sink(head)?;
            sink(tail)?;
            Ok(())
        })
    }
}

/// The OS installer: records each call and its payload, answers from a queue
/// (default `Relaunch`), and blocks while a gate is set.
#[derive(Default)]
struct FakeInstaller {
    results: Mutex<VecDeque<Result<Installed, UpdateError>>>,
    calls: Mutex<Vec<(InstallMode, Vec<u8>)>>,
    gate: Mutex<Option<mpsc::Receiver<()>>>,
}

impl FakeInstaller {
    fn answering(results: Vec<Result<Installed, UpdateError>>) -> Arc<Self> {
        Arc::new(Self { results: Mutex::new(results.into()), ..Self::default() })
    }

    /// An installer that blocks until the returned sender sends or drops.
    fn blocked() -> (Arc<Self>, mpsc::Sender<()>) {
        let (release, gate) = mpsc::channel();
        (Arc::new(Self { gate: Mutex::new(Some(gate)), ..Self::default() }), release)
    }

    fn calls(&self) -> Vec<(InstallMode, Vec<u8>)> {
        self.calls.lock().expect("calls").clone()
    }
}

impl Installer for Arc<FakeInstaller> {
    fn install(
        &self,
        mut payload: Payload<'_>,
        mode: InstallMode,
    ) -> Result<Installed, UpdateError> {
        let mut bytes = Vec::new();
        payload.reader().read_to_end(&mut bytes).expect("staged payload");
        self.calls.lock().expect("calls").push((mode, bytes));
        let gate = self.gate.lock().expect("gate").take();
        if let Some(gate) = gate {
            let _ = gate.recv();
        }
        self.results.lock().expect("results").pop_front().unwrap_or(Ok(Installed::Relaunch))
    }
}

/// `bytes` staged for `package` as a download would stage it: signed with a
/// throwaway key and verified.
pub(super) async fn stage(package: Package, bytes: &[u8]) -> Staged {
    let signer = Signer::new();
    let release = Release {
        version_text: RELEASE.to_owned(),
        notes: None,
        url: Url::parse(PAYLOAD_URL).expect("url"),
        signature: signer.sign(bytes),
    };
    let source = FakeSource::new(None, bytes);
    let key = TrustedKey::from_config(&signer.public_key()).expect("key");
    signature::download_verified(&source, &release, package, &key).await.expect("staged")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HostCall {
    Relaunch,
    Exit,
}

struct FakeHost(Mutex<mpsc::Sender<HostCall>>);

impl UpdateHost for FakeHost {
    fn relaunch(&self) {
        let _ = self.0.lock().expect("host").send(HostCall::Relaunch);
    }

    fn exit(&self) {
        let _ = self.0.lock().expect("host").send(HostCall::Exit);
    }
}

fn test_platform(package: Option<Package>) -> Platform {
    Platform { os: "linux", arch: "x86_64", package }
}

struct Rig {
    updater: Updater,
    host: mpsc::Receiver<HostCall>,
}

impl Rig {
    fn new(signer: &Signer, source: &Arc<FakeSource>, installer: Box<dyn Installer>) -> Self {
        Self::build(signer, source, installer, Some(Package::AppImage), WAIT)
    }

    fn build(
        signer: &Signer,
        source: &Arc<FakeSource>,
        installer: Box<dyn Installer>,
        package: Option<Package>,
        quit_install_ceiling: Duration,
    ) -> Self {
        let (calls, host) = mpsc::channel();
        let updater = Updater::assemble(Parts {
            current_version: Version::parse(RUNNING).expect("version"),
            endpoints: vec![Url::parse("https://example.test/latest.json").expect("url")],
            key: TrustedKey::from_config(&signer.public_key()).expect("key"),
            platform: test_platform(package),
            source: Box::new(Arc::clone(source)),
            installer,
            host: Box::new(FakeHost(Mutex::new(calls))),
            quit_install_ceiling,
        });
        Self { updater, host }
    }

    fn phase(&self) -> UpdatePhase {
        self.updater.current_status().phase
    }

    fn host_calls(&self) -> Vec<HostCall> {
        self.host.try_iter().collect()
    }

    fn next_host_call(&self) -> HostCall {
        self.host.recv_timeout(WAIT).expect("a host call")
    }
}

// ── The check ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_newer_release_is_offered_with_its_version_and_notes() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));

    rig.updater.check().await;

    let status = rig.updater.current_status();
    assert_eq!(status.phase, UpdatePhase::Available);
    assert_eq!(status.version.as_deref(), Some(RELEASE));
    assert_eq!(status.body.as_deref(), Some(NOTES));
    assert_eq!(source.downloads(), 0, "a check never downloads");
}

#[tokio::test]
async fn a_release_that_is_not_newer_is_up_to_date() {
    let signer = Signer::new();
    let source = FakeSource::new(
        Some(manifest_json(RUNNING, &[("linux-x86_64-appimage", PAYLOAD_URL, "unused")])),
        b"",
    );
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));
    rig.updater.check().await;
    assert_eq!(rig.phase(), UpdatePhase::UpToDate);
}

#[tokio::test]
async fn a_no_content_answer_is_up_to_date() {
    let signer = Signer::new();
    let source = FakeSource::new(None, b"");
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));
    rig.updater.check().await;
    assert_eq!(rig.phase(), UpdatePhase::UpToDate);
}

#[tokio::test]
async fn a_manifest_without_this_platform_fails_the_check() {
    let signer = Signer::new();
    let source = FakeSource::new(
        Some(manifest_json(RELEASE, &[("windows-x86_64-nsis", PAYLOAD_URL, "unused")])),
        b"",
    );
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));
    rig.updater.check().await;
    let status = rig.updater.current_status();
    assert_eq!(status.phase, UpdatePhase::CheckFailed);
    assert_eq!(status.error, Some(UpdateFailure::Manifest), "a code, not an English sentence");
    let detail = rig.updater.error_text().expect("detail");
    assert!(detail.contains("linux-x86_64-appimage or linux-x86_64"), "{detail}");
}

#[tokio::test]
async fn a_payload_url_that_is_not_https_fails_the_check() {
    let signer = Signer::new();
    let signature = signer.sign(b"new AppImage");
    let source = FakeSource::new(
        Some(manifest_json(
            RELEASE,
            &[("linux-x86_64-appimage", "http://example.test/PlateVault.AppImage", &signature)],
        )),
        b"new AppImage",
    );
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));
    rig.updater.check().await;
    assert_eq!(rig.updater.current_status().error, Some(UpdateFailure::Manifest));
    let detail = rig.updater.error_text().expect("detail");
    assert!(detail.contains("is not an HTTPS URL"), "{detail}");
    assert_eq!(source.downloads(), 0);
}

#[test]
fn the_package_entry_wins_over_the_bare_platform_entry() {
    let manifest = manifest_json(
        RELEASE,
        &[
            ("linux-x86_64", "https://example.test/bare", "bare-sig"),
            ("linux-x86_64-appimage", "https://example.test/appimage", "appimage-sig"),
        ],
    );
    let current = Version::parse(RUNNING).expect("version");
    let release =
        manifest::newer_release(&manifest, &current, &test_platform(Some(Package::AppImage)))
            .expect("manifest")
            .expect("newer");
    assert_eq!(release.url.as_str(), "https://example.test/appimage");
    assert_eq!(release.signature, "appimage-sig");
}

#[test]
fn the_bare_platform_entry_is_the_fallback() {
    let manifest =
        manifest_json(RELEASE, &[("linux-x86_64", "https://example.test/bare", "bare-sig")]);
    let current = Version::parse(RUNNING).expect("version");
    for package in [Some(Package::AppImage), None] {
        let release = manifest::newer_release(&manifest, &current, &test_platform(package))
            .expect("manifest")
            .expect("newer");
        assert_eq!(release.url.as_str(), "https://example.test/bare", "{package:?}");
    }
}

// ── "Check for updates automatically" (D8, astro-plan-bzzbp) ────────────────

#[tokio::test]
async fn with_automatic_checks_off_the_startup_check_makes_no_request() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));

    rig.updater.check_on_startup(false).await;

    assert_eq!(source.manifest_requests(), 0, "no request while the setting is off");
    assert_eq!(rig.phase(), UpdatePhase::Idle);
}

#[tokio::test]
async fn with_automatic_checks_on_the_startup_check_runs_once() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));

    rig.updater.check_on_startup(true).await;
    rig.updater.check_on_startup(true).await;

    assert_eq!(source.manifest_requests(), 1);
    assert_eq!(rig.phase(), UpdatePhase::Available);
}

#[tokio::test]
async fn a_manual_check_works_with_automatic_checks_off() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));

    rig.updater.check_on_startup(false).await;
    rig.updater.check().await;

    assert_eq!(source.manifest_requests(), 1);
    assert_eq!(rig.phase(), UpdatePhase::Available);
}

// ── Signature verification ──────────────────────────────────────────────────

/// Check, then Install now with a manifest whose `AppImage` entry carries
/// `signature` over a served `payload`.
async fn download_with(
    signer: &Signer,
    payload: &[u8],
    signature: &str,
) -> (Rig, Arc<FakeInstaller>) {
    let source = FakeSource::new(
        Some(manifest_json(RELEASE, &[("linux-x86_64-appimage", PAYLOAD_URL, signature)])),
        payload,
    );
    let installer = FakeInstaller::answering(vec![]);
    let rig = Rig::new(signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;
    assert_eq!(rig.phase(), UpdatePhase::Available);
    rig.updater.install_now().await;
    (rig, installer)
}

fn assert_refused(rig: &Rig, installer: &FakeInstaller, expected: &str) {
    let status = rig.updater.current_status();
    assert_eq!(status.phase, UpdatePhase::DownloadFailed);
    assert_eq!(status.error, Some(UpdateFailure::Signature));
    let detail = rig.updater.error_text().expect("detail");
    assert!(detail.contains(expected), "{detail}");
    assert!(installer.calls().is_empty(), "nothing unverified reaches the installer");
    assert!(rig.host_calls().is_empty(), "no relaunch or exit");
}

#[tokio::test]
async fn a_payload_signed_with_the_trusted_key_installs() {
    let signer = Signer::new();
    let signature = signer.sign(b"new AppImage");
    let (rig, installer) = download_with(&signer, b"new AppImage", &signature).await;
    assert_eq!(installer.calls(), vec![(InstallMode::Now, b"new AppImage".to_vec())]);
    assert_eq!(rig.host_calls(), vec![HostCall::Relaunch]);
}

#[tokio::test]
async fn a_payload_changed_after_signing_is_refused() {
    let signer = Signer::new();
    let signature = signer.sign(b"new AppImage");
    let (rig, installer) = download_with(&signer, b"tampered AppImage", &signature).await;
    assert_refused(&rig, &installer, "does not match its signature");
}

#[tokio::test]
async fn a_payload_signed_with_another_key_is_refused() {
    let signer = Signer::new();
    let signature = Signer::new().sign(b"new AppImage");
    let (rig, installer) = download_with(&signer, b"new AppImage", &signature).await;
    assert_refused(&rig, &installer, "a key this app does not trust");
}

#[tokio::test]
async fn a_signature_made_for_another_version_is_refused() {
    let signer = Signer::new();
    let signature = signer
        .sign_with_comment(b"new AppImage", "timestamp:1760000000\tfile:update\tversion:0.5.0");
    let (rig, installer) = download_with(&signer, b"new AppImage", &signature).await;
    assert_refused(&rig, &installer, "signed for version 0.5.0");
}

/// The rollback `latest.json` alone cannot stop: an older release's payload
/// and signature, which name no version, announced as a newer release.
#[tokio::test]
async fn a_signature_without_a_signed_version_is_refused() {
    let signer = Signer::new();
    let signature = signer.sign_with_comment(b"old AppImage", "timestamp:1760000000\tfile:update");
    let (rig, installer) = download_with(&signer, b"old AppImage", &signature).await;
    assert_refused(&rig, &installer, "does not name the version it was signed for");
}

#[tokio::test]
async fn a_signed_version_with_a_leading_v_matches() {
    let signer = Signer::new();
    let signature = signer.sign_with_comment(
        b"new AppImage",
        &format!("timestamp:1760000000\tfile:update\tversion:v{RELEASE}"),
    );
    let (rig, installer) = download_with(&signer, b"new AppImage", &signature).await;
    assert_eq!(installer.calls().len(), 1);
    assert_eq!(rig.host_calls(), vec![HostCall::Relaunch]);
}

#[tokio::test]
async fn a_trusted_comment_changed_after_signing_is_refused() {
    let signer = Signer::new();
    let signature = signer.sign(b"new AppImage");
    let decoded = String::from_utf8(
        base64::engine::general_purpose::STANDARD.decode(&signature).expect("base64"),
    )
    .expect("utf8");
    let forged = base64(&decoded.replace("file:update", "file:forged"));
    let (rig, installer) = download_with(&signer, b"new AppImage", &forged).await;
    assert_refused(&rig, &installer, "does not match its signature");
}

#[tokio::test]
async fn a_signature_that_is_not_minisign_is_refused() {
    let signer = Signer::new();
    let (rig, installer) =
        download_with(&signer, b"new AppImage", &base64("not a signature")).await;
    assert_refused(&rig, &installer, "not a minisign signature");
}

/// The legacy `Ed` form signs the payload itself rather than its digest;
/// `tauri build` never writes it, and the manifest gate rejects it too.
#[tokio::test]
async fn a_legacy_minisign_signature_is_refused() {
    let signer = Signer::new();
    let engine = base64::engine::general_purpose::STANDARD;
    let text = String::from_utf8(engine.decode(signer.sign(b"new AppImage")).expect("base64"))
        .expect("utf8");
    let mut lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let mut signature = engine.decode(&lines[1]).expect("signature line");
    assert_eq!(&signature[..2], b"ED");
    signature[1] = b'd';
    lines[1] = engine.encode(signature);
    let legacy = base64(&(lines.join("\n") + "\n"));
    let (rig, installer) = download_with(&signer, b"new AppImage", &legacy).await;
    assert_refused(&rig, &installer, "legacy minisign signature");
}

#[tokio::test]
async fn a_staged_payload_changed_on_disk_fails_its_second_check() {
    let staged = stage(Package::AppImage, b"new AppImage").await;
    assert!(staged.reverify().is_ok(), "untouched, it verifies again");
    std::fs::write(staged.file(), b"swapped AppImage").expect("tamper");
    let error = staged.reverify().err().expect("tampered");
    assert!(
        matches!(&error, UpdateError::Signature(message) if message.contains("changed after it was downloaded")),
        "{error}"
    );
}

/// An installer that counts its calls, swaps the staged file the way
/// same-user malware could while a retry waits, and fails.
#[derive(Default)]
struct TamperingInstaller {
    calls: AtomicUsize,
}

impl Installer for Arc<TamperingInstaller> {
    fn install(&self, payload: Payload<'_>, _mode: InstallMode) -> Result<Installed, UpdateError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        std::fs::write(payload.path(), b"swapped AppImage").expect("tamper");
        Err(UpdateError::Install("denied".to_owned()))
    }
}

#[tokio::test]
async fn a_retry_after_the_staged_payload_changed_installs_nothing() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let installer = Arc::new(TamperingInstaller::default());
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;
    rig.updater.install_now().await;
    assert_eq!(rig.updater.current_status().error, Some(UpdateFailure::Install));

    rig.updater.install_now().await;

    assert_eq!(installer.calls.load(Ordering::SeqCst), 1, "the changed payload never reached it");
    assert_eq!(rig.phase(), UpdatePhase::InstallFailed);
    assert_eq!(rig.updater.current_status().error, Some(UpdateFailure::Signature));
    assert!(rig.host_calls().is_empty(), "no relaunch or exit");
}

#[cfg(unix)]
#[test]
fn stale_payload_dirs_are_removed_and_nothing_else() {
    let temp = tempfile::tempdir().expect("tempdir");
    let payload = temp.path().join("platevault-update-payload-old");
    std::fs::create_dir(&payload).expect("payload dir");
    std::fs::write(payload.join("update-setup.exe"), b"MZ").expect("installer");
    let kept_app = temp.path().join("platevault-update-app-kept");
    std::fs::create_dir(&kept_app).expect("kept app dir");
    let other = temp.path().join("someone-else");
    std::fs::create_dir(&other).expect("other dir");
    let link = temp.path().join("platevault-update-payload-link");
    std::os::unix::fs::symlink(&other, &link).expect("symlink");

    signature::remove_stale_payloads_in(temp.path(), std::time::SystemTime::now());
    assert!(payload.exists(), "a fresh payload stays: an installer may still read it");

    let in_two_days = std::time::SystemTime::now() + Duration::from_hours(48);
    signature::remove_stale_payloads_in(temp.path(), in_two_days);
    assert!(!payload.exists(), "a day-old payload goes");
    assert!(kept_app.exists(), "a previous app the swap kept is never touched");
    assert!(other.exists());
    assert!(std::fs::symlink_metadata(&link).is_ok(), "a symlink is neither followed nor removed");
}

// ── Install now, install on quit, and the quit gate ────────────────────────

#[tokio::test]
async fn a_handoff_install_exits_for_the_installer() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let installer = FakeInstaller::answering(vec![Ok(Installed::Handoff)]);
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;
    rig.updater.install_now().await;
    assert_eq!(rig.host_calls(), vec![HostCall::Exit]);
    assert_eq!(
        rig.updater.on_quit_requested(),
        QuitDecision::Proceed,
        "the exit the install asked for goes through"
    );
}

#[tokio::test]
async fn a_failed_install_keeps_the_verified_payload_for_a_retry() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let installer = FakeInstaller::answering(vec![
        Err(UpdateError::Install("disk full".to_owned())),
        Ok(Installed::Relaunch),
    ]);
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;

    rig.updater.install_now().await;
    let status = rig.updater.current_status();
    assert_eq!(status.phase, UpdatePhase::InstallFailed);
    assert_eq!(status.error, Some(UpdateFailure::Install));
    assert_eq!(rig.updater.error_text().as_deref(), Some("disk full"));
    assert!(rig.host_calls().is_empty(), "no relaunch after a failed install");

    rig.updater.install_now().await;
    assert_eq!(source.downloads(), 1, "the retry reuses the verified payload");
    assert_eq!(installer.calls().len(), 2);
    assert_eq!(rig.host_calls(), vec![HostCall::Relaunch]);
}

/// Start Install now with an installer that blocks until the returned sender
/// sends or drops and then answers `result`, and wait until it runs.
async fn install_now_blocked(
    result: Result<Installed, UpdateError>,
) -> (Rig, mpsc::Sender<()>, tokio::task::JoinHandle<()>) {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let (installer, release_install) = FakeInstaller::blocked();
    installer.results.lock().expect("results").push_back(result);
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;
    let updater = rig.updater.clone();
    let install = tokio::spawn(async move { updater.install_now().await });
    let started = std::time::Instant::now();
    while installer.calls().is_empty() {
        assert!(started.elapsed() < WAIT, "the install started");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    (rig, release_install, install)
}

#[tokio::test]
async fn a_quit_during_install_now_exits_once_a_failed_install_is_over() {
    let (rig, release_install, install) =
        install_now_blocked(Err(UpdateError::Install("disk full".to_owned()))).await;

    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Defer, "held mid-install");
    assert!(rig.host.recv_timeout(Duration::from_millis(100)).is_err(), "no exit mid-install");
    release_install.send(()).expect("release the install");
    install.await.expect("install task");

    assert_eq!(rig.host_calls(), vec![HostCall::Exit], "the held quit is not lost");
}

#[tokio::test]
async fn a_quit_during_install_now_exits_instead_of_relaunching() {
    let (rig, release_install, install) = install_now_blocked(Ok(Installed::Relaunch)).await;

    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Defer);
    release_install.send(()).expect("release the install");
    install.await.expect("install task");

    assert_eq!(rig.host_calls(), vec![HostCall::Exit], "the user asked to quit");
}

#[tokio::test]
async fn nothing_installs_from_a_build_without_a_package() {
    let signer = Signer::new();
    let signature = signer.sign(b"new AppImage");
    // A build without a package looks up the bare platform key.
    let source = FakeSource::new(
        Some(manifest_json(RELEASE, &[("linux-x86_64", PAYLOAD_URL, &signature)])),
        b"new AppImage",
    );
    let installer = FakeInstaller::answering(vec![]);
    let rig = Rig::build(&signer, &source, Box::new(Arc::clone(&installer)), None, WAIT);

    rig.updater.check().await;
    assert_eq!(rig.phase(), UpdatePhase::Available, "it can still check");
    rig.updater.install_now().await;

    let status = rig.updater.current_status();
    assert_eq!(status.phase, UpdatePhase::DownloadFailed);
    assert_eq!(status.error, Some(UpdateFailure::Unsupported));
    assert!(rig
        .updater
        .error_text()
        .expect("detail")
        .contains("not installed from a release package"));
    assert_eq!(source.downloads(), 0);
    assert!(installer.calls().is_empty(), "nothing reaches the installer");
}

#[tokio::test]
async fn install_on_quit_stages_the_payload_without_installing() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let installer = FakeInstaller::answering(vec![]);
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;

    rig.updater.install_on_quit().await;

    assert_eq!(rig.phase(), UpdatePhase::InstallOnQuit);
    assert_eq!(source.downloads(), 1);
    assert!(installer.calls().is_empty(), "nothing installs before the quit");
    rig.updater.check().await;
    assert_eq!(source.manifest_requests(), 1, "a re-check never drops the staged update");
    assert_eq!(rig.phase(), UpdatePhase::InstallOnQuit);
}

#[tokio::test]
async fn the_first_quit_installs_the_staged_update_then_exits() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let installer = FakeInstaller::answering(vec![]);
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;
    rig.updater.install_on_quit().await;

    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Defer);
    assert_eq!(rig.next_host_call(), HostCall::Exit);

    assert_eq!(installer.calls(), vec![(InstallMode::OnQuit, b"new AppImage".to_vec())]);
    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Proceed, "the exit goes through");
}

#[tokio::test]
async fn a_quit_with_nothing_staged_proceeds() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));
    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Proceed);
    rig.updater.check().await;
    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Proceed, "found, not chosen");
}

#[tokio::test]
async fn quits_during_the_install_at_quit_are_held_until_it_finishes() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let (installer, release_install) = FakeInstaller::blocked();
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;
    rig.updater.install_on_quit().await;

    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Defer);
    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Defer, "a second quit is held");
    assert_eq!(rig.phase(), UpdatePhase::Installing);
    assert!(rig.host.recv_timeout(Duration::from_millis(100)).is_err(), "no exit mid-install");

    release_install.send(()).expect("release the install");
    assert_eq!(rig.next_host_call(), HostCall::Exit);
}

#[tokio::test]
async fn a_hung_install_at_quit_exits_once_at_the_ceiling() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let (installer, release_install) = FakeInstaller::blocked();
    let rig = Rig::build(
        &signer,
        &source,
        Box::new(Arc::clone(&installer)),
        Some(Package::AppImage),
        Duration::from_millis(50),
    );
    rig.updater.check().await;
    rig.updater.install_on_quit().await;

    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Defer);
    assert_eq!(rig.next_host_call(), HostCall::Exit, "the watchdog exits");

    release_install.send(()).expect("release the install");
    assert!(
        rig.host.recv_timeout(Duration::from_millis(200)).is_err(),
        "the late install does not exit a second time"
    );
}

#[tokio::test]
async fn a_failed_install_at_quit_still_exits() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let installer = FakeInstaller::answering(vec![Err(UpdateError::Install("denied".to_owned()))]);
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;
    rig.updater.install_on_quit().await;

    assert_eq!(rig.updater.on_quit_requested(), QuitDecision::Defer);
    assert_eq!(rig.next_host_call(), HostCall::Exit);
}

#[tokio::test]
async fn install_now_after_install_on_quit_installs_at_once() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let installer = FakeInstaller::answering(vec![]);
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;
    rig.updater.install_on_quit().await;

    rig.updater.install_now().await;

    assert_eq!(source.downloads(), 1);
    assert_eq!(installer.calls(), vec![(InstallMode::Now, b"new AppImage".to_vec())]);
    assert_eq!(rig.host_calls(), vec![HostCall::Relaunch]);
}

#[tokio::test]
async fn download_stages_the_payload_and_keeps_offering_both_choices() {
    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let installer = FakeInstaller::answering(vec![]);
    let rig = Rig::new(&signer, &source, Box::new(Arc::clone(&installer)));
    rig.updater.check().await;

    assert!(rig.updater.download().await);
    assert_eq!(rig.phase(), UpdatePhase::Available);
    rig.updater.install_on_quit().await;
    assert_eq!(source.downloads(), 1, "the choice reuses the staged payload");
    assert_eq!(rig.phase(), UpdatePhase::InstallOnQuit);
}

#[tokio::test]
async fn the_status_feed_starts_with_the_current_status() {
    use crate::channels::Feed as _;

    let signer = Signer::new();
    let source = FakeSource::release(&signer, b"new AppImage");
    let rig = Rig::new(&signer, &source, Box::new(FakeInstaller::answering(vec![])));
    rig.updater.check().await;

    let mut feed = rig.updater.status();
    let first = feed.next().await.expect("status");
    assert_eq!(first.phase, UpdatePhase::Available);
}

// ── What the UI is told ─────────────────────────────────────────────────────

#[test]
fn every_error_reaches_the_ui_as_a_code() {
    let io = |kind| UpdateError::Io(std::io::Error::from(kind));
    let cases = [
        (UpdateError::Config(String::new()), UpdateFailure::Unsupported),
        (UpdateError::Unsupported(String::new()), UpdateFailure::Unsupported),
        (UpdateError::Network(String::new()), UpdateFailure::Network),
        (UpdateError::Manifest(String::new()), UpdateFailure::Manifest),
        (UpdateError::Signature(String::new()), UpdateFailure::Signature),
        (UpdateError::Identity(String::new()), UpdateFailure::Identity),
        (UpdateError::Permission(String::new()), UpdateFailure::Permission),
        (UpdateError::Install(String::new()), UpdateFailure::Install),
        (io(std::io::ErrorKind::PermissionDenied), UpdateFailure::Permission),
        (io(std::io::ErrorKind::StorageFull), UpdateFailure::FileSystem),
    ];
    for (error, failure) in cases {
        assert_eq!(error.failure(), failure, "{error:?}");
    }
}

#[test]
fn a_previous_app_that_was_not_put_back_is_named_to_the_ui() {
    let error = UpdateError::PreviousAppNotRestored {
        kept: std::path::PathBuf::from("/Applications/PlateVault (previous version).app"),
        cause: Box::new(UpdateError::Install("disk full".to_owned())),
    };
    assert_eq!(
        error.failure(),
        UpdateFailure::PreviousAppNotRestored {
            kept_at: "/Applications/PlateVault (previous version).app".to_owned()
        }
    );
    assert_eq!(
        error.to_string(),
        "disk full; the previous app could not be put back and is kept at /Applications/PlateVault (previous version).app"
    );
}

#[test]
fn the_status_serializes_its_failure_as_a_tagged_code() {
    let status = super::UpdateStatus {
        error: Some(UpdateFailure::PreviousAppNotRestored { kept_at: "/tmp/x.app".to_owned() }),
        ..super::UpdateStatus::idle()
    };
    assert_eq!(
        serde_json::to_value(&status).expect("json")["error"],
        json!({ "code": "previous-app-not-restored", "keptAt": "/tmp/x.app" })
    );
    let network =
        super::UpdateStatus { error: Some(UpdateFailure::Network), ..super::UpdateStatus::idle() };
    assert_eq!(
        serde_json::to_value(&network).expect("json")["error"],
        json!({ "code": "network" })
    );
}

// ── Configuration ───────────────────────────────────────────────────────────

struct NoHost;

impl UpdateHost for NoHost {
    fn relaunch(&self) {}
    fn exit(&self) {}
}

fn config(endpoint: &str, public_key: String) -> UpdaterConfig {
    UpdaterConfig {
        current_version: Version::parse(RUNNING).expect("version"),
        endpoints: vec![endpoint.to_owned()],
        public_key,
        platform: Platform::current(None),
    }
}

#[test]
fn an_endpoint_that_is_not_https_is_rejected() {
    let error =
        Updater::new(config("http://example.test/latest.json", Signer::new().public_key()), NoHost)
            .err()
            .expect("rejected");
    assert!(matches!(error, UpdateError::Config(_)), "{error}");
}

#[test]
fn a_public_key_that_is_not_minisign_is_rejected() {
    let error =
        Updater::new(config("https://example.test/latest.json", base64("not a key")), NoHost)
            .err()
            .expect("rejected");
    assert!(matches!(error, UpdateError::Config(_)), "{error}");
}

#[test]
fn the_shipped_public_key_decodes() {
    // `plugins.updater.pubkey` in apps/desktop/src-tauri/tauri.conf.json.
    let shipped = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEMzMzJFRjQzNUMxNkVBNTgKUldSWTZoWmNRKzh5d3hnZGNJSUl5dkpiN2RuQTVPYUcycHp6SzN1d0tIWWtWNG1vSGZ6bXE2cnYK";
    assert!(TrustedKey::from_config(shipped).is_ok());
}

// ── The macOS bundle swap and its designated-requirement check (D4) ─────────

#[cfg(unix)]
mod bundle {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use flate2::write::GzEncoder;
    use flate2::Compression;

    use super::{
        manifest_json, FakeSource, HostCall, Rig, Signer, UpdatePhase, UpdatePort as _, RELEASE,
        WAIT,
    };
    use crate::update::install::{BundleInstaller, CodeSigning, Identity};
    use crate::update::{Package, UpdateError};

    const REQUIREMENT: &str =
        r#"identifier "dev.astro-plan.astro-library-manager" and certificate leaf = H"abc""#;

    /// Code signing that reports `installed` for the installed app and accepts
    /// `accepted` for the update, recording the update bundle it checked.
    struct FakeSigning {
        installed: Identity,
        accepted: &'static str,
        identity_calls: AtomicUsize,
        checked: Mutex<Vec<String>>,
    }

    impl FakeSigning {
        fn new(installed: Identity, accepted: &'static str) -> Arc<Self> {
            Arc::new(Self {
                installed,
                accepted,
                identity_calls: AtomicUsize::new(0),
                checked: Mutex::default(),
            })
        }

        fn consulted(&self) -> bool {
            self.identity_calls.load(Ordering::SeqCst) > 0
                || !self.checked.lock().expect("checked").is_empty()
        }
    }

    impl CodeSigning for Arc<FakeSigning> {
        fn identity(&self, _bundle: &Path) -> Result<Identity, UpdateError> {
            self.identity_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.installed.clone())
        }

        fn satisfies(&self, bundle: &Path, requirement: &str) -> Result<bool, UpdateError> {
            self.checked.lock().expect("checked").push(marker(bundle));
            Ok(requirement == self.accepted)
        }
    }

    fn marker(bundle: &Path) -> String {
        std::fs::read_to_string(bundle.join("Contents/marker")).expect("marker")
    }

    /// An installed `PlateVault.app` whose marker reads `old`.
    fn installed_app(dir: &Path) -> PathBuf {
        let app = dir.join("Applications/PlateVault.app");
        std::fs::create_dir_all(app.join("Contents")).expect("installed app");
        std::fs::write(app.join("Contents/marker"), "old").expect("marker");
        app
    }

    /// A `.app.tar.gz` holding a `PlateVault.app` whose marker reads `new`.
    fn update_archive() -> Vec<u8> {
        let mut archive = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        let mut header = tar::Header::new_gnu();
        header.set_size(3);
        header.set_mode(0o644);
        header.set_cksum();
        archive
            .append_data(&mut header, "PlateVault.app/Contents/marker", &b"new"[..])
            .expect("entry");
        archive.into_inner().expect("tar").finish().expect("gzip")
    }

    /// Check, then Install now through the bundle installer, with the
    /// archive signed by the trusted key, or by another when `bad_signature`.
    async fn install(
        signing: &Arc<FakeSigning>,
        bad_signature: bool,
    ) -> (Rig, PathBuf, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let app = installed_app(dir.path());
        let signer = Signer::new();
        let archive = update_archive();
        let signature =
            if bad_signature { Signer::new().sign(&archive) } else { signer.sign(&archive) };
        let source = FakeSource::new(
            Some(manifest_json(
                RELEASE,
                &[("linux-x86_64-app", "https://example.test/app.tar.gz", &signature)],
            )),
            &archive,
        );
        let bundle_installer =
            BundleInstaller { installed: app.clone(), signing: Arc::clone(signing) };
        let rig =
            Rig::build(&signer, &source, Box::new(bundle_installer), Some(Package::App), WAIT);
        rig.updater.check().await;
        assert_eq!(rig.phase(), UpdatePhase::Available);
        rig.updater.install_now().await;
        (rig, app, dir)
    }

    #[tokio::test]
    async fn an_update_that_satisfies_the_designated_requirement_installs() {
        let signing = FakeSigning::new(Identity::Designated(REQUIREMENT.to_owned()), REQUIREMENT);
        let (rig, installed, _dir) = install(&signing, false).await;
        assert_eq!(marker(&installed), "new");
        assert_eq!(
            *signing.checked.lock().expect("checked"),
            ["new"],
            "the update bundle is checked"
        );
        assert_eq!(rig.host_calls(), vec![HostCall::Relaunch]);
    }

    #[tokio::test]
    async fn an_update_that_fails_the_designated_requirement_keeps_the_installed_app() {
        let signing =
            FakeSigning::new(Identity::Designated(REQUIREMENT.to_owned()), "another identity");
        let (rig, installed, _dir) = install(&signing, false).await;
        assert_eq!(marker(&installed), "old");
        let status = rig.updater.current_status();
        assert_eq!(status.phase, UpdatePhase::InstallFailed);
        assert_eq!(status.error, Some(crate::update::UpdateFailure::Identity));
        assert!(rig.updater.error_text().expect("detail").contains("not signed by the identity"));
        assert!(rig.host_calls().is_empty(), "no relaunch");
    }

    #[tokio::test]
    async fn an_ad_hoc_installed_app_skips_the_requirement_check() {
        for identity in [Identity::AdHoc, Identity::Unsigned] {
            let signing = FakeSigning::new(identity.clone(), "never asked");
            let (rig, installed, _dir) = install(&signing, false).await;
            assert_eq!(marker(&installed), "new", "{identity:?}");
            assert!(
                signing.checked.lock().expect("checked").is_empty(),
                "{identity:?}: no requirement check"
            );
            assert_eq!(rig.host_calls(), vec![HostCall::Relaunch], "{identity:?}");
        }
    }

    #[tokio::test]
    async fn a_bad_minisign_signature_refuses_the_update_for_every_identity() {
        for (identity, accepted) in [
            (Identity::Designated(REQUIREMENT.to_owned()), REQUIREMENT),
            (Identity::Designated(REQUIREMENT.to_owned()), "another identity"),
            (Identity::AdHoc, "never asked"),
            (Identity::Unsigned, "never asked"),
        ] {
            let signing = FakeSigning::new(identity.clone(), accepted);
            let (rig, installed, _dir) = install(&signing, true).await;
            assert_eq!(rig.phase(), UpdatePhase::DownloadFailed, "{identity:?}");
            assert_eq!(marker(&installed), "old", "{identity:?}");
            assert!(!signing.consulted(), "{identity:?}: refused before any bundle check");
            assert!(rig.host_calls().is_empty(), "{identity:?}");
        }
    }

    #[test]
    fn an_archive_without_an_app_bundle_is_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let installed = installed_app(dir.path());
        let mut archive = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        let mut header = tar::Header::new_gnu();
        header.set_size(3);
        header.set_mode(0o644);
        header.set_cksum();
        archive.append_data(&mut header, "README", &b"new"[..]).expect("entry");
        let archive = archive.into_inner().expect("tar").finish().expect("gzip");

        let signing = FakeSigning::new(Identity::AdHoc, "never asked");
        let error = crate::update::install::install_bundle(&installed, &archive[..], &signing)
            .expect_err("refused");
        assert!(
            matches!(&error, crate::update::UpdateError::Manifest(message) if message.contains("exactly one app bundle")),
            "{error}"
        );
        assert_eq!(marker(&installed), "old");
    }
}
