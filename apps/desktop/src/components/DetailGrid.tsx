import type { ReactNode } from 'react';

export interface DetailGridProps {
  /** Primary column content — the main tables/sections. */
  children: ReactNode;
  /** The right rail (use <Rail>…</Rail>). Always present in design v4; the
   * 1280px minimum window guarantees it fits. */
  rail: ReactNode;
}

/**
 * The standard detail body: a two-column grid with the primary content on the
 * left and a fixed-width rail on the right (design v4 "dashboard" layout).
 */
export function DetailGrid({ children, rail }: DetailGridProps) {
  return (
    <div className="alm-dash">
      <div className="alm-dash__primary">{children}</div>
      {rail}
    </div>
  );
}

export interface RailProps {
  children: ReactNode;
}

/**
 * One cohesive rail panel (flat surface with hairline dividers). The outer cell
 * stretches to the full grid-row height; the inner panel is `position: sticky`
 * so it stays in view while the primary column scrolls.
 */
export function Rail({ children }: RailProps) {
  return (
    <div className="alm-rail">
      <div className="alm-rail__panel">{children}</div>
    </div>
  );
}

export interface RailCardProps {
  title: string;
  children: ReactNode;
}

/** A labeled group inside the Rail, divided from its neighbours by a hairline. */
export function RailCard({ title, children }: RailCardProps) {
  return (
    <div className="alm-rail__card">
      <div className="alm-rail__card-h">{title}</div>
      {children}
    </div>
  );
}
