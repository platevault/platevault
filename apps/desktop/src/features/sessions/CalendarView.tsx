import { useQuery, createQueryStore } from '@/data/store';
import { getSessionsCalendar } from '@/api/commands';
import type { CalendarData } from '@/api/types';

const calendarStore = createQueryStore(() =>
  getSessionsCalendar({ start_month: '2026-04', end_month: '2026-06' }),
);

export function CalendarView() {
  const { data, loading } = useQuery(calendarStore);

  if (loading || !data) {
    return <div className="alm-calendar__loading">Loading calendar...</div>;
  }

  return (
    <div className="alm-calendar">
      {data.months.map((month) => (
        <div key={`${month.year}-${month.month}`} className="alm-calendar__month">
          <h3 className="alm-calendar__month-title">
            {new Date(month.year, month.month - 1).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
            })}
          </h3>
          <div className="alm-calendar__grid">
            {Array.from({ length: daysInMonth(month.year, month.month) }, (_, i) => {
              const day = i + 1;
              const dayData = month.days.find((d) => d.day === day);
              const hasSessions = dayData && dayData.sessions.length > 0;
              return (
                <div
                  key={day}
                  className={`alm-calendar__day ${hasSessions ? 'alm-calendar__day--has-data' : ''}`}
                  onClick={() => {
                    if (hasSessions) {
                      console.log('Filter by day:', `${month.year}-${month.month}-${day}`);
                    }
                  }}
                >
                  <span className="alm-calendar__day-num">{day}</span>
                  {dayData?.sessions.map((s) => (
                    <span key={s.id} className="alm-calendar__session-pill">
                      {s.target} {s.filter}
                    </span>
                  ))}
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
