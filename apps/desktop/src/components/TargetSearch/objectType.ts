/**
 * Human-readable labels for the spec-035 `TargetObjectType` and
 * `TargetCatalogId` enums, plus the ordered value lists used by the optional
 * search filter (T029).
 *
 * Kept in a separate module so both the component and its tests share a single
 * source of truth for the display strings.
 */

import type { TargetObjectType, TargetCatalogId } from '@/bindings/index';
import { m } from '@/lib/i18n';

// `label` is a render-time thunk so it re-reads the active locale (spec 046
// #8) — the Record itself stays exhaustive over `TargetObjectType`, but no
// `m.*()` call happens until `objectTypeLabel` actually invokes the thunk.
const OBJECT_TYPE_LABEL_FNS: Record<TargetObjectType, () => string> = {
  galaxy: () => m.targets_objtype_galaxy(),
  planetary_nebula: () => m.targets_objtype_planetary_nebula(),
  emission_nebula: () => m.targets_objtype_emission_nebula(),
  reflection_nebula: () => m.targets_objtype_reflection_nebula(),
  dark_nebula: () => m.targets_objtype_dark_nebula(),
  open_cluster: () => m.targets_objtype_open_cluster(),
  globular_cluster: () => m.targets_objtype_globular_cluster(),
  supernova_remnant: () => m.targets_objtype_supernova_remnant(),
  galaxy_cluster: () => m.targets_objtype_galaxy_cluster(),
  double_star: () => m.targets_objtype_double_star(),
  asterism: () => m.targets_objtype_asterism(),
  other: () => m.targets_objtype_other(),
};

/** Ordered `TargetObjectType` values for the optional type filter. */
export const OBJECT_TYPES: TargetObjectType[] = Object.keys(
  OBJECT_TYPE_LABEL_FNS,
) as TargetObjectType[];

/** Map a `TargetObjectType` to a user-facing label. */
export function objectTypeLabel(type: TargetObjectType): string {
  return OBJECT_TYPE_LABEL_FNS[type]?.() ?? m.targets_objtype_other();
}

// Same render-time-thunk pattern as above (spec 046 #8). Several catalogue ids
// share exact wording with the Planner's `PLANNER_CATALOGS` labels
// (planner-catalog.ts) and reuse those message keys rather than duplicating.
const CATALOG_LABEL_FNS: Record<TargetCatalogId, () => string> = {
  messier: () => m.targets_catalog_messier(),
  caldwell: () => m.targets_catalog_caldwell(),
  sharpless: () => m.targets_catid_sharpless(),
  abell_pn: () => m.targets_catid_abell_pn(),
  abell_galaxies: () => m.targets_catid_abell_galaxies(),
  arp: () => m.targets_catid_arp(),
  vdb: () => m.targets_catid_vdb(),
  barnard: () => m.targets_catalog_barnard(),
  lbn: () => m.targets_catalog_lbn(),
  ldn: () => m.targets_catalog_ldn(),
  melotte: () => m.targets_catid_melotte(),
  common: () => m.targets_catid_common(),
  openngc: () => m.targets_catid_openngc(),
};

/** Ordered `TargetCatalogId` values for the optional catalogue filter. */
export const CATALOG_IDS: TargetCatalogId[] = Object.keys(
  CATALOG_LABEL_FNS,
) as TargetCatalogId[];

/** Map a `TargetCatalogId` to a user-facing label. */
export function catalogLabel(id: TargetCatalogId): string {
  return CATALOG_LABEL_FNS[id]?.() ?? id;
}
