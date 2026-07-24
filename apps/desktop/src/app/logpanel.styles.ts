// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Panda CSS styles for the LogPanel component.
 * Replaces the BEM classes from logpanel.css.
 */

import { css, cva } from '@styled-system/css';

// ── Layout ────────────────────────────────────────────────────────────────────

export const logpanel = css({
  display: 'flex',
  flexDirection: 'column',
  flex: '0 0 40%',
  minHeight: '180px',
  borderTop: '1px solid var(--pv-border)',
  background: 'var(--pv-surface)',
});

export const header = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--pv-sp-2)',
  padding: 'var(--pv-sp-2) var(--pv-sp-3)',
  borderBottom: '1px solid var(--pv-border-subtle)',
  flexShrink: 0,
});

export const title = css({
  fontSize: 'var(--pv-text-xs)',
  fontWeight: 'var(--pv-weight-semibold)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--pv-tracking-normal)',
  color: 'var(--pv-text-secondary)',
});

export const filters = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--pv-sp-1)',
  minWidth: 0,
});

export const filtersSources = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--pv-sp-1)',
  minWidth: 0,
  flex: '1 0 100%',
});

export const actions = css({
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--pv-sp-1)',
  marginLeft: 'auto',
});

// ── Chip recipe (variant: active/inactive) ────────────────────────────────────

export const chipRecipe = cva({
  base: {
    // Base chip inherits pv-btn--ghost pv-btn--xs from external classes
  },
  variants: {
    active: {
      true: {
        background: 'var(--pv-accent-bg)',
        color: 'var(--pv-accent-text)',
        borderColor: 'var(--pv-accent)',
      },
      false: {},
    },
  },
  defaultVariants: {
    active: false,
  },
});

// ── Export error ──────────────────────────────────────────────────────────────

export const exportError = css({
  padding: 'var(--pv-sp-2) var(--pv-sp-3)',
  fontSize: 'var(--pv-text-xs)',
  color: 'var(--pv-danger)',
  background: 'var(--pv-danger-bg)',
  borderBottom: '1px solid var(--pv-danger-border)',
  flexShrink: 0,
});

// ── Body + events ─────────────────────────────────────────────────────────────

export const body = css({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
});

export const truncationMarker = css({
  padding: 'var(--pv-sp-1) var(--pv-sp-3)',
  fontSize: 'var(--pv-text-xs)',
  color: 'var(--pv-warn)',
  background: 'var(--pv-warn-bg)',
  borderBottom: '1px solid var(--pv-warn-border)',
  flexShrink: 0,
});

export const events = css({
  listStyle: 'none',
  padding: 0,
  margin: 0,
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
});

export const empty = css({
  display: 'flex',
  height: '100%',
  minHeight: 0,
});

// ── Event row ─────────────────────────────────────────────────────────────────

export const event = css({
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--pv-sp-2)',
  padding: 'var(--pv-sp-1) var(--pv-sp-3)',
  fontSize: 'var(--pv-text-xs)',
  borderBottom: '1px solid var(--pv-border-subtle)',
  _last: { borderBottom: 'none' },
});

export const eventLink = css({
  cursor: 'pointer',
  _hover: { background: 'var(--pv-hover-bg)' },
  _focusVisible: {
    outline: 'none',
    boxShadow: 'var(--pv-focus-ring)',
  },
});

export const eventTime = css({
  color: 'var(--pv-text-muted)',
  minWidth: '64px',
  flexShrink: 0,
});

// Level recipe (color by severity)
export const levelRecipe = cva({
  base: {
    fontSize: 'var(--pv-text-xs)',
    fontWeight: 'var(--pv-weight-medium)',
    textTransform: 'uppercase',
    minWidth: '40px',
    flexShrink: 0,
  },
  variants: {
    level: {
      info: { color: 'var(--pv-info)' },
      warn: { color: 'var(--pv-warn)' },
      error: { color: 'var(--pv-danger)' },
      debug: { color: 'var(--pv-text-muted)' },
    },
  },
});

export const eventSource = css({
  color: 'var(--pv-text-muted)',
  background: 'var(--pv-chip)',
  borderRadius: 'var(--pv-radius-sm)',
  padding: '0 var(--pv-sp-1)',
  minWidth: '64px',
  flexShrink: 0,
  textAlign: 'center',
});

export const eventContext = css({
  color: 'var(--pv-text-faint)',
  maxWidth: '200px',
  flexShrink: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const eventMsg = css({
  color: 'var(--pv-text)',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const eventLinkIndicator = css({
  marginLeft: 'auto',
  color: 'var(--pv-text-faint)',
  flexShrink: 0,
});

// Hover state for the link indicator needs parent context — handled inline.
