//! Lifecycle transition, ledger, provenance, and artifact use cases.
//!
//! Groups the lifecycle-domain use-case modules (spec 002 / spec 012). Each
//! sub-module is re-exported from the crate root so existing
//! `app_core::<module>` paths remain stable.
//!
//! Extracted from `app_core` into its own crate (spec 042 / T253 O3b). It is a
//! self-contained domain group (its only internal reference is to its own
//! `lifecycle_use_case` module). `app_core` re-exports these modules at their
//! original `app_core::<module>` paths so the public surface is byte-identical.
#![allow(clippy::doc_markdown)] // spec/domain terminology not appropriate for backticks

pub mod artifact;
pub mod ledger_use_case;
pub mod lifecycle_use_case;
pub mod provenance_use_case;
pub mod transition_use_case;
