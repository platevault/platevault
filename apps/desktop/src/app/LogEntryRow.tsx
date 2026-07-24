// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LogEntryRow — single virtualized row in the log panel.
 *
 * Extracted from LogPanel.tsx for isolation and testability.
 */

import { useCallback } from 'react';
import { m } from '@/lib/i18n';
import type { LogEntry } from '@/data/logStore';
import { formatTimeOfDay } from '@/lib/datetime';
import {
  buildEntityPath,
  type EntityNavigateFn,
  type AuditNavigateFn,
} from './log-panel-model';

export interface LogEntryRowProps {
  entry: LogEntry;
  onNavigateEntity: EntityNavigateFn;
  onNavigateAudit: AuditNavigateFn;
  /** Virtual-row positioning style (absolute + translateY). */
  style?: React.CSSProperties;
  /** Virtual-row index for the virtualizer's measure cache. */
  index?: number;
  /** Virtualizer measure callback ref. */
  measureRef?: (node: Element | null) => void;
}

export function LogEntryRow({
  entry,
  onNavigateEntity,
  onNavigateAudit,
  style,
  index,
  measureRef,
}: LogEntryRowProps) {
  const hasEntity = entry.entityType != null && entry.entityId != null;
  // #626: a link is only "linkable" when a real route exists for it (e.g.
  // `plan` has no destination yet — buildEntityPath returns null for it).
  const hasEntityLink =
    hasEntity &&
    buildEntityPath(entry.entityType ?? '', entry.entityId ?? '') != null;
  const hasAuditLink = entry.requestId != null && !hasEntity;
  // Subject context (#583): the entity/request the line is about, surfaced
  // as visible text rather than only implied by the click-to-navigate arrow.
  // Shown even when the entity has no link yet (e.g. `plan`, #626) so the
  // context isn't lost, just the click affordance.
  const contextLabel = hasEntity
    ? `${entry.entityType} · ${entry.entityId}`
    : hasAuditLink
      ? entry.requestId
      : null;

  const handleClick = useCallback(() => {
    if (hasEntityLink && entry.entityType && entry.entityId) {
      onNavigateEntity(entry.entityType, entry.entityId);
    } else if (hasAuditLink && entry.requestId) {
      onNavigateAudit(entry.requestId);
    }
  }, [entry, hasEntityLink, hasAuditLink, onNavigateEntity, onNavigateAudit]);

  const isClickable = hasEntityLink || hasAuditLink;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- interactivity is conditional; role/tabindex/keydown all upgrade to button only when clickable
    <li
      ref={measureRef}
      data-index={index}
      // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer row style passthrough (absolute + translateY)
      style={style}
      className={`pv-logpanel__event${isClickable ? ' pv-logpanel__event--link' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? 'button' : 'listitem'}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- only focusable when clickable, where role becomes button
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      aria-label={
        isClickable
          ? m.log_entry_navigate_aria({
              level: entry.level,
              message: entry.message,
            })
          : undefined
      }
    >
      <span className="pv-logpanel__event-time">
        {formatTimeOfDay(entry.time)}
      </span>
      <span
        className={`pv-logpanel__event-level pv-logpanel__event-level--${entry.level}`}
        aria-label={entry.level}
      >
        {entry.level}
      </span>
      <span
        className={`pv-logpanel__event-source pv-logpanel__event-source--${entry.source}`}
      >
        {entry.source}
      </span>
      {contextLabel && (
        <span className="pv-logpanel__event-context" title={contextLabel}>
          {contextLabel}
        </span>
      )}
      <span className="pv-logpanel__event-msg">{entry.message}</span>
      {hasEntityLink && (
        <span className="pv-logpanel__event-link-indicator" aria-hidden="true">
          →
        </span>
      )}
    </li>
  );
}
