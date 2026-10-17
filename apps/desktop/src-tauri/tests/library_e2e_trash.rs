// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The `e2e` build's Wrap up Trash (spec 037): the headless double, so an e2e
//! run never touches the OS Trash. Built only with `--features e2e`.
#![cfg(feature = "e2e")]

use desktop_shell::commands::project_wrap_up::WrapUpTrash;
use platevault_core::TrashSupport;

/// The shell's start-up Trash takes an entry without asking the OS, even one
/// in a folder that is gone, whose volume no host adapter can inspect, and
/// removes the file itself.
#[test]
fn an_e2e_build_wraps_up_through_the_headless_trash() {
    let trash = WrapUpTrash::host().get();
    let dir = tempfile::tempdir().unwrap();
    let gone = dir.path().join("gone").join("Light_001.fits");
    assert!(matches!(trash.support(&gone, 5), TrashSupport::Supported));
    let entry = dir.path().join("Light_001.fits");
    std::fs::write(&entry, b"light").unwrap();
    assert!(matches!(trash.support(&entry, 5), TrashSupport::Supported));
    trash.move_to_trash(&entry).unwrap();
    assert!(!entry.exists());
}
