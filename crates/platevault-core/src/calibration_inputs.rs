// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Calibration inputs and run decisions (spec 068 as amended by D-W5, D-W37
//! and D-W55) on the composed library: each method composes one catalog
//! method with the calibration [`Rules`] and, where files are hashed, the
//! disk probe.

use persistence_library::{CalibrationInputDetail, CalibrationInputSummary, InputQuery};
use uuid::Uuid;

use crate::calibration::Rules;
use crate::library::{InventoryProbe, Library};
use crate::{
    AdoptionDestination, AdoptionOperation, AdoptionReview, AdoptionSource, AdoptionState,
    CalibrationAssignment, CalibrationHandoff, CalibrationPlan, CalibrationPolicy,
    CalibrationReadiness, CalibrationViewPlan, CandidateRef, CustodyFact, DecisionItem,
    ExpectedSession, InputKind, LibraryError, ProjectCalibrationEvidence, Requirement,
    RequirementKey, Revision,
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

    /// Every listed candidate per light group and kind, without a run.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::calibration_match`].
    pub async fn calibration_match(
        &self,
        sessions: &[ExpectedSession],
        kinds: &[InputKind],
    ) -> Result<Vec<Requirement>, LibraryError> {
        self.catalog().calibration_match(sessions, kinds, &Rules).await
    }

    /// The requirement table of committed run revision `revision`.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::calibration_view_plan`].
    pub async fn calibration_view_plan(
        &self,
        view: Uuid,
        revision: Revision,
    ) -> Result<CalibrationViewPlan, LibraryError> {
        self.catalog().calibration_view_plan(view, revision, &Rules).await
    }

    /// The Calibrate step's readiness line; it feeds Home's blocked run.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::calibration_readiness`].
    pub async fn calibration_readiness(
        &self,
        view: Uuid,
        revision: Revision,
    ) -> Result<CalibrationReadiness, LibraryError> {
        self.catalog().calibration_readiness(view, revision, &Rules).await
    }

    /// The PREP read of committed run revision `revision`.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::calibration_handoff`].
    pub async fn calibration_handoff(
        &self,
        view: Uuid,
        revision: Revision,
    ) -> Result<CalibrationHandoff, LibraryError> {
        self.catalog().calibration_handoff(view, revision, &Rules).await
    }

    /// Record the kinds a run requires.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::set_required_kinds`].
    pub async fn calibration_set_required_kinds(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        kinds: &[InputKind],
    ) -> Result<CalibrationPlan, LibraryError> {
        self.catalog().set_required_kinds(view, revision, expected, kinds).await
    }

    /// Turn the run's automatic assignment on or off.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::set_calibration_policy`].
    pub async fn calibration_set_policy(
        &self,
        view: Uuid,
        expected: Revision,
        policy: CalibrationPolicy,
    ) -> Result<CalibrationPlan, LibraryError> {
        self.catalog().set_calibration_policy(view, expected, policy).await
    }

    /// The automatic match the Calibrate step runs when it opens and after a
    /// new membership revision.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::assign_calibration`].
    pub async fn calibration_assign(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
    ) -> Result<CalibrationAssignment, LibraryError> {
        self.catalog().assign_calibration(view, revision, expected, &Rules, InventoryProbe).await
    }

    /// Accept or replace inputs after hashing every input file.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::accept_calibration`].
    pub async fn calibration_accept(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[DecisionItem],
    ) -> Result<CalibrationViewPlan, LibraryError> {
        self.catalog()
            .accept_calibration(view, revision, expected, items, &Rules, InventoryProbe)
            .await
    }

    /// Record a reasoned exception after hashing the input.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::record_calibration_exception`].
    pub async fn calibration_record_exception(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        item: &DecisionItem,
        reason: &str,
    ) -> Result<CalibrationViewPlan, LibraryError> {
        self.catalog()
            .record_calibration_exception(
                view,
                revision,
                expected,
                item,
                reason,
                &Rules,
                InventoryProbe,
            )
            .await
    }

    /// Exclude requirements without an input.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::exclude_calibration`].
    pub async fn calibration_exclude(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[RequirementKey],
        reason: Option<&str>,
    ) -> Result<CalibrationViewPlan, LibraryError> {
        self.catalog().exclude_calibration(view, revision, expected, items, reason, &Rules).await
    }

    /// End effective decisions per light group and kind.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::withdraw_calibration`].
    pub async fn calibration_withdraw(
        &self,
        view: Uuid,
        revision: Revision,
        expected: Revision,
        items: &[RequirementKey],
    ) -> Result<CalibrationViewPlan, LibraryError> {
        self.catalog().withdraw_calibration(view, revision, expected, items, &Rules).await
    }

    /// Missing-calibration and exposure-mismatch evidence of a Project.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::project_calibration_evidence`].
    pub async fn project_calibration_evidence(
        &self,
        project: Uuid,
    ) -> Result<ProjectCalibrationEvidence, LibraryError> {
        self.catalog().project_calibration_evidence(project, &Rules).await
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
        self.catalog().review_adoption(source, destination, &Rules, InventoryProbe).await
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
        Box::pin(self.catalog().adopt_master(review, expected, InventoryProbe)).await
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
}
