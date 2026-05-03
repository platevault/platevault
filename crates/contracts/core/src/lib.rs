//! Rust-side contract DTO boundary.

pub const CRATE_NAME: &str = "contracts_core";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "contracts_core");
    }
}
