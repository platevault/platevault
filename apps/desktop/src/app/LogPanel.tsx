import { useEffect } from 'react';
import { Collapsible } from '@base-ui-components/react/collapsible';
import { Progress } from '@base-ui-components/react/progress';
import { useLogPanel } from './LogPanelContext';
import type { ProgressEvent } from '@/api/types';

const MOCK_EVENTS: Array<{ time: string; message: string }> = [
  { time: '22:15:01', message: 'Scan completed: 1,247 files indexed' },
  { time: '22:14:58', message: 'Processing /astro/raw/2026-04-18/' },
  { time: '22:14:55', message: 'Scan started for root /astro/raw' },
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
              <span className="alm-logpanel__event-msg">{ev.message}</span>
            </li>
          ))}
        </ul>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
