# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only
"""Independent astroplan reference for spec 072 observing-window qualification.

Run from this directory (see README.md for the pinned command):

    uvx --python 3.12 --with astroplan==0.10.1 --with astropy==8.0.1 \
        --with astropy-iers-data==0.2026.10.5.1.0.7 --with numpy==2.5.3 \
        --with pyerfa==2.0.1.5 --with tzdata==2026.5 \
        python generate_reference.py

Every altitude is geometric: the observer has pressure 0, so astropy applies no
refraction, matching skymath's flat-horizon, no-refraction model. Each night
runs from local noon on its date to local noon on the next date in the site's
zone. Altitudes and the topocentric Moon separation are sampled every minute
and each crossing is interpolated linearly between its bracketing minutes.
Intervals are clipped to the night; `windows` is the unrounded intersection of
the dark, target-above and Moon-allowed intervals, before any minimum-duration
filter. Instants are UTC rounded to the whole second.
"""

import json
import warnings
import zoneinfo
from datetime import date, datetime, time, timedelta, timezone
from importlib.metadata import version

import astropy.units as u
import numpy as np
from astroplan import FixedTarget, Observer
from astropy.coordinates import EarthLocation, SkyCoord
from astropy.time import Time
from astropy.utils import iers

# Reproducible offline runs: only the pinned astropy-iers-data tables, and no
# download. Predicted UT1-UTC stays below a second, far inside the 180 s bound.
iers.conf.auto_download = False
iers.conf.auto_max_age = None
iers.conf.iers_degraded_accuracy = "ignore"
warnings.simplefilter("ignore")
# Zone rules from the pinned tzdata package, never from the host system.
zoneinfo.reset_tzpath(to=[])

SITES = {
    "backyard": {"name": "Backyard", "latitudeDeg": 52.09, "longitudeDeg": 5.12,
                 "elevationM": 5.0, "timeZone": "Europe/Amsterdam"},
    "second": {"name": "Athens", "latitudeDeg": 37.98, "longitudeDeg": 23.73,
               "elevationM": 100.0, "timeZone": "Europe/Athens"},
    "polar": {"name": "Longyearbyen", "latitudeDeg": 78.22, "longitudeDeg": 15.65,
              "elevationM": 10.0, "timeZone": "Arctic/Longyearbyen"},
}

# NGC 7000 at the ICRS position the Rust tests save.
TARGET = {"designation": "NGC 7000", "raDeg": 314.75, "decDeg": 44.33}

SUN_LIMIT = {"civil": -6.0, "nautical": -12.0, "astronomical": -18.0}

QUICKSTART = {"minAltitudeDeg": 30.0, "darkness": "astronomical",
              "moon": {"kind": "min_separation", "minSeparationDeg": 30.0},
              "minDurationMinutes": 60}

# (case, site, first night, nights, criteria)
CASES = [
    ("backyard_autumn", "backyard", date(2026, 10, 20), 30, QUICKSTART),
    ("second_autumn", "second", date(2026, 10, 20), 30, QUICKSTART),
    # About 52 N at midsummer the Sun never reaches -18 degrees.
    ("never_dark", "backyard", date(2026, 6, 20), 1,
     {"minAltitudeDeg": 30.0, "darkness": "astronomical", "moon": {"kind": "none"},
      "minDurationMinutes": 60}),
    # At 78 N in midwinter the Sun stays below -6 degrees and NGC 7000 stays
    # above 30 degrees: the window is the whole noon-to-noon night.
    ("always_dark", "polar", date(2026, 12, 20), 1,
     {"minAltitudeDeg": 30.0, "darkness": "civil", "moon": {"kind": "none"},
      "minDurationMinutes": 60}),
    # In January NGC 7000 sets below 15 degrees in the evening and rises again
    # before dawn: one night, two windows.
    ("set_then_rise", "backyard", date(2027, 1, 15), 1,
     {"minAltitudeDeg": 15.0, "darkness": "astronomical", "moon": {"kind": "none"},
      "minDurationMinutes": 30}),
]


def utc_text(instant):
    return instant.strftime("%Y-%m-%dT%H:%M:%SZ")


def night_bounds(night, zone):
    tz = zoneinfo.ZoneInfo(zone)
    start = datetime.combine(night, time(12), tz).astimezone(timezone.utc)
    end = datetime.combine(night + timedelta(days=1), time(12), tz).astimezone(timezone.utc)
    return start, end


def intervals(values, start, minutes):
    """Spans where `values` (one per minute from `start`) is non-negative."""
    inside = values >= 0.0
    spans = []
    open_at = 0.0 if inside[0] else None
    for i in range(1, len(values)):
        if inside[i] == inside[i - 1]:
            continue
        a, b = values[i - 1], values[i]
        crossing = (i - 1) + a / (a - b)
        if inside[i]:
            open_at = crossing
        else:
            spans.append((open_at, crossing))
            open_at = None
    if open_at is not None:
        spans.append((open_at, float(minutes)))
    return spans


def intersect(first, second):
    out = []
    for a0, a1 in first:
        for b0, b1 in second:
            lo, hi = max(a0, b0), min(a1, b1)
            if hi > lo:
                out.append((lo, hi))
    return sorted(out)


def union(first, second):
    spans = sorted(first + second)
    out = []
    for lo, hi in spans:
        if out and lo <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], hi))
        else:
            out.append((lo, hi))
    return out


def as_text(spans, start):
    return [{"startUtc": utc_text(start + timedelta(seconds=round(lo * 60.0))),
             "endUtc": utc_text(start + timedelta(seconds=round(hi * 60.0)))}
            for lo, hi in spans]


def night_reference(observer, target, night, zone, criteria):
    start, end = night_bounds(night, zone)
    minutes = round((end - start).total_seconds() / 60.0)
    times = Time(start) + np.arange(minutes + 1) * u.min
    sun = observer.sun_altaz(times).alt.deg
    target_altaz = observer.altaz(times, target)
    above = intervals(target_altaz.alt.deg - criteria["minAltitudeDeg"], start, minutes)
    dark = intervals(SUN_LIMIT[criteria["darkness"]] - sun, start, minutes)
    whole = [(0.0, float(minutes))]
    moon = criteria["moon"]
    record = {"night": night.isoformat(), "nightStartUtc": utc_text(start),
              "nightEndUtc": utc_text(end), "dark": as_text(dark, start),
              "above": as_text(above, start)}
    if moon["kind"] == "none":
        allowed = whole
    else:
        moon_altaz = observer.moon_altaz(times)
        down = intervals(-moon_altaz.alt.deg, start, minutes)
        record["moonDown"] = as_text(down, start)
        if moon["kind"] == "below_horizon":
            allowed = down
        else:
            separation = moon_altaz.separation(target_altaz).deg
            apart = intervals(separation - moon["minSeparationDeg"], start, minutes)
            record["separated"] = as_text(apart, start)
            allowed = union(down, apart)
    record["moonAllowed"] = as_text(allowed, start)
    record["windows"] = as_text(intersect(intersect(dark, above), allowed), start)
    return record


def main():
    target = FixedTarget(SkyCoord(ra=TARGET["raDeg"] * u.deg, dec=TARGET["decDeg"] * u.deg,
                                  frame="icrs"), name=TARGET["designation"])
    cases = []
    for case, site_key, first, nights, criteria in CASES:
        site = SITES[site_key]
        location = EarthLocation.from_geodetic(site["longitudeDeg"] * u.deg,
                                               site["latitudeDeg"] * u.deg,
                                               site["elevationM"] * u.m)
        observer = Observer(location=location, pressure=0 * u.bar, name=site["name"])
        cases.append({
            "case": case, "site": site_key, "criteria": criteria,
            "nights": [night_reference(observer, target, first + timedelta(days=n),
                                       site["timeZone"], criteria) for n in range(nights)],
        })
    document = {
        "generator": "generate_reference.py",
        "method": "astroplan Observer altaz, pressure 0 (geometric, no refraction), "
                  "1-minute samples with linear crossing interpolation",
        "toleranceSeconds": 180,
        "tools": {name: version(name) for name in
                  ("astroplan", "astropy", "astropy-iers-data", "numpy", "pyerfa", "tzdata")},
        "target": TARGET, "sites": SITES, "cases": cases,
    }
    with open("astroplan-reference.json", "w", encoding="utf-8", newline="\n") as out:
        json.dump(document, out, indent=1, sort_keys=True)
        out.write("\n")


if __name__ == "__main__":
    main()
