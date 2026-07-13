/**
 * ProjectStatusTag — thin alias of the shared {@link StatusTag} (Tier 2).
 *
 * Retained so project call sites and tests keep importing a project-named
 * symbol; the dot+label implementation now lives in `@/components`. The
 * `variant` maps directly to the `PillVariant` produced by
 * `projectStateVariant()`, so callers need no extra mapping.
 */

export { StatusTag as ProjectStatusTag } from '@/components';
export type { StatusTagProps as ProjectStatusTagProps } from '@/components';
