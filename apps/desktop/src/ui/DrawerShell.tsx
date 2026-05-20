import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";

export interface DrawerShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  stepper?: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
}

/** Standard drawer chrome: title bar, optional sticky stepper, body, optional footer. */
export function DrawerShell({ title, subtitle, onClose, stepper, body, footer }: DrawerShellProps) {
  return (
    <div className="alm-drawer">
      <div className="alm-drawer__head">
        <div className="alm-drawer__head-titles">
          <div className="alm-drawer__title">{title}</div>
          {subtitle ? <div className="alm-drawer__subtitle">{subtitle}</div> : null}
        </div>
        <IconButton aria-label="Close drawer" onClick={onClose} size="sm">
          <X size={15} />
        </IconButton>
      </div>
      {stepper ? <div className="alm-drawer__stepper">{stepper}</div> : null}
      <div className="alm-drawer__body">{body}</div>
      {footer ? <div className="alm-drawer__footer">{footer}</div> : null}
    </div>
  );
}

export interface FactGroupProps {
  label?: ReactNode;
  children: ReactNode;
}

export function FactGroup({ label, children }: FactGroupProps) {
  return (
    <div className="alm-fact-group">
      {label ? <div className="alm-fact-group__label">{label}</div> : null}
      {children}
    </div>
  );
}

export interface FactsProps {
  entries: Array<{ label: ReactNode; value: ReactNode; mono?: boolean }>;
}

export function Facts({ entries }: FactsProps) {
  return (
    <dl className="alm-facts">
      {entries.map((entry, idx) => (
        <Fragment key={idx}>
          <dt>{entry.label}</dt>
          <dd data-mono={entry.mono ? "true" : undefined}>{entry.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

import { Fragment } from "react";
