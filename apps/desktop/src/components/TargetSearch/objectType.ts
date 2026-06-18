/**
 * Human-readable labels for the spec-035 `TargetObjectType` enum.
 *
 * Kept in a separate module so both the component and its tests share a single
 * source of truth for the display strings.
 */

import type { TargetObjectType } from '@/bindings/index';

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

/** Map a `TargetObjectType` to a user-facing label. */
export function objectTypeLabel(type: TargetObjectType): string {
  return OBJECT_TYPE_LABELS[type] ?? 'Other';
}
