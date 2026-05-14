import type { ComponentType, ReactElement } from "react";
import { Archive, FileText, Folder, FolderOpen, Inbox, Settings } from "lucide-react";

import { InboxPage } from "../features/inbox/InboxPage";
import { FrameworkReviewPage } from "../features/framework-review/FrameworkReviewPage";
import { LibraryInventoryPage } from "../features/library/LibraryInventoryPage";
import { ProjectWorkspacePage } from "../features/projects/ProjectWorkspacePage";
import { SettingsPage } from "../features/settings/SettingsPage";

export type AppRouteId =
  | "library"
  | "projects"
  | "inbox"
  | "settings"
  | "framework-review";

export interface AppRoute {
  id: AppRouteId;
  label: string;
  description: string;
  path: string;
  section: "primary" | "system";
  icon: ReactElement;
  component: ComponentType;
}

function ProjectsRoute() {
  return <ProjectWorkspacePage />;
}

function InboxRoute() {
  return <InboxPage />;
}

function SettingsRoute() {
  return <SettingsPage />;
}

export const appRoutes: AppRoute[] = [
  {
    id: "inbox",
    label: "Inbox",
    description: "Inbox",
    path: "/inbox",
    section: "primary",
    icon: <Inbox size={15} />,
    component: InboxRoute,
  },
  {
    id: "library",
    label: "Inventory",
    description: "Inventory",
    path: "/library",
    section: "primary",
    icon: <Archive size={15} />,
    component: LibraryInventoryPage,
  },
  {
    id: "projects",
    label: "Projects",
    description: "Projects",
    path: "/projects",
    section: "primary",
    icon: <FolderOpen size={15} />,
    component: ProjectsRoute,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Settings",
    path: "/settings",
    section: "system",
    icon: <Settings size={15} />,
    component: SettingsRoute,
  },
  {
    id: "framework-review",
    label: "Framework Review",
    description: "UI framework comparison",
    path: "/framework-review",
    section: "system",
    icon: <FileText size={15} />,
    component: FrameworkReviewPage,
  },
];

export const defaultRouteId: AppRouteId = "inbox";
