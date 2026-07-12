import type { HTMLAttributes } from 'react';
import { Tooltip } from '@base-ui-components/react/tooltip';
import { m } from '@/lib/i18n';

export interface LockProps extends HTMLAttributes<HTMLSpanElement> {
  reason?: string;
}

export function Lock({ reason, className, ...rest }: LockProps) {
  const label = reason ?? m.settings_cleanup_protection_protected();
  const cls = ['alm-lock', className].filter(Boolean).join(' ');
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger
          className={cls}
          aria-label={label}
          render={<span {...rest} />}
        >
          &#x1F512;
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={4}>
            <Tooltip.Popup className="alm-tooltip">{label}</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
