import { Command } from "cmdk";
import { Search, ArrowRight, AlertTriangle } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";

export interface PaletteItem {
  id: string;
  label: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  /** Marks the item as a destructive (mutating) action */
  destructive?: boolean;
  onSelect: () => void;
  /** Keywords to expand the search match surface */
  keywords?: string[];
}

export interface PaletteGroup {
  id: string;
  heading: string;
  items: PaletteItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: PaletteGroup[];
  placeholder?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  groups,
  placeholder = "Search projects, files, actions…",
}: CommandPaletteProps) {
  // Global Cmd+K / Ctrl+K to toggle the palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="alm-palette-overlay" />
        <BaseDialog.Popup className="alm-palette">
          <Command label="Command palette">
            <div className="alm-palette__input-wrap">
              <Search size={16} />
              <Command.Input
                className="alm-palette__input"
                placeholder={placeholder}
                autoFocus
              />
            </div>
            <Command.List className="alm-palette__list">
              <Command.Empty className="alm-palette__empty">
                No matches.
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group.id} heading={group.heading} className="alm-palette__group">
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.id}
                      className="alm-palette__item"
                      value={`${group.heading} ${typeof item.label === "string" ? item.label : ""} ${(item.keywords ?? []).join(" ")}`}
                      onSelect={() => {
                        item.onSelect();
                        onOpenChange(false);
                      }}
                    >
                      <span className="alm-palette__item-icon">
                        {item.icon ?? <ArrowRight size={14} />}
                      </span>
                      <span className="alm-palette__item-label">{item.label}</span>
                      {item.destructive ? (
                        <span className="alm-palette__item-warn">
                          <AlertTriangle size={11} /> destructive
                        </span>
                      ) : null}
                      {item.meta ? <span className="alm-palette__item-meta">{item.meta}</span> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="alm-palette__footer">
              <span className="alm-kbd">↑</span>
              <span className="alm-kbd">↓</span>
              <span>navigate</span>
              <span className="alm-kbd">↵</span>
              <span>open</span>
              <span className="alm-kbd">esc</span>
              <span>close</span>
            </div>
          </Command>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
