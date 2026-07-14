#!/usr/bin/env python3

# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""Generate a COMPREHENSIVE master/frame-type detection fixture library (spec 040).

Exhaustive permutation coverage with REALISTIC astrophotography directory + file
naming (target / date / filter trees; capture-, WBPP-, Siril-style names), and
MULTIPLE files per cell so multi-file / multi-sub session detection is exercised.

Axes:
  * frame type      : light, dark, flat, bias, darkflat
  * master-ness     : raw, master
  * detection mode  : header-based, file/path-based, negative (unclassifiable)
  * signal variants : IMAGETYP primary + synonyms; STACKCNT vs NCOMBINE;
                      STACKCNT==1 (raw); IMAGETYP 'Master X' (PI); path name /
                      "_stacked" suffix / master directory; case variants
  * format          : .fits / .fit / .fts / .xisf (woven across cells)
  * conflict        : header type vs misleading name (header MUST win)

Detection model under test (header-FIRST; path/name is a MASTER-only fallback):
  type  = IMAGETYP (parse_frame_type). Path infers type ONLY when IMAGETYP is
          absent AND the path signals a master. => a RAW with no IMAGETYP is
          UNCLASSIFIABLE regardless of its name (that's the point of the negative
          "file-based raw" cells).
  master= IMAGETYP contains "master" (PI) OR STACKCNT/NCOMBINE > 1 (Siril)
          OR name/path contains "master" or "_stacked" (fallback).

Usage:
    python3 gen_detection_matrix.py "/mnt/d/astrophotography/ALM test/DetectionMatrix"

Writes the tree + manifest.json (expected (frame_type, is_master, evidence,
group) per file). Do NOT commit the generated binary FITS — only this generator.
See README.md for the retry/verify procedure (issues #513 / #514).
"""
import itertools
import json
import os
import sys

BLOCK = 2880
DATE = "2025-05-03"

# tune multiplicity here
N_RAW_HEADER = 4       # raw subs per type (header positive) — multi-file session
N_RAW_NEG = 3          # raw subs per type (no header, type-token name) — negative
N_MASTER_PATH = 2      # masters per type via path fallback

TYPES = {
    "Light":    {"primary": "LIGHT",    "synonyms": ["Light Frame", "SCIENCE"], "pi": "Master Light",    "exp": "180.00s"},
    "Dark":     {"primary": "DARK",     "synonyms": ["Dark Frame"],             "pi": "Master Dark",     "exp": "300.00s"},
    "Flat":     {"primary": "FLAT",     "synonyms": ["Flat Field"],             "pi": "Master Flat",     "exp": "2.50s"},
    "Bias":     {"primary": "BIAS",     "synonyms": ["OFFSET", "Bias Frame"],   "pi": "Master Bias",     "exp": "0.00s"},
    "DarkFlat": {"primary": "DARKFLAT", "synonyms": ["Dark Flat"],              "pi": "Master DarkFlat", "exp": "2.50s"},
}
FILTERS = {"Light": "LUM", "Flat": "LUM", "DarkFlat": "LUM"}
_ext_cycle = itertools.cycle([".fits", ".fit", ".fts", ".xisf"])


def _card(key, value, comment=""):
    if isinstance(value, bool):
        body = f"{key:<8}= {'T' if value else 'F':>20}"
    elif isinstance(value, int):
        body = f"{key:<8}= {value:>20}"
    else:
        q = f"'{value:<8}'"
        body = f"{key:<8}= {q:<20}"
    if comment:
        body = f"{body} / {comment}"
    return f"{body:<80}"[:80]


def write_fits(path, imagetyp=None, stackcnt=None, ncombine=None):
    cards = [_card("SIMPLE", True), _card("BITPIX", 8), _card("NAXIS", 2),
             _card("NAXIS1", 1), _card("NAXIS2", 1)]
    if imagetyp is not None:
        cards.append(_card("IMAGETYP", imagetyp, "Type of exposure"))
    if stackcnt is not None:
        cards.append(_card("STACKCNT", stackcnt, "stacked frames"))
    if ncombine is not None:
        cards.append(_card("NCOMBINE", ncombine, "combined frames"))
    cards.append(f"{'END':<80}")
    header = "".join(cards)
    header += " " * ((BLOCK - len(header) % BLOCK) % BLOCK)
    data = b"\x00" + b"\x00" * (BLOCK - 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(data)


CASES = []  # (relpath, imagetyp, stackcnt, ncombine, exp_type, exp_master, evidence, group)


def add(rel, imagetyp, stackcnt, ncombine, etype, emaster, evidence, group):
    CASES.append((rel, imagetyp, stackcnt, ncombine, etype, emaster, evidence, group))


for tname, t in TYPES.items():
    prim, syns, pi, exp = t["primary"], t["synonyms"], t["pi"], t["exp"]
    filt = FILTERS.get(tname, "NA")
    low = tname.lower()

    # ── RAW + HEADER (positive), multiple subs in one realistic session ──────
    if tname == "Light":
        base = f"Lights/M 51/{DATE}/{filt}"
        stem = f"M 51_Light_{filt}_{DATE}_{exp}"
    else:
        base = f"Calibration/{tname}s/{DATE}"
        stem = f"{tname}_{exp}_gain100_-10C"
    grp = f"{tname}:raw-header"
    for i in range(N_RAW_HEADER):
        add(f"{base}/{stem}_{i:04d}{next(_ext_cycle)}", prim, None, None,
            tname, False, "header:primary", grp)
    # a couple more using each synonym IMAGETYP
    for j, syn in enumerate(syns):
        add(f"{base}/{stem}_syn{j}{next(_ext_cycle)}", syn, None, None,
            tname, False, f"header:synonym={syn!r}", grp)
    # STACKCNT==1 must NOT be a master (still raw)
    add(f"{base}/{stem}_stackcnt1{next(_ext_cycle)}", prim, 1, None,
        tname, False, "header:stackcnt=1-not-master", grp)

    # ── RAW + FILE/NAME-BASED = NEGATIVE (no header, type token in name) ─────
    grp = f"{tname}:raw-nameonly-NEGATIVE"
    for i in range(N_RAW_NEG):
        add(f"Unsorted/{DATE}/{low}_sub_{i:04d}{next(_ext_cycle)}", None, None, None,
            None, None, "negative:no-imagetyp-raw(name-must-not-classify)", grp)

    # ── MASTER + HEADER (Siril STACKCNT and NCOMBINE) ────────────────────────
    grp = f"{tname}:master-header"
    add(f"Calibration/Masters/master{tname}_stackcnt{next(_ext_cycle)}", prim, 30, None,
        tname, True, "header:stackcnt", grp)
    add(f"Calibration/Masters/master{tname}_ncombine{next(_ext_cycle)}", prim, None, 25,
        tname, True, "header:ncombine", grp)
    # ── MASTER + HEADER (PixInsight 'Master X'), incl. a case variant ────────
    add(f"Calibration/Masters/master{tname}{next(_ext_cycle)}", pi, None, None,
        tname, True, "header:imagetyp-master", grp)
    add(f"Calibration/Masters/master{tname}_lc{next(_ext_cycle)}", pi.lower(), None, None,
        tname, True, "header:imagetyp-master(case)", grp)

    # ── MASTER + PATH FALLBACK (no header): name, dir, _stacked ──────────────
    grp = f"{tname}:master-path"
    for i in range(N_MASTER_PATH):
        add(f"Calibration/Masters/master{tname}s/master{tname}_{chr(65+i)}{next(_ext_cycle)}",
            None, None, None, tname, True, "path:name+dir=master", grp)
    add(f"Processed/{low}_{filt}_stacked{next(_ext_cycle)}", None, None, None,
        tname, True, "path:_stacked-suffix", grp)

    # ── MASTER NEGATIVE: stack card but no IMAGETYP and no master path ───────
    add(f"Unsorted/integration_{low}_{DATE}{next(_ext_cycle)}", None, 30, None,
        None, None, "negative:stackcnt-no-imagetyp-no-masterpath", f"{tname}:master-NEGATIVE")

# ── GLOBAL: header-vs-name CONFLICT (header type MUST win) ───────────────────
add("Conflicts/masterFlat_named_but_header_DARK.fits", "DARK", None, None,
    "Dark", True, "conflict:header-type-wins;name=masterFlat=>master", "conflict")
add("Conflicts/light_named_but_header_BIAS.fits", "BIAS", None, None,
    "Bias", False, "conflict:header-type-wins;name=light", "conflict")
add("Conflicts/dark_named_header_FLAT_stackcnt.fit", "FLAT", 5, None,
    "Flat", True, "conflict:header-type-wins;stackcnt=master", "conflict")

# ── GLOBAL: unknown / empty IMAGETYP => unclassified ─────────────────────────
add("Unknown/junk_imagetyp.fits", "JUNKTYPE", None, None,
    None, None, "negative:unknown-imagetyp-value", "unknown")
add("Unknown/no_header_neutral.fits", None, None, None,
    None, None, "negative:no-imagetyp-neutral-name", "unknown")
# reproduces the exact stripped-header 'master dark' that hid in #513
add("Unknown/dark_exp_120_stack_9_stripped.fits", None, None, None,
    None, None, "negative:stripped-header-master(reproduces #513)", "unknown")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    out = sys.argv[1]
    manifest = []
    for rel, imagetyp, stackcnt, ncombine, etype, emaster, evidence, group in CASES:
        write_fits(os.path.join(out, rel.replace("/", os.sep)),
                   imagetyp=imagetyp, stackcnt=stackcnt, ncombine=ncombine)
        manifest.append({"path": rel, "imagetyp": imagetyp, "stackcnt": stackcnt,
                         "ncombine": ncombine, "expected_frame_type": etype,
                         "expected_is_master": emaster, "evidence": evidence,
                         "group": group})
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    # summary by group
    from collections import Counter
    by_group = Counter(m["group"] for m in manifest)
    print(f"wrote {len(CASES)} fixtures + manifest.json under {out}")
    for g, c in sorted(by_group.items()):
        print(f"  {c:3d}  {g}")


if __name__ == "__main__":
    main()
