import type { ReactNode } from 'react';

export interface BoxProps {
  heading?: string;
  right?: ReactNode;
  children: ReactNode;
}

export function Box({ heading, right, children }: BoxProps) {
  return (
    <div className="alm-box">
      {heading && (
        <div className="alm-box__header">
          <h3 className="alm-box__heading">{heading}</h3>
          {right && <span className="alm-box__right">{right}</span>}
        </div>
      )}
      <div className="alm-box__body">{children}</div>
    </div>
  );
}
