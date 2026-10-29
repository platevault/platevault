// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Removable import devices IPC (spec 071 STO-IMP-FR-10): the USB and SD
//! volumes connected now, each with the capture layout recognised on it.
//!
//! Registered only by the isolated rebuilt shell ([`crate::library_shell`]),
//! which manages the [`DeviceWatch`] and forwards each change of its list as
//! [`IMPORT_DEVICES_EVENT`]. A device is previewed as any mounted folder, with
//! `import_preview` and `ImportSourceSpec::Folder` at its root.

use platevault_core::import::devices::DeviceWatch;
use platevault_core::RemovableDevice;
use tauri::State;

/// The device list now, then after each connection or removal; its payload is
/// `RemovableDevice[]`, the same as [`import_devices_list`].
pub const IMPORT_DEVICES_EVENT: &str = "import_devices";

/// The connected removable devices, by name. A device whose layout no rule
/// recognised has no `layout`: a generic device.
#[tauri::command]
#[specta::specta]
#[allow(clippy::needless_pass_by_value)] // Tauri injects the managed state by value
#[must_use]
pub fn import_devices_list(devices: State<'_, DeviceWatch>) -> Vec<RemovableDevice> {
    devices.devices()
}
