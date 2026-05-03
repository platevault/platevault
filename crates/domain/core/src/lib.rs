//! Pure domain concepts and invariants for Astro Library Manager.

pub const CRATE_NAME: &str = "domain_core";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "domain_core");
    }
}
