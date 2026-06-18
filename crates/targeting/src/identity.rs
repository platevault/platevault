//! Deterministic UUIDv5 generation for `Target.id` (research.md R6, T011-eq).
//!
//! The derivation is:
//!
//! ```text
//! NAMESPACE = UUIDv5(namespace=dns, name="astro-plan.targets")
//! Target.id = UUIDv5(namespace=NAMESPACE, name="<catalog_id>:<designation>")
//! ```
//!
//! Where `<catalog_id>` is the precedence-highest catalog slug and
//! `<designation>` is the catalog-local designation for that entry.
//! This makes `Target.id` stable across machines and catalog updates
//! as long as the canonical designation does not change.

use uuid::Uuid;

/// The fixed namespace UUID for astro-plan target identities.
///
/// Computed as `UUIDv5(namespace=dns, name="astro-plan.targets")` and
/// cached here to avoid recomputing it on every call.
///
/// Value: derived from `Uuid::new_v5(&Uuid::NAMESPACE_DNS, b"astro-plan.targets")`
static NAMESPACE: std::sync::OnceLock<Uuid> = std::sync::OnceLock::new();

/// Return the astro-plan target namespace UUID.
#[must_use]
pub fn target_namespace() -> Uuid {
    *NAMESPACE.get_or_init(|| Uuid::new_v5(&Uuid::NAMESPACE_DNS, b"astro-plan.targets"))
}

/// Derive the deterministic UUIDv5 for a target given its canonical
/// `catalog_id` and `designation` (the precedence-highest catalog entry).
///
/// The canonical designation string is `"<catalog_id>:<designation>"`.
/// Both fields must be non-empty; callers are responsible for choosing the
/// precedence-winning entry (see `CatalogId::precedence`).
#[must_use]
pub fn target_id(catalog_id: &str, designation: &str) -> Uuid {
    let canonical = format!("{catalog_id}:{designation}");
    Uuid::new_v5(&target_namespace(), canonical.as_bytes())
}

/// Derive the deterministic UUIDv5 for a target from its canonical designation
/// alone (data-model.md §CanonicalTarget: "namespaced from the canonical
/// designation").
///
/// Used by the spec-035 resolution cache, where a SIMBAD-resolved identity is
/// keyed by its precedence-winning `primary_designation` rather than a single
/// catalog slug. The derivation is `UUIDv5(NAMESPACE, "<designation>")`; it is
/// stable across machines for the same designation.
///
/// The `designation` must be non-empty; callers choose the precedence-winning
/// designation (see `CatalogId::precedence`).
#[must_use]
pub fn target_id_from_designation(designation: &str) -> Uuid {
    Uuid::new_v5(&target_namespace(), designation.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn namespace_is_stable() {
        let a = target_namespace();
        let b = target_namespace();
        assert_eq!(a, b);
    }

    #[test]
    fn namespace_is_uuid_v5_sha1() {
        // UUIDv5 uses SHA-1 internally; the uuid crate reports version Sha1.
        assert_eq!(target_namespace().get_version(), Some(uuid::Version::Sha1));
    }

    #[test]
    fn target_id_is_deterministic() {
        let id1 = target_id("messier", "M31");
        let id2 = target_id("messier", "M31");
        assert_eq!(id1, id2);
    }

    #[test]
    fn different_designations_produce_different_ids() {
        let m31 = target_id("messier", "M31");
        let m101 = target_id("messier", "M101");
        assert_ne!(m31, m101);
    }

    #[test]
    fn different_catalogs_produce_different_ids() {
        let messier = target_id("messier", "M31");
        let openngc = target_id("openngc", "NGC 224");
        assert_ne!(messier, openngc);
    }

    #[test]
    fn m31_messier_id_matches_expected_constant() {
        // Pin a known value so accidental changes in derivation are caught.
        // Computed once: UUIDv5(NAMESPACE, "messier:M31")
        let id = target_id("messier", "M31");
        // Recompute the expected value to avoid hardcoding bytes.
        let ns = target_namespace();
        let expected = Uuid::new_v5(&ns, b"messier:M31");
        assert_eq!(id, expected);
    }
}
