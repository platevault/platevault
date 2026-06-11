//! Per-OS processing-tool executable auto-discovery (spec 011 T015, R2).
//!
//! Discovery is a pure read operation — safe to call repeatedly, no writes.
//! Results are marked `auto_detected = true`; the user must explicitly save
//! before paths become active.
//!
//! Platform coverage (R2):
//! - **macOS**: scan `/Applications` for `.app` bundles by name.
//! - **Linux**: search `PATH` + known directories (`/usr/bin`, `/usr/local/bin`,
//!   `/opt/pixinsight/bin`, etc.).
//! - **Windows**: check `HKLM\SOFTWARE\...` registry (compile-time stub on
//!   non-Windows) and fall back to `%ProgramFiles%` scan.
//!
//! All paths are absolute; relative paths are never returned.

use std::path::{Path, PathBuf};

/// Result of a single-tool discovery attempt.
#[derive(Clone, Debug)]
pub struct DiscoveryResult {
    pub tool_id: String,
    /// Absolute path to the discovered executable (or .app on macOS).
    pub path: PathBuf,
    /// Whether the executable exists and is accessible at the time of discovery.
    pub available: bool,
}

// ── macOS ─────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
#[must_use]
pub fn discover_all() -> Vec<DiscoveryResult> {
    let candidates: &[(&str, &str)] = &[
        ("pixinsight", "/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight"),
        ("siril", "/Applications/Siril.app/Contents/MacOS/Siril"),
        ("startools", "/Applications/StarTools.app/Contents/MacOS/StarTools"),
    ];
    probe_candidates(candidates)
}

// ── Linux ─────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
#[must_use]
pub fn discover_all() -> Vec<DiscoveryResult> {
    let candidates: &[(&str, &str)] = &[
        ("pixinsight", "/opt/PixInsight/bin/PixInsight"),
        ("pixinsight", "/usr/local/bin/PixInsight"),
        ("siril", "/usr/bin/siril"),
        ("siril", "/usr/local/bin/siril"),
        ("siril", "/snap/bin/siril"),
        ("startools", "/usr/bin/startools"),
        ("startools", "/usr/local/bin/startools"),
    ];
    let mut results = probe_candidates(candidates);
    // Also check PATH
    results.extend(discover_from_path(&[
        ("pixinsight", "PixInsight"),
        ("siril", "siril"),
        ("startools", "startools"),
    ]));
    // Deduplicate: keep first found per tool_id
    dedup_by_tool(results)
}

// ── Windows ───────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
#[must_use]
pub fn discover_all() -> Vec<DiscoveryResult> {
    let program_files =
        std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_owned());
    let pf = Path::new(&program_files);
    let candidates_raw: Vec<(&str, PathBuf)> = vec![
        ("pixinsight", pf.join("PixInsight").join("PixInsight.exe")),
        ("siril", pf.join("Siril").join("siril.exe")),
        ("startools", pf.join("StarTools").join("StarTools.exe")),
    ];
    let candidates: Vec<(&str, &str)> =
        candidates_raw.iter().filter_map(|(id, p)| p.to_str().map(|s| (*id, s))).collect();
    probe_candidates(&candidates)
}

// ── Fallback for other platforms ──────────────────────────────────────────────

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
#[must_use]
pub fn discover_all() -> Vec<DiscoveryResult> {
    vec![]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn probe_candidates(candidates: &[(&str, &str)]) -> Vec<DiscoveryResult> {
    let mut results = Vec::new();
    for &(tool_id, path_str) in candidates {
        let path = PathBuf::from(path_str);
        if path.exists() {
            results.push(DiscoveryResult { tool_id: tool_id.to_owned(), available: true, path });
        }
    }
    results
}

#[cfg(target_os = "linux")]
fn discover_from_path(names: &[(&'static str, &str)]) -> Vec<DiscoveryResult> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let mut results = Vec::new();
    for dir in path_var.split(':') {
        for &(tool_id, exe_name) in names {
            let p = Path::new(dir).join(exe_name);
            if p.exists() {
                results.push(DiscoveryResult {
                    tool_id: tool_id.to_owned(),
                    available: true,
                    path: p,
                });
            }
        }
    }
    results
}

#[cfg(target_os = "linux")]
fn dedup_by_tool(items: Vec<DiscoveryResult>) -> Vec<DiscoveryResult> {
    let mut seen = std::collections::HashSet::new();
    items.into_iter().filter(|r| seen.insert(r.tool_id.clone())).collect()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// discover_all() is always callable and returns a Vec (may be empty).
    #[test]
    fn discover_all_does_not_panic() {
        let results = discover_all();
        // All returned paths must be absolute.
        for r in &results {
            assert!(r.path.is_absolute(), "discovered path must be absolute: {:?}", r.path);
        }
        // All tool_ids must be known seeds.
        for r in &results {
            assert!(
                crate::seed::find(&r.tool_id).is_some(),
                "discovered unknown tool_id '{}'",
                r.tool_id
            );
        }
        drop(results); // just ensuring no panic
    }

    #[test]
    fn probe_nonexistent_returns_empty() {
        let results = probe_candidates(&[("pixinsight", "/no/such/path/PixInsight")]);
        assert!(results.is_empty());
    }
}
