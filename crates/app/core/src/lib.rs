//! Application use-case orchestration boundary.

pub const CRATE_NAME: &str = "app_core";

#[cfg(test)]
mod tests {
    use super::CRATE_NAME;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(CRATE_NAME, "app_core");
    }
}
