import type { ReactNode } from 'react';
import { Toolbar as BaseToolbar } from '@base-ui-components/react/toolbar';

export interface ToolbarProps {
  children: ReactNode;
  subBar?: ReactNode;
}

export function Toolbar({ children, subBar }: ToolbarProps) {
  return (
    <>
      <BaseToolbar.Root className="alm-toolbar">{children}</BaseToolbar.Root>
      {subBar && <div className="alm-toolbar__sub">{subBar}</div>}
    </>
  );
}
