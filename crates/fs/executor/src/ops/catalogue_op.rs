//! Catalogue operation — record-in-place, no filesystem mutation (spec 041).
//!
//! A `catalogue` plan item signals that the file should be noted in the
//! application's records without any move, copy, link, or deletion.
//! The executor therefore performs no filesystem I/O and always succeeds.
//!
//! Constitution §II: every plan item type must be handled; this fulfils that
//! obligation for catalogue items by making the no-op explicit and documented.

/// Execute a catalogue action: a deliberate no-op that records intent without
/// touching the filesystem.
///
/// # Errors
/// This function never returns an error; the `Result` signature is kept
/// consistent with other op functions so call sites are uniform.
pub fn catalogue_noop() -> Result<(), crate::failure::PlanItemFailure> {
    Ok(())
}
