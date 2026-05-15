import { type CSSProperties, type MouseEvent, useEffect, useMemo, useState } from "react";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  useReactTable,
} from "@tanstack/react-table";

import "@mantine/core/styles.css";

import {
  ActionIcon,
  Button as MantineButton,
  Checkbox,
  Box,
  Accordion,
  Group,
  Paper as MantinePaper,
  Menu,
  Modal,
  MultiSelect,
  Select as MantineSelect,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, FolderOpen, Pencil, Play, Plus, X } from "lucide-react";

import {
  cleanupFirstStepGuideStateEvent,
  emitGuideAction,
  guidedCreatedProjectStorageKey,
  guidedSampleProjectId,
  isFirstStepGuideActive,
  guidedConfirmedItemsStorageKey,
  resetFirstStepGuideStateEvent,
} from "../shared/guideEvents";

type ProjectState = "Candidate" | "Source Mapping" | "Prepared" | "Processing" | "Finalized" | "Cleanup Reviewed" | "Archived";
type ProjectSetupMode = "create" | "onboard" | "edit";
type ProjectSetupStep = "project" | "lights" | "calibration" | "review";
type ProjectMoreAction = "Open project log";
const PROJECT_SETUP_STEPS: ProjectSetupStep[] = ["project", "lights", "calibration", "review"];
const PROJECT_STATE_OPTIONS = [
  "Candidate",
  "Source Mapping",
  "Prepared",
  "Processing",
  "Finalized",
  "Cleanup Reviewed",
  "Archived",
].map((state) => ({ value: state, label: state }));

type ChannelSummary = {
  channel: string;
  integration: string;
  exposures: string;
  exposureLengths: string;
  dates: string;
  gain: string;
  offset: string;
  binning: string;
  camera: string;
  temperature: string;
};

type ProjectSource = {
  id: string;
  type: string;
  name: string;
  path: string;
  inventoryItemId?: string;
};

type ProjectRow = {
  id: string;
  name: string;
  target: string;
  workflow: string;
  state: ProjectState;
  root: string;
  sources: ProjectSource[];
  channels: ChannelSummary[];
  planStatus: string;
  totalIntegration: string;
  exposureCount: string;
  acquisitionDates: string;
  metadataState: string;
  sourceSummary: string;
};

type ConfirmedInventoryItem = {
  id: string;
  name: string;
  path: string;
  frameKind?: "lights" | "flats" | "darks" | "bias";
};

type LightMappingDraft = {
  id: string;
  lightId: string;
  selected: boolean;
  flatsId: string;
};

type ProjectDraft = {
  name: string;
  root: string;
  target: string;
  workflow: string;
  lights: LightMappingDraft[];
  darksId: string;
  biasId: string;
};

type SourceOptions = {
  lights: Array<{ value: string; label: string }>;
  flats: Array<{ value: string; label: string }>;
  darks: Array<{ value: string; label: string }>;
  bias: Array<{ value: string; label: string }>;
};

const fallbackConfirmedItems: ConfirmedInventoryItem[] = [
  {
    id: "fallback-lights",
    name: "Heart & Soul lights 2025-03-10",
    path: "Sample Inbox\\Lights\\Heart Soul\\2025-03-10",
    frameKind: "lights",
  },
  {
    id: "fallback-flats",
    name: "L-Pro flats 2025-03-12",
    path: "Sample Inbox\\Calibration\\Flats\\L-Pro\\2025-03-12",
    frameKind: "flats",
  },
  {
    id: "fallback-darks",
    name: "Master darks 120s gain 100",
    path: "Sample Inbox\\Calibration\\Darks\\MasterDark_120s_gain100.xisf",
    frameKind: "darks",
  },
  {
    id: "fallback-bias",
    name: "Master bias gain 100",
    path: "Sample Inbox\\Calibration\\Bias\\MasterBias_gain100.xisf",
    frameKind: "bias",
  },
];

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function readGuidedConfirmedItems(): ConfirmedInventoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  const rawCandidates = window.localStorage.getItem(guidedConfirmedItemsStorageKey);
  if (!rawCandidates) {
    return [];
  }

  try {
    return JSON.parse(rawCandidates) as ConfirmedInventoryItem[];
  } catch {
    window.localStorage.removeItem(guidedConfirmedItemsStorageKey);
    return [];
  }
}

function getItemsOrFallbackByFrameKind(items: ConfirmedInventoryItem[], frameKind: "lights" | "flats" | "darks" | "bias") {
  const matched = items.filter((item) => item.frameKind === frameKind);

  if (matched.length > 0) {
    return matched;
  }

  return fallbackConfirmedItems.filter((item) => item.frameKind === frameKind);
}

function getProjectSetupSourceItems(): ConfirmedInventoryItem[] {
  const confirmedItems = readGuidedConfirmedItems();

  return dedupeById([
    ...getItemsOrFallbackByFrameKind(confirmedItems, "lights"),
    ...getItemsOrFallbackByFrameKind(confirmedItems, "flats"),
    ...getItemsOrFallbackByFrameKind(confirmedItems, "darks"),
    ...getItemsOrFallbackByFrameKind(confirmedItems, "bias"),
  ]);
}

const initialProjects: ProjectRow[] = [
  {
    id: "heart-soul-mosaic",
    name: "Heart & Soul Panel 1",
    target: "IC 1805 / IC 1848",
    workflow: "PixInsight",
    state: "Source Mapping",
    root: "D:\\Astrophotography\\Projects\\HeartSoul_Panel1",
    sourceSummary: "3 light sessions, flats linked, dark/bias masters selected",
    planStatus: "Lifecycle: workflow resource plan ready (project resources not created)",
    totalIntegration: "21h 20m",
    exposureCount: "456 light frames",
    acquisitionDates: "2025-03-10, 2025-03-12, 2025-03-14",
    metadataState: "Extracted when sessions were confirmed; update requires explicit metadata review.",
    sources: [
      {
        id: "sess_20250310_hs_p1",
        type: "Lights",
        name: "20250310 heart & soul Panel 1",
        path: "Raw\\Poseidon-C PRO\\20250310 heart & soul Panel 1",
        inventoryItemId: "heart-soul-p1",
      },
    ],
    channels: [
      {
        channel: "L",
        integration: "9h 20m",
        exposures: "200",
        exposureLengths: "152 x 120s + 48 x 180s",
        dates: "2025-03-10, 2025-03-14",
        gain: "100",
        offset: "50",
        binning: "1x1",
        camera: "Poseidon-C PRO",
        temperature: "-10C to -9.8C",
      },
    ],
  },
];

function getSourceOptions(items: ConfirmedInventoryItem[]): SourceOptions {
  return {
    lights: items
      .filter((item) => !item.frameKind || item.frameKind === "lights")
      .map((item) => ({ value: item.id, label: item.name })),
    flats: items
      .filter((item) => !item.frameKind || item.frameKind === "flats")
      .map((item) => ({ value: item.id, label: item.name })),
    darks: items
      .filter((item) => !item.frameKind || item.frameKind === "darks")
      .map((item) => ({ value: item.id, label: item.name })),
    bias: items
      .filter((item) => !item.frameKind || item.frameKind === "bias")
      .map((item) => ({ value: item.id, label: item.name })),
  };
}

function createDraftSourceDefaults(sourceItems: ConfirmedInventoryItem[]) {
  const light = sourceItems.find((item) => item.frameKind === "lights") ?? fallbackConfirmedItems[0];
  const flat = sourceItems.find((item) => item.frameKind === "flats");
  const dark = sourceItems.find((item) => item.frameKind === "darks");
  const bias = sourceItems.find((item) => item.frameKind === "bias");

  return {
    light: light ?? sourceItems[0] ?? { id: "fallback-lights", name: "Lights", path: "Sample Inbox\\Lights", frameKind: "lights" },
    flat: flat ?? { id: "", name: "No flats selected", path: "", frameKind: "flats" },
    dark: dark ?? sourceItems[0],
    bias: bias ?? sourceItems[0],
  };
}

function createLightMappingDraft(
  sourceItems: ConfirmedInventoryItem[],
  options?: {
    selected?: boolean;
    lightId?: string;
  },
): LightMappingDraft {
  const selected = options?.selected ?? true;
  const defaults = createDraftSourceDefaults(sourceItems);
  const lightId = options?.lightId ?? defaults.light.id;

  return {
    id: `light-mapping-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    lightId,
    selected,
    flatsId: defaults.flat.id === "" ? "" : defaults.flat.id,
  };
}

function getExplicitLightSelectionCount(draft: ProjectDraft): number {
  return draft.lights.filter((light) => light.selected && light.lightId.trim() !== "").length;
}

function createDraftFromProject(
  project: ProjectRow | undefined,
  sourceItems: ConfirmedInventoryItem[],
  mode: ProjectSetupMode = "create",
): ProjectDraft {
  const defaults = createDraftSourceDefaults(sourceItems);

  if (!project) {
    if (mode === "create") {
      return {
        name: "New project",
        root: "D:\\Astrophotography\\Projects\\",
        target: "IC 1805 / IC 1848",
        workflow: "PixInsight",
        lights: [],
        darksId: "",
        biasId: "",
      };
    }

    return {
      name: "New project",
      root: "D:\\Astrophotography\\Projects\\",
      target: "IC 1805 / IC 1848",
      workflow: "PixInsight",
      lights: [createLightMappingDraft(sourceItems)],
      darksId: defaults.dark?.id ?? "",
      biasId: defaults.bias?.id ?? "",
    };
  }

  return {
    name: project.name,
    root: project.root,
    target: project.target,
    workflow: project.workflow,
    lights: [createLightMappingDraft(sourceItems)],
    darksId: defaults.dark?.id ?? "",
    biasId: defaults.bias?.id ?? "",
  };
}

function getProjectSetupSummary(draft: ProjectDraft): string[] {
  const selectedLightCount = getExplicitLightSelectionCount(draft);
  return [
    `${selectedLightCount} light mapping${selectedLightCount === 1 ? "" : "s"} selected`,
    draft.darksId ? "Dark master selected" : "Dark master not selected",
    draft.biasId ? "Bias master selected" : "Bias master not selected",
  ];
}

function getSetupStepLabel(step: ProjectSetupStep) {
  const labels: Record<ProjectSetupStep, string> = {
    project: "Project",
    lights: "Lights + Flats",
    calibration: "Darks + Bias",
    review: "Review",
  };
  return labels[step];
}

function getPreviousSetupStep(step: ProjectSetupStep): ProjectSetupStep {
  if (step === "lights") {
    return "project";
  }
  if (step === "calibration") {
    return "lights";
  }
  return "calibration";
}

function getProjectStateForMode(mode: ProjectSetupMode): ProjectState {
  if (mode === "onboard") {
    return "Source Mapping";
  }
  if (mode === "edit") {
    return "Prepared";
  }
  return "Candidate";
}

function getWorkflowToolLabel(workflow: string) {
  if (workflow === "PixInsight") {
    return "Open in PixInsight";
  }
  if (workflow === "Siril") {
    return "Open in Siril";
  }
  return null;
}

function buildProjectSourcesFromDraft(draft: ProjectDraft, sourceItems: ConfirmedInventoryItem[]): ProjectSource[] {
  const sourceItemsById = new Map(sourceItems.map((item) => [item.id, item]));
  const sources: ProjectSource[] = [];
  const seenSourceIds = new Set<string>();

  for (const lightMapping of draft.lights.filter((light) => light.selected && light.lightId.trim() !== "")) {
    const item = sourceItemsById.get(lightMapping.lightId);
    const sourceId = lightMapping.lightId;
    if (!seenSourceIds.has(sourceId)) {
      sources.push({
        id: sourceId,
        type: "Lights",
        name: item?.name ?? sourceId,
        path: item?.path ?? sourceId,
        inventoryItemId: sourceId,
      });
      seenSourceIds.add(sourceId);
    }

    if (!lightMapping.flatsId) {
      continue;
    }

    const flatItem = sourceItemsById.get(lightMapping.flatsId);
    const flatSourceId = `flat-for-${lightMapping.lightId}-${lightMapping.flatsId}`;
    if (lightMapping.flatsId && !seenSourceIds.has(flatSourceId)) {
      sources.push({
        id: flatSourceId,
        type: "Flats",
        name: flatItem?.name ?? lightMapping.flatsId,
        path: flatItem?.path ?? lightMapping.flatsId,
        inventoryItemId: lightMapping.flatsId,
      });
      seenSourceIds.add(flatSourceId);
    }
  }

  if (draft.darksId && !seenSourceIds.has(draft.darksId)) {
    const dark = sourceItemsById.get(draft.darksId);
    sources.push({
      id: `dark-${draft.darksId}`,
      type: "Darks",
      name: dark?.name ?? draft.darksId,
      path: dark?.path ?? draft.darksId,
      inventoryItemId: draft.darksId,
    });
  }

  if (draft.biasId && !seenSourceIds.has(draft.biasId)) {
    const bias = sourceItemsById.get(draft.biasId);
    sources.push({
      id: `bias-${draft.biasId}`,
      type: "Bias",
      name: bias?.name ?? draft.biasId,
      path: bias?.path ?? draft.biasId,
      inventoryItemId: draft.biasId,
    });
  }

  return sources;
}

function getProjectHeaderStyle(columnId: string): CSSProperties {
  if (columnId === "name") {
    return { width: 160 };
  }
  if (columnId === "root") {
    return {};
  }
  if (columnId === "workflow") {
    return { width: 95 };
  }
  if (columnId === "state") {
    return { width: 110 };
  }
  if (columnId === "actions") {
    return { width: 230 };
  }
  return {};
}

function ProjectActionMenu({
  project,
  onOpen,
  onEdit,
  onToolAction,
  onMoreAction,
  compact = false,
}: {
  project: ProjectRow;
  onOpen: (event: MouseEvent<HTMLElement>) => void;
  onEdit: (event: MouseEvent<HTMLElement>) => void;
  onToolAction?: (event: MouseEvent<HTMLElement>) => void;
  onMoreAction: (action: ProjectMoreAction) => void;
  compact?: boolean;
}) {
  const workflowToolLabel = getWorkflowToolLabel(project.workflow);

  return (
    <Group gap="xs" justify="flex-end" wrap="nowrap">
      <MantineButton
        size="xs"
        onClick={onOpen}
        leftSection={<FolderOpen size={14} />}
        px={compact ? "var(--mantine-spacing-xs)" : undefined}
      >
        Open
      </MantineButton>
      <ActionIcon
        size="xs"
        variant="default"
        onClick={onEdit}
        aria-label={`Edit ${project.name}`}
      >
        <Pencil size={14} />
      </ActionIcon>
      {onToolAction && workflowToolLabel ? (
        <MantineButton
          size="xs"
          variant="light"
          onClick={onToolAction}
          leftSection={<Play size={14} />}
          px={compact ? "var(--mantine-spacing-xs)" : undefined}
        >
          {workflowToolLabel}
        </MantineButton>
      ) : null}
      <Menu position="bottom-end" width={160} withArrow>
        <Menu.Target>
          <ActionIcon size="xs" variant="default" aria-label={`Project actions for ${project.name}`}>
            <ChevronDown size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            onClick={() => {
              onMoreAction("Open project log");
            }}
          >
            Open project log
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

function updateLightMapping(
  draft: ProjectDraft,
  onDraftChange: (patch: Partial<ProjectDraft>) => void,
  lightId: string,
  patch: Partial<LightMappingDraft>,
) {
  onDraftChange({
    lights: draft.lights.map((light) => (light.id === lightId ? { ...light, ...patch } : light)),
  });
}

export function ProjectWorkspacePage() {
  const navigate = useNavigate({ from: "/projects" });
  const [projects, setProjects] = useState<ProjectRow[]>(initialProjects);
  const [isProjectSetupOpen, setIsProjectSetupOpen] = useState(false);
  const [projectSetupMode, setProjectSetupMode] = useState<ProjectSetupMode>("create");
  const [projectSetupStep, setProjectSetupStep] = useState<ProjectSetupStep>("project");
  const [projectSetupProjectId, setProjectSetupProjectId] = useState<string | undefined>(undefined);
  const [projectSetupError, setProjectSetupError] = useState<string | undefined>(undefined);
  const [projectSetupSourceItems, setProjectSetupSourceItems] = useState<ConfirmedInventoryItem[]>(() => getProjectSetupSourceItems());
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(() =>
    createDraftFromProject(undefined, projectSetupSourceItems, "create"),
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjects[0]?.id ?? "");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [actionNote, setActionNote] = useState("");
  const sourceOptions = useMemo(() => getSourceOptions(projectSetupSourceItems), [projectSetupSourceItems]);
  const columns = useMemo<ColumnDef<ProjectRow>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ getValue }) => (
          <Text size="xs" fw={700} lineClamp={1}>
            {getValue<string>()}
          </Text>
        ),
      },
      {
        accessorKey: "root",
        header: "Path",
        cell: ({ getValue }) => <Text size="xs" lineClamp={1}>{getValue<string>()}</Text>,
      },
      {
        accessorKey: "workflow",
        header: "Workflow",
        cell: ({ getValue }) => <Text size="xs">{getValue<string>()}</Text>,
      },
      {
        accessorKey: "state",
        header: "State",
        filterFn: (row, columnId, value) => {
          const selectedStates = (Array.isArray(value) ? value : []) as ProjectState[];

          if (selectedStates.length === 0) {
            return true;
          }

          return selectedStates.includes(row.getValue<ProjectState>(columnId));
        },
        cell: ({ getValue }) => <Text size="xs">{getValue<string>()}</Text>,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const project = row.original;

          return (
            <ProjectActionMenu
              project={project}
              onOpen={(event) => {
                event.stopPropagation();
                onOpenProject(project);
              }}
              onEdit={(event) => {
                event.stopPropagation();
                openProjectSetup("edit", project);
              }}
              onToolAction={(event) => {
                event.stopPropagation();
                onOpenProjectTool(project);
              }}
              onMoreAction={(action) => {
                onProjectMoreAction(project, action);
              }}
            />
          );
        },
      },
    ];
  }, [onOpenProject, onOpenProjectTool, onProjectMoreAction, openProjectSetup]);

  const table = useReactTable({
    data: projects,
    columns,
    state: {
      columnFilters,
    },
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnFiltersChange: setColumnFilters,
  });

  const visibleProjectRows = table.getRowModel().rows;
  const selectedProjectStateFilters = useMemo<ProjectState[]>(() => {
    const stateFilter = columnFilters.find((filter) => filter.id === "state");
    return Array.isArray(stateFilter?.value) ? (stateFilter.value as ProjectState[]) : [];
  }, [columnFilters]);
  const projectSetupSummary = useMemo(() => getProjectSetupSummary(projectDraft), [projectDraft]);

  const setupProject = useMemo(
    () => projects.find((project) => project.id === projectSetupProjectId) ?? null,
    [projectSetupProjectId, projects],
  );

  const selectedProject = useMemo(
    () =>
      visibleProjectRows.find((row) => row.original.id === selectedProjectId)?.original ?? visibleProjectRows[0]?.original ?? null,
    [selectedProjectId, visibleProjectRows],
  );

  useEffect(() => {
    if (visibleProjectRows.length === 0) {
      if (selectedProjectId !== "") {
        setSelectedProjectId("");
      }
      return;
    }

    const selectedIsStillVisible = visibleProjectRows.some((row) => row.original.id === selectedProjectId);
    if (!selectedProjectId || !selectedIsStillVisible) {
      setSelectedProjectId(visibleProjectRows[0]?.original.id ?? "");
    }
  }, [selectedProjectId, visibleProjectRows]);

  useEffect(() => {
    const cleanupGuideSampleProject = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail ?? {};
      const targetProjectId = detail.projectId ?? guidedSampleProjectId;
      const nextSourceItems = getProjectSetupSourceItems();

      if (!targetProjectId) {
        return;
      }

      setIsProjectSetupOpen(false);
      setProjectSetupProjectId(undefined);
      setProjectSetupError(undefined);
      setProjectSetupMode("create");
      setProjectSetupStep("project");
      setProjectSetupSourceItems(nextSourceItems);
      setProjectDraft(createDraftFromProject(undefined, nextSourceItems, "create"));

      setProjects((prevProjects) => {
        const hasGuideProject = prevProjects.some((project) => project.id === targetProjectId);
        if (!hasGuideProject) {
          return prevProjects;
        }

        return prevProjects.filter((project) => project.id !== targetProjectId);
      });
    };

    window.addEventListener(resetFirstStepGuideStateEvent, cleanupGuideSampleProject);
    window.addEventListener(cleanupFirstStepGuideStateEvent, cleanupGuideSampleProject);
    return () => {
      window.removeEventListener(resetFirstStepGuideStateEvent, cleanupGuideSampleProject);
      window.removeEventListener(cleanupFirstStepGuideStateEvent, cleanupGuideSampleProject);
    };
  }, []);

  function onProjectStateFilterChange(selectedStates: string[]) {
    setColumnFilters((prevFilters) => {
      const nextFilters = prevFilters.filter((filter) => filter.id !== "state");
      if (selectedStates.length === 0) {
        return nextFilters;
      }

      return [...nextFilters, { id: "state", value: selectedStates as ProjectState[] }];
    });
  }

  function openProjectSetup(mode: ProjectSetupMode, project?: ProjectRow) {
    const resolvedSourceItems = getProjectSetupSourceItems();

    setProjectSetupSourceItems(resolvedSourceItems);
    setProjectSetupMode(mode);
    if (project?.id) {
      setProjectSetupProjectId(project.id);
      setSelectedProjectId(project.id);
    } else {
      setProjectSetupProjectId(undefined);
    }
    setProjectDraft(createDraftFromProject(project, resolvedSourceItems, mode));
    setProjectSetupStep("project");
    setProjectSetupError(undefined);
    setIsProjectSetupOpen(true);
    emitGuideAction("projects.open-project-setup");
  }

  function closeProjectSetup() {
    setIsProjectSetupOpen(false);
    setProjectSetupProjectId(undefined);
    setProjectSetupError(undefined);
  }

  function onDraftChange(patch: Partial<ProjectDraft>) {
    setProjectDraft((prev) => ({ ...prev, ...patch }));
  }

  function onCommitProjectSetup() {
    const selectedLightCount = getExplicitLightSelectionCount(projectDraft);
    const nextSources = buildProjectSourcesFromDraft(projectDraft, projectSetupSourceItems);
    const isGuidedProjectCreate = projectSetupMode === "create" && isFirstStepGuideActive();
    const canCreate =
      projectDraft.name.trim().length > 0 &&
      projectDraft.root.trim().length > 0 &&
      selectedLightCount > 0 &&
      projectDraft.darksId.trim().length > 0 &&
      projectDraft.biasId.trim().length > 0;

    if (!canCreate) {
      setProjectSetupError("Complete all required project setup inputs before creating.");
      return;
    }

    const next: ProjectRow = {
      id:
        projectSetupProjectId ??
        (isGuidedProjectCreate ? guidedSampleProjectId : `${Date.now()}-${projectDraft.name.toLowerCase().replace(/\\s+/g, "-")}`),
      name: projectDraft.name,
      target: projectDraft.target,
      workflow: projectDraft.workflow,
      state: getProjectStateForMode(projectSetupMode),
      root: projectDraft.root,
      sourceSummary: `${selectedLightCount} light session mapping${selectedLightCount === 1 ? "" : "s"}`,
      planStatus: "Lifecycle: project resources prepared.",
      totalIntegration: setupProject?.totalIntegration ?? "0h 00m",
      exposureCount: setupProject?.exposureCount ?? "0",
      acquisitionDates: setupProject?.acquisitionDates ?? "",
      metadataState: setupProject?.metadataState ?? "No metadata state yet.",
      sources: nextSources,
      channels: setupProject?.channels ?? [],
    };

    setProjects((prev) => {
      if (projectSetupMode === "create") {
        return [next, ...prev.filter((project) => project.id !== next.id)];
      }

      return prev.map((project) => (project.id === next.id ? next : project));
    });

    setSelectedProjectId(next.id);
    if (projectSetupMode === "create") {
      setActionNote(`Created ${next.name}`);
    } else {
      setActionNote(`Updated ${next.name}`);
    }

    if (projectSetupMode === "create") {
      if (isGuidedProjectCreate && typeof window !== "undefined") {
        window.localStorage.setItem(
          guidedCreatedProjectStorageKey,
          JSON.stringify({
            createdAt: new Date().toISOString(),
            projectId: next.id,
            sourceCount: next.sources.length,
          }),
        );
      }
      emitGuideAction("projects.create-project");
    }

    setIsProjectSetupOpen(false);
    setProjectSetupProjectId(undefined);
  }

  function selectProject(project: ProjectRow) {
    setSelectedProjectId(project.id);
    setActionNote(`Selected ${project.name}`);
  }

  function onProjectMoreAction(project: ProjectRow, action: ProjectMoreAction) {
    if (action === "Open project log") {
      setActionNote(`Project log (prototype): ${project.name}`);
    }
  }

  function onOpenProjectTool(project: ProjectRow) {
    const toolLabel = getWorkflowToolLabel(project.workflow);
    if (!toolLabel) {
      return;
    }
    setActionNote(`${toolLabel} for ${project.name}`);
  }

  function onOpenSourceInInventory(source: ProjectSource) {
    if (!source.inventoryItemId) {
      setActionNote(`Source has no Inventory link: ${source.name}`);
      return;
    }

    void navigate({
      to: "/library",
      search: { selected: source.inventoryItemId },
    });
    setActionNote(`Open Inventory source for ${source.name}`);
  }

  function onOpenProject(project: ProjectRow) {
    // TODO(Tauri): implement native file-browser reveal for project folders once shell integration is wired.
    setActionNote(`Open location (prototype): ${project.root}`);
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Title order={3}>Projects</Title>
        <MantineButton size="xs" onClick={() => openProjectSetup("create")} data-guide-target="projects-add-project">
          New project
        </MantineButton>
      </Group>

      {actionNote ? (
        <Text size="xs" c="dimmed" role="status">
          {actionNote}
        </Text>
      ) : null}

      <Group align="flex-start" gap="sm" wrap="wrap">
        <Box style={{ flex: "1 1 32rem", minWidth: 0 }}>
          <MantinePaper withBorder p={0} radius="sm">
            <Stack gap={0}>
              <Group p="xs" justify="space-between" align="flex-end" wrap="nowrap">
                <Stack gap={2}>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                    Workspace
                  </Text>
                  <Text fw={700} size="sm">
                    Project rows
                  </Text>
                </Stack>
                <Group align="flex-end" gap="xs">
                  <MultiSelect
                    size="xs"
                    data={PROJECT_STATE_OPTIONS}
                    value={selectedProjectStateFilters}
                    onChange={onProjectStateFilterChange}
                    placeholder="States"
                    clearable
                    searchable={false}
                    style={{ width: 184 }}
                  />
                  <Text size="xs" c="dimmed">
                    {visibleProjectRows.length} projects
                  </Text>
                </Group>
              </Group>

              <Table.ScrollContainer minWidth={860}>
                <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      {table
                        .getHeaderGroups()
                        .flatMap((headerGroup) => headerGroup.headers)
                        .map((header) => (
                          <Table.Th key={header.id} style={getProjectHeaderStyle(header.id)}>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </Table.Th>
                        ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleProjectRows.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={5}>
                          <Stack gap="xs" p="sm">
                            <Text fw={700}>No projects</Text>
                            <Text size="xs" c="dimmed">
                              Create a project to begin project planning from confirmed Inventory sessions.
                            </Text>
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                    {visibleProjectRows.map((row) => {
                      const project = row.original;
                      const isSelected = project.id === selectedProjectId;

                      return (
                        <Table.Tr
                          key={row.id}
                          data-selected={isSelected}
                          style={isSelected ? { backgroundColor: "var(--surface-selected)" } : undefined}
                          onClick={() => selectProject(project)}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <Table.Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Td>
                          ))}
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          </MantinePaper>
        </Box>

        <Box style={{ flex: "1 1 22rem", minWidth: "18rem" }}>
          <MantinePaper withBorder p="sm" radius="sm">
            {selectedProject ? (
              <ProjectDetailPanel
                project={selectedProject}
                onOpenProject={() => onOpenProject(selectedProject)}
                onEditProject={() => openProjectSetup("edit", selectedProject)}
                onOpenProjectTool={() => onOpenProjectTool(selectedProject)}
                onMoreAction={(action) => onProjectMoreAction(selectedProject, action)}
                onSourceNavigation={onOpenSourceInInventory}
              />
            ) : (
              <Text size="xs" fw={700}>
                Select a project to inspect.
              </Text>
            )}
          </MantinePaper>
        </Box>
      </Group>

      <ProjectSetupDialog
        opened={isProjectSetupOpen}
        draft={projectDraft}
        mode={projectSetupMode}
        operationError={projectSetupError}
        operationSummary={projectSetupSummary}
        step={projectSetupStep}
        confirmedItems={projectSetupSourceItems}
        onStepChange={setProjectSetupStep}
        onDraftChange={onDraftChange}
        onCancel={closeProjectSetup}
        onConfirm={onCommitProjectSetup}
      />
    </Stack>
  );
}

function ProjectDetailPanel({
  project,
  onOpenProject,
  onOpenProjectTool,
  onEditProject,
  onMoreAction,
  onSourceNavigation,
}: {
  project: ProjectRow;
  onOpenProject: () => void;
  onOpenProjectTool: () => void;
  onEditProject: () => void;
  onMoreAction: (action: ProjectMoreAction) => void;
  onSourceNavigation: (source: ProjectSource) => void;
}) {
  const workflowToolLabel = getWorkflowToolLabel(project.workflow);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="nowrap">
        <Stack gap={2}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Project
          </Text>
          <Title order={4}>{project.name}</Title>
        </Stack>
        <Group gap="xs" align="center">
          <ProjectActionMenu
            project={project}
            onOpen={(event) => {
              event.stopPropagation();
              onOpenProject();
            }}
            onEdit={(event) => {
              event.stopPropagation();
              onEditProject();
            }}
            onToolAction={
              workflowToolLabel
                ? (event) => {
                    event.stopPropagation();
                    onOpenProjectTool();
                  }
                : undefined
            }
            onMoreAction={onMoreAction}
            compact
          />
        </Group>
      </Group>

      <Table withColumnBorders verticalSpacing={2} horizontalSpacing="xs">
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>
              <Text fw={600} size="xs">
                State
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" c="dimmed">
                {project.state}
              </Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text fw={600} size="xs">
                Target
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" c="dimmed">
                {project.target}
              </Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text fw={600} size="xs">
                Workflow
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" c="dimmed">
                {project.workflow}
              </Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text fw={600} size="xs">
                Folder
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" c="dimmed" lineClamp={2}>
                {project.root}
              </Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text fw={600} size="xs">
                Integration
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" c="dimmed">
                {project.totalIntegration}
              </Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text fw={600} size="xs">
                Exposure count
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" c="dimmed">
                {project.exposureCount}
              </Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text fw={600} size="xs">
                Source summary
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs" c="dimmed">
                {project.sourceSummary}
              </Text>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>

      <Stack gap="xs">
        <Text fw={600} size="xs">
          Sources
        </Text>
        <Table withColumnBorders verticalSpacing={2} horizontalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th w={120}>Path</Table.Th>
              <Table.Th w={80}>Type</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {project.sources.map((source) => (
              <Table.Tr
                key={source.id}
                onClick={() => onSourceNavigation(source)}
                style={{ cursor: source.inventoryItemId ? "pointer" : "default" }}
              >
                <Table.Td>
                  <Text size="xs" lineClamp={1} c={source.inventoryItemId ? "blue" : "dimmed"}>
                    {source.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {source.path}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{source.type}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>

      <Stack gap="xs">
        <Text fw={600} size="xs">
          Channels
        </Text>
        {project.channels.length > 0 ? (
          <Accordion multiple>
            {project.channels.map((channel, index) => (
              <Accordion.Item key={`${project.id}-${channel.channel}-${index}`} value={`channel-${index}`}>
                <Accordion.Control>
                  <Group gap="xs" justify="space-between" align="center">
                    <Text size="xs" fw={600}>
                      Channel {channel.channel}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {channel.integration}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Table withColumnBorders verticalSpacing={2} horizontalSpacing="xs">
                    <Table.Tbody>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Integration
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.integration}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Exposures
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.exposures}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Exposure lengths
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.exposureLengths}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Dates
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.dates}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Gain
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.gain}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Offset
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.offset}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Binning
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.binning}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Camera
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.camera}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600} size="xs">
                            Temperature
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {channel.temperature}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        ) : (
          <Text size="xs" c="dimmed">
            No channels linked.
          </Text>
        )}
      </Stack>
    </Stack>
  );
}

function ProjectSetupDialog({
  opened,
  draft,
  mode,
  operationError,
  operationSummary,
  step,
  confirmedItems,
  onStepChange,
  onDraftChange,
  onCancel,
  onConfirm,
}: {
  opened: boolean;
  draft: ProjectDraft;
  mode: ProjectSetupMode;
  operationError?: string;
  operationSummary: string[];
  step: ProjectSetupStep;
  confirmedItems: ConfirmedInventoryItem[];
  onStepChange: (step: ProjectSetupStep) => void;
  onDraftChange: (patch: Partial<ProjectDraft>) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const sourceOptions = getSourceOptions(confirmedItems);
  const selectedLightCount = getExplicitLightSelectionCount(draft);
  const canLeaveProject = draft.name.trim().length > 0 && draft.root.trim().length > 0;
  const canLeaveLights = selectedLightCount > 0;
  const canLeaveCalibration = draft.darksId.length > 0 && draft.biasId.length > 0;
  const canCreate = canLeaveProject && canLeaveLights && canLeaveCalibration;
  const guideSectionTarget =
    step === "lights" ? "project-setup-lights" : step === "calibration" ? "project-setup-calibration" : undefined;
  const actionLabel = {
    create: "Create project",
    onboard: "Onboard project",
    edit: "Save changes",
  }[mode];

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={
        <Text size="sm" fw={700}>
          {{
            create: "Create project",
            onboard: "Onboard existing folder",
            edit: "Edit project",
          }[mode]}
        </Text>
      }
      centered
      size="72vw"
      radius="md"
      padding="sm"
      data-guide-target="project-setup-dialog"
    >
      <Stack gap="xs">
        {operationError ? (
          <MantinePaper withBorder p={6} radius="sm">
            <Text size="xs" c="red">
              {operationError}
            </Text>
          </MantinePaper>
        ) : null}

        <MantinePaper withBorder p={6} radius="sm">
          <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="xs">
            <Table.Tbody>
              <Table.Tr>
                <Table.Td style={{ width: 140 }}>
                  <Text size="xs" fw={500}>
                    Folder
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" style={{ overflowWrap: "anywhere" }} lineClamp={1}>
                    {draft.root || "Select folder"}
                  </Text>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td style={{ width: 140 }}>
                  <Text size="xs" fw={500}>
                    Workflow
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {draft.workflow} ({selectedLightCount} light mapping{selectedLightCount === 1 ? "" : "s"})
                  </Text>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td style={{ width: 140 }}>
                  <Text size="xs" fw={500}>
                    Project resources
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                    Required project record and workflow links
                  </Text>
                </Table.Td>
              </Table.Tr>
              {operationSummary.length === 0 ? null : (
                <Table.Tr>
                  <Table.Td style={{ width: 140 }}>
                    <Text size="xs" fw={500}>
                      Checks
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Stack gap={0}>
                      {operationSummary.map((line, index) => (
                        <Text key={`${line}-${index}`} size="xs" c="dimmed" lineClamp={1}>
                          {line}
                        </Text>
                      ))}
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </MantinePaper>

      <MantinePaper withBorder p={6} radius="sm">
        <Group gap={8} justify="space-between" wrap="nowrap" align="center">
          {PROJECT_SETUP_STEPS.map((candidateStep, stepIndex) => (
            <Text
              size="xs"
              fw={candidateStep === step ? 700 : 500}
              lh={1}
              fz={11}
              key={candidateStep}
              c={candidateStep === step ? "blue.7" : "dimmed"}
              truncate
            >
                {`${stepIndex + 1}. ${getSetupStepLabel(candidateStep)}`}
              </Text>
            ))}
        </Group>
      </MantinePaper>

      <Stack gap="xs" data-guide-target={guideSectionTarget}>
        <MantinePaper withBorder p={6} radius="sm">
          <Stack gap="xs">
            {step === "project" ? (
              <Group gap="md" grow>
                <Stack gap="xs" style={{ flex: 1 }}>
                  <TextInput
                    size="xs"
                    label="Project name"
                    value={draft.name}
                    onChange={(event) => onDraftChange({ name: event.target.value })}
                  />
                  <TextInput
                    size="xs"
                    label="Project folder"
                    value={draft.root}
                    onChange={(event) => onDraftChange({ root: event.target.value })}
                  />
                </Stack>
                <Stack gap="xs" style={{ flex: 1 }}>
                  <TextInput
                    size="xs"
                    label="Target"
                    value={draft.target}
                    onChange={(event) => onDraftChange({ target: event.target.value })}
                  />
                  <MantineSelect
                    size="xs"
                    label="Workflow"
                    value={draft.workflow}
                    data={["PixInsight", "Siril", "Planetary"]}
                    onChange={(value) => onDraftChange({ workflow: value ?? "PixInsight" })}
                  />
                </Stack>
              </Group>
            ) : null}

            {step === "lights" ? (
              <Stack gap={3}>
                <Text size="xs" c="dimmed">
                  Add one or more light sessions first. Flats can be linked per selected light session.
                </Text>
                <Group gap="xs" justify="space-between" align="center">
                  <Text size="xs" fw={600}>
                    Light sessions
                  </Text>
                  <MantineButton
                    size="xs"
                    variant="light"
                    leftSection={<Plus size={12} />}
                    onClick={() => {
                      onDraftChange({
                        lights: [
                          ...draft.lights,
                          createLightMappingDraft(confirmedItems, {
                            selected: false,
                            ...(mode === "create" ? { lightId: "" } : {}),
                          }),
                        ],
                      });
                    }}
                  >
                    Add light session
                  </MantineButton>
                </Group>
                {draft.lights.map((light) => {
                  const lightOption = sourceOptions.lights.find((option) => option.value === light.lightId);
                  return (
                    <MantinePaper withBorder p={4} key={light.id} radius="sm">
                      <Group gap="xs" wrap="nowrap" align="center">
                        <Checkbox
                          size="xs"
                          checked={light.selected}
                          onChange={(event) =>
                            onDraftChange({
                              lights: draft.lights.map((entry) =>
                                entry.id === light.id ? { ...entry, selected: event.currentTarget.checked } : entry,
                              ),
                            })
                          }
                        />
                        <MantineSelect
                          size="xs"
                          w={250}
                          label="Light session"
                          value={light.lightId}
                          data={sourceOptions.lights}
                          placeholder="Select light session"
                          onChange={(value) =>
                            updateLightMapping(draft, onDraftChange, light.id, {
                              lightId: value ?? light.lightId,
                            })
                          }
                        />
                        <MantineSelect
                          size="xs"
                          w={180}
                          label="Flats"
                          value={light.flatsId}
                          data={[{ value: "", label: "No flats selected" }, ...sourceOptions.flats]}
                          placeholder="Optional"
                          onChange={(value) => updateLightMapping(draft, onDraftChange, light.id, { flatsId: value ?? "" })}
                        />
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="red"
                          disabled={draft.lights.length === 1}
                          onClick={() => {
                            onDraftChange({
                              lights: draft.lights.filter((entry) => entry.id !== light.id),
                            });
                          }}
                          aria-label={`Remove light mapping ${lightOption?.label ?? light.lightId}`}
                        >
                          <X size={14} />
                        </ActionIcon>
                      </Group>
                    </MantinePaper>
                  );
                })}
              </Stack>
            ) : null}

            {step === "calibration" ? (
              <Stack gap="3">
                <Text size="xs" c="dimmed">
                  Select dark and bias masters separately. Both are required to continue.
                </Text>
                <Group gap="xs" align="flex-end">
                  <MantineSelect
                    size="xs"
                    style={{ minWidth: 220 }}
                    label="Dark master"
                    value={draft.darksId}
                    data={[{ value: "", label: "Select dark master" }, ...sourceOptions.darks]}
                    onChange={(value) => onDraftChange({ darksId: value ?? "" })}
                  />
                  <MantineSelect
                    size="xs"
                    style={{ minWidth: 220 }}
                    label="Bias master"
                    value={draft.biasId}
                    data={[{ value: "", label: "Select bias master" }, ...sourceOptions.bias]}
                    onChange={(value) => onDraftChange({ biasId: value ?? "" })}
                  />
                </Group>
              </Stack>
            ) : null}

            {step === "review" ? (
              <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="sm">
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="xs" fw={500}>
                        Project
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{draft.name}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="xs" fw={500}>
                        Folder
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{draft.root}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="xs" fw={500}>
                        Project type
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{draft.workflow}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="xs" fw={500}>
                        Lights
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{selectedLightCount}</Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="xs" fw={500}>
                        Darks
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {sourceOptions.darks.find((option) => option.value === draft.darksId)?.label ?? "Not selected"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="xs" fw={500}>
                        Bias
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">
                        {sourceOptions.bias.find((option) => option.value === draft.biasId)?.label ?? "Not selected"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>
                      <Text size="xs" fw={500}>
                        Session mapping
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">Flats optional per selected light</Text>
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
            ) : null}
          </Stack>
        </MantinePaper>

        <Group gap="xs" justify="space-between">
          <MantineButton size="xs" variant="light" type="button" onClick={onCancel}>
            Cancel
          </MantineButton>
          <Group gap="xs">
            {step !== "project" ? (
              <MantineButton size="xs" variant="light" type="button" onClick={() => onStepChange(getPreviousSetupStep(step))}>
                Back
              </MantineButton>
            ) : null}
            {step === "project" ? (
              <MantineButton
                size="xs"
                type="button"
                disabled={!canLeaveProject}
                data-guide-target="project-setup-next-project"
                onClick={() => {
                  emitGuideAction("projects.setup.project");
                  onStepChange("lights");
                }}
              >
                Next
              </MantineButton>
            ) : null}
            {step === "lights" ? (
              <MantineButton
                size="xs"
                type="button"
                disabled={!canLeaveLights}
                onClick={() => {
                  emitGuideAction("projects.setup.lights");
                  onStepChange("calibration");
                }}
              >
                Next
              </MantineButton>
            ) : null}
            {step === "calibration" ? (
              <MantineButton
                size="xs"
                type="button"
                disabled={!canLeaveCalibration}
                onClick={() => {
                  emitGuideAction("projects.setup.calibration");
                  onStepChange("review");
                }}
              >
                Next
              </MantineButton>
            ) : null}
            {step === "review" ? (
              <MantineButton
                size="xs"
                type="button"
                disabled={!canCreate}
                data-guide-target="project-create-project"
                onClick={onConfirm}
              >
                {actionLabel}
              </MantineButton>
            ) : null}
          </Group>
        </Group>
        </Stack>
      </Stack>
    </Modal>
  );
}
