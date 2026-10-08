// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Projects (spec 065) as a reference source for Retire location review.
//!
//! A Project holds the assets of its effective Project-only rejects. Its
//! candidates are derived and hold nothing; its members are held by its runs,
//! which register as View references.

use std::collections::BTreeSet;
use std::sync::Arc;

use persistence_library::Catalog;
use uuid::Uuid;

use crate::library::{AssetReferences, ReferencesFuture};
use crate::ReferenceKind;

pub(crate) struct ProjectReferences {
    pub(crate) catalog: Arc<Catalog>,
}

impl AssetReferences for ProjectReferences {
    fn kind(&self) -> ReferenceKind {
        ReferenceKind::Project
    }

    fn references_to<'a>(&'a self, assets: &'a BTreeSet<Uuid>) -> ReferencesFuture<'a> {
        Box::pin(self.catalog.project_references(assets))
    }
}

/// Adopted masters (spec 068) as a reference source for Retire location review:
/// an adopted master holds the library copies it was generated from.
pub(crate) struct CalibrationReferences {
    pub(crate) catalog: Arc<Catalog>,
}

impl AssetReferences for CalibrationReferences {
    fn kind(&self) -> ReferenceKind {
        ReferenceKind::Calibration
    }

    fn references_to<'a>(&'a self, assets: &'a BTreeSet<Uuid>) -> ReferencesFuture<'a> {
        Box::pin(self.catalog.calibration_references(assets))
    }
}
