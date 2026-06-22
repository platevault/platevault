/**
 * TargetDetailV2 — spec 036 gen-3 detail pane for a single canonical target.
 *
 * Renders:
 *   - Planner header: effectiveLabel, objectType + catalog pills, "Add to plan"
 *     and "+ New project here" actions (FR-012).
 *   - Identity table: Designation, Type, RA/Dec, Source, SIMBAD OID.
 *     STUB fields (Constellation, Magnitude, Apparent size, Best season, Transit,
 *     Moon, Altitude now) are marked below — the gen-3 backend does not yet return
 *     these.
 *   - Tonight altitude graph: approximate sinusoidal SVG curve from RA/Dec +
 *     placeholder observer latitude.
 *     // STUB: altitude ephemeris — replace with real astro calc when
 *     // location/ephemeris backend lands.
 *   - Coverage bars (filter integration hours) — stubbed; gen-3 backend does not
 *     yet expose coverage per filter on the target.get endpoint.
 *     // STUB: target coverage — backend pending.
 *   - Linked sessions / linked projects — empty-state stubs; cross-spec FK wiring
 *     is deferred (see spec 036 open gaps).
 *     // STUB: target↔session/project linkage backend pending.
 *   - Display-alias edit (FR-012).
 *   - Alias list + add-alias form.
 */

import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import {
  getTargetDetail,
  addTargetAlias,
  removeTargetAlias,
  setDisplayAlias,
  clearDisplayAlias,
} from '@/api/commands';
import type { TargetDetailV3, TargetOpError, TargetListItem } from '@/api/commands';
import { DetailPane, PropertyTable, type PropertyDef } from '@/components';
import { Pill, Section, EmptyState, Banner, Btn } from '@/ui';
import { rowAltitudeFor, USABLE_ALT_DEG } from './planner-altitude';
import { FilterBadges } from './FilterBadges';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  targetId: string;
  /** The selected list row — supplies constellation/magnitude + tonight stats. */
  item?: TargetListItem | null;
  /** Usable-altitude threshold (from Settings) for img-time / visible-tonight. */
  usableAltDeg?: number;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: TargetDetailV3 };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map an AliasKind string to a human label for the badge. */
function kindLabel(kind: string): string {
  switch (kind) {
    case 'designation':
      return 'desig';
    case 'common_name':
      return 'name';
    case 'user':
      return 'user';
    default:
      return kind;
  }
}

/** Format decimal RA degrees (0–360) to sexagesimal h m s string. */
function fmtRa(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const h = deg / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${ss.toFixed(0).padStart(2, '0')}s`;
}

/** Format decimal Dec degrees to ±DD°MM′SS″ string. */
function fmtDec(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const sign = deg < 0 ? '−' : '+';
  const abs = Math.abs(deg);
  const dd = Math.floor(abs);
  const mm = Math.floor((abs - dd) * 60);
  const ss = ((abs - dd) * 60 - mm) * 60;
  return `${sign}${String(dd).padStart(2, '0')}°${String(mm).padStart(2, '0')}′${ss.toFixed(0).padStart(2, '0')}″`;
}

/** Map TargetOpError.code to a user-readable message. */
function errorMessage(err: TargetOpError, fallback: string): string {
  switch (err.code) {
    case 'alias.blank':
      return 'Alias must not be blank.';
    case 'alias.not_found':
      return 'Alias not found on this target.';
    case 'alias.not_removable':
      return 'Only user-added aliases can be removed.';
    case 'target.not_found':
      return 'Target not found.';
    case 'target.invalid_id':
      return 'Invalid target ID.';
    default:
      return fallback;
  }
}

// ── Altitude curve helper ─────────────────────────────────────────────────────
//
// STUB: altitude ephemeris — replace with real astro calc when
// location/ephemeris backend lands. This helper approximates the altitude curve
// using a sinusoidal model based on the target's declination and a placeholder
// observer latitude. It does not account for refraction, precession, or
// accurate LST computation. The transit hour is estimated from RA alone.

const STUB_OBSERVER_LAT_DEG = 52.1; // placeholder: ~Netherlands latitude

interface AltPoint {
  /** Local solar time offset from 18:00 (start of night), in hours (0–12). */
  tHour: number;
  /** Approximate altitude in degrees (-90..+90). */
  altDeg: number;
}

function altitudeCurve(raDeg: number | null, decDeg: number | null): AltPoint[] {
  const points: AltPoint[] = [];
  // Night spans roughly 18:00 → 06:00 (12 h). We sample every 20 min.
  for (let i = 0; i <= 36; i++) {
    const tHour = i * (12 / 36); // 0..12 hours into the night
    const localHour = 18 + tHour; // local clock 18..30 (30=06:00 next day)

    let altDeg: number;
    if (raDeg == null || decDeg == null) {
      altDeg = 0;
    } else {
      // Approximate hour angle from RA. We assume RA=raDeg/15 hours transits at
      // midnight local time (LST ≈ 00:00), so HA = (localHour - 24) * 15 deg.
      const haHour = (localHour - 24); // hours from midnight transit
      const haDeg = haHour * 15;
      const latRad = (STUB_OBSERVER_LAT_DEG * Math.PI) / 180;
      const decRad = (decDeg * Math.PI) / 180;
      const haRad = (haDeg * Math.PI) / 180;
      const sinAlt =
        Math.sin(latRad) * Math.sin(decRad) +
        Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
      altDeg = (Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180) / Math.PI;
    }
    points.push({ tHour, altDeg });
  }
  return points;
}

// ── Tonight Altitude SVG ──────────────────────────────────────────────────────

interface AltitudeGraphProps {
  /** Pre-sampled altitude curve (shared with the list's max-alt computation). */
  points: AltPoint[];
}

const SVG_W = 400;
const SVG_H = 140;
const PAD_L = 32;
const PAD_R = 12;
const PAD_T = 10;
const PAD_B = 28;
const PLOT_W = SVG_W - PAD_L - PAD_R;
const PLOT_H = SVG_H - PAD_T - PAD_B;
const ALT_MIN = -10;
const ALT_MAX = 90;

function altToY(alt: number): number {
  const frac = (alt - ALT_MIN) / (ALT_MAX - ALT_MIN);
  return PAD_T + PLOT_H - frac * PLOT_H;
}

function hourToX(tHour: number): number {
  return PAD_L + (tHour / 12) * PLOT_W;
}

function AltitudeGraph({ points }: AltitudeGraphProps) {
  // Build SVG polyline points string (dynamic geometry — inline attribute ok)
  const polylinePoints = points
    .map((p) => `${hourToX(p.tHour).toFixed(1)},${altToY(p.altDeg).toFixed(1)}`)
    .join(' ');

  // Usable-altitude band (≥30°) shading
  const y30 = altToY(30);
  const yTop = altToY(ALT_MAX);

  // Transit marker: find point closest to peak altitude
  const peak = points.reduce(
    (best, p) => (p.altDeg > best.altDeg ? p : best),
    points[0],
  );
  const transitX = hourToX(peak.tHour);
  // The curve is an approximate placeholder (see caption), so the marker is
  // labelled "transit" without a precise time to avoid contradicting the
  // identity table (which shows transit as "—" pending the ephemeris backend).

  // X-axis tick labels (every 2 h from 18 to 06)
  const xTicks: Array<{ tHour: number; label: string }> = [];
  for (let h = 0; h <= 12; h += 2) {
    const clock = (18 + h) % 24;
    xTicks.push({ tHour: h, label: String(clock).padStart(2, '0') });
  }

  // Y-axis tick labels
  const yTicks = [0, 30, 60, 90];

  return (
    <div className="alm-planner__graph-wrap">
      {/* viewBox and width/height are geometry — inline SVG attributes */}
      <svg
        className="alm-planner__graph-svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        aria-label="Tonight altitude graph (approximate)"
        role="img"
      >
        {/* Usable altitude shaded band (≥30°) */}
        <rect
          x={PAD_L}
          y={yTop}
          width={PLOT_W}
          height={y30 - yTop}
          fill="var(--alm-ok-bg)"
          opacity="0.6"
        />

        {/* 30° usable-altitude guide line */}
        <line
          x1={PAD_L}
          y1={y30}
          x2={PAD_L + PLOT_W}
          y2={y30}
          stroke="var(--alm-ok-border)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {/* Altitude curve */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="var(--alm-accent)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Transit vertical marker */}
        <line
          x1={transitX}
          y1={PAD_T}
          x2={transitX}
          y2={PAD_T + PLOT_H}
          stroke="var(--alm-accent)"
          strokeWidth="1"
          strokeDasharray="2 2"
          opacity="0.6"
        />
        <text
          x={transitX + 3}
          y={PAD_T + 9}
          className="alm-planner__graph-label-text"
        >
          transit
        </text>

        {/* Y-axis */}
        <line
          x1={PAD_L}
          y1={PAD_T}
          x2={PAD_L}
          y2={PAD_T + PLOT_H}
          stroke="var(--alm-border)"
          strokeWidth="1"
        />
        {/* X-axis */}
        <line
          x1={PAD_L}
          y1={PAD_T + PLOT_H}
          x2={PAD_L + PLOT_W}
          y2={PAD_T + PLOT_H}
          stroke="var(--alm-border)"
          strokeWidth="1"
        />

        {/* Y-axis ticks + labels */}
        {yTicks.map((alt) => (
          <g key={alt}>
            <line
              x1={PAD_L - 3}
              y1={altToY(alt)}
              x2={PAD_L}
              y2={altToY(alt)}
              stroke="var(--alm-border)"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 5}
              y={altToY(alt) + 3}
              textAnchor="end"
              className="alm-planner__graph-axis-text"
            >
              {alt}°
            </text>
          </g>
        ))}

        {/* X-axis ticks + labels */}
        {xTicks.map(({ tHour, label }) => (
          <g key={tHour}>
            <line
              x1={hourToX(tHour)}
              y1={PAD_T + PLOT_H}
              x2={hourToX(tHour)}
              y2={PAD_T + PLOT_H + 3}
              stroke="var(--alm-border)"
              strokeWidth="1"
            />
            <text
              x={hourToX(tHour)}
              y={PAD_T + PLOT_H + 12}
              textAnchor="middle"
              className="alm-planner__graph-axis-text"
            >
              {label}
            </text>
          </g>
        ))}
      </svg>

      <p className="alm-planner__graph-legend">
        Shaded = usable altitude (≥30°)
      </p>
      <p className="alm-planner__graph-stub-note">
        {/* STUB: altitude ephemeris — sinusoidal approximation at {STUB_OBSERVER_LAT_DEG}°N.
            Replace with real ephemeris calc when location/backend lands. */}
        Approximate curve · {STUB_OBSERVER_LAT_DEG}°N placeholder location
      </p>
    </div>
  );
}

// ── TargetDetailV2 ────────────────────────────────────────────────────────────

export function TargetDetailV2({ targetId, item = null, usableAltDeg = USABLE_ALT_DEG }: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [aliasInput, setAliasInput] = useState('');
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [displayAliasInput, setDisplayAliasInput] = useState('');
  const [displayAliasEditing, setDisplayAliasEditing] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(() => {
    setLoadState({ status: 'loading' });
    getTargetDetail({ targetId })
      .then((data) => {
        setLoadState({ status: 'loaded', data });
        setDisplayAliasInput(data.displayAlias ?? '');
      })
      .catch(() => {
        setLoadState({ status: 'error', message: 'Failed to load target.' });
      });
  }, [targetId]);

  useEffect(() => {
    load();
  }, [load]);

  // Add user alias.
  const handleAliasAdd = useCallback(async () => {
    const alias = aliasInput.trim();
    if (!alias) {
      setAliasError('Alias must not be blank.');
      return;
    }
    setAliasError(null);
    try {
      await addTargetAlias({ targetId, alias });
      setAliasInput('');
      load();
    } catch (err) {
      const e = err as TargetOpError;
      setAliasError(errorMessage(e, 'Failed to add alias.'));
    }
  }, [targetId, aliasInput, load]);

  // Remove user alias by id.
  const handleAliasRemove = useCallback(
    async (aliasId: string) => {
      setActionError(null);
      try {
        await removeTargetAlias({ targetId, aliasId });
        load();
      } catch (err) {
        const e = err as TargetOpError;
        setActionError(errorMessage(e, 'Failed to remove alias.'));
      }
    },
    [targetId, load],
  );

  // Set display alias.
  const handleDisplayAliasSet = useCallback(async () => {
    setActionError(null);
    try {
      const data = await setDisplayAlias({ targetId, displayAlias: displayAliasInput.trim() });
      setLoadState({ status: 'loaded', data });
      setDisplayAliasInput(data.displayAlias ?? '');
      setDisplayAliasEditing(false);
    } catch (err) {
      const e = err as TargetOpError;
      setActionError(errorMessage(e, 'Failed to set display alias.'));
    }
  }, [targetId, displayAliasInput]);

  // Clear display alias.
  const handleDisplayAliasClear = useCallback(async () => {
    setActionError(null);
    try {
      const data = await clearDisplayAlias({ targetId });
      setLoadState({ status: 'loaded', data });
      setDisplayAliasInput('');
      setDisplayAliasEditing(false);
    } catch (err) {
      const e = err as TargetOpError;
      setActionError(errorMessage(e, 'Failed to clear display alias.'));
    }
  }, [targetId]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loadState.status === 'loading') {
    return (
      <DetailPane>
        <EmptyState title="Loading…" desc="" />
      </DetailPane>
    );
  }

  if (loadState.status === 'error') {
    return (
      <DetailPane>
        <EmptyState title="Error" desc={loadState.message} />
      </DetailPane>
    );
  }

  const detail = loadState.data;

  // Derive catalog pills from aliases with kind='designation' (non-primary).
  const catalogPills = detail.aliases
    .filter((a) => a.kind === 'designation' && a.alias !== detail.primaryDesignation)
    .slice(0, 4);

  // Common name (first common_name alias, if any).
  const commonName = detail.aliases.find((a) => a.kind === 'common_name')?.alias ?? null;

  // Tonight planner data — shared with the list row (same rowAltitudeFor source
  // so the graph peak and the "Max alt" stat agree). Falls back to an RA/Dec
  // curve when the list item isn't available.
  const rowAlt = item ? rowAltitudeFor(item, usableAltDeg) : null;
  const tonightPoints: AltPoint[] = rowAlt?.points ?? altitudeCurve(detail.raDeg, detail.decDeg);

  const raDecStr =
    detail.raDeg != null && detail.decDeg != null
      ? `${fmtRa(detail.raDeg)} / ${fmtDec(detail.decDeg)}`
      : null;

  // Identity facts split across two tabular columns (left-packed).
  const identityA: PropertyDef[] = [
    { key: 'desig', label: 'Designation', value: detail.primaryDesignation },
    { key: 'type', label: 'Type', value: detail.objectType.replace(/_/g, ' ') },
    { key: 'constellation', label: 'Constellation', value: item?.constellation ?? null },
    { key: 'radec', label: 'RA / Dec', value: raDecStr },
  ];
  const identityB: PropertyDef[] = [
    { key: 'magnitude', label: 'Magnitude', value: item?.magnitude ?? null },
    { key: 'source', label: 'Source', value: detail.source },
    ...(detail.simbadOid != null
      ? [{ key: 'simbad', label: 'SIMBAD OID', value: detail.simbadOid } as PropertyDef]
      : []),
  ];

  // Tonight stats (numeric) — Filters render separately (a component, not a value).
  const tonightStats: PropertyDef[] = rowAlt
    ? [
        { key: 'maxalt', label: 'Max alt', value: `${Math.round(rowAlt.maxAltDeg)}°` },
        { key: 'imgtime', label: 'Img time', value: `${rowAlt.hoursAboveUsable.toFixed(1)} h` },
        { key: 'lunar', label: 'Lunar', value: `${Math.round(rowAlt.lunarDistanceDeg)}°` },
      ]
    : [];

  return (
    <DetailPane fill>
      {/* ── Planner header ──────────────────────────────────────────────── */}
      <div className="alm-planner__header">
        <div className="alm-planner__header-left">
          <h2 className="alm-planner__title">
            {detail.effectiveLabel}
            {commonName && commonName !== detail.effectiveLabel && (
              <span className="alm-planner__subtitle"> — {commonName}</span>
            )}
          </h2>
          <div className="alm-planner__pill-row">
            <Pill variant="neutral">{detail.objectType.replace(/_/g, ' ')}</Pill>
            {catalogPills.map((a) => (
              <Pill key={a.id} variant="ghost">{a.alias}</Pill>
            ))}
          </div>
        </div>
        <div className="alm-planner__actions">
          {/* STUB: "Add to plan" — observing-plan feature not yet implemented */}
          <Btn size="sm" variant="ghost" disabled title="Add to plan (coming soon)">
            Add to plan
          </Btn>
          {/* "+ New project here" — opens CreateProjectDialog; pre-wiring
              canonicalTargetId is deferred per spec 035 comment in
              CreateProjectDialog.tsx (no backend field yet). Navigates to
              /projects?newProject=1 so the projects page opens the dialog. */}
          <Btn
            size="sm"
            variant="primary"
            onClick={() => {
              // STUB: pre-fill targetId in CreateProjectDialog — deferred
              // (canonicalTargetId field not yet wired in backend contract).
              // Navigate to /projects/new which opens the create-project dialog.
              setNewProjectOpen(true);
              void navigate({ to: '/projects/new' });
            }}
          >
            + New project here
          </Btn>
        </div>
      </div>

      {/* Suppress unused-state warning; newProjectOpen drives the navigate above */}
      {newProjectOpen && null}

      {/* ── Identity + Tonight — left-packed: [facts A][facts B][tonight] ── */}
      <div className="alm-planner__cols">
        <div className="alm-planner__col">
          <PropertyTable mode="view" properties={identityA} />
        </div>
        <div className="alm-planner__col">
          <PropertyTable mode="view" properties={identityB} />
        </div>

        {/* Tonight column: a small transit graph + the planner stats. */}
        <div className="alm-planner__tonight">
          <div className="alm-planner__graph-title">
            Tonight · ~{STUB_OBSERVER_LAT_DEG}°N (approx)
          </div>
          <AltitudeGraph points={tonightPoints} />
          {rowAlt && (
            <>
              <PropertyTable mode="view" properties={tonightStats} />
              <div className="alm-planner__tonight-filters">
                <span className="alm-planner__tonight-filters-label">Filters</span>
                <FilterBadges recommendation={rowAlt.filters} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Coverage bars ────────────────────────────────────────────────── */}
      {/* STUB: target coverage — gen-3 TargetDetailV3 does not yet expose
          per-filter coverage. Render the section header with a stub note. */}
      <div className="alm-planner__coverage">
        <p className="alm-planner__section-title">Coverage</p>
        <div className="alm-planner__coverage-list">
          <span className="alm-planner__coverage-stub">
            {/* STUB: target coverage — backend pending (coverage per filter not in gen-3 target.get) */}
            No coverage data — filter integration hours will appear here once the
            target↔session linkage backend is wired.
          </span>
        </div>
      </div>

      {/* ── Linked sessions + projects ───────────────────────────────────── */}
      {/* STUB: target↔session/project linkage backend pending (spec 036 open gap). */}
      <div className="alm-planner__links">
        <div>
          <p className="alm-planner__link-col-title">Sessions</p>
          {/* STUB: target↔session linkage backend pending */}
          <span className="alm-planner__link-empty">
            Sessions appear here once the ingest pipeline populates target_id from FITS OBJECT data.
          </span>
        </div>
        <div>
          <p className="alm-planner__link-col-title">Projects</p>
          {/* STUB: target↔project linkage backend pending */}
          <span className="alm-planner__link-empty">
            Projects appear here once they are created with a target reference.
          </span>
        </div>
      </div>

      {/* ── Display label ────────────────────────────────────────────────── */}
      <Section title="Display label">
        {displayAliasEditing ? (
          <div className="alm-target-detail__display-alias-edit">
            <input
              aria-label="Display label"
              placeholder={detail.primaryDesignation}
              value={displayAliasInput}
              onChange={(e) => setDisplayAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleDisplayAliasSet();
                if (e.key === 'Escape') setDisplayAliasEditing(false);
              }}
              className="alm-target-detail__text-input"
              autoFocus
            />
            <button
              onClick={handleDisplayAliasSet}
              className="alm-target-detail__action-btn"
            >
              Save
            </button>
            {detail.displayAlias != null && (
              <button
                onClick={handleDisplayAliasClear}
                className="alm-target-detail__action-btn alm-target-detail__action-btn--muted"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setDisplayAliasEditing(false)}
              className="alm-target-detail__action-btn alm-target-detail__action-btn--muted"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="alm-target-detail__display-alias-view">
            <span className="alm-target-detail__display-alias-value">
              {detail.displayAlias ?? (
                <em className="alm-target-detail__display-alias-placeholder">
                  Not set — showing primary designation
                </em>
              )}
            </span>
            <button
              onClick={() => setDisplayAliasEditing(true)}
              className="alm-target-detail__edit-btn"
            >
              {detail.displayAlias != null ? 'Edit' : 'Set'}
            </button>
          </div>
        )}
      </Section>

      {/* ── Aliases ──────────────────────────────────────────────────────── */}
      <Section title="Aliases" count={detail.aliases.length}>
        <div className="alm-target-detail__alias-list">
          {detail.aliases.map((a) => (
            <Pill key={a.id} variant={a.kind === 'user' ? 'accent' : 'ghost'}>
              <span title={`kind: ${a.kind}`}>
                <span className="alm-target-detail__alias-kind">
                  [{kindLabel(a.kind)}]
                </span>
                {a.alias}
              </span>
              {a.kind === 'user' && (
                <button
                  aria-label={`Remove alias ${a.alias}`}
                  className="alm-target-detail__alias-remove"
                  onClick={() => handleAliasRemove(a.id)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </Pill>
          ))}
          {detail.aliases.length === 0 && (
            <span className="alm-target-detail__alias-empty">
              No aliases
            </span>
          )}
        </div>

        {/* Add user alias form */}
        <div className="alm-target-detail__alias-add-row">
          <input
            aria-label="New alias"
            placeholder="Add user alias…"
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAliasAdd();
            }}
            className="alm-target-detail__text-input"
          />
          <button
            onClick={handleAliasAdd}
            className="alm-target-detail__action-btn"
          >
            Add
          </button>
        </div>
        {aliasError && (
          <Banner variant="danger" className="alm-target-detail__banner">
            {aliasError}
          </Banner>
        )}
        {actionError && (
          <Banner variant="danger" className="alm-target-detail__banner">
            {actionError}
          </Banner>
        )}
      </Section>

      {/* Sessions surface lives in the mid-page SESSIONS/PROJECTS link row
          above (single source of truth) — the duplicate bottom Sessions
          section was removed to avoid two Sessions surfaces. */}

      {/* ── Projects (empty-state stub) ──────────────────────────────────── */}
      <Section title="Projects">
        {/* STUB: target↔project linkage backend pending */}
        <EmptyState
          title="No projects linked"
          desc="Projects appear here once they are created with a target reference."
        />
      </Section>

      {/* Back button */}
      <button
        className="alm-target-detail__back-btn"
        onClick={() => navigate({ to: '/targets' })}
      >
        ← All targets
      </button>
    </DetailPane>
  );
}
