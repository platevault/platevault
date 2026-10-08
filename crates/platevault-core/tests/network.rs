// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Volume kinds of registered roots and refused share addresses (LIB-FR-01,
//! LIB-FR-19).

use std::path::Path;

use platevault_core::{inventory, VolumeKind};

#[test]
fn a_host_folder_is_observed_with_its_volume_kind() {
    let dir = tempfile::tempdir().unwrap();
    let observed = inventory::observe_root(dir.path()).unwrap();
    assert_eq!(
        observed.volume_kind,
        VolumeKind::Local,
        "the host temp folder is on an internal disk"
    );
    assert_eq!(observed.identity, inventory::observe_root_identity(dir.path()).unwrap());
}

#[test]
fn share_addresses_are_refused_as_location_roots() {
    for address in ["smb://nas.local/Astro", "//nas.local/Astro/Captures", "https://nas/dav"] {
        let refused = inventory::observe_root(Path::new(address)).unwrap_err();
        assert_eq!(refused.response(None, None).kind, "invalid_input", "{address}: {refused}");
        assert!(refused.to_string().contains("mounts no share"), "{address}: {refused}");
    }
}
