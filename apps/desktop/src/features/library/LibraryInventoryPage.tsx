import { useEffect, useMemo, useRef, useState } from "react";

import "@mantine/core/styles.css";

import {
  ActionIcon,
  Accordion,
  Box,
  Button as MantineButton,
  Group,
  Menu,
  Paper,
  Tooltip,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  type ColumnDef,
  type ColumnFiltersState,
  useReactTable,
} from "@tanstack/react-table";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronDown, FolderOpen, MoveRight } from "lucide-react";

import {
  emitGuideAction,
  cleanupFirstStepGuideStateEvent,
  guidedConfirmedItemsStorageKey,
  guidedLibraryItemsStorageKey,
  resetFirstStepGuideStateEvent,
  libraryCandidateEvent,
  type GuidedFrameKind,
} from "../shared/guideEvents";

type InventorySource = "Raw" | "Calibration" | "Projects" | "Inbox";

type InventoryItem = {
  id: string;
  name: string;
  path: string;
  source: InventorySource;
  frameKind?: GuidedFrameKind;
  type: string;
  state: "Needs review" | "Confirmed" | "Reference" | "Unavailable";
  isGuided?: boolean;
  details: Array<{ label: string; value: string }>;
  warnings: string[];
  moreActions: string[];
};

const guidedFrameOrder: GuidedFrameKind[] = ["darks", "bias", "flats", "lights"];

const inventoryItems: InventoryItem[] = [
  {
    id: "heart-soul-p1",
    name: "20250310 heart & soul Panel 1",
    path: "Raw\\Poseidon-C PRO\\20250310 heart & soul Panel 1",
    source: "Raw",
    frameKind: "lights",
    type: "Light session",
    state: "Needs review",
    isGuided: false,
    details: [
      { label: "Root", value: "Raw Poseidon-C" },
      { label: "Frames", value: "42 light frames" },
      { label: "Filters", value: "L, R, G, B" },
      { label: "Format", value: "FITS" },
      { label: "Last scanned", value: "18 minutes ago" },
    ],
    warnings: [],
    moreActions: ["Edit metadata", "Defer"],
  },
  {
    id: "flats-l-pro",
    name: "2025-03-12 L-Pro flats",
    path: "Masters\\Flats\\L-Pro\\2025-03-12",
    source: "Calibration",
    frameKind: "flats",
    type: "Flat set",
    state: "Needs review",
    isGuided: false,
    details: [
      { label: "Root", value: "Calibration Masters" },
      { label: "Frame type", value: "Flat frames" },
      { label: "Filter", value: "L-Pro" },
      { label: "Reuse", value: "Unresolved until review" },
    ],
    warnings: ["Rotation metadata missing on some files."],
    moreActions: ["Edit metadata", "Ignore"],
  },
  {
    id: "m31-old-project",
    name: "M31 old process",
    path: "PixInsight processes\\M31 old process",
    source: "Projects",
    type: "Project-like folder",
    state: "Reference",
    isGuided: false,
    details: [
      { label: "Root", value: "Processing Projects" },
      { label: "Managed project", value: "No project record found" },
      { label: "Ownership", value: "User/tool managed" },
      { label: "Migration", value: "Requires a reviewed filesystem plan" },
    ],
    warnings: [],
    moreActions: ["Start migration check", "Ignore"],
  },
  {
    id: "missing-drive",
    name: "2024 archive",
    path: "E:\\Astro Archive\\2024",
    source: "Projects",
    type: "Unavailable source",
    state: "Unavailable",
    isGuided: false,
    details: [
      { label: "Source identity", value: "Preserved" },
      { label: "Last known path", value: "E:\\Astro Archive\\2024" },
      { label: "Relationships", value: "Retained" },
      { label: "Audit history", value: "Attached to source identity" },
    ],
    warnings: ["External drive is not connected."],
    moreActions: ["Open settings", "Mark unavailable"],
  },
];

type InventoryFrameKind = GuidedFrameKind | "mixed" | "unknown";
type InventoryFilterMode = "all" | InventoryFrameKind;

export function LibraryInventoryPage() {
  const search = useSearch({ from: "/library" });
  const navigate = useNavigate({ from: "/library" });

  const [rows, setRows] = useState<InventoryItem[]>(() => getInitialInventoryItems());
  const [selectedRowId, setSelectedRowId] = useState<string | null>(() => search.selected ?? getInitialInventoryItems()[0]?.id ?? null);
  const [filter, setFilter] = useState<InventoryFilterMode>(() => search.frame ?? "all");
  const [actionNote, setActionNote] = useState("");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const frameSearchRef = useRef<InventoryFilterMode>(search.frame ?? "all");
  const selectedSearchRef = useRef<string | null>(search.selected ?? null);

  const columns = useMemo<ColumnDef<InventoryItem>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
          const item = row.original;
          const guideKind = getGuidedFrameKind(item);
          const guidedTarget = guideKind && item.isGuided ? `library-select-${guideKind}` : undefined;
          return (
            <MantineButton
              variant="subtle"
              size="xs"
              p={0}
              justify="flex-start"
              data-guide-target={guidedTarget}
              onClick={() => selectInventoryItem(item)}
            >
              {item.name}
            </MantineButton>
          );
        },
      },
      {
        accessorKey: "path",
        header: "Path",
        cell: ({ getValue }) => <TruncatedCell value={getValue<string>()} />,
      },
      {
        accessorKey: "type",
        header: "Type",
        cell: ({ getValue }) => <Text size="xs">{getValue<string>()}</Text>,
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: ({ getValue }) => <Text size="xs">{getValue<string>()}</Text>,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const item = row.original;
          const guideKind = getGuidedFrameKind(item);
          const primaryLabel = item.state === "Confirmed" ? "Open" : "Confirm";

          return (
                <RowActionMenu
                  label={item.name}
                  primaryLabel={primaryLabel}
                  primaryLeftSection={item.state === "Confirmed" ? <FolderOpen size={14} /> : <MoveRight size={14} />}
                  onPrimary={() => applyInventoryAction(primaryLabel, item)}
                  onOpenLocation={() => openInventoryItemLocation(item)}
                  compact
                  actions={item.moreActions}
                  onAction={(action) => applyInventoryAction(action, item)}
                />
          );
        },
      },
      {
        id: "frameKindFilter",
        accessorFn: (item) => getFrameKindValue(item),
        filterFn: (row, _, value) => {
          if (!value || value === "all") {
            return true;
          }

          return getFrameKindValue(row.original) === (value as InventoryFilterMode);
        },
      },
    ];
  }, []);

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnFilters },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getRowId: (row) => row.id,
  });

  const visibleRows = table.getRowModel().rows;
  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.original.id === selectedRowId)?.original ?? visibleRows[0]?.original ?? rows[0],
    [rows, selectedRowId, visibleRows],
  );

  const tableHeaders = useMemo(
    () =>
      table
        .getHeaderGroups()
        .flatMap((headerGroup) => headerGroup.headers)
        .filter((header) => header.id !== "frameKindFilter"),
    [table],
  );

  useEffect(() => {
    if (filter === "all") {
      setColumnFilters([]);
      return;
    }

    setColumnFilters([{ id: "frameKindFilter", value: filter }]);
  }, [filter]);

  useEffect(() => {
    const routeFrame = search.frame ?? "all";
    if (frameSearchRef.current === routeFrame) {
      return;
    }

    frameSearchRef.current = routeFrame;
    setFilter(routeFrame);
  }, [search.frame]);

  useEffect(() => {
    const routeSelected = search.selected ?? null;
    if (selectedSearchRef.current === routeSelected) {
      return;
    }

    selectedSearchRef.current = routeSelected;
    if (!routeSelected) {
      setSelectedRowId(null);
      return;
    }

    if (visibleRows.some((row) => row.original.id === routeSelected)) {
      setSelectedRowId(routeSelected);
    }
  }, [search.selected, visibleRows]);

  useEffect(() => {
    const syncGuidedCandidates = () => {
      const nextRows = getInitialInventoryItems();
      setRows(nextRows);
      setSelectedRowId((current) => (current ?? null) || (nextRows[0]?.id ?? null));
    };

    window.addEventListener(libraryCandidateEvent, syncGuidedCandidates);
    return () => window.removeEventListener(libraryCandidateEvent, syncGuidedCandidates);
  }, []);

  useEffect(() => {
    const resetGuideState = () => {
      const nextRows = getInitialInventoryItems();
      setRows(nextRows);
      setSelectedRowId(nextRows[0]?.id ?? null);
      setFilter("all");
      setColumnFilters([]);
      frameSearchRef.current = "all";
      selectedSearchRef.current = null;

      if (search.frame !== "all" || search.selected != null) {
        void navigate({
          search: (previous) => ({
            ...previous,
            frame: undefined,
            selected: undefined,
          }),
        });
      }
    };

    window.addEventListener(resetFirstStepGuideStateEvent, resetGuideState);
    window.addEventListener(cleanupFirstStepGuideStateEvent, resetGuideState);
    return () => {
      window.removeEventListener(resetFirstStepGuideStateEvent, resetGuideState);
      window.removeEventListener(cleanupFirstStepGuideStateEvent, resetGuideState);
    };
  }, []);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Inventory
          </Text>
          <Text fw={600} size="sm" id="library-title">
            Inventory items
          </Text>
        </Stack>
        <Group gap="xs">
          <MantineButton size="xs" variant="light" onClick={() => setActionNote("Data source draft opened")}>
            Add data source
          </MantineButton>
          <MantineButton size="xs" onClick={() => setActionNote("Inventory scan queued")}>
            Scan
          </MantineButton>
        </Group>
      </Group>

      {actionNote ? (
        <Text size="xs" c="dimmed" role="status">
          {actionNote}
        </Text>
      ) : null}

      <Group align="flex-start" gap="sm" wrap="wrap">
        <Box style={{ flex: "1 1 0", minWidth: 0 }}>
          <Paper withBorder p={0} radius="sm">
            <Stack gap={0}>
              <Group p="sm" justify="space-between" align="flex-end" wrap="wrap" gap="sm">
                <Stack gap={2}>
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                    Inventory
                  </Text>
                  <Title order={3} id="ledger-title">
                    Items
                  </Title>
                </Stack>
                <Box maw={220} w={220}>
                <Select
                    label="Filter"
                    size="xs"
                    value={filter}
                    data={[
                      { value: "all", label: "All frame types" },
                      { value: "lights", label: "Lights" },
                      { value: "darks", label: "Darks" },
                      { value: "bias", label: "Bias" },
                      { value: "flats", label: "Flats" },
                      { value: "mixed", label: "Mixed" },
                      { value: "unknown", label: "Unknown" },
                    ]}
                    onChange={(value) => {
                      const nextFilter = (value as InventoryFilterMode) ?? "all";
                      setFilter(nextFilter);
                      if ((search.frame ?? "all") !== nextFilter) {
                        void navigate({
                          search: (previous) => ({
                            ...previous,
                            frame: nextFilter === "all" ? undefined : nextFilter,
                          }),
                        });
                      }
                    }}
                    allowDeselect={false}
                  />
                </Box>
              </Group>
              <Table.ScrollContainer minWidth={760}>
                <Table highlightOnHover withColumnBorders verticalSpacing={2} horizontalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      {tableHeaders.map((header) => (
                        <Table.Th key={header.id} style={getInventoryHeaderStyle(header.id)}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleRows.length === 0 ? (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                        <Stack gap="xs" p="sm">
                            <Text fw={700}>No Inventory items</Text>
                            <Text size="xs" c="dimmed">
                              Scan or add sources to expand the Inventory list.
                            </Text>
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                    {visibleRows.map((row) => {
                      const item = row.original;
                      const isSelected = selectedRow ? item.id === selectedRow.id : false;
                      const cells = row.getVisibleCells().filter((cell) => cell.column.id !== "frameKindFilter");

                      return (
                        <Table.Tr
                          key={row.id}
                          data-selected={isSelected}
                          style={isSelected ? { backgroundColor: "var(--surface-selected)" } : undefined}
                        >
                          {cells.map((cell) => (
                            <Table.Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Td>
                          ))}
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          </Paper>
        </Box>
        <Box style={{ flex: "0 1 22rem", minWidth: "20rem" }}>
          <Paper withBorder p="sm" radius="sm" aria-labelledby="selected-row-title">
            {selectedRow ? (
              <SelectedInventoryItem item={selectedRow} onAction={applyInventoryAction} onOpenLocation={openInventoryItemLocation} />
            ) : null}
          </Paper>
        </Box>
      </Group>
    </Stack>
  );

  function selectInventoryItem(row: InventoryItem) {
    setSelectedRowId(row.id);
    if (search.selected !== row.id) {
      void navigate({
        search: (previous) => ({
          ...previous,
          selected: row.id,
        }),
      });
    }
    setActionNote(`Selected ${row.name}`);
    const guideKind = getGuidedFrameKind(row);
    if (guideKind && row.isGuided) {
      emitGuideAction(`library.select-item.${guideKind}`);
    }
  }

  function applyInventoryAction(action: string, row: InventoryItem) {
    if (action === "Confirm") {
      const guideKind = getGuidedFrameKind(row);
      const confirmedRow: InventoryItem = {
        ...row,
        state: "Confirmed",
        isGuided: true,
        moreActions: ["Edit metadata", "Add to project"],
        details: [...row.details.filter((detail) => detail.label !== "Move result"), { label: "Confirmed", value: "Yes" }],
      };

      setRows((currentRows) => currentRows.map((candidate) => (candidate.id === row.id ? confirmedRow : candidate)));
      writeGuidedConfirmedItem(confirmedRow);
      setActionNote(`Confirmed ${row.name}`);
      if (guideKind && row.isGuided) {
        emitGuideAction(`library.confirm-item.${guideKind}`);
      }
      return;
    }

    if (action === "Open location" || action === "Open") {
      setActionNote(`Open location: ${row.path}`);
      return;
    }

    setActionNote(`${action}: ${row.name}`);
  }

  function openInventoryItemLocation(row: InventoryItem) {
    // Tauri TODO: replace this prototype note with a native file-browser reveal command.
    setActionNote(`Open location: ${row.path}`);
  }

}

function SelectedInventoryItem({
  item,
  onAction,
  onOpenLocation,
}: {
  item: InventoryItem;
  onAction: (action: string, item: InventoryItem) => void;
  onOpenLocation: (item: InventoryItem) => void;
}) {
  const guideKind = getGuidedFrameKind(item);
  const shouldTrackConfirmGuide = Boolean(guideKind && item.state !== "Confirmed");
  const topLevelLabels = new Set(["Frame type", "State", "Source", "Path"]);
  const details = [
    { label: "Frame type", value: item.type },
    { label: "State", value: item.state },
    { label: "Source", value: item.source },
    { label: "Path", value: item.path },
    ...item.details.filter((detail) => !topLevelLabels.has(detail.label)),
  ];

  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {item.type}
        </Text>
        <Title order={4} id="selected-row-title">
          {item.name}
        </Title>
      </Stack>
      <Table withColumnBorders>
        <Table.Tbody>
          {details.map((detail, index) => (
            <Table.Tr key={`${item.id}-${detail.label}-${index}`}>
              <Table.Td>
                <Text fw={600} size="xs">
                  {detail.label}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" c="dimmed">
                  {detail.value}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {item.warnings.length > 0 ? (
        <Accordion defaultValue="warnings">
          <Accordion.Item value="warnings">
            <Accordion.Control>Warnings</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                {item.warnings.map((warning) => (
                  <Text size="xs" key={warning}>
                    {warning}
                  </Text>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      ) : null}
      <Group gap="xs">
        <RowActionMenu
          label={item.name}
          primaryLabel={item.state === "Confirmed" ? "Open" : "Confirm"}
          primaryLeftSection={item.state === "Confirmed" ? <FolderOpen size={14} /> : <MoveRight size={14} />}
          compact
          guideTarget={shouldTrackConfirmGuide ? `library-confirm-${guideKind}` : undefined}
          onPrimary={() => {
            onAction(item.state === "Confirmed" ? "Open" : "Confirm", item);
          }}
          onOpenLocation={() => onOpenLocation(item)}
          actions={item.moreActions}
          onAction={(action) => onAction(action, item)}
        />
      </Group>
    </Stack>
  );
}

function RowActionMenu({
  label,
  primaryLabel,
  guideTarget,
  actions,
  onPrimary,
  onAction,
  onOpenLocation,
  primaryDisabled = false,
  primaryLeftSection,
  compact = false,
}: {
  label: string;
  primaryLabel: string;
  guideTarget?: string;
  actions: string[];
  onPrimary: () => void;
  onAction: (action: string) => void;
  onOpenLocation: () => void;
  primaryDisabled?: boolean;
  primaryLeftSection?: React.ReactNode;
  compact?: boolean;
}) {
  const filteredActions = actions.filter(Boolean).filter((action) => action !== "Open location");
  const showMenu = filteredActions.length > 0;

  return (
    <Group gap="xs" align="center" wrap="nowrap" justify="flex-end">
      <MantineButton
        size="xs"
        variant="filled"
        disabled={primaryDisabled}
        px={compact ? "var(--mantine-spacing-xs)" : undefined}
        leftSection={primaryLeftSection}
        data-guide-target={guideTarget}
        onClick={onPrimary}
      >
        {primaryLabel}
      </MantineButton>
      <MantineButton
        size="xs"
        variant="subtle"
        px={compact ? "var(--mantine-spacing-xs)" : undefined}
        leftSection={<FolderOpen size={14} />}
        onClick={onOpenLocation}
      >
        Open location
      </MantineButton>
      {showMenu ? (
        <Menu shadow="md" width={180} position="bottom-end" withArrow>
          <Menu.Target>
            <ActionIcon size="xs" variant="default" aria-label={`More actions for ${label}`}>
              <ChevronDown size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {filteredActions.map((action) => (
              <Menu.Item key={action} onClick={() => onAction(action)}>
                {action}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      ) : null}
    </Group>
  );
}

function getInitialInventoryItems() {
  const guidedCandidates = readGuidedLibraryCandidates().map((item) => ({ ...item, isGuided: true }));
  const confirmedItems = readGuidedConfirmedItems().map((item) => ({ ...item, isGuided: true }));

  const seenIds = new Set<string>();
  const dedupedGuidedCandidates = sortGuidedItems(guidedCandidates).filter((item) => {
    if (seenIds.has(item.id)) {
      return false;
    }
    seenIds.add(item.id);
    return true;
  });

  seenIds.clear();
  const dedupedConfirmedItems = sortGuidedItems(confirmedItems).filter((item) => {
    if (seenIds.has(item.id)) {
      return false;
    }
    seenIds.add(item.id);
    return true;
  });

  const mergedGuidedRows = new Map<string, InventoryItem>();
  for (const row of dedupedConfirmedItems) {
    mergedGuidedRows.set(row.id, row);
  }
  for (const row of dedupedGuidedCandidates) {
    if (!mergedGuidedRows.has(row.id)) {
      mergedGuidedRows.set(row.id, row);
    }
  }

  const baseItems = inventoryItems.filter((item) => !mergedGuidedRows.has(item.id));
  return [...mergedGuidedRows.values(), ...baseItems];
}

function getInventoryHeaderStyle(columnId: string) {
  if (columnId === "name") {
    return { minWidth: "14rem", width: "22%" };
  }
  if (columnId === "path") {
    return { minWidth: "16rem", width: "36%" };
  }
  if (columnId === "type" || columnId === "source") {
    return { width: "8.5rem", whiteSpace: "nowrap" };
  }
  if (columnId === "actions") {
    return { width: "11rem" };
  }
  return undefined;
}

function TruncatedCell({ value }: { value: string }) {
  return (
    <Tooltip label={value} withinPortal={false}>
      <Text size="xs" lineClamp={1} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {value}
      </Text>
    </Tooltip>
  );
}

function getGuidedFrameKind(row: InventoryItem): GuidedFrameKind | null {
  return row.frameKind && guidedFrameOrder.includes(row.frameKind) ? row.frameKind : null;
}

function sortGuidedItems(items: InventoryItem[]) {
  return [...items].sort((a, b) => {
    const aIndex = a.frameKind ? guidedFrameOrder.indexOf(a.frameKind) : guidedFrameOrder.length;
    const bIndex = b.frameKind ? guidedFrameOrder.indexOf(b.frameKind) : guidedFrameOrder.length;
    return aIndex - bIndex;
  });
}

function getFrameKindValue(item: InventoryItem): InventoryFilterMode {
  return item.frameKind ?? "unknown";
}

function writeGuidedConfirmedItem(item: InventoryItem) {
  const currentItems = readGuidedConfirmedItems();
  const nextItems = [item, ...currentItems.filter((candidate) => candidate.id !== item.id)];
  const nextCandidates = readGuidedLibraryCandidates().filter((candidate) => candidate.id !== item.id);
  window.localStorage.setItem(guidedConfirmedItemsStorageKey, JSON.stringify(nextItems));
  window.localStorage.setItem(guidedLibraryItemsStorageKey, JSON.stringify(nextCandidates));
}

function readGuidedLibraryCandidates(): InventoryItem[] {
  const rawCandidates = window.localStorage.getItem(guidedLibraryItemsStorageKey);
  if (!rawCandidates) {
    return [];
  }

  try {
    return (JSON.parse(rawCandidates) as InventoryItem[]).map((item) => ({ ...item, isGuided: true }));
  } catch {
    window.localStorage.removeItem(guidedLibraryItemsStorageKey);
    return [];
  }
}

function readGuidedConfirmedItems(): InventoryItem[] {
  const rawCandidates = window.localStorage.getItem(guidedConfirmedItemsStorageKey);
  if (!rawCandidates) {
    return [];
  }

  try {
    return (JSON.parse(rawCandidates) as InventoryItem[]).map((item) => ({ ...item, isGuided: true }));
  } catch {
    window.localStorage.removeItem(guidedConfirmedItemsStorageKey);
    return [];
  }
}
