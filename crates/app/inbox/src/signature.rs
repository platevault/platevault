// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Content signature computation for inbox folders (spec 005, T-SigCompute).
//!
//! # Formula (Ref: R-Sig-1)
//!
//! Per-file signature:
//!   `sha256(filename || size_bytes || mtime_unix_ns || sha256(first 65536 bytes))`
//!
//! Folder content_signature:
//!   `sha256(sorted(per_file_signatures))`
//!
//! The 64 KB partial-content hash detects FITS header rewrites that preserve
//! size and mtime. Full-file hashing is intentionally avoided (constitution §I,
//! lazy hashing principle).
#![allow(clippy::doc_markdown)]

use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

/// Maximum bytes to read from each file for the partial content hash.
const PARTIAL_READ_BYTES: usize = 65536;

/// Compute the per-file signature component.
///
/// Returns `None` if the file cannot be stat'd or read (permissions, missing
/// mount, etc.). Missing files are silently excluded from the folder signature —
/// callers can decide how to handle absent files.
#[must_use]
pub fn file_signature(path: &Path) -> Option<[u8; 32]> {
    let meta = std::fs::metadata(path).ok()?;
    let size_bytes = meta.len();

    // mtime as nanoseconds since Unix epoch, falling back to 0 if unavailable.
    let mtime_unix_ns: u64 = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| u64::from(d.subsec_nanos()) + d.as_secs() * 1_000_000_000);

    // Partial content hash
    let mut file = std::fs::File::open(path).ok()?;
    let mut buf = vec![0u8; PARTIAL_READ_BYTES];
    let n = file.read(&mut buf).ok()?;
    let partial_hash: [u8; 32] = Sha256::digest(&buf[..n]).into();

    // File name (last component only)
    let file_name = path.file_name()?.to_string_lossy();

    // Assemble: sha256(filename || size_bytes || mtime_unix_ns || partial_hash)
    let mut h = Sha256::new();
    h.update(file_name.as_bytes());
    h.update(size_bytes.to_le_bytes());
    h.update(mtime_unix_ns.to_le_bytes());
    h.update(partial_hash);

    Some(h.finalize().into())
}

/// Compute the folder-level content signature from a sorted list of per-file
/// signatures.
///
/// File signatures are sorted lexicographically (as byte arrays) before
/// hashing so the result is stable regardless of directory enumeration order.
#[must_use]
pub fn folder_signature(mut file_sigs: Vec<[u8; 32]>) -> String {
    file_sigs.sort_unstable();
    let mut h = Sha256::new();
    for sig in &file_sigs {
        h.update(sig);
    }
    hex::encode(h.finalize())
}

/// Compute both per-file signatures and the folder content signature for a
/// list of file paths.
///
/// Returns `(folder_signature_hex, per_file_signatures)`.
///
/// Files that cannot be read are silently skipped. If the list is empty or all
/// files are unreadable, returns a deterministic signature of an empty set.
#[must_use]
pub fn compute_content_signature(file_paths: &[&Path]) -> String {
    let sigs: Vec<[u8; 32]> = file_paths.iter().filter_map(|p| file_signature(p)).collect();
    folder_signature(sigs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_is_stable_for_same_content() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), b"hello world FITS data").unwrap();
        let s1 = file_signature(tmp.path()).unwrap();
        let s2 = file_signature(tmp.path()).unwrap();
        assert_eq!(s1, s2);
    }

    #[test]
    fn folder_signature_order_independent() {
        let s1: [u8; 32] = [1u8; 32];
        let s2: [u8; 32] = [2u8; 32];

        let a = folder_signature(vec![s1, s2]);
        let b = folder_signature(vec![s2, s1]);
        assert_eq!(a, b, "folder signature must be order-independent");
    }

    #[test]
    fn empty_folder_has_deterministic_signature() {
        let sig = folder_signature(vec![]);
        // Deterministic: sha256 of empty input
        assert!(!sig.is_empty());
        assert_eq!(sig, folder_signature(vec![]));
    }

    #[test]
    fn missing_file_returns_none() {
        assert!(file_signature(Path::new("/nonexistent/path/file.fits")).is_none());
    }
}
