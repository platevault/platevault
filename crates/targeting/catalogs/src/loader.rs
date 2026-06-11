//! Catalog loader boundary — placeholder for spec 013.
//!
//! The `CatalogReader` trait (entry-format readers for CSV/JSON catalog files)
//! is owned by spec 013 (Target Lookup from FITS OBJECT) and is **not**
//! implemented here. This module reserves the boundary for forward-compat.
//!
//! Spec 014 owns the registry metadata and license attribution surface only.
//! Spec 013 must implement this trait to read installed catalog entries.

/// Placeholder trait for catalog entry readers (spec 013).
///
/// Implementors provide an iterator over minimal catalog entries
/// (`name, identifiers, ra, dec, source`) from an installed catalog file.
/// The file path is resolved via the catalog registry.
///
/// This trait is intentionally empty in spec 014 scope; spec 013 fills it.
pub trait CatalogReader: Send + Sync {
    /// Return the catalog id this reader handles.
    fn catalog_id(&self) -> &str;
}
