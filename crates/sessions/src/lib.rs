//! Acquisition and calibration session modeling boundaries.

pub const CRATE_NAME: &str = "sessions";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "sessions");
    }
}
