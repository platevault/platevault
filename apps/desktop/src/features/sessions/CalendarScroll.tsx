/**
 * CalendarScroll -- vertical timeline using @tanstack/react-virtual
 * with sticky month headers. Each row is one night with session badges.
 */

import { useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Pill } from '@/ui';
import { formatMonthYear } from '@/lib/datetime';
import { m } from '@/lib/i18n';

export interface CalendarNight {
  date: string;
  sessions: Array<{
    id: string;
    target: string;
    filter: string;
    frames: number;
  }>;
}

export interface CalendarScrollProps {
  nights: CalendarNight[];
  onNightSelect?: (date: string) => void;
}

interface CalendarRow {
  type: 'header' | 'night';
  label: string;
  night?: CalendarNight;
}

function groupNightsByMonth(nights: CalendarNight[]): CalendarRow[] {
  const rows: CalendarRow[] = [];
  let currentMonth = '';

  for (const night of nights) {
    const month = night.date.slice(0, 7); // YYYY-MM
    if (month !== currentMonth) {
      currentMonth = month;
      rows.push({
        type: 'header',
        label: formatMonthYear(night.date),
      });
    }
    rows.push({
      type: 'night',
      label: night.date,
      night,
    });
  }

  return rows;
}

export function CalendarScroll({ nights, onNightSelect }: CalendarScrollProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => groupNightsByMonth(nights), [nights]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index].type === 'header' ? 36 : 52),
    overscan: 10,
  });

  return (
    <div
      ref={parentRef}
      className="alm-calendar-scroll"
      role="list"
      aria-label={m.sessions_calendar_aria()}
    >
      <div
        className="alm-calendar-scroll__inner"
        // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer total height (getTotalSize)
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (row.type === 'header') {
            return (
              <div
                key={virtualRow.key}
                className="alm-calendar-scroll__month-header"
                // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer translateY + height for month header row
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  height: `${virtualRow.size}px`,
                }}
                role="heading"
                aria-level={3}
              >
                {row.label}
              </div>
            );
          }

          const night = row.night!;
          return (
            <div
              key={virtualRow.key}
              className="alm-calendar-scroll__night"
              // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer translateY + height for night row
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                height: `${virtualRow.size}px`,
              }}
              role="listitem"
              tabIndex={0}
              onClick={() => onNightSelect?.(night.date)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNightSelect?.(night.date);
                }
              }}
            >
              <span className="alm-calendar-scroll__date alm-mono">{night.date}</span>
              <span className="alm-calendar-scroll__badges">
                {night.sessions.map((s) => (
                  <Pill key={s.id} variant="ghost">
                    {`${s.target} ${s.filter}`}
                  </Pill>
                ))}
              </span>
              <span className="alm-calendar-scroll__frame-count alm-mono">
                {night.sessions.reduce((sum, s) => sum + s.frames, 0)} {m.sessions_calendar_frames_suffix()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
