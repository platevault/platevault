// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Windows eject support for discovery's watchers (astro-plan-ef440).
//!
//! Windows ejects a volume only once no process holds a handle on it, and
//! [`CaptureWatch`] holds one per watched folder. `EjectNotices` (Windows
//! only) registers every root discovery follows that is not on a network
//! share with `platevault_eject_windows::RemovalNotices`, and forwards each
//! notice to the watch: `release` when a removal is requested, `reattach` when
//! it was refused and `gone` once the volume is removed. A USB disk counts as
//! a fixed one (`DriveType` 3) and still ejects, so no local volume is left
//! out; one that never ejects simply never sends a notice. Each root goes to
//! the window with the folder ID discovery recorded for it, so the window
//! holds a handle only on that folder, never on a link, junction or other
//! folder that took its path. It holds no watcher state:
//! [`CaptureWatch::subscribe_roots`] names a root from the start of its
//! watch, and a location that is removed, retired, remapped or offline
//! leaves it. macOS and Linux need none of this.
//!
//! [`CaptureWatch`]: platevault_core::new_captures::CaptureWatch
//! [`CaptureWatch::subscribe_roots`]: platevault_core::new_captures::CaptureWatch::subscribe_roots

use std::collections::HashMap;
use std::path::PathBuf;

use platevault_core::inventory::FolderId;
use platevault_core::new_captures::WatchedRoot;
use platevault_core::VolumeKind;
use uuid::Uuid;

#[cfg(windows)]
pub use notices::EjectNotices;

/// The roots to register, by location, each with the folder ID the folder at
/// its path must still have: every watched one but those on a network share,
/// which Windows never ejects, and those with no folder ID, which no handle
/// could be checked against.
pub fn ejectable_roots(roots: &[WatchedRoot]) -> HashMap<Uuid, (PathBuf, FolderId)> {
    roots
        .iter()
        .filter(|root| root.volume_kind != VolumeKind::Network)
        .filter_map(|root| Some((root.location_id, (root.root.clone(), root.folder?))))
        .collect()
}
#[cfg(any(windows, test))]
fn start_optional<T>(start: impl FnOnce() -> Result<T, String>) -> Option<T> {
    start()
        .inspect_err(|error| {
            tracing::error!(
                %error,
                "removal notices did not start; PlateVault runs without them, so safely \
                 removing a Captures drive no longer releases the new-captures watcher on \
                 it, and Windows reports the drive in use until PlateVault is closed"
            );
        })
        .ok()
}

/// The notice window and the forwarding to discovery, on Windows only.
#[cfg(windows)]
mod notices {
    use platevault_core::new_captures::{CaptureWatch, WatchedRoot};
    use platevault_eject_windows::{FolderId, Removal, RemovalNotices, Root, Roots};
    use tauri::{AppHandle, Manager, Runtime};
    use tokio::sync::watch;
    use uuid::Uuid;

    use super::ejectable_roots;

    /// Forwards removal notices to the managed [`CaptureWatch`] until dropped.
    /// Drop it after the watch shut down: a removal request that waits on
    /// discovery then returns, so the drop does not wait on it.
    pub struct EjectNotices {
        /// Held for its drop, which ends every registration and the window
        /// thread.
        _notices: RemovalNotices<Uuid>,
    }

    impl EjectNotices {
        /// Start forwarding to the [`CaptureWatch`] that `app` manages. When
        /// that fails (Windows refused the notice window or its thread, or no
        /// capture watch is managed yet), the reason is logged and `None`
        /// returned: start-up goes on without the notices, and only the
        /// automatic release of discovery's watcher on a drive being safely
        /// removed is lost.
        #[must_use = "dropping it ends the removal notices"]
        pub fn start<R: Runtime>(app: &AppHandle<R>) -> Option<Self> {
            Self::start_with(app, RemovalNotices::start)
        }

        fn start_with<R: Runtime>(
            app: &AppHandle<R>,
            start_notices: impl FnOnce(
                Box<dyn FnMut(&Uuid, Removal) + Send>,
            ) -> std::io::Result<RemovalNotices<Uuid>>,
        ) -> Option<Self> {
            start_optional(|| Self::try_start_with(app, start_notices))
        }

        fn try_start_with<R: Runtime>(
            app: &AppHandle<R>,
            start_notices: impl FnOnce(
                Box<dyn FnMut(&Uuid, Removal) + Send>,
            ) -> std::io::Result<RemovalNotices<Uuid>>,
        ) -> Result<Self, String> {
            let roots = app
                .try_state::<CaptureWatch>()
                .ok_or("removal notices start once the capture watch is managed")?
                .subscribe_roots();
            let handle = app.clone();
            let notices = start_notices(Box::new(move |location: &Uuid, removal| {
                forward(&handle, *location, removal);
            }))
            .map_err(|error| format!("cannot start removal notices: {error}"))?;
            tauri::async_runtime::spawn(follow(roots, notices.roots()));
            Ok(Self { _notices: notices })
        }
    }
    /// Tell discovery what Windows reported. A requested removal returns once
    /// discovery holds no handle on the location's volume, or once discovery
    /// is asked to stop.
    fn forward<R: Runtime>(app: &AppHandle<R>, location: Uuid, removal: Removal) {
        // `start` found it managed, and managed state stays.
        let captures = app.state::<CaptureWatch>();
        match removal {
            Removal::Requested => tauri::async_runtime::block_on(captures.release(location)),
            Removal::Refused => captures.reattach(location),
            Removal::Removed => captures.gone(location),
        }
    }

    /// Keep the registrations on the ejectable roots discovery follows, each
    /// bound to its folder ID. Ends with discovery or the window.
    async fn follow(mut watched: watch::Receiver<Vec<WatchedRoot>>, window: Roots<Uuid>) {
        loop {
            // Its own statement, so the read guard is gone before the await.
            let wanted = ejectable_roots(&watched.borrow_and_update())
                .into_iter()
                .map(|(location, (path, folder))| {
                    let folder = FolderId { volume: folder.volume, index: folder.index };
                    (location, Root { path, folder })
                })
                .collect();
            if !window.watch(wanted) || watched.changed().await.is_err() {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(volume_kind: VolumeKind, root: &str, index: u64) -> WatchedRoot {
        WatchedRoot {
            location_id: Uuid::new_v4(),
            root: PathBuf::from(root),
            volume_kind,
            folder: Some(FolderId { volume: 7, index }),
        }
    }

    #[test]
    fn registers_every_watched_root_but_network_shares_and_unidentified_folders() {
        let card = root(VolumeKind::Removable, "E:\\Captures", 1);
        // A USB SSD reports itself as a fixed disk.
        let ssd = root(VolumeKind::Local, "F:\\Captures", 2);
        let share = root(VolumeKind::Network, "Z:\\Captures", 3);
        let unidentified =
            WatchedRoot { folder: None, ..root(VolumeKind::Local, "G:\\Captures", 4) };

        let roots = ejectable_roots(&[card.clone(), ssd.clone(), share, unidentified]);

        assert_eq!(
            roots,
            HashMap::from([
                (card.location_id, (card.root, card.folder.unwrap())),
                (ssd.location_id, (ssd.root, ssd.folder.unwrap())),
            ])
        );
    }

    #[test]
    fn failed_notice_start_is_logged_and_optional() {
        use std::io;
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };

        let attempts = Arc::new(AtomicUsize::new(0));
        let attempted = Arc::clone(&attempts);
        let notices = start_optional(move || {
            attempted.fetch_add(1, Ordering::SeqCst);
            Err::<(), _>(io::Error::other("injected notice-window creation failure").to_string())
        });

        assert!(notices.is_none(), "startup continues without failed notices");
        assert_eq!(attempts.load(Ordering::SeqCst), 1, "creation is attempted only once");
    }
}
