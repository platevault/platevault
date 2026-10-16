// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Windows volume removal notices for watched folders (astro-plan-ef440).
//!
//! Windows ejects a volume only once no process holds a handle on it.
//! `RemovalNotices` (Windows only) runs a message-only window on its own
//! thread and registers it, for each root it is given, for the device notices
//! of the volume holding that root: `RegisterDeviceNotificationW` with a
//! `DBT_DEVTYP_HANDLE` filter on a handle to the root folder. Each notice
//! reaches the caller as a [`Removal`], and the handle follows Microsoft's
//! protocol for a device removal request: it closes once
//! [`Removal::Requested`] was reported, so the removal can go ahead, opens
//! again when the removal was [`Removal::Refused`], and the registration ends
//! once the volume is [`Removal::Removed`]. Each root is opened without
//! following a reparse point, and only while the folder at its path is the
//! one its [`FolderId`] names: a link, junction or mounted folder in its
//! place, or another folder, is refused, so no registration ever holds a
//! handle on a folder outside the watched one. A root that cannot be opened
//! or registered, or opened again after a refusal, is tried again every 30 s
//! until it registers or is no longer given. That bookkeeping is free of
//! Win32, so every platform tests it; the window exists only on Windows.

use std::path::PathBuf;

/// What Windows reported about the volume holding a registered root.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Removal {
    /// A removal of the volume is requested. Windows goes ahead only once no
    /// process holds a handle on the volume, so the callback closes the
    /// caller's own before it returns.
    Requested,
    /// The requested removal did not happen; the volume stays.
    Refused,
    /// The volume is being removed or is gone.
    Removed,
}

/// A root folder to register: its path, and the [`FolderId`] the folder
/// there must have.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Root {
    pub path: PathBuf,
    pub folder: FolderId,
}

/// A folder's identity on its volume, as `GetFileInformationByHandle`
/// reports it for a handle on the folder: the volume serial number and the
/// 64-bit file index.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct FolderId {
    pub volume: u64,
    pub index: u64,
}

#[cfg(any(windows, test))]
mod registrations;
#[cfg(windows)]
mod window;

#[cfg(windows)]
pub use window::{RemovalNotices, Roots};
