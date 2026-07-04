//! Filesystem operation primitives (spec 025).
//!
//! Each module owns one class of operation. They accept absolute paths
//! and return structured `PlanItemFailure` values (never raw io::Error).
//!
//! Constitution §II: never overwrite silently; operations check destination
//! emptiness before mutating. Destructive ops prefer trash/archive over
//! permanent delete (FR-008).

pub mod archive_op;
pub mod cas_check;
pub mod catalogue_op;
pub mod delete_op;
pub mod mkdir_op;
pub mod move_op;
pub mod path_gate;
pub mod trash_op;

pub use archive_op::archive_file;
pub use cas_check::{check_cas, CasSnapshot};
pub use catalogue_op::catalogue_noop;
pub use delete_op::delete_file;
pub use mkdir_op::make_dir;
pub use move_op::move_file;
pub use path_gate::{lexical_normalize, resolve_and_validate};
pub use trash_op::trash_file;
