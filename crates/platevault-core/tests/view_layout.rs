// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The F4 Project folder and its names (spec 069 PREP-FR-06/16/19; D-W98,
//! D-W99, D-W114; decision record §2, §8, §9; path-matrix N10): folder tokens
//! keep only what WBPP reads in a keyword value, entry names stay fixed with
//! a suffix on clashes, and every generated name fits one path component.

use std::path::Path;

use platevault_core::layout::{
    component_len, entry_basename, folder_token, group_folder, name_key, project_folder,
    COMPONENT_LIMIT, OUTPUT_FOLDER, PROCESSING_FOLDER, VIEW_BUILDING_FOLDER, VIEW_FOLDER,
    VIEW_PREVIOUS_FOLDER,
};
use platevault_core::{GroupKeywords, GroupName};
use uuid::Uuid;

fn name(text: &str) -> GroupName {
    GroupName::new(text).unwrap()
}

#[test]
fn the_project_folder_holds_view_processing_and_output() {
    let parent = if cfg!(windows) { Path::new(r"C:\Work") } else { Path::new("/Work") };
    let folder = project_folder(parent, "NGC 7000 HOO").unwrap();
    assert_eq!(folder, parent.join("NGC 7000 HOO"));
    assert_eq!(
        [VIEW_FOLDER, VIEW_BUILDING_FOLDER, VIEW_PREVIOUS_FOLDER, PROCESSING_FOLDER, OUTPUT_FOLDER],
        ["View", "View (building)", "View (previous)", "Processing", "Output"]
    );
    assert!(project_folder(Path::new("relative"), "NGC 7000").is_err());
    assert!(project_folder(parent, "..").is_err());
}

#[test]
fn a_group_token_keeps_what_wbpp_reads_in_a_keyword_value() {
    assert_eq!(folder_token(&name("RedCat")).unwrap(), "RedCat");
    assert_eq!(folder_token(&name("RedCat · Framing 2")).unwrap(), "RedCat-Framing-2");
    assert_eq!(folder_token(&name("Esprit_100 : f/5.5")).unwrap(), "Esprit-100-f5.5");
    assert_eq!(folder_token(&name("Région (north)")).unwrap(), "Region-(north)");
    assert!(folder_token(&name("···")).is_err(), "nothing usable remains");
    assert!(folder_token(&name("Con")).is_err(), "a Windows device name");
}

#[test]
fn a_group_folder_carries_its_keyword_only_for_its_kind() {
    let keywords = GroupKeywords::default();
    assert_eq!(group_folder(&keywords, &name("RedCat"), false).unwrap(), "GROUP_RedCat");
    assert_eq!(group_folder(&keywords, &name("Panel 2"), true).unwrap(), "PANEL_Panel-2");
    let custom = GroupKeywords::new("RIG", "TILE").unwrap();
    assert_eq!(group_folder(&custom, &name("Panel 2"), true).unwrap(), "TILE_Panel-2");
}

#[test]
fn a_long_group_name_fits_one_component_with_a_stable_suffix() {
    let long = name(&"Very long rig name ".repeat(30));
    let other = name(&format!("{}x", "Very long rig name ".repeat(30)));
    let folder = group_folder(&GroupKeywords::default(), &long, false).unwrap();
    assert!(component_len(&folder) <= COMPONENT_LIMIT, "{} long", folder.len());
    assert!(folder.starts_with("GROUP_Very-long-rig-name-"));
    assert_eq!(folder, group_folder(&GroupKeywords::default(), &long, false).unwrap());
    let token = folder_token(&other).unwrap();
    assert!(component_len(&token) <= COMPONENT_LIMIT);
    assert_ne!(token, folder_token(&long).unwrap(), "a clash after shortening takes the suffix");
}

#[test]
fn an_entry_keeps_its_source_name_unless_another_input_holds_it() {
    let id = Uuid::parse_str("8f2c1d4e-0000-4000-8000-000000000001").unwrap();
    assert_eq!(entry_basename("Light_001.fits", id, |_| false), "Light_001.fits");
    let taken = |candidate: &str| name_key(candidate) == name_key("LIGHT_001.FITS");
    assert_eq!(entry_basename("Light_001.fits", id, taken), "Light_001-8f2c1d4e.fits");
    let both = |candidate: &str| {
        ["light_001.fits", "light_001-8f2c1d4e.fits"].contains(&name_key(candidate).as_str())
    };
    assert_eq!(entry_basename("Light_001.fits", id, both), "Light_001-8f2c1d4e0.fits");
}

#[test]
fn a_long_entry_name_keeps_its_extension_and_takes_the_id_suffix() {
    let id = Uuid::new_v4();
    let source = format!("{}_Ha_300s_001.fits", "NGC 7000 North America Nebula ".repeat(12));
    let entry = entry_basename(&source, id, |_| false);
    assert!(component_len(&entry) <= COMPONENT_LIMIT, "{} long", entry.len());
    assert!(entry.ends_with(&format!("-{}.fits", &id.simple().to_string()[..8])), "{entry}");
    let wide = format!("{}.xisf", "Ηλιακό στέμμα ".repeat(20));
    let entry = entry_basename(&wide, id, |_| false);
    assert!(component_len(&entry) <= COMPONENT_LIMIT);
    assert_eq!(Path::new(&entry).extension().and_then(|ext| ext.to_str()), Some("xisf"));
}
