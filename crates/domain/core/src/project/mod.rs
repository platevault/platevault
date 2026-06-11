//! Project domain module (spec 008 F-2).
//!
//! Pure domain logic: channel inference, channel merge, name/tool validation.
//! No I/O, no dependencies on persistence or app-core.

pub mod channels;
pub mod validate;
