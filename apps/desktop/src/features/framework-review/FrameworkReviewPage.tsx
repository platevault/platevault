import "@mantine/core/styles.css";

import { useMemo } from "react";
import {
  Accordion as MantineAccordion,
  ActionIcon as MantineActionIcon,
  Button as MantineButton,
  Group as MantineGroup,
  Menu as MantineMenu,
  Paper as MantinePaper,
  Stack as MantineStack,
  Table as MantineTable,
  Tabs as MantineTabs,
  Text as MantineText,
  Title as MantineTitle,
} from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  RefreshCw,
  Settings2,
} from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  type ColumnDef,
  useReactTable,
} from "@tanstack/react-table";

type ReviewPageId = "inbox" | "library" | "projects" | "settings";

type ReviewRow = {
  id: string;
  item: string;
  type: string;
  source: string;
  review: string;
  detail?: string;
};

type Fact = {
  label: string;
  value: string;
};

type FrameworkColumn = {
  key: keyof ReviewRow;
  title: string;
};

type ReviewPage = {
  id: ReviewPageId;
  title: string;
  eyebrow: string;
  mode: string;
  primaryAction: string;
  columns: FrameworkColumn[];
  rows: ReviewRow[];
  actions: {
    primary: string;
    showOpenLocation: boolean;
    menu: string[];
  };
  facts: Fact[];
  disclosures: Array<{ title: string; facts: Fact[] }>;
};

const reviewPages: ReviewPage[] = [
  {
    id: "inbox",
    title: "Inbox",
    eyebrow: "Source intake",
    mode: "Decision queue",
    primaryAction: "Scan inbox",
    columns: [
      { key: "item", title: "Item" },
      { key: "type", title: "Type" },
      { key: "source", title: "Source" },
      { key: "review", title: "Review state" },
    ],
    rows: [
      {
        id: "darks",
        item: "Master darks 120s gain 100",
        type: "Darks",
        source: "Sample Inbox",
        review: "Observed",
        detail: "Master dark file with stable metadata and exposure lock.",
      },
      {
        id: "bias",
        item: "Master bias gain 100",
        type: "Bias",
        source: "Sample Inbox",
        review: "Observed",
        detail: "Master bias file pending confirmation.",
      },
      {
        id: "flats",
        item: "L-Pro flats 2025-03-12",
        type: "Flats",
        source: "Sample Inbox",
        review: "Observed",
        detail: "Flat folder matched to expected light session.",
      },
      {
        id: "lights",
        item: "Heart & Soul lights 2025-03-10",
        type: "Lights",
        source: "Sample Inbox",
        review: "Observed",
        detail: "Session folder spans two filters and 80+ light sets.",
      },
    ],
    actions: {
      primary: "Confirm",
      showOpenLocation: true,
      menu: ["Open source", "Mark for project", "Review metadata"],
    },
    facts: [
      { label: "Selected", value: "Master darks 120s gain 100" },
      {
        label: "Path",
        value: "Sample Inbox\\Calibration\\Darks\\MasterDark_120s_gain100.xisf",
      },
      { label: "Exposure", value: "120s" },
      { label: "Gain / offset", value: "100 / 50" },
      { label: "Temperature", value: "-10C" },
    ],
    disclosures: [
      { title: "Warnings", facts: [{ label: "Current", value: "No warnings for selected dark master" }] },
    ],
  },
  {
    id: "library",
    title: "Inventory",
    eyebrow: "Stable library",
    mode: "Reviewed sources",
    primaryAction: "Resync",
    columns: [
      { key: "item", title: "Item" },
      { key: "type", title: "Type" },
      { key: "source", title: "Source" },
      { key: "review", title: "State" },
    ],
    rows: [
      {
        id: "darks",
        item: "Master darks 120s gain 100",
        type: "Dark master",
        source: "Inbox",
        review: "Needs review",
      },
      {
        id: "bias",
        item: "Master bias gain 100",
        type: "Bias master",
        source: "Inbox",
        review: "Needs review",
      },
      {
        id: "flats",
        item: "L-Pro flats 2025-03-12",
        type: "Flat set",
        source: "Inbox",
        review: "Needs review",
      },
      {
        id: "lights",
        item: "Heart & Soul lights 2025-03-10",
        type: "Light session",
        source: "Inbox",
        review: "Needs review",
      },
    ],
    actions: {
      primary: "Confirm",
      showOpenLocation: true,
      menu: ["Open in review", "Move to project", "Correct classification"],
    },
    facts: [
      { label: "Selected", value: "Master darks 120s gain 100" },
      { label: "State", value: "Needs review" },
      { label: "Source", value: "Inbox" },
      {
        label: "Path",
        value: "Sample Inbox\\Calibration\\Darks\\MasterDark_120s_gain100.xisf",
      },
      { label: "Review", value: "Verify metadata and confirm dark master" },
    ],
    disclosures: [
      { title: "Metadata", facts: [{ label: "Camera", value: "Poseidon-C PRO" }, { label: "Temperature", value: "-10C" }] },
    ],
  },
  {
    id: "projects",
    title: "Projects",
    eyebrow: "Project catalog",
    mode: "Prepared sources",
    primaryAction: "Add project",
    columns: [
      { key: "item", title: "Project" },
      { key: "type", title: "Target" },
      { key: "source", title: "State" },
      { key: "review", title: "Sources" },
    ],
    rows: [
      {
        id: "new",
        item: "New astro project",
        type: "IC 1805 / IC 1848",
        source: "Sources linked",
        review: "1 light session, flats optional, dark/bias selected",
      },
      {
        id: "heart-soul",
        item: "Heart & Soul Panel 1",
        type: "IC 1805 / IC 1848",
        source: "Sources linked",
        review: "3 light sessions, flats linked, dark/bias selected",
      },
      {
        id: "m31",
        item: "M31 luminance reprocess",
        type: "M31",
        source: "Sources linked",
        review: "1 brownfield folder",
      },
    ],
    actions: {
      primary: "Open",
      showOpenLocation: true,
      menu: ["Open source folder", "Open project tools", "Refresh ledger"],
    },
    facts: [
      { label: "Project", value: "New astro project" },
      { label: "State", value: "Sources linked" },
      { label: "Target", value: "IC 1805 / IC 1848" },
      { label: "Folder", value: "D:\\Astrophotography\\Projects\\New astro project" },
      { label: "Plan", value: "Project created, source folders linked" },
    ],
    disclosures: [
      {
        title: "Sources",
        facts: [
          { label: "Lights", value: "Heart & Soul lights 2025-03-10" },
          { label: "Flats", value: "L-Pro flats 2025-03-12" },
          { label: "Darks", value: "Master darks 120s gain 100" },
          { label: "Bias", value: "Master bias gain 100" },
        ],
      },
      {
        title: "Channels",
        facts: [
          { label: "L", value: "9h 20m, 200 frames, gain 100, -10C" },
          { label: "R", value: "4h, 80 frames, gain 100, -10C" },
        ],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    eyebrow: "Workflow defaults",
    mode: "Configuration",
    primaryAction: "Restart setup",
    columns: [
      { key: "item", title: "Setting" },
      { key: "type", title: "Value" },
      { key: "source", title: "Scope" },
      { key: "review", title: "State" },
    ],
    rows: [
      {
        id: "symlinks",
        item: "Symlinks",
        type: "Record link only",
        source: "Workflow safety",
        review: "Traversal requires review",
      },
      {
        id: "project-pattern",
        item: "Project folder pattern",
        type: "target / project",
        source: "Projects",
        review: "Token builder, no freeform path text",
      },
      {
        id: "dark-match",
        item: "Dark matching",
        type: "camera, exposure, gain, offset, temperature",
        source: "Calibration rules",
        review: "Recommendations only, manual override allowed",
      },
      {
        id: "log-level",
        item: "Log level",
        type: "Info",
        source: "Logs",
        review: "Follow logs remembered in log viewer",
      },
    ],
    actions: {
      primary: "Edit",
      showOpenLocation: false,
      menu: ["Open docs", "Reset to defaults", "Open source view"],
    },
    facts: [
      { label: "Selected", value: "Dark matching" },
      { label: "Scope", value: "Calibration recommendations" },
      { label: "Fields", value: "camera, exposure, gain, offset, temperature" },
      { label: "Saved", value: "Automatically on change" },
    ],
    disclosures: [
      {
        title: "Available fields",
        facts: [{ label: "Metadata", value: "camera, telescope, filter, exposure, gain, offset, binning, temperature" }],
      },
    ],
  },
];

export function FrameworkReviewPage() {
  const navigate = useNavigate({ from: "/framework-review" });
  const search = useSearch({ from: "/framework-review" });
  const page = getReviewPage(search.page ?? null);
  const activePage = reviewPages.find((candidate) => candidate.id === page) ?? reviewPages[0];

  return (
    <MantineStack gap="sm">
      <MantinePaper withBorder p="sm">
        <MantineStack gap="xs">
          <MantineText size="xs" fw={700} tt="uppercase" c="dimmed">
            Framework review
          </MantineText>
          <MantineTitle order={4}>Decision ledger</MantineTitle>
          <MantineText size="xs" c="dimmed">
            Reference route for stack confirmation: Mantine components, TanStack Table ledger
            logic, and TanStack Router navigation.
          </MantineText>
        </MantineStack>
        <MantineTabs
          mt="sm"
          value={page}
          onChange={(nextPage) => {
            const selectedPage = getReviewPage(nextPage);
            void navigate({
              search: (previous) => ({
                ...previous,
                page: selectedPage,
              }),
            });
          }}
        >
          <MantineTabs.List>
            {reviewPages.map((candidate) => (
              <MantineTabs.Tab value={candidate.id} key={candidate.id}>
                {candidate.title}
              </MantineTabs.Tab>
            ))}
          </MantineTabs.List>
        </MantineTabs>
      </MantinePaper>
      <FrameworkReviewTable page={activePage} />
    </MantineStack>
  );
}

function FrameworkReviewTable({ page }: { page: ReviewPage }) {
  const columns = useMemo<ColumnDef<ReviewRow>[]>(
    () => [
      ...page.columns.map((column) => ({
        accessorKey: column.key,
        header: column.title,
        cell: ({ getValue }: { getValue: () => unknown }) => (
          <MantineText size="sm" lineClamp={2}>
            {String(getValue())}
          </MantineText>
        ),
      })),
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => <ReviewActions page={page} row={row.original} />,
      },
    ],
    [page],
  );

  const table = useReactTable({
    data: page.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <MantinePaper withBorder p="sm">
      <MantineGroup justify="space-between" align="center" mb="xs">
        <MantineStack gap={0}>
          <MantineText size="xs" fw={700} tt="uppercase" c="dimmed">
            {page.eyebrow}
          </MantineText>
          <MantineGroup gap="xs" align="center">
            <MantineTitle order={5}>{page.title}</MantineTitle>
            <MantineText size="xs" c="dimmed">
              {page.mode}
            </MantineText>
          </MantineGroup>
        </MantineStack>
        <MantineButton size="xs" variant="light">
          {page.primaryAction}
        </MantineButton>
      </MantineGroup>

      <MantineTable withTableBorder withColumnBorders highlightOnHover>
        <MantineTable.Thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <MantineTable.Tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <MantineTable.Th key={header.id}>
                  {header.isPlaceholder ? null : (
                    <MantineText size="xs" fw={600}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </MantineText>
                  )}
                </MantineTable.Th>
              ))}
            </MantineTable.Tr>
          ))}
        </MantineTable.Thead>
        <MantineTable.Tbody>
          {table.getRowModel().rows.map((row) => (
            <MantineTable.Tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <MantineTable.Td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </MantineTable.Td>
              ))}
            </MantineTable.Tr>
          ))}
        </MantineTable.Tbody>
      </MantineTable>

      <MantineTable withTableBorder mt="sm">
        <MantineTable.Thead>
          <MantineTable.Tr>
            <MantineTable.Th>Field</MantineTable.Th>
            <MantineTable.Th>Value</MantineTable.Th>
          </MantineTable.Tr>
        </MantineTable.Thead>
        <MantineTable.Tbody>
          {page.facts.map((fact) => (
            <MantineTable.Tr key={fact.label}>
              <MantineTable.Td w={170} fw={700}>
                <MantineText size="xs">{fact.label}</MantineText>
              </MantineTable.Td>
              <MantineTable.Td>
                <MantineText size="xs">{fact.value}</MantineText>
              </MantineTable.Td>
            </MantineTable.Tr>
          ))}
        </MantineTable.Tbody>
      </MantineTable>

      <MantineAccordion variant="contained" defaultValue={page.disclosures[0]?.title} mt="sm">
        {page.disclosures.map((section) => (
          <MantineAccordion.Item value={section.title} key={section.title}>
            <MantineAccordion.Control>
              <MantineText size="xs" fw={600}>
                {section.title}
              </MantineText>
            </MantineAccordion.Control>
            <MantineAccordion.Panel>
              <MantineStack gap="xs">
                {section.facts.map((fact) => (
                  <MantineGroup key={fact.label} justify="space-between" gap="xs">
                    <MantineText size="xs" fw={700} c="dimmed">
                      {fact.label}
                    </MantineText>
                    <MantineText size="xs">{fact.value}</MantineText>
                  </MantineGroup>
                ))}
              </MantineStack>
            </MantineAccordion.Panel>
          </MantineAccordion.Item>
        ))}
      </MantineAccordion>
    </MantinePaper>
  );
}

function ReviewActions({ page, row }: { page: ReviewPage; row: ReviewRow }) {
  const menuIcon = (label: string) => {
    switch (label) {
      case "Open source":
      case "Open source folder":
        return <FileText size={14} />;
      case "Mark for project":
      case "Move to project":
        return <ChevronRight size={14} />;
      case "Review metadata":
      case "Correct classification":
      case "Open docs":
      case "Open source view":
        return <Settings2 size={14} />;
      case "Open in review":
      case "Open project tools":
      case "Reset to defaults":
      case "Refresh ledger":
        return <RefreshCw size={14} />;
      default:
        return <FileText size={14} />;
    }
  };

  return (
    <MantineGroup gap="xs" wrap="nowrap" justify="flex-end">
      <MantineButton size="xs" variant="filled">
        {page.actions.primary}
      </MantineButton>
      {page.actions.showOpenLocation && (
        <MantineActionIcon size="sm" variant="subtle" aria-label={`Open location for ${row.item}`}>
          <FolderOpen size={14} />
        </MantineActionIcon>
      )}
      <MantineMenu width={190} shadow="sm" withinPortal position="bottom-end">
        <MantineMenu.Target>
          <MantineActionIcon size="sm" variant="subtle" aria-label={`More actions for ${row.item}`}>
            <ChevronDown size={14} />
          </MantineActionIcon>
        </MantineMenu.Target>
        <MantineMenu.Dropdown>
          {page.actions.menu.map((item) => (
            <MantineMenu.Item key={item} leftSection={menuIcon(item)}>
              {item}
            </MantineMenu.Item>
          ))}
        </MantineMenu.Dropdown>
      </MantineMenu>
    </MantineGroup>
  );
}

function getReviewPage(value: string | null): ReviewPageId {
  return reviewPages.some((page) => page.id === value) ? (value as ReviewPageId) : "inbox";
}
