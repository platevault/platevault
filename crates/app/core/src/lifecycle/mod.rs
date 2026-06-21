//! Lifecycle transition, ledger, provenance, and artifact use cases.
//!
//! Groups the lifecycle-domain use-case modules (spec 002 / spec 012). Each
//! sub-module is re-exported from the crate root so existing
//! `app_core::<module>` paths remain stable.

pub mod artifact;
pub mod ledger_use_case;
pub mod lifecycle_use_case;
pub mod provenance_use_case;
pub mod transition_use_case;
