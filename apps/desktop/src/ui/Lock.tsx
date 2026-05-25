import { Tooltip } from '@base-ui-components/react/tooltip';

export interface LockProps {
  reason?: string;
}

export function Lock({ reason }: LockProps) {
  const label = reason ?? 'Protected';
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger
          className="alm-lock"
          aria-label={label}
          render={<span />}
        >
          &#x1F512;
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={4}>
            <Tooltip.Popup className="alm-tooltip">
              {label}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
