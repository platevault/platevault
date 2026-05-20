import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ClipboardList, Moon, Settings, Sun, Monitor } from "lucide-react";

import { CommandPalette, IconButton, LogPanel, Tooltip } from "../ui";
import { useTheme } from "./theme";
import { useInboxCount, useLog, usePendingPlansCount } from "../data/store";
import { buildPaletteGroups } from "./palette";

interface NavItem {
  id: string;
  label: string;
  path: string;
  count?: number;
}

const NAV: NavItem[] = [
  { id: "inventory", label: "Inventory", path: "/inventory" },
  { id: "inbox", label: "Inbox", path: "/inbox" },
  { id: "projects", label: "Projects", path: "/projects" },
  { id: "settings", label: "Settings", path: "/settings" },
];

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const activeId = useMemo(() => {
    if (location.pathname.startsWith("/plans")) return null;
    return NAV.find((n) => location.pathname.startsWith(n.path))?.id ?? null;
  }, [location.pathname]);

  const inboxCount = useInboxCount();
  const { needsAction, needsAttention } = usePendingPlansCount();
  const log = useLog();

  const paletteGroups = useMemo(
    () => buildPaletteGroups((to) => router.navigate({ to })),
    [router],
  );

  return (
    <div className="alm-shell">
      <header className="alm-shell__header">
        <div className="alm-shell__brand">
          <span className="alm-shell__brand-mark">ALM</span>
          <span>Astro Library Manager</span>
        </div>
        <div className="alm-shell__header-utils">
          <Tooltip content="Open command palette (⌘K)">
            <button
              type="button"
              className="alm-btn"
              data-variant="subtle"
              data-size="sm"
              onClick={() => setPaletteOpen(true)}
            >
              <span className="alm-kbd">⌘K</span>
              <span style={{ color: "var(--text-dim)" }}>Search</span>
            </button>
          </Tooltip>
          <Tooltip
            content={
              needsAttention > 0
                ? `${needsAttention} plans need attention · ${needsAction} pending review`
                : needsAction > 0
                ? `${needsAction} plans pending review`
                : "No plans waiting"
            }
          >
            <Link
              to="/plans"
              className="alm-btn"
              data-variant="subtle"
              data-size="sm"
              style={{ textDecoration: "none" }}
              aria-label={`Plans, ${needsAction} pending review, ${needsAttention} need attention`}
            >
              <ClipboardList size={14} />
              <span>Plans</span>
              {needsAttention > 0 ? (
                <span className="alm-badge" data-tone="danger" style={{ marginLeft: 2 }}>
                  {needsAttention}
                </span>
              ) : null}
              {needsAction > 0 ? (
                <span className="alm-badge" data-tone="accent" style={{ marginLeft: 2 }}>
                  {needsAction}
                </span>
              ) : null}
            </Link>
          </Tooltip>
          <ThemeToggle />
          <Link to="/settings" style={{ display: "inline-flex" }}>
            <IconButton aria-label="Settings">
              <Settings size={15} />
            </IconButton>
          </Link>
        </div>
      </header>

      <nav className="alm-shell__nav" aria-label="Primary">
        {NAV.map((item) => (
          <Link
            key={item.id}
            to={item.path}
            className="alm-shell__nav-item"
            data-active={activeId === item.id ? "true" : undefined}
          >
            <span>{item.label}</span>
            {item.id === "inbox" && inboxCount > 0 ? (
              <span className="alm-shell__nav-count">{inboxCount}</span>
            ) : null}
          </Link>
        ))}
      </nav>

      <main className="alm-shell__main">{children}</main>

      <LogPanel entries={log} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={paletteGroups}
      />
    </div>
  );
}

function ThemeToggle() {
  const { mode, setMode } = useTheme();

  const icon = mode === "system" ? <Monitor size={15} /> : mode === "dark" ? <Moon size={15} /> : <Sun size={15} />;
  const next = mode === "system" ? "light" : mode === "light" ? "dark" : "system";
  const tooltip = `Theme: ${mode} (click for ${next})`;

  return (
    <Tooltip content={tooltip}>
      <IconButton aria-label={`Theme: ${mode}`} onClick={() => setMode(next as typeof mode)}>
        {icon}
      </IconButton>
    </Tooltip>
  );
}
