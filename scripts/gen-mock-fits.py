#!/usr/bin/env python3

# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""
Generate minimal but valid mock FITS files for PlateVault testing.

Each file has a realistic FITS header matching the patterns documented in
docs/development/077-fits-header-analysis.md, with a tiny 4×4 pixel image
(or NAXIS=0 for frames where pixels are irrelevant, such as stripped masters).

The generated library lives under:
  tests/fixtures/mock-fits-library/

Usage:
  python3 scripts/gen-mock-fits.py [--output-dir <path>]

The output directory is wiped and recreated on each run.
"""

import argparse
import os
import shutil
import struct

# ---------------------------------------------------------------------------
# FITS primitives
# ---------------------------------------------------------------------------

BLOCK_SIZE = 2880
CARD_SIZE = 80


def _card(keyword: str, value, comment: str = "") -> bytes:
    """Build one 80-byte FITS header card."""
    kw = keyword.upper().ljust(8)[:8]

    if isinstance(value, bool):
        val_str = f"{'T' if value else 'F':>20}"
        comment_part = f" / {comment}" if comment else ""
        card = f"{kw}= {val_str}{comment_part}"
    elif isinstance(value, int):
        val_str = f"{value:>20}"
        comment_part = f" / {comment}" if comment else ""
        card = f"{kw}= {val_str}{comment_part}"
    elif isinstance(value, float):
        val_str = f"{value:>20.6f}"
        comment_part = f" / {comment}" if comment else ""
        card = f"{kw}= {val_str}{comment_part}"
    elif isinstance(value, str):
        # String value: padded to 20 chars inside single quotes
        escaped = value.replace("'", "''")
        val_str = f"'{escaped:<18}'"
        comment_part = f" / {comment}" if comment else ""
        card = f"{kw}= {val_str}{comment_part}"
    elif value is None:
        # Comment-only card
        card = f"{kw}  {comment}"
    else:
        raise TypeError(f"Unsupported card value type: {type(value)}")

    # Truncate to 80 bytes, pad with spaces
    card_bytes = card.encode("ascii", errors="replace")[:CARD_SIZE]
    return card_bytes + b" " * (CARD_SIZE - len(card_bytes))


def _end_card() -> bytes:
    return b"END" + b" " * (CARD_SIZE - 3)


def build_fits(cards: list, pixels_4x4: bool = True) -> bytes:
    """
    Build a minimal valid FITS file.

    If pixels_4x4=True a 4x4 16-bit image is appended (minimal real data).
    If False NAXIS=0 (no pixel data) is used — valid for some frame types.
    """
    all_cards: list[bytes] = []

    # Always start with SIMPLE
    all_cards.append(_card("SIMPLE", True, "file conforms to FITS standard"))

    if pixels_4x4:
        all_cards.append(_card("BITPIX", 16, "array data type"))
        all_cards.append(_card("NAXIS", 2, "number of array dimensions"))
        all_cards.append(_card("NAXIS1", 4, "image width"))
        all_cards.append(_card("NAXIS2", 4, "image height"))
        all_cards.append(_card("BZERO", 32768, "offset for unsigned short"))
        all_cards.append(_card("BSCALE", 1, "data scaling factor"))
    else:
        all_cards.append(_card("BITPIX", 16, "array data type"))
        all_cards.append(_card("NAXIS", 0, "no pixel data"))

    # Caller-supplied cards
    for c in cards:
        all_cards.append(c)

    all_cards.append(_end_card())

    # Pad to a full 2880-byte block
    total_cards = len(all_cards)
    cards_per_block = BLOCK_SIZE // CARD_SIZE
    blocks_needed = (total_cards + cards_per_block - 1) // cards_per_block
    padded = all_cards + [b" " * CARD_SIZE] * (blocks_needed * cards_per_block - total_cards)

    header_bytes = b"".join(padded)

    if pixels_4x4:
        # 4*4 = 16 pixels × 2 bytes = 32 bytes, padded to 2880
        pixel_data = struct.pack(">16H", *range(16))  # 0..15
        pixel_data += b"\x00" * (BLOCK_SIZE - len(pixel_data))
        return header_bytes + pixel_data
    else:
        return header_bytes


def write_fits(path: str, cards: list, pixels_4x4: bool = True) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = build_fits(cards, pixels_4x4=pixels_4x4)
    with open(path, "wb") as f:
        f.write(data)
    print(f"  written: {os.path.relpath(path)}")


# ---------------------------------------------------------------------------
# Card helpers
# ---------------------------------------------------------------------------


def nina_common_cards(
    instrume: str,
    telescop: str,
    gain: int,
    offset: int,
    ccd_temp: float,
    set_temp: float,
    xpixsz: float,
    ypixsz: float,
    focallen: float,
    xbinning: int = 1,
    ybinning: int = 1,
    bayerpat: str | None = None,
    egain: float | None = None,
    readoutm: str | None = None,
    swcreate: str = "N.I.N.A. 3.2.0.9001 (x64)",
) -> list:
    cards = []
    cards.append(_card("INSTRUME", instrume, "camera / instrument"))
    cards.append(_card("TELESCOP", telescop, "telescope identifier"))
    cards.append(_card("GAIN", gain, "camera gain index"))
    cards.append(_card("OFFSET", offset, "camera read-out offset/pedestal"))
    cards.append(_card("CCD-TEMP", ccd_temp, "sensor actual temperature (C)"))
    cards.append(_card("SET-TEMP", set_temp, "sensor target temperature (C)"))
    cards.append(_card("XPIXSZ", xpixsz, "pixel size X including binning (um)"))
    cards.append(_card("YPIXSZ", ypixsz, "pixel size Y including binning (um)"))
    cards.append(_card("FOCALLEN", focallen, "effective focal length (mm)"))
    cards.append(_card("XBINNING", xbinning, "binning factor horizontal"))
    cards.append(_card("YBINNING", ybinning, "binning factor vertical"))
    if bayerpat is not None:
        cards.append(_card("BAYERPAT", bayerpat, "Bayer CFA pattern"))
    if egain is not None:
        cards.append(_card("EGAIN", egain, "electrons per ADU"))
    if readoutm is not None:
        cards.append(_card("READOUTM", readoutm, "read-out mode"))
    cards.append(_card("SWCREATE", swcreate, "software that created this file"))
    cards.append(_card("EQUINOX", 2000.0, "epoch of coordinates"))
    return cards


# ---------------------------------------------------------------------------
# Mock file definitions
# ---------------------------------------------------------------------------


def generate_library(base: str) -> None:
    # -----------------------------------------------------------------------
    # A. Poseidon-C PRO / NINA — LIGHT frames
    # -----------------------------------------------------------------------
    poseidon_common = nina_common_cards(
        instrume="Poseidon-C PRO",
        telescop="Celestron C925 HS",
        gain=0,
        offset=20,
        ccd_temp=-0.1,
        set_temp=0.0,
        xpixsz=3.76,
        ypixsz=3.76,
        focallen=525.0,
        bayerpat="RGGB",
        readoutm="Low Noise",
        swcreate="N.I.N.A. 3.2.0.9001 (x64)",
    )

    write_fits(
        f"{base}/light/poseidon-nina/light_lum_0001.fits",
        [
            _card("IMAGETYP", "LIGHT", "frame type"),
            _card("OBJECT", "C/2025 R2 (SWAN)", "observed target"),
            _card("FILTER", "LUM", "filter used"),
            _card("EXPTIME", 60.0, "exposure time in seconds"),
            _card("EXPOSURE", 60.0, "exposure time in seconds"),
            _card("DATE-OBS", "2025-10-17T15:50:03.386", "start of observation UTC"),
            _card("DATE-AVG", "2025-10-17T15:50:34.072", "mid-point of observation UTC"),
            _card("RA", 272.686804997245, "RA of center (degrees)"),
            _card("DEC", -15.0224068359485, "Dec of center (degrees)"),
        ]
        + poseidon_common,
    )

    write_fits(
        f"{base}/light/poseidon-nina/light_ha_0001.fits",
        [
            _card("IMAGETYP", "LIGHT", "frame type"),
            _card("OBJECT", "NGC 7000", "observed target"),
            _card("FILTER", "Ha", "filter used"),
            _card("EXPTIME", 300.0, "exposure time in seconds"),
            _card("EXPOSURE", 300.0, "exposure time in seconds"),
            _card("DATE-OBS", "2025-08-23T20:15:00.000", "start of observation UTC"),
            _card("RA", 313.0, "RA of center (degrees)"),
            _card("DEC", 44.5, "Dec of center (degrees)"),
        ]
        + nina_common_cards(
            instrume="Poseidon-C PRO",
            telescop="Celestron C925 HS",
            gain=125,
            offset=20,
            ccd_temp=-10.1,
            set_temp=-10.0,
            xpixsz=3.76,
            ypixsz=3.76,
            focallen=525.0,
            bayerpat="RGGB",
            readoutm="Low Noise",
        ),
    )

    # -----------------------------------------------------------------------
    # B. ZWO ASI2600MM Pro / NINA — LIGHT frames (mono, no Bayer)
    # -----------------------------------------------------------------------
    zwo_common = nina_common_cards(
        instrume="ZWO ASI2600MM Pro",
        telescop="Celestron C925",
        gain=0,
        offset=50,
        ccd_temp=0.0,
        set_temp=0.0,
        xpixsz=3.76,
        ypixsz=3.76,
        focallen=1645.0,
        egain=0.768,
        swcreate="N.I.N.A. 3.2.0.9001 (x64)",
        # No bayerpat for mono
    )

    write_fits(
        f"{base}/light/zwo-nina/light_oiii_0001.fits",
        [
            _card("IMAGETYP", "LIGHT", "frame type"),
            _card("OBJECT", "M 16", "observed target"),
            _card("FILTER", "OIII", "filter used"),
            _card("EXPTIME", 300.0, "exposure time in seconds"),
            _card("EXPOSURE", 300.0, "exposure time in seconds"),
            _card("DATE-OBS", "2026-05-15T00:05:12.127", "start of observation UTC"),
            _card("MJD-OBS", 61175.003612, "Modified Julian Date of start"),
            _card("RA", 274.695159241985, "RA of center (degrees)"),
            _card("DEC", -13.7655348757928, "Dec of center (degrees)"),
        ]
        + zwo_common,
    )

    # -----------------------------------------------------------------------
    # C. DWARF III / DwarfLab — LIGHT frame (sparse header)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/light/dwarf3-dwarflab/light_astro_0001.fits",
        [
            _card("IMAGETYP", "LIGHT", "frame type"),
            # Note: DWARF III does NOT include IMAGETYP in raw files —
            # this is added here for test coverage. Raw files are missing it.
            _card("OBJECT", "NGC 2264", "observed target"),
            _card("FILTER", "Astro", "filter/mode"),
            _card("EXPTIME", 30.0, "exposure time in seconds"),
            # No EXPOSURE keyword on DWARF III
            _card("GAIN", 60, "gain index (not ADU gain)"),
            _card("INSTRUME", "DWARF 3", "camera"),
            _card("TELESCOP", "DWARF 3", "telescope"),
            _card("FOCALLEN", 150.0, "effective focal length (mm)"),
            _card("DET-TEMP", 29, "detector temperature (C) — DWARF III non-standard"),
            # No CCD-TEMP, no SET-TEMP on DWARF III
            _card("XPIXSZ", 2.0, "pixel size X (um)"),
            _card("YPIXSZ", 2.0, "pixel size Y (um)"),
            _card("XBINNING", 1, "binning X"),
            _card("YBINNING", 1, "binning Y"),
            _card("BAYERPAT", "RGGB", "Bayer CFA pattern"),
            _card("DATE-OBS", "2026-02-22T01:06:14.323", "start of observation UTC"),
            _card("RA", 100.2417, "RA of center (degrees)"),
            _card("DEC", 9.895, "Dec of center (degrees)"),
            _card("ORIGIN", "DWARFLAB", "originating software"),
            _card("CAMERA", "TELE", "camera mode"),
            _card("RESTACK", 0, "restack flag"),
        ],
    )

    # -----------------------------------------------------------------------
    # D. DWARF III / DwarfLab — LIGHT without IMAGETYP (real raw behaviour)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/light/dwarf3-dwarflab/light_astro_no_imagetyp_0002.fits",
        [
            # Intentionally omits IMAGETYP — as in real DWARF III raw files
            _card("OBJECT", "M 42", "observed target"),
            _card("FILTER", "Astro", "filter/mode"),
            _card("EXPTIME", 30.0, "exposure time in seconds"),
            _card("GAIN", 60, "gain index"),
            _card("INSTRUME", "DWARF 3", "camera"),
            _card("TELESCOP", "DWARF 3", "telescope"),
            _card("FOCALLEN", 150.0, "effective focal length (mm)"),
            _card("DET-TEMP", 30, "detector temperature (C)"),
            _card("XPIXSZ", 2.0, "pixel size X (um)"),
            _card("YPIXSZ", 2.0, "pixel size Y (um)"),
            _card("XBINNING", 1, "binning X"),
            _card("YBINNING", 1, "binning Y"),
            _card("BAYERPAT", "RGGB", "Bayer CFA pattern"),
            _card("DATE-OBS", "2026-02-22T02:30:00.000", "start of observation UTC"),
            _card("RA", 83.822, "RA of center (degrees)"),
            _card("DEC", -5.391, "Dec of center (degrees)"),
            _card("ORIGIN", "DWARFLAB", "originating software"),
        ],
    )

    # -----------------------------------------------------------------------
    # E. ZWO ASI2600MM Pro / NINA — raw FLAT
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/flat/zwo-nina/flat_red_0001.fits",
        [
            _card("IMAGETYP", "FLAT", "frame type"),
            _card("OBJECT", "FlatWizard", "NINA FlatWizard identifier"),
            _card("FILTER", "RED", "filter used"),
            _card("EXPTIME", 1.631, "exposure time in seconds"),
            _card("EXPOSURE", 1.631, "exposure time in seconds"),
            _card("DATE-OBS", "2025-05-31T00:38:17.436", "start of observation UTC"),
            _card("RA", 310.547, "RA of zenith (degrees)"),
            _card("DEC", 22.944, "Dec of zenith (degrees)"),
        ]
        + nina_common_cards(
            instrume="ZWO ASI2600MM Pro",
            telescop="APO 120",
            gain=0,
            offset=50,
            ccd_temp=5.2,
            set_temp=5.0,
            xpixsz=3.76,
            ypixsz=3.76,
            focallen=672.0,
            egain=0.768,
        ),
    )

    # -----------------------------------------------------------------------
    # F. Poseidon-C PRO / NINA — raw FLAT (high gain)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/flat/poseidon-nina/flat_lum_gain125_0001.fits",
        [
            _card("IMAGETYP", "FLAT", "frame type"),
            _card("OBJECT", "FlatWizard", "NINA FlatWizard identifier"),
            _card("FILTER", "LUM", "filter used"),
            _card("EXPTIME", 1.55, "exposure time in seconds"),
            _card("EXPOSURE", 1.55, "exposure time in seconds"),
            _card("DATE-OBS", "2025-10-05T02:01:16.571", "start of observation UTC"),
        ]
        + nina_common_cards(
            instrume="Poseidon-C PRO",
            telescop="Celestron C925 HS",
            gain=125,
            offset=20,
            ccd_temp=0.0,
            set_temp=0.0,
            xpixsz=3.76,
            ypixsz=3.76,
            focallen=525.0,
            bayerpat="RGGB",
            readoutm="Low Noise",
        ),
    )

    # -----------------------------------------------------------------------
    # G. Poseidon-C PRO / NINA — raw BIAS (zero-length exposure)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/bias/poseidon-nina/bias_gain0_0001.fits",
        [
            _card("IMAGETYP", "Bias Frame", "frame type"),
            _card("EXPTIME", 0.0, "exposure time in seconds"),
            _card("EXPOSURE", 0.0, "exposure time in seconds"),
            _card("DATE-OBS", "2025-08-06T14:16:00.910", "start of observation UTC"),
        ]
        + nina_common_cards(
            instrume="Poseidon-C PRO",
            telescop="Celestron C925 HS",
            gain=0,
            offset=20,
            ccd_temp=-10.1,
            set_temp=-10.0,
            xpixsz=3.76,
            ypixsz=3.76,
            focallen=525.0,
            bayerpat="RGGB",
            readoutm="Low Noise",
        ),
    )

    # -----------------------------------------------------------------------
    # H. ZWO ASI2600MM Pro / NINA — raw DARK
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/dark/zwo-nina/dark_300s_gain0_0001.fits",
        [
            _card("IMAGETYP", "Dark Frame", "frame type"),
            _card("EXPTIME", 300.0, "exposure time in seconds"),
            _card("EXPOSURE", 300.0, "exposure time in seconds"),
            _card("DATE-OBS", "2025-05-30T22:00:00.000", "start of observation UTC"),
        ]
        + nina_common_cards(
            instrume="ZWO ASI2600MM Pro",
            telescop="APO 120",
            gain=0,
            offset=50,
            ccd_temp=5.1,
            set_temp=5.0,
            xpixsz=3.76,
            ypixsz=3.76,
            focallen=672.0,
            egain=0.768,
        ),
    )

    # -----------------------------------------------------------------------
    # I. Master DARK / FITS stripped — internal PlateVault format
    #    All metadata in filename; header is structural only.
    #    Filename: dark_exp_120.000000_gain_60_bin_1_44C_stack_9.fits
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/master/dark/stripped/dark_exp_120.000000_gain_60_bin_1_44C_stack_9.fits",
        [
            # No IMAGETYP, EXPTIME, GAIN, CCD-TEMP, INSTRUME — all stripped
            _card("BAYERPAT", "RGGB", "Bayer CFA pattern"),
        ],
        pixels_4x4=True,  # has pixel data but stripped header
    )

    # -----------------------------------------------------------------------
    # J. Master DARK / FITS — PixInsight/WBPP output style (DWARF III)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/master/dark/wbpp-dwarf3/masterDark_BIN-1_4x4_EXPOSURE-120.00s.fits",
        [
            _card("IMAGETYP", "Master Dark", "type of image"),
            _card("XBINNING", 1, "binning factor, horizontal axis"),
            _card("YBINNING", 1, "binning factor, vertical axis"),
            _card("FILTER", "", "filter used when taking image"),
            _card("EXPTIME", 120.0, "exposure time in seconds"),
            _card("INSTRUME", "DWARFIII", "name of instrument"),
            _card("BAYERPAT", "RGGB", "Bayer CFA pattern"),
            _card("XPIXSZ", 2.0, "pixel size X including binning (um)"),
            _card("YPIXSZ", 2.0, "pixel size Y including binning (um)"),
            _card("TELESCOP", "DWARFIII", "name of telescope"),
            _card("FOCALLEN", 150.0, "effective focal length (mm)"),
            _card("OBJECT", "", "observed object (empty for calibration)"),
            _card("DATE-OBS", "2025-07-05T10:38:14.819", "start of observation UTC"),
            _card("DATE-END", "2025-07-05T10:58:14.787", "end of observation UTC"),
            _card("EQUINOX", 2000.0, "epoch of coordinates"),
            # No GAIN, no CCD-TEMP/SET-TEMP in WBPP masters
        ],
    )

    # -----------------------------------------------------------------------
    # K. Master DARK / FITS — PixInsight/WBPP output style (Poseidon)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/master/dark/wbpp-poseidon/masterDark_BIN-1_EXPOSURE-120.00s_GAIN-0.fits",
        [
            _card("IMAGETYP", "Master Dark", "type of image"),
            _card("XBINNING", 1, "binning factor, horizontal axis"),
            _card("YBINNING", 1, "binning factor, vertical axis"),
            _card("FILTER", "", "filter used when taking image"),
            _card("EXPTIME", 120.0, "exposure time in seconds"),
            _card("INSTRUME", "Poseidon-C PRO", "name of instrument"),
            _card("BAYERPAT", "RGGB", "Bayer CFA pattern"),
            _card("XPIXSZ", 3.76, "pixel size X including binning (um)"),
            _card("YPIXSZ", 3.76, "pixel size Y including binning (um)"),
            _card("TELESCOP", "Celestron C925 HS", "name of telescope"),
            _card("FOCALLEN", 525.0, "effective focal length (mm)"),
            _card("DATE-OBS", "2025-08-06T15:27:42.432", "start of observation UTC"),
            _card("DATE-END", "2025-08-06T16:08:09.590", "end of observation UTC"),
            _card("OBSGEO-L", 55.383, "geodetic longitude of observation (deg)"),
            _card("OBSGEO-B", 24.839, "geodetic latitude of observation (deg)"),
            _card("OBSGEO-H", 101, "geodetic height of observation (m)"),
            _card("EQUINOX", 2000.0, "epoch of coordinates"),
        ],
    )

    # -----------------------------------------------------------------------
    # L. Master BIAS / FITS — PixInsight/WBPP output style (ZWO)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/master/bias/wbpp-zwo/masterBias_BIN-1_GAIN-0.fits",
        [
            _card("IMAGETYP", "Master Bias", "type of image"),
            _card("XBINNING", 1, "binning factor, horizontal axis"),
            _card("YBINNING", 1, "binning factor, vertical axis"),
            _card("GAIN", 0, "camera gain index"),
            _card("FILTER", "", "filter used when taking image"),
            _card("EXPTIME", 0.0, "exposure time in seconds"),
            _card("INSTRUME", "ZWO ASI2600MM Pro", "name of instrument"),
            _card("XPIXSZ", 3.76, "pixel size X including binning (um)"),
            _card("YPIXSZ", 3.76, "pixel size Y including binning (um)"),
            _card("EGAIN", 0.768, "electrons per ADU"),
            _card("TELESCOP", "APO 120", "name of telescope"),
            _card("FOCALLEN", 840.0, "effective focal length (mm)"),
            _card("DATE-OBS", "2024-12-01T06:44:56.317", "start of observation UTC"),
            _card("DATE-END", "2024-12-01T06:46:18.039", "end of observation UTC"),
            _card("EQUINOX", 2000.0, "epoch of coordinates"),
        ],
    )

    # -----------------------------------------------------------------------
    # M. Master BIAS / FITS stripped — DWARF III DwarfLab format
    #    Filename: bias_gain_2_bin_1.fits
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/master/bias/stripped/bias_gain_2_bin_1.fits",
        [
            # No IMAGETYP, EXPTIME, GAIN, INSTRUME — all stripped
            _card("BAYERPAT", "RGGB", "Bayer CFA pattern"),
        ],
        pixels_4x4=True,
    )

    # -----------------------------------------------------------------------
    # N. Master FLAT / FITS — NINA FlatWizard output (Poseidon, semi-full header)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/master/flat/nina-poseidon/master_flat_lum_gain125.fits",
        [
            _card("IMAGETYP", "FLAT", "frame type"),
            _card("EXPTIME", 1.1, "exposure time in seconds"),
            _card("EXPOSURE", 1.1, "exposure time in seconds"),
            _card("FILTER", "LUM", "filter used"),
            _card("FLAT_CNT", 25, "number of source flat frames"),
            _card("BIAS_CNT", 0, "number of source bias frames"),
            _card("OBJECT", "FlatWizard", "NINA FlatWizard identifier"),
            _card("DATE-OBS", "2025-10-05T02:02:45.298", "start of observation UTC"),
            _card("DATE-END", "2025-10-05T02:05:00.000", "end of observation UTC"),
        ]
        + nina_common_cards(
            instrume="Poseidon-C PRO",
            telescop="Celestron C925 HS",
            gain=125,
            offset=20,
            ccd_temp=0.2,
            set_temp=0.0,
            xpixsz=3.76,
            ypixsz=3.76,
            focallen=525.0,
            bayerpat="RGGB",
            readoutm="Low Noise",
        ),
    )

    # -----------------------------------------------------------------------
    # O. Stacked LIGHT / FITS — ZWO + ASIDeepStack (has STACKCNT)
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/master/light/asideepstack-zwo/Light_AutoSave_Stack.fits",
        [
            _card("IMAGETYP", "LIGHT", "frame type"),
            _card("OBJECT", "M 16", "observed target"),
            _card("FILTER", "OIII", "filter used"),
            _card("EXPTIME", 2700.0, "total exposure time (stack)"),
            _card("EXPOSURE", 300.0, "per-frame exposure time"),
            _card("STACKCNT", 9, "number of stacked frames"),
            _card("BAYERPAT", "NONE", "no Bayer pattern (mono stack)"),
            _card("DATE-OBS", "2026-05-15T00:05:12.127", "start of first frame UTC"),
            _card("DATE-END", "2026-05-15T00:51:12.127", "end of last frame UTC"),
            _card("SWCREATE", "ASIDeepStack", "stacking software"),
            _card("SWOWNER", "ZWO", "software vendor"),
        ]
        + nina_common_cards(
            instrume="ZWO ASI2600MM Pro",
            telescop="Celestron C925",
            gain=0,
            offset=50,
            ccd_temp=0.0,
            set_temp=0.0,
            xpixsz=3.76,
            ypixsz=3.76,
            focallen=1645.0,
            egain=0.768,
            swcreate="ASIDeepStack",
        ),
    )

    # -----------------------------------------------------------------------
    # P. Processed master LIGHT / FITS — PixInsight + GraXpert post-processing
    # -----------------------------------------------------------------------
    write_fits(
        f"{base}/master/light/pixinsight-graXpert/masterLight_FILTER-SII_GraXpert.fits",
        [
            _card("IMAGETYP", "Master Light", "type of image"),
            _card("OBJECT", "Jellyfish Nebula", "observed target"),
            _card("FILTER", "SII", "filter used"),
            _card("EXPTIME", 300.0, "per-frame exposure time in seconds"),
            _card("EGAIN", 0.242863, "electrons per ADU"),
            _card("INSTRUME", "ZWO ASI2600MM Pro", "camera"),
            _card("TELESCOP", "APO 120", "telescope"),
            _card("FOCALLEN", 669.421, "effective focal length (mm)"),
            _card("XPIXSZ", 3.76, "pixel size X (um)"),
            _card("YPIXSZ", 3.76, "pixel size Y (um)"),
            _card("XBINNING", 1, "binning X"),
            _card("YBINNING", 1, "binning Y"),
            _card("DATE-OBS", "2024-12-29T16:12:30.773", "start of observation UTC"),
            _card("DATE-END", "2024-12-29T19:41:47.512", "end of observation UTC"),
            _card("RA", 94.602, "RA of center (degrees)"),
            _card("DEC", 22.794, "Dec of center (degrees)"),
            _card("EQUINOX", 2000.0, "epoch of coordinates"),
            _card("LAT-OBS", 24.839, "geodetic latitude of observer (deg)"),
            _card("LONG-OBS", 55.383, "geodetic longitude of observer (deg)"),
            _card("ALT-OBS", 101, "geodetic height of observer (m)"),
            _card("BG-EXTR", "GraXpert", "background extraction tool"),
            _card("INTP-OPT", "AI", "interpolation option"),
            _card("TIMESYS", "UTC", "time system"),
        ],
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        default=os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "tests",
            "fixtures",
            "mock-fits-library",
        ),
        help="Output directory (default: tests/fixtures/mock-fits-library/)",
    )
    args = parser.parse_args()

    base = args.output_dir
    if os.path.exists(base):
        shutil.rmtree(base)
    os.makedirs(base)

    print(f"Generating mock FITS library in: {base}")
    generate_library(base)

    # Count results
    count = sum(1 for _, _, files in os.walk(base) for f in files if f.endswith((".fits", ".fit")))
    print(f"\nDone — {count} mock FITS files generated.")


if __name__ == "__main__":
    main()
