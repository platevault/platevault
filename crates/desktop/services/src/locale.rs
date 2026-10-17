// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The shipped locale tags and embedded frontend message catalogues.
//! The webview and backend share an active locale. Features deserialize only
//! the catalogue messages they own with [`ShippedLocale::messages`]; the
//! [`ShippedMessages`] cache assigns each shipped locale its own parsed slot,
//! and [`fill`] interpolates named placeholders.

use serde::de::DeserializeOwned;
use std::sync::{Arc, OnceLock, RwLock};

/// A shipped locale and its embedded catalogue.
#[derive(Debug)]
pub struct ShippedLocale {
    /// The locale's position in [`SHIPPED_LOCALES`], which is its
    /// [`ShippedMessages`] slot.
    index: usize,
    /// The locale's tag as `project.inlang/settings.json` lists it.
    pub tag: &'static str,
    /// The catalogue: one JSON object of message keys and their texts.
    pub catalogue: &'static str,
}

/// How many locales `project.inlang/settings.json` lists.
pub const SHIPPED_LOCALE_COUNT: usize = 2;

/// Every locale in `project.inlang/settings.json`, the base locale first.
pub static SHIPPED_LOCALES: [ShippedLocale; SHIPPED_LOCALE_COUNT] = indexed([
    ("en-GB", include_str!("../../../../apps/desktop/messages/en-GB.json")),
    ("pt-BR", include_str!("../../../../apps/desktop/messages/pt-BR.json")),
]);

/// Each `(tag, catalogue)` as a shipped locale whose index is its position.
const fn indexed(
    catalogues: [(&'static str, &'static str); SHIPPED_LOCALE_COUNT],
) -> [ShippedLocale; SHIPPED_LOCALE_COUNT] {
    let mut locales =
        [const { ShippedLocale { index: 0, tag: "", catalogue: "" } }; SHIPPED_LOCALE_COUNT];
    let mut index = 0;
    while index < SHIPPED_LOCALE_COUNT {
        let (tag, catalogue) = catalogues[index];
        locales[index] = ShippedLocale { index, tag, catalogue };
        index += 1;
    }
    locales
}

/// The base locale, which the frontend also falls back to.
#[must_use]
pub fn base() -> &'static ShippedLocale {
    &SHIPPED_LOCALES[0]
}

/// The shipped locale `tag` names exactly, as the webview sends it, else the
/// base locale.
#[must_use]
pub fn shipped_or_base(tag: &str) -> &'static ShippedLocale {
    SHIPPED_LOCALES.iter().find(|locale| locale.tag == tag).unwrap_or_else(base)
}

/// The single locale selected for text the backend displays outside the webview.
#[derive(Clone, Debug)]
pub struct ActiveLocale(Arc<RwLock<&'static ShippedLocale>>);

impl Default for ActiveLocale {
    fn default() -> Self {
        Self::new()
    }
}

impl ActiveLocale {
    /// Start with the base locale used by the webview when no locale is known.
    #[must_use]
    pub fn new() -> Self {
        Self(Arc::new(RwLock::new(base())))
    }

    /// Select the shipped locale named by `tag`, falling back to the base.
    pub fn set_locale(&self, tag: &str) {
        *self.0.write().unwrap_or_else(std::sync::PoisonError::into_inner) = shipped_or_base(tag);
    }

    /// Read the currently selected locale.
    #[must_use]
    pub fn get(&self) -> &'static ShippedLocale {
        *self.0.read().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// One cache slot per shipped locale.
pub struct ShippedMessages<T> {
    entries: [OnceLock<T>; SHIPPED_LOCALE_COUNT],
}

impl<T> ShippedMessages<T> {
    #[must_use]
    pub const fn new() -> Self {
        Self { entries: [const { OnceLock::new() }; SHIPPED_LOCALE_COUNT] }
    }
}

impl<T> Default for ShippedMessages<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: DeserializeOwned> ShippedMessages<T> {
    /// Return the cached messages for a shipped locale.
    ///
    /// # Panics
    ///
    /// Panics if the embedded catalogue does not contain the complete message set.
    pub fn get(&'static self, locale: &'static ShippedLocale) -> &'static T {
        self.entries[locale.index].get_or_init(|| {
            locale.messages::<T>().unwrap_or_else(|error| {
                panic!("shipped {} message catalogue is incomplete: {error}", locale.tag)
            })
        })
    }
}

impl ShippedLocale {
    /// The messages `T` names from this locale's catalogue: `T` is a struct
    /// whose fields carry `#[serde(rename = "<message key>")]`. Every other
    /// message is skipped without being allocated.
    ///
    /// # Errors
    ///
    /// The catalogue lacks one of `T`'s keys, or holds another shape of value
    /// for it.
    pub fn messages<T: DeserializeOwned>(&self) -> Result<T, String> {
        serde_json::from_str(self.catalogue)
            .map_err(|error| format!("the {} message catalogue: {error}", self.tag))
    }
}

/// `template` with each `{name}` placeholder that `values` names replaced by
/// its value. One pass over `template`, so braces inside a value are never
/// read as a placeholder; a placeholder `values` does not name stays.
#[must_use]
pub fn fill(template: &str, values: &[(&str, &str)]) -> String {
    let mut filled = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        filled.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let named = after.find('}').and_then(|close| {
            values
                .iter()
                .find(|(name, _)| *name == &after[..close])
                .map(|(_, value)| (*value, &after[close + 1..]))
        });
        // An unnamed brace is kept as text, and the scan goes on after it.
        let (text, remainder) = named.unwrap_or(("{", after));
        filled.push_str(text);
        rest = remainder;
    }
    filled.push_str(rest);
    filled
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::{base, fill, shipped_or_base, SHIPPED_LOCALES};

    #[test]
    fn a_shipped_tag_picks_its_locale_and_anything_else_the_base() {
        assert_eq!(shipped_or_base("pt-BR").tag, "pt-BR");
        assert_eq!(shipped_or_base("en-GB").tag, "en-GB");
        for other in ["pt-br", "de-DE", ""] {
            assert_eq!(shipped_or_base(other).tag, base().tag, "{other:?}");
        }
        assert_eq!(base().tag, "en-GB");
    }

    #[derive(Deserialize)]
    struct Quit {
        #[serde(rename = "menu_quit")]
        quit: String,
    }

    #[test]
    fn each_catalogue_answers_a_message_by_key() {
        let quits: Vec<String> = SHIPPED_LOCALES
            .iter()
            .map(|locale| locale.messages::<Quit>().expect("menu_quit").quit)
            .collect();
        assert_eq!(quits, ["Quit PlateVault", "Encerrar PlateVault"]);
    }

    #[derive(Debug, Deserialize)]
    struct Missing {
        #[serde(rename = "no_such_message")]
        _missing: String,
    }

    #[test]
    fn a_missing_key_names_the_catalogue_and_the_key() {
        let error = base().messages::<Missing>().expect_err("missing");
        assert!(error.contains("en-GB") && error.contains("no_such_message"), "{error}");
    }

    #[test]
    fn placeholders_are_filled_once_and_unknown_ones_stay() {
        assert_eq!(
            fill("Saved at {path}; {other} {", &[("path", "/a/{path}/{other}")]),
            "Saved at /a/{path}/{other}; {other} {"
        );
        assert_eq!(fill("{a}{b}", &[("a", "1"), ("b", "2")]), "12");
        assert_eq!(fill("no placeholders", &[("a", "1")]), "no placeholders");
    }
}
