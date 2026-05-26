/**
 * T049 — ActionSidebar: right action sidebar for the inbox.
 *
 * Same-width buttons: Confirm, Reject, Split, Merge, Edit.
 * Each shows a hotkey hint (C, R, S, M, E).
 * Buttons use Btn from @/ui. Disabled when no session is selected.
 */

import { useEffect, useCallback } from 'react';
import { Btn } from '@/ui';

export type InboxAction = 'confirm' | 'reject' | 'split' | 'merge' | 'edit';

export interface ActionSidebarProps {
  hasSelection: boolean;
  onAction: (action: InboxAction) => void;
}

interface ActionDef {
  action: InboxAction;
  label: string;
  hotkey: string;
  variant: 'primary' | 'danger' | 'ghost';
}

const ACTIONS: ActionDef[] = [
  { action: 'confirm', label: 'Confirm', hotkey: 'C', variant: 'primary' },
  { action: 'reject', label: 'Reject', hotkey: 'R', variant: 'danger' },
  { action: 'split', label: 'Split', hotkey: 'S', variant: 'ghost' },
  { action: 'merge', label: 'Merge', hotkey: 'M', variant: 'ghost' },
  { action: 'edit', label: 'Edit', hotkey: 'E', variant: 'ghost' },
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
        onAction(action);
      }
    },
    [hasSelection, onAction],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <aside className="alm-action-sidebar" aria-label="Session actions">
      <div className="alm-action-sidebar__header">
        <h3 className="alm-action-sidebar__title">Actions</h3>
      </div>
      <div className="alm-action-sidebar__buttons">
        {ACTIONS.map((def) => (
          <Btn
            key={def.action}
            variant={def.variant}
            disabled={!hasSelection}
            onClick={() => onAction(def.action)}
            className="alm-action-sidebar__btn"
          >
            <span className="alm-action-sidebar__btn-label">{def.label}</span>
            <kbd className="alm-action-sidebar__hotkey">{def.hotkey}</kbd>
          </Btn>
        ))}
      </div>

      {!hasSelection && (
        <p className="alm-action-sidebar__hint">
          Select a session from the list to enable actions.
        </p>
      )}
    </aside>
  );
}
