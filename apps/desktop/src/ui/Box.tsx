import type { ReactNode } from 'react';

export interface BoxProps {
  heading?: string;
  children: ReactNode;
}

export function Box({ heading, children }: BoxProps) {
  return (
    <div className="alm-box">
      {heading && <h3 className="alm-box__heading">{heading}</h3>}
      {children}
    </div>
  );
}
