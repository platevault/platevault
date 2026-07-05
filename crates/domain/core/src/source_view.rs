//! Spec 049 (T009): source view generation link-kind resolution.
//!
//! Pure domain logic (no I/O). Deterministic mapping from
//! `(DriveScope, settings pair defaults, FilesystemCapability)` to a
//! materialization kind, or a refusal, per FR-004 / FR-004a / FR-004b /
//! FR-022. Drive-scope classification and the filesystem-capability probe
//! themselves require I/O and live in `fs_inventory` (T007/T008); this module
//! only implements the deterministic *rule*.

use serde::{Deserialize, Serialize};
use specta::Type;

/// Per-item drive-scope classification relative to the generation destination
/// (spec 049 FR-004, "Cross-drive selection" edge case).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DriveScope {
    /// Source and destination are on the same volume.
    IntraDrive,
    /// Source and destination are on different volumes.
    CrossDrive,
}

/// Resolved link kind recorded per item
/// (`PreparedSourceViewItem.materialization`, spec 026 schema reused as-is).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Materialization {
    Symlink,
    Hardlink,
    Junction,
    Copy,
}

impl Materialization {
    /// The exact DB/wire string used by `prepared_source_view_items.materialization`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Symlink => "symlink",
            Self::Hardlink => "hardlink",
            Self::Junction => "junction",
            Self::Copy => "copy",
        }
    }

    /// Parse the DB/wire string. Unknown values conservatively parse to
    /// `Copy` is NOT done here — callers must treat unknown strings as an
    /// error, so this returns `None` instead of silently guessing a kind.
    #[must_use]
    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s {
            "symlink" => Some(Self::Symlink),
            "hardlink" => Some(Self::Hardlink),
            "junction" => Some(Self::Junction),
            "copy" => Some(Self::Copy),
            _ => None,
        }
    }
}

/// Destination/volume link-capability probe outcome (spec 049 FR-004/FR-004c).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Default)]
pub struct FilesystemCapability {
    pub symlink_available: bool,
    pub junction_available: bool,
    pub hardlink_available: bool,
}

/// Outcome of link-kind resolution: a rule-chosen kind, optionally carrying a
/// non-silent capability-drift notice (FR-004b) when the settings-pair default
/// was not achievable and a documented fallback was applied instead.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ResolvedLinkKind {
    pub kind: Materialization,
    /// The originally-requested (settings-pair) kind, when it differs from
    /// `kind` because a fallback was applied. `None` means no drift occurred.
    pub capability_drift: Option<Materialization>,
}

/// No link kind is achievable for this item and no copy opt-in was given
/// (spec 049 CL-3 / FR-003 / FR-004b — refuse, never silently copy).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NoLinkKind;

/// Deterministic per-drive-scope link-kind resolution (FR-004/FR-022).
///
/// Rules:
/// - `intra_drive` → `intra_default`, falling back through the documented
///   chain on capability drift (FR-004b).
/// - `cross_drive` → `cross_default`; `hardlink` is never valid cross-drive
///   (FR-004a) even if passed in by a caller with a stale/invalid setting —
///   it is treated as `symlink` for defence in depth.
/// - No achievable kind and `copy_opt_in == false` → `Err(NoLinkKind)`.
/// - No achievable kind and `copy_opt_in == true` → resolves to `Copy` (an
///   explicit per-generation user opt-in only, never silent — FR-003).
///
/// # Errors
///
/// Returns [`NoLinkKind`] when no link kind is achievable and `copy_opt_in`
/// is `false`.
pub fn resolve_link_kind(
    scope: DriveScope,
    intra_default: Materialization,
    cross_default: Materialization,
    capability: FilesystemCapability,
    copy_opt_in: bool,
) -> Result<ResolvedLinkKind, NoLinkKind> {
    let requested = match scope {
        DriveScope::IntraDrive => intra_default,
        DriveScope::CrossDrive if cross_default == Materialization::Hardlink => {
            Materialization::Symlink
        }
        DriveScope::CrossDrive => cross_default,
    };

    if is_achievable(requested, scope, capability) {
        return Ok(ResolvedLinkKind { kind: requested, capability_drift: None });
    }

    for fallback in fallback_chain(scope) {
        if *fallback != requested && is_achievable(*fallback, scope, capability) {
            return Ok(ResolvedLinkKind { kind: *fallback, capability_drift: Some(requested) });
        }
    }

    if copy_opt_in {
        return Ok(ResolvedLinkKind {
            kind: Materialization::Copy,
            capability_drift: Some(requested),
        });
    }

    Err(NoLinkKind)
}

fn is_achievable(
    kind: Materialization,
    scope: DriveScope,
    capability: FilesystemCapability,
) -> bool {
    match kind {
        Materialization::Symlink => capability.symlink_available,
        Materialization::Junction => capability.junction_available,
        // Hardlinks cannot cross volumes by definition (FR-004a), regardless
        // of what the capability probe reports.
        Materialization::Hardlink => {
            scope == DriveScope::IntraDrive && capability.hardlink_available
        }
        Materialization::Copy => true,
    }
}

fn fallback_chain(scope: DriveScope) -> &'static [Materialization] {
    match scope {
        DriveScope::IntraDrive => {
            &[Materialization::Hardlink, Materialization::Symlink, Materialization::Junction]
        }
        DriveScope::CrossDrive => &[Materialization::Symlink, Materialization::Junction],
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_link_kind, DriveScope, FilesystemCapability, Materialization, NoLinkKind};

    const ALL_CAPABLE: FilesystemCapability = FilesystemCapability {
        symlink_available: true,
        junction_available: true,
        hardlink_available: true,
    };
    const NONE_CAPABLE: FilesystemCapability = FilesystemCapability {
        symlink_available: false,
        junction_available: false,
        hardlink_available: false,
    };

    #[test]
    fn intra_drive_uses_intra_default_when_achievable() {
        let r = resolve_link_kind(
            DriveScope::IntraDrive,
            Materialization::Hardlink,
            Materialization::Symlink,
            ALL_CAPABLE,
            false,
        )
        .unwrap();
        assert_eq!(r.kind, Materialization::Hardlink);
        assert_eq!(r.capability_drift, None);
    }

    #[test]
    fn cross_drive_uses_cross_default_when_achievable() {
        let r = resolve_link_kind(
            DriveScope::CrossDrive,
            Materialization::Hardlink,
            Materialization::Symlink,
            ALL_CAPABLE,
            false,
        )
        .unwrap();
        assert_eq!(r.kind, Materialization::Symlink);
        assert_eq!(r.capability_drift, None);
    }

    #[test]
    fn cross_drive_never_resolves_hardlink_even_if_configured() {
        // Defence-in-depth: even a stale/invalid cross-drive default of
        // hardlink must never be chosen (FR-004a).
        let cap = FilesystemCapability {
            symlink_available: true,
            junction_available: true,
            hardlink_available: true,
        };
        let r = resolve_link_kind(
            DriveScope::CrossDrive,
            Materialization::Hardlink,
            Materialization::Hardlink,
            cap,
            false,
        )
        .unwrap();
        assert_ne!(r.kind, Materialization::Hardlink);
    }

    #[test]
    fn intra_drive_capability_drift_falls_back_to_symlink() {
        let cap = FilesystemCapability {
            symlink_available: true,
            junction_available: false,
            hardlink_available: false,
        };
        let r = resolve_link_kind(
            DriveScope::IntraDrive,
            Materialization::Hardlink,
            Materialization::Symlink,
            cap,
            false,
        )
        .unwrap();
        assert_eq!(r.kind, Materialization::Symlink);
        assert_eq!(r.capability_drift, Some(Materialization::Hardlink));
    }

    #[test]
    fn cross_drive_capability_drift_falls_back_to_junction() {
        let cap = FilesystemCapability {
            symlink_available: false,
            junction_available: true,
            hardlink_available: false,
        };
        let r = resolve_link_kind(
            DriveScope::CrossDrive,
            Materialization::Hardlink,
            Materialization::Symlink,
            cap,
            false,
        )
        .unwrap();
        assert_eq!(r.kind, Materialization::Junction);
        assert_eq!(r.capability_drift, Some(Materialization::Symlink));
    }

    #[test]
    fn no_achievable_kind_without_copy_opt_in_refuses() {
        let r = resolve_link_kind(
            DriveScope::IntraDrive,
            Materialization::Hardlink,
            Materialization::Symlink,
            NONE_CAPABLE,
            false,
        );
        assert_eq!(r, Err(NoLinkKind));
    }

    #[test]
    fn no_achievable_kind_with_copy_opt_in_falls_back_to_copy() {
        let r = resolve_link_kind(
            DriveScope::IntraDrive,
            Materialization::Hardlink,
            Materialization::Symlink,
            NONE_CAPABLE,
            true,
        )
        .unwrap();
        assert_eq!(r.kind, Materialization::Copy);
        assert_eq!(r.capability_drift, Some(Materialization::Hardlink));
    }

    #[test]
    fn materialization_str_round_trips() {
        for m in [
            Materialization::Symlink,
            Materialization::Hardlink,
            Materialization::Junction,
            Materialization::Copy,
        ] {
            assert_eq!(Materialization::from_str_opt(m.as_str()), Some(m));
        }
        assert_eq!(Materialization::from_str_opt("bogus"), None);
    }
}
