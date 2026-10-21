// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The application profile contract (spec 069 PREP-FR-01/02/04/07,
//! PREP-FR-13, D04, D-W81, D-W83): launch arguments name only the Project's
//! View, and capability evidence carries no input-list claim.

use platevault_model::{
    Capability, CapabilityEvidence, CapabilityProof, InputBehavior, LibraryError, ProfileInput,
    ProfileKind,
};

fn profile(args: &[&str]) -> ProfileInput {
    ProfileInput {
        name: "Siril".to_owned(),
        kind: ProfileKind::Siril,
        executable: None,
        args: args.iter().map(|arg| (*arg).to_owned()).collect(),
        capability_evidence: CapabilityEvidence::default(),
    }
}

fn refused(input: &ProfileInput) -> String {
    match input.validate() {
        Err(LibraryError::InvalidInput(message)) => message,
        other => panic!("{:?} should be refused, got {other:?}", input.args),
    }
}

#[test]
fn launch_arguments_name_the_projects_view() {
    profile(&["{view}"]).validate().unwrap();
    profile(&["-d", "{view}"]).validate().unwrap();
    profile(&["--input={view}/NIGHT_2026-10-14"]).validate().unwrap();
}

#[test]
fn run_era_and_unnamed_folder_placeholders_are_refused() {
    // PREP-FR-04/05 (D-W81): no file-list mode, so no `{inputs}`.
    // PREP-FR-07: no tool is pointed at `Output/`, so no `{results}`.
    // PREP-FR-07/13: Open hands the tool the View, never the Project folder,
    // so an unnamed `{folder}` is no placeholder either.
    for placeholder in ["{inputs}", "{results}", "{folder}"] {
        let message = refused(&profile(&[placeholder]));
        assert!(message.contains(placeholder), "{message}");
        assert!(message.contains("{view}"), "{message}");
    }
}

#[test]
fn capability_evidence_carries_no_input_list() {
    let evidence = CapabilityEvidence {
        input_behavior: InputBehavior::ReadOnly,
        proofs: vec![CapabilityProof {
            capability: Capability::Input,
            evidence: "Siril 1.4.4 opens View/ read-only".to_owned(),
        }],
    };
    evidence.validate().unwrap();
    assert_eq!(
        serde_json::to_value(&evidence).unwrap(),
        serde_json::json!({
            "inputBehavior": "read_only",
            "proofs": [{ "capability": "input", "evidence": "Siril 1.4.4 opens View/ read-only" }],
        }),
    );
}

#[test]
fn read_only_input_still_needs_its_proof() {
    let evidence =
        CapabilityEvidence { input_behavior: InputBehavior::ReadOnly, proofs: Vec::new() };
    assert!(matches!(evidence.validate(), Err(LibraryError::InvalidInput(_))));
}
