# Astroplan reference for observing windows

`astroplan-reference.json` is an independent reference for the spec 072
window computation (research R9). The Rust tests in `tests/planning_windows.rs`
recompute windows with skymath and compare them to it; the reference is never
derived from PlateVault output.

## Regenerate

From this directory:

```sh
uvx --python 3.12 --with astroplan==0.10.1 --with astropy==8.0.1 \
    --with astropy-iers-data==0.2026.10.5.1.0.7 --with numpy==2.5.3 \
    --with pyerfa==2.0.1.5 --with tzdata==2026.5 \
    python generate_reference.py
```

Re-running reproduces the committed file byte for byte
(SHA-256 `b2b1267204dd489db2df8530f370ede43227aa143d43193b009fe3d83749abd2`).
The run is offline after the packages are installed: IERS downloads are off and
zone rules come from the pinned `tzdata` package, never from the host.

## Tool versions

| Package | Version |
| --- | --- |
| Python | 3.12 |
| astroplan | 0.10.1 |
| astropy | 8.0.1 |
| astropy-iers-data | 0.2026.10.5.1.0.7 |
| numpy | 2.5.3 |
| pyerfa | 2.0.1.5 |
| tzdata | 2026.5 |

## Definitions

- Altitudes are geometric: the astroplan `Observer` has pressure 0, so no
  refraction applies, matching skymath's flat horizon without refraction.
- Darkness is the Sun's altitude below -6, -12 or -18 degrees for civil,
  nautical or astronomical. The Moon is up while its topocentric center is above
  0 degrees. Separation is the topocentric Moon-to-target angle in the AltAz
  frame.
- A night runs from local noon on its date to local noon on the next date in
  the site's zone, so DST nights last 23 or 25 hours.
- Altitudes and separations are sampled every minute; each crossing is
  interpolated linearly between its bracketing minutes and rounded to the whole
  UTC second. Every interval is clipped to the night.
- `windows` is the unrounded intersection of `dark`, `above` and `moonAllowed`,
  before inward rounding and the minimum-duration filter. `moonAllowed` is the
  whole night for Moon criterion `none`, `moonDown` for `below_horizon`, and the
  union of `moonDown` and `separated` for `min_separation`.
- Tolerance: unrounded boundaries must agree within 180 seconds, the skymath
  Moon-crossing bound (research R9).

## Cases

| Case | Site | Nights | Criteria | Covers |
| --- | --- | --- | --- | --- |
| `backyard_autumn` | Backyard 52.09 N 5.12 E, 5 m, Europe/Amsterdam | 2026-10-20, 30 nights | 30 deg, astronomical, Moon at least 30 deg, 60 min | Quickstart windows, the 2026-10-25 DST change |
| `second_autumn` | Athens 37.98 N 23.73 E, 100 m, Europe/Athens | 2026-10-20, 30 nights | as above | The second site and its zone |
| `never_dark` | Backyard | 2026-06-20 | 30 deg, astronomical, no Moon limit | A never-dark summer night |
| `always_dark` | Longyearbyen 78.22 N 15.65 E, 10 m, Arctic/Longyearbyen | 2026-12-20 | 30 deg, civil, no Moon limit | A polar always-dark night bounded by local noon |
| `set_then_rise` | Backyard | 2027-01-15 | 15 deg, astronomical, no Moon limit | A target that sets and rises in one night |

The target is NGC 7000 at ICRS RA 314.75 deg, Dec 44.33 deg.
