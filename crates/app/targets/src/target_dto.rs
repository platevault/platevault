//! Shared target DTO mapping helpers (US11 T143).
//!
//! Single home for the cache-domain → contract-DTO conversions that were
//! previously duplicated byte-for-byte in `target_search.rs` and
//! `target_resolve.rs`. The mapping output is identical to those copies; this
//! is pure consolidation with no behavior change.

use contracts_core::targets::{TargetObjectType, TargetSource};
use targeting_resolver::cache::CachedTarget;
use targeting_resolver::{AliasKind, ObjectType, TargetSource as CacheSource};

/// Map a resolver-domain [`ObjectType`] to the contract [`TargetObjectType`].
#[must_use]
pub(crate) fn map_object_type(o: ObjectType) -> TargetObjectType {
    match o {
        ObjectType::Galaxy => TargetObjectType::Galaxy,
        ObjectType::PlanetaryNebula => TargetObjectType::PlanetaryNebula,
        ObjectType::EmissionNebula => TargetObjectType::EmissionNebula,
        ObjectType::ReflectionNebula => TargetObjectType::ReflectionNebula,
        ObjectType::DarkNebula => TargetObjectType::DarkNebula,
        ObjectType::OpenCluster => TargetObjectType::OpenCluster,
        ObjectType::GlobularCluster => TargetObjectType::GlobularCluster,
        ObjectType::SupernovaRemnant => TargetObjectType::SupernovaRemnant,
        ObjectType::GalaxyCluster => TargetObjectType::GalaxyCluster,
        ObjectType::DoubleStar => TargetObjectType::DoubleStar,
        ObjectType::Asterism => TargetObjectType::Asterism,
        ObjectType::Other => TargetObjectType::Other,
    }
}

/// Map a resolver-domain cache source to the contract [`TargetSource`].
#[must_use]
pub(crate) fn map_source(s: CacheSource) -> TargetSource {
    match s {
        CacheSource::Seed => TargetSource::Seed,
        CacheSource::Resolved => TargetSource::Resolved,
        CacheSource::UserOverride => TargetSource::UserOverride,
    }
}

/// Find the common name (a `common_name` alias) for a cached target, if any.
///
/// Previously duplicated byte-for-byte in `target_resolve.rs` and
/// `target_search.rs` (Tier-3 dedup).
#[must_use]
pub(crate) fn common_name(target: &CachedTarget) -> Option<String> {
    target.aliases.iter().find(|a| matches!(a.kind, AliasKind::CommonName)).map(|a| a.alias.clone())
}
