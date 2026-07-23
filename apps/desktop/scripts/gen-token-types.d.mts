// Type declarations for gen-token-types.mjs, consumed by
// src/styles/tokens.types-drift.test.ts under tsc's strict mode.

export const SRC: string;
export const FOUNDATION_SRC: string;
export const OUT: string;

/**
 * Extracts every `--pv-*` custom-property name declared across the given CSS
 * source strings, deduped and sorted.
 */
export function extractTokenNames(cssTexts: string[]): string[];

/** Renders the tokens.d.ts file contents for a sorted, deduped token-name list. */
export function renderTokenTypesDts(sortedNames: string[]): string;
