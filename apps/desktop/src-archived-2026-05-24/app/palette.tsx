import { Folder, Image, FolderInput, Telescope, ClipboardList, Settings, Plus, AlertTriangle } from "lucide-react";
import type { PaletteGroup } from "../ui";
import { projects, inventorySources, plans, inboxItems } from "../data/mock";

export function buildPaletteGroups(navigate: (to: string) => void): PaletteGroup[] {
  return [
    {
      id: "projects",
      heading: "Projects",
      items: projects.map((p) => ({
        id: `palette-prj-${p.id}`,
        label: p.name,
        icon: <Folder size={14} />,
        meta: p.lifecycle,
        keywords: [p.lifecycle, p.tool],
        onSelect: () => navigate(`/projects?id=${p.id}`),
      })),
    },
    {
      id: "sources",
      heading: "Targets / Sessions",
      items: inventorySources.flatMap((s) =>
        s.sessions.slice(0, 6).map((sess) => ({
          id: `palette-sess-${sess.id}`,
          label: sess.name,
          icon: <Telescope size={14} />,
          meta: `${sess.frames} frames`,
          keywords: [sess.target ?? "", sess.filter ?? "", sess.type],
          onSelect: () => navigate(`/inventory?id=${sess.id}`),
        })),
      ),
    },
    {
      id: "inbox",
      heading: "Inbox",
      items: inboxItems.map((item) => ({
        id: `palette-ibx-${item.id}`,
        label: item.path,
        icon: <FolderInput size={14} />,
        meta: `${item.files} files`,
        keywords: [item.type, item.sourceLabel],
        onSelect: () => navigate(`/inbox?id=${item.id}`),
      })),
    },
    {
      id: "plans",
      heading: "Plans",
      items: plans.map((p) => ({
        id: `palette-plan-${p.id}`,
        label: p.title,
        icon: <ClipboardList size={14} />,
        meta: p.state.replace(/_/g, " "),
        keywords: [p.origin, p.type],
        onSelect: () => navigate(`/plans/${p.id}`),
      })),
    },
    {
      id: "actions",
      heading: "Actions",
      items: [
        {
          id: "act-new-project",
          label: "New project",
          icon: <Plus size={14} />,
          onSelect: () => navigate("/projects"),
        },
        {
          id: "act-restructure",
          label: "Restructure source…",
          icon: <FolderInput size={14} />,
          destructive: true,
          keywords: ["reorganize", "move", "structure"],
          onSelect: () => navigate("/plans"),
        },
        {
          id: "act-rescan",
          label: "Rescan all sources",
          icon: <Image size={14} />,
          onSelect: () => navigate("/inventory"),
        },
        {
          id: "act-settings-calibration",
          label: "Go to Settings → Calibration",
          icon: <Settings size={14} />,
          onSelect: () => navigate("/settings/calibration"),
        },
        {
          id: "act-settings-naming",
          label: "Go to Settings → Naming & Structure",
          icon: <Settings size={14} />,
          onSelect: () => navigate("/settings/naming-structure"),
        },
      ],
    },
  ];
}

void AlertTriangle; // keep import as a reference for future use
