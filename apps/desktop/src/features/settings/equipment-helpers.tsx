// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure helpers + presentational bits shared by the Equipment pane's four
 * CRUD sections (cameras, telescopes, optical trains, filters).
 */
import { Pill } from '@/ui';
import { m } from '@/lib/i18n';
import type { Camera, FilterCategory } from './settingsIpc';

export type DeleteTarget =
  | { kind: 'camera'; id: string; name: string }
  | { kind: 'telescope'; id: string; name: string }
  | { kind: 'train'; id: string; name: string }
  | { kind: 'filter'; id: string; name: string };

// ── Shared helpers ─────────────────────────────────────────────────────────────

export function parseAliases(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatAliases(aliases: string[]): string {
  return aliases.length > 0 ? aliases.join(', ') : '—';
}

/** Case/whitespace-insensitive name collision check against an entity list. */
export function isDuplicateName<T extends { id: string; name: string }>(
  items: T[],
  name: string,
  excludeId: string | null,
): boolean {
  const normalized = name.trim().toLowerCase();
  return items.some(
    (item) =>
      item.id !== excludeId && item.name.trim().toLowerCase() === normalized,
  );
}

/**
 * True when any of `aliases` collides with another item's aliases
 * (case/whitespace-insensitive). Aliases are the FITS header join key
 * (`INSTRUME`/`TELESCOP`), so cross-item collisions make session→equipment
 * resolution ambiguous — worse than a duplicate display name (#659).
 */
export function hasDuplicateAlias<T extends { id: string; aliases: string[] }>(
  items: T[],
  aliases: string[],
  excludeId: string | null,
): boolean {
  const normalized = new Set(aliases.map((a) => a.trim().toLowerCase()));
  return items.some(
    (item) =>
      item.id !== excludeId &&
      item.aliases.some((a) => normalized.has(a.trim().toLowerCase())),
  );
}

/** Parses a focal-length input; blank → null, non-numeric → null. */
export function parseFocalLength(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ── Camera sensor geometry (migration 0079) ─────────────────────────────────

/**
 * A parsed sensor-geometry input.
 *
 * Distinct from [`parseFocalLength`], which folds unparseable text into
 * `null`. Geometry must tell "not provided" apart from "provided but
 * meaningless": the first persists as absent and yields no field of view, the
 * second has to be rejected, so a zero or negative value can never reach the
 * FOV computation and render as a real, degenerate field.
 */
export type GeometryInput =
  | { kind: 'absent' }
  | { kind: 'valid'; value: number }
  | { kind: 'invalid' };

/**
 * Parses one geometry field. Blank is absent; anything non-finite or `<= 0`
 * is invalid. `integer` rounds pixel counts, which are whole pixels.
 */
export function parseGeometry(text: string, integer: boolean): GeometryInput {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'absent' };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return { kind: 'invalid' };
  return { kind: 'valid', value: integer ? Math.round(n) : n };
}

/** Table-cell summary of a train's derived FOV; absent → "Not known". */
export function fovSummary(fovDiagonalDeg: number | null | undefined): string {
  if (fovDiagonalDeg == null) return m.settings_equipment_fov_unknown();
  return m.settings_equipment_fov_value({ degrees: fovDiagonalDeg.toFixed(2) });
}

// ── Camera sensor type (spec 044 iteration 2026-07-15, FR-035/T045) ──────────

/** The OSC passband presets exposed in the form; stored as a band array. */
export type PassbandChoice = 'rgb' | 'ha_oiii' | 'ha_sii_oiii';

export const PASSBAND_BANDS: Record<
  Exclude<PassbandChoice, 'rgb'>,
  string[]
> = {
  ha_oiii: ['Ha', 'OIII'],
  ha_sii_oiii: ['Ha', 'SII', 'OIII'],
};

/** Contract passband (`null` = plain color/rgb) → form preset. */
export function passbandChoiceFrom(passband: string[] | null): PassbandChoice {
  if (!passband || passband.length === 0) return 'rgb';
  return passband.includes('SII') ? 'ha_sii_oiii' : 'ha_oiii';
}

/** Form preset → contract passband (`null` = plain color/rgb default). */
export function passbandBandsFrom(choice: PassbandChoice): string[] | null {
  return choice === 'rgb' ? null : PASSBAND_BANDS[choice];
}

/** Render-time factory (spec 046 #8b) so labels re-read the active locale. */
export function passbandLabel(choice: PassbandChoice): string {
  switch (choice) {
    case 'rgb':
      return m.settings_equipment_passband_rgb();
    case 'ha_oiii':
      return m.settings_equipment_passband_ha_oiii();
    case 'ha_sii_oiii':
      return m.settings_equipment_passband_ha_sii_oiii();
  }
}

/** Table-cell summary of a camera's sensor configuration; unknown → '—'. */
export function sensorSummary(camera: Camera): string {
  if (camera.sensorType === 'mono') return m.settings_equipment_sensor_mono();
  if (camera.sensorType === 'osc') {
    return `${m.settings_equipment_sensor_osc()} · ${passbandLabel(
      passbandChoiceFrom(camera.passband),
    )}`;
  }
  return '—';
}

export const FILTER_CATEGORIES: FilterCategory[] = [
  'narrowband',
  'broadband',
  'dual_band',
  'other',
  'custom',
];

/** Render-time factory (spec 046 #8b) so category labels re-read the active locale. */
export function filterCategoryLabel(category: FilterCategory): string {
  switch (category) {
    case 'narrowband':
      return m.settings_equipment_category_narrowband();
    case 'broadband':
      return m.settings_equipment_category_broadband();
    case 'dual_band':
      return m.settings_equipment_category_dual_band();
    case 'other':
      return m.settings_equipment_category_other();
    case 'custom':
      return m.settings_equipment_category_custom();
  }
}

export function autoDetectedBadge(autoDetected: boolean) {
  return (
    <span className="pv-equipment__badges">
      {autoDetected ? (
        <Pill variant="info">{m.settings_equipment_auto_detected()}</Pill>
      ) : (
        <Pill variant="neutral">{m.settings_equipment_manual()}</Pill>
      )}
    </span>
  );
}
