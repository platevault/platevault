import { type ReactNode } from 'react';
import { Collapsible } from '@base-ui-components/react/collapsible';

export interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Section({ title, defaultOpen = true, children }: SectionProps) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className="alm-section">
      <Collapsible.Trigger className="alm-section__header">
        <svg
          className="alm-section__chevron"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span className="alm-section__title">{title}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="alm-section__body">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
