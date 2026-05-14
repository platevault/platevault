import "@mantine/core/styles.css";
import {
  Alert,
  Button,
  Group,
  List,
  Loader,
  Modal,
  Paper,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Fragment, useEffect, useMemo, useState } from "react";

import { startFirstStepGuide, stopFirstStepGuide } from "./guideEvents";

type SourceStepId = "raw" | "calibration" | "projects" | "inbox";
type ScanStatus = "idle" | "running" | "complete" | "blocked";
type RowPreviewStatus = "idle" | "running" | "complete";

type SourcePreviewSummary = {
  found: string;
  warning: string;
  entries: PreviewEntry[];
};

type PreviewEntry = {
  path: string;
  kind: string;
  warning: string;
};

type SourceDraft = {
  id: string;
  label: string;
  selectedRoot: string;
  selectedCount: number;
  previewStatus: RowPreviewStatus;
  previewSummary?: SourcePreviewSummary;
  selectionError?: string;
};

type ScanPreviewRow = SourcePreviewSummary & {
  id: string;
  kind: string;
  label: string;
  root: string;
};

type SourceValidationResult = {
  sourceErrors: Partial<Record<SourceStepId, string>>;
  rowErrors: Record<string, string>;
  allValid: boolean;
};

const storageKey = "astro-plan:first-run-wizard";

const sourceStepDefinitions: Array<{
  id: SourceStepId;
  stepLabel: string;
  tableLabel: string;
  explanation: string;
  defaultLabel: string;
  category: string;
  pickHint: string;
  usedFor: string;
}> = [
  {
    id: "raw",
    stepLabel: "Raw",
    tableLabel: "Raw",
    explanation: "Choose the parent directory containing your capture session folders.",
    category: "Primary ingest",
    defaultLabel: "Primary raw sources",
    pickHint: "Directory with one folder per capture session.",
    usedFor: "Builds the inventory from fresh raw sessions.",
  },
  {
    id: "calibration",
    stepLabel: "Calibration",
    tableLabel: "Calibration",
    explanation: "Choose the directory containing your dark, bias, and flat calibration masters.",
    category: "Quality consistency",
    defaultLabel: "Calibration masters",
    pickHint: "Directory with master frames or grouped calibration sessions.",
    usedFor: "Supplies reusable calibration references during project setup.",
  },
  {
    id: "projects",
    stepLabel: "Projects",
    tableLabel: "Projects",
    explanation: "Choose the parent directory containing existing processing projects.",
    category: "Project reuse",
    defaultLabel: "Processing projects",
    pickHint: "Directory where your project folders are stored.",
    usedFor: "Imports existing projects into the app workspace.",
  },
  {
    id: "inbox",
    stepLabel: "Inbox",
    tableLabel: "Inbox",
    explanation: "Choose the drop-zone directory for new or mixed data awaiting review.",
    category: "Staging zone",
    defaultLabel: "Inbox drop zone",
    pickHint: "Directory used as a quarantine/review queue.",
    usedFor: "Keeps incoming material separate until you route it.",
  },
];

const wizardSteps = ["Welcome", "Sources", "Flow", ...sourceStepDefinitions.map((step) => step.stepLabel), "Preview"];

function makeSourceDraft(label: string): SourceDraft {
  return {
    id: crypto.randomUUID(),
    label,
    selectedRoot: "",
    selectedCount: 0,
    previewStatus: "idle",
  };
}

const initialSources: Record<SourceStepId, SourceDraft[]> = {
  raw: [makeSourceDraft("Primary raw sources")],
  calibration: [makeSourceDraft("Calibration masters")],
  projects: [makeSourceDraft("Processing projects")],
  inbox: [makeSourceDraft("Inbox drop zone")],
};

export function FirstRunWizard() {
  const [isVisible, setIsVisible] = useState(() => getInitialVisibility());
  const [stepIndex, setStepIndex] = useState(0);
  const [sources, setSources] = useState(initialSources);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanRows, setScanRows] = useState<ScanPreviewRow[]>([]);

  const currentStep = wizardSteps[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === wizardSteps.length - 1;
  const currentSourceDefinition = getSourceDefinition(currentStep);

  const includedSources = useMemo(
    () => Object.values(sources).flat().filter((source) => source.selectedRoot.length > 0),
    [sources],
  );

  const validation = useMemo(() => validateSources(sources), [sources]);
  const allRequiredSourcesSelected = validation.allValid;

  const scanInputKey = useMemo(
    () =>
      sourceStepDefinitions
        .map((definition) =>
          sources[definition.id]
            .map((source) => `${definition.id}:${source.label}:${source.selectedRoot}:${source.selectedCount}`)
            .join(","),
        )
        .join("|"),
    [sources],
  );

  useEffect(() => {
    const openWizard = () => {
      stopFirstStepGuide();
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem("astro-plan:first-step-guide");
      window.localStorage.removeItem("astro-plan:first-step-guide:step");
      setStepIndex(0);
      setScanStatus("idle");
      setScanRows([]);
      setIsVisible(true);
    };

    window.addEventListener("astro-plan:open-first-run-wizard", openWizard);
    return () => window.removeEventListener("astro-plan:open-first-run-wizard", openWizard);
  }, []);

  useEffect(() => {
    if (currentStep !== "Preview") {
      return;
    }

    if (!allRequiredSourcesSelected) {
      setScanStatus("blocked");
      setScanRows([]);
      return;
    }

    setScanStatus("running");
    setScanRows(buildPendingScanRows(sources));

    const timeoutId = window.setTimeout(() => {
      setScanRows(buildCompletedScanRows(sources));
      setScanStatus("complete");
    }, 1200);

    return () => window.clearTimeout(timeoutId);
  }, [allRequiredSourcesSelected, currentStep, scanInputKey, sources]);

  if (!isVisible) {
    return null;
  }

  const sourceValidationMessage =
    currentSourceDefinition
      ? validation.sourceErrors[currentSourceDefinition.id] ?? null
      : null;
  const visibleSourceValidationMessage =
    currentSourceDefinition && shouldShowSourceValidation(currentSourceDefinition.id, sources, validation.rowErrors)
      ? sourceValidationMessage
      : null;
  const visibleRowErrors = currentSourceDefinition
    ? getVisibleRowErrors(currentSourceDefinition.id, sources, validation.rowErrors)
    : validation.rowErrors;
  const canContinue = currentSourceDefinition
    ? !sourceValidationMessage
    : isLastStep
      ? scanStatus === "complete" && allRequiredSourcesSelected
      : true;

  const finishWizard = () => {
    if (scanStatus !== "complete") {
      return;
    }

    window.localStorage.setItem(storageKey, "completed");
    setIsVisible(false);
    startFirstStepGuide();
  };

  const skipSetup = () => {
    window.localStorage.setItem(storageKey, "skipped");
    setIsVisible(false);
  };

  const goNext = () => {
    if (!canContinue) {
      return;
    }

    setStepIndex((index) => Math.min(index + 1, wizardSteps.length - 1));
  };
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0));

  return (
    <Modal
      opened={isVisible}
      onClose={skipSetup}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title={<Text tt="uppercase" c="dimmed" fw={700} size="sm">First run</Text>}
      size={1010}
      centered
      padding="sm"
    >
      <Stack gap="sm">
        <Stack gap="xs">
          <Title order={4} id="first-run-wizard-title">
            {currentStep}
          </Title>
          {renderStepDescription(currentStep, includedSources.length)}
        </Stack>

        <Stepper active={stepIndex} size="xs" mb="xs">
          {wizardSteps.map((step) => (
            <Stepper.Step key={step} label={step} />
          ))}
        </Stepper>

        {currentStep === "Welcome" ? <WelcomeStep /> : null}
        {currentStep === "Sources" ? <SourcesStep /> : null}
        {currentStep === "Flow" ? <FlowStep /> : null}

        {currentSourceDefinition ? (
          <SourceStep
            definition={currentSourceDefinition}
            rows={sources[currentSourceDefinition.id]}
            validationMessage={visibleSourceValidationMessage}
            rowErrors={visibleRowErrors}
            onAddRow={() => addSourceRow(currentSourceDefinition.id)}
            onRemoveRow={(rowId) => removeSourceRow(currentSourceDefinition.id, rowId)}
            onUpdateRow={(rowId, patch) => updateSourceRow(currentSourceDefinition.id, rowId, patch)}
            onPreviewRow={(rowId) => previewSourceRow(currentSourceDefinition.id, rowId)}
          />
        ) : null}

        {currentStep === "Preview" ? (
          <Paper withBorder p="xs" radius="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center" wrap="wrap">
                <Text fw={700} size="xs">
                  {getScanStatusLabel(scanStatus)}
                </Text>
                {scanStatus === "running" ? <Loader size="sm" aria-label="Scanning source roots" /> : null}
                  {scanStatus === "complete" ? (
                  <Text size="xs" c="dimmed">
                    Ready for guided steps
                  </Text>
                ) : null}
              </Group>

              {scanStatus === "blocked" ? (
                <Alert color="red" variant="light" role="alert">
                  Each source type needs at least one selected root before the preview scan can run.
                </Alert>
              ) : null}

              <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Source</Table.Th>
                    <Table.Th>Path</Table.Th>
                    <Table.Th>Scan</Table.Th>
                    <Table.Th>Entries</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {scanRows.map((row) => (
                    <Table.Tr key={row.id}>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="xs" fw={700}>
                            {row.label}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {row.kind}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ minWidth: 220, overflowWrap: "anywhere" }}>
                        <Text size="xs" c="dimmed">
                          {row.root}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          <Group gap="xs" align="center">
                            {scanStatus === "running" ? <Loader size="xs" aria-hidden="true" /> : null}
                            <Text fw={700} size="xs">
                              {row.found}
                            </Text>
                          </Group>
                          <Text size="xs" c={row.warning === "None" ? "dimmed" : "orange"}>
                            {row.warning}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <PreviewEntryList entries={row.entries} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>

              <Group grow>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={600}>
                    Roots
                  </Text>
                  <Text fw={700} size="xs">
                    {includedSources.length} selected
                  </Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={600}>
                    Preview
                  </Text>
                  <Text fw={700} size="xs">
                    {scanStatus === "complete" ? "Complete" : "Required"}
                  </Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed" fw={600}>
                    After setup
                  </Text>
                  <Text fw={700} size="xs">
                    Guided first steps
                  </Text>
                </Stack>
              </Group>
            </Stack>
          </Paper>
        ) : null}

        <Group justify="space-between" mt="sm">
          <Button variant="default" size="xs" onClick={skipSetup}>
            Skip setup
          </Button>
          <Group>
            <Button size="xs" variant="subtle" onClick={goBack} disabled={isFirstStep}>
              Back
            </Button>
            <Button size="xs" onClick={isLastStep ? finishWizard : goNext} disabled={!canContinue}>
              {isLastStep ? "Finish setup" : "Next"}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );

  function addSourceRow(sourceId: SourceStepId) {
    const definition = sourceStepDefinitions.find((step) => step.id === sourceId);
    setSources((drafts) => ({
      ...drafts,
      [sourceId]: [...drafts[sourceId], makeSourceDraft(`${definition?.defaultLabel ?? "Source"} ${drafts[sourceId].length + 1}`)],
    }));
  }

  function removeSourceRow(sourceId: SourceStepId, rowId: string) {
    setSources((drafts) => ({
      ...drafts,
      [sourceId]: drafts[sourceId].filter((row) => row.id !== rowId),
    }));
  }

  function updateSourceRow(sourceId: SourceStepId, rowId: string, patch: Partial<SourceDraft>) {
    setSources((drafts) => ({
      ...drafts,
      [sourceId]: drafts[sourceId].map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }));
  }

  function previewSourceRow(sourceId: SourceStepId, rowId: string) {
    const row = sources[sourceId].find((candidate) => candidate.id === rowId);
    if (!row?.selectedRoot) {
      return;
    }

    updateSourceRow(sourceId, rowId, { previewStatus: "running", previewSummary: undefined });

    window.setTimeout(() => {
      setSources((drafts) => ({
        ...drafts,
        [sourceId]: drafts[sourceId].map((candidate) =>
          candidate.id === rowId
            ? {
                ...candidate,
                previewStatus: "complete",
                previewSummary: makeScanSummary(sourceId, candidate.selectedCount, candidate.selectedRoot),
              }
            : candidate,
        ),
      }));
    }, 650);
  }
}

function SourceStep({
  definition,
  rows,
  validationMessage,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onPreviewRow,
  rowErrors,
}: {
  definition: (typeof sourceStepDefinitions)[number];
  rows: SourceDraft[];
  validationMessage: string | null;
  rowErrors: Record<string, string>;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  onUpdateRow: (rowId: string, patch: Partial<SourceDraft>) => void;
  onPreviewRow: (rowId: string) => void;
}) {
  return (
    <Stack gap="sm">
      <Stack gap={2}>
        <Text fw={700} size="sm">
          {definition.stepLabel} source root
        </Text>
        <Text size="xs" c="dimmed">
          {definition.explanation}
        </Text>
      </Stack>
      {validationMessage ? (
        <Alert color="red" variant="light" role="alert">
          {validationMessage}
        </Alert>
      ) : null}
      <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Label</Table.Th>
            <Table.Th>Source root</Table.Th>
            <Table.Th>Preview</Table.Th>
            <Table.Th>Action</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => {
            const directoryMessage = row.selectionError || rowErrors[row.id];
            return (
              <Fragment key={row.id}>
                <Table.Tr>
                  <Table.Td>
                      <TextInput
                        size="xs"
                        value={row.label}
                        aria-label={`${definition.stepLabel} label`}
                        onChange={(event) => onUpdateRow(row.id, { label: event.currentTarget.value })}
                      />
                  </Table.Td>
                  <Table.Td>
                    <Stack gap="xs">
                      <TextInput
                        size="xs"
                        value={row.selectedRoot}
                        onChange={(event) => onUpdateRow(row.id, deriveDirectorySelection(event.currentTarget.value))}
                        aria-label={`${definition.stepLabel} directory path`}
                        placeholder={makeDirectoryPlaceholder(definition.id)}
                        error={directoryMessage}
                        rightSection={
                          // Tauri TODO: replace this prototype path shortcut with the native directory picker.
                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() =>
                              onUpdateRow(row.id, deriveDirectorySelection(makeSampleDirectory(definition.id, row.label)))
                            }
                          >
                            Choose directory
                          </Button>
                        }
                      />
                      {directoryMessage ? null : (
                        <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                          {row.selectedRoot || "No directory selected"}
                        </Text>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    {row.previewStatus === "running" ? (
                      <Group gap="xs" align="center">
                        <Loader size="xs" aria-hidden="true" />
                        <Text size="xs">Scanning directory</Text>
                      </Group>
                    ) : row.previewStatus === "complete" && row.previewSummary ? (
                      <Stack gap={2}>
                        <Text fw={700} size="xs">
                          {row.previewSummary.found}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {row.previewSummary.warning}
                        </Text>
                      </Stack>
                    ) : (
                      <Text size="xs" c="dimmed">
                        Preview available
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => onPreviewRow(row.id)}
                        disabled={!row.selectedRoot || Boolean(rowErrors[row.id]) || row.previewStatus === "running"}
                      >
                        Preview
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => onRemoveRow(row.id)}>
                        Remove
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
                {row.previewStatus === "complete" && row.previewSummary ? (
                  <Table.Tr>
                    <Table.Td colSpan={4}>
                      <Paper withBorder p="xs" radius="sm" mt="xs">
                        <Group justify="space-between" align="center" mb="xs">
                          <Text fw={700} size="xs">
                            {row.previewSummary.found}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {row.previewSummary.warning}
                          </Text>
                        </Group>
                        <PreviewEntryList entries={row.previewSummary.entries} />
                      </Paper>
                    </Table.Td>
                  </Table.Tr>
                ) : null}
              </Fragment>
            );
          })}
        </Table.Tbody>
      </Table>
      <Button size="xs" variant="default" onClick={onAddRow}>
        Add source
      </Button>
    </Stack>
  );
}

function PreviewEntryList({ entries }: { entries: PreviewEntry[] }) {
  return (
    <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Path</Table.Th>
          <Table.Th>Kind</Table.Th>
          <Table.Th>Warning</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
      {entries.map((entry) => (
        <Table.Tr key={entry.path}>
          <Table.Td style={{ overflowWrap: "anywhere" }}>
            <Text size="xs">{entry.path}</Text>
          </Table.Td>
          <Table.Td>
            <Text size="xs" c="dimmed">
              {entry.kind}
            </Text>
          </Table.Td>
          <Table.Td>
            <Text size="xs" c="dimmed">
              {entry.warning}
            </Text>
          </Table.Td>
        </Table.Tr>
      ))}
      </Table.Tbody>
    </Table>
  );
}

function WelcomeStep() {
  return (
    <Stack gap="sm">
      <Text size="sm" fw={700}>
        This is a quick first-run orientation.
      </Text>
      <Text size="xs" c="dimmed">
        This step links your source roots to the app and prepares a scan preview before the first project action.
      </Text>
      <Text size="xs" c="dimmed">
        You can skip setup now to open the workspace, then start setup anytime from Settings.
      </Text>
      <List size="xs" spacing="xs" withPadding>
        <List.Item>Start by defining directories, then launch setup actions from guided flow.</List.Item>
        <List.Item>Review what each selected folder contributes in the preview.</List.Item>
        <List.Item>Proceed to guided project setup after completion.</List.Item>
      </List>
    </Stack>
  );
}

function SourcesStep() {
  return (
    <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Category</Table.Th>
          <Table.Th>Choose</Table.Th>
          <Table.Th>Used for</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sourceStepDefinitions.map((source) => (
          <Table.Tr key={source.id}>
            <Table.Td>
              <Stack gap={2}>
                <Text size="xs" fw={700}>
                  {source.tableLabel}
                </Text>
                <Text size="xs" c="dimmed">
                  {source.category}
                </Text>
              </Stack>
            </Table.Td>
            <Table.Td>
              <Text size="xs" fw={500}>
                {source.pickHint}
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">
                {source.usedFor}
              </Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function FlowStep() {
  return (
    <Stack gap="sm">
      <Text size="sm" fw={700}>
        Setup flow
      </Text>
      <Text size="xs" c="dimmed">
        Complete three setup steps: configure source roots, preview results, then continue into guided first project flow.
      </Text>
      <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Step</Table.Th>
            <Table.Th>What happens</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>
              <Text size="xs" fw={700}>
                1) Configure source categories
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">
                Pick Raw, Calibration, Projects, and Inbox directories for the paths you want reviewed.
              </Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text size="xs" fw={700}>
                2) Run the scan preview
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">
                Review the folders and files each selected root contributes.
              </Text>
            </Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Td>
              <Text size="xs" fw={700}>
                3) Start guided project setup
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">
                Continue directly into guided first project flow from the previewed inventory.
              </Text>
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function deriveDirectorySelection(value: string): Partial<SourceDraft> {
  return {
    selectedRoot: value,
    selectedCount: estimateDirectoryEntryCount(value),
    previewStatus: "idle" as const,
    previewSummary: undefined,
    selectionError: undefined,
  };
}

function getInitialVisibility() {
  return window.localStorage.getItem(storageKey) !== "completed" && window.localStorage.getItem(storageKey) !== "skipped";
}

function getSourceDefinition(step: string) {
  return sourceStepDefinitions.find((definition) => definition.stepLabel === step) ?? null;
}

function shouldShowSourceValidation(
  sourceId: SourceStepId,
  sourceState: Record<SourceStepId, SourceDraft[]>,
  rowErrors: Record<string, string>,
) {
  const rows = sourceState[sourceId];
  if (rows.length > 1) {
    return rows.some((row) => rowErrors[row.id]);
  }

  const row = rows[0];
  if (!row) {
    return true;
  }

  const rowError = rowErrors[row.id];
  if (!rowError) {
    return false;
  }

  return row.selectedRoot.length > 0 || !normalizeName(row.label) || !rowError.includes("Choose a directory.");
}

function getVisibleRowErrors(
  sourceId: SourceStepId,
  sourceState: Record<SourceStepId, SourceDraft[]>,
  rowErrors: Record<string, string>,
) {
  const visibleErrors: Record<string, string> = {};
  const rows = sourceState[sourceId];

  for (const row of rows) {
    const rowError = rowErrors[row.id];
    if (!rowError) {
      continue;
    }

    if (rows.length > 1 || row.selectedRoot.length > 0 || !normalizeName(row.label) || !rowError.includes("Choose a directory.")) {
      visibleErrors[row.id] = rowError;
    }
  }

  return visibleErrors;
}

function validateSources(sourceState: Record<SourceStepId, SourceDraft[]>): SourceValidationResult {
  const sourceErrors: Partial<Record<SourceStepId, string>> = {};
  const rowErrors: Record<string, string> = {};
  const labels = new Map<string, string[]>();
  const roots = new Map<string, string[]>();

  for (const definition of sourceStepDefinitions) {
    const rows = sourceState[definition.id];

    if (rows.length === 0) {
      sourceErrors[definition.id] = `Add at least one ${definition.stepLabel.toLowerCase()} root.`;
      continue;
    }

    for (const row of rows) {
      const normalizedLabel = normalizeName(row.label);
      const normalizedRoot = normalizeRoot(row.selectedRoot);

      if (!normalizedLabel) {
        addRowError(rowErrors, row.id, "Source name is required.");
      } else {
        labels.set(normalizedLabel, [...(labels.get(normalizedLabel) ?? []), row.id]);
      }

      if (!normalizedRoot) {
        addRowError(rowErrors, row.id, "Choose a directory.");
      } else if (looksLikeFilePath(normalizedRoot)) {
        addRowError(rowErrors, row.id, "Sources must be directories, not files.");
      } else {
        roots.set(normalizedRoot, [...(roots.get(normalizedRoot) ?? []), row.id]);
      }
    }
  }

  for (const duplicateIds of labels.values()) {
    if (duplicateIds.length > 1) {
      duplicateIds.forEach((rowId) => addRowError(rowErrors, rowId, "Source name must be unique."));
    }
  }

  for (const duplicateIds of roots.values()) {
    if (duplicateIds.length > 1) {
      duplicateIds.forEach((rowId) => addRowError(rowErrors, rowId, "Source root is already selected."));
    }
  }

  for (const definition of sourceStepDefinitions) {
    const rows = sourceState[definition.id];
    if (!sourceErrors[definition.id] && rows.some((row) => rowErrors[row.id])) {
      sourceErrors[definition.id] = "Fix the highlighted source rows before continuing.";
    }
  }

  return {
    sourceErrors,
    rowErrors,
    allValid: Object.keys(sourceErrors).length === 0 && Object.keys(rowErrors).length === 0,
  };
}

function buildPendingScanRows(sourceState: Record<SourceStepId, SourceDraft[]>): ScanPreviewRow[] {
  return selectedSourceRows(sourceState).map(({ definition, source }) => ({
    id: source.id,
    kind: definition.tableLabel,
    label: source.label,
    root: source.selectedRoot,
    found: "Reading directory",
    warning: "Checking structure",
    entries: [
      {
        path: source.selectedRoot,
        kind: "Directory",
        warning: "Scan still running",
      },
    ],
  }));
}

function buildCompletedScanRows(sourceState: Record<SourceStepId, SourceDraft[]>): ScanPreviewRow[] {
  return selectedSourceRows(sourceState).map(({ definition, source }) => {
    const summary = makeScanSummary(definition.id, source.selectedCount, source.selectedRoot);

    return {
      id: source.id,
      kind: definition.tableLabel,
      label: source.label,
      root: source.selectedRoot,
      found: summary.found,
      warning: summary.warning,
      entries: summary.entries,
    };
  });
}

function selectedSourceRows(sourceState: Record<SourceStepId, SourceDraft[]>) {
  return sourceStepDefinitions.flatMap((definition) =>
    sourceState[definition.id]
      .filter((source) => source.selectedRoot.length > 0)
      .map((source) => ({ definition, source })),
  );
}

function makeScanSummary(kind: SourceStepId, selectedCount: number, root = ""): SourcePreviewSummary {
  const count = Math.max(selectedCount, 1);
  const entries = makePreviewEntries(kind, root);
  const warningCount = entries.filter((entry) => entry.warning !== "None").length;

  if (kind === "raw") {
    return {
      found: `${Math.max(1, Math.ceil(count / 12))} source sessions`,
      warning: warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "None",
      entries,
    };
  }

  if (kind === "calibration") {
    return {
      found: `${Math.max(1, Math.ceil(count / 18))} calibration groups`,
      warning: warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "None",
      entries,
    };
  }

  if (kind === "projects") {
    return {
      found: `${Math.max(1, Math.ceil(count / 6))} project folders`,
      warning: warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "None",
      entries,
    };
  }

  return {
    found: `${count} inbox items`,
    warning: warningCount > 0 ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "None",
    entries,
  };
}

function makePreviewEntries(kind: SourceStepId, root: string): PreviewEntry[] {
  const base = root || "Selected source";

  if (kind === "raw") {
    return [
      {
        path: `${base}/2025-03-10 Heart Soul Panel 1`,
        kind: "Directory, session",
        warning: "None",
      },
      {
        path: `${base}/2025-03-10 Heart Soul/Lights`,
        kind: "Directory, light frames",
        warning: "Likely lights folder for first session.",
      },
      {
        path: `${base}/2025-03-12 Heart Soul Panel 1`,
        kind: "Directory, session",
        warning: "None",
      },
      {
        path: `${base}/2025-03-14 Orion Rosette mixed`,
        kind: "Directory, mixed folder",
        warning: "Mixed target hints, keep in Inbox until split.",
      },
    ];
  }

  if (kind === "calibration") {
    return [
      {
        path: `${base}/Masters/Darks/master_darks_120s_gain100`,
        kind: "Master darks",
        warning: "None",
      },
      {
        path: `${base}/Masters/Bias/master_bias_gain100`,
        kind: "Master bias",
        warning: "Ready for reuse in compatible sessions.",
      },
      {
        path: `${base}/Masters/Flats/L-Pro/2025-03-12`,
        kind: "Flats",
        warning: "Rotation metadata missing on some files.",
      },
      {
        path: `${base}/Masters/Lights/2025-03-10`,
        kind: "Lights",
        warning: "Master light group for stacking.",
      },
    ];
  }

  if (kind === "projects") {
    return [
      {
        path: `${base}/HeartSoul_Panel1`,
        kind: "Directory, project folder",
        warning: "Not linked to an app project yet.",
      },
      {
        path: `${base}/M31 old process`,
        kind: "Directory, brownfield project",
        warning: "Review required before onboarding.",
      },
      {
        path: `${base}/Jupiter_2025-04-03`,
        kind: "Directory, planetary project",
        warning: "None",
      },
    ];
  }

  return [
    {
      path: `${base}/2025-03-18 incoming session`,
      kind: "Directory, source item",
      warning: "Needs Inbox review before moving to Inventory.",
    },
    {
      path: `${base}/Manual exports March`,
      kind: "Directory, unknown material",
      warning: "User decision required.",
    },
    {
      path: `${base}/Orion and Rosette mixed`,
      kind: "Directory, mixed folder",
      warning: "Split before moving into Inventory.",
    },
  ];
}

function makeDirectoryPlaceholder(sourceId: SourceStepId) {
  // Tauri TODO: this directory placeholder is a browser-only prototype path while native picker wiring is incomplete.
  if (sourceId === "raw") {
    return "D:\\Astrophotography\\Raw\\Poseidon-C";
  }

  if (sourceId === "calibration") {
    return "D:\\Astrophotography\\Calibration";
  }

  if (sourceId === "projects") {
    return "D:\\Astrophotography\\Projects";
  }

  return "D:\\Astrophotography\\Inbox";
}

function makeSampleDirectory(sourceId: SourceStepId, label: string) {
  // Tauri TODO: replace browser placeholder paths with the directory from the native picker.
  const cleanLabel = normalizeName(label).replaceAll(" ", "-") || sourceId;
  return `${makeDirectoryPlaceholder(sourceId)}\\${cleanLabel}`;
}

function estimateDirectoryEntryCount(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return Math.max(6, Math.min(48, value.trim().length));
}

function addRowError(rowErrors: Record<string, string>, rowId: string, message: string) {
  rowErrors[rowId] = rowErrors[rowId] ? `${rowErrors[rowId]} ${message}` : message;
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeRoot(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/\/+$/g, "").toLowerCase();
}

function looksLikeFilePath(value: string) {
  return /\.(fit|fits|fts|xisf|tif|tiff|ser|avi|mp4|mov|json|txt|csv|xml)$/i.test(value);
}

function getScanStatusLabel(status: ScanStatus) {
  if (status === "running") {
    return "Scanning selected source roots";
  }

  if (status === "complete") {
    return "Scan preview complete";
  }

  if (status === "blocked") {
    return "Scan preview blocked";
  }

  return "Scan preview";
}

function renderStepDescription(step: string, includedSourceCount: number) {
  if (step === "Preview") {
    return (
      <Text size="xs" c="dimmed">
        Preview runs on {includedSourceCount} selected root{includedSourceCount === 1 ? "" : "s"} before continuing.
      </Text>
    );
  }

  if (step === "Sources") {
    return (
      <Text size="xs" c="dimmed">
        Confirm each source category so setup can group previewed folders correctly.
      </Text>
    );
  }

  if (step === "Flow") {
    return (
      <Text size="xs" c="dimmed">
        Configure the source roots, review the preview, then continue into the guided project flow.
      </Text>
    );
  }

  return null;
}
