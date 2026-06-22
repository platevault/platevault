# 077 — FITS / XISF Header Analysis and Recommended Extraction Fields

**Date:** 2026-06-22  
**Author:** Analysis agent (read-only pass over /mnt/d/astrophotography)  
**Status:** Complete — implementation follow-up tracked separately

---

## 1. Methodology

All headers were read without loading pixel data:

- **FITS** (`.fit`, `.fits`): manual card parsing — 80-byte fixed-width cards from
  the leading 2880-byte blocks, up to the `END` card. No `astropy` dependency
  (not installed in this environment). Throwaway script at `/tmp/fits_header_dump.py`.
- **XISF** (`.xisf`): XML header is embedded as a UTF-8 string immediately after the
  binary signature block. Read via `head -c 16384 <file> | strings | grep FITSKeyword`.

Sampling covered:

| Frame type | Camera / Software | Example path |
|---|---|---|
| LIGHT (raw) | Poseidon-C PRO / NINA 3.1 | `Poseidon-C PRO/C-2025 R2 (SWAN)/2025-10-17/livestgack/*.fits` |
| LIGHT (raw) | ZWO ASI2600MM Pro / NINA 3.2 | `ZWO ASI2600MM Pro/M 16/2026-05-14/Lights/OIII/*.fits` |
| LIGHT (raw) | DWARF III / DwarfLab | `Captures/Dwarf 3/NGC2264/*.fits` |
| FLAT (raw) | ZWO ASI2600MM Pro / NINA | `Calibration/Raw/Flats/ZWO ASI2600MM Pro/2025-05-30/RED/*.fits` |
| FLAT (raw) | Poseidon-C PRO / NINA | `Poseidon-C PRO/!FLAT Libraries/2025-08-22/LUM/*.fits` |
| FLAT (raw) | Poseidon-C PRO / NINA (high gain) | `Poseidon-C PRO/!FLAT Libraries/2025-10-04/LUM/*.fits` |
| Master DARK (FITS, stripped) | DWARF III / PLateVault internal | `Calibration/Masters/master/dark_exp_120*.fits` |
| Master DARK (XISF) | DWARF III / PixInsight WBPP | `Calibration/Masters/master/masterDark_*.xisf` |
| Master DARK (XISF) | Poseidon-C PRO / PixInsight WBPP | `Calibration/Masters/Poseidon-C PRO/DARK/masterDark_*.xisf` |
| Master BIAS (XISF) | Poseidon-C PRO / PixInsight WBPP | `Calibration/Masters/Poseidon-C PRO/BIAS/masterBias_*.xisf` |
| Master BIAS (XISF) | ZWO ASI2600MM Pro / PixInsight WBPP | `Calibration/Masters/ZWO ASI2600MM/BIAS/masterBias_*.xisf` |
| Master BIAS (FITS, stripped) | DWARF III / DwarfLab | `Calibration/Masters/Dwarf 3/Bias/cam_0/bias_gain_2_bin_1.fits` |
| Master FLAT (FITS, semi-full) | Poseidon-C PRO / NINA (FlatWizard output) | `Poseidon-C PRO/!FLAT Libraries/2025-10-04/LUM/master_flat*.fit` |
| Stacked LIGHT (NINA auto-stack) | ZWO ASI2600MM Pro / ASIDeepStack | `ZWO ASI2600MM Pro/M 16/.../Light_AutoSave_Stack.fit` |
| Processed master LIGHT (FITS) | ZWO ASI2600MM Pro / PixInsight+GraXpert | `Projects/2024-02-09 Jellyfish Nebula/master/masterLight_*.fits` |

---

## 2. Per-Frame-Type × Per-Camera Keyword Inventory

### 2.1 Poseidon-C PRO / NINA — raw LIGHT

```
AIRMASS, BAYERPAT=RGGB, BITPIX=16, BZERO=32768
CAMERAID=Player One_CAMD2282B4C061209000
CCD-TEMP=0.0          ← actual sensor temperature
DATE-AVG, DATE-LOC, DATE-OBS
DEC, EQUINOX=2000.0
EXPOSURE=60.0, EXPTIME=60.0   ← both present, same value
FILTER=LUM (or Ha/OIII/SII/R/G/B)
FOCALLEN=525.0, FOCRATIO=2.2, FOCNAME, FOCPOS, FOCTEMP, FOCUSPOS, FOCUSTEM
FWHEEL=Manual Filter Wheel
GAIN=0 (or 125)
IMAGETYP=LIGHT         ← normalised to "LIGHT" by NINA
INSTRUME=Poseidon-C PRO
MJD-AVG, MJD-OBS       ← present in newer NINA 3.2, absent in 3.1
NAXIS=2, NAXIS1=6252, NAXIS2=4176
OBJCTDEC, OBJCTRA, OBJCTROT, OBJECT=C/2025 R2 (SWAN)
OFFSET=20             ← camera read-out offset/pedestal
PIERSIDE=East
RA, DEC               ← decimal degrees
READOUTM=Low Noise
ROTATANG, ROTATOR, ROTNAME, ROTSTPSZ
ROWORDER=TOP-DOWN
SET-TEMP=0.0          ← target/set temperature
SITEELEV=101.0, SITELAT=24.839, SITELONG=55.383
SWCREATE=N.I.N.A. 3.1.2.9001 (x64)
TELESCOP=Celestron C925 HS
USBLIMIT=100
XBAYROFF=0, YBAYROFF=0
XBINNING=1, XPIXSZ=3.76
YBINNING=1, YPIXSZ=3.76
```

Notable absent: `EGAIN` (no electrons-per-ADU), no `STACKCNT`.

### 2.2 ZWO ASI2600MM Pro / NINA — raw LIGHT

Identical structure to Poseidon/NINA with these differences:

```
BAYERPAT absent (mono camera, no Bayer pattern)
CAMERAID=ZWOptical_ZWO ASI2600MM Pro_
EGAIN=0.76800000667572   ← present for ZWO, electrons per ADU
INSTRUME=ZWO ASI2600MM Pro
SET-TEMP=0.0, CCD-TEMP=0.0
SWCREATE=N.I.N.A. 3.2.0.9001 (x64)
TELESCOP=Celestron C925 (or APO 120, depending on session)
MJD-AVG, MJD-OBS present (NINA 3.2)
```

### 2.3 DWARF III / DwarfLab — raw LIGHT

Very sparse header compared to NINA:

```
BAYERPAT=RGGB
BITPIX=16, BSCALE=1, BZERO=32768
CAMERA=TELE
DATE-OBS=2026-02-22T01:06:14.323
DEC=9.895
DET-TEMP=30             ← non-standard keyword (not CCD-TEMP or SET-TEMP)
EXPTIME=30.             ← only EXPTIME, no EXPOSURE
FILTER=Astro
FOCALLEN=150.
GAIN=60
INSTRUME=DWARF 3
NAXIS=2, NAXIS1=3856, NAXIS2=2180
OBJECT=NGC 2264
ORIGIN=DWARFLAB
RA=100.2417
RESTACK=0
TELESCOP=DWARF 3
XBINNING=1, XPIXSZ=2.
YBINNING=1, YPIXSZ=2.
```

Notable: no `IMAGETYP`, no `SET-TEMP`, no `CCD-TEMP` (uses `DET-TEMP`), no `FILTER` filter-wheel
keywords, no `GAIN` in ADU form (GAIN=60 = gain index, not e/ADU).

### 2.4 ZWO ASI2600MM Pro / NINA — raw FLAT

Same as LIGHT but:

```
IMAGETYP=FLAT
OBJECT=FlatWizard       ← NINA FlatWizard sets OBJECT to "FlatWizard"
BAYERPAT absent (mono)
EGAIN=0.76800000667572
OFFSET=50               ← ZWO uses higher offset than Poseidon
```

### 2.5 Poseidon-C PRO / NINA — raw FLAT

Same as LIGHT but:

```
IMAGETYP=FLAT
OBJECT=FlatWizard
BAYERPAT=RGGB           ← colour camera
GAIN=125 (or 0)
OFFSET=20
```

### 2.6 Stripped master DARK / FITS (internal ALM/PlateVault format)

Generated by the internal master-detect pipeline. **All calibration metadata is in the filename only:**

```
dark_exp_120.000000_gain_60_bin_1_44C_stack_9.fits
```

Header contains only FITS structural keywords — no calibration metadata:

```
BAYERPAT=RGGB, BITPIX=16, BSCALE=1, BZERO=32768
EXTEND=T, NAXIS=2, NAXIS1=3856, NAXIS2=2180, SIMPLE=T
```

`IMAGETYP`, `EXPTIME`, `GAIN`, `CCD-TEMP`, `INSTRUME` — all **absent**.  
Filename pattern: `dark_exp_{exptime}_gain_{gain}_bin_{bin}_{temp}C_stack_{count}.fits`

### 2.7 Master DARK / XISF — PixInsight WBPP output (DWARF III source)

```
IMAGETYP='Master Dark'
XBINNING=1, YBINNING=1
FILTER=''
EXPTIME=120.00
INSTRUME='DWARFIII'
BAYERPAT=RGGB
XPIXSZ=2, YPIXSZ=2
TELESCOP='DWARFIII'
FOCALLEN=150
OBJECT=''
RA=0, OBJCTRA='0 00 00.000', DEC=0, OBJCTDEC='+0 00 00.00'
DATE-OBS='2025-07-05T10:38:14.819', DATE-END='...'
```

XISF Properties (structural, not FITSKeywords):
```
Instrument:Camera:Name = DWARFIII
Instrument:Camera:XBinning = 1
Instrument:Filter:Name = (empty)
Instrument:Sensor:XPixelSize = 2
Instrument:Telescope:FocalLength = 0.15   ← metres (not mm!)
Instrument:Telescope:Name = DWARFIII
Observation:Time:Start, Observation:Time:End
PCL:CFASourcePattern = RGGB
PCL:TotalExposureTime (base64-encoded float64 vector)
```

No `GAIN`, no `SET-TEMP/CCD-TEMP`, no `STACKCNT/NCOMBINE`.  
Integration count in HISTORY comments: `ImageIntegration.numberOfImages: 10`.

### 2.8 Master DARK / XISF — PixInsight WBPP (Poseidon-C PRO source)

Same structure as 2.7 but:

```
IMAGETYP='Master Dark'
INSTRUME='Poseidon-C PRO'
BAYERPAT=RGGB, XBAYROFF=0, YBAYROFF=0
XPIXSZ=3.76, YPIXSZ=3.76
TELESCOP='Celestron C925 HS'
FOCALLEN=525
OBSGEO-L=55.383, OBSGEO-B=24.839, OBSGEO-H=101
LONG-OBS=55.383, LAT-OBS=24.839, ALT-OBS=101
DATE-OBS, DATE-END
```

XISF Properties:
```
Instrument:Camera:Name = Poseidon-C PRO
Instrument:Sensor:XPixelSize = 3.76
Instrument:Telescope:FocalLength = 0.525   ← metres
Observation:Location:Elevation, Latitude, Longitude
PCL:Integration = process=ImageIntegration,version=1.6.7
PCL:TotalExposureTime (base64 vector)
```

Integration count: in HISTORY `ImageIntegration.numberOfImages: 20`.

### 2.9 Master BIAS / XISF — Poseidon-C PRO (PixInsight WBPP)

Same structure as 2.8 but:

```
IMAGETYP='Master Bias'
EXPTIME=0.00
```

### 2.10 Master BIAS / XISF — ZWO ASI2600MM Pro (PixInsight WBPP)

```
IMAGETYP='Master Bias'
XBINNING=1, YBINNING=1
GAIN=0 (explicit)
EXPTIME=0.00
INSTRUME='ZWO ASI2600MM Pro'
XPIXSZ=3.76, YPIXSZ=3.76
EGAIN=0.768
TELESCOP='APO 120' (or 'Celestron C925')
FOCALLEN=840 (session-dependent)
DATE-OBS, DATE-END
```

### 2.11 Master BIAS / FITS — DWARF III (DwarfLab internal)

Completely stripped, like 2.6:

```
BAYERPAT=RGGB, BITPIX=16, BSCALE=1, BZERO=32768
EXTEND=T, NAXIS=2, NAXIS1=3856, NAXIS2=2180, SIMPLE=T
```

Filename encodes all metadata: `bias_gain_2_bin_1.fits`

### 2.12 Master FLAT / FITS — Poseidon-C PRO / NINA FlatWizard (semi-full header)

Generated by NINA FlatWizard integration. Header is essentially the same as a raw flat,
plus stacking count keywords:

```
IMAGETYP=FLAT
BIAS_CNT=0
FLAT_CNT=25             ← number of source frames
GAIN=125
OFFSET=20
CCD-TEMP=0.2            ← actual temp
SET-TEMP=0.0
CALSTAT=''
CBLACK=0, CWHITE=46424
DATAMAX=46424, DATAMIN=0
BITPIX=-32              ← 32-bit float (processed)
```

No `STACKCNT` or `NCOMBINE`. The count lives in `FLAT_CNT`.

### 2.13 Stacked LIGHT / FITS — ZWO / ASIDeepStack (NINA auto-stack)

```
IMAGETYP=LIGHT
SWCREATE=ASIDeepStack
SWOWNER=ZWO
STACKCNT=9              ← integration count
EXPTIME=2700.           ← total exposure (sum)
EXPOSURE=300.0          ← per-frame exposure
BAYERPAT=NONE           ← mono, so no Bayer
DATE-OBS, DATE-END, DATE-LOC, DATE-AVG, MJD-OBS, MJD-AVG
EGAIN=0.76800000667572
```

Note: EXPTIME ≠ EXPOSURE here. EXPTIME = total integrated exposure, EXPOSURE = per-frame.

### 2.14 Processed master LIGHT / FITS — PixInsight + GraXpert post-processing

```
IMAGETYP=Master Light
EXPTIME=300.00          ← per-frame exposure (not total)
EGAIN=0.242863
INSTRUME=ZWO ASI2600MM Pro
FOCALLEN=669.42144
OBJECT=Jellyfish Nebula
FILTER=SII
DATE-OBS, DATE-END
RA, DEC (decimal degrees)
OBJCTRA, OBJCTDEC (sexagesimal)
LAT-OBS, LONG-OBS, ALT-OBS
BG-EXTR=GraXpert        ← post-processing provenance
INTP-OPT=AI             ← GraXpert interpolation mode
TIMESYS=UTC
NAXIS=2, NAXIS1=6097, NAXIS2=4065
```

---

## 3. Recommended "Should-Extract" Field List

The table below maps domain fields to concrete header keywords observed in the real library.
**Bold** = MISSING from the current `RawFileMetadata` struct. Normal = already present.

| Domain Field | Primary Keyword | Fallbacks / Notes | Currently Extracted |
|---|---|---|---|
| frame type | `IMAGETYP` | — | Yes (`image_typ`) |
| filter | `FILTER` | — | Yes (`filter`) |
| object / target | `OBJECT` | — | Yes (`object`) |
| exposure (seconds) | `EXPTIME` | `EXPOSURE` (fallback) | Yes (`exposure`) |
| gain (ADU index) | `GAIN` | — | Yes (`gain`) |
| x binning | `XBINNING` | — | Yes (`x_binning`) |
| y binning | `YBINNING` | — | Yes (`y_binning`) |
| image width | `NAXIS1` | — | Yes (`naxis1`) |
| image height | `NAXIS2` | — | Yes (`naxis2`) |
| camera / instrument | `INSTRUME` | — | Yes (`instrume`) |
| telescope | `TELESCOP` | XISF `Instrument:Telescope:Name` | Yes (`telescop`) |
| observation start | `DATE-OBS` | — | Yes (`date_obs`) |
| integration count | `STACKCNT` | `NCOMBINE`, XISF HISTORY line | Yes (`stack_count`) |
| **offset / pedestal** | **`OFFSET`** | No standard fallback | **NO** |
| **sensor actual temp** | **`CCD-TEMP`** | `DET-TEMP` (DWARF III non-standard) | **NO** |
| **sensor set/target temp** | **`SET-TEMP`** | — | **NO** |
| **pixel size X (µm)** | **`XPIXSZ`** | XISF `Instrument:Sensor:XPixelSize` × 1e6 | **NO** |
| **pixel size Y (µm)** | **`YPIXSZ`** | XISF `Instrument:Sensor:YPixelSize` × 1e6 | **NO** |
| **focal length (mm)** | **`FOCALLEN`** | XISF `Instrument:Telescope:FocalLength` × 1000 | **NO** |
| **Bayer / CFA pattern** | **`BAYERPAT`** | XISF `PCL:CFASourcePattern` | **NO** |
| **RA (decimal °)** | **`RA`** | `OBJCTRA` (sexagesimal, needs conversion) | **NO** |
| **Dec (decimal °)** | **`DEC`** | `OBJCTDEC` (sexagesimal) | **NO** |
| **electrons per ADU** | **`EGAIN`** | — | **NO** |
| **software creator** | **`SWCREATE`** | `ORIGIN` (DWARF III uses DWARFLAB) | **NO** |
| **per-frame count** | **`FLAT_CNT`** / `BIAS_CNT` | NINA-specific; no standard key | **NO** |
| **observation end** | **`DATE-END`** | — | **NO** |
| **local time** | **`DATE-LOC`** | NINA-specific; not in FITS standard | **NO** (informational only) |

### Priority tiers

**Tier 1 — Calibration matching (required for spec 040 accuracy):**  
`OFFSET`, `CCD-TEMP`, `SET-TEMP`

These are essential for matching raw calibration frames to light sessions and for
identifying which master to apply. Without temperature, two darks with the same
gain/exposure but different sensor temperatures are indistinguishable in metadata.

**Tier 2 — Camera / equipment fingerprinting:**  
`XPIXSZ`, `YPIXSZ`, `BAYERPAT`, `EGAIN`

Pixel size and Bayer pattern are needed for the equipment auto-detection feature
(settings spec #53). `EGAIN` is ZWO-specific but useful for calibration scaling.

**Tier 3 — Target and observation context:**  
`RA`, `DEC`, `FOCALLEN`, `SWCREATE`, `DATE-END`

Useful for displaying target position, planning, and provenance. Lower urgency
for calibration matching but important for the broader library feature set.

**Tier 4 — Stacking provenance (informational):**  
`FLAT_CNT`, `BIAS_CNT`, `DATE-LOC`

Informational only. `FLAT_CNT` is NINA-specific. Can be surfaced in the UI
without being a blocking requirement.

### Filename-fallback fields (stripped masters)

For stripped master files (§2.6 DWARF III FITS masters, §2.11 Dwarf III bias), no
header keywords are present. The extractor cannot recover calibration metadata
without filename parsing. The following fields are reliably encoded in the
filename patterns observed:

| File pattern | Encoded fields |
|---|---|
| `dark_exp_{exp}_gain_{gain}_bin_{bin}_{temp}C_stack_{cnt}.fits` | exposure, gain, binning, temperature, stack count |
| `masterDark_BIN-{bin}_{w}x{h}_EXPOSURE-{exp}s_GAIN-{gain}_TEMP-{temp}.xisf` | binning, dimensions, exposure, gain, temperature |
| `masterBias_BIN-{bin}_{w}x{h}_SET-TEMP-{temp}_GAIN-{gain}_OFFSET-{off}.xisf` | binning, dimensions, set-temp, gain, offset |
| `bias_gain_{gain}_bin_{bin}.fits` | gain, binning only |

Filename parsing is out of scope for the FITS extractor crate but is a valid
fallback strategy for the master-detect pipeline when headers are absent.

---

## 4. Gap Summary vs Current RawFileMetadata

The current extractor reads 13 fields plus `stack_count`. Against the recommended
list, these fields are **missing today**:

1. `offset` → keyword `OFFSET`
2. `ccd_temp` → keyword `CCD-TEMP`, fallback `DET-TEMP` (DWARF III)
3. `set_temp` → keyword `SET-TEMP`
4. `xpixsz` → keyword `XPIXSZ`
5. `ypixsz` → keyword `YPIXSZ`
6. `focal_len` → keyword `FOCALLEN`
7. `bayer_pat` → keyword `BAYERPAT`
8. `ra` → keyword `RA`
9. `dec` → keyword `DEC`
10. `egain` → keyword `EGAIN`
11. `sw_create` → keyword `SWCREATE`, fallback `ORIGIN`
12. `flat_cnt` → keyword `FLAT_CNT` (NINA-specific)
13. `date_end` → keyword `DATE-END`

The XISF extractor additionally needs to read from XISF Property elements
(not FITSKeyword) for pixel size and focal length, which are stored in metres
in the XISF property block (`Instrument:Sensor:XPixelSize`,
`Instrument:Telescope:FocalLength`) and need unit conversion.
