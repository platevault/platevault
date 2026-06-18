//! Resolution cache: read/write, dedupe by SIMBAD oid, source precedence.
//!
//! The local SQLite cache is the durable record (constitution §V). Entries are
//! deduplicated by `simbad_oid` when non-null (spec 035 FR-007); a
//! `user-override` row takes precedence over `resolved`/`seed` and a later
//! SIMBAD resolution MUST NOT overwrite it (FR-014).

// TODO(T008): implement cache read/write + source-precedence upsert. Skeleton
// stub for now.
