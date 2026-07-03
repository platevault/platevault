import type { ReactNode } from 'react';
import { m } from '@/lib/i18n';

export interface InfoTipProps {
  /** Help text revealed on hover/focus. */
  tip: ReactNode;
  /** Accessible label prefix; defaults to "More information". */
  label?: string;
  className?: string;
}

/**
 * Small ⓘ affordance that reveals help text on hover/focus — the de-vibe
 * replacement for always-on help prose under form rows (settings mock).
 * Token-only styling lives in components.css under `.alm-info-tip`.
 *
 * The visible tooltip is CSS-only (`::after` reads `data-tip`); the same text
 * is mirrored into `aria-label` so screen readers get it without a hover.
 */
export function InfoTip({ tip, label = m.infotip_more_information(), className }: InfoTipProps) {
  const text = typeof tip === 'string' ? tip : undefined;
  const cls = ['alm-info-tip', className].filter(Boolean).join(' ');
  return (
    <span
      className={cls}
      role="note"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- intentionally focusable so keyboard users can reveal the CSS :focus tooltip
      tabIndex={0}
      aria-label={text ? `${label}: ${text}` : label}
      data-tip={text}
    >
      {/* eslint-disable-next-line alm/no-user-string -- decorative icon glyph, not user prose */}
      {'i'}
    </span>
  );
}
