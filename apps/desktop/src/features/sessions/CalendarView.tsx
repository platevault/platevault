/**
 * CalendarView -- month grid with prominent session badges and hover tooltips.
 * Updated per spec 030 T074.
 */

import { useQuery, createQueryStore } from '@/data/store';
import { getSessionsCalendar } from '@/api/commands';
import { clsx } from 'clsx';
import { Pill } from '@/ui';

const calendarStore = createQueryStore(() =>
  getSessionsCalendar({ start_month: '2026-04', end_month: '2026-06' }),
);

interface CalendarViewProps {
  onDaySelect?: (date: string) => void;
}

export function CalendarView({ onDaySelect }: CalendarViewProps) {
  const { data, loading } = useQuery(calendarStore);

  if (loading || !data) {
    return <div className="alm-calendar__loading">Loading calendar...</div>;
  }

  return (
    <div className="alm-calendar" role="grid" aria-label="Session calendar">
      {data.months.map((month) => (
        <div key={`${month.year}-${month.month}`} className="alm-calendar__month">
          <h3 className="alm-calendar__month-title">
            {new Date(month.year, month.month - 1).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
            })}
          </h3>
          <div className="alm-calendar__grid" role="row">
            {Array.from({ length: daysInMonth(month.year, month.month) }, (_, i) => {
              const day = i + 1;
              const dayData = month.days.find((d) => d.day === day);
              const hasSessions = dayData && dayData.sessions.length > 0;
              const dateStr = `${month.year}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const tooltipText = hasSessions
                ? dayData.sessions.map((s) => `${s.target} ${s.filter}`).join(', ')
                : undefined;

              return (
                <div
                  key={day}
                  className={clsx(
                    'alm-calendar__day',
                    hasSessions && 'alm-calendar__day--has-data',
                  )}
                  role="gridcell"
                  tabIndex={hasSessions ? 0 : -1}
                  title={tooltipText}
                  aria-label={hasSessions ? `${dateStr}: ${tooltipText}` : dateStr}
                  onClick={() => {
                    if (hasSessions) {
                      onDaySelect?.(dateStr);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (hasSessions && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onDaySelect?.(dateStr);
                    }
                  }}
                >
                  <span className="alm-calendar__day-num">{day}</span>
                  {dayData?.sessions.map((s) => (
                    <Pill
                      key={s.id}
                      label={`${s.target} ${s.filter}`}
                      variant="info"
                      size="sm"
                    />
                  ))}
                  {hasSessions && dayData.sessions.length > 2 && (
                    <span className="alm-calendar__day-overflow">
                      +{dayData.sessions.length - 2} more
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
