import { ReactNode, useState } from "react";

import "@mantine/core/styles.css";

import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  MultiSelect,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { ChevronDown, Info } from "lucide-react";

type SettingsSectionId =
  | "sources"
  | "intake-review"
  | "projects"
  | "calibration"
  | "tools"
  | "safety"
  | "logs"
  | "catalogs"
  | "setup";

type SymlinkMode = "record-only" | "review-before-traverse" | "ignore";
type HashingMode = "lazy" | "scan" | "manual";
type PreparedLayout = "symlink-manifest" | "manifest-only" | "copy-plan";
type CleanupDefaultAction = "archive" | "trash" | "keep";
type LogLevel = "debug" | "info" | "warn" | "error";
type SourceProtectionMode = "inherit" | "protected" | "unprotected";

type DataSourceRow = {
  id: string;
  name: string;
  type: "Raw" | "Calibration" | "Projects" | "Inbox";
  root: string;
  state: "Active" | "Disabled" | "Disconnected" | "Needs Review";
  scanRule: ReactNode;
  protectionMode: SourceProtectionMode;
};

type DataSourceOperation = "remove";

const settingsSections: Array<{ id: SettingsSectionId; label: string }> = [
  { id: "sources", label: "Sources" },
  { id: "intake-review", label: "Inbox / Review" },
  { id: "projects", label: "Projects" },
  { id: "calibration", label: "Calibration" },
  { id: "tools", label: "Tools" },
  { id: "safety", label: "Safety" },
  { id: "logs", label: "Logs" },
  { id: "catalogs", label: "Catalogs" },
  { id: "setup", label: "Setup" },
];

const initialDataSources: DataSourceRow[] = [
  {
    id: "raw-poseidon-c",
    name: "Raw Poseidon-C",
    type: "Raw",
    root: "D:\\Astrophotography\\Raw\\Poseidon-C PRO",
    state: "Active",
    scanRule: (
      <Stack gap="xs">
        <Text size="xs">Scans direct children from this folder into Inbox as review items.</Text>
        <Text size="xs">
          Raw sessions become visible for source review before they can move to Inventory workflows.
        </Text>
        <Text size="xs">If disabled, some valid raw data can be skipped from the review queue.</Text>
      </Stack>
    ),
    protectionMode: "protected",
  },
  {
    id: "calibration-masters",
    name: "Calibration Masters",
    type: "Calibration",
    root: "D:\\Astrophotography\\Masters",
    state: "Needs Review",
    scanRule: (
      <Stack gap="xs">
        <Text size="xs">
          Segment source folders by frame type, then evaluate for calibration matching recommendations.
        </Text>
        <Text size="xs">These recommendations feed the project calibration-review flow.</Text>
        <Text size="xs">
          If filtering is too strict, valid matching sources may be withheld until you relax this source rule.
        </Text>
      </Stack>
    ),
    protectionMode: "inherit",
  },
  {
    id: "processing-projects",
    name: "Processing Projects",
    type: "Projects",
    root: "D:\\Astrophotography\\PixInsight processes",
    state: "Active",
    scanRule: (
      <Stack gap="xs">
        <Text size="xs">Treats legacy folders as workspace references during project onboarding.</Text>
        <Text size="xs">Only approved project entries progress into the active project workflow.</Text>
        <Text size="xs">
          Incomplete onboarding can leave a project in a partial state until you finish project mapping review.
        </Text>
      </Stack>
    ),
    protectionMode: "unprotected",
  },
  {
    id: "drop-zone",
    name: "Drop Zone",
    type: "Inbox",
    root: "D:\\Astrophotography\\Inbox",
    state: "Disabled",
    scanRule: (
      <Stack gap="xs">
        <Text size="xs">Routes unknown folders into Inbox as review items when this source is enabled.</Text>
        <Text size="xs">This catches overflow folders for manual routing before project mapping.</Text>
        <Text size="xs">Turning it off keeps only explicit sources visible but can hide useful review items.</Text>
      </Stack>
    ),
    protectionMode: "inherit",
  },
];

const metadataTokens = ["target", "project", "date", "camera", "telescope", "filter", "workflow"];
const metadataSeparators = ["/", "-", "_"];
const calibrationFields = ["camera", "telescope", "filter", "exposure", "gain", "offset", "binning", "temperature"];
const catalogChoices = ["Messier", "NGC", "IC", "LBN", "LDN", "Sharpless"];

export function SettingsPage() {
  const [selectedSectionId, setSelectedSectionId] = useState<SettingsSectionId>("sources");
  const [actionNote, setActionNote] = useState("");
  const [dataSources, setDataSources] = useState<DataSourceRow[]>(initialDataSources);
  const [dataSourceOperation, setDataSourceOperation] = useState<{ type: DataSourceOperation; sourceId: string } | null>(
    null,
  );
  const [reviewSettings, setReviewSettings] = useState({
    symlinks: "record-only" as SymlinkMode,
    hashing: "lazy" as HashingMode,
    unknownMaterial: true,
  });
  const [projectPattern, setProjectPattern] = useState(["target", "/", "project"]);
  const [archivePattern, setArchivePattern] = useState(["target", "/", "project", "/", "date"]);
  const [calibrationSettings, setCalibrationSettings] = useState({
    darks: ["camera", "exposure", "gain", "offset", "temperature"],
    bias: ["camera", "gain", "offset"],
    flats: ["camera", "filter", "gain", "offset", "telescope"],
  });
  const [workflowSettings, setWorkflowSettings] = useState({
    pixInsightPath: "C:\\Program Files\\PixInsight\\bin\\PixInsight.exe",
    sirilPath: "",
    directLaunch: true,
    preparedLayout: "symlink-manifest" as PreparedLayout,
  });
  const [safetySettings, setSafetySettings] = useState({
    defaultAction: "archive" as CleanupDefaultAction,
    defaultProtectSources: true,
    defaultProtectMasters: true,
    defaultProtectFinals: true,
  });
  const [logSettings, setLogSettings] = useState({
    level: "info" as LogLevel,
  });
  const [catalogSettings, setCatalogSettings] = useState({
    enabled: true,
    catalogs: ["Messier", "NGC", "IC"],
  });

  function getSourceDefaultProtection(sourceType: DataSourceRow["type"]) {
    if (sourceType === "Calibration") {
      return safetySettings.defaultProtectMasters;
    }
    if (sourceType === "Projects") {
      return safetySettings.defaultProtectFinals;
    }
    return safetySettings.defaultProtectSources;
  }

  const activeDataSource = dataSourceOperation
    ? dataSources.find((source) => source.id === dataSourceOperation.sourceId)
    : undefined;

  return (
    <Stack gap="xs" p="xs">
      {actionNote ? (
        <Text size="xs" c="dimmed" role="status">
          {actionNote}
        </Text>
      ) : null}

      <Group align="stretch" gap="sm" wrap="nowrap">
        <Tabs
          orientation="vertical"
          value={selectedSectionId}
          onChange={(value) => {
            if (value) {
              setSelectedSectionId(value as SettingsSectionId);
            }
          }}
          w={170}
          style={{ flexShrink: 0 }}
        >
          <Tabs.List>
            {settingsSections.map((section) => (
              <Tabs.Tab value={section.id} key={section.id}>
                {section.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
          {selectedSectionId === "sources" ? (
            <DataSourcesSettings
              dataSources={dataSources}
              onAdd={() => {
                setDataSources((current) => [
                  ...current,
                  {
                    id: `source-${current.length + 1}`,
                    name: `New source ${current.length + 1}`,
                    type: "Inbox",
                    root: "Choose folder",
                    state: "Needs Review",
                    scanRule: (
                      <Stack gap="xs">
                        <Text size="xs">
                          New sources are in review until you verify path and enable scanning.
                        </Text>
                        <Text size="xs">Unverified sources cannot contribute review items yet.</Text>
                        <Text size="xs">
                          This avoids accidental discovery from incomplete folders during setup or migration.
                        </Text>
                      </Stack>
                    ),
                    protectionMode: "inherit",
                  },
                ]);
                setActionNote("Source added");
              }}
              onProtectionModeChange={(source, mode) =>
                setDataSources((current) =>
                  current.map((candidate) =>
                    candidate.id === source.id
                      ? {
                          ...candidate,
                          protectionMode: mode,
                        }
                      : candidate,
                  ),
                )
              }
              getDefaultProtection={getSourceDefaultProtection}
              onReconnect={(source) => {
                setDataSources((current) =>
                  current.map((candidate) =>
                    candidate.id === source.id ? { ...candidate, state: "Active", root: "Choose replacement folder" } : candidate,
                  ),
                );
                setActionNote(`Reconnect started: ${source.name}`);
              }}
              onRescan={(source) => {
                setActionNote(`Rescan started: ${source.name}`);
              }}
              onToggle={(source) => {
                setDataSources((current) =>
                  current.map((candidate) =>
                    candidate.id === source.id
                      ? {
                          ...candidate,
                          state: candidate.state === "Disabled" ? "Active" : "Disabled",
                        }
                      : candidate,
                  ),
                );
                setActionNote(`${source.state === "Disabled" ? "Enabled" : "Disabled"} ${source.name}`);
              }}
              onRemove={(source) => setDataSourceOperation({ type: "remove", sourceId: source.id })}
            />
          ) : null}

          {selectedSectionId === "intake-review" ? (
            <SettingsTable>
              <SettingRow
                label="Symlinks"
                info={
                  <Stack gap="xs">
                    <Text size="xs">
                      Controls how linked folders are processed during discovery.
                    </Text>
                    <Text size="xs">
                      Record-only stores link references, review-before-traverse surfaces linked paths for manual routing, and ignore skips links.
                    </Text>
                    <Text size="xs">
                      This setting changes traversal behavior for every source scan and prevents loop/duplicate risks on dynamic mounts.
                    </Text>
                  </Stack>
                }
              >
                <Select
                  size="xs"
                  data={[
                    { value: "record-only", label: "Record link only" },
                    { value: "review-before-traverse", label: "Review before traversal" },
                    { value: "ignore", label: "Ignore links" },
                  ]}
                  value={reviewSettings.symlinks}
                  onChange={(value) =>
                    updateSetting(() =>
                      setReviewSettings((current) => ({
                        ...current,
                        symlinks: (value as SymlinkMode) ?? "record-only",
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Large-file hashing"
                info={
                  <Stack gap="xs">
                    <Text size="xs">
                      Controls when large-file hashes are computed for duplicate detection and conflict checks.
                    </Text>
                    <Text size="xs">
                      The selected mode is used during source scans and before cleanup planning.
                    </Text>
                    <Text size="xs">
                      Manual mode is fastest, but duplicate risks stay unresolved until an explicit hash pass.
                    </Text>
                  </Stack>
                }
              >
                <Select
                  size="xs"
                  data={[
                    { value: "lazy", label: "Lazy" },
                    { value: "scan", label: "During scan" },
                    { value: "manual", label: "Manual only" },
                  ]}
                  value={reviewSettings.hashing}
                  onChange={(value) =>
                    updateSetting(() =>
                      setReviewSettings((current) => ({
                        ...current,
                        hashing: (value as HashingMode) ?? "lazy",
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Unknown material"
                info={
                  <Stack gap="xs">
                    <Text size="xs">
                      Controls whether unclassifiable folders are shown as review items in Inbox.
                    </Text>
                    <Text size="xs">
                      Keeping it on helps you route edge cases instead of silently dropping unrecognized data.
                    </Text>
                    <Text size="xs">
                      Disabling it reduces noise, but unknown paths will require manual rescans to recover.
                    </Text>
                  </Stack>
                }
              >
                <Switch
                  size="xs"
                  checked={reviewSettings.unknownMaterial}
                  onChange={(event) =>
                    updateSetting(() =>
                      setReviewSettings((current) => ({
                        ...current,
                        unknownMaterial: event.currentTarget.checked,
                      })),
                    )
                  }
                />
              </SettingRow>
            </SettingsTable>
          ) : null}

          {selectedSectionId === "projects" ? (
            <SettingsTable>
              <PatternBuilder
                label="Project folder pattern"
                value={projectPattern}
                info={
                  <Stack gap="xs">
                    <Text size="xs">Builds the default project path from selected metadata tokens.</Text>
                    <Text size="xs">The app applies this structure whenever creating new projects.</Text>
                    <Text size="xs">Existing projects stay at their current locations; only future projects use the new format.</Text>
                  </Stack>
                }
                onChange={(value) => updateSetting(() => setProjectPattern(value))}
              />
              <PatternBuilder
                label="Archive location pattern"
                value={archivePattern}
                info={
                  <Stack gap="xs">
                    <Text size="xs">Builds output archive handoff paths for completed workflows.</Text>
                    <Text size="xs">Workflow completion writes finalized artifacts into these derived folders.</Text>
                    <Text size="xs">Unstable output folders can delay or split exported workflow results.</Text>
                  </Stack>
                }
                onChange={(value) => updateSetting(() => setArchivePattern(value))}
              />
            </SettingsTable>
          ) : null}

          {selectedSectionId === "calibration" ? (
            <SettingsTable>
              <MatchRuleSetting
                label="Dark matching"
                selected={calibrationSettings.darks}
                info={
                  <Stack gap="xs">
                    <Text size="xs">
                      Required fields for matching dark review items against the active light context.
                    </Text>
                    <Text size="xs">
                      The app applies this list before generating dark review recommendations.
                    </Text>
                    <Text size="xs">
                      Tightening this list reduces mismatches; loosening can increase suggestions when stock is limited.
                    </Text>
                  </Stack>
                }
                onChange={(value) => updateSetting(() => setCalibrationSettings((current) => ({ ...current, darks: value })))}
              />
              <MatchRuleSetting
                label="Bias matching"
                selected={calibrationSettings.bias}
                info={
                  <Stack gap="xs">
                    <Text size="xs">
                      Compatibility fields required before bias review items are considered.
                    </Text>
                    <Text size="xs">
                      This list drives the bias review-item suggestions used by the active light session.
                    </Text>
                    <Text size="xs">
                      Keep fields aligned with your camera profile to prevent calibration mismatch.
                    </Text>
                  </Stack>
                }
                onChange={(value) => updateSetting(() => setCalibrationSettings((current) => ({ ...current, bias: value })))}
              />
              <SettingRow
                label="Flat matching priority"
                info={
                  <Stack gap="xs">
                    <Text size="xs">
                      Fixed priority order used during flat review-item suggestion.
                    </Text>
                    <Text size="xs">
                      The app enforces same-session first, then same-night, then configured compatibility fields.
                    </Text>
                    <Text size="xs">
                      If no review item exists at higher priority, the app shows fewer options and the quality of fallback choices matters.
                    </Text>
                  </Stack>
                }
              >
                <Text size="xs" c="dimmed">
                  Same light session, then same observing night, then compatibility fields
                </Text>
              </SettingRow>
              <MatchRuleSetting
                label="Flat matching"
                selected={calibrationSettings.flats}
                info={
                  <Stack gap="xs">
                    <Text size="xs">
                      Fallback compatibility fields used when priority matching fails.
                    </Text>
                    <Text size="xs">
                      This list is used before the app finalizes flat review-item suggestions.
                    </Text>
                    <Text size="xs">
                      Remove fields to widen matches during low-stock windows; tighten to lower mismatch risk.
                    </Text>
                  </Stack>
                }
                onChange={(value) => updateSetting(() => setCalibrationSettings((current) => ({ ...current, flats: value })))}
              />
            </SettingsTable>
          ) : null}

          {selectedSectionId === "tools" ? (
            <SettingsTable>
              <SettingRow
                label="PixInsight path"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Executable location used when launching PixInsight from workflow actions.</Text>
                    <Text size="xs">Used by project and source tools that open direct sessions in PixInsight.</Text>
                    <Text size="xs">
                      If incorrect, launch actions fail and the handoff path must be completed manually.
                    </Text>
                  </Stack>
                }
              >
                <TextInput
                  size="xs"
                  value={workflowSettings.pixInsightPath}
                  onChange={(event) =>
                    updateSetting(() =>
                      setWorkflowSettings((current) => ({
                        ...current,
                        pixInsightPath: event.currentTarget.value,
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Siril path"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Executable location used for direct Siril launch actions.</Text>
                    <Text size="xs">
                      The app uses this path when opening tools for selected review and setup actions.
                    </Text>
                    <Text size="xs">
                      Leave empty to disable direct launch and keep Siril starts outside this application.
                    </Text>
                  </Stack>
                }
              >
                <TextInput
                  size="xs"
                  value={workflowSettings.sirilPath}
                  onChange={(event) =>
                    updateSetting(() =>
                      setWorkflowSettings((current) => ({
                        ...current,
                        sirilPath: event.currentTarget.value,
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Open tools directly"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Controls whether approved tool actions launch immediately.</Text>
                    <Text size="xs">
                      Enabled sends tool-launch requests directly from row actions; disabled adds a confirmation step.
                    </Text>
                    <Text size="xs">Use confirmation for safer operation during batch processing sessions.</Text>
                  </Stack>
                }
              >
                <Switch
                  size="xs"
                  checked={workflowSettings.directLaunch}
                  onChange={(event) =>
                    updateSetting(() =>
                      setWorkflowSettings((current) => ({
                        ...current,
                        directLaunch: event.currentTarget.checked,
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Project source layout"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Controls how project sources are prepared for handoff into tools.</Text>
                    <Text size="xs">
                      The selection determines whether source prep is link-based, manifest-only, or copied.
                    </Text>
                    <Text size="xs">
                      Copying creates full duplicates with more disk cost; manifest-only keeps source folders unchanged.
                    </Text>
                  </Stack>
                }
              >
                <Select
                  size="xs"
                  data={[
                    { value: "symlink-manifest", label: "Use links and manifest fallback" },
                    { value: "manifest-only", label: "Manifest-only layout" },
                    { value: "copy-plan", label: "Copy from approved plan" },
                  ]}
                  value={workflowSettings.preparedLayout}
                  onChange={(value) =>
                    updateSetting(() =>
                      setWorkflowSettings((current) => ({
                        ...current,
                        preparedLayout: (value as PreparedLayout) ?? "symlink-manifest",
                      })),
                    )
                  }
                />
              </SettingRow>
            </SettingsTable>
          ) : null}

          {selectedSectionId === "safety" ? (
            <SettingsTable>
              <SettingRow
                label="Default cleanup action"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Default operation applied to approved cleanup plans.</Text>
                    <Text size="xs">Source-level overrides are applied before execution when set per source.</Text>
                    <Text size="xs">Trash removes data; archive stores it for recovery while removing from the active view.</Text>
                  </Stack>
                }
              >
                <Select
                  size="xs"
                  data={[
                    { value: "archive", label: "Archive" },
                    { value: "trash", label: "Trash" },
                    { value: "keep", label: "Keep" },
                  ]}
                  value={safetySettings.defaultAction}
                  onChange={(value) =>
                    updateSetting(() =>
                      setSafetySettings((current) => ({
                        ...current,
                        defaultAction: (value as CleanupDefaultAction) ?? "archive",
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Default source protection"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Default safety state for newly added source rows.</Text>
                    <Text size="xs">
                      This default is inherited by rows that do not use a source-level protection override.
                    </Text>
                    <Text size="xs">Disabling increases cleanup throughput but raises accidental-change risk.</Text>
                  </Stack>
                }
              >
                <Switch
                  size="xs"
                  checked={safetySettings.defaultProtectSources}
                  onChange={(event) =>
                    updateSetting(() =>
                      setSafetySettings((current) => ({
                        ...current,
                        defaultProtectSources: event.currentTarget.checked,
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Default calibration protection"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Default protection for calibration and master pools.</Text>
                    <Text size="xs">
                      Inherited rows skip destructive cleanup operations unless explicitly marked for edit access.
                    </Text>
                    <Text size="xs">Keep this on unless you deliberately want to prune master pools.</Text>
                  </Stack>
                }
              >
                <Switch
                  size="xs"
                  checked={safetySettings.defaultProtectMasters}
                  onChange={(event) =>
                    updateSetting(() =>
                      setSafetySettings((current) => ({
                        ...current,
                        defaultProtectMasters: event.currentTarget.checked,
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Default processed output protection"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Default protection for processed outputs and product folders.</Text>
                    <Text size="xs">
                      Inherited settings determine whether outputs can be edited by cleanup operations without per-source overrides.
                    </Text>
                    <Text size="xs">Disable only for controlled cleanup runs that must rewrite outputs.</Text>
                  </Stack>
                }
              >
                <Switch
                  size="xs"
                  checked={safetySettings.defaultProtectFinals}
                  onChange={(event) =>
                    updateSetting(() =>
                      setSafetySettings((current) => ({
                        ...current,
                        defaultProtectFinals: event.currentTarget.checked,
                      })),
                    )
                  }
                />
              </SettingRow>
            </SettingsTable>
          ) : null}

          {selectedSectionId === "logs" ? (
            <SettingsTable>
              <SettingRow
                label="Log level"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Controls diagnostic verbosity for all app logging.</Text>
                    <Text size="xs">Higher levels expose more execution detail for troubleshooting and support work.</Text>
                    <Text size="xs">Higher detail increases log volume and can reduce readability in normal operation.</Text>
                  </Stack>
                }
              >
                <Select
                  size="xs"
                  data={[
                    { value: "debug", label: "Debug" },
                    { value: "info", label: "Info" },
                    { value: "warn", label: "Warning" },
                    { value: "error", label: "Error" },
                  ]}
                  value={logSettings.level}
                  onChange={(value) =>
                    updateSetting(() =>
                      setLogSettings({
                        level: (value as LogLevel) ?? "info",
                      }),
                    )
                  }
                />
              </SettingRow>
            </SettingsTable>
          ) : null}

          {selectedSectionId === "catalogs" ? (
            <SettingsTable>
              <SettingRow
                label="Target lookup"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Controls automated target lookup during review and project setup.</Text>
                    <Text size="xs">
                      Enabled enriches review items with catalog metadata; disabled keeps target association manual.
                    </Text>
                    <Text size="xs">Disable this for fully offline workflows or strict external-call minimization.</Text>
                  </Stack>
                }
              >
                <Switch
                  size="xs"
                  checked={catalogSettings.enabled}
                  onChange={(event) =>
                    updateSetting(() =>
                      setCatalogSettings((current) => ({
                        ...current,
                        enabled: event.currentTarget.checked,
                      })),
                    )
                  }
                />
              </SettingRow>
              <SettingRow
                label="Catalog families"
                info={
                  <Stack gap="xs">
                    <Text size="xs">Selects which catalog families are used for suggestion lookups.</Text>
                    <Text size="xs">
                      This feeds target-name matching in review and project creation workflows.
                    </Text>
                    <Text size="xs">Fewer families reduce noise; more families increase match recall and suggestions.</Text>
                  </Stack>
                }
              >
                <Group gap="xs" wrap="wrap">
                  {catalogChoices.map((catalog) => (
                    <Checkbox
                      size="xs"
                      key={catalog}
                      label={catalog}
                      checked={catalogSettings.catalogs.includes(catalog)}
                      onChange={(event) =>
                        updateSetting(() =>
                          setCatalogSettings((current) => ({
                            ...current,
                            catalogs: event.currentTarget.checked
                              ? [...current.catalogs, catalog]
                              : current.catalogs.filter((candidate) => candidate !== catalog),
                          })),
                        )
                      }
                    />
                  ))}
                </Group>
              </SettingRow>
            </SettingsTable>
          ) : null}

          {selectedSectionId === "setup" ? (
            <SettingsTable>
              <SettingRow
                label="Setup wizard"
                info={
                  <Stack gap="xs">
                    <Text size="xs">
                      Restart setup opens the first-run setup wizard so you can review and update source choices.
                    </Text>
                    <Text size="xs">
                      It returns you to the same setup pages and scan preview, ready to fine-tune sources in one pass.
                    </Text>
                    <Text size="xs">Use this when your source paths or folders have changed.</Text>
                  </Stack>
                }
              >
                <Button onClick={restartSetupWizard} size="xs" variant="outline">
                  Restart setup
                </Button>
              </SettingRow>
            </SettingsTable>
          ) : null}
        </Stack>
      </Group>

      <DataSourceRemoveDialog
        source={activeDataSource}
        opened={Boolean(dataSourceOperation)}
        onCancel={() => setDataSourceOperation(null)}
        onConfirm={() => {
          if (activeDataSource) {
            setDataSources((current) => current.filter((source) => source.id !== activeDataSource.id));
            setActionNote(`Removed ${activeDataSource.name}`);
          }
          setDataSourceOperation(null);
        }}
      />
    </Stack>
  );

  function updateSetting(update: () => void) {
    update();
  }

  function restartSetupWizard() {
    window.localStorage.removeItem("astro-plan:first-run-wizard");
    window.dispatchEvent(new CustomEvent("astro-plan:open-first-run-wizard"));
    setActionNote("Setup wizard restarted");
  }
}

function DataSourcesSettings({
  dataSources,
  onAdd,
  onProtectionModeChange,
  getDefaultProtection,
  onReconnect,
  onRescan,
  onToggle,
  onRemove,
}: {
  dataSources: DataSourceRow[];
  onAdd: () => void;
  onProtectionModeChange: (source: DataSourceRow, mode: SourceProtectionMode) => void;
  getDefaultProtection: (sourceType: DataSourceRow["type"]) => boolean;
  onReconnect: (source: DataSourceRow) => void;
  onRescan: (source: DataSourceRow) => void;
  onToggle: (source: DataSourceRow) => void;
  onRemove: (source: DataSourceRow) => void;
}) {
  function getOverrideLabel(protectionMode: SourceProtectionMode) {
    if (protectionMode === "inherit") {
      return "Inherit default";
    }
    if (protectionMode === "protected") {
      return "Protect by override";
    }
    return "Allow edit by override";
  }

  function getEffectiveProtection(source: DataSourceRow, defaultProtection: boolean) {
    if (source.protectionMode === "protected") return true;
    if (source.protectionMode === "unprotected") return false;
    return defaultProtection;
  }

  function getProtectionDefaultLabel(isProtected: boolean) {
    return isProtected ? "Protected" : "Editable";
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center" gap="xs">
        <Text size="xs" fw={600} c="dimmed">
          {dataSources.length} configured sources
        </Text>
        <Button onClick={onAdd} size="xs" variant="outline">
          Add source
        </Button>
      </Group>
      <Table
        withTableBorder
        withColumnBorders
        verticalSpacing={2}
        horizontalSpacing="xs"
        highlightOnHover
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={190}>Name</Table.Th>
            <Table.Th w={230}>Root</Table.Th>
            <Table.Th w={80}>Type</Table.Th>
            <Table.Th w={220}>Protection</Table.Th>
            <Table.Th w={95}>State</Table.Th>
            <Table.Th w={210}>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {dataSources.map((source) => {
            const defaultProtection = getDefaultProtection(source.type);
            const effectiveProtection = getEffectiveProtection(source, defaultProtection);

            return (
              <Table.Tr key={source.id}>
                <Table.Td style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}>
                  <Group gap="xs" align="center" wrap="nowrap">
                    <Text size="xs" fw={600} style={{ overflowWrap: "anywhere" }}>
                      {source.name}
                    </Text>
                    <Tooltip label={source.scanRule} withinPortal={false}>
                      <ActionIcon size="xs" variant="subtle" radius="xl" aria-label={`${source.name} scan rule`}>
                        <Info size={12} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
                <Table.Td style={{ overflowWrap: "anywhere", whiteSpace: "normal" }}>{source.root}</Table.Td>
                <Table.Td>
                  <Text size="xs">{source.type}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" align="center" wrap="nowrap">
                    <Text size="xs" fw={600}>
                      {getProtectionDefaultLabel(effectiveProtection)}
                    </Text>
                    <Tooltip
                      label={
                        <Stack gap="xs">
                          <Text size="xs">
                            Cleanup defaults for this source type are{" "}
                            {getProtectionDefaultLabel(defaultProtection).toLowerCase()}.
                            This source is currently{" "}
                            {source.protectionMode === "inherit" ? "inheriting the default" : "overridden"}.
                          </Text>
                          <Text size="xs">
                            Protected means cleanup actions skip rename/move/delete for this source unless manually overridden.
                          </Text>
                          <Text size="xs">Override: {getOverrideLabel(source.protectionMode)}.</Text>
                        </Stack>
                      }
                      withinPortal={false}
                    >
                      <ActionIcon size="xs" variant="subtle" radius="xl" aria-label={`${source.name} protection info`}>
                        <Info size={12} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  <Select
                    size="xs"
                    data={[
                      { value: "inherit", label: "Use default" },
                      { value: "protected", label: "Always protect" },
                      { value: "unprotected", label: "Allow edits in cleanup" },
                    ]}
                    value={source.protectionMode}
                    onChange={(value) => onProtectionModeChange(source, (value as SourceProtectionMode) ?? "inherit")}
                  />
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{source.state}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onReconnect(source)}
                    >
                      Reconnect
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => onRescan(source)}>
                      Rescan
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => onToggle(source)}>
                      {source.state === "Disabled" ? "Enable" : "Disable"}
                    </Button>
                    <Menu shadow="sm" width={160} position="bottom-end" withinPortal={false}>
                      <Menu.Target>
                        <ActionIcon size="xs" variant="subtle" aria-label={`More actions for ${source.name}`}>
                          <ChevronDown size={14} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item color="red" onClick={() => onRemove(source)}>
                          Remove source
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function SettingsTable({ children }: { children: React.ReactNode }) {
  return (
    <Table withTableBorder withColumnBorders verticalSpacing={2} horizontalSpacing="xs">
      <Table.Tbody>{children}</Table.Tbody>
    </Table>
  );
}

function SettingRow({ label, info, children }: { label: string; info: ReactNode; children: React.ReactNode }) {
  return (
    <Table.Tr>
      <Table.Td w={280} style={{ verticalAlign: "top", overflowWrap: "anywhere", whiteSpace: "normal" }}>
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <Text size="xs" fw={600} style={{ overflowWrap: "anywhere" }}>
            {label}
          </Text>
          <Tooltip label={info} withinPortal={false}>
            <ActionIcon size="xs" variant="subtle" radius="xl" aria-label={`${label} info`}>
              <Info size={12} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Table.Td>
      <Table.Td>{children}</Table.Td>
    </Table.Tr>
  );
}

function PatternBuilder({
  label,
  value,
  info,
  onChange,
}: {
  label: string;
  value: string[];
  info: ReactNode;
  onChange: (value: string[]) => void;
}) {
  return (
    <SettingRow label={label} info={info}>
      <MultiSelect
        size="xs"
        data={[
          ...metadataTokens.map((token) => ({ value: token, label: token })),
          ...metadataSeparators.map((token) => ({ value: token, label: token })),
        ]}
        value={value}
        onChange={(value) => onChange(value)}
      />
    </SettingRow>
  );
}

function MatchRuleSetting({
  label,
  selected,
  info,
  onChange,
}: {
  label: string;
  selected: string[];
  info: ReactNode;
  onChange: (value: string[]) => void;
}) {
  return (
    <SettingRow label={label} info={info}>
      <MultiSelect
        size="xs"
        data={calibrationFields}
        value={selected}
        onChange={(value) => onChange(value)}
        clearable={false}
        searchable={false}
        nothingFoundMessage="No fields"
      />
    </SettingRow>
  );
}

function DataSourceRemoveDialog({
  source,
  opened,
  onCancel,
  onConfirm,
}: {
  source?: DataSourceRow;
  opened: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={source?.name ?? "Source"}
      centered
      withCloseButton
      size="sm"
      padding="sm"
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
          Removing a source affects future scans. Historical records and audit entries remain.
        </Text>
        <Group gap="xs" justify="flex-end">
          <Button size="xs" onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button size="xs" onClick={onConfirm} color="red">
            Remove source
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
