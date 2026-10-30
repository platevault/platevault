// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! An `invalid_input` refusal names the input field that failed as a stable
//! machine path, the wire (camelCase) names from the validated value down,
//! so the client can show the refusal on that field. It never carries
//! English text, and a failure that knows no field names none.

use platevault_model::{
    Darkness, GoalInput, GoalSpec, LibraryError, LibraryErrorCode, MoonCriterion, PlanCriteria,
    ProjectInput, SubjectInput, WindowQuery,
};
use uuid::Uuid;

fn criteria() -> PlanCriteria {
    PlanCriteria {
        min_altitude_deg: 30.0,
        darkness: Darkness::Astronomical,
        moon: MoonCriterion::None,
        min_duration_minutes: 30,
    }
}

fn field(result: Result<(), LibraryError>) -> String {
    let error = result.expect_err("refused");
    assert_eq!(error.code(), LibraryErrorCode::InvalidInput, "{error:?}");
    let path = error.field().unwrap_or_else(|| panic!("{error:?} names no field")).to_string();
    let response = error.response(None, None);
    assert_eq!(response.field.as_ref().map(ToString::to_string), Some(path.clone()));
    path
}

#[test]
fn home_criteria_name_the_field_that_fails() {
    let high = PlanCriteria { min_altitude_deg: 95.0, ..criteria() };
    assert_eq!(field(high.validate()), "minAltitudeDeg");
    let long = PlanCriteria { min_duration_minutes: 0, ..criteria() };
    assert_eq!(field(long.validate()), "minDurationMinutes");
    let moon = PlanCriteria {
        moon: MoonCriterion::MinSeparation { min_separation_deg: 180.0 },
        ..criteria()
    };
    assert_eq!(field(moon.validate()), "moon.minSeparationDeg");
    criteria().validate().expect("valid criteria");
}

#[test]
fn an_enclosing_value_names_the_field_from_its_own_value_down() {
    let query = WindowQuery {
        target_id: Uuid::new_v4(),
        site_id: Uuid::new_v4(),
        first_night: time::Date::from_calendar_date(2026, time::Month::October, 29).expect("date"),
        nights: 1,
        criteria: PlanCriteria { min_altitude_deg: -1.0, ..criteria() },
    };
    assert_eq!(field(query.validate()), "criteria.minAltitudeDeg");
    assert_eq!(field(WindowQuery { nights: 0, ..query }.validate()), "nights");
}

#[test]
fn a_list_names_the_position_of_the_entry_that_fails() {
    let target_id = Uuid::new_v4();
    let project = ProjectInput {
        name: "NGC 7000".into(),
        notes: None,
        subjects: vec![
            SubjectInput { target_id: Uuid::new_v4(), name: None },
            SubjectInput { target_id, name: Some("  ".into()) },
        ],
        rig_ids: vec![Uuid::new_v4()],
        goals: Vec::new(),
    };
    assert_eq!(field(project.validate()), "subjects.1.name");
    let unnamed = ProjectInput { name: " ".into(), ..project.clone() };
    assert_eq!(field(unnamed.validate()), "name");
    // An empty list is a refusal of the list itself.
    let no_rig = ProjectInput {
        subjects: vec![SubjectInput { target_id, name: None }],
        rig_ids: Vec::new(),
        ..project.clone()
    };
    assert_eq!(field(no_rig.validate()), "rigIds");
    let goal = GoalInput {
        target_id,
        group_id: None,
        goal: GoalSpec::Integration { channel: None, goal_seconds: 0 },
    };
    let no_time = ProjectInput {
        subjects: vec![SubjectInput { target_id, name: None }],
        goals: vec![goal],
        ..project
    };
    assert_eq!(field(no_time.validate()), "goals.0.goalSeconds");
}

#[test]
fn reminder_lead_time_names_its_field() {
    let reminder = platevault_model::ReminderInput {
        target_id: Uuid::new_v4(),
        criteria: criteria(),
        lead_minutes: 0,
    };
    assert_eq!(field(reminder.validate()), "leadMinutes");
    assert_eq!(
        field(reminder.validate().map_err(|error| error.within_field("reminder"))),
        "leadMinutes"
    );
}

#[test]
fn within_field_keeps_other_failures_and_a_context_keeps_its_field() {
    let not_found = LibraryError::NotFound("site".into()).within_field("criteria");
    assert!(not_found.field().is_none(), "{not_found:?}");
    let named = LibraryError::invalid_field("minAltitudeDeg", "english diagnostic")
        .within_field("criteria")
        .concerning(Uuid::new_v4());
    assert_eq!(named.field().map(ToString::to_string).as_deref(), Some("criteria.minAltitudeDeg"));
    let response = serde_json::to_value(named.response(None, None)).expect("serialize");
    assert_eq!(response["field"], "criteria.minAltitudeDeg");
    assert!(!response.to_string().contains("english"), "{response}");
    let unnamed = serde_json::to_value(LibraryError::InvalidInput("x".into()).response(None, None))
        .expect("serialize");
    assert!(unnamed["field"].is_null(), "{unnamed}");
}
