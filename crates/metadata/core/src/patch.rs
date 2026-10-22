// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The header edits an isolated patched copy carries (spec 069 PREP-FR-03,
//! PREP-FR-20; D-W123), shared by the FITS and XISF patchers.
//!
//! A caller describes each corrected field as a [`FieldEdit`]: the keywords
//! it writes, each in its own units, the first being its canonical keyword.
//! Every card or keyword a header already holds for any of them is
//! overwritten; an alias is never added, and the canonical keyword is added
//! only when none of [`FieldEdit::add_unless`] is present.

use std::fmt;
use std::io;

/// Bytes a fixed-format FITS string card spends outside its value: the
/// eight-character keyword, `= '` and the closing quote.
const STRING_CARD_OVERHEAD: usize = 12;
const CARD_LEN: usize = 80;

/// One value a patch writes.
#[derive(Clone, Debug, PartialEq)]
pub enum EditValue {
    Text(String),
    Real(f64),
    Integer(i64),
}

/// One keyword a corrected field writes, with its value in that keyword's
/// units.
#[derive(Clone, Debug, PartialEq)]
pub struct KeywordWrite {
    pub keyword: &'static str,
    pub value: EditValue,
}

/// Everything one corrected field writes into a patched copy.
#[derive(Clone, Debug, PartialEq)]
pub struct FieldEdit {
    /// Every keyword it overwrites wherever present; the first is the
    /// canonical one.
    pub writes: Vec<KeywordWrite>,
    /// The canonical keyword is added when the header holds none of these.
    pub add_unless: &'static [&'static str],
    /// Longer aliases a FITS file holds only as `HIERARCH` cards; a present
    /// one, like an XISF keyword of that name, takes the canonical value,
    /// and none is ever added.
    pub hierarch: &'static [&'static str],
    /// An XISF `<Property>` alias, overwritten when present, never added.
    pub property: Option<(&'static str, String)>,
}

impl FieldEdit {
    /// The canonical write, which an absent header keyword takes.
    #[must_use]
    pub fn canonical(&self) -> Option<&KeywordWrite> {
        self.writes.first()
    }
}

/// Why a header can't carry an edit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Refusal {
    /// The file holds no header the patcher can read.
    NoHeader,
    /// A text value holds a character outside printable ASCII.
    NotPrintableAscii,
    /// The value doesn't fit one 80-character card on its own.
    TooLong,
    /// The FITS primary header holds `NAXIS = 0`: the image lies in an
    /// extension, whose header isn't patched.
    ImageInExtension,
    /// The FITS header holds a `HIERARCH` card naming an alias of the field
    /// in a spelling the header crate can't address (only ESO-style
    /// uppercase names are), so it would keep the old value.
    HierarchAlias,
    /// The XISF layout isn't one `xisf-header` splices: no single `<Image>`
    /// with an attachment location, a self-closing `<Image>` that would take
    /// an added keyword, or attachment blocks it refuses to move.
    XisfLayout,
}

/// A refusal and the edit, by index, it concerns; a refusal of the whole
/// header names the first edit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Refused {
    pub edit: usize,
    pub reason: Refusal,
}

/// Why a patch failed.
#[derive(Debug)]
pub enum PatchError {
    Refused(Refused),
    Io(io::Error),
    /// The header crate failed for another reason.
    Header(String),
}

impl fmt::Display for PatchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(refused) => {
                write!(f, "edit {} refused: {:?}", refused.edit, refused.reason)
            }
            Self::Io(error) => write!(f, "{error}"),
            Self::Header(detail) => f.write_str(detail),
        }
    }
}

impl std::error::Error for PatchError {}

impl From<io::Error> for PatchError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl PatchError {
    /// A refusal of edit `edit`.
    #[must_use]
    pub const fn refused(edit: usize, reason: Refusal) -> Self {
        Self::Refused(Refused { edit, reason })
    }
}

/// Whether a FITS card can hold `text` as a fixed-format string value
/// (D-W123): printable ASCII, and with its quotes doubled short enough for
/// one card behind an eight-character keyword. A value FITS can't hold is
/// refused, never continued on CONTINUE cards.
///
/// # Errors
/// [`Refusal::NotPrintableAscii`] or [`Refusal::TooLong`].
pub fn fits_text(text: &str) -> Result<(), Refusal> {
    if !text.bytes().all(|byte| (b' '..=b'~').contains(&byte)) {
        return Err(Refusal::NotPrintableAscii);
    }
    let escaped = text.len() + text.bytes().filter(|byte| *byte == b'\'').count();
    if escaped.max(8) + STRING_CARD_OVERHEAD > CARD_LEN {
        return Err(Refusal::TooLong);
    }
    Ok(())
}

/// Validate every text value of `edits`, as both patchers must before they
/// write anything.
///
/// # Errors
/// The first edit holding a value FITS can't hold.
pub fn validate(edits: &[FieldEdit]) -> Result<(), PatchError> {
    for (index, edit) in edits.iter().enumerate() {
        for write in &edit.writes {
            if let EditValue::Text(text) = &write.value {
                fits_text(text).map_err(|reason| PatchError::refused(index, reason))?;
            }
        }
        if let Some((_, value)) = &edit.property {
            fits_text(value).map_err(|reason| PatchError::refused(index, reason))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fits_card_holds_printable_ascii_that_fits_one_card() {
        assert_eq!(fits_text("NGC 7000"), Ok(()));
        assert_eq!(fits_text(&"x".repeat(68)), Ok(()));
        assert_eq!(fits_text(&"x".repeat(69)), Err(Refusal::TooLong));
        assert_eq!(fits_text(&format!("{}'", "x".repeat(66))), Ok(()), "a quote counts twice");
        assert_eq!(fits_text(&format!("{}'", "x".repeat(67))), Err(Refusal::TooLong));
        assert_eq!(fits_text("Hα"), Err(Refusal::NotPrintableAscii));
        assert_eq!(fits_text("tab\there"), Err(Refusal::NotPrintableAscii));
    }
}
