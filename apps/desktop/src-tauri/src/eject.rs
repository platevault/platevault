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
//! out; one that never ejects simply never sends a notice. It holds no
//! watcher state: [`CaptureWatch::subscribe_roots`] names a root from the
//! start of its watch, and a location that is removed, retired, remapped or
//! offline leaves it. macOS and Linux need none of this.
//!
//! [`CaptureWatch`]: platevault_core::new_captures::CaptureWatch
//! [`CaptureWatch::subscribe_roots`]: platevault_core::new_captures::CaptureWatch::subscribe_roots

use std::collections::HashMap;
use std::path::PathBuf;

use platevault_core::new_captures::WatchedRoot;
use platevault_core::VolumeKind;
use uuid::Uuid;

#[cfg(windows)]
pub use notices::EjectNotices;

/// The roots to register, by location: every watched one but those on a
/// network share, which Windows never ejects.
pub fn ejectable_roots(roots: &[WatchedRoot]) -> HashMap<Uuid, PathBuf> {
    roots
        .iter()
        .filter(|root| root.volume_kind != VolumeKind::Network)
        .map(|root| (root.location_id, root.root.clone()))
        .collect()
}

/// The notice window and the forwarding to discovery, on Windows only.
#[cfg(windows)]
mod notices {
    use platevault_core::new_captures::{CaptureWatch, WatchedRoot};
    use platevault_eject_windows::{Removal, RemovalNotices, Roots};
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
            Self::try_start(app)
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

        fn try_start<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
            let roots = app
                .try_state::<CaptureWatch>()
                .ok_or("removal notices start once the capture watch is managed")?
                .subscribe_roots();
            let handle = app.clone();
            let notices = RemovalNotices::start(move |location: &Uuid, removal| {
                forward(&handle, *location, removal);
            })
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

    /// Keep the registrations on the ejectable roots discovery follows. Ends
    /// with discovery or the window.
    async fn follow(mut watched: watch::Receiver<Vec<WatchedRoot>>, window: Roots<Uuid>) {
        loop {
            // Its own statement, so the read guard is gone before the await.
            let wanted = ejectable_roots(&watched.borrow_and_update());
            if !window.watch(wanted) || watched.changed().await.is_err() {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(volume_kind: VolumeKind, root: &str) -> WatchedRoot {
        WatchedRoot { location_id: Uuid::new_v4(), root: PathBuf::from(root), volume_kind }
    }

    #[test]
    fn registers_every_watched_root_but_network_shares() {
        let card = root(VolumeKind::Removable, "E:\\Captures");
        // A USB SSD reports itself as a fixed disk.
        let ssd = root(VolumeKind::Local, "F:\\Captures");
        let share = root(VolumeKind::Network, "Z:\\Captures");

        let roots = ejectable_roots(&[card.clone(), ssd.clone(), share]);

        assert_eq!(
            roots,
            HashMap::from([(card.location_id, card.root), (ssd.location_id, ssd.root)])
        );
    }

    /// Start-up goes on when the removal notices cannot start: `start` logs
    /// why and gives the shell nothing to hold, instead of an error that
    /// would end `run`. No capture watch is managed here, which fails the
    /// start before any window exists, as a refused window does after.
    #[cfg(windows)]
    #[test]
    fn start_up_goes_on_when_removal_notices_cannot_start() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");

        assert!(EjectNotices::start(app.handle()).is_none());
    }
}
