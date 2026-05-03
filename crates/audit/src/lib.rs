//! Audit event and operation history boundaries.

pub const CRATE_NAME: &str = "audit";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "audit");
    }
}
