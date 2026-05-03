//! XISF metadata extraction adapter boundary.

pub const CRATE_NAME: &str = "metadata_xisf";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "metadata_xisf");
    }
}
