// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Args-template renderer (spec 011 T001, R3).
//!
//! Renders a `&[ArgsToken]` against a substitution context, returning a
//! `Vec<String>` of concrete CLI arguments. Only the closed token vocabulary
//! `{folder}` and `{file}` is supported; unknown patterns are rejected at
//! parse time.
//!
//! Constitution III: this module only builds argv; it never spawns processes.

use crate::ArgsToken;

/// Context supplied to [`render`] for token substitution.
#[derive(Clone, Debug, Default)]
pub struct RenderContext<'a> {
    /// The resolved working folder path. Used for `ArgsToken::Folder`.
    pub folder: Option<&'a str>,
    /// An optional selected file path. Used for `ArgsToken::File`.
    pub file: Option<&'a str>,
}

/// Render a `&[ArgsToken]` against the given context.
///
/// Each `Literal` is passed through unchanged. `Folder` and `File` tokens are
/// replaced with the corresponding context field. If a token's field is `None`
/// in the context the argument is simply omitted (not an error).
///
/// Returns the rendered argument list.
#[must_use]
pub fn render(template: &[ArgsToken], ctx: &RenderContext<'_>) -> Vec<String> {
    let mut out = Vec::with_capacity(template.len());
    for token in template {
        match token {
            ArgsToken::Literal(s) => out.push(s.clone()),
            ArgsToken::Folder => {
                if let Some(f) = ctx.folder {
                    out.push(f.to_owned());
                }
            }
            ArgsToken::File => {
                if let Some(f) = ctx.file {
                    out.push(f.to_owned());
                }
            }
        }
    }
    out
}

/// Parse a simple space-delimited template string into `ArgsToken` values.
///
/// Token grammar:
/// - `{folder}` → `ArgsToken::Folder`
/// - `{file}`   → `ArgsToken::File`
/// - anything else → `ArgsToken::Literal`
///
/// Returns `Err` when an unrecognised `{...}` placeholder is found.
///
/// # Errors
///
/// Returns a descriptive string when the template contains an unknown `{…}` token.
pub fn parse(template: &str) -> Result<Vec<ArgsToken>, String> {
    let mut out = Vec::new();
    for part in template.split_whitespace() {
        let token = match part {
            "{folder}" => ArgsToken::Folder,
            "{file}" => ArgsToken::File,
            other if other.starts_with('{') && other.ends_with('}') => {
                return Err(format!(
                    "unknown args-template token '{other}'; only {{folder}} and {{file}} are allowed (R3)"
                ));
            }
            other => ArgsToken::Literal(other.to_owned()),
        };
        out.push(token);
    }
    Ok(out)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_folder_token() {
        let tokens = &[ArgsToken::Folder];
        let ctx = RenderContext { folder: Some("/mnt/library/project"), file: None };
        assert_eq!(render(tokens, &ctx), vec!["/mnt/library/project"]);
    }

    #[test]
    fn render_file_token() {
        let tokens = &[ArgsToken::File];
        let ctx = RenderContext { folder: None, file: Some("/mnt/library/project/capture.fit") };
        assert_eq!(render(tokens, &ctx), vec!["/mnt/library/project/capture.fit"]);
    }

    #[test]
    fn render_literal_token() {
        let tokens = &[ArgsToken::Literal("--open".to_owned()), ArgsToken::Folder];
        let ctx = RenderContext { folder: Some("/a/b"), file: None };
        assert_eq!(render(tokens, &ctx), vec!["--open", "/a/b"]);
    }

    #[test]
    fn render_omits_missing_folder() {
        let tokens = &[ArgsToken::Folder];
        let ctx = RenderContext { folder: None, file: None };
        assert_eq!(render(tokens, &ctx), Vec::<String>::new());
    }

    #[test]
    fn render_empty_template_returns_empty() {
        assert_eq!(render(&[], &RenderContext::default()), Vec::<String>::new());
    }

    #[test]
    fn parse_folder_token() {
        let tokens = parse("{folder}").unwrap();
        assert_eq!(tokens, vec![ArgsToken::Folder]);
    }

    #[test]
    fn parse_file_token() {
        let tokens = parse("{file}").unwrap();
        assert_eq!(tokens, vec![ArgsToken::File]);
    }

    #[test]
    fn parse_literal() {
        let tokens = parse("--open").unwrap();
        assert_eq!(tokens, vec![ArgsToken::Literal("--open".to_owned())]);
    }

    #[test]
    fn parse_unknown_token_returns_err() {
        let err = parse("{unknown}").unwrap_err();
        assert!(err.contains("unknown"), "err: {err}");
    }

    #[test]
    fn parse_empty_string_returns_empty() {
        assert_eq!(parse("").unwrap(), vec![]);
    }

    #[test]
    fn render_empty_template() {
        // An empty args template renders to an empty vec.
        let ctx = RenderContext { folder: Some("/project"), file: None };
        assert_eq!(render(&[], &ctx), Vec::<String>::new());
    }

    #[test]
    fn render_siril_folder() {
        use crate::seed;
        let profile = seed::find("siril").unwrap();
        let ctx = RenderContext { folder: Some("/mnt/lib/siril_project"), file: None };
        let argv = render(&profile.args_template, &ctx);
        assert_eq!(argv, vec!["/mnt/lib/siril_project"]);
    }

    #[test]
    fn render_pixinsight_folder() {
        use crate::seed;
        let profile = seed::find("pixinsight").unwrap();
        let ctx = RenderContext { folder: Some("/mnt/lib/pi_project"), file: None };
        let argv = render(&profile.args_template, &ctx);
        assert_eq!(argv, vec!["/mnt/lib/pi_project"]);
    }
}
