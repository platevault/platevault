// Spec 020 — Router & URL State (desktop rescope).
//
// Single home for typed URL search-param parsing. Pure functions (no React) so
// validators are unit-testable in isolation. Pages compose these into a
// TanStack Router `validateSearch` via `makeValidateSearch`.
//
// Rules (FR-005): unknown keys are dropped; invalid values of known keys coerce
// to `undefined` (and are therefore omitted from the URL on the next write).

import type { CalibrationKind, ProjectState, SessionState } from '@/bindings';

// --- Local enums not present in bindings (UI-only filter/group vocab) ---

export type FrameType = 'light' | 'dark' | 'flat' | 'bias';
/** Inventory frame filter — includes 'mixed' sentinel (spec 006 FR-002). */
export type InventoryFrameFilter = 'light' | 'dark' | 'flat' | 'bias' | 'mixed';
/** Inventory review filter — 'all' disables state filtering (spec 006 FR-010). */
export type ReviewFilter =
  | 'all'
  | 'discovered'
  | 'candidate'
  | 'needs_review'
  | 'confirmed'
  | 'rejected'
  | 'ignored';
export type SessionsGroup = 'none' | 'target' | 'month';
export type InboxGroup = 'none' | 'type' | 'date';

// --- Runtime allow-lists (typed against bindings so they cannot drift) ---

export const SESSION_STATES = [
  'discovered',
  'candidate',
  'needs_review',
  'confirmed',
  'rejected',
  'ignored',
] as const satisfies readonly SessionState[];

export const PROJECT_STATES = [
  'setup_incomplete',
  'ready',
  'prepared',
  'processing',
  'completed',
  'archived',
  'blocked',
] as const satisfies readonly ProjectState[];

export const CALIBRATION_KINDS = [
  'dark',
  'flat',
  'bias',
  'dark_flat',
  'bad_pixel_map',
] as const satisfies readonly CalibrationKind[];

export const FRAME_TYPES = ['light', 'dark', 'flat', 'bias'] as const satisfies readonly FrameType[];
export const INVENTORY_FRAME_FILTERS = [
  'light',
  'dark',
  'flat',
  'bias',
  'mixed',
] as const satisfies readonly InventoryFrameFilter[];
export const REVIEW_FILTERS = [
  'all',
  'discovered',
  'candidate',
  'needs_review',
  'confirmed',
  'rejected',
  'ignored',
] as const satisfies readonly ReviewFilter[];
export const SESSIONS_GROUPS = ['none', 'target', 'month'] as const satisfies readonly SessionsGroup[];
export const INBOX_GROUPS = ['none', 'type', 'date'] as const satisfies readonly InboxGroup[];

// --- Parsers: (unknown) => T | undefined ---

export type Parser<T> = (value: unknown) => T | undefined;

/** Numeric id parser. Accepts a finite number or a numeric string. */
export const parseNumber: Parser<number> = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

/** Non-empty string parser. */
export const parseString: Parser<string> = (value) =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Enum parser bound to an allow-list; values outside the list coerce away. */
export function parseEnum<T extends string>(allow: readonly T[]): Parser<T> {
  const set = new Set<string>(allow);
  return (value) => (typeof value === 'string' && set.has(value) ? (value as T) : undefined);
}

/** Comma-separated multi-value enum parser; keeps only allow-listed members. */
export function parseCsvEnum<T extends string>(allow: readonly T[]): Parser<T[]> {
  const set = new Set<string>(allow);
  return (value) => {
    if (typeof value !== 'string' || value === '') return undefined;
    const parts = value
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is T => set.has(s));
    return parts.length > 0 ? parts : undefined;
  };
}

// --- validateSearch factory ---

type ParserMap = Record<string, Parser<unknown>>;

/** Resulting search type: each declared key, optional, with its parsed type. */
export type SearchOf<M extends ParserMap> = {
  [K in keyof M]?: Exclude<ReturnType<M[K]>, undefined>;
};

/**
 * Build a TanStack Router `validateSearch` from a map of parsers. Unknown keys
 * are dropped (not iterated); known keys that parse to `undefined` are omitted
 * so they never appear in the URL.
 */
export function makeValidateSearch<M extends ParserMap>(shape: M) {
  const keys = Object.keys(shape) as (keyof M)[];
  return (search: Record<string, unknown>): SearchOf<M> => {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const parsed = shape[key](search[key as string]);
      if (parsed !== undefined) out[key as string] = parsed;
    }
    return out as SearchOf<M>;
  };
}
