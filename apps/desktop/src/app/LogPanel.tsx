import { useEffect } from 'react';
import { Collapsible } from '@base-ui-components/react/collapsible';
import { Progress } from '@base-ui-components/react/progress';
import { useLogPanel } from './LogPanelContext';
import type { ProgressEvent } from '@/bindings/types';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const MOCK_EVENTS: Array<{ time: string; level: LogLevel; message: string }> = [
  { time: '22:15:04', level: 'info',  message: 'Scan completed: 1,247 files indexed' },
  { time: '22:15:02', level: 'warn',  message: 'FITS keyword OBJECT missing on 3 frames in /raw/2026-04-18/' },
  { time: '22:14:59', level: 'error', message: 'Failed to read: /raw/2026-04-17/frame_0043.fit — permission denied' },
  { time: '22:14:58', level: 'info',  message: 'Processing /astro/raw/2026-04-18/' },
  { time: '22:14:56', level: 'debug', message: 'Metadata cache hit for root hash a3f9c12' },
  { time: '22:14:55', level: 'info',  message: 'Scan started for root /astro/raw' },
  { time: '22:14:50', level: 'debug', message: 'Loaded preferences: density=comfortable, theme=system' },
  { time: '22:14:48', level: 'warn',  message: 'Root /external/drive not found — reconnect drive to restore' },
];

const MOCK_OPERATIONS: Array<{
  id: string;
  label: string;
  progress: number;
}> = [
  { id: 'op-001', label: 'Indexing metadata', progress: 100 },
];

export function LogPanel() {
  const { expanded, toggle } = useLogPanel();

  // Close log panel on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && expanded) {
        e.preventDefault();
        toggle();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expanded, toggle]);

  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={toggle}
      className="alm-logpanel"
      role="log"
      aria-label="Operation log"
    >
      <div className="alm-logpanel__header">
        <span className="alm-logpanel__title">Activity</span>
        <Collapsible.Trigger
          className="alm-btn alm-btn--ghost alm-btn--sm"
          aria-label="Collapse log panel"
        >
          ▾
        </Collapsible.Trigger>
      </div>
      <Collapsible.Panel className="alm-logpanel__body">
        {MOCK_OPERATIONS.map((op) => (
          <div key={op.id} className="alm-logpanel__op">
            <Progress.Root value={op.progress} className="alm-logpanel__progress-root">
              <Progress.Label className="alm-logpanel__op-label">
                {op.label}
              </Progress.Label>
              <Progress.Track className="alm-logpanel__progress">
                <Progress.Indicator className="alm-logpanel__progress-fill" />
              </Progress.Track>
            </Progress.Root>
          </div>
        ))}
        <ul className="alm-logpanel__events">
          {MOCK_EVENTS.map((ev, i) => (
            <li key={i} className="alm-logpanel__event">
              <span className="alm-logpanel__event-time">{ev.time}</span>
              <span className={`alm-logpanel__event-level alm-logpanel__event-level--${ev.level}`}>{ev.level}</span>
              <span className="alm-logpanel__event-msg">{ev.message}</span>
            </li>
          ))}
        </ul>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
