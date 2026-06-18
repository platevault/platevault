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
//! - **Windows**: query the registry — `App Paths` plus `Uninstall` entries (matched
//!   by `DisplayName`, exe resolved from `DisplayIcon`/`InstallLocation`) across the
//!   64-bit, 32-bit (`WOW6432Node`) and per-user hives — so a tool is found wherever
//!   it was installed; falls back to a `%ProgramFiles%[(x86)]\<Tool>\bin\<exe>` scan.
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

/// Known tools: `(tool_id, display-name substring [lowercased], install subdir, exe filename)`.
#[cfg(target_os = "windows")]
const WINDOWS_TOOLS: &[(&str, &str, &str, &str)] = &[
    ("pixinsight", "pixinsight", "PixInsight", "PixInsight.exe"),
    ("siril", "siril", "Siril", "siril.exe"),
    ("startools", "startools", "StarTools", "StarTools.exe"),
];

#[cfg(target_os = "windows")]
#[must_use]
pub fn discover_all() -> Vec<DiscoveryResult> {
    // Application-based detection: ask the OS where the app is installed (registry)
    // rather than assuming a fixed path, so a tool installed to a non-default
    // location is still found. The Program Files scan is a fallback. `dedup_by_tool`
    // keeps the first (registry-preferred) match per tool.
    let mut results: Vec<DiscoveryResult> = Vec::new();
    results.extend(registry_discover());
    results.extend(program_files_scan());
    dedup_by_tool(results)
}

/// Resolve installed apps from the Windows registry: per-exe `App Paths` and the
/// `Uninstall` entries (matched by `DisplayName`, exe derived from `DisplayIcon`
/// or `InstallLocation`). Covers 64-bit, 32-bit (`WOW6432Node`), and per-user hives.
#[cfg(target_os = "windows")]
fn registry_discover() -> Vec<DiscoveryResult> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut results: Vec<DiscoveryResult> = Vec::new();

    // 1. App Paths — default value of `...\App Paths\<exe>` is the full exe path.
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let root = RegKey::predef(hive);
        for &(tool_id, _name, _subdir, exe) in WINDOWS_TOOLS {
            let key_path = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
            if let Ok(k) = root.open_subkey(&key_path) {
                if let Ok(p) = k.get_value::<String, _>("") {
                    push_if_exe(&mut results, tool_id, p.trim().trim_matches('"'));
                }
            }
        }
    }

    // 2. Uninstall entries — match DisplayName, derive the exe from DisplayIcon/InstallLocation.
    let uninstall_roots = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];
    for (hive, path) in uninstall_roots {
        let root = RegKey::predef(hive);
        let Ok(unkey) = root.open_subkey(path) else { continue };
        for name in unkey.enum_keys().flatten() {
            let Ok(sub) = unkey.open_subkey(&name) else { continue };
            let display: String = sub.get_value("DisplayName").unwrap_or_default();
            let dl = display.to_lowercase();
            for &(tool_id, name_sub, _subdir, exe) in WINDOWS_TOOLS {
                if !dl.contains(name_sub) {
                    continue;
                }
                // DisplayIcon is often the exe itself (with an optional ",<index>" suffix).
                if let Ok(icon) = sub.get_value::<String, _>("DisplayIcon") {
                    let icon_path = icon.split(',').next().unwrap_or("").trim().trim_matches('"');
                    push_if_exe(&mut results, tool_id, icon_path);
                }
                // InstallLocation is the install dir — probe `bin\<exe>` then `<exe>`.
                if let Ok(loc) = sub.get_value::<String, _>("InstallLocation") {
                    let loc = loc.trim().trim_matches('"');
                    if !loc.is_empty() {
                        let base = Path::new(loc);
                        push_if_exe_path(&mut results, tool_id, base.join("bin").join(exe));
                        push_if_exe_path(&mut results, tool_id, base.join(exe));
                    }
                }
            }
        }
    }
    results
}

/// Fallback: scan the default Program Files layout (`<Tool>\bin\<exe>` + non-`bin`).
#[cfg(target_os = "windows")]
fn program_files_scan() -> Vec<DiscoveryResult> {
    let mut dirs: Vec<String> = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        dirs.push(pf);
    } else {
        dirs.push(r"C:\Program Files".to_owned());
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        dirs.push(pf86);
    }
    let mut results: Vec<DiscoveryResult> = Vec::new();
    for dir in &dirs {
        let pf = Path::new(dir);
        for &(tool_id, _name, subdir, exe) in WINDOWS_TOOLS {
            push_if_exe_path(&mut results, tool_id, pf.join(subdir).join("bin").join(exe));
            push_if_exe_path(&mut results, tool_id, pf.join(subdir).join(exe));
        }
    }
    results
}

/// Push a result if `path_str` is an absolute, existing `.exe`.
#[cfg(target_os = "windows")]
fn push_if_exe(results: &mut Vec<DiscoveryResult>, tool_id: &str, path_str: &str) {
    if !path_str.is_empty() {
        push_if_exe_path(results, tool_id, PathBuf::from(path_str));
    }
}

#[cfg(target_os = "windows")]
fn push_if_exe_path(results: &mut Vec<DiscoveryResult>, tool_id: &str, path: PathBuf) {
    let is_exe =
        path.extension().and_then(|e| e.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("exe"));
    if path.is_absolute() && is_exe && path.exists() {
        results.push(DiscoveryResult { tool_id: tool_id.to_owned(), available: true, path });
    }
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
