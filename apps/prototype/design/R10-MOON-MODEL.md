# R10 Moon model (C6) and goal units (C7)

Bead astro-plan-6nrni (U12) · 2026-10-12 · decisions C6 and C7 (`HARNESS-V5-FEEDBACK-R1.md` Round 9), plan Q6/Q7 and §5.8 D7/D8 (`R9-COMPOSITION-PLAN.md`).

C6: one Moon-avoidance curve per filter, where the required separation shrinks as the Moon dims. Grades and Img time both use it. The plan asked for the ACP / N.I.N.A. convention to be checked against a source before building; §1 does that.

## 1. Sources (all accessed 2026-10-12)

| # | Source | URL | What it says (verbatim) |
|---|---|---|---|
| S1 | ACP Scheduler 8.1 help, Constraints, MoonAvoid (DC-3 Dreams). The live URL timed out; the archived copy was read. | live: http://bobdenny.com/ar/RefDocs/HelpFiles/ACPScheduler81Help/Constraints.htm · archived: https://web.archive.org/web/20180128004254/http://solo.dc3.com:80/ar/RefDocs/HelpFiles/ACPScheduler81Help/Constraints.htm | "MoonAvoid takes two parameters: distance (degrees) and width (days). … This means at full Moon the avoidance will be distance, and width days before (or after) the avoidance will be one half distance. If you are unsure what to use, start out with distance=120 and width=14." The page's script: `d / (1.0 + Math.pow(((0.5 - (a / 29.5)) / (w / 29.5)), 2))`. "The Moon-Avoidance Lorentzian was formulated by the Berkeley Automated Imaging Telescope (BAIT) team." A separate MoonDown constraint: "the Moon is down (at least 5 degrees below the mathematical horizon)". |
| S2 | N.I.N.A. Target Scheduler docs, Exposure Templates, Moon Avoidance | https://tcpalmer.github.io/nina-scheduler/target-management/exposure-templates.html#moon-avoidance | Per-template (per-filter) fields "Classic Separation, 0 to 180°", "Classic Width, integer 1-14", "Relaxation / Scale", "Minimum Altitude -90° to -1°", "Maximum Altitude 0° to 30°", "Moon Must Be Down". "The formulation used here is from ACP." "The values used on the ACP site are very conservative. For narrowband imaging you could get away with distance=60 and width=7 which would need 60° separation at full moon but only 30° at first or last quarter." Relaxation: "Since the impact of the moon on sky quality diminishes as the moon gets near or below the horizon … If the moon altitude is below the minimum, then avoidance is off altogether". "By default, relaxation will be off." |
| S3 | Target Scheduler source, commit `17b36a4f8580c687ad18f8b94127d7ca1a2a702e` | https://github.com/tcpalmer/nina.plugin.targetscheduler/tree/17b36a4f8580c687ad18f8b94127d7ca1a2a702e/NINA.Plugin.TargetScheduler | `Astrometry/AstrometryUtils.cs`: L9 `DAYS_IN_LUNAR_CYCLE = 29.53059`; L136 `return distance / (1 + Math.Pow((0.5 - (moonAge / DAYS_IN_LUNAR_CYCLE)) / (width / DAYS_IN_LUNAR_CYCLE), 2));`; L145-147 age from `AstroUtil.GetMoonPositionAngle`, mapped to 0-360° × 29.53059/360. `Database/Schema/ExposureTemplate.cs` L259-264 defaults: `MoonAvoidanceSeparation = 60; MoonAvoidanceWidth = 7; MoonRelaxScale = 0; MoonRelaxMaxAltitude = 5; MoonRelaxMinAltitude = -15;`. `Planning/MoonAvoidanceExpert.cs` L53-84: relaxation only when `MoonRelaxScale > 0`; otherwise `rejected = moonSeparation < moonAvoidanceSeparation`, whatever the Moon's altitude. |
| S4 | nrStellar, "Target Scheduler setup guide" (one imager's settings, in screenshots) | https://nrstellar.com/blogs/articles/target-scheduler-setup-guide | "For narrowband filters, I use these settings:" Classic Separation 35, Classic Width 3 (relaxation scale 2, −15° to 5°). "For broadband filters, I use these settings:" Separation 90, Width 14, relaxation off. |
| S5 | AstroManager docs, Moon avoidance | https://docs.astro.sleeman.at/settings/moon-avoidance | Built-in profiles named "LRGB", "Ha / SII" and "OIII", using a "Lorentzian-style curve"; no values on the page. |

Core N.I.N.A. has no Lorentzian: the research pass found only a flat minimum Moon distance in the Sky Atlas and Moon altitude and illumination conditions in the sequencer. In the N.I.N.A. ecosystem the Lorentzian lives in Target Scheduler (S2, S3) and the third-party Moon Angle plugin, which defaults to 120° and 14 days. These two findings come from the research report and were not re-read here.

## 2. The formula

With D the separation at full Moon (degrees), W the width (days), a the Moon's age (days since new Moon) and P the synodic month:

  S(a) = D / (1 + ((0.5 − a / P) / (W / P))²)  =  D / (1 + ((P/2 − a) / W)²)

- S = D at full Moon (a = P/2) and D/2 at W days before or after it (S1, S2).
- ACP uses P = 29.5 (S1); Target Scheduler uses 29.53059 (S3). PlateVault uses 29.53059 (`SYNODIC_MONTH_DAYS`).
- ACP's inline prose formula reads `(0.5 - age/width)`, which disagrees with its own script and spreadsheet formula. The script form above is the one that runs, and Target Scheduler's source flags the prose as a typo.
- Age: Target Scheduler derives it from the Moon's position angle (S3). PlateVault derives it from the Moon's lead over the Sun in ecliptic longitude, from the same low-precision positions the planner already uses (about 0.3°).

Check against the cited arithmetic (`requiredMoonSeparationDeg`, ages 0, 3.7, 7.4, 11.1 and 14.765 days): 120°/14 d gives 56.81, 73.86, 93.99, 112.30 and 120.00°; 60°/7 d gives 11.01, 17.15, 28.48, 47.09 and 60.00°. At first quarter 60°/7 d needs 28.4°, the "only 30°" of S2.

## 3. The PlateVault rule

`domain/planning.ts`:

- **`moonAllows(curve, sample, separation)`.** A sample lets a filter image a position when the Moon is below the horizon, or when the Moon is at least S(age at that sample) away.
- **`nightImaging(sky, altitudes, position, criteria, curves, bands, nowMs)`.** A filter's windows are its stretches of at least the minimum duration, in darkness above the altitude limit, that its curve allows. As in `computeWindows`, only stretches that end after `nowMs` count. Each filter gets a grade:
  - good: it has a window, and its longest window keeps at least 75% of the night's longest dark stretch;
  - marginal: it has a window, but the Moon takes more than a quarter of the dark time;
  - poor: no window.
- **Img time.** Img time is every filter's windows merged. Grades and Img time therefore cannot disagree: Img time is zero exactly when every filter is poor, and never shorter than any filter's longest window.

**Deviation from the classic convention: a Moon below the horizon allows every filter.** Classic avoidance applies whatever the Moon's altitude: ACP's MoonAvoid, and Target Scheduler with relaxation off (S1, S3).
- Why PlateVault deviates:
  - The product already speaks of the Moon as up or down (the Moon line, the "Moon down" reason, the Moon up/down presets), and the old rule ignored a Moon that had set.
  - Target Scheduler's own relaxation turns avoidance off for a low Moon, on the stated ground that its impact "diminishes as the moon gets near or below the horizon" (S2).
- Residual risk: a Moon just below the horizon counts as harmless. That is less strict than Target Scheduler's relaxation, which keeps reduced avoidance down to −15°.
- Revisit if the user wants relaxation (scale and altitude range) or ACP's MoonDown threshold of −5°.

**What it supersedes.**
- The two independent per-band limits (separation ≥, illumination ≤; `MoonConstraint`, `DEFAULT_MOON_CONSTRAINTS`, `clearStretches`, `filterSuitability`) are deprecated.
- `PlanCriteria.maxMoonIlluminationPct` and `minMoonSeparationDeg` stay null by default. `computeWindows` still reads them for the calendar export, reminders and Home's "Plan tonight". Those are outside C6.

## 4. Per-filter defaults (`DEFAULT_MOON_AVOIDANCE`, `domain/labels.ts`)

No source publishes per-filter values: ACP gives one starting point, and Target Scheduler and Moon Angle each give one default. Each group therefore takes a cited setting, and the grouping follows S5's built-in profiles.

| Bands | Separation at full | Width | Source | Needs at new · crescent · quarter · gibbous · full |
|---|---|---|---|---|
| L, R, G, B | 120° | 14 d | S1 starting point (also Moon Angle's default) | 57° · 74° · 94° · 112° · 120° |
| OIII | 60° | 7 d | S3 template default; S2 narrowband suggestion | 11° · 17° · 28° · 47° · 60° |
| Ha, SII | 35° | 3 d | S4 narrowband setting | 1° · 2° · 5° · 14° · 35° |

- OIII is stricter than Ha and SII: scattered moonlight reaches the 501 nm line more than the red lines. The previous defaults ranked the bands the same way (OIII 60°, SII 40°, Ha 30°).
- An edited curve is clamped to S2's ranges, 0–180° and 1–14 days (`MOON_AVOIDANCE_LIMITS`, `clampMoonAvoidance`). The width therefore never reaches zero, which S3 refuses.

## 5. Goal units (C7)

- `domain/templates.ts`:
  - `goalAmount` reads a goal's one amount, time or frames. A goal stored before C7 with both fields set reads as time, the unit its progress always showed.
  - `goalFields` is its inverse, for editors: at most one field set.
  - `goalMeasure` counts "in project", "captured", the target and what remains in that one unit, so the met test and the progress line agree.
- `domain/derive.ts` `goalProgress`:
  - takes `met`, the line's unit and `measure` from `goalMeasure`;
  - `remainingS` is deprecated for `measure.remaining`, which frame goals now have too.
- Fixed: a goal holding both fields used to need both met (AND) while its line showed only time.
- A goal without an amount still reads in frames, as before.
- Goal conditions beyond the unit (quality bar, channel balance, mosaic coverage, deadline) are astro-plan-v7i9k.

## 6. What W3 wires (expand only in W2)

- **Settings (lead).** `AppSettings.moonAvoidance: Record<Band, MoonAvoidance>`, a seed default of `structuredClone(DEFAULT_MOON_AVOIDANCE)`, a `setMoonAvoidance(band, patch)` action through `clampMoonAvoidance`, and a `SCHEMA_VERSION` bump. `MoonAvoidance` can move to `types.ts` at the same time.
- **P7 Targets:**
  - `rowView` and `positionSky` take chips, Img time and the best window from `imagingTonight` (good-tonight.ts), in place of `filtersTonight` and `windowsOnNight`;
  - `FilterPill` takes `ImagingChip` with `imagingReason`;
  - the good-band menu shows `avoidanceText`;
  - the Moon limits FormDialog edits separation and width within `MOON_AVOIDANCE_LIMITS`.
- **Lead or U11:** `derive.ts` `goodTonight` switches to `nightImaging`.
- **P5 and P10:** the goal editors use a unit Select that writes `goalFields`. Pages read `measure.remaining` and `measure.unit`.
- **W4 deletes:**
  - in `planning.ts`: `clearStretches`, `FilterTonight`, `filterSuitability`;
  - in `labels.ts`: `DEFAULT_MOON_CONSTRAINTS`;
  - in `good-tonight.ts`: `FilterChip`, `filtersTonight`, `filterReason`, `limitText`, `BAND_ORDER` and the `FilterGrade` re-export;
  - in `derive.ts`: `GoalProgress.remainingS`;
  - the keys left unused (`tonight_limit`, `tonight_fail_illumination`, `domain_goal_target_both`).
