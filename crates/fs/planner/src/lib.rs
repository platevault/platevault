//! Reviewable filesystem plans and plan item boundaries.

pub const CRATE_NAME: &str = "fs_planner";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "fs_planner");
    }
}
