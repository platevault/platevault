import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity as ActivityIcon,
  ChevronRight,
  HardDrive,
  Inbox as InboxIcon,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  Sun,
  Telescope,
} from "lucide-react";

import { CommandPalette, IconButton, LogPanel, Tooltip } from "../ui";
import { useTheme } from "./theme";
import {
  getPlanById,
  useInboxCount,
  useLog,
  usePendingPlansCount,
  useProjects,
  useScanStatus,
} from "../data/store";
import { useTauriBridgeStatus } from "../data/lifecycle-bridge";
import { buildPaletteGroups } from "./palette";

function BridgeStatusPill() {
  const status = useTauriBridgeStatus();
  let label: string;
  let tone: string;
  let tooltip: string;
  switch (status.runtime) {
    case "tauri":
      label = "Tauri";
      tone = "ok";
      tooltip = `Connected to spec 002 backend — ledger probe returned ${status.ledgerCount} row(s).`;
      break;
    case "probing":
      label = "…";
      tone = "probing";
      tooltip = "Probing Tauri bridge…";
      break;
    case "error":
      label = "Err";
      tone = "err";
      tooltip = `Tauri bridge probe failed: ${status.message}`;
      break;
    case "browser":
    default:
      label = "Mock";
      tone = "mock";
      tooltip = "Browser-mode mockup. Launch via `cargo tauri dev` for the real backend.";
      break;
  }
  return (
    <Tooltip content={tooltip}>
      <span
        className="alm-shell__bridge-pill"
        data-tone={tone}
        aria-label={tooltip}
        style={{
          fontSize: 11,
          padding: "2px 6px",
          borderRadius: 4,
          border: "1px solid var(--color-border)",
          opacity: 0.7,
        }}
      >
        {label}
      </span>
    </Tooltip>
  );
}

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: typeof HardDrive;
}

const NAV: NavItem[] = [
  { id: "inventory", label: "Inventory", path: "/inventory", icon: HardDrive },
  { id: "inbox", label: "Inbox", path: "/inbox", icon: InboxIcon },
  { id: "projects", label: "Projects", path: "/projects", icon: Telescope },
  { id: "activity", label: "Activity", path: "/activity", icon: ActivityIcon },
];

const SIDEBAR_KEY = "alm.sidebar.collapsed";

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const wizardMode = location.pathname.startsWith("/welcome");

  const activeId = useMemo(() => {
    const match = NAV.find((n) => location.pathname.startsWith(n.path));
    return match?.id ?? null;
  }, [location.pathname]);
  const settingsActive = location.pathname.startsWith("/settings");

  const inboxCount = useInboxCount();
  const { needsAttention } = usePendingPlansCount();
  const log = useLog();
  const scan = useScanStatus();

  const paletteGroups = useMemo(
    () => buildPaletteGroups((to) => router.navigate({ to })),
    [router],
  );

  return (
    <div className="alm-shell" data-sidebar-collapsed={collapsed ? "true" : "false"}>
      <header className="alm-shell__header">
        <div className="alm-shell__brand">
          <span className="alm-shell__brand-mark">ALM</span>
        </div>
        <Breadcrumbs pathname={location.pathname} />
        <div className="alm-shell__header-utils">
          <BridgeStatusPill />
          <Tooltip content="Search (⌘K)">
            <IconButton aria-label="Search" onClick={() => setPaletteOpen(true)}>
              <Search size={15} />
            </IconButton>
          </Tooltip>
          <ThemeToggle />
        </div>
      </header>

      <aside className="alm-shell__sidebar" aria-label="Primary">
        <nav className="alm-shell__nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            const showInboxBadge = item.id === "inbox" && inboxCount > 0;
            const showActivityBadge = item.id === "activity" && needsAttention > 0;
            const isDisabled = wizardMode;

            if (isDisabled) {
              const disabledItem = (
                <span
                  key={item.id}
                  className="alm-shell__nav-item"
                  data-disabled="true"
                  aria-disabled="true"
                  aria-label={item.label}
                >
                  <Icon size={16} className="alm-shell__nav-icon" />
                  {collapsed ? null : <span className="alm-shell__nav-label">{item.label}</span>}
                </span>
              );
              return collapsed ? (
                <Tooltip key={item.id} content={item.label} side="right">
                  {disabledItem}
                </Tooltip>
              ) : (
                disabledItem
              );
            }

            const link = (
              <Link
                key={item.id}
                to={item.path}
                className="alm-shell__nav-item"
                data-active={isActive ? "true" : undefined}
                aria-label={item.label}
              >
                <Icon size={16} className="alm-shell__nav-icon" />
                {collapsed ? null : <span className="alm-shell__nav-label">{item.label}</span>}
                {!collapsed && showInboxBadge ? (
                  <span className="alm-shell__nav-count">{inboxCount}</span>
                ) : null}
                {!collapsed && showActivityBadge ? (
                  <span className="alm-shell__nav-badges">
                    <span className="alm-badge" data-tone="danger">{needsAttention}</span>
                  </span>
                ) : null}
                {collapsed && (showInboxBadge || showActivityBadge) ? (
                  <span className="alm-shell__nav-dot" data-tone={showActivityBadge ? "danger" : "accent"} />
                ) : null}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.id} content={item.label} side="right">
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </nav>

        <div className="alm-shell__sidebar-footer">
          {(() => {
            const settingsLink = (
              <Link
                to="/settings"
                className="alm-shell__nav-item"
                data-active={settingsActive ? "true" : undefined}
                aria-label="Settings"
              >
                <SettingsIcon size={16} className="alm-shell__nav-icon" />
                {collapsed ? null : <span className="alm-shell__nav-label">Settings</span>}
              </Link>
            );
            return collapsed ? (
              <Tooltip content="Settings" side="right">{settingsLink}</Tooltip>
            ) : (
              settingsLink
            );
          })()}
          <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
            <IconButton
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </IconButton>
          </Tooltip>
        </div>
      </aside>

      <main className="alm-shell__main">{children}</main>

      <LogPanel entries={log} scan={scan} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={paletteGroups}
      />
    </div>
  );
}

const SECTION_LABELS: Record<string, string> = {
  inventory: "Inventory",
  inbox: "Inbox",
  projects: "Projects",
  activity: "Activity",
  plans: "Activity",
  settings: "Settings",
  welcome: "Setup",
};

const SETTINGS_SECTION_LABELS: Record<string, string> = {
  general: "General",
  sources: "Sources",
  classification: "Classification",
  calibration: "Calibration",
  projects: "Projects",
  tools: "Processing tools",
  observer: "Observer location",
  catalogs: "Catalogs",
  about: "About",
};

function Breadcrumbs({ pathname }: { pathname: string }) {
  const projects = useProjects();
  const crumbs = useMemo(() => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length === 0) return [];

    const [topRaw, second] = parts;
    const top = topRaw === "plans" ? "activity" : topRaw;
    const out: Array<{ label: string; to?: string }> = [];

    const topLabel = SECTION_LABELS[top] ?? top;
    out.push({ label: topLabel, to: `/${top}` });

    if (!second) return out;

    if (top === "plans") {
      const plan = getPlanById(`plan-${second}`) ?? getPlanById(second);
      if (plan) {
        out.push({ label: `#${plan.number} · ${plan.title}` });
      } else {
        out.push({ label: `#${second}` });
      }
    } else if (top === "projects") {
      const project = projects.find((p) => p.id === second);
      out.push({ label: project?.name ?? second });
    } else if (top === "settings") {
      out.push({ label: SETTINGS_SECTION_LABELS[second] ?? second });
    } else {
      out.push({ label: second });
    }
    return out;
  }, [pathname, projects]);

  if (crumbs.length === 0) return <div className="alm-shell__breadcrumbs" />;

  return (
    <nav className="alm-shell__breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <Fragment key={`${c.label}-${i}`}>
          {i > 0 ? <ChevronRight size={13} className="alm-shell__crumb-sep" aria-hidden /> : null}
          {c.to && i < crumbs.length - 1 ? (
            <Link to={c.to} className="alm-shell__crumb">{c.label}</Link>
          ) : (
            <span className="alm-shell__crumb" data-current={i === crumbs.length - 1 ? "true" : undefined}>{c.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
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
