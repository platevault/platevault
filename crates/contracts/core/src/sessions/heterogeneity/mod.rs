// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Portable contracts for Spec 062 immutable session heterogeneity.

pub mod calibration;
pub mod inbox;
pub mod metadata;
pub mod projects;
pub mod relations;
pub mod settings;
pub mod shared;

pub use shared::{
    AuditRecord, BoundedList, CanonicalId, CommandFence, ContractEvent, Cursor, CursorBinding,
    Digest, ErrorCode, FiniteDecimal, KeysetListOperation, LocalDate, MutationContext,
    NonBlankSafeText, Page, PageBasis, PageRequest, PortableContractError, ProtectedResourceState,
    Rfc3339Timestamp, SafeErrorDetails, SafeText, ValidationError,
};
