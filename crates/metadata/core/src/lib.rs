//! Shared metadata model used by format-specific extractors.

pub const CRATE_NAME: &str = "metadata_core";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "metadata_core");
    }
}
