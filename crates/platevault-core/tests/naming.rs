// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Settings > Naming (STO-IMP-FR-07, STO-IMP-AC-08): per-type defaults, stored
//! overrides only, validation on save and on resolve, the live preview's
//! fallback report and Restore defaults.

use std::path::Path;
use std::sync::Arc;

use platevault_core::library::Library;
use platevault_core::{LibraryError, NamingFallback, NamingFrameType, NamingMetadata};

async fn open(path: &Path) -> Arc<Library> {
    Library::open(&path.join("library.sqlite"), None).await.unwrap()
}

fn light_metadata() -> NamingMetadata {
    NamingMetadata {
        target: Some("M31".into()),
        filter: Some("Ha".into()),
        date: Some("2026-04-12".into()),
        frame_type: Some("light".into()),
        exposure: Some("300".into()),
        ..NamingMetadata::default()
    }
}

fn assert_invalid(result: Result<impl std::fmt::Debug, LibraryError>, needle: &str) {
    match result {
        Err(LibraryError::InvalidInput(message)) => {
            assert!(message.contains(needle), "{message:?} should name {needle:?}");
        }
        other => panic!("expected InvalidInput naming {needle:?}, got {other:?}"),
    }
}

#[tokio::test]
async fn defaults_per_type() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    let templates = library.naming_templates().await.unwrap();
    let got: Vec<_> = templates
        .iter()
        .map(|t| (t.frame_type, t.template.as_str(), t.default_template.as_str(), t.overridden))
        .collect();
    assert_eq!(
        got,
        [
            (
                NamingFrameType::Light,
                "{target}/{filter}/{date}/light/",
                "{target}/{filter}/{date}/light/",
                false
            ),
            (NamingFrameType::Flat, "flats/{filter}/{date}/", "flats/{filter}/{date}/", false),
            (NamingFrameType::Dark, "darks/{exposure}/", "darks/{exposure}/", false),
            (NamingFrameType::Bias, "bias/", "bias/", false),
            (
                NamingFrameType::MasterFlat,
                "masters/flats/{filter}/",
                "masters/flats/{filter}/",
                false
            ),
            (
                NamingFrameType::MasterDark,
                "masters/darks/{exposure}/",
                "masters/darks/{exposure}/",
                false
            ),
            (NamingFrameType::MasterBias, "masters/bias/", "masters/bias/", false),
        ]
    );
    let resolved = library.resolve_naming(NamingFrameType::Light, &light_metadata()).await.unwrap();
    assert_eq!(resolved.relative_path, "M31/Ha/2026-04-12/light");
    assert!(resolved.fallbacks.is_empty());
}

#[tokio::test]
async fn only_overrides_stored() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    assert!(library.catalog().naming_overrides().await.unwrap().is_empty());

    let saved = library
        .save_naming_template(NamingFrameType::Flat, "flats/{camera}/{filter}/")
        .await
        .unwrap();
    assert_eq!(saved.template, "flats/{camera}/{filter}/");
    assert!(saved.overridden);
    // Saving a type's own default stores nothing for it.
    let light = library
        .save_naming_template(NamingFrameType::Light, "{target}/{filter}/{date}/light/")
        .await
        .unwrap();
    assert!(!light.overridden);
    assert_eq!(
        library.catalog().naming_overrides().await.unwrap(),
        [(NamingFrameType::Flat, "flats/{camera}/{filter}/".to_owned())]
    );

    // The override survives a restart and is the effective template.
    drop(library);
    let library = open(temp.path()).await;
    let templates = library.naming_templates().await.unwrap();
    let flat = templates.iter().find(|t| t.frame_type == NamingFrameType::Flat).unwrap();
    assert_eq!(flat.template, "flats/{camera}/{filter}/");
    assert_eq!(flat.default_template, "flats/{filter}/{date}/");
    assert!(flat.overridden);
    assert_eq!(templates.iter().filter(|t| t.overridden).count(), 1);

    // Saving the default again removes the stored override.
    library.save_naming_template(NamingFrameType::Flat, "flats/{filter}/{date}/").await.unwrap();
    assert!(library.catalog().naming_overrides().await.unwrap().is_empty());
}

#[tokio::test]
async fn dotdot_and_reserved_names_refused_on_save_and_resolve() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    for (template, needle) in [
        ("../escape/", ".."),
        ("{target}/../{filter}/", ".."),
        ("./{target}/", "."),
        ("CON/", "CON"),
        ("{target}/nul/", "nul"),
        ("{telescope}/", "telescope"),
        ("", "empty"),
    ] {
        assert_invalid(
            library.save_naming_template(NamingFrameType::Light, template).await,
            needle,
        );
        assert_invalid(Library::preview_naming(NamingFrameType::Light, template, None), needle);
    }
    assert!(library.catalog().naming_overrides().await.unwrap().is_empty(), "nothing was saved");

    // A stored template is validated again when it is resolved.
    library
        .catalog()
        .set_naming_override(NamingFrameType::Light, Some("darks/../../x/"))
        .await
        .unwrap();
    assert_invalid(library.resolve_naming(NamingFrameType::Light, &light_metadata()).await, "..");
    library
        .catalog()
        .set_naming_override(NamingFrameType::Light, Some("AUX/{target}/"))
        .await
        .unwrap();
    assert_invalid(library.resolve_naming(NamingFrameType::Light, &light_metadata()).await, "AUX");

    // Metadata values are held to the same rules when the default resolves.
    library.restore_naming_defaults().await.unwrap();
    for (target, needle) in [("..", ".."), ("CON", "CON")] {
        let metadata = NamingMetadata { target: Some(target.into()), ..light_metadata() };
        assert_invalid(library.resolve_naming(NamingFrameType::Light, &metadata).await, needle);
    }
}

#[tokio::test]
async fn overlong_templates_and_paths_refused() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    let segment = "a".repeat(201);
    assert_invalid(
        library.save_naming_template(NamingFrameType::Bias, &format!("{segment}/")).await,
        "length",
    );
    let deep = "abcdefghij/".repeat(19);
    assert_invalid(library.save_naming_template(NamingFrameType::Bias, &deep).await, "length");
    // A long metadata value pushes the resolved path past the cap.
    let metadata = NamingMetadata { target: Some("t".repeat(199)), ..light_metadata() };
    assert_invalid(library.resolve_naming(NamingFrameType::Light, &metadata).await, "length");
    assert!(library.catalog().naming_overrides().await.unwrap().is_empty());
}

#[tokio::test]
async fn preview_names_fallback_tokens() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    let sample = NamingMetadata { filter: None, date: None, ..light_metadata() };
    let preview =
        Library::preview_naming(NamingFrameType::Light, "{target}/{date}/{filter}/", Some(sample))
            .unwrap();
    assert_eq!(preview.relative_path, "M31/undated/nofilter");
    assert_eq!(
        preview.fallbacks,
        [
            NamingFallback { token: "date".into(), value: "undated".into() },
            NamingFallback { token: "filter".into(), value: "nofilter".into() },
        ]
    );

    // Every one of the nine tokens has its fallback.
    let all =
        "{target}/{filter}/{date}/{frame_type}/{camera}/{exposure}/{gain}/{binning}/{set_temp}/";
    let preview =
        Library::preview_naming(NamingFrameType::Light, all, Some(NamingMetadata::default()))
            .unwrap();
    assert_eq!(
        preview.relative_path,
        "unclassified/nofilter/undated/unknown/unknown-camera/unknown-exposure/unknown-gain/1x1/untempered"
    );
    assert_eq!(preview.fallbacks.len(), 9);

    // Without a sample the built-in sample of the frame type is used: a flat
    // carries no Target, so `{target}` falls back.
    let preview =
        Library::preview_naming(NamingFrameType::Flat, "flats/{target}/{frame_type}/", None)
            .unwrap();
    assert_eq!(preview.relative_path, "flats/unclassified/flat");
    assert_eq!(
        preview.fallbacks,
        [NamingFallback { token: "target".into(), value: "unclassified".into() }]
    );
    // Previewing stores nothing.
    assert!(library.catalog().naming_overrides().await.unwrap().is_empty());
}

#[tokio::test]
async fn restore_defaults() {
    let temp = tempfile::tempdir().unwrap();
    let library = open(temp.path()).await;
    library.save_naming_template(NamingFrameType::Light, "{target}/{date}/").await.unwrap();
    library.save_naming_template(NamingFrameType::MasterDark, "masters/{gain}/").await.unwrap();
    assert_eq!(library.catalog().naming_overrides().await.unwrap().len(), 2);

    let restored = library.restore_naming_defaults().await.unwrap();
    assert_eq!(restored, library.naming_templates().await.unwrap());
    assert_eq!(restored.len(), 7);
    assert!(restored.iter().all(|t| !t.overridden && t.template == t.default_template));
    assert!(library.catalog().naming_overrides().await.unwrap().is_empty());
    let resolved = library.resolve_naming(NamingFrameType::Light, &light_metadata()).await.unwrap();
    assert_eq!(resolved.relative_path, "M31/Ha/2026-04-12/light");
}
