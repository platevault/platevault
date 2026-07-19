// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Spec 008 X-2 — enum-drift snapshot test between the `project.create`/
//! `project.update` JSON Schemas and the two Rust sources of truth for the
//! processing-tool vocabulary: `contracts_core::projects_v2::ProjectTool`
//! (the DTO enum) and `domain_core::project::validate::VALID_TOOLS` (the
//! domain-layer validation list). All three are hand-maintained and have no
//! generated linkage, so a fourth tool added to one and not the others would
//! previously go unnoticed until a bug report.

use std::{collections::BTreeSet, fs, path::PathBuf};

use contracts_core::projects_v2::ProjectTool;
use domain_core::project::validate::VALID_TOOLS;
use serde_json::Value;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .expect("contract test package should live under tests/contract")
        .to_path_buf()
}

fn load_schema(relative_path: &str) -> Value {
    let path = repo_root().join(relative_path);
    let contents = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
    serde_json::from_str(&contents)
        .unwrap_or_else(|error| panic!("{} should be valid JSON: {error}", path.display()))
}

fn processing_tool_enum(schema: &Value) -> BTreeSet<String> {
    schema["$defs"]["ProcessingTool"]["enum"]
        .as_array()
        .expect("schema should define $defs.ProcessingTool.enum")
        .iter()
        .map(|v| v.as_str().expect("enum values should be strings").to_owned())
        .collect()
}

/// Every `ProjectTool` variant.
///
/// `ProjectTool` has no `strum::EnumIter` (production change, out of scope
/// for a test-only fix), so this list is hand-maintained — but the match
/// below has no wildcard arm, so adding a variant to `ProjectTool` without
/// adding it here fails to *compile* instead of silently leaving this list,
/// and every test built on it, under-inclusive.
fn all_project_tools() -> [ProjectTool; 3] {
    let tools = [ProjectTool::PixInsight, ProjectTool::Siril, ProjectTool::PlanetarySuite];
    for tool in tools {
        match tool {
            ProjectTool::PixInsight | ProjectTool::Siril | ProjectTool::PlanetarySuite => {}
        }
    }
    tools
}

fn project_tool_serialized_values() -> BTreeSet<String> {
    all_project_tools()
        .iter()
        .map(|t| {
            serde_json::to_value(t)
                .expect("ProjectTool should serialize")
                .as_str()
                .expect("ProjectTool should serialize to a string")
                .to_owned()
        })
        .collect()
}

#[test]
fn project_create_schema_tool_enum_matches_project_tool_dto() {
    let schema = load_schema("specs/008-project-create-onboard-edit/contracts/project.create.json");
    assert_eq!(
        processing_tool_enum(&schema),
        project_tool_serialized_values(),
        "project.create.json's ProcessingTool enum drifted from contracts_core::projects_v2::ProjectTool"
    );
}

#[test]
fn project_update_schema_tool_enum_matches_project_tool_dto() {
    let schema = load_schema("specs/008-project-create-onboard-edit/contracts/project.update.json");
    assert_eq!(
        processing_tool_enum(&schema),
        project_tool_serialized_values(),
        "project.update.json's ProcessingTool enum drifted from contracts_core::projects_v2::ProjectTool"
    );
}

#[test]
fn project_tool_dto_matches_domain_validate_tools_list() {
    let dto_values: BTreeSet<&str> = all_project_tools().iter().map(|t| t.as_db_str()).collect();
    let domain_values: BTreeSet<&str> = VALID_TOOLS.iter().copied().collect();

    assert_eq!(
        dto_values, domain_values,
        "contracts_core::projects_v2::ProjectTool drifted from domain_core::project::validate::VALID_TOOLS"
    );
}
