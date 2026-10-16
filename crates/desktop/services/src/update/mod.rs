// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Signed software updates (spec 051 US10, astro-plan-5wcib).
//!
//! The update flow runs here, not in the UI. The UI shows the
//! [`UpdateStatus`] this module publishes through [`UpdatePort::status`] and
//! calls the [`UpdatePort`] operations when the user picks an action; the
//! system-notification actions (astro-plan-c72oo) call the same operations.
//!
//! The client reads the release's `latest.json`, the manifest
//! `tauri-plugin-updater` clients already read, and checks each payload's
//! minisign signature against the key the app embeds before anything is
//! installed. One client serves every OS (decision astro-plan-eub2i):
//!
//! - **Windows**: the NSIS or MSI installer runs, and the app exits for it.
//! - **macOS**: the new `.app` replaces the installed one, but only when it
//!   satisfies the installed app's designated requirement. That check is
//!   skipped while the installed copy is ad-hoc signed, which has no stable
//!   identity to pin, so the move to the self-signed identity can happen.
//! - **Linux**: an `AppImage` replaces itself; a deb or rpm is installed with
//!   `pkexec`, so the polkit prompt appears only after the user chose Install.
//!
//! An install step that runs as root, behind polkit or the macOS
//! administrator prompt, checks the payload again once it holds those rights
//! (astro-plan-ryj83; see `install`). The Windows installers, which UAC
//! elevates, are not re-checked after the prompt: the handle the app verified
//! keeps ordinary writers out until they exit, but not code that runs as the
//! user.
//!
//! Nothing is downloaded until the user chooses Install now or Install on
//! quit. A check never downloads, and the startup check runs only while
//! "Check for updates automatically" is on.
//!
//! What the updater says outside the webview, the macOS administrator prompt
//! and the notification an install at quit raises, follows the webview's
//! locale ([`Updater::set_locale`]).

mod http;
mod install;
mod manifest;
pub mod offer;
mod signature;
#[cfg(test)]
mod tests;
mod wording;

use std::fmt;
use std::future::Future;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

pub use contracts_core::updates::{UpdateFailure, UpdatePhase, UpdateStatus};
use reqwest::Url;
use semver::Version;
use tokio::sync::watch;

use self::http::{Http, Source};
use self::install::{InstallMode, Installed, Installer, OsInstaller};
use self::manifest::Release;
use self::signature::{Staged, TrustedKey};
use self::wording::{Notice, Wording};
use crate::channels::Latest;
use crate::locale::{self, ShippedLocale};

/// The longest an install at quit may hold the quit. Long enough for the
/// slowest legitimate case, a deb or rpm install waiting on its polkit
/// prompt; after it the app exits whatever the install is doing.
const QUIT_INSTALL_CEILING: Duration = Duration::from_secs(300);

/// How the running copy was installed, which picks its manifest entry and its
/// install step.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Package {
    /// A macOS `.app`, updated from its `.app.tar.gz`.
    App,
    AppImage,
    Deb,
    Rpm,
    Nsis,
    Msi,
}

impl Package {
    /// The bundle name in `latest.json` keys (`{os}-{arch}-{bundle}`).
    const fn manifest_name(self) -> &'static str {
        match self {
            Self::App => "app",
            Self::AppImage => "appimage",
            Self::Deb => "deb",
            Self::Rpm => "rpm",
            Self::Nsis => "nsis",
            Self::Msi => "msi",
        }
    }

    /// The staged payload's file name; the installers that run it go by the
    /// extension.
    const fn payload_file_name(self) -> &'static str {
        match self {
            Self::App => "update.app.tar.gz",
            Self::AppImage => "update.AppImage",
            Self::Deb => "update.deb",
            Self::Rpm => "update.rpm",
            Self::Nsis => "update-setup.exe",
            Self::Msi => "update.msi",
        }
    }
}

/// The machine the updater serves.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Platform {
    os: &'static str,
    arch: &'static str,
    package: Option<Package>,
}

impl Platform {
    /// This build's OS and architecture, installed as `package`: `None` for a
    /// build no installer produced, such as `cargo run`, which can check for
    /// updates but not install them.
    #[must_use]
    pub const fn current(package: Option<Package>) -> Self {
        let os = if cfg!(target_os = "macos") {
            "darwin"
        } else if cfg!(target_os = "windows") {
            "windows"
        } else {
            "linux"
        };
        let arch = if cfg!(target_arch = "aarch64") {
            "aarch64"
        } else if cfg!(target_arch = "x86") {
            "i686"
        } else if cfg!(target_arch = "arm") {
            "armv7"
        } else {
            "x86_64"
        };
        Self { os, arch, package }
    }

    /// The `latest.json` keys to look this platform up under, most specific
    /// first.
    fn manifest_keys(&self) -> Vec<String> {
        let (os, arch) = (self.os, self.arch);
        self.package
            .map(|package| format!("{os}-{arch}-{}", package.manifest_name()))
            .into_iter()
            .chain([format!("{os}-{arch}")])
            .collect()
    }
}

/// What [`Updater::new`] needs from the host.
#[derive(Clone, Debug)]
pub struct UpdaterConfig {
    /// The running app's version.
    pub current_version: Version,
    /// HTTPS URLs of the manifest, tried in order.
    pub endpoints: Vec<String>,
    /// The minisign public key every payload must be signed with: base64 of a
    /// minisign public key file, as `tauri.conf.json` stores it.
    pub public_key: String,
    pub platform: Platform,
}

/// The host side of an install: the updater asks, the host owns the process.
pub trait UpdateHost: Send + Sync + 'static {
    /// Restart into the version that was just installed.
    fn relaunch(&self);
    /// Exit the app: an installer took over, or the install at quit is over.
    fn exit(&self);
    /// Show an OS notification of `title` and `body`, for what an install
    /// must tell the user while the app quits, and return once the OS has it
    /// or after a short wait: [`Self::exit`] follows.
    fn notify(&self, title: &str, body: &str);
}

/// What the host does with a quit request, from [`Updater::on_quit_requested`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum QuitDecision {
    Proceed,
    /// Hold the quit: an install is running and calls [`UpdateHost::exit`]
    /// when it is over.
    Defer,
}

/// The update operations the UI and the notification actions call
/// (R10 §4.4). Each one publishes its progress through [`Self::status`].
pub trait UpdatePort: Send + Sync {
    /// The current status first, then each change.
    fn status(&self) -> Latest<UpdateStatus>;

    /// Ask the endpoint whether a newer release exists. Never downloads. A
    /// no-op while a download or install the user chose is under way.
    fn check(&self) -> impl Future<Output = ()> + Send;

    /// Download and verify the release the last check found, without
    /// installing it. Returns whether a verified payload is staged.
    fn download(&self) -> impl Future<Output = bool> + Send;

    /// Download and verify if needed, install, then relaunch into the new
    /// version (or, on Windows, exit for the installer).
    fn install_now(&self) -> impl Future<Output = ()> + Send;

    /// Download and verify now; install when the app quits.
    fn install_on_quit(&self) -> impl Future<Output = ()> + Send;
}

/// Why an update step failed. The message is English detail for the log;
/// the UI shows [`Self::failure`].
#[derive(Debug)]
pub enum UpdateError {
    /// The host configuration is unusable.
    Config(String),
    Network(String),
    Manifest(String),
    /// The payload's signature is missing, malformed or does not verify.
    Signature(String),
    /// The new macOS bundle does not satisfy the installed app's designated
    /// requirement.
    Identity(String),
    /// The OS refused an install step its permission, or the user did not
    /// give it.
    Permission(String),
    Install(String),
    /// This copy cannot install updates.
    Unsupported(String),
    /// `cause` failed the install, and the previous app could not be put
    /// back: it is at `kept`.
    PreviousAppNotRestored {
        kept: PathBuf,
        cause: Box<Self>,
    },
    Io(io::Error),
}

impl UpdateError {
    /// What the UI shows for this error.
    #[must_use]
    pub fn failure(&self) -> UpdateFailure {
        match self {
            Self::Config(_) | Self::Unsupported(_) => UpdateFailure::Unsupported,
            Self::Network(_) => UpdateFailure::Network,
            Self::Manifest(_) => UpdateFailure::Manifest,
            Self::Signature(_) => UpdateFailure::Signature,
            Self::Identity(_) => UpdateFailure::Identity,
            Self::Permission(_) => UpdateFailure::Permission,
            Self::Install(_) => UpdateFailure::Install,
            Self::PreviousAppNotRestored { kept, .. } => {
                UpdateFailure::PreviousAppNotRestored { kept_at: kept.display().to_string() }
            }
            Self::Io(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                UpdateFailure::Permission
            }
            Self::Io(_) => UpdateFailure::FileSystem,
        }
    }
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Config(message)
            | Self::Network(message)
            | Self::Manifest(message)
            | Self::Signature(message)
            | Self::Identity(message)
            | Self::Permission(message)
            | Self::Install(message)
            | Self::Unsupported(message) => f.write_str(message),
            Self::PreviousAppNotRestored { kept, cause } => write!(
                f,
                "{cause}; the previous app could not be put back and is kept at {}",
                kept.display()
            ),
            Self::Io(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<io::Error> for UpdateError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// The updater of one process. Cheap to clone; clones share one flow.
#[derive(Clone)]
pub struct Updater {
    inner: Arc<Inner>,
}

struct Inner {
    current_version: Version,
    endpoints: Vec<Url>,
    key: TrustedKey,
    platform: Platform,
    source: Box<dyn Source>,
    installer: Box<dyn Installer>,
    host: Box<dyn UpdateHost>,
    quit_install_ceiling: Duration,
    state: Mutex<State>,
    status: watch::Sender<UpdateStatus>,
    startup_checked: AtomicBool,
    /// What the updater says outside the webview, in the webview's locale.
    wording: Mutex<Wording>,
}

/// The update flow. Every transition happens under the state lock, so an
/// operation that finds a state it does not act on is a no-op.
enum State {
    Idle,
    Checking,
    UpToDate,
    CheckFailed(UpdateError),
    /// Found by the last check; `staged` once [`UpdatePort::download`] ran.
    Available {
        release: Release,
        staged: Option<Arc<Staged>>,
    },
    Downloading {
        release: Release,
    },
    DownloadFailed {
        release: Release,
        error: UpdateError,
    },
    Installing {
        release: Release,
        run: Run,
    },
    /// The verified payload stays staged, so a retry installs it again.
    InstallFailed {
        release: Release,
        staged: Arc<Staged>,
        error: UpdateError,
    },
    InstallOnQuit {
        release: Release,
        staged: Arc<Staged>,
    },
    /// The install is over and the host is exiting or relaunching.
    Exiting,
}

/// Which install is running, which decides what follows it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Run {
    /// The user chose Install now. `quit_held` once a quit arrived while it
    /// runs: the app then exits when it is over, whether it worked or not.
    Now { quit_held: bool },
    /// The install the first quit started.
    AtQuit,
}

impl State {
    /// What the UI shows for this state; `None` for [`Self::Exiting`], which
    /// keeps the last status shown.
    fn status(&self) -> Option<UpdateStatus> {
        let (phase, release, error) = match self {
            Self::Idle => (UpdatePhase::Idle, None, None),
            Self::Checking => (UpdatePhase::Checking, None, None),
            Self::UpToDate => (UpdatePhase::UpToDate, None, None),
            Self::CheckFailed(error) => (UpdatePhase::CheckFailed, None, Some(error)),
            Self::Available { release, .. } => (UpdatePhase::Available, Some(release), None),
            Self::Downloading { release } => (UpdatePhase::Downloading, Some(release), None),
            Self::DownloadFailed { release, error } => {
                (UpdatePhase::DownloadFailed, Some(release), Some(error))
            }
            Self::Installing { release, .. } => (UpdatePhase::Installing, Some(release), None),
            Self::InstallFailed { release, error, .. } => {
                (UpdatePhase::InstallFailed, Some(release), Some(error))
            }
            Self::InstallOnQuit { release, .. } => {
                (UpdatePhase::InstallOnQuit, Some(release), None)
            }
            Self::Exiting => return None,
        };
        Some(UpdateStatus {
            phase,
            version: release.map(|release| release.version_text.clone()),
            body: release.and_then(|release| release.notes.clone()),
            error: error.map(UpdateError::failure),
        })
    }

    /// Whether a check may replace this state: not while a check, or a
    /// download or install the user chose, is under way.
    const fn accepts_check(&self) -> bool {
        matches!(
            self,
            Self::Idle
                | Self::UpToDate
                | Self::CheckFailed(_)
                | Self::Available { .. }
                | Self::DownloadFailed { .. }
                | Self::InstallFailed { .. }
        )
    }
}

/// What a download is for.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Intent {
    Stage,
    InstallNow,
    InstallOnQuit,
}

impl Intent {
    /// The state once the payload is staged.
    fn staged(self, release: Release, staged: Arc<Staged>) -> State {
        match self {
            Self::Stage => State::Available { release, staged: Some(staged) },
            Self::InstallNow => State::Installing { release, run: Run::Now { quit_held: false } },
            Self::InstallOnQuit => State::InstallOnQuit { release, staged },
        }
    }
}

impl Updater {
    /// An updater for the app `config` describes, installing through the OS
    /// installer for `config.platform` and asking `host` to relaunch or exit.
    ///
    /// # Errors
    ///
    /// An endpoint that is not an HTTPS URL, a public key that is not a
    /// minisign key, or an HTTP client that cannot be built.
    pub fn new(config: UpdaterConfig, host: impl UpdateHost) -> Result<Self, UpdateError> {
        let endpoints = config
            .endpoints
            .iter()
            .map(|endpoint| match Url::parse(endpoint) {
                Ok(url) if url.scheme() == "https" => Ok(url),
                _ => Err(UpdateError::Config(format!(
                    "the update endpoint {endpoint} is not an HTTPS URL"
                ))),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let source = Http::new(&format!("PlateVault/{}", config.current_version))?;
        Ok(Self::assemble(Parts {
            current_version: config.current_version,
            endpoints,
            key: TrustedKey::from_config(&config.public_key)?,
            installer: Box::new(OsInstaller::new(config.platform.package)),
            platform: config.platform,
            source: Box::new(source),
            host: Box::new(host),
            quit_install_ceiling: QUIT_INSTALL_CEILING,
            wording: Wording::in_locale(locale::base().tag).map_err(UpdateError::Config)?,
        }))
    }

    fn assemble(parts: Parts) -> Self {
        let (status, _) = watch::channel(UpdateStatus::idle());
        Self {
            inner: Arc::new(Inner {
                current_version: parts.current_version,
                endpoints: parts.endpoints,
                key: parts.key,
                platform: parts.platform,
                source: parts.source,
                installer: parts.installer,
                host: parts.host,
                quit_install_ceiling: parts.quit_install_ceiling,
                state: Mutex::new(State::Idle),
                status,
                startup_checked: AtomicBool::new(false),
                wording: Mutex::new(parts.wording),
            }),
        }
    }

    /// Speak the webview's locale, `tag`, outside it: in the macOS
    /// administrator prompt and the notification an install at quit raises.
    /// The webview sends its locale at start and on every change; a tag that
    /// is not a shipped locale means the base locale.
    pub fn set_locale(&self, tag: &str) {
        match Wording::in_locale(tag) {
            Ok(wording) => *self.wording() = wording,
            Err(error) => tracing::warn!(%error, tag, "the updater keeps its previous language"),
        }
    }

    /// The locale [`Self::set_locale`] last chose, for other text the backend
    /// shows about updates.
    #[must_use]
    pub fn locale(&self) -> &'static ShippedLocale {
        self.wording().locale()
    }

    fn wording(&self) -> MutexGuard<'_, Wording> {
        self.inner.wording.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The status the UI should show now.
    #[must_use]
    pub fn current_status(&self) -> UpdateStatus {
        self.inner.status.borrow().clone()
    }

    /// The check at app start: runs once per process, and only when
    /// `automatic` ("Check for updates automatically") is on. With it off,
    /// nothing contacts the update endpoint until the user checks. Either
    /// way, it first removes payloads earlier runs left in the temp dir.
    pub async fn check_on_startup(&self, automatic: bool) {
        if self.inner.startup_checked.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = tokio::task::spawn_blocking(signature::remove_stale_payloads).await;
        if !automatic {
            return;
        }
        self.check().await;
    }

    /// Decide a quit. With an install on quit staged, the quit is held while
    /// the install runs on its own thread, and [`UpdateHost::exit`] follows
    /// once it is over or after [`QUIT_INSTALL_CEILING`]. A quit while an
    /// install runs is held too, so the app is never stopped half-installed;
    /// once an Install now it held is over, the app exits instead of
    /// relaunching, whether the install worked or not. Nothing is persisted,
    /// so after a failed install the next launch's check offers the update
    /// again.
    #[must_use = "a deferred quit must be prevented"]
    pub fn on_quit_requested(&self) -> QuitDecision {
        let mut state = self.lock();
        match &mut *state {
            State::InstallOnQuit { release, staged } => {
                let staged = Arc::clone(staged);
                let release = release.clone();
                let admin_prompt = self.wording().admin_prompt(&release.version_text);
                self.set(&mut state, State::Installing { release, run: Run::AtQuit });
                drop(state);
                self.spawn_install_on_quit(staged, admin_prompt);
                QuitDecision::Defer
            }
            State::Installing { run: Run::Now { quit_held }, .. } => {
                *quit_held = true;
                QuitDecision::Defer
            }
            State::Installing { run: Run::AtQuit, .. } => QuitDecision::Defer,
            _ => QuitDecision::Proceed,
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.inner.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Enter [`State::Checking`] when the current state accepts a check.
    fn begin_check(&self) -> bool {
        let mut state = self.lock();
        if !state.accepts_check() {
            return false;
        }
        self.set(&mut state, State::Checking);
        drop(state);
        true
    }

    /// Enter `next` and publish its status.
    fn set(&self, state: &mut State, next: State) {
        *state = next;
        if let Some(status) = state.status() {
            self.inner.status.send_replace(status);
        }
    }

    /// The newer release the first answering endpoint announces.
    async fn fetch_release(&self) -> Result<Option<Release>, UpdateError> {
        let inner = &*self.inner;
        let mut failure = UpdateError::Config("no update endpoint is configured".to_owned());
        for url in &inner.endpoints {
            let found = match inner.source.manifest(url).await {
                Ok(None) => return Ok(None),
                Ok(Some(manifest)) => {
                    manifest::newer_release(&manifest, &inner.current_version, &inner.platform)
                }
                Err(error) => Err(error),
            };
            match found {
                Ok(release) => return Ok(release),
                Err(error) => {
                    tracing::warn!(endpoint = %url, %error, "update endpoint failed");
                    failure = error;
                }
            }
        }
        Err(failure)
    }

    /// Take the release the user may install toward `intent`, downloading
    /// and verifying it first when nothing is staged. Returns whether a
    /// verified payload is staged.
    async fn advance(&self, intent: Intent) -> bool {
        let (release, staged) = {
            let mut state = self.lock();
            let (release, staged) = match &*state {
                State::Available { release, staged } => (release.clone(), staged.clone()),
                State::DownloadFailed { release, .. } => (release.clone(), None),
                State::InstallFailed { release, staged, .. } => {
                    (release.clone(), Some(Arc::clone(staged)))
                }
                State::InstallOnQuit { release, staged } if intent == Intent::InstallNow => {
                    (release.clone(), Some(Arc::clone(staged)))
                }
                State::InstallOnQuit { .. } => return true,
                _ => return false,
            };
            let next = match &staged {
                Some(staged) => intent.staged(release.clone(), Arc::clone(staged)),
                None => State::Downloading { release: release.clone() },
            };
            self.set(&mut state, next);
            drop(state);
            (release, staged)
        };

        let staged = if let Some(staged) = staged {
            staged
        } else {
            let package = self.inner.platform.package;
            let downloaded = match package {
                Some(package) => {
                    signature::download_verified(
                        &*self.inner.source,
                        &release,
                        package,
                        &self.inner.key,
                    )
                    .await
                }
                None => Err(UpdateError::Unsupported(
                    "this copy of PlateVault was not installed from a release package, so it cannot update itself"
                        .to_owned(),
                )),
            };
            let mut state = self.lock();
            match downloaded {
                Ok(staged) => {
                    let staged = Arc::new(staged);
                    self.set(&mut state, intent.staged(release.clone(), Arc::clone(&staged)));
                    staged
                }
                Err(error) => {
                    tracing::warn!(version = %release.version_text, %error, "update download failed");
                    self.set(&mut state, State::DownloadFailed { release, error });
                    return false;
                }
            }
        };

        if intent == Intent::InstallNow {
            self.install_staged_now(release, staged).await;
        }
        true
    }

    /// Install `staged`, then hand the process to the host.
    async fn install_staged_now(&self, release: Release, staged: Arc<Staged>) {
        let inner = Arc::clone(&self.inner);
        let payload = Arc::clone(&staged);
        let admin_prompt = self.wording().admin_prompt(&release.version_text);
        let installed = tokio::task::spawn_blocking(move || {
            inner.installer.install(payload.reverify()?, InstallMode::Now, &admin_prompt)
        })
        .await
        .unwrap_or_else(|error| {
            Err(UpdateError::Install(format!("the install task failed: {error}")))
        });
        self.after_install_now(release, staged, installed);
    }

    /// Relaunch or exit once Install now is over, or keep `staged` for a
    /// retry after a failure. A quit held during the install wins over both:
    /// the next launch runs the new version, or offers the update again.
    fn after_install_now(
        &self,
        release: Release,
        staged: Arc<Staged>,
        installed: Result<Installed, UpdateError>,
    ) {
        let mut state = self.lock();
        let quit_held =
            matches!(*state, State::Installing { run: Run::Now { quit_held: true }, .. });
        match &installed {
            Ok(installed) => {
                tracing::info!(version = %release.version_text, ?installed, quit_held, "update installed");
            }
            Err(error) => {
                tracing::warn!(version = %release.version_text, %error, quit_held, "update install failed");
            }
        }
        // A held quit leaves no window to show the error in.
        let notice = installed
            .as_ref()
            .err()
            .filter(|_| quit_held)
            .and_then(|error| self.notice_for_quit(error));
        let relaunch = match installed {
            Ok(installed) => installed == Installed::Relaunch && !quit_held,
            Err(_) if quit_held => false,
            Err(error) => {
                self.set(&mut state, State::InstallFailed { release, staged, error });
                return;
            }
        };
        *state = State::Exiting;
        drop(state);
        self.leave(notice.as_ref(), relaunch);
    }

    /// Hand the process back to the host once Install now is over: show
    /// `notice` first, if there is one, then relaunch or exit.
    fn leave(&self, notice: Option<&Notice>, relaunch: bool) {
        if let Some(notice) = notice {
            self.inner.host.notify(&notice.title, &notice.body);
        }
        if relaunch {
            self.inner.host.relaunch();
        } else {
            self.inner.host.exit();
        }
    }

    /// What a failed install must tell the user when the app exits right
    /// after it, which leaves no window to show the error in: only a previous
    /// app that could not be put back, since nothing is then at the installed
    /// path, and the notice says where it is (astro-plan-gffqm). Any other
    /// failure left the installed app as it was, and the next launch offers
    /// the update again.
    fn notice_for_quit(&self, error: &UpdateError) -> Option<Notice> {
        let UpdateError::PreviousAppNotRestored { kept, .. } = error else {
            return None;
        };
        Some(self.wording().previous_app_kept(kept))
    }

    /// Run the install at quit on its own thread, asking for administrator
    /// rights with `admin_prompt` if it must, with a watchdog that exits at
    /// the ceiling should the install still hold the quit.
    fn spawn_install_on_quit(&self, staged: Arc<Staged>, admin_prompt: String) {
        let installing = self.clone();
        let install = std::thread::Builder::new().name("update-install-on-quit".to_owned()).spawn(
            move || {
                let installed = staged.reverify().and_then(|payload| {
                    installing.inner.installer.install(payload, InstallMode::OnQuit, &admin_prompt)
                });
                let notice = installed.err().and_then(|error| {
                    tracing::warn!(%error, "update install at quit failed; the next launch offers the update again");
                    installing.notice_for_quit(&error)
                });
                installing.exit_after_quit_install(notice.as_ref());
            },
        );
        if let Err(error) = install {
            tracing::warn!(%error, "cannot start the update install at quit; quitting without it");
            self.exit_after_quit_install(None);
            return;
        }
        let watchdog = self.clone();
        let ceiling = self.inner.quit_install_ceiling;
        let spawned = std::thread::Builder::new().name("update-install-watchdog".to_owned()).spawn(
            move || {
                std::thread::sleep(ceiling);
                if watchdog.exit_after_quit_install(None) {
                    tracing::warn!(?ceiling, "update install at quit passed its ceiling; exiting");
                }
            },
        );
        if let Err(error) = spawned {
            tracing::warn!(%error, "cannot start the update install watchdog");
        }
    }

    /// End the install at quit and exit, once, showing `notice` first: `true`
    /// for the caller that did. The state leaves the install before the
    /// notice, so the watchdog cannot exit while the notice is still being
    /// delivered.
    fn exit_after_quit_install(&self, notice: Option<&Notice>) -> bool {
        let mut state = self.lock();
        if !matches!(*state, State::Installing { run: Run::AtQuit, .. }) {
            return false;
        }
        *state = State::Exiting;
        drop(state);
        self.leave(notice, false);
        true
    }

    /// The English detail of the failure the current state shows.
    #[cfg(test)]
    fn error_text(&self) -> Option<String> {
        match &*self.lock() {
            State::CheckFailed(error)
            | State::DownloadFailed { error, .. }
            | State::InstallFailed { error, .. } => Some(error.to_string()),
            _ => None,
        }
    }
}

impl UpdatePort for Updater {
    fn status(&self) -> Latest<UpdateStatus> {
        Latest::new(self.inner.status.subscribe())
    }

    async fn check(&self) {
        if !self.begin_check() {
            return;
        }
        let next = match self.fetch_release().await {
            Ok(Some(release)) => {
                tracing::info!(version = %release.version_text, "update available");
                State::Available { release, staged: None }
            }
            Ok(None) => State::UpToDate,
            Err(error) => State::CheckFailed(error),
        };
        self.set(&mut self.lock(), next);
    }

    async fn download(&self) -> bool {
        self.advance(Intent::Stage).await
    }

    async fn install_now(&self) {
        self.advance(Intent::InstallNow).await;
    }

    async fn install_on_quit(&self) {
        self.advance(Intent::InstallOnQuit).await;
    }
}

/// Everything an [`Updater`] is built from; tests swap in fakes.
struct Parts {
    current_version: Version,
    endpoints: Vec<Url>,
    key: TrustedKey,
    platform: Platform,
    source: Box<dyn Source>,
    installer: Box<dyn Installer>,
    host: Box<dyn UpdateHost>,
    quit_install_ceiling: Duration,
    wording: Wording,
}
