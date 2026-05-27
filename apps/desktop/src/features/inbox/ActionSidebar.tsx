/**
 * ActionSidebar -- right sidebar for Inbox page.
 * Full-width action buttons with keyboard shortcut hints.
 * Design V3 rewrite.
 */

import { useEffect, useCallback } from 'react';
import { Btn } from '@/ui';

export type InboxAction = 'confirm' | 'reject' | 'split' | 'merge' | 'edit';

export interface ActionSidebarProps {
  hasSelection: boolean;
  onAction?: (action: InboxAction) => void;
}

interface ActionDef {
  action: InboxAction;
  label: string;
  hotkey: string;
  variant?: 'accent' | 'danger';
}

const ACTIONS: ActionDef[] = [
  { action: 'confirm', label: 'Confirm', hotkey: 'C', variant: 'accent' },
  { action: 'reject', label: 'Reject', hotkey: 'R', variant: 'danger' },
  { action: 'split', label: 'Split', hotkey: 'S' },
  { action: 'merge', label: 'Merge', hotkey: 'M' },
  { action: 'edit', label: 'Edit', hotkey: 'E' },
];

const HOTKEY_MAP: Record<string, InboxAction> = {
  c: 'confirm',
  r: 'reject',
  s: 'split',
  m: 'merge',
  e: 'edit',
};

export function ActionSidebar({ hasSelection, onAction }: ActionSidebarProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!hasSelection) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (isInput) return;

      const action = HOTKEY_MAP[e.key.toLowerCase()];
      if (action) {
        e.preventDefault();
        onAction?.(action);
      }
    },
    [hasSelection, onAction],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <aside
      className="alm-action-sidebar"
      aria-label="Session actions"
      style={{ width: 180, flexShrink: 0, padding: '12px 0' }}
    >
      <div
        style={{
          padding: '0 12px 8px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--alm-color-fg-muted)',
        }}
      >
        Actions
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px' }}>
        {ACTIONS.map((def) => (
          <Btn
            key={def.action}
            variant={def.variant}
            disabled={!hasSelection}
            onClick={() => onAction?.(def.action)}
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <span>{def.label}</span>
            <kbd
              style={{
                fontSize: 10,
                opacity: 0.6,
                background: 'rgba(0,0,0,0.15)',
                borderRadius: 3,
                padding: '1px 4px',
              }}
            >
              {def.hotkey}
            </kbd>
          </Btn>
        ))}
      </div>
    </aside>
  );
}
