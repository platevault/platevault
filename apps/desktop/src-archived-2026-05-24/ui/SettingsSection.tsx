// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode } from "react";
import { SectionHeader } from "./SectionHeader";

export interface SettingsSectionProps {
  title: string;
  children: ReactNode;
  /** Extra top margin (CSS var string, e.g. "var(--space-7)"). Default var(--space-7). */
  marginTop?: string;
}

/**
 * A titled group of SettingsRow components.
 * Renders a SectionHeader label above the rows.
 */
export function SettingsSection({ title, children, marginTop }: SettingsSectionProps) {
  return (
    <section aria-label={title}>
      <SectionHeader marginTop={marginTop ?? "var(--space-7)"}>{title}</SectionHeader>
      <div>{children}</div>
    </section>
  );
}
