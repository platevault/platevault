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
//! - **Windows**: scan `%ProgramFiles%` and `%ProgramFiles(x86)%` for each tool's
//!   `bin\<exe>` (the real install layout) with a non-`bin` fallback. (A registry
//!   `HKLM\SOFTWARE\...` lookup is a future enhancement for non-standard installs.)
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
    // Probe both Program Files locations. PixInsight and Siril install their
    // executable under a `bin\` subdirectory (e.g.
    // `C:\Program Files\PixInsight\bin\PixInsight.exe`), so the `bin\` variant is
    // the primary candidate; the non-`bin` path is kept as a fallback for atypical
    // installs. Probed in order; `dedup_by_tool` keeps the first match per tool.
    let mut program_dirs: Vec<String> = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        program_dirs.push(pf);
    } else {
        program_dirs.push(r"C:\Program Files".to_owned());
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        program_dirs.push(pf86);
    }

    // (tool_id, install_subdir, exe_name) — probed as both `<sub>\bin\<exe>` and `<sub>\<exe>`.
    let tools: &[(&str, &str, &str)] = &[
        ("pixinsight", "PixInsight", "PixInsight.exe"),
        ("siril", "Siril", "siril.exe"),
        ("startools", "StarTools", "StarTools.exe"),
    ];

    let mut candidates_raw: Vec<(&str, PathBuf)> = Vec::new();
    for dir in &program_dirs {
        let pf = Path::new(dir);
        for &(tool_id, subdir, exe) in tools {
            candidates_raw.push((tool_id, pf.join(subdir).join("bin").join(exe)));
            candidates_raw.push((tool_id, pf.join(subdir).join(exe)));
        }
    }
    let candidates: Vec<(&str, &str)> =
        candidates_raw.iter().filter_map(|(id, p)| p.to_str().map(|s| (*id, s))).collect();
    dedup_by_tool(probe_candidates(&candidates))
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

#[cfg(any(target_os = "linux", target_os = "windows"))]
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
