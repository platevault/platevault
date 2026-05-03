//! Target catalog, aliases, identifiers, and observing-plan references.

pub const CRATE_NAME: &str = "targeting";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "targeting");
    }
}
