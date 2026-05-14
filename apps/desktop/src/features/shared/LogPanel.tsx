import { useMemo, useState } from "react";

import {
  Box,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogEvent = {
  id: string;
  timestamp: string;
  level: LogLevel;
  operation: string;
  operationLabel: string;
  entity: string;
  entityId: string;
  source?: string;
  project?: string;
  requestId: string;
  message: string;
  metadata: Array<[string, string]>;
};

const logLevelRank: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const logEvents: LogEvent[] = [
  {
    id: "evt-1842",
    timestamp: "18:42:17",
    level: "info",
    operation: "library.scan.complete",
    operationLabel: "Inventory scan",
    entity: "DataSource",
    entityId: "raw-poseidon-c",
    source: "Raw Poseidon-C",
    requestId: "op_01HY7TS9",
    message: "Inventory scan complete",
    metadata: [
      ["observed", "1,284 files"],
      ["sessions", "3"],
      ["duration", "41s"],
    ],
  },
  {
    id: "evt-1841",
    timestamp: "18:41:02",
    level: "debug",
    operation: "inventory.link.record",
    operationLabel: "Inventory index",
    entity: "InventoryRecord",
    entityId: "inv_33A19",
    source: "Raw Poseidon-C",
    requestId: "op_01HY7TRD",
    message: "Needs attention",
    metadata: [
      ["linkPolicy", "record only"],
      ["target", "../shared-flats"],
      ["followed", "false"],
    ],
  },
  {
    id: "evt-1840",
    timestamp: "18:40:28",
    level: "warn",
    operation: "path.warning.detect",
    operationLabel: "Path validation",
    entity: "InventoryRecord",
    entityId: "inv_4B20F",
    source: "Calibration Masters",
    requestId: "op_01HY7TQ8",
    message: "Path case conflict detected",
    metadata: [
      ["pathA", "Masters/Ha"],
      ["pathB", "Masters/HA"],
      ["platformRisk", "Windows"],
    ],
  },
  {
    id: "evt-1838",
    timestamp: "18:38:54",
    level: "info",
    operation: "project.detect",
    operationLabel: "Project discovery",
    entity: "Project",
    entityId: "m31-reprocess",
    project: "M31 luminance reprocess",
    requestId: "op_01HY7TNS",
    message: "Project-like folder detected",
    metadata: [
      ["projectJson", "missing"],
      ["workspace", "observed"],
      ["state", "Brownfield check"],
    ],
  },
  {
    id: "evt-1836",
    timestamp: "18:36:11",
    level: "error",
    operation: "marker.write",
    operationLabel: "Index update",
    entity: "CalibrationMaster",
    entityId: "master_dark_120s_gain100",
    source: "Calibration Masters",
    requestId: "op_01HY7TK1",
    message: "Index update failed",
    metadata: [
      ["path", "MasterDark_120s_gain100.xisf"],
      ["reason", "permission denied"],
      ["dbPromoted", "false"],
    ],
  },
];

const logLevelOptions: Array<{ value: LogLevel; label: string }> = [
  { value: "debug", label: "Debug" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warning" },
  { value: "error", label: "Error" },
];

const logLevelVisual: Record<
  LogLevel,
  {
    color: string;
  }
> = {
  debug: {
    color: "var(--text-3)",
  },
  info: {
    color: "var(--info)",
  },
  warn: {
    color: "var(--warning)",
  },
  error: {
    color: "var(--danger)",
  },
};

const expandedPanelHeight = "min(45vh, 30rem)";

export function LogPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [followLogs, setFollowLogs] = useState(true);
  const [minimumLevel, setMinimumLevel] = useState<LogLevel>("info");

  const filteredEvents = useMemo(
    () => logEvents.filter((event) => logLevelRank[event.level] >= logLevelRank[minimumLevel]),
    [minimumLevel],
  );

  const latestEvent = filteredEvents[0] ?? null;
  const latestSummary =
    latestEvent === null
      ? "No matching log entries."
      : `${latestEvent.timestamp} ${latestEvent.level.toUpperCase()} ${getLogOperationLabel(latestEvent)} ${latestEvent.message}`;

  return (
    <Paper
      className="app-log-overlay"
      radius={0}
      p={0}
      withBorder
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        borderLeft: "none",
        borderRight: "none",
        borderBottom: "none",
        overflow: "hidden",
        flex: "0 0 auto",
        minHeight: "1.9rem",
        maxHeight: isOpen ? expandedPanelHeight : "1.9rem",
        background: "var(--surface)",
        borderTop: "1px solid var(--border-soft)",
        transition: "max-height 150ms ease",
      }}
      aria-label="Application log"
    >
      <Button
        aria-expanded={isOpen}
        fullWidth
        variant="subtle"
        size="xs"
        radius={0}
        onClick={() => setIsOpen((open) => !open)}
        p={0}
        style={{
          justifyContent: "space-between",
          minHeight: "1.9rem",
          color: "var(--text-2)",
          borderBottom: isOpen ? "1px solid var(--border-soft)" : "none",
        }}
      >
        <Group gap="xs" justify="space-between" wrap="nowrap" w="100%">
          <Group gap="xs" maw="100%" style={{ overflow: "hidden", minWidth: 0 }}>
            <Text size="xs" fw={600} c="var(--text-1)" style={{ flexShrink: 0 }}>
              Logs
            </Text>
            <Tooltip label={latestSummary} withinPortal={false}>
              <Text size="xs" c="var(--text-3)" lineClamp={1} style={{ overflow: "hidden" }}>
                {latestSummary}
              </Text>
            </Tooltip>
          </Group>
          <Text size="xs" c="var(--text-3)" style={{ flexShrink: 0 }}>
            {isOpen ? "Hide" : "Show"}
          </Text>
        </Group>
      </Button>

      {isOpen ? (
        <>
          <Box p="xs" bg="var(--surface-raised)">
            <Group gap="xs" wrap="nowrap">
              <Select
                label="Level"
                value={minimumLevel}
                onChange={(value) => {
                  if (value) {
                    setMinimumLevel(value as LogLevel);
                  }
                }}
                data={logLevelOptions}
                w={130}
              />
              <Checkbox
                size="xs"
                label="Follow logs"
                checked={followLogs}
                onChange={(event) => setFollowLogs(event.currentTarget.checked)}
              />
            </Group>
          </Box>

          <Box style={{ minHeight: 0, flex: 1, overflow: "auto" }}>
            <Table
              withColumnBorders
              style={{ tableLayout: "fixed", width: "100%" }}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: "4.8rem" }}>Time</Table.Th>
                  <Table.Th style={{ width: "4rem" }}>Level</Table.Th>
                  <Table.Th style={{ width: "16rem" }}>Event</Table.Th>
                  <Table.Th>Message</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredEvents.length > 0 ? (
                  filteredEvents.map((event) => {
                    const levelVisual = logLevelVisual[event.level];
                    const eventMetadata = [
                      `entity ${event.entity}/${event.entityId}`,
                      `request ${event.requestId}`,
                      event.source ? `source ${event.source}` : null,
                      event.project ? `project ${event.project}` : null,
                      ...event.metadata.map(([label, value]) => `${label} ${value}`),
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    return (
                      <Table.Tr key={event.id}>
                        <Table.Td>
                          <LogCell text={event.timestamp} mono />
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" fw={650} c={levelVisual.color} style={{ textTransform: "uppercase" }}>
                            {event.level}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <LogCell text={getLogOperationLabel(event)} />
                        </Table.Td>
                        <Table.Td>
                          <LogCell text={`${event.message} · ${eventMetadata}`} />
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                ) : (
                  <Table.Tr>
                    <Table.Td colSpan={4}>
                      <Text size="xs" c="var(--text-3)" py={4} px={2}>
                        No log entries for this level.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Box>
        </>
      ) : null}
    </Paper>
  );
}

  function LogCell({ text, mono = false }: { text: string; mono?: boolean }) {
  return (
    <Tooltip label={text} withinPortal={false}>
      <Text
        size="xs"
        c="var(--text-2)"
        lineClamp={1}
        ff={mono ? "var(--font-mono)" : undefined}
        style={{ overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {text}
      </Text>
    </Tooltip>
  );
}

function getLogOperationLabel(event: LogEvent) {
  return event.operationLabel;
}
