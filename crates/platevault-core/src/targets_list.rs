// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! The Targets list (spec 072 PLAN-TGT-FR-01..05/07..10) on the [`Library`]
//! facade: My targets (★ favourites plus the subjects of open Projects, with
//! their badges, D-W60), Browse catalogues, unified search over My targets,
//! the bundled catalogues and SIMBAD, tonight's planning columns, Sessions and
//! Captured per channel over frames outside the Trash, and the built-in and
//! saved presets. Every planning value comes from [`planning::target_night`],
//! the computation behind the Plan area windows; nothing is stored.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::num::NonZeroUsize;

use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::library::{blocking, Library};
use crate::planning::{self, NightContext, TargetNight};
use crate::targets::TargetQuery;
use crate::{
    AddTarget, Band, BandState, BuiltinPreset, BuiltinPresetInfo, Catalogue, LibraryError,
    MyTargetMarks, ObservingSite, PlanningUnknownReason, PresetFilters, PresetRef, Recommendation,
    Revision, SavedPreset, SimbadSearch, TargetActivity, TargetRecord, TargetRow, TargetsBasis,
    TargetsColumn, TargetsPage, TargetsPresets, TargetsQuery, TargetsSearchResult,
    TargetsSearchResults, TargetsSearchSource, TargetsShow, TargetsSort, WindowUnavailableReason,
};

/// Local search results listed before the SIMBAD result.
const SEARCH_LIMIT: usize = 50;
/// Saved Targets read per catalog page.
const TARGET_PAGE: u32 = 1000;

impl Library {
    /// One Targets list page: the rows of the Show mode, catalogues and preset
    /// with tonight's planning values at the planning site (the query's, else
    /// the default site), sorted with unknown values last, and the Moon once
    /// for the toolbar. Read-only.
    ///
    /// # Errors
    /// `InvalidInput` for an invalid query; `NotFound` for an unknown site.
    pub async fn target_rows(&self, query: &TargetsQuery) -> Result<TargetsPage, LibraryError> {
        query.validate()?;
        let site = self.planning_site(query.site_id).await?;
        if query.show == TargetsShow::Browse
            && query.catalogues.is_empty()
            && query.preset.is_none()
        {
            return Ok(TargetsPage {
                basis: None,
                moon: None,
                planning_unavailable: site.is_none().then_some(PlanningUnknownReason::NoSite),
                needs_catalogue_or_preset: true,
                total: 0,
                rows: Vec::new(),
            });
        }
        let marks = self.catalog().my_target_marks().await?;
        let saved = self.saved_records().await?;
        let records = match query.show {
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
                    .collect::<Vec<_>>()
            }
        };
        let activity = self.catalog().target_activity().await?;
        let criteria = query.criteria;
        let night = query.night;
        let computed = blocking(move || {
            let Some(site) = site else {
                return Ok((None, None, records.into_iter().map(|r| (r, None)).collect()));
            };
            let night = match night {
                Some(night) => night,
                None => planning::night_of(OffsetDateTime::now_utc(), &site)?,
            };
            let context = NightContext::new(&site, night, &criteria)?;
            let moon = planning::night_sky(&site, night, criteria.darkness)?.moon;
            let nights = nights_of(&context, &records, &site)?;
            let basis = TargetsBasis {
                site: site.basis(),
                time_zone: site.time_zone,
                night,
                criteria,
                method: planning::METHOD.into(),
            };
            let age = context.moon_age_days();
            let rows: Vec<Computed> =
                records.into_iter().zip(nights).map(|(r, n)| (r, Some((n, age)))).collect();
            Ok((Some(basis), Some(moon), rows))
        })
        .await?;
        let (basis, moon, computed) = computed;
        let mut rows: Vec<Listed> = computed
            .into_iter()
            .map(|(record, night)| listed(record, night, &marks, &saved, &activity))
            .collect();
        if let Some(preset) = query.preset {
            rows.retain(|row| admits(preset, row));
        }
        sort_rows(&mut rows, query.effective_sort());
        let total = u32::try_from(rows.len()).unwrap_or(u32::MAX);
        let offset = usize::try_from(query.offset).unwrap_or(usize::MAX);
        let limit =
            query.limit.map_or(usize::MAX, |limit| usize::try_from(limit).unwrap_or(usize::MAX));
        Ok(TargetsPage {
            planning_unavailable: basis.is_none().then_some(PlanningUnknownReason::NoSite),
            basis,
            moon,
            needs_catalogue_or_preset: false,
            total,
            rows: rows.into_iter().skip(offset).take(limit).map(|listed| listed.row).collect(),
        })
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

    /// Add to targets: write the Target into the library when it is not
    /// saved yet and mark it ★, in one transaction. A SIMBAD result is resolved
    /// again from its query.
    ///
    /// # Errors
    /// `NotFound` for an unknown saved or seed Target; the provider's errors
    /// for a SIMBAD result; `InvalidInput` for an invalid candidate.
    pub async fn add_to_my_targets(
        &self,
        target: &AddTarget,
    ) -> Result<TargetRecord, LibraryError> {
        let candidate = match target {
            AddTarget::Saved { id } => self.catalog().target(*id).await?.candidate,
            AddTarget::Seed { id } => self
                .seed_target(*id)
                .ok_or_else(|| LibraryError::NotFound(format!("seed target {id}")))?,
            AddTarget::Simbad { query } => self.resolve_target(query).await?,
        };
        let record = self.catalog().add_to_my_targets(&candidate).await?;
        Ok(self.with_facts(record))
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

    /// The built-in presets with their definitions, then the saved presets.
    ///
    /// # Errors
    /// `PersistenceFailure` when the catalog cannot be read.
    pub async fn targets_presets(&self) -> Result<TargetsPresets, LibraryError> {
        let builtin = BuiltinPreset::ALL
            .iter()
            .map(|preset| BuiltinPresetInfo {
                preset: *preset,
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
) -> Result<Vec<Result<TargetNight, WindowUnavailableReason>>, LibraryError> {
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
                        .map(|record| planning::target_night(context, record, site))
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

/// A record and its night with the night's Moon age, or none without a site.
type Computed = (TargetRecord, Option<(Result<TargetNight, WindowUnavailableReason>, f64)>);

/// A row with the values its preset filters read that no column shows.
struct Listed {
    row: TargetRow,
    moon_up_window_minutes: u32,
}

fn listed(
    record: TargetRecord,
    night: Option<(Result<TargetNight, WindowUnavailableReason>, f64)>,
    marks: &MyTargetMarks,
    saved: &HashMap<Uuid, TargetRecord>,
    activity: &std::collections::BTreeMap<Uuid, TargetActivity>,
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
        recommendation: None,
        next_opposition: None,
        unknown_reason: None,
        sessions,
        captured,
        target: record.candidate,
    };
    let mut moon_up_window_minutes = 0;
    match night {
        None => row.unknown_reason = Some(PlanningUnknownReason::NoSite),
        Some((Err(reason), _)) => {
            row.unknown_reason = Some(match reason {
                WindowUnavailableReason::TargetCoordinatesUnknown => {
                    PlanningUnknownReason::TargetCoordinatesUnknown
                }
                WindowUnavailableReason::UnsupportedCoordinateFrame => {
                    PlanningUnknownReason::UnsupportedCoordinateFrame
                }
            });
        }
        Some((Ok(night), moon_age_days)) => {
            let moon_free = night.img_time_minutes > 0 && night.moon_up_window_minutes == 0;
            let bands = band_states(night.lunar_separation_deg, moon_age_days, moon_free);
            row.recommendation = Some(recommendation(&bands));
            row.bands = bands;
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
// Bands
// ---------------------------------------------------------------------------

/// Every band of the Filters strip in display order.
const BANDS: [Band; 7] = [Band::L, Band::R, Band::G, Band::B, Band::Ha, Band::Sii, Band::Oiii];

/// The Moon-avoidance rule of spec 047 D4: a band is viable when the Target's
/// separation from the Moon is at least the band's Lorentzian minimum,
/// `distance / (1 + (age / width)^2)` with `age` in days from full Moon. The
/// parameters are its shipped defaults: LRGB 120°/14 d, Ha and SII 60°/7 d,
/// OIII 110°/10 d.
const fn band_params(band: Band) -> (f64, f64) {
    match band {
        Band::L | Band::R | Band::G | Band::B => (120.0, 14.0),
        Band::Ha | Band::Sii => (60.0, 7.0),
        Band::Oiii => (110.0, 10.0),
    }
}

/// Each band viable or limited by the Moon tonight. A Target whose windows
/// all fall while the Moon is down is limited in no band.
fn band_states(separation_deg: f64, moon_age_days: f64, moon_free: bool) -> Vec<BandState> {
    BANDS
        .iter()
        .map(|band| {
            let (distance, width) = band_params(*band);
            let ratio = moon_age_days.max(0.0) / width;
            let minimum = distance / ratio.mul_add(ratio, 1.0);
            BandState { band: *band, viable: moon_free || separation_deg >= minimum }
        })
        .collect()
}

const fn broadband(band: Band) -> bool {
    matches!(band, Band::L | Band::R | Band::G | Band::B)
}

fn recommendation(bands: &[BandState]) -> Recommendation {
    if bands.iter().any(|state| state.viable && broadband(state.band)) {
        Recommendation::BroadbandOk
    } else if bands.iter().any(|state| state.viable) {
        Recommendation::NarrowbandOnly
    } else {
        Recommendation::AvoidTonight
    }
}

fn viable(row: &TargetRow, admit: impl Fn(Band) -> bool) -> bool {
    row.bands.iter().any(|state| state.viable && admit(state.band))
}

// ---------------------------------------------------------------------------
// Presets and sort
// ---------------------------------------------------------------------------

/// Whether a row meets a built-in preset's definition; unknown values meet
/// none.
fn admits(preset: BuiltinPreset, listed: &Listed) -> bool {
    let row = &listed.row;
    let img = row.img_time_minutes.unwrap_or(0);
    let kind = row.target.object_type.as_str();
    match preset {
        BuiltinPreset::BestTonightBroadband => img > 0 && viable(row, broadband),
        BuiltinPreset::NarrowbandMoonUp => {
            img > 0 && listed.moon_up_window_minutes > 0 && viable(row, |band| !broadband(band))
        }
        BuiltinPreset::EmissionNebulaeHa => {
            kind == "emission_nebula" && viable(row, |band| band == Band::Ha)
        }
        BuiltinPreset::GalaxiesDarkSky => kind == "galaxy" && img > listed.moon_up_window_minutes,
        BuiltinPreset::PlanetaryNebulaeOiii => {
            kind == "planetary_nebula" && viable(row, |band| band == Band::Oiii)
        }
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
                u8::try_from(row.bands.iter().filter(|state| state.viable).count())
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

    #[test]
    fn natural_order_compares_digit_runs_by_value() {
        let mut names = vec!["M 10", "m 2", "M 1", "NGC 224", "IC 1396", "M 02x"];
        names.sort_by(|a, b| natural(a, b));
        assert_eq!(names, ["IC 1396", "M 1", "m 2", "M 02x", "M 10", "NGC 224"]);
    }

    #[test]
    fn full_moon_limits_broadband_before_narrowband() {
        let bands = band_states(80.0, 0.0, false);
        let viable: Vec<Band> = bands.iter().filter(|s| s.viable).map(|s| s.band).collect();
        assert_eq!(viable, [Band::Ha, Band::Sii]);
        assert_eq!(recommendation(&bands), Recommendation::NarrowbandOnly);
        assert!(band_states(60.0, 14.7, false).iter().all(|state| state.viable));
        assert!(band_states(1.0, 0.0, true).iter().all(|state| state.viable));
        assert_eq!(recommendation(&band_states(1.0, 0.0, false)), Recommendation::AvoidTonight);
    }
}
