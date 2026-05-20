/**
 * Mock data fixtures for the Astro Library Manager UI mockup.
 * Designed to mirror the realistic M101 / NGC7000 / Andromeda scenarios
 * referenced throughout the design plan.
 */

import type { LogEntry } from "../ui/LogPanel";

/* ============================================================
   Inventory
   ============================================================ */

export interface InventorySession {
  id: string;
  name: string;
  sourceId: string;
  frames: number;
  type: "light" | "dark" | "flat" | "bias" | "mixed";
  target: string | null;
  filter: string | null;
  exposure: string | null;
  state: "confirmed" | "needs_review" | "rejected";
  camera?: string;
  gain?: string;
  binning?: string;
  setTemp?: string;
  capturedOn?: string;
  provenance?: {
    target?: string;
    filter?: string;
    inferred?: string;
    confirmedBy?: string;
  };
  linked?: {
    projects?: Array<{ id: string; name: string }>;
    session?: string;
    calibration?: string;
  };
}

export interface InventorySource {
  id: string;
  path: string;
  kind: "local_disk" | "external_disk" | "removable" | "network_share";
  state: "active" | "missing" | "disabled" | "reconnect_required";
  sessions: InventorySession[];
}

export const inventorySources: InventorySource[] = [
  {
    id: "src-astrodrive",
    path: "/Volumes/AstroDrive",
    kind: "external_disk",
    state: "active",
    sessions: [
      {
        id: "inv-m101-0412",
        name: "M101 2026-04-12",
        sourceId: "src-astrodrive",
        frames: 42,
        type: "light",
        target: "M101",
        filter: "Ha",
        exposure: "120s",
        state: "confirmed",
        camera: "ASI2600MM Pro",
        gain: "100",
        binning: "1×1",
        setTemp: "−10 °C",
        capturedOn: "2026-04-12",
        provenance: {
          target: "OBJECT header",
          filter: "FILTER header",
          inferred: "exposure inferred 0.97",
          confirmedBy: "user 2026-04-14",
        },
        linked: {
          projects: [{ id: "prj-m101", name: "M101 Mosaic" }],
          session: "2026-04-12 night",
          calibration: "darks-120s-gain100",
        },
      },
      {
        id: "inv-m101-0413",
        name: "M101 2026-04-13",
        sourceId: "src-astrodrive",
        frames: 38,
        type: "light",
        target: "M101",
        filter: "Ha",
        exposure: "120s",
        state: "confirmed",
        camera: "ASI2600MM Pro",
        gain: "100",
        capturedOn: "2026-04-13",
        linked: { projects: [{ id: "prj-m101", name: "M101 Mosaic" }] },
      },
      {
        id: "inv-m101-0414",
        name: "M101 2026-04-14",
        sourceId: "src-astrodrive",
        frames: 60,
        type: "light",
        target: "M101",
        filter: "OIII",
        exposure: "120s",
        state: "confirmed",
        camera: "ASI2600MM Pro",
        capturedOn: "2026-04-14",
      },
      {
        id: "inv-ngc7000-darks",
        name: "NGC7000 darks (120s)",
        sourceId: "src-astrodrive",
        frames: 30,
        type: "dark",
        target: null,
        filter: null,
        exposure: "120s",
        state: "confirmed",
        camera: "ASI2600MM Pro",
        gain: "100",
        capturedOn: "2026-03-22",
      },
      {
        id: "inv-bias-library",
        name: "Bias library",
        sourceId: "src-astrodrive",
        frames: 500,
        type: "bias",
        target: null,
        filter: null,
        exposure: "—",
        state: "confirmed",
        camera: "ASI2600MM Pro",
        gain: "100",
      },
      {
        id: "inv-unclassified-2025-old",
        name: "unclassified — legacy 2024 imports",
        sourceId: "src-astrodrive",
        frames: 14,
        type: "mixed",
        target: null,
        filter: null,
        exposure: null,
        state: "needs_review",
      },
    ],
  },
  {
    id: "src-local-raw",
    path: "/home/sjors/astro/raw",
    kind: "local_disk",
    state: "active",
    sessions: [
      {
        id: "inv-andromeda-1102",
        name: "Andromeda 2025-11-02",
        sourceId: "src-local-raw",
        frames: 88,
        type: "light",
        target: "M31",
        filter: "L",
        exposure: "60s",
        state: "confirmed",
        camera: "ASI2600MC Pro",
        capturedOn: "2025-11-02",
      },
      {
        id: "inv-flats-ha",
        name: "Ha flats 2026-04",
        sourceId: "src-local-raw",
        frames: 25,
        type: "flat",
        target: null,
        filter: "Ha",
        exposure: "3s",
        state: "confirmed",
      },
    ],
  },
];

/* ============================================================
   Inbox
   ============================================================ */

export interface InboxItem {
  id: string;
  path: string;
  files: number;
  type: "light" | "dark" | "flat" | "bias" | "mixed";
  sourceId: string;
  sourceLabel: string;
  detectedAt: string;
  mixedBreakdown?: Array<{ kind: string; count: number; destination: string }>;
  sampleFiles?: Array<{
    name: string;
    type: string;
    exposure?: string;
    filter?: string;
  }>;
  destinationPattern?: string;
}

export const inboxItems: InboxItem[] = [
  {
    id: "ibx-raw-2026-04",
    path: "/Volumes/AstroDrive/inbox/2026-04",
    files: 142,
    type: "mixed",
    sourceId: "src-astrodrive",
    sourceLabel: "AstroDrive",
    detectedAt: "2026-05-18 14:02",
    mixedBreakdown: [
      { kind: "light", count: 98, destination: "M101/Ha/2026-04-12/lights/" },
      { kind: "dark", count: 30, destination: "calibration/darks/120s/" },
      { kind: "flat", count: 12, destination: "calibration/flats/Ha/" },
      { kind: "bias", count: 2, destination: "unclassified (review)" },
    ],
    sampleFiles: [
      { name: "light_001.fit", type: "Light", exposure: "120s", filter: "Ha" },
      { name: "light_002.fit", type: "Light", exposure: "120s", filter: "Ha" },
      { name: "dark_001.fit", type: "Dark", exposure: "120s" },
      { name: "flat_001.fit", type: "Flat", exposure: "3s", filter: "Ha" },
      { name: "bias_001.fit", type: "Bias" },
    ],
    destinationPattern: "{target}/{filter}/{date}/{frame_type}/",
  },
  {
    id: "ibx-raw-2026-05",
    path: "/Volumes/AstroDrive/inbox/2026-05-night1",
    files: 38,
    type: "light",
    sourceId: "src-astrodrive",
    sourceLabel: "AstroDrive",
    detectedAt: "2026-05-18 13:48",
    sampleFiles: [
      { name: "light_001.fit", type: "Light", exposure: "180s", filter: "OIII" },
      { name: "light_002.fit", type: "Light", exposure: "180s", filter: "OIII" },
      { name: "light_003.fit", type: "Light", exposure: "180s", filter: "OIII" },
    ],
    destinationPattern: "M101/OIII/2026-05-18/lights/",
  },
  {
    id: "ibx-calibration",
    path: "/Volumes/AstroDrive/inbox/calibration-may",
    files: 50,
    type: "dark",
    sourceId: "src-astrodrive",
    sourceLabel: "AstroDrive",
    detectedAt: "2026-05-18 13:12",
    sampleFiles: [
      { name: "dark_001.fit", type: "Dark", exposure: "120s" },
      { name: "dark_002.fit", type: "Dark", exposure: "120s" },
    ],
    destinationPattern: "calibration/darks/120s/",
  },
  {
    id: "ibx-flats-batch",
    path: "/home/sjors/astro/inbox/flats-2026-05",
    files: 25,
    type: "flat",
    sourceId: "src-local-raw",
    sourceLabel: "local raw",
    detectedAt: "2026-05-17 21:10",
    sampleFiles: [
      { name: "flat_001.fit", type: "Flat", exposure: "3s", filter: "Ha" },
      { name: "flat_002.fit", type: "Flat", exposure: "3s", filter: "Ha" },
    ],
    destinationPattern: "calibration/flats/Ha/",
  },
];

/* ============================================================
   Projects
   ============================================================ */

export type ProjectLifecycle =
  | "setup_incomplete"
  | "ready"
  | "prepared"
  | "processing"
  | "completed"
  | "archived"
  | "blocked";

export const projectLifecycleSteps = [
  { id: "setup_incomplete", label: "Setup" },
  { id: "ready", label: "Ready" },
  { id: "prepared", label: "Prepared" },
  { id: "processing", label: "Processing" },
  { id: "completed", label: "Completed" },
  { id: "archived", label: "Archived" },
];

export interface ProjectSource {
  inventoryId: string;
  name: string;
  frames: number;
  filter: string;
  exposure: string;
}

export interface ProjectManifest {
  id: string;
  reason: string;
  timestamp: string;
  path: string;
  body?: {
    sources: string[];
    calibration: string[];
    lifecycle: string;
    notes?: string;
  };
}

export interface Project {
  id: string;
  name: string;
  lifecycle: ProjectLifecycle;
  tool: "PixInsight" | "Siril" | "Planetary Suite";
  sources: ProjectSource[];
  calibrationSets: Array<{ id: string; label: string; matched: "auto" | "manual" }>;
  channels: string[];
  plans: Array<{ id: string; title: string; state: string }>;
  manifests: ProjectManifest[];
  notes?: string;
  lastAction?: { label: string; when: string };
}

export const projects: Project[] = [
  {
    id: "prj-m101",
    name: "M101 Mosaic",
    lifecycle: "processing",
    tool: "PixInsight",
    sources: [
      {
        inventoryId: "inv-m101-0412",
        name: "M101 2026-04-12",
        frames: 98,
        filter: "Ha",
        exposure: "120s",
      },
      {
        inventoryId: "inv-m101-0413",
        name: "M101 2026-04-13",
        frames: 60,
        filter: "OIII",
        exposure: "120s",
      },
      {
        inventoryId: "inv-m101-0414",
        name: "M101 2026-04-14",
        frames: 42,
        filter: "L",
        exposure: "60s",
      },
    ],
    calibrationSets: [
      { id: "cal-darks-120", label: "darks-120s-gain100", matched: "auto" },
      { id: "cal-flats-ha", label: "flats-Ha-2026-04", matched: "manual" },
    ],
    channels: ["Ha", "OIII", "L"],
    plans: [
      { id: "plan-39", title: "Project source-map M101", state: "approved" },
      { id: "plan-43", title: "Restructure M101 frames", state: "draft" },
    ],
    manifests: [
      {
        id: "man-1",
        reason: "Created",
        timestamp: "2026-04-12 14:02",
        path: "notes/manifest-2026-04-12.md",
      },
      {
        id: "man-2",
        reason: "Source updated",
        timestamp: "2026-04-15 09:18",
        path: "notes/manifest-2026-04-15.md",
        body: {
          sources: [
            "M101 2026-04-12 — 98 frames Ha 120s",
            "M101 2026-04-13 — 60 frames OIII 120s",
          ],
          calibration: [
            "darks-120s-gain100 — matched (auto)",
            "flats-Ha-2026-04 — matched (manual)",
          ],
          lifecycle: "Source-Mapped",
          notes: "Source added",
        },
      },
      {
        id: "man-3",
        reason: "Prepared",
        timestamp: "2026-05-02 11:44",
        path: "notes/manifest-2026-05-02.md",
      },
    ],
    lastAction: { label: "Prepared sources", when: "2026-05-12 14:22" },
    notes: "Hydrogen-alpha narrowband target. Use star reduction in final stack.",
  },
  {
    id: "prj-andromeda",
    name: "Andromeda — November 2025",
    lifecycle: "prepared",
    tool: "PixInsight",
    sources: [
      {
        inventoryId: "inv-andromeda-1102",
        name: "Andromeda 2025-11-02",
        frames: 88,
        filter: "L",
        exposure: "60s",
      },
    ],
    calibrationSets: [{ id: "cal-osc", label: "OSC calibration master", matched: "auto" }],
    channels: ["L"],
    plans: [{ id: "plan-30", title: "Prepared source view", state: "applied" }],
    manifests: [
      { id: "man-and-1", reason: "Created", timestamp: "2025-11-04 08:01", path: "notes/m-1.md" },
    ],
    lastAction: { label: "Source view ready", when: "2025-11-04 08:30" },
  },
  {
    id: "prj-ngc7000",
    name: "NGC 7000 — Cygnus",
    lifecycle: "completed",
    tool: "Siril",
    sources: [],
    calibrationSets: [],
    channels: ["SHO"],
    plans: [{ id: "plan-12", title: "Cleanup intermediates", state: "ready_for_review" }],
    manifests: [],
    lastAction: { label: "Marked completed", when: "2025-12-19 22:10" },
  },
  {
    id: "prj-solar",
    name: "Solar 2026 archive",
    lifecycle: "archived",
    tool: "Planetary Suite",
    sources: [],
    calibrationSets: [],
    channels: [],
    plans: [],
    manifests: [],
  },
];

/* ============================================================
   Plans
   ============================================================ */

export type PlanState =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "applying"
  | "applied"
  | "partially_applied"
  | "failed"
  | "cancelled";

export interface PlanItem {
  id: string;
  index: number;
  name: string;
  action: "move" | "archive" | "delete" | "link" | "write";
  from: string;
  to: string;
  reason: string;
  protection: "normal" | "protected";
  linked?: string;
  state: "pending" | "applying" | "succeeded" | "failed" | "skipped";
  failureReason?: string;
  provenance?: Array<{ label: string; value: string }>;
}

export interface Plan {
  id: string;
  number: number;
  title: string;
  origin: string;
  originPath?: string;
  state: PlanState;
  createdAt: string;
  items: PlanItem[];
  itemsTotal: number;
  itemsApplied: number;
  itemsFailed: number;
  itemsPending: number;
  estimateRemaining?: string;
  type: "split" | "restructure" | "cleanup" | "archive" | "source_map";
}

const m101SplitItems: PlanItem[] = Array.from({ length: 12 }).map((_, idx) => {
  const isLight = idx < 8;
  const isDark = idx >= 8 && idx < 10;
  return {
    id: `item-42-${idx + 1}`,
    index: idx + 1,
    name: isLight
      ? `light_${String(idx + 1).padStart(3, "0")}.fit`
      : isDark
      ? `dark_${String(idx - 7).padStart(3, "0")}.fit`
      : `flat_${String(idx - 9).padStart(3, "0")}.fit`,
    action: "move",
    from: `/Volumes/AstroDrive/inbox/2026-04/${
      isLight ? `light_${String(idx + 1).padStart(3, "0")}` : isDark ? `dark_${String(idx - 7).padStart(3, "0")}` : `flat_${String(idx - 9).padStart(3, "0")}`
    }.fit`,
    to: isLight
      ? `/Volumes/AstroDrive/raw/M101/Ha/2026-04-12/lights/${
          `light_${String(idx + 1).padStart(3, "0")}`
        }.fit`
      : isDark
      ? `/Volumes/AstroDrive/raw/calibration/darks/120s/${`dark_${String(idx - 7).padStart(3, "0")}`}.fit`
      : `/Volumes/AstroDrive/raw/calibration/flats/Ha/${`flat_${String(idx - 9).padStart(3, "0")}`}.fit`,
    reason: isLight
      ? "classified as light; pattern {target}/{filter}/{date}/{frame_type}/"
      : isDark
      ? "classified as dark; pattern calibration/{frame_type}/{exposure}/"
      : "classified as flat; pattern calibration/{frame_type}/{filter}/",
    protection: "normal",
    linked: isLight ? "session inferred 2026-04-12 M101" : undefined,
    state: "pending",
    provenance: isLight
      ? [
          { label: "target", value: "OBJECT header (M101)" },
          { label: "filter", value: "FILTER header (Ha)" },
          { label: "date", value: "DATE-OBS header" },
          { label: "classify", value: "light (confidence 0.96)" },
        ]
      : undefined,
  };
});

export const plans: Plan[] = [
  {
    id: "plan-42",
    number: 42,
    title: "Split /raw/2026-04",
    origin: "inbox",
    originPath: "/Volumes/AstroDrive/inbox/2026-04",
    state: "ready_for_review",
    createdAt: "14:31",
    items: m101SplitItems,
    itemsTotal: 200,
    itemsApplied: 0,
    itemsFailed: 0,
    itemsPending: 200,
    type: "split",
  },
  {
    id: "plan-41",
    number: 41,
    title: "Cleanup NGC 7000 Mosaic",
    origin: "cleanup",
    state: "failed",
    createdAt: "13:08",
    items: [
      {
        id: "item-41-1",
        index: 1,
        name: "light_073.fit",
        action: "move",
        from: "/raw/NGC7000/lights/light_073.fit",
        to: "/raw/NGC7000/applied/light_073.fit",
        reason: "post-process cleanup",
        protection: "normal",
        state: "failed",
        failureReason: "destination exists",
      },
      {
        id: "item-41-2",
        index: 2,
        name: "light_088.fit",
        action: "move",
        from: "/raw/NGC7000/lights/light_088.fit",
        to: "/raw/NGC7000/applied/light_088.fit",
        reason: "post-process cleanup",
        protection: "normal",
        state: "failed",
        failureReason: "permission denied",
      },
      {
        id: "item-41-3",
        index: 3,
        name: "light_091.fit",
        action: "move",
        from: "/raw/NGC7000/lights/light_091.fit",
        to: "/raw/NGC7000/applied/light_091.fit",
        reason: "post-process cleanup",
        protection: "normal",
        state: "failed",
        failureReason: "source missing",
      },
    ],
    itemsTotal: 124,
    itemsApplied: 118,
    itemsFailed: 6,
    itemsPending: 0,
    type: "cleanup",
  },
  {
    id: "plan-40",
    number: 40,
    title: "Apply structure /Volumes/AstroDrive",
    origin: "restructure",
    state: "applied",
    createdAt: "10:22",
    items: [],
    itemsTotal: 1450,
    itemsApplied: 1450,
    itemsFailed: 0,
    itemsPending: 0,
    type: "restructure",
  },
  {
    id: "plan-39",
    number: 39,
    title: "Project source-map M101",
    origin: "project",
    state: "approved",
    createdAt: "yesterday",
    items: [],
    itemsTotal: 18,
    itemsApplied: 0,
    itemsFailed: 0,
    itemsPending: 18,
    type: "source_map",
  },
  {
    id: "plan-38",
    number: 38,
    title: "Archive Solar 2026",
    origin: "archive",
    state: "applied",
    createdAt: "2026-05-15",
    items: [],
    itemsTotal: 320,
    itemsApplied: 320,
    itemsFailed: 0,
    itemsPending: 0,
    type: "archive",
  },
];

export const pendingPlans = plans.filter(
  (plan) =>
    plan.state === "ready_for_review" ||
    plan.state === "draft" ||
    plan.state === "failed" ||
    plan.state === "partially_applied",
);

/* ============================================================
   Logs
   ============================================================ */

export const logEntries: LogEntry[] = [
  {
    id: "log-1",
    time: "14:32:11",
    level: "info",
    source: "scan",
    message: "/Volumes/AstroDrive indexed 1247 files",
  },
  {
    id: "log-2",
    time: "14:32:08",
    level: "info",
    source: "classify",
    message: "/raw/2026-04-12 — 3 sessions inferred",
  },
  {
    id: "log-3",
    time: "14:31:55",
    level: "warn",
    source: "plan #41",
    message: "destination exists: light_073.fit",
  },
  {
    id: "log-4",
    time: "14:31:55",
    level: "info",
    source: "plan #41",
    message: "applied 124 / 200",
  },
  {
    id: "log-5",
    time: "14:31:30",
    level: "info",
    source: "plan #42",
    message: "draft created from inbox /raw/2026-04",
  },
  {
    id: "log-6",
    time: "14:28:02",
    level: "info",
    source: "ingest",
    message: "metadata extracted for 38 frames",
  },
  {
    id: "log-7",
    time: "14:20:11",
    level: "error",
    source: "plan #41",
    message: "apply halted — permission denied",
  },
];

/* ============================================================
   Settings sections
   ============================================================ */

export const settingsSections = [
  { id: "data-sources", label: "Data Sources" },
  { id: "ingestion-review", label: "Ingestion & Review" },
  { id: "naming-structure", label: "Naming & Structure" },
  { id: "calibration", label: "Calibration" },
  { id: "tool-workflows", label: "Tool Workflows" },
  { id: "catalogs", label: "Catalogs" },
  { id: "cleanup-archive", label: "Cleanup & Archive" },
  { id: "source-protection", label: "Source Protection" },
  { id: "application-log", label: "Application Log" },
  { id: "appearance", label: "Appearance" },
  { id: "advanced", label: "Advanced" },
];

export const availableTokens = [
  "target",
  "filter",
  "date",
  "frame_type",
  "camera",
  "exposure",
  "gain",
  "binning",
  "set_temp",
];

/* ============================================================
   Helpers
   ============================================================ */

export function lifecycleLabel(state: ProjectLifecycle): string {
  switch (state) {
    case "setup_incomplete":
      return "Setup incomplete";
    case "ready":
      return "Ready";
    case "prepared":
      return "Prepared";
    case "processing":
      return "Processing";
    case "completed":
      return "Completed";
    case "archived":
      return "Archived";
    case "blocked":
      return "Blocked";
  }
}

export function lifecycleTone(
  state: ProjectLifecycle,
): "neutral" | "info" | "success" | "warn" | "danger" | "accent" {
  switch (state) {
    case "processing":
    case "prepared":
      return "accent";
    case "ready":
      return "info";
    case "completed":
      return "success";
    case "blocked":
      return "warn";
    case "archived":
      return "neutral";
    default:
      return "neutral";
  }
}

export function planStateTone(
  state: PlanState,
): "neutral" | "info" | "success" | "warn" | "danger" | "accent" {
  switch (state) {
    case "applied":
      return "success";
    case "applying":
      return "accent";
    case "failed":
      return "danger";
    case "partially_applied":
      return "warn";
    case "ready_for_review":
    case "approved":
      return "info";
    case "draft":
      return "neutral";
    default:
      return "neutral";
  }
}

export function planStateLabel(state: PlanState): string {
  switch (state) {
    case "ready_for_review":
      return "ready for review";
    case "partially_applied":
      return "partial";
    default:
      return state;
  }
}

export function inventoryStateTone(state: InventorySession["state"]) {
  return state === "confirmed" ? "success" : state === "needs_review" ? "warn" : "danger";
}

export function inventoryStateLabel(state: InventorySession["state"]) {
  switch (state) {
    case "confirmed":
      return "confirmed";
    case "needs_review":
      return "needs review";
    case "rejected":
      return "rejected";
  }
}

export function frameTypeLabel(t: InventorySession["type"]) {
  return t;
}

export function inboxTypeLabel(t: InboxItem["type"]) {
  return t;
}
