// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only


export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  "aria-label"?: string;
}

/**
 * Simple tab strip.
 * Renders role="tablist" with keyboard-navigable role="tab" buttons.
 * Tab panel rendering is handled by the caller.
 */
export function Tabs({ tabs, value, onChange, "aria-label": ariaLabel }: TabsProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = idx;
    if (e.key === "ArrowRight") {
      next = (idx + 1) % tabs.length;
    } else if (e.key === "ArrowLeft") {
      next = (idx - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      next = 0;
    } else if (e.key === "End") {
      next = tabs.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    onChange(tabs[next].id);
    // Move focus to the newly selected tab
    const tablist = e.currentTarget.closest('[role="tablist"]');
    if (tablist) {
      const tabEls = tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabEls[next]?.focus();
    }
  };

  return (
    <div
      className="alm-tabstrip"
      role="tablist"
      aria-label={ariaLabel ?? "Tabs"}
    >
      {tabs.map((t, idx) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`tabpanel-${t.id}`}
          className="alm-tabstrip__tab"
          data-active={value === t.id ? "true" : undefined}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
