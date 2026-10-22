// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Every library failure reaches the client as a stable code that the desktop
//! catalogues word. One error per [`LibraryError`] variant becomes its IPC
//! `ErrorResponse`, which must carry no English text; its code must have an
//! `err_library_<code>` message in every shipped locale, whose placeholders
//! agree across locales and name params that response carries. The same
//! holds for why an Apply stopped ([`ApplyStop`]) and why a foreign file
//! didn't move ([`ForeignItemFailure`]).

use std::collections::BTreeSet;
use std::path::Path;

use platevault_core::{
    ApplyStop, EntryEvidence, EntryKind, FileIdentity, ForeignItem, ForeignItemFailure,
    ForeignItemState, LibraryError, LibraryErrorCode, NativePath, ObservationFingerprint,
    PatchRefusal, PathSensitivity, VolumeIdentity, WindowKey,
};
use serde_json::{Map, Value};
use uuid::Uuid;

/// The base catalogue first.
const LOCALES: [&str; 2] = ["en-GB", "pt-BR"];

/// Text a variant carries for its English `Display`; it must not reach IPC.
const DIAGNOSTIC: &str = "english diagnostic text";

/// One error per variant. The match makes a new variant fail to compile here,
/// and the index check makes each variant appear once.
fn every_variant() -> Vec<LibraryError> {
    let id = Uuid::new_v4();
    let text = || DIAGNOSTIC.to_owned();
    let key: WindowKey =
        format!("{id}/{}/2026-10-20T20:00Z", Uuid::new_v4()).parse().expect("window key");
    let errors = vec![
        LibraryError::InvalidInput(text()),
        LibraryError::NotFound(text()),
        LibraryError::Conflict { id, current: 3, successors: vec![Uuid::new_v4()] },
        LibraryError::WindowConflict { key, site: DIAGNOSTIC.into(), current: 2 },
        LibraryError::IdentityConflict(text()),
        LibraryError::AccessDenied(text()),
        LibraryError::SourceUnavailable(text()),
        LibraryError::UnsupportedFormat(text()),
        LibraryError::MetadataUnreadable(text()),
        LibraryError::ProviderUnavailable(text()),
        LibraryError::PersistenceFailure(text()),
        LibraryError::NoByteProof(text()),
        LibraryError::SymlinksUnavailable(text()),
        LibraryError::LinksUnsupported(text()),
        LibraryError::Canceled,
        LibraryError::Context {
            error: Box::new(LibraryError::SourceUnavailable(text())),
            scope: Some(NativePath::from_path(Path::new("/night/light_001.fits"))),
            identity: Some(id),
        },
        LibraryError::CorrectionUndeliverable {
            identity: id,
            path: Some(NativePath::from_path(Path::new("/night/light_001.fits"))),
            field: "object".into(),
            refusal: PatchRefusal::TooLong,
        },
        LibraryError::CorrectionUndeliverable {
            identity: id,
            path: None,
            field: "object".into(),
            refusal: PatchRefusal::UnsupportedFormat,
        },
        LibraryError::SessionNotReady(text()),
    ];
    let variant = |error: &LibraryError| match error {
        LibraryError::InvalidInput(_) => 0,
        LibraryError::NotFound(_) => 1,
        LibraryError::Conflict { .. } => 2,
        LibraryError::WindowConflict { .. } => 3,
        LibraryError::IdentityConflict(_) => 4,
        LibraryError::AccessDenied(_) => 5,
        LibraryError::SourceUnavailable(_) => 6,
        LibraryError::UnsupportedFormat(_) => 7,
        LibraryError::MetadataUnreadable(_) => 8,
        LibraryError::ProviderUnavailable(_) => 9,
        LibraryError::PersistenceFailure(_) => 10,
        LibraryError::NoByteProof(_) => 11,
        LibraryError::SymlinksUnavailable(_) => 12,
        LibraryError::LinksUnsupported(_) => 13,
        LibraryError::Canceled => 14,
        LibraryError::Context { .. } => 15,
        LibraryError::CorrectionUndeliverable { .. } => 16,
        LibraryError::SessionNotReady(_) => 17,
    };
    let seen: BTreeSet<usize> = errors.iter().map(variant).collect();
    assert_eq!(seen, (0..=17).collect(), "one error per variant");
    errors
}

/// Exhaustive over the codes, so a new code fails to compile here.
const fn code_index(code: LibraryErrorCode) -> usize {
    match code {
        LibraryErrorCode::InvalidInput => 0,
        LibraryErrorCode::NotFound => 1,
        LibraryErrorCode::Conflict => 2,
        LibraryErrorCode::IdentityConflict => 3,
        LibraryErrorCode::AccessDenied => 4,
        LibraryErrorCode::SourceUnavailable => 5,
        LibraryErrorCode::UnsupportedFormat => 6,
        LibraryErrorCode::MetadataUnreadable => 7,
        LibraryErrorCode::ProviderUnavailable => 8,
        LibraryErrorCode::PersistenceFailure => 9,
        LibraryErrorCode::NoByteProof => 10,
        LibraryErrorCode::SymlinksUnavailable => 11,
        LibraryErrorCode::LinksUnsupported => 12,
        LibraryErrorCode::Canceled => 13,
        LibraryErrorCode::CorrectionUnpatchable => 14,
        LibraryErrorCode::CorrectionFormatUnpatchable => 15,
        LibraryErrorCode::SessionNotReady => 16,
    }
}

fn catalogue(locale: &str) -> Map<String, Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../messages/{locale}.json"));
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    match serde_json::from_str(&text) {
        Ok(Value::Object(messages)) => messages,
        other => panic!("{} is not a flat message object: {other:?}", path.display()),
    }
}

/// The `{name}` placeholders of one catalogue message: a plain string, or
/// every variant of a plural message.
fn placeholders(message: &Value) -> BTreeSet<String> {
    let variants: Vec<&str> = match message {
        Value::String(text) => vec![text],
        Value::Array(branches) => branches
            .iter()
            .filter_map(|branch| branch.get("match").and_then(Value::as_object))
            .flat_map(|cases| cases.values().filter_map(Value::as_str))
            .collect(),
        _ => Vec::new(),
    };
    assert!(
        !variants.is_empty() && variants.iter().all(|text| !text.trim().is_empty()),
        "not a message: {message}"
    );
    variants
        .iter()
        .flat_map(|text| text.split('{').skip(1))
        .filter_map(|rest| rest.split_once('}'))
        .map(|(name, _)| name.trim().to_owned())
        .collect()
}

/// `key` has a message in every catalogue, with the same placeholders in
/// each, and every placeholder names a non-null field of `params`, what
/// `subject` sends.
fn worded(catalogues: &[(&str, Map<String, Value>)], key: &str, params: &Value, subject: &str) {
    let wordings: Vec<(&str, BTreeSet<String>)> = catalogues
        .iter()
        .map(|(locale, messages)| {
            let message =
                messages.get(key).unwrap_or_else(|| panic!("{locale} has no message {key}"));
            (*locale, placeholders(message))
        })
        .collect();
    let (base_locale, base) = &wordings[0];
    for (locale, names) in &wordings {
        assert_eq!(names, base, "{key}: {locale} placeholders differ from {base_locale}");
    }
    for name in base {
        assert!(
            params.get(name).is_some_and(|value| !value.is_null()),
            "{key} names {{{name}}}, which {subject} doesn't carry: {params}"
        );
    }
}

fn catalogues() -> Vec<(&'static str, Map<String, Value>)> {
    LOCALES.iter().map(|locale| (*locale, catalogue(locale))).collect()
}

#[test]
fn every_library_error_has_a_code_every_catalogue_words() {
    let catalogues = catalogues();
    let mut codes = BTreeSet::new();
    for error in every_variant() {
        let code = error.code();
        let response = serde_json::to_value(error.response(None, None)).expect("serialize");
        let Value::Object(params) = &response else { panic!("{error:?}: {response}") };
        assert_eq!(params["code"], code.as_str(), "{error:?}: the code's wire string");
        assert!(!response.to_string().contains(DIAGNOSTIC), "{error:?} sent English: {response}");
        worded(
            &catalogues,
            &format!("err_library_{}", code.as_str()),
            &response,
            &format!("{error:?}"),
        );
        codes.insert(code_index(code));
    }
    assert_eq!(codes, (0..=16).collect(), "every code is some variant's");
}

/// One stop per [`ApplyStop`] variant. The match makes a new variant fail to
/// compile here, and the index check makes each variant appear once.
fn every_apply_stop() -> Vec<ApplyStop> {
    let stops = vec![
        ApplyStop::Canceled,
        ApplyStop::Interrupted,
        ApplyStop::CatalogMoved,
        ApplyStop::OriginalsUnverified { count: 2 },
        ApplyStop::BuildingNotCleared { count: 1 },
        ApplyStop::EntryNotPlaced,
        ApplyStop::BuildUnverified { count: 3 },
        ApplyStop::ViewUnreadable { count: 1 },
        ApplyStop::PreviousUnreadable { count: 4 },
        ApplyStop::KeptNotMoved { count: 2 },
        ApplyStop::ProjectFolderReplaced,
        ApplyStop::ViewReplaced,
        ApplyStop::PreviousAppeared,
        ApplyStop::AsideFailed,
        ApplyStop::NotInstalled,
    ];
    let variant = |stop: &ApplyStop| match stop {
        ApplyStop::Canceled => 0,
        ApplyStop::Interrupted => 1,
        ApplyStop::CatalogMoved => 2,
        ApplyStop::OriginalsUnverified { .. } => 3,
        ApplyStop::BuildingNotCleared { .. } => 4,
        ApplyStop::EntryNotPlaced => 5,
        ApplyStop::BuildUnverified { .. } => 6,
        ApplyStop::ViewUnreadable { .. } => 7,
        ApplyStop::PreviousUnreadable { .. } => 8,
        ApplyStop::KeptNotMoved { .. } => 9,
        ApplyStop::ProjectFolderReplaced => 10,
        ApplyStop::ViewReplaced => 11,
        ApplyStop::PreviousAppeared => 12,
        ApplyStop::AsideFailed => 13,
        ApplyStop::NotInstalled => 14,
    };
    let seen: BTreeSet<usize> = stops.iter().map(variant).collect();
    assert_eq!(seen, (0..=14).collect(), "one stop per variant");
    stops
}

/// Every way an Apply ends Failed or Canceled reaches the client as a code
/// the catalogues word as `apply_stop_<code>`, naming only what the stop
/// carries; and every reason a ticked foreign file stayed behind as one
/// worded as `apply_foreign_failed_<code>`, naming only the item's `path`.
#[test]
fn every_apply_stop_and_foreign_failure_has_a_message_every_catalogue_words() {
    let catalogues = catalogues();
    let mut codes = BTreeSet::new();
    for stop in every_apply_stop() {
        let params = serde_json::to_value(stop).expect("serialize");
        let code = params["code"].as_str().unwrap_or_else(|| panic!("{stop:?}: {params}"));
        assert!(codes.insert(code.to_owned()), "{code} is one stop's");
        worded(&catalogues, &format!("apply_stop_{code}"), &params, &format!("{stop:?}"));
    }

    let failures = [
        ForeignItemFailure::NameTaken,
        ForeignItemFailure::Changed,
        ForeignItemFailure::FolderNotMade,
        ForeignItemFailure::NotMoved,
    ];
    // Exhaustive, so a new failure fails to compile here.
    let index = |failure: ForeignItemFailure| match failure {
        ForeignItemFailure::NameTaken => 0,
        ForeignItemFailure::Changed => 1,
        ForeignItemFailure::FolderNotMade => 2,
        ForeignItemFailure::NotMoved => 3,
    };
    let seen: BTreeSet<usize> = failures.into_iter().map(index).collect();
    assert_eq!(seen, (0..=3).collect(), "one failure per variant");
    for failure in failures {
        let item = failed_foreign_item(failure);
        assert!(item.validate().is_ok(), "{item:?}");
        let params = serde_json::to_value(&item).expect("serialize");
        let code = params["reason"].as_str().unwrap_or_else(|| panic!("{failure:?}: {params}"));
        worded(
            &catalogues,
            &format!("apply_foreign_failed_{code}"),
            &params,
            &format!("{failure:?}"),
        );
    }
}

/// A ticked foreign file that stayed in `View (previous)/` for `failure`, as
/// an Apply report carries it.
fn failed_foreign_item(failure: ForeignItemFailure) -> ForeignItem {
    let fingerprint = ObservationFingerprint {
        identity: FileIdentity {
            volume: VolumeIdentity {
                filesystem: "apfs".into(),
                stable_id: Some("volume".into()),
                file_ids_stable: true,
                case: PathSensitivity::Sensitive,
                normalization: PathSensitivity::Sensitive,
            },
            file_id: Some("60".into()),
        },
        size_bytes: 16,
        modified_ns: 1_760_000_000_000_000_000,
        content_sha256: None,
    };
    ForeignItem {
        seq: 0,
        path: NativePath::from_path(Path::new("notes/session.txt")),
        evidence: EntryEvidence {
            path: NativePath::from_path(Path::new("/Project/View (previous)/notes/session.txt")),
            root: None,
            kind: EntryKind::File,
            fingerprint,
            sha256: Some("0".repeat(64)),
        },
        ticked: true,
        state: ForeignItemState::Failed,
        reason: Some(failure),
    }
}
