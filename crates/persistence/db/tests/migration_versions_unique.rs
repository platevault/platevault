// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Two migrations must never share a numeric version.
//!
//! `sqlx::migrate!` keys on the leading number, not the filename. Two files at
//! one version — `0075_a.sql` and `0075_b.sql` — merge cleanly in git, because
//! the *names* differ and neither branch touches the other's file. Nothing
//! conflicts, nothing fails review, and both branches pass CI in isolation.
//! `migrate()` then aborts on a **fresh** database.
//!
//! The failure is invisible in normal development: an existing dev DB has the
//! first migration already applied, so it never re-runs the pair and never
//! sees the duplicate. It surfaces on a new contributor's first checkout, in a
//! fresh CI container, or for a user installing the app for the first time.
//!
//! This has now happened twice on this repository. PR #1048 renumbered
//! `0072`/`0073` to escape one collision and landed on `0075`/`0076`, which a
//! second in-flight branch (#1194) had meanwhile taken. That is the lesson
//! worth encoding: **renumbering by hand to dodge a collision is itself how
//! the next collision gets made**, because every branch picks its number
//! against a `main` that does not yet contain the others. A guard converts a
//! silent fresh-DB abort into a named CI failure naming both files, which is
//! the only point at which the conflict is actually visible.
//!
//! Deliberately a filesystem check, not a database one — it must fail for a
//! collision between two *unmerged* branches the moment they meet, which is
//! before any database exists to migrate.

use std::collections::BTreeMap;

#[test]
fn every_migration_has_a_unique_version() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/migrations");
    let mut by_version: BTreeMap<String, Vec<String>> = BTreeMap::new();

    for entry in std::fs::read_dir(dir).expect("migrations directory must exist") {
        let path = entry.expect("readable dir entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("sql") {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .expect("migration filename must be UTF-8")
            .to_owned();

        // `sqlx` takes the version as the digits before the first `_`.
        let version = name
            .split('_')
            .next()
            .filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or_else(|| panic!("migration {name} does not start with a numeric version"))
            .to_owned();

        by_version.entry(version).or_default().push(name);
    }

    // Anti-vacuity: a typo in the path would make this pass over zero files.
    assert!(
        by_version.len() > 50,
        "expected the full migration set, found only {} version(s) — is the \
         migrations path wrong?",
        by_version.len()
    );

    let collisions: Vec<_> = by_version
        .iter()
        .filter(|(_, files)| files.len() > 1)
        .map(|(version, files)| {
            let mut sorted = files.clone();
            sorted.sort();
            format!("  {version}: {}", sorted.join(", "))
        })
        .collect();

    assert!(
        collisions.is_empty(),
        "two or more migrations share a numeric version. `sqlx::migrate!` keys \
         on that number, so `migrate()` will abort on a FRESH database while \
         every existing dev DB keeps working:\n{}\n\nRenumber the one that has \
         not merged yet, to a version above every other in-flight branch — not \
         merely above `main`.",
        collisions.join("\n")
    );
}
