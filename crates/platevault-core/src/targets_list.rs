// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Targets list (spec 072 PLAN-TGT-FR-01..13) on the [`Library`]
//! facade: My targets (★ favourites, qualifying current session Targets, and
//! the subjects of open Projects, with their badges, D-W60/D-W125), Browse
//! catalogues, unified search over My targets, the bundled catalogues and
//! SIMBAD, the night's planning columns under Home's stored criteria (the
//! one source, [`Library::home_criteria`]), Sessions and Captured per channel
//! over frames outside the Trash, built-in and saved presets, and
//! rig-dependent Fit, Filters and presets. Planning values and the altitude
//! samples come from [`planning::target_night`]; each Filters band is graded
//! by [`band_grade`], the rule Home's Tonight grades goals with.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::num::NonZeroUsize;

use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::goal_grades::{band_grade, MoonKey};
use crate::library::{blocking, Library};
use crate::planning::{self, NightContext, TargetNight};
use crate::targets::TargetQuery;
use crate::{
    AngularSize, Band, BandState, BuiltinPreset, BuiltinPresetInfo, Catalogue, FieldOfView, Fit,
    FitUnknownReason, HomeCriteria, LibraryError, MoonAvoidanceCurve, MoonCriterion, MyTargetMarks,
    ObservingSite, ObservingWindow, PlanCriteria, PlanningUnknownReason, PresetFilters, PresetRef,
    Recommendation, Revision, RigFit, RigSelection, SavedPreset, SimbadSearch, TargetActivity,
    TargetRecord, TargetRow, TargetsBasis, TargetsColumn, TargetsPage, TargetsPresets,
    TargetsQuery, TargetsRig, TargetsSearchAction, TargetsSearchResult, TargetsSearchResults,
    TargetsSearchSource, TargetsShow, TargetsSort, WindowUnavailableReason, FIT_MIN_COVERAGE,
};

/// Local search results listed before the SIMBAD result.
const SEARCH_LIMIT: usize = 50;
/// Saved Targets read per catalog page.
const TARGET_PAGE: u32 = 1000;

impl Library {
    /// One Targets list page: the rows of the Show mode, catalogues and preset
    /// with the night's planning values at the planning site (the query's,
    /// else the default site) under Home's stored criteria, sorted with
    /// unknown values last, and the Moon and darkness window once for the
    /// toolbar. Without a site or the criteria the rows still list, their
    /// planning values unknown with the reason, the site first. With rigs
    /// selected each row carries one Fit per rig and the Filters strip is the
    /// union of their bands. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid query or a preset the selected rigs do
    /// not offer; `NotFound` for an unknown site, rig or Project;
    /// `PersistenceFailure` when Home's recorded criteria cannot be read.
    pub async fn target_rows(&self, query: &TargetsQuery) -> Result<TargetsPage, LibraryError> {
        query.validate()?;
        let (rigs, strip) = self.targets_rigs(query.rigs).await?;
        query.preset.map_or(Ok(()), |preset| offer(preset, &rigs, &strip))?;
        let planning = self.targets_planning(query.site_id).await?;
        let planning_unavailable = planning.as_ref().err().copied();
        if query.show == TargetsShow::Browse
            && query.catalogues.is_empty()
            && query.preset.is_none()
        {
            return Ok(TargetsPage {
                basis: None,
                moon: None,
                darkness: None,
                planning_unavailable,
                needs_catalogue_or_preset: true,
                total: 0,
                rows: Vec::new(),
                rigs,
                bands: strip,
            });
        }
        let marks = self.catalog().my_target_marks().await?;
        let saved = self.saved_records().await?;
        let records = self.shown_records(query, &marks, &saved);
        let activity = self.catalog().target_activity().await?;
        let avoidance = self.catalog().workflow_settings().await?.0.moon_avoidance;
        let curves: Vec<(Band, MoonAvoidanceCurve)> =
            strip.iter().map(|band| (*band, avoidance.curve(*band))).collect();
        let night = query.night;
        let (sky, computed) = blocking(move || {
            let (site, criteria) = match planning {
                Ok(planning) => planning,
                Err(reason) => {
                    let rows: Vec<Computed> =
                        records.into_iter().map(|r| (r, Err(reason))).collect();
                    return Ok((None, rows));
                }
            };
            let night = match night {
                Some(night) => night,
                None => planning::night_of(OffsetDateTime::now_utc(), &site)?,
            };
            let context = NightContext::new(&site, night, &criteria)?;
            let sky = planning::night_sky(&site, night, criteria.darkness)?;
            let nights = nights_of(&context, &records, &site, &curves)?;
            let bounds = context.bounds();
            let basis = TargetsBasis {
                site: site.basis(),
                time_zone: site.time_zone,
                night,
                night_start_utc: bounds.start,
                night_end_utc: bounds.end,
                criteria,
                method: planning::METHOD.into(),
            };
            let rows: Vec<Computed> = records.into_iter().zip(nights).collect();
            Ok((Some((basis, sky.moon, sky.darkness)), rows))
        })
        .await?;
        let mut rows: Vec<Listed> = computed
            .into_iter()
            .map(|(record, night)| listed(record, night, &marks, &saved, &activity, &rigs))
            .collect();
        if let Some(preset) = query.preset {
            rows.retain(|row| admits(preset, row));
        }
        sort_rows(&mut rows, query.effective_sort());
        let total = u32::try_from(rows.len()).unwrap_or(u32::MAX);
        let offset = usize::try_from(query.offset).unwrap_or(usize::MAX);
        let limit =
            query.limit.map_or(usize::MAX, |limit| usize::try_from(limit).unwrap_or(usize::MAX));
        let (basis, moon, darkness) = match sky {
            Some((basis, moon, darkness)) => (Some(basis), Some(moon), darkness),
            None => (None, None, None),
        };
        Ok(TargetsPage {
            basis,
            moon,
            darkness,
            planning_unavailable,
            needs_catalogue_or_preset: false,
            total,
            rows: rows.into_iter().skip(offset).take(limit).map(|listed| listed.row).collect(),
            rigs,
            bands: strip,
        })
    }

    /// The rigs a selection names, each with its bands and field of view,
    /// and the Filters strip: all seven bands with no rig, else the union of
    /// the rigs' bands in display order (PLAN-TGT-FR-06).
    async fn targets_rigs(
        &self,
        selection: RigSelection,
    ) -> Result<(Vec<TargetsRig>, Vec<Band>), LibraryError> {
        let ids = match selection {
            RigSelection::None => return Ok((Vec::new(), BANDS.to_vec())),
            RigSelection::Rig { equipment_id } => vec![equipment_id],
            RigSelection::Project { project_id } => {
                self.catalog().project(project_id).await?.rig_ids
            }
        };
        let mut rigs = Vec::with_capacity(ids.len());
        for id in ids {
            let rig = self.rig(id).await?;
            rigs.push(TargetsRig {
                equipment_id: rig.equipment.id,
                name: rig.equipment.name,
                bands: rig.bands,
                field_of_view: rig.field_of_view,
            });
        }
        let strip = BANDS
            .into_iter()
            .filter(|band| rigs.iter().any(|rig| rig.bands.contains(band)))
            .collect();
        Ok((rigs, strip))
    }

    /// Search My targets, the bundled catalogues and SIMBAD. Case and
    /// whitespace are ignored, every result names its source and searching
    /// writes nothing. When SIMBAD cannot be reached, or no provider is
    /// configured, the results say SIMBAD was not searched.
    ///
    /// # Errors
    /// `InvalidInput` for text without searchable characters.
    pub async fn targets_search(&self, text: &str) -> Result<TargetsSearchResults, LibraryError> {
        let local =
            TargetQuery { text: Some(text.trim().to_owned()), cone: None, limit: SEARCH_LIMIT };
        let hits = self.search_targets(&local).await?;
        let marks = self.catalog().my_target_marks().await?;
        let saved = self.saved_targets().await?;
        let mut results: Vec<TargetsSearchResult> = hits
            .into_iter()
            .map(|hit| {
                let id = hit.candidate.id;
                let source = if marks.contains(id) {
                    TargetsSearchSource::MyTargets
                } else if !hit.candidate.catalogues.is_empty()
                    || matches!(hit.candidate.provenance, crate::Provenance::Seed { .. })
                {
                    TargetsSearchSource::Catalogue
                } else if saved.iter().any(|candidate| candidate.id == id) {
                    TargetsSearchSource::Library
                } else {
                    TargetsSearchSource::Catalogue
                };
                TargetsSearchResult {
                    target: hit.candidate,
                    source,
                    in_my_targets: marks.contains(id),
                    matched_alias: hit.matched_alias,
                }
            })
            .collect();
        let simbad = match self.resolve_target(text).await {
            Ok(candidate) => {
                if !results.iter().any(|result| result.target.id == candidate.id) {
                    results.push(TargetsSearchResult {
                        in_my_targets: marks.contains(candidate.id),
                        source: TargetsSearchSource::Simbad,
                        matched_alias: None,
                        target: candidate,
                    });
                }
                SimbadSearch::Searched
            }
            Err(LibraryError::NotFound(_) | LibraryError::InvalidInput(_)) => {
                SimbadSearch::Searched
            }
            Err(error) => SimbadSearch::NotSearched { reason: error.to_string() },
        };
        Ok(TargetsSearchResults { results, simbad })
    }

    /// Act on a result against current library state, not the search snapshot.
    /// A result that has entered My targets opens the live record unchanged;
    /// otherwise its stable id is re-resolved from the trusted saved library,
    /// bundled seed or provider before the atomic add-and-favourite write.
    ///
    /// # Errors
    /// `NotFound` when neither the current library nor a canonical seed/provider
    /// source can resolve the candidate; provider and persistence errors pass
    /// through unchanged.
    pub async fn targets_search_result_action(
        &self,
        result: &TargetsSearchResult,
    ) -> Result<TargetsSearchAction, LibraryError> {
        let saved = match self.catalog().target(result.target.id).await {
            Ok(record) => Some(record),
            Err(LibraryError::NotFound(_)) => None,
            Err(error) => return Err(error),
        };
        let (candidate, may_restore) = match saved {
            Some(record) => (record.candidate, false),
            None => match self.seed_target(result.target.id) {
                Some(seed) => (seed, true),
                None if matches!(result.source, TargetsSearchSource::Simbad)
                    || matches!(result.target.provenance, crate::Provenance::Provider { .. }) =>
                {
                    let candidate = self.resolve_target(&result.target.designation).await?;
                    if candidate.id != result.target.id {
                        return Err(LibraryError::NotFound(format!(
                            "target {} no longer resolves",
                            result.target.id
                        )));
                    }
                    (candidate, true)
                }
                None => return Err(LibraryError::NotFound(format!("target {}", result.target.id))),
            },
        };
        Ok(match self.catalog().act_on_target_search_result(&candidate, may_restore).await? {
            TargetsSearchAction::Open { target } => {
                TargetsSearchAction::Open { target: self.with_facts(target) }
            }
            TargetsSearchAction::Added { target } => {
                TargetsSearchAction::Added { target: self.with_facts(target) }
            }
        })
    }

    /// Add or remove a saved Target's ★; a subject of an open Project stays in
    /// My targets either way. Returns the new state.
    ///
    /// # Errors
    /// `NotFound` for an unsaved Target.
    pub async fn set_favourite(
        &self,
        target_id: Uuid,
        favourite: bool,
    ) -> Result<bool, LibraryError> {
        self.catalog().set_favourite(target_id, favourite).await
    }

    /// The built-in presets offered for the selected rigs, with their
    /// definitions, then the saved presets. Mosaic candidates and Fits nicely
    /// need a rig; the narrowband presets are hidden when the selected rigs
    /// pass no Ha, SII or OIII (PLAN-TGT-FR-12/13).
    ///
    /// # Errors
    /// `NotFound` for an unknown rig or Project; `PersistenceFailure` when the
    /// catalog cannot be read.
    pub async fn targets_presets(
        &self,
        rigs: RigSelection,
    ) -> Result<TargetsPresets, LibraryError> {
        let (rigs, strip) = self.targets_rigs(rigs).await?;
        let builtin = BuiltinPreset::ALL
            .into_iter()
            .filter(|preset| preset.offered(!rigs.is_empty(), &strip))
            .map(|preset| BuiltinPresetInfo {
                preset,
                name: preset.name().to_owned(),
                definition: preset.definition().to_owned(),
            })
            .collect();
        Ok(TargetsPresets { builtin, saved: self.catalog().saved_presets().await? })
    }

    /// Save the current filters as a named preset.
    ///
    /// # Errors
    /// See [`persistence_library::Catalog::create_preset`].
    pub async fn save_targets_preset(
        &self,
        name: &str,
        filters: &PresetFilters,
    ) -> Result<SavedPreset, LibraryError> {
        self.catalog().create_preset(name, filters).await
    }

    /// Rename a saved preset; a built-in preset cannot be renamed.
    ///
    /// # Errors
    /// `InvalidInput` for a built-in preset or an invalid name; otherwise see
    /// [`persistence_library::Catalog::rename_preset`].
    pub async fn rename_targets_preset(
        &self,
        preset: PresetRef,
        name: &str,
        expected: Revision,
    ) -> Result<SavedPreset, LibraryError> {
        let id = saved_preset(preset, "renamed")?;
        self.catalog().rename_preset(id, name, expected).await
    }

    /// Delete a saved preset; a built-in preset cannot be deleted.
    ///
    /// # Errors
    /// `InvalidInput` for a built-in preset; otherwise see
    /// [`persistence_library::Catalog::delete_preset`].
    pub async fn delete_targets_preset(
        &self,
        preset: PresetRef,
        expected: Revision,
    ) -> Result<(), LibraryError> {
        let id = saved_preset(preset, "deleted")?;
        self.catalog().delete_preset(id, expected).await
    }

    /// The named site, else the default site, else none.
    async fn planning_site(&self, id: Option<Uuid>) -> Result<Option<ObservingSite>, LibraryError> {
        if let Some(id) = id {
            return self.catalog().site(id).await.map(Some);
        }
        match self.catalog().list_sites().await?.default_site_id {
            Some(default) => self.catalog().site(default).await.map(Some),
            None => Ok(None),
        }
    }

    /// Every saved Target record by id.
    async fn saved_records(&self) -> Result<HashMap<Uuid, TargetRecord>, LibraryError> {
        let mut records = HashMap::new();
        let mut offset = 0_u32;
        loop {
            let page = self.catalog().list_targets(offset, TARGET_PAGE).await?;
            let count = u32::try_from(page.len()).unwrap_or(u32::MAX);
            records.extend(page.into_iter().map(|record| (record.candidate.id, record)));
            if count < TARGET_PAGE {
                return Ok(records);
            }
            offset = offset.saturating_add(count);
        }
    }

    /// The record with its bundled catalogue facts restored.
    fn with_facts(&self, mut record: TargetRecord) -> TargetRecord {
        self.target_index().attach_catalogue_facts(&mut record.candidate);
        record
    }

    /// The planning site (the query's, else the default site) with Home's
    /// stored criteria, or why the night's planning values are unknown, the
    /// site first.
    async fn targets_planning(
        &self,
        site_id: Option<Uuid>,
    ) -> Result<Result<(ObservingSite, PlanCriteria), PlanningUnknownReason>, LibraryError> {
        Ok(match (self.planning_site(site_id).await?, self.home_criteria().await?) {
            (None, _) => Err(PlanningUnknownReason::NoSite),
            (Some(_), HomeCriteria { criteria: None, .. }) => {
                Err(PlanningUnknownReason::NoCriteria)
            }
            (Some(site), HomeCriteria { criteria: Some(criteria), .. }) => Ok((site, criteria)),
        })
    }

    /// The Show mode's records: My targets' saved records, else the chosen
    /// catalogues' candidates (every catalogue when none is chosen), a saved
    /// record in place of its candidate.
    fn shown_records(
        &self,
        query: &TargetsQuery,
        marks: &MyTargetMarks,
        saved: &HashMap<Uuid, TargetRecord>,
    ) -> Vec<TargetRecord> {
        match query.show {
            TargetsShow::MyTargets => marks
                .ids()
                .into_iter()
                .filter_map(|id| saved.get(&id).cloned())
                .map(|record| self.with_facts(record))
                .collect(),
            TargetsShow::Browse => {
                let catalogues = if query.catalogues.is_empty() {
                    &Catalogue::ALL[..]
                } else {
                    &query.catalogues
                };
                self.target_index()
                    .browse(catalogues)
                    .into_iter()
                    .map(|candidate| match saved.get(&candidate.id) {
                        Some(record) => self.with_facts(record.clone()),
                        None => TargetRecord { candidate, decision_revision: 0 },
                    })
                    .collect()
            }
        }
    }
}

fn saved_preset(preset: PresetRef, verb: &str) -> Result<Uuid, LibraryError> {
    match preset {
        PresetRef::Saved { id } => Ok(id),
        PresetRef::Builtin { preset } => Err(LibraryError::InvalidInput(format!(
            "the built-in preset {:?} cannot be {verb}",
            preset.name()
        ))),
    }
}

/// Every record's night over the shared context, spread over the available
/// cores in record order.
fn nights_of(
    context: &NightContext,
    records: &[TargetRecord],
    site: &ObservingSite,
    curves: &[(Band, MoonAvoidanceCurve)],
) -> Result<Vec<Planned>, LibraryError> {
    if records.is_empty() {
        return Ok(Vec::new());
    }
    let workers = std::thread::available_parallelism().map_or(1, NonZeroUsize::get);
    let chunk = records.len().div_ceil(workers);
    std::thread::scope(|scope| {
        let parts: Vec<_> = records
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || {
                    part.iter()
                        .map(|record| graded_night(context, record, site, curves))
                        .collect::<Result<Vec<_>, _>>()
                })
            })
            .collect();
        let mut nights = Vec::with_capacity(records.len());
        for part in parts {
            let part = part.join().map_err(|_| {
                LibraryError::SourceUnavailable("targets list worker panicked".into())
            })?;
            nights.extend(part?);
        }
        Ok(nights)
    })
}

/// A Target's night with each strip band graded, or why it has none.
type Planned = Result<GradedNight, PlanningUnknownReason>;

/// A Target's night and its strip bands, graded under their curves.
struct GradedNight {
    night: TargetNight,
    bands: Vec<BandState>,
}

fn graded_night(
    context: &NightContext,
    record: &TargetRecord,
    site: &ObservingSite,
    curves: &[(Band, MoonAvoidanceCurve)],
) -> Result<Planned, LibraryError> {
    let night = match planning::target_night(context, record, site)? {
        Ok(night) => night,
        Err(WindowUnavailableReason::TargetCoordinatesUnknown) => {
            return Ok(Err(PlanningUnknownReason::TargetCoordinatesUnknown));
        }
        Err(WindowUnavailableReason::UnsupportedCoordinateFrame) => {
            return Ok(Err(PlanningUnknownReason::UnsupportedCoordinateFrame));
        }
    };
    let bands = graded_bands(context, record, site, curves)?;
    Ok(Ok(GradedNight { night, bands }))
}

/// A record and its graded night, or why it has none.
type Computed = (TargetRecord, Planned);

/// A row with the values its preset filters read that no column shows.
struct Listed {
    row: TargetRow,
    moon_up_window_minutes: u32,
}

fn listed(
    record: TargetRecord,
    night: Planned,
    marks: &MyTargetMarks,
    saved: &HashMap<Uuid, TargetRecord>,
    activity: &std::collections::BTreeMap<Uuid, TargetActivity>,
    rigs: &[TargetsRig],
) -> Listed {
    let id = record.candidate.id;
    let TargetActivity { sessions, captured } = activity.get(&id).cloned().unwrap_or_default();
    let mut row = TargetRow {
        saved: saved.contains_key(&id),
        favourite: marks.favourites.contains(&id),
        projects: marks.badges.get(&id).cloned().unwrap_or_default(),
        max_altitude_deg: None,
        lunar_separation_deg: None,
        img_time_minutes: None,
        img_time_zero_reason: None,
        bands: Vec::new(),
        altitude_samples_deg: Vec::new(),
        recommendation: None,
        next_opposition: None,
        unknown_reason: None,
        sessions,
        captured,
        fit: rigs
            .iter()
            .map(|rig| RigFit {
                equipment_id: rig.equipment_id,
                rig_name: rig.name.clone(),
                fit: fit(record.candidate.angular_size, rig.field_of_view),
            })
            .collect(),
        target: record.candidate,
    };
    let mut moon_up_window_minutes = 0;
    match night {
        Err(reason) => row.unknown_reason = Some(reason),
        Ok(GradedNight { night, bands }) => {
            row.recommendation = Some(recommendation(&bands));
            row.bands = bands;
            row.altitude_samples_deg = night.altitude_samples_deg;
            row.max_altitude_deg = night.peak_dark_altitude_deg;
            row.lunar_separation_deg = Some(night.lunar_separation_deg);
            row.img_time_minutes = Some(night.img_time_minutes);
            row.img_time_zero_reason = night.img_time_zero_reason;
            row.next_opposition = Some(night.next_opposition);
            moon_up_window_minutes = night.moon_up_window_minutes;
        }
    }
    Listed { row, moon_up_window_minutes }
}

// ---------------------------------------------------------------------------
// Fit and bands
// ---------------------------------------------------------------------------

/// Every band of the Filters strip in display order.
const BANDS: [Band; 7] = [Band::L, Band::R, Band::G, Band::B, Band::Ha, Band::Sii, Band::Oiii];

/// A Target's Fit in a rig's field (PLAN-TGT-FR-11). Coverage is the major
/// axis as a share of the field's shorter side: at most 1 the Target fits one
/// field and reads "fits" from 25% coverage, "tiny" below it. Larger, it
/// needs a grid of fields covering its major axis along both sides of the
/// field, since nothing fixes its orientation in the frame. A rig without a
/// field of view, then a Target without a catalogued size, reads "-" with
/// the reason.
#[must_use]
pub fn fit(size: Option<AngularSize>, field: Option<FieldOfView>) -> Fit {
    let positive = |value: f64| value.is_finite() && value > 0.0;
    let Some(field) = field.filter(|field| positive(field.width_deg) && positive(field.height_deg))
    else {
        return Fit::Unknown { reason: FitUnknownReason::FieldOfViewUnknown };
    };
    let Some(major) = size.map(|size| size.major_arcmin).filter(|major| positive(*major)) else {
        return Fit::Unknown { reason: FitUnknownReason::SizeUnknown };
    };
    let (width, height) = (field.width_deg * 60.0, field.height_deg * 60.0);
    let coverage = major / width.min(height);
    if coverage > 1.0 {
        let panels = fields_across(major, width).saturating_mul(fields_across(major, height));
        Fit::Panels { coverage, panels }
    } else if coverage >= FIT_MIN_COVERAGE {
        Fit::Fits { coverage }
    } else {
        Fit::Tiny { coverage }
    }
}

/// Fields side by side, without overlap, that span `extent` (both positive
/// and finite, in the same unit).
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn fields_across(extent: f64, side: f64) -> u32 {
    // A positive finite ratio rounded up; `as` saturates beyond `u32::MAX`.
    (extent / side).ceil() as u32
}

/// Refuse a preset the selected rigs do not offer (PLAN-TGT-FR-12/13).
fn offer(preset: BuiltinPreset, rigs: &[TargetsRig], strip: &[Band]) -> Result<(), LibraryError> {
    if preset.offered(!rigs.is_empty(), strip) {
        return Ok(());
    }
    let needs = if preset.needs_rig() {
        "a selected rig"
    } else {
        "a selected rig with an Ha, SII or OIII filter"
    };
    Err(LibraryError::InvalidInput(format!("the preset {:?} needs {needs}", preset.name())))
}

/// Each strip band graded for the context's night under its Moon-avoidance
/// curve (PLAN-FR-02, PLAN-TGT-FR-06), by the rule Home's Tonight grades
/// goals with ([`band_grade`]): the Plan area windows under the curve's Moon
/// criterion at the night's Moon age against the Moon-free windows, the
/// band's clear minutes their total. Bands whose curves set the same Moon
/// criterion share one computation, and a Target without a Moon-free window
/// has none under any curve. `record` has a usable position. Blocking.
fn graded_bands(
    context: &NightContext,
    record: &TargetRecord,
    site: &ObservingSite,
    curves: &[(Band, MoonAvoidanceCurve)],
) -> Result<Vec<BandState>, LibraryError> {
    // A position target_night accepted always yields windows.
    let windows = |moon| -> Result<Vec<ObservingWindow>, LibraryError> {
        Ok(planning::night_windows(&context.with_moon(moon), record, site)?.unwrap_or_default())
    };
    let longest = |windows: &[ObservingWindow]| windows.iter().map(|w| w.duration_minutes).max();
    let free = longest(&windows(MoonCriterion::None)?);
    let age = context.moon_age_days();
    let mut computed: Vec<(MoonKey, Option<u32>, u32)> = Vec::new();
    let mut bands = Vec::with_capacity(curves.len());
    for (band, curve) in curves {
        let moon = planning::curve_criterion(*curve, age);
        let key = MoonKey::of(moon);
        let (under_moon, clear_minutes) = match computed.iter().find(|(known, ..)| *known == key) {
            Some((_, longest_under_moon, clear)) => (*longest_under_moon, *clear),
            None if free.is_none() => (None, 0),
            None => {
                let found = windows(moon)?;
                let clear = found.iter().map(|w| w.duration_minutes).sum();
                computed.push((key, longest(&found), clear));
                (longest(&found), clear)
            }
        };
        bands.push(BandState { band: *band, grade: band_grade(under_moon, free), clear_minutes });
    }
    Ok(bands)
}

const fn broadband(band: Band) -> bool {
    matches!(band, Band::L | Band::R | Band::G | Band::B)
}

fn recommendation(bands: &[BandState]) -> Recommendation {
    if bands.iter().any(|state| state.suits() && broadband(state.band)) {
        Recommendation::BroadbandOk
    } else if bands.iter().any(BandState::suits) {
        Recommendation::NarrowbandOnly
    } else {
        Recommendation::AvoidTonight
    }
}

fn suits(row: &TargetRow, admit: impl Fn(Band) -> bool) -> bool {
    row.bands.iter().any(|state| state.suits() && admit(state.band))
}

// ---------------------------------------------------------------------------
// Presets and sort
// ---------------------------------------------------------------------------

/// Whether a row meets a built-in preset's definition; unknown values meet
/// none. With several rigs a Fit preset matches on any of them.
fn admits(preset: BuiltinPreset, listed: &Listed) -> bool {
    let row = &listed.row;
    let img = row.img_time_minutes.unwrap_or(0);
    let kind = row.target.object_type.as_str();
    match preset {
        BuiltinPreset::BestTonightBroadband => img > 0 && suits(row, broadband),
        BuiltinPreset::NarrowbandMoonUp => {
            img > 0 && listed.moon_up_window_minutes > 0 && suits(row, |band| !broadband(band))
        }
        BuiltinPreset::EmissionNebulaeHa => {
            kind == "emission_nebula" && suits(row, |band| band == Band::Ha)
        }
        BuiltinPreset::GalaxiesDarkSky => kind == "galaxy" && img > listed.moon_up_window_minutes,
        BuiltinPreset::PlanetaryNebulaeOiii => {
            kind == "planetary_nebula" && suits(row, |band| band == Band::Oiii)
        }
        BuiltinPreset::MosaicCandidates => row.fit.iter().any(|rig| rig.fit.is_mosaic_candidate()),
        BuiltinPreset::FitsNicely => row.fit.iter().any(|rig| rig.fit.fits_nicely()),
    }
}

/// One column's value; `None` is unknown and sorts last either way.
enum Key<'a> {
    Text(&'a str),
    Number(f64),
    Day(Date),
}

fn key(row: &TargetRow, column: TargetsColumn) -> Option<Key<'_>> {
    match column {
        TargetsColumn::Designation => Some(Key::Text(&row.target.designation)),
        TargetsColumn::Type => Some(Key::Text(&row.target.object_type)),
        TargetsColumn::MaxAlt => row.max_altitude_deg.map(Key::Number),
        TargetsColumn::Lunar => row.lunar_separation_deg.map(Key::Number),
        TargetsColumn::ImgTime => {
            row.img_time_minutes.map(|minutes| Key::Number(f64::from(minutes)))
        }
        TargetsColumn::Filters => (!row.bands.is_empty()).then(|| {
            Key::Number(f64::from(
                u8::try_from(row.bands.iter().filter(|state| state.suits()).count())
                    .unwrap_or(u8::MAX),
            ))
        }),
        TargetsColumn::Opposition => row.next_opposition.map(Key::Day),
        TargetsColumn::Sessions => Some(Key::Number(f64::from(row.sessions))),
        TargetsColumn::Captured => {
            Some(Key::Number(row.captured.iter().map(|channel| channel.seconds).sum()))
        }
    }
}

fn compare_keys(first: &Key<'_>, second: &Key<'_>) -> Ordering {
    match (first, second) {
        (Key::Text(a), Key::Text(b)) => natural(a, b),
        (Key::Number(a), Key::Number(b)) => a.total_cmp(b),
        (Key::Day(a), Key::Day(b)) => a.cmp(b),
        _ => Ordering::Equal,
    }
}

/// Sort by the column, unknown values last in either direction, then by
/// Designation ascending and id.
fn sort_rows(rows: &mut [Listed], sort: TargetsSort) {
    rows.sort_by(|a, b| {
        let (a, b) = (&a.row, &b.row);
        let primary = match (key(a, sort.column), key(b, sort.column)) {
            (Some(x), Some(y)) => {
                let order = compare_keys(&x, &y);
                if sort.descending {
                    order.reverse()
                } else {
                    order
                }
            }
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        };
        primary
            .then_with(|| natural(&a.target.designation, &b.target.designation))
            .then_with(|| a.target.id.cmp(&b.target.id))
    });
}

/// Case-insensitive natural order: digit runs compare by value, so M 2 sorts
/// before M 10.
fn natural(first: &str, second: &str) -> Ordering {
    let (mut a, mut b) = (first.chars().peekable(), second.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let left = digits(&mut a);
                let right = digits(&mut b);
                let order = left
                    .trim_start_matches('0')
                    .len()
                    .cmp(&right.trim_start_matches('0').len())
                    .then_with(|| left.trim_start_matches('0').cmp(right.trim_start_matches('0')));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                let order = x.to_lowercase().cmp(y.to_lowercase());
                if order != Ordering::Equal {
                    return order;
                }
                a.next();
                b.next();
            }
        }
    }
}

fn digits(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut run = String::new();
    while let Some(digit) = chars.next_if(char::is_ascii_digit) {
        run.push(digit);
    }
    run
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::BandGrade;

    #[test]
    fn natural_order_compares_digit_runs_by_value() {
        let mut names = vec!["M 10", "m 2", "M 1", "NGC 224", "IC 1396", "M 02x"];
        names.sort_by(|a, b| natural(a, b));
        assert_eq!(names, ["IC 1396", "M 1", "m 2", "M 02x", "M 10", "NGC 224"]);
    }

    /// A suited broadband band recommends broadband; otherwise a suited
    /// narrowband band, even a marginal one, recommends narrowband only.
    #[test]
    fn recommendation_follows_the_suited_bands() {
        let state = |band, grade| BandState { band, grade, clear_minutes: 0 };
        let mut bands = vec![state(Band::L, BandGrade::Poor), state(Band::Ha, BandGrade::Marginal)];
        assert_eq!(recommendation(&bands), Recommendation::NarrowbandOnly);
        bands[0].grade = BandGrade::Marginal;
        assert_eq!(recommendation(&bands), Recommendation::BroadbandOk);
        for band in &mut bands {
            band.grade = BandGrade::Poor;
        }
        assert_eq!(recommendation(&bands), Recommendation::AvoidTonight);
    }
}
