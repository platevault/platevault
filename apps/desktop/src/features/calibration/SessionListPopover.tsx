/**
 * SessionListPopover — compact anchored pop-out for a list of session names.
 *
 * Shows a count trigger ("3 ▾") that opens a base-ui Popover with a search
 * input and scrollable filtered list. Zero names → plain "None" (no trigger).
 * Portaled so it is never clipped by the detail panel's overflow.
 */

import { Popover } from '@base-ui-components/react/popover';
import { useId, useRef, useState } from 'react';
import { m } from '@/lib/i18n';

interface Props {
  label: string;
  names: string[];
}

export function SessionListPopover({ label, names }: Props) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? names.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : names;

  return (
    <div>
      <div className="alm-session-detail2__head">{label}</div>
      {names.length === 0 ? (
        <span className="alm-session-detail2__muted">{m.common_none()}</span>
      ) : (
        <Popover.Root
          onOpenChange={(open) => {
            setQuery('');
            if (open) {
              // Focus the search input after the popup mounts.
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
        >
          <Popover.Trigger className="alm-session-popover__trigger">
            {names.length} ▾
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="bottom" align="start" sideOffset={4}>
              <Popover.Popup className="alm-session-popover__popup">
                {}
                <label htmlFor={inputId} className="alm-visually-hidden">
                  {m.calibration_session_popover_filter_label()}
                </label>
                <input
                  ref={inputRef}
                  id={inputId}
                  className="alm-session-popover__search"
                  placeholder={m.calibration_session_popover_filter_placeholder()}
                  aria-label={m.calibration_session_popover_filter_label()}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <ul className="alm-session-popover__list">
                  {filtered.length === 0 ? (
                    <li className="alm-session-popover__empty">
                      {m.calibration_session_popover_no_matches()}
                    </li>
                  ) : (
                    filtered.map((name) => (
                      <li key={name} className="alm-session-popover__item">
                        {name}
                      </li>
                    ))
                  )}
                </ul>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
