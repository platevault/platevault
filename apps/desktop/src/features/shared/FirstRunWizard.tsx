import "@mantine/core/styles.css";
import {
  Alert,
  ActionIcon,
  Button,
  Group,
  Tooltip,
  List,
  Modal,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { startFirstStepGuide, stopFirstStepGuide } from "./guideEvents";

type SourceStepId = "raw" | "calibration" | "projects" | "inbox";

type SourceDraft = {
  id: string;
  label: string;
  selectedRoot: string;
  selectionError?: string;
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

const wizardSteps = ["Welcome", "Sources", "Flow", ...sourceStepDefinitions.map((step) => step.stepLabel)];

function makeSourceDraft(label: string): SourceDraft {
  return {
    id: crypto.randomUUID(),
    label,
    selectedRoot: "",
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

  const currentStep = wizardSteps[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === wizardSteps.length - 1;
  const currentSourceDefinition = getSourceDefinition(currentStep);

  const validation = useMemo(() => validateSources(sources), [sources]);
  const allRequiredSourcesSelected = validation.allValid;

  useEffect(() => {
    const openWizard = () => {
      stopFirstStepGuide();
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem("astro-plan:first-step-guide");
      window.localStorage.removeItem("astro-plan:first-step-guide:step");
      setStepIndex(0);
      setIsVisible(true);
    };

    window.addEventListener("astro-plan:open-first-run-wizard", openWizard);
    return () => window.removeEventListener("astro-plan:open-first-run-wizard", openWizard);
  }, []);

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
      ? allRequiredSourcesSelected
      : true;

  const finishWizard = () => {
    if (!allRequiredSourcesSelected) {
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
          {renderStepDescription(currentStep)}
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
          />
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
}

function SourceStep({
  definition,
  rows,
  validationMessage,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  rowErrors,
}: {
  definition: (typeof sourceStepDefinitions)[number];
  rows: SourceDraft[];
  validationMessage: string | null;
  rowErrors: Record<string, string>;
  onAddRow: () => void;
  onRemoveRow: (rowId: string) => void;
  onUpdateRow: (rowId: string, patch: Partial<SourceDraft>) => void;
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
            <Table.Th style={{ width: 46, textAlign: "center" }} aria-label="Actions">
              <span />
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => {
            const directoryMessage = row.selectionError || rowErrors[row.id];
            return (
              <Table.Tr key={row.id}>
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
                <Table.Td style={{ width: 46, textAlign: "center" }}>
                  <Group gap={0} justify="center" align="center">
                    <Tooltip label={`Remove ${definition.stepLabel} source`} withinPortal={false}>
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        color="red"
                        aria-label={`Remove ${definition.stepLabel} source`}
                        onClick={() => onRemoveRow(row.id)}
                      >
                        <Trash2 size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      <Tooltip label={`Add ${definition.stepLabel} source`} withinPortal={false}>
        <ActionIcon
          size="xs"
          variant="subtle"
          aria-label={`Add ${definition.stepLabel} source`}
          onClick={onAddRow}
        >
          <Plus size={14} />
        </ActionIcon>
      </Tooltip>
    </Stack>
  );
}

function WelcomeStep() {
  return (
    <Stack gap="sm">
      <Text size="sm" fw={700}>
        This is a quick first-run orientation.
      </Text>
      <Text size="xs" c="dimmed">
        This step links your source roots to the app and starts the guided first-project flow.
      </Text>
      <Text size="xs" c="dimmed">
        You can skip setup now to open the workspace, then start setup anytime from Settings.
      </Text>
      <List size="xs" spacing="xs" withPadding>
        <List.Item>Start by defining directories, then launch setup actions from guided flow.</List.Item>
        <List.Item>Make sure each source category root points to the correct folder.</List.Item>
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
        Configure source categories, then continue into guided first-project setup.
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
                2) Continue
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="xs">
                Validate entries for each source category before moving to the next step.
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
              <Text size="xs">Continue directly into guided first-project setup after all categories are valid.</Text>
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

function renderStepDescription(step: string) {
  if (step === "Sources") {
    return (
      <Text size="xs" c="dimmed">
        Confirm each source category so setup can route those paths into the first-project flow.
      </Text>
    );
  }

  if (step === "Flow") {
    return (
      <Text size="xs" c="dimmed">
        Configure the source roots, then continue into guided first-project setup.
      </Text>
    );
  }

  return null;
}
