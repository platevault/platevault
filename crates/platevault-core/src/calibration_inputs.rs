// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs, master adoption and session matching (spec 068 as
//! amended by D-W101 to D-W106) on the composed library: each method
//! composes one catalog method with the calibration [`Rules`] and, where
//! files are hashed, the disk probe.

use persistence_library::{CalibrationInputDetail, CalibrationInputSummary, InputQuery};
use uuid::Uuid;

use crate::calibration::Rules;
use crate::library::{InventoryProbe, Library};
use crate::{
    AdoptionDestination, AdoptionOperation, AdoptionReview, AdoptionSource, AdoptionState,
    CandidateRef, CustodyFact, InputKind, InputRef, LibraryError, Revision, SessionCalibration,
};

impl Library {
    /// Raw sets, adopted masters and detected candidates in group order.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::calibration_inputs`].
    pub async fn calibration_inputs(
        &self,
        query: &InputQuery,
    ) -> Result<Vec<CalibrationInputSummary>, LibraryError> {
        self.catalog().calibration_inputs(query, &Rules).await
    }

    /// One input's evidence, members, excluded members and provenance.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::calibration_input`].
    pub async fn calibration_input(
        &self,
        input: &CandidateRef,
    ) -> Result<CalibrationInputDetail, LibraryError> {
        self.catalog().calibration_input(input, &Rules).await
    }

    /// Durably review adopting a detected master; writes no file.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::review_adoption`].
    pub async fn calibration_review_adoption(
        &self,
        source: &AdoptionSource,
        destination: &AdoptionDestination,
    ) -> Result<AdoptionReview, LibraryError> {
        self.catalog().review_adoption(source, destination, &Rules, InventoryProbe::default()).await
    }

    /// Confirm a reviewed adoption and return the settled operation.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::adopt_master`].
    pub async fn calibration_adopt(
        &self,
        review: Uuid,
        expected: Revision,
    ) -> Result<AdoptionOperation, LibraryError> {
        Box::pin(self.catalog().adopt_master(review, expected, InventoryProbe::default())).await
    }

    /// Durable adoption operations, including interrupted ones after restart.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::list_adoptions`].
    pub async fn calibration_list_adoptions(
        &self,
        state: Option<AdoptionState>,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<AdoptionOperation>, LibraryError> {
        self.catalog().list_adoptions(state, offset, limit).await
    }

    /// The calibration files STO keeps in protected Keep.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::calibration_custody_facts`].
    pub async fn calibration_custody_facts(&self) -> Result<Vec<CustodyFact>, LibraryError> {
        self.catalog().calibration_custody_facts(&Rules).await
    }

    /// Match the calibration of every session whose matching is pending
    /// (LIB-FR-23 to LIB-FR-25): the library calls this after each scan and
    /// import commit and when it opens, and the shell after a rig
    /// confirmation. Frames a match binds are hashed with the disk probe.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::match_pending_calibration`].
    pub async fn match_pending_calibration(&self) -> Result<Vec<Uuid>, LibraryError> {
        self.catalog().match_pending_calibration(&Rules, InventoryProbe::default()).await
    }

    /// Matching after a commit. Import and scans never wait on calibration
    /// (LIB-FR-24): a failure leaves the sessions pending for the next
    /// commit or start, and is logged rather than failing the commit's
    /// caller.
    pub(crate) async fn match_calibration_after_commit(&self) {
        if let Err(error) = self.match_pending_calibration().await {
            tracing::warn!(%error, "calibration matching failed; the sessions stay pending");
        }
    }

    /// Reassign a session's calibration kind to a raw set or master the
    /// user picked, checked against the session with the calibration rules.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::reassign_calibration`].
    pub async fn reassign_calibration(
        &self,
        session_id: Uuid,
        kind: InputKind,
        input: InputRef,
        expected: Revision,
    ) -> Result<SessionCalibration, LibraryError> {
        self.catalog()
            .reassign_calibration(
                session_id,
                kind,
                input,
                expected,
                &Rules,
                InventoryProbe::default(),
            )
            .await
    }
}
