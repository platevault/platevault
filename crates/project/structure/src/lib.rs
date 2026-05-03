//! App-owned project envelope and supported project structure boundaries.

pub const CRATE_NAME: &str = "project_structure";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "project_structure");
    }
}
