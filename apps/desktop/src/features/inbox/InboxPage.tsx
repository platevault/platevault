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
  Select,
  Stack,
  Table,
  Tooltip,
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
  guidedLibraryItemsStorageKey,
  libraryCandidateEvent,
  type GuidedFrameKind,
} from "../shared/guideEvents";

type InboxFrameKind = GuidedFrameKind | "mixed" | "unknown";

type InboxItem = {
  id: string;
  name: string;
  path: string;
  source: string;
  frameKind: InboxFrameKind;
  details: Array<{ label: string; value: string }>;
  warnings: string[];
  moreActions: string[];
};

type InboxFrameFilter = "all" | InboxFrameKind;

type LibraryCandidate = {
  id: string;
  name: string;
  path: string;
  source: "Inbox";
  frameKind: GuidedFrameKind;
  kind: string;
  details: Array<{ label: string; value: string }>;
  warnings: string[];
  moreActions: string[];
};

const guidedFrameOrder: GuidedFrameKind[] = ["darks", "bias", "flats", "lights"];

const guidedInboxItems: InboxItem[] = [
  {
    id: "guided-master-darks",
    name: "Master darks 120s gain 100",
    path: "Sample Inbox\\Calibration\\Darks\\MasterDark_120s_gain100.xisf",
    source: "Sample Inbox",
    frameKind: "darks",
    details: [
      { label: "Frame type", value: "Dark master" },
      { label: "Exposure", value: "120s" },
      { label: "Gain / offset", value: "100 / 50" },
      { label: "Temperature", value: "-10C" },
      { label: "Format", value: "XISF" },
    ],
    warnings: [],
    moreActions: ["Defer", "Ignore"],
  },
  {
    id: "guided-master-bias",
    name: "Master bias gain 100",
    path: "Sample Inbox\\Calibration\\Bias\\MasterBias_gain100.xisf",
    source: "Sample Inbox",
    frameKind: "bias",
    details: [
      { label: "Frame type", value: "Bias master" },
      { label: "Gain / offset", value: "100 / 50" },
      { label: "Camera", value: "Poseidon-C PRO" },
      { label: "Format", value: "XISF" },
    ],
    warnings: [],
    moreActions: ["Defer", "Ignore"],
  },
  {
    id: "guided-flats-lpro",
    name: "L-Pro flats 2025-03-12",
    path: "Sample Inbox\\Calibration\\Flats\\L-Pro\\2025-03-12",
    source: "Sample Inbox",
    frameKind: "flats",
    details: [
      { label: "Frame type", value: "Flat frames" },
      { label: "Filter", value: "L-Pro" },
      { label: "Frames", value: "48" },
      { label: "Gain / offset", value: "100 / 50" },
      { label: "Camera", value: "Poseidon-C PRO" },
    ],
    warnings: ["Rotation metadata missing on two sample files."],
    moreActions: ["Defer", "Ignore"],
  },
  {
    id: "guided-lights-heart-soul",
    name: "Heart & Soul lights 2025-03-10",
    path: "Sample Inbox\\Lights\\Heart Soul\\2025-03-10",
    source: "Sample Inbox",
    frameKind: "lights",
    details: [
      { label: "Frame type", value: "Light frames" },
      { label: "Target hint", value: "IC 1805 / IC 1848" },
      { label: "Frames", value: "126" },
      { label: "Filters", value: "L, R, G, B" },
      { label: "Capture software", value: "N.I.N.A. 3.0" },
    ],
    warnings: [],
    moreActions: ["Defer", "Ignore"],
  },
];

const initialInboxItems: InboxItem[] = [
  {
    id: "session-split",
    name: "20250318 Orion and Rosette",
    path: "Raw Poseidon-C\\20250318 Orion and Rosette",
    source: "Raw Poseidon-C",
    frameKind: "mixed",
    details: [
      { label: "Finding", value: "Multiple target hints in one immediate child folder" },
      { label: "Required action", value: "Split inside Inbox before moving to Inventory" },
      { label: "Mutation", value: "No automatic split will be applied" },
    ],
    warnings: ["Mixed folders cannot move to Inventory until split."],
    moreActions: ["Split folder", "Ignore"],
  },
  {
    id: "unknown-folder",
    name: "Manual exports March",
    path: "Drop Zone\\Manual exports March",
    source: "Drop Zone",
    frameKind: "unknown",
    details: [
      { label: "Finding", value: "No supported image metadata found yet" },
      { label: "Next step", value: "Classify or keep in Inbox" },
      { label: "Mutation", value: "Moving files requires a separate plan" },
    ],
    warnings: [],
    moreActions: ["Choose type", "Ignore"],
  },
];

export function InboxPage() {
  const search = useSearch({ from: "/inbox" });
  const navigate = useNavigate({ from: "/inbox" });

  const [inboxItems, setInboxItems] = useState(initialInboxItems);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => search.selected ?? null);
  const [scanStatus, setScanStatus] = useState<"idle" | "running" | "complete">("idle");
  const [actionNote, setActionNote] = useState("");
  const [frameFilter, setFrameFilter] = useState<InboxFrameFilter>(() => search.frame ?? "all");
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const scanTimeoutRef = useRef<number | null>(null);
  const frameSearchRef = useRef<InboxFrameFilter>(search.frame ?? "all");
  const selectedSearchRef = useRef<string | null>(search.selected ?? null);

  const columns = useMemo<ColumnDef<InboxItem>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
          const item = row.original;
          const guideKind = getGuidedFrameKind(item);

          return (
            <Stack gap={3}>
              <MantineButton
                variant="subtle"
                size="xs"
                p={0}
                justify="flex-start"
                onClick={() => selectInboxItem(item)}
                data-guide-target={guideKind ? `inbox-select-${guideKind}` : undefined}
              >
                {item.name}
              </MantineButton>
            </Stack>
          );
        },
      },
      {
        accessorKey: "path",
        header: "Path",
        cell: ({ getValue }) => <TruncatedCell value={getValue<string>()} />,
      },
      {
        accessorKey: "frameKind",
        header: "Type",
        cell: ({ getValue }) => <Text size="xs">{getFrameKindLabel(getValue<InboxFrameKind>())}</Text>,
        filterFn: (row, columnId, value) => {
          if (!value || value === "all") {
            return true;
          }

          return row.getValue<InboxFrameKind>(columnId) === value;
        },
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

            return (
              <RowActionMenu
                label={item.name}
                primaryLabel="Move"
                primaryLeftSection={<MoveRight size={14} />}
                primaryDisabled={!guideKind}
                onPrimary={() => moveToLibrary(item)}
                onOpenLocation={() => openInboxItemLocation(item)}
                compact
                actions={item.moreActions}
                onAction={(action) => applySecondaryAction(action, item)}
              />
            );
        },
      },
    ];
  }, []);

  const table = useReactTable({
    data: inboxItems,
    columns,
    state: {
      columnFilters,
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getRowId: (row) => row.id,
  });

  const visibleRows = table.getRowModel().rows;

  const selectedItem = useMemo(
    () => visibleRows.find((row) => row.original.id === selectedItemId)?.original ?? visibleRows[0]?.original ?? null,
    [selectedItemId, visibleRows],
  );

  useEffect(() => {
    if (frameFilter === "all") {
      setColumnFilters([]);
      return;
    }

    setColumnFilters([{ id: "frameKind", value: frameFilter }]);
  }, [frameFilter]);

  useEffect(() => {
    const routeFrame = search.frame ?? "all";
    if (frameSearchRef.current === routeFrame) {
      return;
    }

    frameSearchRef.current = routeFrame;
    setFrameFilter(routeFrame);
  }, [search.frame]);

  useEffect(() => {
    const routeSelected = search.selected ?? null;
    if (selectedSearchRef.current === routeSelected) {
      return;
    }

    selectedSearchRef.current = routeSelected;
    if (!routeSelected) {
      setSelectedItemId(null);
      return;
    }

    if (visibleRows.some((row) => row.original.id === routeSelected)) {
      setSelectedItemId(routeSelected);
    }
  }, [search.selected, visibleRows]);

  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current !== null) {
        window.clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed">
            Inbox
          </Text>
          <Text fw={600} size="sm" id="inbox-title">
            Queue
          </Text>
        </Stack>
        <MantineButton
          size="xs"
          loading={scanStatus === "running"}
          data-guide-target="inbox-scan"
          onClick={scanInbox}
        >
          {scanStatus === "running" ? "Scanning" : "Scan inbox"}
        </MantineButton>
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
                    Queue
                  </Text>
                  <Title order={3} id="inbox-list-title">
                    Items
                  </Title>
                </Stack>
                <Box maw={220} w={220}>
                  <Select
                    label="Frame type"
                    size="xs"
                    value={frameFilter}
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
                      const nextFrameFilter = (value as InboxFrameFilter) ?? "all";
                      setFrameFilter(nextFrameFilter);
                      if ((search.frame ?? "all") !== nextFrameFilter) {
                        void navigate({
                          search: (previous) => ({
                            ...previous,
                            frame: nextFrameFilter === "all" ? undefined : nextFrameFilter,
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
                      {table
                        .getHeaderGroups()
                        .flatMap((headerGroup) => headerGroup.headers)
                        .map((header) => (
                          <Table.Th key={header.id} style={getInboxHeaderStyle(header.id)}>
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
                            <Text fw={700}>No Inbox items</Text>
                            <Text size="xs" c="dimmed">
                              Run an Inbox scan to create the sample lights and calibration placeholders.
                            </Text>
                          </Stack>
                        </Table.Td>
                      </Table.Tr>
                    ) : null}
                      {visibleRows.map((row) => {
                        const item = row.original;
                        const isSelected = selectedItem ? row.original.id === selectedItem.id : false;

                      return (
                        <Table.Tr
                          key={row.id}
                          data-selected={isSelected}
                          style={isSelected ? { backgroundColor: "var(--surface-selected)" } : undefined}
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
          </Paper>
        </Box>
        <Box style={{ flex: "0 1 22rem", minWidth: "20rem" }}>
          <Paper withBorder p="sm" radius="sm" aria-label="Selected Inbox item details">
            {selectedItem ? (
              <SelectedInboxItem
                item={selectedItem}
                onAction={applySecondaryAction}
                onMove={moveToLibrary}
                onOpenLocation={openInboxItemLocation}
              />
            ) : (
              <Stack gap="xs">
                <Text fw={700} size="sm">
                  No item selected
                </Text>
              </Stack>
            )}
          </Paper>
        </Box>
      </Group>
    </Stack>
  );

  function scanInbox() {
    if (scanTimeoutRef.current !== null) {
      window.clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }

    setScanStatus("running");
    setActionNote("Scanning Inbox source roots");

    const timeoutId = window.setTimeout(() => {
      setInboxItems((current) => mergeGuidedItems(current));
      setSelectedItemId(null);
      setScanStatus("complete");
      setActionNote("Inbox scan complete. Review the sample darks, bias, flats, and lights.");
      emitGuideAction("inbox.scan-complete");
      scanTimeoutRef.current = null;
    }, 700);

    scanTimeoutRef.current = timeoutId;
  }

  function selectInboxItem(item: InboxItem) {
    setSelectedItemId(item.id);
    if (search.selected !== item.id) {
      void navigate({
        search: (previous) => ({
          ...previous,
          selected: item.id,
        }),
      });
    }
    setActionNote(`Selected ${item.name}`);
    const guideKind = getGuidedFrameKind(item);
    if (guideKind) {
      emitGuideAction(`inbox.select-item.${guideKind}`);
    }
  }

  function moveToLibrary(item: InboxItem) {
    const guideKind = getGuidedFrameKind(item);
    if (!guideKind) {
      setActionNote("Split or classify this Inbox item before moving it to Inventory.");
      return;
    }

    const promotedItem: LibraryCandidate = {
      id: `inbox-${item.id}`,
      name: item.name,
      path: item.path,
      source: "Inbox",
      frameKind: guideKind,
      kind: getLibraryKind(guideKind),
      details: [
        ...item.details,
        { label: "Inbox source", value: item.source },
        { label: "Move result", value: "Promoted to Inventory for confirmation" },
      ],
      warnings: item.warnings,
      moreActions: ["Edit metadata", "Defer"],
    };

    writeGuidedLibraryCandidate(promotedItem);
    window.dispatchEvent(new CustomEvent(libraryCandidateEvent));
    setInboxItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setSelectedItemId(null);
    setActionNote(`Moved to Inventory: ${item.name}`);
    emitGuideAction(`inbox.move-to-library.${guideKind}`);
  }

  function applySecondaryAction(action: string, item: InboxItem) {
    if (action === "Open location") {
      openInboxItemLocation(item);
      return;
    }

    setActionNote(`${action}: ${item.name}`);
  }

  function openInboxItemLocation(item: InboxItem) {
    // Tauri TODO: replace this prototype note with a native file-browser reveal command.
    setActionNote(`Open location: ${item.path}`);
  }
}

function SelectedInboxItem({
  item,
  onAction,
  onMove,
  onOpenLocation,
}: {
  item: InboxItem;
  onAction: (action: string, item: InboxItem) => void;
  onMove: (item: InboxItem) => void;
  onOpenLocation: (item: InboxItem) => void;
}) {
  const guideKind = getGuidedFrameKind(item);
  const topLevelLabels = new Set(["Frame type", "Source", "Path"]);
  const details = [
    { label: "Frame type", value: getFrameKindLabel(item.frameKind) },
    { label: "Source", value: item.source },
    { label: "Path", value: item.path },
    ...item.details.filter((detail) => !topLevelLabels.has(detail.label)),
  ];

  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {getFrameKindLabel(item.frameKind)}
        </Text>
        <Title order={4}>{item.name}</Title>
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
          primaryLabel="Move to Inventory"
          primaryLeftSection={<MoveRight size={14} />}
          primaryDisabled={!guideKind}
          guideTarget={guideKind ? `inbox-move-library-${guideKind}` : undefined}
          onPrimary={() => onMove(item)}
          onOpenLocation={() => onOpenLocation(item)}
          compact
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
  primaryDisabled,
  guideTarget,
  actions,
  onPrimary,
  onAction,
  onOpenLocation,
  primaryLeftSection,
  compact = false,
}: {
  label: string;
  primaryLabel: string;
  primaryDisabled?: boolean;
  guideTarget?: string;
  actions: string[];
  onPrimary: () => void;
  onAction: (action: string) => void;
  onOpenLocation: () => void;
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
        leftSection={primaryLeftSection}
        px={compact ? "var(--mantine-spacing-xs)" : undefined}
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

function getInboxHeaderStyle(columnId: string) {
  if (columnId === "name") {
    return { minWidth: "14rem", width: "22%" };
  }
  if (columnId === "path") {
    return { minWidth: "16rem", width: "36%" };
  }
  if (columnId === "frameKind" || columnId === "source") {
    return { width: "9rem", whiteSpace: "nowrap" };
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

function mergeGuidedItems(current: InboxItem[]) {
  const existingIds = new Set(current.map((item) => item.id));
  const missingGuidedItems = guidedInboxItems.filter((item) => !existingIds.has(item.id));
  return [...missingGuidedItems, ...current];
}

function getGuidedFrameKind(item: InboxItem): GuidedFrameKind | null {
  return guidedFrameOrder.includes(item.frameKind as GuidedFrameKind) ? (item.frameKind as GuidedFrameKind) : null;
}

function getFrameKindLabel(kind: InboxFrameKind) {
  const labels: Record<InboxFrameKind, string> = {
    lights: "Lights",
    darks: "Darks",
    bias: "Bias",
    flats: "Flats",
    mixed: "Mixed",
    unknown: "Unknown",
  };

  return labels[kind];
}

function getLibraryKind(kind: GuidedFrameKind) {
  const labels: Record<GuidedFrameKind, string> = {
    lights: "Light session",
    darks: "Dark master",
    bias: "Bias master",
    flats: "Flat set",
  };

  return labels[kind];
}

function writeGuidedLibraryCandidate(candidate: LibraryCandidate) {
  const currentItems = readGuidedLibraryCandidates();
  const nextItems = [candidate, ...currentItems.filter((item) => item.id !== candidate.id)];
  window.localStorage.setItem(guidedLibraryItemsStorageKey, JSON.stringify(nextItems));
}

function readGuidedLibraryCandidates(): LibraryCandidate[] {
  const rawCandidates = window.localStorage.getItem(guidedLibraryItemsStorageKey);
  if (!rawCandidates) {
    return [];
  }

  try {
    return JSON.parse(rawCandidates) as LibraryCandidate[];
  } catch {
    window.localStorage.removeItem(guidedLibraryItemsStorageKey);
    return [];
  }
}
