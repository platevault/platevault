//! Calibration reuse, candidate matching, and confidence model boundaries.

pub const CRATE_NAME: &str = "calibration_core";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "calibration_core");
    }
}
