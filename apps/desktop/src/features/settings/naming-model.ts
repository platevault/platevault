// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Pure token/pattern model shared by the NamingStructure pane's editors
 * (spec 015 Token Pattern Builder, spec 041 T051 per-type destination
 * patterns).
 */
import type { PatternPart } from './settingsIpc';
import { m } from '@/lib/i18n';

export const NAMING_KEYS = ['pattern', 'autoApplyPattern', 'patternsByType'];

// ── Token / separator vocabulary ──────────────────────────────────────────────

export const AVAILABLE_TOKENS = [
  'target',
  'filter',
  'date',
  'frame_type',
  'camera',
  'exposure',
  'gain',
  'binning',
  'set_temp',
] as const;

export const SEPARATORS = ['/', '-', '_', ' '] as const;

// ── Per-type path-pattern chip representation ─────────────────────────────────
//
// Per-type destination patterns are stored as path strings (e.g.
// `masters/flats/{filter}/`). We parse them into an ordered list of chips that
// can be three kinds:
//   - 'token'   — a `{name}` placeholder, e.g. `{filter}`
//   - 'literal' — a bare directory segment, e.g. `flats`, `masters`
//   - 'sep'     — a `/` path separator
//
// This is intentionally separate from the `PatternPart` model used by the
// Project Folder Pattern, which only has 'token' and 'separator' (and its
// separators include `-`, `_`, ` ` in addition to `/`). Per-type patterns are
// always path strings, so the only meaningful separator is `/`.

export type PathChipKind = 'token' | 'literal' | 'sep';

export interface PathChip {
  id: string;
  kind: PathChipKind;
  /** For 'token': the token name (without braces). For 'literal': the segment text. For 'sep': always '/'. */
  value: string;
}

let _pathChipCounter = 1000;
export function nextPathId(): string {
  return `pc${(_pathChipCounter++).toString()}`;
}

/**
 * Parse a per-type destination pattern string into an ordered list of PathChips.
 *
 * The string is split on `/` boundaries. Each part between slashes is either a
 * `{token}` placeholder or a bare literal segment. The `/` separators become
 * 'sep' chips. An empty string produces an empty array.
 *
 * Examples:
 *   'masters/flats/{filter}/'  →  [literal:'masters', sep, literal:'flats', sep, token:'filter', sep]
 *   '{target}/{filter}/{date}/light/'  →  [token:'target', sep, token:'filter', sep, token:'date', sep, literal:'light', sep]
 */
export function parsePathPattern(pattern: string): PathChip[] {
  if (pattern.trim() === '') return [];
  const chips: PathChip[] = [];
  // Walk through the string manually so we preserve every `/` as a sep chip.
  let rest = pattern;
  while (rest.length > 0) {
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) {
      // No more slashes — remaining text is a segment (no trailing sep)
      const seg = rest;
      if (seg.startsWith('{') && seg.endsWith('}')) {
        chips.push({
          id: nextPathId(),
          kind: 'token',
          value: seg.slice(1, -1),
        });
      } else if (seg !== '') {
        chips.push({ id: nextPathId(), kind: 'literal', value: seg });
      }
      break;
    }
    // There is a slash at slashIdx
    const seg = rest.slice(0, slashIdx);
    if (seg.startsWith('{') && seg.endsWith('}')) {
      chips.push({ id: nextPathId(), kind: 'token', value: seg.slice(1, -1) });
    } else if (seg !== '') {
      chips.push({ id: nextPathId(), kind: 'literal', value: seg });
    }
    chips.push({ id: nextPathId(), kind: 'sep', value: '/' });
    rest = rest.slice(slashIdx + 1);
  }
  return chips;
}

/**
 * Serialize an ordered list of PathChips back to a per-type destination pattern string.
 *
 * token → `{name}`, literal → bare text, sep → `/`. The chips are concatenated directly.
 */
export function serializePathPattern(chips: PathChip[]): string {
  return chips
    .map((c) => (c.kind === 'token' ? `{${c.value}}` : c.value))
    .join('');
}

// ── Per-frame-type destination patterns (spec 041 T051, FR-026b) ──────────────
//
// The backend stores these under ONE naming-scope key, `patternsByType`: a
// JSON object mapping a frame-type class name to a pattern string. The seven
// class names below are the exact strings the backend recognises. An absent key
// (or empty input) means "use the built-in default" — only overridden classes
// are persisted.

export const FRAME_TYPE_CLASSES = [
  'light',
  'flat',
  'dark',
  'bias',
  'master_flat',
  'master_dark',
  'master_bias',
] as const;
export type FrameTypeClass = (typeof FRAME_TYPE_CLASSES)[number];

/** Render-time factory (spec 046 #8b) so frame-type labels re-read the active locale. */
export function frameTypeLabel(cls: FrameTypeClass): string {
  switch (cls) {
    case 'light':
      return m.inbox_kind_light();
    case 'flat':
      return m.inbox_kind_flat();
    case 'dark':
      return m.common_dark();
    case 'bias':
      return m.common_bias();
    case 'master_flat':
      return m.settings_naming_frametype_master_flat();
    case 'master_dark':
      return m.settings_naming_frametype_master_dark();
    case 'master_bias':
      return m.settings_naming_frametype_master_bias();
  }
}

// Built-in defaults shown as the placeholder / reset target per type.
export const FRAME_TYPE_DEFAULT_PATTERNS: Record<FrameTypeClass, string> = {
  light: '{target}/{filter}/{date}/light/',
  flat: 'flats/{filter}/{date}/',
  dark: 'darks/{exposure}/',
  bias: 'bias/',
  master_flat: 'masters/flats/{filter}/',
  master_dark: 'masters/darks/{exposure}/',
  master_bias: 'masters/bias/',
};

// Valid `{token}` names (mirrors the backend token vocabulary). Literal path
// segments are allowed; only `{...}` tokens are validated.
const VALID_PATTERN_TOKENS = new Set(AVAILABLE_TOKENS);

/**
 * Client-side mirror of the backend token rule. Returns an error message when
 * the pattern references an unknown `{token}`, else `null`. An empty string is
 * NOT an error here — it means "use the built-in default". The backend
 * `value.invalid` result remains the source of truth on save.
 */
export function validatePatternString(value: string): string | null {
  if (value.trim() === '') return null; // empty = use default
  const unknown: string[] = [];
  const re = /\{([^}]*)\}/g;
  for (const match of value.matchAll(re)) {
    const token = match[1];
    if (!VALID_PATTERN_TOKENS.has(token as (typeof AVAILABLE_TOKENS)[number])) {
      unknown.push(token);
    }
  }
  if (unknown.length > 0) {
    return `${m.settings_naming_unknown_tokens({ count: unknown.length })}: ${unknown.map((t) => `{${t}}`).join(', ')}`;
  }
  return null;
}

// ── Sample metadata for live preview (R-Preview) ─────────────────────────────

export const SAMPLE_METADATA = {
  target: 'NGC7000',
  filter: 'Ha',
  date: '2026-04-12',
  frameType: 'light' as const,
  camera: 'ASI2600MM',
  exposure: '300s',
  gain: '100',
  binning: '1x1',
  setTemp: '-10C',
};

// ── Per-type live preview (package P11: real backend resolver) ───────────────
//
// The canonical resolver lives in the Rust `patterns` crate
// (`crates/patterns/src/resolver.rs::resolve_pattern_str`), which handles the
// literal path segments (e.g. `flats`, `masters`) that per-type destination
// patterns rely on, alongside the same sanitization/traversal/reserved-name
// pipeline used everywhere else. It is exposed via the `pattern.path_preview`
// Tauri command (`patternPathPreview` in `./settingsIpc`). Sample metadata
// values are distinct from the top pattern preview's `SAMPLE_METADATA` so the
// two live previews are visually distinguishable at a glance.

export const PER_TYPE_SAMPLE_METADATA = {
  target: 'IC1396',
  filter: 'Ha',
  date: '2024-10-20',
  frameType: 'light',
  camera: 'ASI2600MM',
  exposure: '300s',
  gain: '100',
  binning: '1x1',
  setTemp: '-10C',
};

// ── Default pattern {target}/{filter}/{date}/{frame_type}/ ────────────────────

export const DEFAULT_PATTERN: PatternPart[] = [
  { id: 'p0', kind: 'token', value: 'target' },
  { id: 'p1', kind: 'separator', value: '/' },
  { id: 'p2', kind: 'token', value: 'filter' },
  { id: 'p3', kind: 'separator', value: '/' },
  { id: 'p4', kind: 'token', value: 'date' },
  { id: 'p5', kind: 'separator', value: '/' },
  { id: 'p6', kind: 'token', value: 'frame_type' },
  { id: 'p7', kind: 'separator', value: '/' },
];

// ── Stable id generation ──────────────────────────────────────────────────────

let _idCounter = 100;
export function nextId(): string {
  return `pp${(_idCounter++).toString()}`;
}

// ── Empty chip array sentinel — used to detect "using default" state ─────────

export function chipsAreEmpty(chips: PathChip[]): boolean {
  return chips.length === 0;
}

export function emptyChipsByClass(): Record<FrameTypeClass, PathChip[]> {
  const result = {} as Record<FrameTypeClass, PathChip[]>;
  for (const cls of FRAME_TYPE_CLASSES) result[cls] = [];
  return result;
}
