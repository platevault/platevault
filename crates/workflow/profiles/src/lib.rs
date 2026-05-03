//! Processing tool and workflow profile boundaries.

pub const CRATE_NAME: &str = "workflow_profiles";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "workflow_profiles");
    }
}
