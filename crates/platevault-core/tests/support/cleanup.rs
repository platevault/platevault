// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Shared fixture for F4 Wrap up Clean up and Trash (spec 065 PRJ-FR-15/16,
//! 071 STO-FR-01..05/10/17): an OS Trash stand-in and quality/scan helpers.
//! Included with `#[path = "support/cleanup.rs"] mod cleanup_support;`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};


/// A stand-in OS Trash: it moves the entry itself, never a link's target,
/// into its bin, and below each `no_trash` root it has no Trash at all.
pub struct ScopedTrash {
    bin: PathBuf,
    no_trash: Mutex<Vec<PathBuf>>,
    moved: Mutex<Vec<PathBuf>>,
    next: AtomicUsize,
}

impl ScopedTrash {
    pub fn new(bin: &Path) -> Arc<Self> {
        fs::create_dir_all(bin).unwrap();
        Arc::new(Self {
            bin: bin.to_path_buf(),
            no_trash: Mutex::new(Vec::new()),
            moved: Mutex::new(Vec::new()),
            next: AtomicUsize::new(0),
        })
    }

    /// The location below `root` has no OS Trash from now on.
    pub fn without_trash(&self, root: &Path) {
        self.no_trash.lock().unwrap().push(root.to_path_buf());
    }

    /// Every path the OS Trash took, in order.
    pub fn moved(&self) -> Vec<PathBuf> {
        self.moved.lock().unwrap().clone()
    }

    /// How many entries the bin holds: nothing leaves it.
    pub fn bin_len(&self) -> usize {
        fs::read_dir(&self.bin).unwrap().count()
    }

    pub fn dyn_trash(self: &Arc<Self>) -> Arc<dyn OsTrash> {
        Arc::clone(self) as Arc<dyn OsTrash>
    }
}

impl OsTrash for ScopedTrash {
    fn support(&self, entry: &Path, _size_bytes: u64) -> TrashSupport {
        if self.no_trash.lock().unwrap().iter().any(|root| entry.starts_with(root)) {
            TrashSupport::Unsupported {
                reason: TrashUnsupported::NoTrash,
                detail: "this location has no OS Trash".into(),
            }
        } else {
            TrashSupport::Supported
        }
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
