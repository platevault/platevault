import type { ReactNode, CSSProperties } from 'react';

export interface BoxProps {
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Box({ title, style, children }: BoxProps) {
  return (
    <div className="alm-box" style={style}>
      {title && <div className="alm-box__header">{title}</div>}
      <div className="alm-box__body">{children}</div>
    </div>
  );
}
