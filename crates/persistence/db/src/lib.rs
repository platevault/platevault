//! Persistence and repository boundary.

pub const CRATE_NAME: &str = "persistence_db";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "persistence_db");
    }
}
