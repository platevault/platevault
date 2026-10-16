// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Windows eject support for discovery's watchers (astro-plan-ef440).
//!
//! Windows ejects a removable volume only once no process holds a handle on
//! it, and [`CaptureWatch`] holds one per watched folder. `EjectNotices`
//! (Windows only) registers the root of every counted Captures location on a
//! removable volume with `platevault_eject_windows::RemovalNotices` and
//! forwards each notice to the watch: `release` when a removal is requested,
//! `reattach` when it was refused and `gone` once the volume is removed. It
//! holds no watcher state. The counts say which locations are watched, and the
//! catalog says where and on what kind of volume, so a location that is
//! removed, retired, remapped or offline loses its registration. Fixed and
//! network volumes keep their watchers throughout, and macOS and Linux need
//! none of this.

use std::collections::HashMap;
use std::path::PathBuf;

use platevault_core::new_captures::NewCaptureCount;
use platevault_core::{Location, VolumeKind};
use uuid::Uuid;

#[cfg(windows)]
pub use notices::EjectNotices;

/// The roots of the counted locations on removable volumes, by location. A
/// location whose removal is undecided is still counted, so it keeps its root.
pub fn removable_roots(
    locations: &[Location],
    counts: &[NewCaptureCount],
) -> HashMap<Uuid, PathBuf> {
    locations
        .iter()
        .filter(|location| {
            location.volume_kind == VolumeKind::Removable
                && counts.iter().any(|count| count.location_id == location.id)
        })
        .filter_map(|location| Some((location.id, location.path.to_path_buf().ok()?)))
        .collect()
}

/// The notice window and the forwarding to discovery, on Windows only.
#[cfg(windows)]
mod notices {
    use std::sync::Arc;

    use platevault_core::library::Library;
    use platevault_core::new_captures::{CaptureWatch, NewCaptureCount};
    use platevault_core::Location;
    use platevault_eject_windows::{Removal, RemovalNotices, Roots};
    use tauri::{AppHandle, Manager};
    use tokio::sync::broadcast::error::RecvError;
    use tokio::sync::watch;
    use uuid::Uuid;

    use super::removable_roots;

    /// Forwards removal notices to the managed [`CaptureWatch`] until dropped.
    /// Drop it after the watch shut down, so no removal request waits on a
    /// discovery that is stopping.
    pub struct EjectNotices(RemovalNotices<Uuid>);

    impl EjectNotices {
        /// Start forwarding to the [`CaptureWatch`] that `app` manages, for the
        /// locations of the [`Library`] it manages.
        ///
        /// # Errors
        /// `app` manages no library or capture watch yet, or Windows refused
        /// the notice window.
        pub fn start(app: &AppHandle) -> Result<Self, String> {
            let missing =
                "removal notices start once the library and its capture watch are managed";
            let library = Arc::clone(app.try_state::<Arc<Library>>().ok_or(missing)?.inner());
            let counts = app.try_state::<CaptureWatch>().ok_or(missing)?.subscribe();
            let handle = app.clone();
            let notices = RemovalNotices::start(move |location: &Uuid, removal| {
                forward(&handle, *location, removal);
            })
            .map_err(|error| format!("cannot start removal notices: {error}"))?;
            tauri::async_runtime::spawn(follow(library, counts, notices.roots()));
            Ok(Self(notices))
        }
    }

    /// Tell discovery what Windows reported. A requested removal returns once
    /// discovery holds no handle on the location's volume.
    fn forward(app: &AppHandle, location: Uuid, removal: Removal) {
        // `start` found it managed, and managed state stays.
        let captures = app.state::<CaptureWatch>();
        match removal {
            Removal::Requested => tauri::async_runtime::block_on(captures.release(location)),
            Removal::Refused => captures.reattach(location),
            Removal::Removed => captures.gone(location),
        }
    }

    /// Keep the registrations on the counted removable roots: the counts
    /// change as locations start and stop being watched, the catalog as they
    /// are added, retired or remapped. Ends with discovery or the window.
    async fn follow(
        library: Arc<Library>,
        mut counts: watch::Receiver<Vec<NewCaptureCount>>,
        roots: Roots<Uuid>,
    ) {
        let mut changes = library.subscribe_location_changes();
        let mut locations = Vec::new();
        reread(&library, &mut locations).await;
        loop {
            // Its own statement, so the counts' read guard is gone before
            // the next await.
            let wanted = removable_roots(&locations, &counts.borrow_and_update());
            if !roots.watch(wanted) {
                return;
            }
            tokio::select! {
                changed = counts.changed() => if changed.is_err() {
                    return;
                },
                change = changes.recv() => match change {
                    Ok(_) | Err(RecvError::Lagged(_)) => reread(&library, &mut locations).await,
                    Err(RecvError::Closed) => return,
                },
            }
        }
    }

    /// Read the catalog's locations again, keeping the last ones when it
    /// cannot be read.
    async fn reread(library: &Library, locations: &mut Vec<Location>) {
        match library.catalog().list_locations().await {
            Ok(listed) => *locations = listed,
            Err(error) => {
                tracing::warn!(%error, "removal notices: locations unreadable; registrations unchanged");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use platevault_core::{
        Availability, FileIdentity, LocationLifecycle, LocationRole, NativePath, PathSensitivity,
        VolumeIdentity,
    };

    use super::*;

    fn location(volume_kind: VolumeKind, root: &str) -> Location {
        Location {
            id: Uuid::new_v4(),
            name: root.into(),
            path: NativePath::from_path(Path::new(root)),
            role: LocationRole::Captures,
            identity: FileIdentity {
                volume: VolumeIdentity {
                    filesystem: "exfat".into(),
                    stable_id: None,
                    file_ids_stable: false,
                    case: PathSensitivity::Unknown,
                    normalization: PathSensitivity::Unknown,
                },
                file_id: None,
            },
            decision_revision: 1,
            availability: Availability::Available,
            last_observed_at: None,
            lifecycle: LocationLifecycle::Active,
            volume_kind,
        }
    }

    fn count(location: &Location, live: bool) -> NewCaptureCount {
        NewCaptureCount { location_id: location.id, new_files: 3, live }
    }

    #[test]
    fn registers_the_counted_roots_on_removable_volumes_only() {
        let card = location(VolumeKind::Removable, "card");
        let released = location(VolumeKind::Removable, "released");
        let unwatched = location(VolumeKind::Removable, "unwatched");
        let disk = location(VolumeKind::Local, "disk");
        let share = location(VolumeKind::Network, "share");
        let counts =
            [count(&card, true), count(&released, false), count(&disk, true), count(&share, true)];

        let roots =
            removable_roots(&[card.clone(), released.clone(), unwatched, disk, share], &counts);

        assert_eq!(
            roots,
            HashMap::from([
                (card.id, PathBuf::from("card")),
                (released.id, PathBuf::from("released"))
            ])
        );
    }
}
