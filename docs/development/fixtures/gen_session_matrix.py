#!/usr/bin/env python3
"""Generate a SESSION + CALIBRATION-MATCHING fixture library for PlateVault.

Sibling of ``gen_detection_matrix.py`` (which exercises frame-type / master
*detection*). This generator exercises the next two pipeline stages:

  * SESSION GROUPING — a light session is FIXED on
    ``object | filter | binning | gain | observing_night`` (+ camera + offset).
    Only sensor temperature drifts within a session. The matrix emits
    must-split siblings (change exactly one key field) and must-NOT-split
    members (temp drift + sub-1s exposure bucketing) so the grouper can be
    checked against a machine-readable answer key.
  * CALIBRATION MATCHING — per calibration type, a raw sub-set plus masters in
    every real-world flavor (Siril STACKCNT / NCOMBINE, PixInsight ``Master X``
    header, a REAL XISF container with the focal-length carried as an SI-metres
    ``<Property>``, and an internal STRIPPED master whose metadata lives only in
    the filename). Dark/bias/flat variants carry the expected matcher verdict
    (match / soft:<dim> / excluded:<dim>).

Writer mechanics mirror the strict readers in ``crates/metadata/{fits,xisf}``:
FITS 80-byte cards (string values single-quoted from col 11, numerics
right-justified to col 30, END + 2880-pad + one zero data block); XISF a real
``XISF0100`` container (u32-LE XML length, iterated ``attachment`` offset).
The same ``meta_to_cards`` step feeds both FITS and XISF so a field is emitted
identically in either format.

Header values (camera dims, keyword dialects per NINA / DwarfLab / PixInsight)
follow ``docs/development/077-fits-header-analysis.md``.

Usage:
    python3 gen_session_matrix.py "/mnt/d/astrophotography/ALM test/SessionMatrix"

Writes the tree + ``manifest.json`` (expected frame type, master-ness, session
group, and calibration verdicts per file), self-verifies three re-read files,
then prints a per-group count summary. Idempotent: the output dir is wiped and
rebuilt on each run. Do NOT commit the generated binaries — only this generator
and its README. See SESSION_MATRIX_README.md.
"""
import json
import os
import re
import struct
import sys
from collections import Counter
from datetime import datetime, timedelta

BLOCK = 2880
N1 = "2025-05-03"
N2 = "2025-05-10"

# ── Rigs (docs/development/077) ─────────────────────────────────────────────
# offset_pool / gain / temperature are deliberately NOT fixed per camera — the
# session matrix mixes them across camera blocks.
RIGS = {
    "R1": {  # ZWO ASI2600MM Pro — mono, full NINA header
        "instrume": "ZWO ASI2600MM Pro", "telescop": "APO 120",
        "focal_length_mm": 840, "pixel_size_um": 3.76,
        "naxis1": 6248, "naxis2": 4176, "profile": "nina",
        "bayerpat": None, "egain": 0.24, "readout": "High Gain",
        "site": (25.077, 55.120, 3),
    },
    "R2": {  # Poseidon-C PRO — OSC (RGGB), full NINA header
        "instrume": "Poseidon-C PRO", "telescop": "Celestron C925 HS",
        "focal_length_mm": 525, "pixel_size_um": 3.76,
        "naxis1": 6252, "naxis2": 4176, "profile": "nina",
        "bayerpat": "RGGB", "egain": None, "readout": "Low Noise",
        "site": (24.839, 55.383, 101),
    },
    "R3": {  # DWARF 3 — sparse DwarfLab header (no IMAGETYP/FILTER, DET-TEMP)
        "instrume": "DWARF 3", "telescop": "DWARF 3",
        "focal_length_mm": 150, "pixel_size_um": 2.0,
        "naxis1": 3856, "naxis2": 2180, "profile": "dwarflab",
        "bayerpat": "RGGB", "egain": None, "readout": None,
        "site": None, "origin": "DWARFLAB",
    },
}

TARGETS = {  # OBJECT -> (RA deg, Dec deg)
    "M 51": (202.4696, 47.1952),
    "M 16": (274.700, -13.807),
    "NGC 7000": (314.75, 44.36),
    "NGC 2264": (100.242, 9.895),
    "M 42": (83.822, -5.391),
}

# Master flavors and the properties block for the REAL-XISF flavor. 0.840 m is
# read back as 840 mm via the metres->mm XISF Property path; 3.76 um pixel size.
FLV_STACKCNT = "STACKCNT-FITS"
FLV_NCOMBINE = "NCOMBINE-FITS"
FLV_MASTERTYP = "MASTER-IMAGETYP-FITS"
FLV_XISF = "REAL-XISF"
FLV_STRIPPED = "STRIPPED-FILENAME-FITS"
ALL_FLAVORS = [FLV_STACKCNT, FLV_NCOMBINE, FLV_MASTERTYP, FLV_XISF, FLV_STRIPPED]

XISF_PROPS_R1 = (
    '<Property id="Instrument:Telescope:FocalLength" type="Float64" value="0.840"/>'
    '<Property id="Image:PixelSize" type="Float64" value="3.76"/>'
)

BASE_TYP = {"Dark": "DARK", "Bias": "BIAS", "Flat": "FLAT", "DarkFlat": "DARKFLAT"}
MASTER_TYP = {k: f"Master {k}" for k in BASE_TYP}
PLURAL = {"Dark": "Darks", "Bias": "Biases", "Flat": "Flats", "DarkFlat": "DarkFlats"}

# CCD temp drift within a session: a few tenths off the set point. First three
# match the S0 spec (-10.0 / -9.6 / -10.4 for set_temp -10).
DRIFT = [0.0, 0.4, -0.4, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.15]

CASES = []  # manifest rows
SELFCHECK = {}  # captured relpaths for the re-read verification pass


# ── Number / card formatting ────────────────────────────────────────────────

def fmt_num(v):
    if isinstance(v, bool):
        return "T" if v else "F"
    if isinstance(v, int):
        return str(v)
    return repr(float(v))


def fmt_val(v, is_string):
    return str(v) if is_string else fmt_num(v)


def card(key, sval, is_string, comment=""):
    """One 80-byte FITS card. Strings quoted from col 11 (padded >=8 inside the
    quotes); numerics right-justified to col 30."""
    if is_string:
        body = f"{key:<8}= '{sval:<8}'"
    else:
        body = f"{key:<8}= {sval:>20}"
    if comment:
        body = f"{body} / {comment}"
    return f"{body:<80}"[:80]


def structural_cards(naxis1, naxis2):
    return [
        card("SIMPLE", "T", False, "conforms to FITS standard"),
        card("BITPIX", "8", False),
        card("NAXIS", "2", False),
        card("NAXIS1", str(naxis1), False, "camera pixels (metadata only)"),
        card("NAXIS2", str(naxis2), False, "camera pixels (metadata only)"),
    ]


# ── Shared meta -> cards (identical field set for FITS and XISF) ─────────────

def meta_to_cards(m):
    """Return an ordered list of (keyword, formatted_value, is_string, comment).

    Only present (non-None) fields are emitted. EXPTIME is mirrored to EXPOSURE
    and XPIXSZ to YPIXSZ, matching how capture software writes both.
    """
    out = []

    def add(key, field, is_string, comment=""):
        if m.get(field) is not None:
            out.append((key, fmt_val(m[field], is_string), is_string, comment))

    add("IMAGETYP", "image_typ", True, "Frame type")
    add("FILTER", "filter", True, "Filter")
    add("OBJECT", "object", True, "Target")
    if m.get("exposure") is not None:
        v = fmt_val(m["exposure"], False)
        out.append(("EXPTIME", v, False, "[s] exposure"))
        out.append(("EXPOSURE", v, False, "[s] exposure"))
    add("GAIN", "gain", False, "camera gain")
    add("XBINNING", "x_binning", False)
    add("YBINNING", "y_binning", False)
    add("INSTRUME", "instrume", True, "camera")
    add("TELESCOP", "telescop", True, "telescope")
    add("DATE-OBS", "date_obs", True, "UTC start")
    add("DATE-END", "date_end", True, "UTC end")
    add("DATE-LOC", "date_loc", True, "local time")
    add("STACKCNT", "stack_count", False, "stacked frames")
    add("NCOMBINE", "ncombine", False, "combined frames")
    add("OFFSET", "offset", False, "pedestal")
    add("SET-TEMP", "set_temp_c", False, "[degC] set temp")
    add("CCD-TEMP", "ccd_temp_c", False, "[degC] sensor temp")
    add("DET-TEMP", "det_temp_c", False, "[degC] detector temp")
    add("RA", "ra_deg", False, "[deg] RA")
    add("DEC", "dec_deg", False, "[deg] Dec")
    add("ROTATANG", "rotator_angle_deg", False, "[deg] rotator")
    add("OBJCTROT", "sky_rotation_deg", False, "[deg] sky PA")
    add("READOUTM", "readout_mode", True, "readout mode")
    add("FOCALLEN", "focal_length_mm", False, "[mm] focal length")
    if m.get("pixel_size_um") is not None:
        v = fmt_val(m["pixel_size_um"], False)
        out.append(("XPIXSZ", v, False, "[um] pixel"))
        out.append(("YPIXSZ", v, False, "[um] pixel"))
    add("SITELAT", "observer_lat", False, "[deg]")
    add("SITELONG", "observer_long", False, "[deg]")
    add("SITEELEV", "observer_elev", False, "[m]")
    add("MJD-OBS", "mjd_obs", False, "MJD start")
    add("BAYERPAT", "bayerpat", True, "CFA pattern")
    add("EGAIN", "egain", False, "e-/ADU")
    add("ORIGIN", "origin", True, "creator")
    return out


# ── Writers ─────────────────────────────────────────────────────────────────

def ensure_dir(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)


def write_fits(path, meta_cards, naxis1, naxis2):
    cards = structural_cards(naxis1, naxis2)
    cards += [card(k, v, s, c) for (k, v, s, c) in meta_cards]
    header = "".join(cards) + f"{'END':<80}"
    header += " " * ((BLOCK - len(header) % BLOCK) % BLOCK)
    ensure_dir(path)
    with open(path, "wb") as f:
        f.write(header.encode("ascii"))
        f.write(b"\x00" * BLOCK)


XISF_SIG = b"XISF0100"
_XML_TMPL = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    'xsi:schemaLocation="http://www.pixinsight.com/xisf '
    'http://pixinsight.com/xisf/xisf-1.0.xsd">'
    '<Image geometry="1:1:1" sampleFormat="Float32" colorSpace="Gray" '
    'bounds="0:1" location="attachment:{off}:4">{kw}{props}</Image></xisf>'
)


def _xesc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _fitskeyword_xml(key, sval, is_string):
    # Strings are single-quote wrapped inside value= (the reader strips one
    # layer); numerics are bare.
    val = f"'{sval}'" if is_string else sval
    return f'<FITSKeyword name="{key}" value="{_xesc(val)}" comment=""/>'


def write_xisf(path, meta_cards, props_xml):
    kw = "".join(_fitskeyword_xml(k, v, s) for (k, v, s, _c) in meta_cards)
    # dataOffset = 16 + len(xml); its digit count feeds back into xml length, so
    # iterate to a fixed point.
    off = 16
    xml_bytes = b""
    for _ in range(8):
        xml = _XML_TMPL.format(off=off, kw=kw, props=props_xml)
        xml_bytes = xml.encode("utf-8")
        nxt = 16 + len(xml_bytes)
        if nxt == off:
            break
        off = nxt
    header = XISF_SIG + struct.pack("<I", len(xml_bytes)) + b"\x00\x00\x00\x00" + xml_bytes
    ensure_dir(path)
    with open(path, "wb") as f:
        f.write(header)
        f.write(b"\x00\x00\x00\x00")  # 4-byte attachment
    return off, len(xml_bytes)


# ── Emit + manifest ─────────────────────────────────────────────────────────

def _clean_fields(m):
    return {k: v for k, v in m.items() if v is not None}


def emit(rel, fmt, meta, *, profile, frame_type, is_master, group,
         session_group=None, matches=None, master_flavor=None,
         structural_only=False, props="", fields=None, note=None,
         naxis=("R1",)):
    """Write one fixture and append its manifest row. ``naxis`` is a 1-tuple of
    the rig id whose camera dimensions to stamp."""
    n1, n2 = RIGS[naxis[0]]["naxis1"], RIGS[naxis[0]]["naxis2"]
    abspath = os.path.join(OUT, rel.replace("/", os.sep))
    meta_cards = [] if structural_only else meta_to_cards(meta)
    if fmt == "fits":
        write_fits(abspath, meta_cards, n1, n2)
    else:
        write_xisf(abspath, meta_cards, props)
    row = {
        "path": rel, "format": fmt, "profile": profile,
        "master_flavor": master_flavor,
        "fields": fields if fields is not None else _clean_fields(meta),
        "expected_frame_type": frame_type,
        "expected_is_master": is_master,
        "expected_session_group": session_group,
        "expected_matches": matches or [],
        "group": group,
    }
    if note:
        row["note"] = note
    CASES.append(row)
    return rel


# ── Time helpers ────────────────────────────────────────────────────────────

_EPOCH = datetime(1858, 11, 17)


def _iso_ms(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}"


def obs_times(night, i, exptime, start_utc_hour=18, gap=8.0, loc_off_h=4):
    """UTC start advancing per sub; local (DATE-LOC) = UTC + 4h so the evening
    session at ~22:00 local keeps observing_night == ``night``."""
    base = datetime.fromisoformat(f"{night}T{start_utc_hour:02d}:00:00")
    start = base + timedelta(seconds=i * (exptime + gap))
    end = start + timedelta(seconds=exptime)
    loc = start + timedelta(hours=loc_off_h)
    mjd = round((start - _EPOCH).total_seconds() / 86400.0, 5)
    return _iso_ms(start), _iso_ms(end), _iso_ms(loc), mjd


# ── Equipment meta ──────────────────────────────────────────────────────────

def rig_equip(rig):
    r = RIGS[rig]
    m = {"instrume": r["instrume"], "telescop": r["telescop"],
         "focal_length_mm": r["focal_length_mm"], "pixel_size_um": r["pixel_size_um"]}
    if r.get("bayerpat"):
        m["bayerpat"] = r["bayerpat"]
    if r.get("egain") is not None:
        m["egain"] = r["egain"]
    if r.get("readout"):
        m["readout_mode"] = r["readout"]
    if r.get("origin"):
        m["origin"] = r["origin"]
    if r.get("site"):
        lat, lon, elev = r["site"]
        m.update(observer_lat=lat, observer_long=lon, observer_elev=elev)
    return m


def light_key(obj, filt, binning, gain, night):
    return f"{obj}|{filt or ''}|{binning}|{gain}|{night}"


# ── Session matrix (lights) ─────────────────────────────────────────────────

LIGHT_SESSIONS = [
    dict(label="S0", rig="R1", obj="M 51", filt="L", gain=100, binning=1,
         offset=50, set_temp=-10, exptime=300, rotang=90.0, night=N1, n=8, extra304=2),
    dict(label="split-filter-R", rig="R1", obj="M 51", filt="R", gain=100, binning=1,
         offset=50, set_temp=-10, exptime=300, rotang=90.0, night=N1, n=4),
    dict(label="split-gain-0", rig="R1", obj="M 51", filt="L", gain=0, binning=1,
         offset=50, set_temp=-10, exptime=300, rotang=90.0, night=N1, n=4),
    dict(label="split-bin-2", rig="R1", obj="M 51", filt="L", gain=100, binning=2,
         offset=20, set_temp=-10, exptime=300, rotang=90.0, night=N1, n=4),
    dict(label="split-night-N2", rig="R1", obj="M 51", filt="L", gain=100, binning=1,
         offset=20, set_temp=-10, exptime=300, rotang=90.0, night=N2, n=4),
    dict(label="split-target-M16", rig="R1", obj="M 16", filt="L", gain=100, binning=1,
         offset=50, set_temp=-10, exptime=300, rotang=90.0, night=N1, n=4),
    dict(label="lrgb-G", rig="R1", obj="M 51", filt="G", gain=100, binning=1,
         offset=50, set_temp=-10, exptime=300, rotang=90.0, night=N1, n=4),
    dict(label="lrgb-B", rig="R1", obj="M 51", filt="B", gain=100, binning=1,
         offset=50, set_temp=-10, exptime=300, rotang=90.0, night=N1, n=4),
    # Cross-camera Sx: same 5 key fields as S0, camera R2 -> canonical key
    # collides with S0 (see note); inbox grouping would split on optic_train.
    dict(label="Sx-crosscam-R2", rig="R2", obj="M 51", filt="L", gain=100, binning=1,
         offset=20, set_temp=-10, exptime=300, rotang=90.0, night=N1, n=4,
         ambiguous=True),
]


def build_light_sub(sess, i, exptime):
    rig, obj, filt = sess["rig"], sess["obj"], sess["filt"]
    ra, dec = TARGETS[obj]
    do, de, dl, mjd = obs_times(sess["night"], i, exptime)
    m = rig_equip(rig)
    m.update(
        image_typ="LIGHT", filter=filt, object=obj, exposure=float(exptime),
        gain=sess["gain"], x_binning=sess["binning"], y_binning=sess["binning"],
        offset=sess["offset"], set_temp_c=float(sess["set_temp"]),
        ccd_temp_c=round(sess["set_temp"] + DRIFT[i % len(DRIFT)], 2),
        ra_deg=ra, dec_deg=dec, rotator_angle_deg=sess["rotang"],
        date_obs=do, date_end=de, date_loc=dl, mjd_obs=mjd,
    )
    return m


def gen_lights():
    for sess in LIGHT_SESSIONS:
        key = light_key(sess["obj"], sess["filt"], sess["binning"], sess["gain"], sess["night"])
        ambiguous = sess.get("ambiguous", False)
        note = None
        if ambiguous:
            note = ("canonical session key ignores camera (== S0); inbox grouping "
                    "splits on optic_train (R2 optic != R1 optic)")
        base = f"Lights/{sess['obj']}/{sess['night']}/{sess['filt']}"
        # rig + offset in the stem so sessions that share a folder (e.g. S0 and
        # the cross-camera Sx, which share object/night/filter) never collide.
        stem = (f"{sess['obj']}_{sess['rig']}_{sess['filt']}_{sess['exptime']}s_"
                f"gain{sess['gain']}_bin{sess['binning']}_off{sess['offset']}_{sess['night']}")
        # main subs at the session exposure
        for i in range(sess["n"]):
            m = build_light_sub(sess, i, sess["exptime"])
            rel = emit(f"{base}/{stem}_{i:03d}.fits", "fits", m,
                       profile=RIGS[sess["rig"]]["profile"], frame_type="Light",
                       is_master=False, group=f"light:{sess['label']}",
                       session_group=key, note=note, naxis=(sess["rig"],))
            if sess["label"] == "S0" and i == 0:
                SELFCHECK["fits_full"] = rel
        # MUST-NOT-SPLIT: 2 extra S0 subs at 300.4s (within a 1s exposure bucket)
        for j in range(sess.get("extra304", 0)):
            i = sess["n"] + j
            m = build_light_sub(sess, i, 300.4)
            emit(f"{base}/{stem}_bucket_{j:03d}.fits", "fits", m,
                 profile=RIGS[sess["rig"]]["profile"], frame_type="Light",
                 is_master=False, group=f"light:{sess['label']}",
                 session_group=key,
                 note="EXPTIME 300.4 groups WITH S0 (sub-1s exposure bucket)")


def gen_cross_rig():
    # R2 / OSC, M 16, N1, gain 0, offset 20, set_temp -20
    sess = dict(rig="R2", obj="M 16", filt="LUM", gain=0, binning=1, offset=20,
                set_temp=-20, exptime=300, rotang=90.0, night=N1)
    key = light_key("M 16", "LUM", 1, 0, N1)
    for i in range(4):
        ra, dec = TARGETS["M 16"]
        do, de, dl, mjd = obs_times(N1, i, 300)
        m = rig_equip("R2")
        m.update(image_typ="LIGHT", filter="LUM", object="M 16", exposure=300.0,
                 gain=0, x_binning=1, y_binning=1, offset=20, set_temp_c=-20.0,
                 ccd_temp_c=round(-20 + DRIFT[i % len(DRIFT)], 2), ra_deg=ra,
                 dec_deg=dec, rotator_angle_deg=90.0, date_obs=do, date_end=de,
                 date_loc=dl, mjd_obs=mjd)
        emit(f"Lights/M 16/{N1}/LUM/M 16_LUM_300s_gain0_bin1_{N1}_{i:03d}.fits",
             "fits", m, profile="nina", frame_type="Light", is_master=False,
             group="light:cross-R2-OSC", session_group=key, naxis=("R2",))

    # R3 / DWARF 3, NGC 2264, gain index 60, DET-TEMP 30, sparse (no IMAGETYP/FILTER)
    key = light_key("NGC 2264", None, 1, 60, N1)
    for i in range(4):
        ra, dec = TARGETS["NGC 2264"]
        do, _de, _dl, _mjd = obs_times(N1, i, 15)
        m = rig_equip("R3")
        m.update(object="NGC 2264", exposure=15.0, gain=60, x_binning=1,
                 y_binning=1, det_temp_c=30.0, ra_deg=ra, dec_deg=dec, date_obs=do)
        emit(f"Lights/NGC 2264/{N1}/NoFilter/NGC 2264_dwarf_15s_gain60_{i:03d}.fits",
             "fits", m, profile="dwarflab", frame_type=None, is_master=False,
             group="light:cross-R3-DWARF", session_group=key, naxis=("R3",),
             note="no IMAGETYP -> UNCLASSIFIED frame type; no FILTER; DET-TEMP only")


# ── Calibration matrix ──────────────────────────────────────────────────────

S0_KEY = light_key("M 51", "L", 1, 100, N1)
R_KEY = light_key("M 51", "R", 1, 100, N1)
G_KEY = light_key("M 51", "G", 1, 100, N1)
B_KEY = light_key("M 51", "B", 1, 100, N1)


def cal_meta(gain=100, offset=50, exptime=None, set_temp=-10, ccd_temp=None,
             binning=1, filt=None, rotang=None, ccd_i=0):
    m = rig_equip("R1")
    m.update(gain=gain, x_binning=binning, y_binning=binning)
    if offset is not None:
        m["offset"] = offset
    if exptime is not None:
        m["exposure"] = float(exptime)
    if set_temp is not None:
        m["set_temp_c"] = float(set_temp)
        m["ccd_temp_c"] = round(set_temp + DRIFT[ccd_i % len(DRIFT)], 2) if ccd_temp is None else float(ccd_temp)
    if filt is not None:
        m["filter"] = filt
    if rotang is not None:
        m["rotator_angle_deg"] = rotang
    do, de, dl, mjd = obs_times(N1, 0, exptime or 1)
    m.update(date_obs=do, date_end=de, date_loc=dl, mjd_obs=mjd)
    return m


def gen_raw_cal():
    """Raw calibration sub-sets on R1 (gain100, offset50, bin1), full headers.
    FITS extensions woven across subs."""
    ext_cycle = [".fits", ".fit", ".fts"]

    def raw(type_name, n, exptime, extra=None, filt=None, obj=None, rotang=None):
        for i in range(n):
            m = cal_meta(exptime=exptime, filt=filt, rotang=rotang, ccd_i=i)
            m["image_typ"] = BASE_TYP[type_name]
            if obj:
                m["object"] = obj
            if extra:
                m.update(extra)
            ext = ext_cycle[i % len(ext_cycle)]
            fsub = f"_{filt}" if filt else ""
            rel = (f"Calibration/{PLURAL[type_name]}/R1/{N1}/"
                   f"{type_name.lower()}{fsub}_gain100_off50_bin1{fsub}_{i:03d}{ext}")
            emit(rel, "fits", m, profile="nina", frame_type=type_name,
                 is_master=False, group=f"raw:{type_name}")

    raw("Dark", 5, 300)
    raw("Bias", 5, 0)
    for filt in ("L", "R", "G", "B"):
        raw("Flat", 3, 3.0, filt=filt, obj="FlatWizard", rotang=90.0)
    raw("DarkFlat", 4, 3.0)


def _stripped_name(type_name, gain, offset, exptime, temp, binning, stack, filt=None):
    if type_name == "Bias":
        return f"bias_gain_{gain}_bin_{binning}_stack_{stack}.fits"
    if type_name == "Flat":
        return f"flat_{filt}_gain_{gain}_bin_{binning}_stack_{stack}.fits"
    return f"dark_exp_{int(exptime)}_gain_{gain}_bin_{binning}_{int(temp)}C_stack_{stack}.fits"


def _stripped_fields(type_name, gain, offset, exptime, temp, binning, stack, filt=None):
    f = {"gain": gain, "x_binning": binning, "y_binning": binning, "stack_count": stack,
         "filename_encoded": True, "offset": None}
    if type_name == "Bias":
        f["exposure"] = 0.0
    elif type_name == "Flat":
        f["filter"] = filt
    else:
        f["exposure"] = float(exptime)
        f["set_temp_c"] = float(temp)
    return f


def emit_master(type_name, base_meta, flavor, matches, *, filt=None,
                exptime=None, temp=-10, gain=100, offset=50, binning=1,
                label="match"):
    """Emit one master in ``flavor``. ``base_meta`` is the header meta for the
    non-stripped flavors (image_typ/stack cards are applied here)."""
    directory = f"Calibration/Masters/R1/{type_name}"
    tag = f"{type_name}_{label}"
    if flavor == FLV_STRIPPED:
        name = _stripped_name(type_name, gain, offset, exptime, temp, binning, 30, filt)
        rel = f"{directory}/{name}"
        fields = _stripped_fields(type_name, gain, offset, exptime, temp, binning, 30, filt)
        emit(rel, "fits", {}, profile="stripped", frame_type=type_name,
             is_master=True, group=f"master:{type_name}", matches=matches,
             master_flavor=flavor, structural_only=True, fields=fields,
             note="header structural-only; calibration metadata in filename; offset absent")
        if type_name == "Dark" and label == "match":
            SELFCHECK["stripped"] = rel
        return rel

    m = dict(base_meta)
    props = ""
    fmt = "fits"
    profile = "pixinsight"
    if flavor == FLV_STACKCNT:
        m["image_typ"] = BASE_TYP[type_name]
        m["stack_count"] = 30
        fname = f"master{tag}_STACKCNT_gain{gain}_off{offset}"
    elif flavor == FLV_NCOMBINE:
        m["image_typ"] = BASE_TYP[type_name]
        m["ncombine"] = 25
        fname = f"master{tag}_NCOMBINE_gain{gain}_off{offset}"
    elif flavor == FLV_MASTERTYP:
        m["image_typ"] = MASTER_TYP[type_name]
        fname = f"master{tag}_IMAGETYP_gain{gain}_off{offset}"
    elif flavor == FLV_XISF:
        m["image_typ"] = MASTER_TYP[type_name]
        m["focal_length_mm"] = None  # exercise metres->mm Property path instead
        props = XISF_PROPS_R1
        fmt = "xisf"
        fname = f"master{tag}_XISF_gain{gain}_off{offset}"
    else:
        raise ValueError(flavor)

    ext = ".xisf" if fmt == "xisf" else ".fits"
    rel = f"{directory}/{fname}{ext}"
    fields = _clean_fields(m)
    if fmt == "xisf":
        # focal length is carried by the SI-metres Property (840 mm effective)
        fields["focal_length_mm"] = 840
        fields["xisf_focal_length_property_m"] = 0.840
    emit(rel, fmt, m, profile=profile, frame_type=type_name, is_master=True,
         group=f"master:{type_name}", matches=matches, master_flavor=flavor,
         props=props, fields=fields)
    if type_name == "Dark" and flavor == FLV_XISF and label == "match":
        SELFCHECK["xisf"] = rel
    return rel


def gen_masters():
    def M(session, verdict):
        return [{"session": session, "verdict": verdict}]

    # ── DARK: D_match in every flavor + soft/excluded variants ──────────────
    for flv in ALL_FLAVORS:
        emit_master("Dark", cal_meta(exptime=300, set_temp=-10, ccd_temp=-10), flv,
                    M(S0_KEY, "match"), exptime=300, temp=-10, label="match")
    emit_master("Dark", cal_meta(exptime=300, set_temp=-20, ccd_temp=-20), FLV_MASTERTYP,
                M(S0_KEY, "soft:temperature"), label="temp")
    emit_master("Dark", cal_meta(exptime=330, set_temp=-10, ccd_temp=-10), FLV_MASTERTYP,
                M(S0_KEY, "soft:exposure"), label="exp")
    emit_master("Dark", cal_meta(exptime=300, set_temp=-10, ccd_temp=-10, gain=0), FLV_MASTERTYP,
                M(S0_KEY, "excluded:gain"), gain=0, label="gainfail")
    emit_master("Dark", cal_meta(exptime=300, set_temp=-10, ccd_temp=-10, offset=20), FLV_MASTERTYP,
                M(S0_KEY, "excluded:offset"), offset=20, label="offsetfail")

    # ── BIAS: Bias_match in every flavor + gain-fail ────────────────────────
    for flv in ALL_FLAVORS:
        emit_master("Bias", cal_meta(exptime=0, set_temp=-10, ccd_temp=-10), flv,
                    M(S0_KEY, "match"), exptime=0, temp=-10, label="match")
    emit_master("Bias", cal_meta(exptime=0, set_temp=-10, ccd_temp=-10, gain=0), FLV_MASTERTYP,
                M(S0_KEY, "excluded:gain"), gain=0, exptime=0, label="gainfail")

    # ── FLAT: L-match in every flavor; R/G/B + rotation/filter variants ─────
    for flv in ALL_FLAVORS:
        emit_master("Flat", cal_meta(exptime=3.0, filt="L", rotang=90.0), flv,
                    M(S0_KEY, "match"), filt="L", exptime=3.0, label="L")
    for filt, key in (("R", R_KEY), ("G", G_KEY), ("B", B_KEY)):
        emit_master("Flat", cal_meta(exptime=3.0, filt=filt, rotang=90.0), FLV_MASTERTYP,
                    M(key, "match"), filt=filt, exptime=3.0, label=filt)
    emit_master("Flat", cal_meta(exptime=3.0, filt="L", rotang=92.0), FLV_MASTERTYP,
                M(S0_KEY, "soft:rotation"), filt="L", exptime=3.0, label="rot92")
    emit_master("Flat", cal_meta(exptime=3.0, filt="Ha", rotang=90.0), FLV_MASTERTYP,
                M(S0_KEY, "excluded:filter"), filt="Ha", exptime=3.0, label="wrongfilter")

    # ── DARKFLAT: one master, never matched in v1 ───────────────────────────
    emit_master("DarkFlat", cal_meta(exptime=3.0, set_temp=-10, ccd_temp=-10), FLV_MASTERTYP,
                [], exptime=3.0, label="master")
    CASES[-1]["note"] = "darkflat masters are never suggested/matched in v1"


# ── Self-verification (re-read three files against the manifest) ────────────

def _read_fits_cards(path):
    with open(path, "rb") as f:
        data = f.read(BLOCK * 6)
    cards = {}
    for off in range(0, len(data), 80):
        c = data[off:off + 80]
        if len(c) < 80:
            break
        key = c[0:8].decode("ascii", "replace").strip()
        if key == "END":
            break
        if c[8:10] == b"= ":
            raw = c[10:].decode("ascii", "replace")
            if raw.lstrip().startswith("'"):
                inner = raw.split("'", 2)
                cards.setdefault(key, inner[1].strip() if len(inner) > 2 else "")
            else:
                cards.setdefault(key, raw.split("/")[0].strip())
    return cards


def selfcheck(index):
    results = []

    def check(name, cond, detail=""):
        results.append((name, bool(cond), detail))

    # 1. Full-header FITS (an S0 light)
    rel = SELFCHECK["fits_full"]
    fields = index[rel]["fields"]
    cards = _read_fits_cards(os.path.join(OUT, rel.replace("/", os.sep)))
    check("fits.IMAGETYP", cards.get("IMAGETYP") == "LIGHT", cards.get("IMAGETYP"))
    check("fits.GAIN", cards.get("GAIN") == str(fields["gain"]), cards.get("GAIN"))
    check("fits.OFFSET", cards.get("OFFSET") == str(fields["offset"]), cards.get("OFFSET"))
    check("fits.SET-TEMP", cards.get("SET-TEMP") == fmt_num(fields["set_temp_c"]), cards.get("SET-TEMP"))
    check("fits.RA", cards.get("RA") == fmt_num(fields["ra_deg"]), cards.get("RA"))

    # 2. REAL-XISF (D_match) — container integrity + IMAGETYP + FocalLength Property
    rel = SELFCHECK["xisf"]
    p = os.path.join(OUT, rel.replace("/", os.sep))
    size = os.path.getsize(p)
    with open(p, "rb") as f:
        pre = f.read(16)
    sig = pre[0:8]
    xml_len = int.from_bytes(pre[8:12], "little")
    with open(p, "rb") as f:
        xml = f.read(16 + xml_len)[16:].decode("utf-8")
    m = re.search(r"attachment:(\d+):4", xml)
    data_off = int(m.group(1)) if m else -1
    check("xisf.signature", sig == XISF_SIG, sig)
    check("xisf.u32_len==xml_bytes", xml_len == size - 16 - 4, f"{xml_len} vs {size - 20}")
    check("xisf.dataOffset==16+len(xml)", data_off == 16 + xml_len, f"{data_off} vs {16 + xml_len}")
    check("xisf.IMAGETYP=Master Dark", "value=\"'Master Dark'\"" in xml)
    check("xisf.FocalLength Property=0.840",
          'Instrument:Telescope:FocalLength' in xml and 'value="0.840"' in xml)
    check("xisf.no FOCALLEN keyword", 'name="FOCALLEN"' not in xml)

    # 3. Stripped FITS — structural-only header, metadata only in filename
    rel = SELFCHECK["stripped"]
    cards = _read_fits_cards(os.path.join(OUT, rel.replace("/", os.sep)))
    meta_keys = [k for k in cards if k not in ("SIMPLE", "BITPIX", "NAXIS", "NAXIS1", "NAXIS2")]
    check("stripped.structural-only", meta_keys == [], meta_keys)
    check("stripped.filename-encodes", "gain_100" in rel and "stack_30" in rel, rel)

    return results


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    global OUT
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    OUT = os.path.abspath(sys.argv[1])
    parent = os.path.dirname(OUT)
    if not os.path.isdir(parent):
        print(f"parent dir does not exist: {parent}", file=sys.stderr)
        sys.exit(2)
    if os.path.basename(OUT) != "SessionMatrix":
        print(f"refusing to wipe non-SessionMatrix path: {OUT}", file=sys.stderr)
        sys.exit(2)

    # Idempotent overwrite: rebuild only our own subtree.
    import shutil
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT, exist_ok=True)

    gen_lights()
    gen_cross_rig()
    gen_raw_cal()
    gen_masters()

    dups = [p for p, n in Counter(c["path"] for c in CASES).items() if n > 1]
    if dups:
        print(f"DUPLICATE PATHS (files would overwrite): {dups}", file=sys.stderr)
        sys.exit(1)

    index = {c["path"]: c for c in CASES}
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump([{k: v for k, v in c.items()} for c in CASES], f, indent=2)

    results = selfcheck(index)

    by_group = Counter(c["group"] for c in CASES)
    print(f"wrote {len(CASES)} fixtures + manifest.json under {OUT}")
    for g, n in sorted(by_group.items()):
        print(f"  {n:3d}  {g}")

    print("\nself-verification (3 re-read files):")
    ok = True
    for name, passed, detail in results:
        ok = ok and passed
        flag = "PASS" if passed else "FAIL"
        extra = "" if passed else f"   <- got: {detail!r}"
        print(f"  [{flag}] {name}{extra}")
    if not ok:
        print("\nSELF-VERIFICATION FAILED", file=sys.stderr)
        sys.exit(1)
    print("\nall self-checks passed")


if __name__ == "__main__":
    main()
