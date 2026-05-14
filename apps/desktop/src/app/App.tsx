import "@mantine/core/styles.css";

import {
  ActionIcon,
  AppShell,
  Anchor,
  Breadcrumbs,
  Box,
  Group,
  Menu,
  NavLink,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Folder, Moon, Search, Settings, Sun } from "lucide-react";

import { FirstStepGuide } from "../features/shared/FirstStepGuide";
import { FirstRunWizard } from "../features/shared/FirstRunWizard";
import { LogPanel } from "../features/shared/LogPanel";
import { appRoutes, defaultRouteId, type AppRoute } from "./routes";

const routeSectionLabels: Record<AppRoute["section"], string> = {
  primary: "Main",
  system: "System",
};

const APP_SHELL_NAVBAR_WIDTH = 204;
const APP_SHELL_HEADER_HEIGHT = 48;

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const location = useLocation();
  const activeRoute = getRouteFromPathname(location.pathname);
  const sectionRoot = appRoutes.find((route) => route.section === activeRoute.section)?.path ?? "/inbox";

  const groupedRoutes = useMemo(groupRoutesBySection, []);

  return (
    <AppShell
      className="app-shell"
      data-theme={theme}
      navbar={{ width: APP_SHELL_NAVBAR_WIDTH, breakpoint: "sm", collapsed: { mobile: false } }}
      header={{ height: APP_SHELL_HEADER_HEIGHT }}
      padding={0}
    >
      <AppShell.Navbar
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          minHeight: "100%",
          background: "var(--surface)",
          borderRight: "1px solid var(--border-soft)",
        }}
      >
        <AppShell.Section p="xs">
          <Group gap="xs" align="center">
            <Box
              style={{
                display: "grid",
                placeItems: "center",
                width: "1.9rem",
                height: "1.9rem",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-inset)",
                color: "var(--text-2)",
                fontSize: "0.72rem",
                fontWeight: 800,
              }}
            >
              ALM
            </Box>
            <Stack gap={0}>
              <Text size="xs" c="var(--text-muted)">
                Astro Library
              </Text>
              <Text fw={700} size="sm">
                Manager
              </Text>
            </Stack>
          </Group>
        </AppShell.Section>

        <AppShell.Section p="xs" style={{ flex: "1 1 0", minHeight: 0 }}>
          <Stack gap="xs">
            {Object.entries(groupedRoutes).map(([section, sectionRoutes]) => (
              <Stack gap="4px" key={section}>
                <Text
                  size="xs"
                  fw={700}
                  c="var(--text-muted)"
                  tt="uppercase"
                  style={{ letterSpacing: "0.08em" }}
                >
                  {routeSectionLabels[section as AppRoute["section"]]}
                </Text>
                <Stack gap="xs">
                  {sectionRoutes.map((route) => {
                    const isActive = route.id === activeRoute.id;

                    return (
                      <NavLink
                        key={route.id}
                        component={Link}
                        to={route.path}
                        active={isActive}
                        data-guide-target={`nav-${route.id}`}
                        aria-label={route.label}
                        aria-current={isActive ? "page" : undefined}
                        data-active={isActive}
                        leftSection={route.icon}
                        rightSection={isActive ? <ArrowRight size={14} /> : null}
                        label={route.label}
                        style={{
                          borderRadius: "var(--radius-sm)",
                          color: isActive ? "var(--text-1)" : "var(--text-2)",
                          border: isActive
                            ? "1px solid color-mix(in oklch, var(--border) 70%, transparent)"
                            : "1px solid transparent",
                          backgroundColor: isActive ? "var(--surface-selected)" : "transparent",
                          padding: "0.35rem 0.55rem",
                          fontWeight: isActive ? 650 : 500,
                        }}
                      />
                    );
                  })}
                </Stack>
              </Stack>
            ))}
          </Stack>
        </AppShell.Section>

        <AppShell.Section p="xs">
          <Stack gap="xs">
            <Text size="xs" fw={700} c="var(--text-muted)" tt="uppercase" style={{ letterSpacing: "0.08em" }}>
              System
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="var(--text-muted)">
                Ready
              </Text>
              <Menu position="right-start" shadow="sm" width={180}>
                <Menu.Target>
                  <ActionIcon variant="default" size="xs" radius="sm" aria-label="System actions">
                    <ChevronDown size={14} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item component={Link} to="/settings" leftSection={<Settings size={14} />}>
                    Settings
                  </Menu.Item>
                  <Menu.Item component={Link} to="/framework-review" leftSection={<Folder size={14} />}>
                    Framework Review
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Header
        style={{
          minHeight: APP_SHELL_HEADER_HEIGHT,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--border-soft)",
          background: "var(--surface)",
        }}
      >
        <Stack gap={0}>
          <Breadcrumbs separator="›" c="var(--text-2)">
            <Anchor size="xs" c="var(--text-2)" component={Link} to={sectionRoot} fw={650}>
              {routeSectionLabels[activeRoute.section]}
            </Anchor>
            <Text size="xs" fw={650} c="var(--text-1)">
              {activeRoute.label}
            </Text>
          </Breadcrumbs>
        </Stack>
        <Group gap="xs" justify="flex-end" align="center" aria-label="View controls">
          <TextInput
            aria-label="Search"
            placeholder="Search"
            type="search"
            leftSection={<Search size={14} />}
            style={{ width: "min(21rem, 36vw)" }}
          />
          <Tooltip label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}>
            <ActionIcon
              variant="default"
              size="xs"
              aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </AppShell.Header>

      <AppShell.Main style={{ minWidth: 0, minHeight: 0, height: "100%", position: "relative" }}>
        <Box
          p="var(--app-shell-content-padding)"
          aria-label={`${activeRoute.label} workspace`}
          component="main"
          style={{
            minHeight: 0,
            overflow: "auto",
            paddingBottom: "calc(var(--app-shell-content-padding) + 2.2rem)",
          }}
        >
          <Outlet />
        </Box>
        <LogPanel />
      </AppShell.Main>

      <FirstRunWizard />
      <FirstStepGuide activeRouteId={activeRoute.id} />
    </AppShell>
  );
}

function groupRoutesBySection(): Record<AppRoute["section"], AppRoute[]> {
  return appRoutes.reduce<Record<AppRoute["section"], AppRoute[]>>(
    (groups, route) => {
      groups[route.section].push(route);
      return groups;
    },
    {
      primary: [],
      system: [],
    },
  );
}

function getRouteFromPathname(pathname: string): AppRoute {
  const route = appRoutes.find((candidate) => normalizePath(candidate.path) === normalizePath(pathname));
  return route ?? appRoutes.find((routeCandidate) => routeCandidate.id === defaultRouteId) ?? appRoutes[0];
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}
