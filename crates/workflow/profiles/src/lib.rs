//! Processing tool and workflow profile types, seeds, and platform-specific
//! launch helpers (spec 011 T001/T002/T008/T015).
//!
//! ## Crate responsibilities
//!
//! - [`ToolProfile`]: static per-tool descriptor (name, args template, capabilities).
//! - [`seed::all`]: seeded profiles for PixInsight, Siril, and Planetary Suite.
//! - [`args::render`]: token-pattern substitution (`{folder}`, `{file}`).
//! - [`launch`]: platform-specific detach helpers behind a [`ProcessSpawner`] trait.
//! - [`discover`]: per-OS executable auto-detection (pure filesystem reads).
//!
//! Constitution III: this crate NEVER processes images; it only models how to
//! invoke external tools and where to find them.

#![allow(clippy::doc_markdown)] // spec/domain terminology

pub mod args;
pub mod discover;
pub mod launch;
pub mod seed;

// ── ToolProfile ───────────────────────────────────────────────────────────────

/// A single-argument token in an args template.
///
/// Closed enum per spec 011 R3: only `{folder}` and `{file}` are allowed
/// beside literal strings.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArgsToken {
    /// A literal CLI argument (no substitution).
    Literal(String),
    /// Replaced with the resolved working folder path.
    Folder,
    /// Replaced with a selected file path (optional in v1 tool templates).
    File,
}

/// How the process should be detached from the parent.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DetachStrategy {
    /// Windows: `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` flags.
    SpawnDetached,
    /// macOS .app bundles: `open -b <bundle_id> --args …`.
    OpenBundleId,
    /// Linux and macOS plain binaries: `setsid` via `pre_exec`.
    Setsid,
}

/// Per-tool descriptor seeded by [`seed`].
///
/// Mutable fields (`executable_path`, `enabled`) are stored in Settings under
/// the `tool_workflows` namespace and joined at read time.
#[derive(Clone, Debug)]
pub struct ToolProfile {
    /// Stable snake-case identifier matching `[a-z][a-z0-9_]*` (C2).
    pub id: &'static str,
    /// Display name shown in Settings and the project CTA label.
    pub name: &'static str,
    /// macOS bundle identifier (`open -b <bundle_id>`). Null on Windows/Linux.
    pub bundle_id: Option<&'static str>,
    /// Parsed args template. May only contain `ArgsToken` values.
    pub args_template: Vec<ArgsToken>,
    /// Whether the tool can meaningfully receive a folder path as an argument.
    pub supports_open_folder: bool,
    /// Preferred detach strategy for this tool.
    pub detach_strategy: DetachStrategy,
}

impl ToolProfile {
    /// Returns `true` if `id` matches the `[a-z][a-z0-9_]*` invariant (C2).
    #[must_use]
    pub fn id_is_valid(id: &str) -> bool {
        let mut chars = id.chars();
        match chars.next() {
            Some(c) if c.is_ascii_lowercase() => {}
            _ => return false,
        }
        chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    }

    /// Validate the profile invariants (C2 + args-template consistency).
    ///
    /// # Errors
    ///
    /// Returns a description string when the profile violates an invariant.
    pub fn validate(&self) -> Result<(), String> {
        if !Self::id_is_valid(self.id) {
            return Err(format!("tool_id '{}' does not match [a-z][a-z0-9_]* (C2)", self.id));
        }
        if !self.supports_open_folder && self.args_template.contains(&ArgsToken::Folder) {
            return Err(format!(
                "profile '{}': supports_open_folder=false but {{folder}} appears in args_template",
                self.id
            ));
        }
        Ok(())
    }
}
