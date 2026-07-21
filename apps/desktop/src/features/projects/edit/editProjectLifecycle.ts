// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lifecycle gating helpers for EditProjectPane (extracted, #1000).
 *
 * Pure lookups over `ProjectDetailDto.lifecycle` — no component state.
 */

const TOOL_LOCKED_LIFECYCLES = new Set([
  'prepared',
  'processing',
  'completed',
  'blocked',
]);
const READ_ONLY_LIFECYCLES = new Set(['archived']);
// Spec 008 FR-011 (crates/domain/core/src/project/validate.rs
// SOURCE_REMOVE_LOCKED_LIFECYCLES) — distinct from the tool lock set above:
// removal is refused for archived too, but not for 'blocked'.
const SOURCE_REMOVE_LOCKED_LIFECYCLES = new Set([
  'prepared',
  'processing',
  'completed',
  'archived',
]);

export function isToolLocked(lifecycle: string) {
  return TOOL_LOCKED_LIFECYCLES.has(lifecycle);
}

export function isReadOnly(lifecycle: string) {
  return READ_ONLY_LIFECYCLES.has(lifecycle);
}

export function isSourceRemoveLocked(lifecycle: string) {
  return SOURCE_REMOVE_LOCKED_LIFECYCLES.has(lifecycle);
}
