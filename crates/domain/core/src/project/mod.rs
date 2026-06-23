//! Project domain module (spec 008 F-2).
//!
//! Pure domain logic: channel inference, channel merge, per-channel integration
//! accounting, name/tool validation.
//! No I/O, no dependencies on persistence or app-core.

pub mod channel_map;
pub mod channels;
pub mod validate;
