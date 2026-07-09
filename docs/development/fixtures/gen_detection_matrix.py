#!/usr/bin/env python3
"""Generate a comprehensive master/frame-type detection fixture library.

Covers every permutation the PlateVault master-detector cares about
(spec 040), across REALISTIC astrophotography directory + file naming:

    {light, dark, flat, bias, darkflat} x {raw, master}
      x {header-based, path-based, header-vs-name conflict}

Detection model under test (header-FIRST, path/name as fallback):
  * frame type   = IMAGETYP (parse_frame_type); PixInsight infers type from
                   the path ONLY when IMAGETYP is absent AND the path signals a
                   master. Siril requires IMAGETYP. A RAW frame with no IMAGETYP
                   is (correctly) unclassifiable.
  * is_master    = IMAGETYP contains "master" (PixInsight)
                   OR STACKCNT/NCOMBINE > 1 (Siril)
                   OR file name / path contains "master" or "_stacked" (fallback)

Writes minimal-but-valid FITS (1x1 uint8 image) carrying the header cards that
matter, plus a manifest.json of expected (frame_type, is_master, evidence).

Usage:
    python3 gen_detection_matrix.py <output_dir>
    # e.g. from WSL, targeting the Windows test drive:
    python3 gen_detection_matrix.py "/mnt/d/astrophotography/ALM test/DetectionMatrix"

The tree is designed to be REGISTERED and SCANNED by the real app to re-verify
issues #513 (scan preview) and #514 (detection coverage). See EXPECTED-MATRIX.md.
"""
import json
import os
import sys

BLOCK = 2880


def _card(key, value, comment=""):
    if isinstance(value, bool):
        body = f"{key:<8}= {'T' if value else 'F':>20}"
    elif isinstance(value, int):
        body = f"{key:<8}= {value:>20}"
    else:  # string -> FITS quoted, min 8 chars inside quotes
        q = f"'{value:<8}'"
        body = f"{key:<8}= {q:<20}"
    if comment:
        body = f"{body} / {comment}"
    return f"{body:<80}"[:80]


def write_fits(path, imagetyp=None, stackcnt=None, extra=None):
    """Write a tiny valid FITS with an optional IMAGETYP / STACKCNT card."""
    cards = [
        _card("SIMPLE", True, "conforms to FITS standard"),
        _card("BITPIX", 8),
        _card("NAXIS", 2),
        _card("NAXIS1", 1),
        _card("NAXIS2", 1),
    ]
    if imagetyp is not None:
        cards.append(_card("IMAGETYP", imagetyp, "Type of exposure"))
    if stackcnt is not None:
        cards.append(_card("STACKCNT", stackcnt, "Number of stacked frames"))
    for k, v in (extra or {}).items():
        cards.append(_card(k, v))
    cards.append(f"{'END':<80}")
    header = "".join(cards)
    header += " " * ((BLOCK - len(header) % BLOCK) % BLOCK)
    data = b"\x00"
    data += b"\x00" * ((BLOCK - len(data) % BLOCK) % BLOCK)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(data)


# (relative_path, imagetyp, stackcnt, expected_type, expected_master, evidence)
# Realistic capture-software / WBPP / Siril style names & folders.
CASES = [
    # ── LIGHTS ────────────────────────────────────────────────────────────────
    ("Lights/M 51/2025-05-03/LUM/M 51_Light_LUM_2025-05-03_180.00s_0000.fits",
     "LIGHT", None, "Light", False, "header"),
    ("Lights/M 51/2025-05-03/LUM/M 51_Light_LUM_2025-05-03_180.00s_0001.fits",
     "LIGHT", None, "Light", False, "header"),
    # master light (integration) — header via STACKCNT
    ("Processed/M 51/M 51_LUM_integration.xisf",
     "LIGHT", 60, "Light", True, "header:stackcnt"),

    # ── DARKS ─────────────────────────────────────────────────────────────────
    ("Calibration/Darks/2025-05-03/Dark_300.00s_gain100_-10C_0000.fits",
     "DARK", None, "Dark", False, "header"),
    # master dark — Siril style (base IMAGETYP + STACKCNT)
    ("Calibration/Masters/masterDark_300s_gain100_-10C.fits",
     "DARK", 30, "Dark", True, "header:stackcnt"),
    # master dark — PixInsight/WBPP style (IMAGETYP='Master Dark')
    ("Calibration/Masters/masterDark_180s.xisf",
     "Master Dark", None, "Dark", True, "header:imagetyp"),
    # master dark — PATH fallback (NO header; name+path say master)
    ("Calibration/Masters/masterDarks/masterDark_600s.fits",
     None, None, "Dark", True, "path"),

    # ── FLATS ─────────────────────────────────────────────────────────────────
    ("Calibration/Flats/2025-05-03/LUM/Flat_LUM_2.50s_0000.fits",
     "FLAT", None, "Flat", False, "header"),
    ("Calibration/Masters/masterFlat_LUM.xisf",
     "Master Flat", None, "Flat", True, "header:imagetyp"),
    ("Calibration/Masters/masterFlat_Ha_siril.fit",
     "FLAT", 25, "Flat", True, "header:stackcnt"),
    # PATH fallback via _stacked suffix, no header
    ("Calibration/Flats/flat_Ha_stacked.fit",
     None, None, "Flat", True, "path:_stacked"),

    # ── BIAS ──────────────────────────────────────────────────────────────────
    ("Calibration/Bias/Bias_0.00s_gain100_0000.fits",
     "BIAS", None, "Bias", False, "header"),
    ("Calibration/Masters/masterBias.xisf",
     "Master Bias", None, "Bias", True, "header:imagetyp"),
    # offset synonym -> Bias, master via stackcnt
    ("Calibration/Masters/masterOffset_gain100.fits",
     "OFFSET", 100, "Bias", True, "header:stackcnt+offset-synonym"),

    # ── DARK FLATS ────────────────────────────────────────────────────────────
    ("Calibration/DarkFlats/DarkFlat_2.50s_0000.fits",
     "DARKFLAT", None, "DarkFlat", False, "header"),
    ("Calibration/Masters/masterDarkFlat.xisf",
     "Master DarkFlat", None, "DarkFlat", True, "header:imagetyp"),

    # ── HEADER-vs-NAME CONFLICT (header type MUST win) ────────────────────────
    # IMAGETYP='DARK' but file name says masterFlat -> Dark (header) + master (name)
    ("Conflicts/masterFlat_but_header_dark.fits",
     "DARK", None, "Dark", True, "conflict:header-type-wins,name-master"),
    # IMAGETYP='BIAS' but name says light -> Bias (header), not master
    ("Conflicts/light_named_but_header_bias.fits",
     "BIAS", None, "Bias", False, "conflict:header-type-wins"),

    # ── NEGATIVE: raw with no header + non-master name -> UNCLASSIFIED ────────
    # (documents the real "stripped-header master dark" case that hid in #513)
    ("Unknown/dark_stack_9_noheader.fits",
     None, None, None, None, "unclassified:no-imagetyp,non-master-name"),
]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    out = sys.argv[1]
    manifest = []
    for rel, imagetyp, stackcnt, etype, emaster, evidence in CASES:
        path = os.path.join(out, rel.replace("/", os.sep))
        write_fits(path, imagetyp=imagetyp, stackcnt=stackcnt)
        manifest.append({
            "path": rel,
            "imagetyp": imagetyp,
            "stackcnt": stackcnt,
            "expected_frame_type": etype,
            "expected_is_master": emaster,
            "evidence": evidence,
        })
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"wrote {len(CASES)} fixtures + manifest.json under {out}")


if __name__ == "__main__":
    main()
