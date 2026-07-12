import { forwardRef } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

export interface BoxProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  children: ReactNode;
}

export const Box = forwardRef<HTMLDivElement, BoxProps>(function Box(
  { title, className, children, ...rest },
  ref,
) {
  const cls = ['alm-box', className].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={cls} {...rest}>
      {title && <div className="alm-box__header">{title}</div>}
      <div className="alm-box__body">{children}</div>
    </div>
  );
});
Box.displayName = 'Box';
