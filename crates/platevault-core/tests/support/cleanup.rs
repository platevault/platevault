// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixture for F4 Wrap up Clean up and Trash (spec 065 PRJ-FR-15/16,
//! 071 STO-FR-01..05/10/17): an OS Trash stand-in. Included with
//! `#[path = "support/cleanup.rs"] mod cleanup_support;`.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use platevault_core::custody::trash::OsTrash;
use platevault_core::*;

/// A stand-in OS Trash: it moves the entry itself, never a link's target,
/// into its bin.
pub struct ScopedTrash {
    bin: PathBuf,
    moved: Mutex<Vec<PathBuf>>,
    next: AtomicUsize,
}

impl ScopedTrash {
    pub fn new(bin: &Path) -> Arc<Self> {
        fs::create_dir_all(bin).unwrap();
        Arc::new(Self {
            bin: bin.to_path_buf(),
            moved: Mutex::new(Vec::new()),
            next: AtomicUsize::new(0),
        })
    }

    /// Every path the OS Trash took, in order.
    pub fn moved(&self) -> Vec<PathBuf> {
        self.moved.lock().unwrap().clone()
    }

    pub fn dyn_trash(self: &Arc<Self>) -> Arc<dyn OsTrash> {
        Arc::clone(self) as Arc<dyn OsTrash>
    }
}

impl OsTrash for ScopedTrash {
    fn support(&self, _entry: &Path, _size_bytes: u64) -> TrashSupport {
        TrashSupport::Supported
    }

    fn move_to_trash(&self, entry: &Path) -> Result<(), String> {
        let name = entry.file_name().ok_or("an entry has a name")?.to_string_lossy();
        let n = self.next.fetch_add(1, Ordering::SeqCst);
        fs::rename(entry, self.bin.join(format!("{n:03}-{name}")))
            .map_err(|error| error.to_string())?;
        self.moved.lock().unwrap().push(entry.to_path_buf());
        Ok(())
    }
}
