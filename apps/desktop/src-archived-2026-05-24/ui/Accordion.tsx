// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Accordion as BaseAccordion } from "@base-ui-components/react/accordion";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export interface AccordionSection {
  id: string;
  title: ReactNode;
  count?: number | string;
  body: ReactNode;
  defaultOpen?: boolean;
}

export interface AccordionProps {
  sections: AccordionSection[];
  openMultiple?: boolean;
}

export function Accordion({ sections, openMultiple = true }: AccordionProps) {
  const defaultValue = sections.filter((s) => s.defaultOpen).map((s) => s.id);
  return (
    <BaseAccordion.Root
      className="alm-accordion"
      defaultValue={defaultValue}
      multiple={openMultiple}
    >
      {sections.map((section) => (
        <BaseAccordion.Item key={section.id} value={section.id} className="alm-accordion__item">
          <BaseAccordion.Header>
            <BaseAccordion.Trigger className="alm-accordion__trigger">
              <span className="alm-accordion__title">
                <ChevronRight size={14} className="alm-accordion__chevron" />
                {section.title}
                {section.count != null ? (
                  <span className="alm-accordion__count">({section.count})</span>
                ) : null}
              </span>
            </BaseAccordion.Trigger>
          </BaseAccordion.Header>
          <BaseAccordion.Panel className="alm-accordion__panel">
            <div className="alm-accordion__panel-inner">{section.body}</div>
          </BaseAccordion.Panel>
        </BaseAccordion.Item>
      ))}
    </BaseAccordion.Root>
  );
}
