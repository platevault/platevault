//! Library root, path, scan, and filesystem inventory boundaries.

pub mod artifact_watcher;
pub mod capability;
pub mod drive_scope;
pub mod watcher;

pub const CRATE_NAME: &str = "fs_inventory";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "fs_inventory");
    }
}
