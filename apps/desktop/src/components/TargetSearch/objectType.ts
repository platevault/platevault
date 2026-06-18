/**
 * Human-readable labels for the spec-035 `TargetObjectType` and
 * `TargetCatalogId` enums, plus the ordered value lists used by the optional
 * search filter (T029).
 *
 * Kept in a separate module so both the component and its tests share a single
 * source of truth for the display strings.
 */

import type { TargetObjectType, TargetCatalogId } from '@/bindings/index';

const OBJECT_TYPE_LABELS: Record<TargetObjectType, string> = {
  galaxy: 'Galaxy',
  planetary_nebula: 'Planetary nebula',
  emission_nebula: 'Emission nebula',
  reflection_nebula: 'Reflection nebula',
  dark_nebula: 'Dark nebula',
  open_cluster: 'Open cluster',
  globular_cluster: 'Globular cluster',
  supernova_remnant: 'Supernova remnant',
  galaxy_cluster: 'Galaxy cluster',
  double_star: 'Double star',
  asterism: 'Asterism',
  other: 'Other',
};

/** Ordered `TargetObjectType` values for the optional type filter. */
export const OBJECT_TYPES: TargetObjectType[] = Object.keys(
  OBJECT_TYPE_LABELS,
) as TargetObjectType[];

/** Map a `TargetObjectType` to a user-facing label. */
export function objectTypeLabel(type: TargetObjectType): string {
  return OBJECT_TYPE_LABELS[type] ?? 'Other';
}

const CATALOG_LABELS: Record<TargetCatalogId, string> = {
  messier: 'Messier',
  caldwell: 'Caldwell',
  sharpless: 'Sharpless (Sh2)',
  abell_pn: 'Abell (planetary nebulae)',
  abell_galaxies: 'Abell (galaxy clusters)',
  arp: 'Arp',
  vdb: 'van den Bergh (vdB)',
  barnard: 'Barnard',
  lbn: 'LBN',
  ldn: 'LDN',
  melotte: 'Melotte',
  common: 'Common names',
  openngc: 'NGC / IC (OpenNGC)',
};

/** Ordered `TargetCatalogId` values for the optional catalogue filter. */
export const CATALOG_IDS: TargetCatalogId[] = Object.keys(
  CATALOG_LABELS,
) as TargetCatalogId[];

/** Map a `TargetCatalogId` to a user-facing label. */
export function catalogLabel(id: TargetCatalogId): string {
  return CATALOG_LABELS[id] ?? id;
}
