// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The services crate must stay hostable by any UI: no `tauri*`,
//! `flutter_rust_bridge` or `raw-window-handle` crate may enter its normal or
//! build dependency graph, on any target. Dev-dependencies are excluded: they
//! never reach a host binary.

use std::collections::{HashMap, HashSet};
use std::process::Command;

use serde_json::Value;

/// `tauri*` crates that are not part of the Tauri framework. notify-rust's
/// Windows backend is a standalone toast wrapper over the Windows Runtime that
/// the Tauri team publishes; it depends only on `windows`, `windows-version`
/// and `thiserror`.
/// The walk still checks everything it reaches.
const STANDALONE: [&str; 1] = ["tauri-winrt-notification"];

fn banned(name: &str) -> bool {
    (name.starts_with("tauri") && !STANDALONE.contains(&name))
        || name.starts_with("flutter_rust_bridge")
        || name == "raw-window-handle"
}

/// The workspace's resolved dependency graph, for every target platform.
fn metadata() -> Value {
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml");
    let output = Command::new(env!("CARGO"))
        .args(["metadata", "--format-version", "1", "--locked", "--manifest-path", manifest])
        .output()
        .expect("run cargo metadata");
    assert!(
        output.status.success(),
        "cargo metadata failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("cargo metadata emits JSON")
}

/// Names of every package `root` reaches through normal and build edges.
fn reachable(metadata: &Value, root: &str) -> HashSet<String> {
    let packages = metadata["packages"].as_array().expect("packages");
    let names: HashMap<&str, &str> = packages
        .iter()
        .map(|package| {
            (package["id"].as_str().expect("id"), package["name"].as_str().expect("name"))
        })
        .collect();
    let root_id = packages
        .iter()
        .find(|package| package["name"] == root)
        .and_then(|package| package["id"].as_str())
        .unwrap_or_else(|| panic!("{root} is a workspace package"));
    let nodes: HashMap<&str, &Value> = metadata["resolve"]["nodes"]
        .as_array()
        .expect("resolve nodes")
        .iter()
        .map(|node| (node["id"].as_str().expect("node id"), node))
        .collect();

    let mut seen = HashSet::new();
    let mut queue = vec![root_id];
    while let Some(id) = queue.pop() {
        if !seen.insert(id) {
            continue;
        }
        for dep in nodes[id]["deps"].as_array().expect("deps") {
            let shipped = dep["dep_kinds"]
                .as_array()
                .expect("dep kinds")
                .iter()
                .any(|kind| kind["kind"].as_str() != Some("dev"));
            if shipped {
                queue.push(dep["pkg"].as_str().expect("dep id"));
            }
        }
    }
    seen.into_iter().map(|id| names[id].to_owned()).collect()
}

#[test]
fn no_ui_framework_crate_enters_the_services_dependency_graph() {
    let metadata = metadata();
    let reached = reachable(&metadata, env!("CARGO_PKG_NAME"));
    assert!(reached.contains("notify-rust"), "the walk follows real dependencies");

    let mut offending: Vec<&String> = reached.iter().filter(|name| banned(name)).collect();
    offending.sort();
    assert!(
        offending.is_empty(),
        "UI framework crates reached from the services crate: {offending:?}"
    );
}

/// The same walk from the Tauri host does reach Tauri, so a pass above is not
/// a walk that cannot see the crates it bans.
#[test]
fn the_walk_finds_tauri_from_the_tauri_host() {
    let reached = reachable(&metadata(), "desktop_shell");
    assert!(reached.contains("tauri"));
    assert!(reached.contains("raw-window-handle"));
}

#[test]
fn the_ban_covers_tauri_plugins_and_the_flutter_bridge() {
    for name in ["tauri", "tauri-runtime-wry", "tauri-plugin-notification"] {
        assert!(banned(name), "{name}");
    }
    assert!(banned("flutter_rust_bridge"));
    assert!(banned("flutter_rust_bridge_macros"));
    assert!(banned("raw-window-handle"));
    assert!(!banned("notify-rust"));
    assert!(!banned("tauri-winrt-notification"), "a standalone toast crate, not the framework");
}
