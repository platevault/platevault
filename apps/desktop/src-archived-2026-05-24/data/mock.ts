/**
 * Mock data fixtures for the Astro Library Manager UI mockup.
 * Designed to mirror the realistic M101 / NGC7000 / Andromeda scenarios
 * referenced throughout the design plan.
 */

import type { LogEntry } from "../ui/LogPanel";

/* ============================================================
   Inventory
   ============================================================ */

/**
 * Canonical inventory session states (ratified 2026-05-21):
 *   discovered   — scanner saw a folder/file group, no decision yet
 *   candidate    — system proposes a classification, pending user review
 *   needs_review — flagged for explicit attention (conflicts, low confidence)
 *   confirmed    — user has accepted the classification
 *   rejected     — user explicitly excluded from the library
 *   ignored      — silently hidden (junk, .DS_Store dirs, etc.)
 */
export type InventorySessionState =
  | "discovered"
  | "candidate"
  | "needs_review"
  | "confirmed"
  | "rejected"
  | "ignored";

export const INVENTORY_STATES: InventorySessionState[] = [
  "discovered",
  "candidate",
  "needs_review",
  "confirmed",
  "rejected",
  "ignored",
];

export interface InventorySession {
  id: string;
  name: string;
  sourceId: string;
  frames: number;
  type: "light" | "dark" | "flat" | "bias" | "mixed";
  target: string | null;
  filter: string | null;
  exposure: string | null;
  state: InventorySessionState;
  camera?: string;
  gain?: string;
  binning?: string;
  setTemp?: string;
  capturedOn?: string;
  calibrationMatch?: "ok" | "partial" | "missing" | "n/a";
  /**
   * For calibration-type sessions (dark/flat/bias), the number of light
   * sessions whose calibration matching currently points at this session.
   */
  usedByLightSessions?: number;
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
  // Per ratified decision: auto-extracted from FITS SITELAT/SITELONG/SITEELEV headers;
  // falls back to user-confirmed inventory-source default.
  observerLocation?: {
    latitude: number;   // decimal degrees, +N
    longitude: number;  // decimal degrees, +E
    elevation?: number; // meters
    source: "fits-header" | "user" | "inherited";
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
    state: "reconnect_required",
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
        calibrationMatch: "ok",
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
        observerLocation: { latitude: 25.197, longitude: 55.274, elevation: 12, source: "fits-header" },
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
        calibrationMatch: "ok",
        linked: { projects: [{ id: "prj-m101", name: "M101 Mosaic" }] },
        observerLocation: { latitude: 25.197, longitude: 55.274, elevation: 12, source: "fits-header" },
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
        calibrationMatch: "partial",
        linked: { projects: [{ id: "prj-m101", name: "M101 Mosaic" }] },
        observerLocation: { latitude: 25.197, longitude: 55.274, elevation: 12, source: "fits-header" },
      },
      {
        id: "inv-ic1396-discovered",
        name: "IC1396 2026-05-18",
        sourceId: "src-astrodrive",
        frames: 22,
        type: "light",
        target: "IC1396",
        filter: "SII",
        exposure: "180s",
        state: "discovered",
        camera: "ASI2600MM Pro",
        capturedOn: "2026-05-18",
        calibrationMatch: "missing",
      },
      {
        id: "inv-ngc7331-candidate",
        name: "NGC7331? 2026-05-17",
        sourceId: "src-astrodrive",
        frames: 18,
        type: "light",
        target: "NGC7331",
        filter: "L",
        exposure: "60s",
        state: "candidate",
        camera: "ASI2600MM Pro",
        capturedOn: "2026-05-17",
        calibrationMatch: "ok",
        provenance: {
          target: "filename token",
          inferred: "target inferred 0.71",
        },
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
        usedByLightSessions: 5,
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
        usedByLightSessions: 12,
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
        capturedOn: "2024-08-?",
        calibrationMatch: "missing",
      },
      {
        id: "inv-thumbcache-ignored",
        name: "._thumb cache",
        sourceId: "src-astrodrive",
        frames: 3,
        type: "mixed",
        target: null,
        filter: null,
        exposure: null,
        state: "ignored",
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
        observerLocation: { latitude: 25.197, longitude: 55.274, elevation: 12, source: "fits-header" },
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
  /** Auto-classification confidence (0-1). */
  confidence: number;
  proposedTarget?: string;
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
    confidence: 0.61,
    proposedTarget: "M101",
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
    confidence: 0.94,
    proposedTarget: "M101",
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
    confidence: 0.97,
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
    confidence: 0.89,
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
  targets: string[];
  totalFrames: number;
  exposureBreakdown: Array<{ filter: string; seconds: number }>;
  updatedAt: string;
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
    targets: ["M101"],
    totalFrames: 140,
    exposureBreakdown: [
      { filter: "Ha", seconds: 16800 },
      { filter: "OIII", seconds: 7200 },
    ],
    updatedAt: "2026-05-12T14:22:00Z",
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
    targets: ["M31"],
    totalFrames: 88,
    exposureBreakdown: [{ filter: "L", seconds: 5280 }],
    updatedAt: "2025-11-04T08:30:00Z",
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
    targets: ["NGC7000"],
    totalFrames: 210,
    exposureBreakdown: [
      { filter: "Ha", seconds: 14400 },
      { filter: "OIII", seconds: 10800 },
      { filter: "SII", seconds: 7200 },
    ],
    updatedAt: "2025-12-19T22:10:00Z",
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
    targets: ["Sun"],
    totalFrames: 320,
    exposureBreakdown: [{ filter: "WL", seconds: 960 }],
    updatedAt: "2026-02-14T10:00:00Z",
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

const sourceMapItems: PlanItem[] = Array.from({ length: 10 }).map((_, idx) => ({
  id: `item-44-${idx + 1}`,
  index: idx + 1,
  name: `source-link-${String(idx + 1).padStart(2, "0")}`,
  action: "link" as const,
  from: `/Volumes/AstroDrive/raw/M101/${idx < 7 ? "Ha" : "OIII"}/2026-04-${12 + Math.floor(idx / 3)}/lights/`,
  to: `/home/sjors/projects/M101-Mosaic/sources/${idx < 7 ? "Ha" : "OIII"}/`,
  reason: "source-map: link acquisition session into project source view",
  protection: "protected" as const,
  state: "pending" as const,
}));

export const plans: Plan[] = [
  {
    id: "plan-44",
    number: 44,
    title: "Project source-map M101 Mosaic",
    origin: "project",
    originPath: "prj-m101",
    state: "ready_for_review",
    createdAt: "2026-05-12T14:30:00Z",
    items: sourceMapItems,
    itemsTotal: 10,
    itemsApplied: 0,
    itemsFailed: 0,
    itemsPending: 10,
    type: "restructure",
  },
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

export interface SettingsSection {
  id: string;
  label: string;
  searchTags: string[];
}

export const settingsSections: SettingsSection[] = [
  {
    id: "data-sources",
    label: "Data Sources",
    searchTags: ["source", "drive", "raw", "calibration", "inbox", "project"],
  },
  {
    id: "ingestion-review",
    label: "Ingestion & Review",
    searchTags: ["ingestion", "review", "inbox", "classify", "confirm"],
  },
  {
    id: "naming-structure",
    label: "Naming & Structure",
    searchTags: ["naming", "structure", "pattern", "folder", "rename"],
  },
  {
    id: "calibration",
    label: "Calibration",
    searchTags: ["calibration", "darks", "flats", "bias", "matching"],
  },
  {
    id: "tool-workflows",
    label: "Tool Workflows",
    searchTags: ["tool", "workflow", "pixinsight", "siril", "profile"],
  },
  {
    id: "catalogs",
    label: "Catalogs",
    searchTags: ["catalog", "target", "object", "atlas"],
  },
  {
    id: "backup",
    label: "Backup & export",
    searchTags: ["backup", "export", "snapshot", "library", "audit"],
  },
  {
    id: "cleanup-archive",
    label: "Cleanup & Archive",
    searchTags: ["cleanup", "archive", "delete", "trash", "intermediates"],
  },
  {
    id: "source-protection",
    label: "Source Protection",
    searchTags: ["protection", "guard", "delete", "safety", "permanent"],
  },
  {
    id: "audit",
    label: "Audit log",
    searchTags: ["audit", "log", "history", "events", "debug"],
  },
  {
    id: "appearance",
    label: "Appearance",
    searchTags: ["appearance", "theme", "density", "dark", "light"],
  },
  {
    id: "advanced",
    label: "Advanced",
    searchTags: ["advanced", "developer", "debug", "experimental"],
  },
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
   Audit log
   ============================================================ */

export type AuditEventKind =
  | "plan_applied"
  | "plan_failed"
  | "plan_discarded"
  | "session_reclassified"
  | "source_added"
  | "source_disconnected"
  | "source_remapped"
  | "wizard_completed"
  | "settings_changed";

export interface AuditEvent {
  id: string;
  at: string; // ISO 8601
  kind: AuditEventKind;
  actor: "user" | "system";
  summary: string;
  /** Optional structured details (mock-friendly). */
  details?: {
    planId?: string;
    sessionId?: string;
    sourceId?: string;
    before?: string;
    after?: string;
  };
}

function daysAgo(n: number, hourOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(d.getHours() - hourOffset);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export const seedAuditEvents: AuditEvent[] = [
  {
    id: "audit-01",
    at: daysAgo(10, 2),
    kind: "wizard_completed",
    actor: "user",
    summary: "First-run wizard completed — 2 sources registered",
  },
  {
    id: "audit-02",
    at: daysAgo(10, 1),
    kind: "source_added",
    actor: "user",
    summary: "Source /Volumes/AstroDrive registered (external disk)",
    details: { sourceId: "src-astrodrive" },
  },
  {
    id: "audit-03",
    at: daysAgo(10),
    kind: "source_added",
    actor: "user",
    summary: "Source /home/sjors/astro/raw registered (local disk)",
    details: { sourceId: "src-local-raw" },
  },
  {
    id: "audit-04",
    at: daysAgo(9, 3),
    kind: "settings_changed",
    actor: "user",
    summary: "Setting changed: followSymlinks → false",
    details: { before: "true", after: "false" },
  },
  {
    id: "audit-05",
    at: daysAgo(8, 1),
    kind: "plan_applied",
    actor: "user",
    summary: "Plan #40 applied — 1450 items moved (Apply structure /Volumes/AstroDrive)",
    details: { planId: "plan-40" },
  },
  {
    id: "audit-06",
    at: daysAgo(7),
    kind: "session_reclassified",
    actor: "user",
    summary: "Session NGC7331? 2026-05-17 reclassified: candidate → confirmed",
    details: { sessionId: "inv-ngc7331-candidate" },
  },
  {
    id: "audit-07",
    at: daysAgo(6, 4),
    kind: "plan_applied",
    actor: "user",
    summary: "Plan #38 applied — 320 items archived (Archive Solar 2026)",
    details: { planId: "plan-38" },
  },
  {
    id: "audit-08",
    at: daysAgo(5, 2),
    kind: "settings_changed",
    actor: "user",
    summary: "Setting changed: darkMatchTolerance → loose",
    details: { before: "strict", after: "loose" },
  },
  {
    id: "audit-09",
    at: daysAgo(4, 1),
    kind: "plan_failed",
    actor: "system",
    summary: "Plan #41 partially failed — 6 items failed, 118 succeeded (Cleanup NGC 7000)",
    details: { planId: "plan-41" },
  },
  {
    id: "audit-10",
    at: daysAgo(3, 3),
    kind: "source_disconnected",
    actor: "system",
    summary: "Source /Volumes/AstroDrive went offline — reconnect required",
    details: { sourceId: "src-astrodrive" },
  },
  {
    id: "audit-11",
    at: daysAgo(2, 2),
    kind: "session_reclassified",
    actor: "user",
    summary: "Session IC1396 2026-05-18 reclassified: discovered → needs_review",
    details: { sessionId: "inv-ic1396-discovered" },
  },
  {
    id: "audit-12",
    at: daysAgo(2),
    kind: "settings_changed",
    actor: "user",
    summary: "Setting changed: rowDensity → comfortable",
    details: { before: "dense", after: "comfortable" },
  },
  {
    id: "audit-13",
    at: daysAgo(1, 5),
    kind: "plan_discarded",
    actor: "user",
    summary: "Plan #43 discarded — Restructure M101 frames",
    details: { planId: "plan-43" },
  },
  {
    id: "audit-14",
    at: daysAgo(1, 1),
    kind: "settings_changed",
    actor: "user",
    summary: "Setting changed: theme → dark",
    details: { before: "system", after: "dark" },
  },
  {
    id: "audit-15",
    at: daysAgo(0, 3),
    kind: "plan_applied",
    actor: "user",
    summary: "Plan #39 applied — 18 items linked (Project source-map M101)",
    details: { planId: "plan-39" },
  },
];

/* ============================================================
   Catalog objects
   ============================================================ */

export interface CatalogObject {
  name: string;
  aliases: string[];
  catalog: string;
  type: string;
  constellation: string;
  magnitude: number;
  ra: string;
  dec: string;
}

export const CATALOG_OBJECTS: CatalogObject[] = [
  { name: "M101", aliases: ["NGC 5457", "Pinwheel Galaxy"], catalog: "Messier", type: "Galaxy", constellation: "Ursa Major", magnitude: 7.9, ra: "14h 03m", dec: "+54° 21′" },
  { name: "M31", aliases: ["NGC 224", "Andromeda Galaxy"], catalog: "Messier", type: "Galaxy", constellation: "Andromeda", magnitude: 3.4, ra: "00h 42m", dec: "+41° 16′" },
  { name: "M42", aliases: ["NGC 1976", "Orion Nebula"], catalog: "Messier", type: "Nebula", constellation: "Orion", magnitude: 4.0, ra: "05h 35m", dec: "−05° 23′" },
  { name: "M45", aliases: ["Pleiades"], catalog: "Messier", type: "Cluster", constellation: "Taurus", magnitude: 1.6, ra: "03h 47m", dec: "+24° 07′" },
  { name: "M51", aliases: ["NGC 5194", "Whirlpool Galaxy"], catalog: "Messier", type: "Galaxy", constellation: "Canes Venatici", magnitude: 8.4, ra: "13h 29m", dec: "+47° 12′" },
  { name: "M81", aliases: ["NGC 3031", "Bode's Galaxy"], catalog: "Messier", type: "Galaxy", constellation: "Ursa Major", magnitude: 6.9, ra: "09h 55m", dec: "+69° 04′" },
  { name: "M82", aliases: ["NGC 3034", "Cigar Galaxy"], catalog: "Messier", type: "Galaxy", constellation: "Ursa Major", magnitude: 8.4, ra: "09h 55m", dec: "+69° 41′" },
  { name: "M13", aliases: ["Great Globular Cluster in Hercules"], catalog: "Messier", type: "Globular", constellation: "Hercules", magnitude: 5.8, ra: "16h 41m", dec: "+36° 28′" },
  { name: "M33", aliases: ["NGC 598", "Triangulum Galaxy"], catalog: "Messier", type: "Galaxy", constellation: "Triangulum", magnitude: 5.7, ra: "01h 33m", dec: "+30° 39′" },
  { name: "M57", aliases: ["NGC 6720", "Ring Nebula"], catalog: "Messier", type: "Nebula", constellation: "Lyra", magnitude: 8.8, ra: "18h 53m", dec: "+33° 02′" },
  { name: "NGC 7000", aliases: ["North America Nebula"], catalog: "NGC", type: "Nebula", constellation: "Cygnus", magnitude: 4.0, ra: "20h 59m", dec: "+44° 31′" },
  { name: "NGC 7331", aliases: [], catalog: "NGC", type: "Galaxy", constellation: "Pegasus", magnitude: 9.5, ra: "22h 37m", dec: "+34° 25′" },
  { name: "IC 1396", aliases: ["Elephant Trunk Nebula"], catalog: "IC", type: "Nebula", constellation: "Cepheus", magnitude: 3.5, ra: "21h 39m", dec: "+57° 30′" },
  { name: "IC 1805", aliases: ["Heart Nebula"], catalog: "IC", type: "Nebula", constellation: "Cassiopeia", magnitude: 6.5, ra: "02h 32m", dec: "+61° 27′" },
  { name: "NGC 2237", aliases: ["Rosette Nebula"], catalog: "NGC", type: "Nebula", constellation: "Monoceros", magnitude: 9.0, ra: "06h 32m", dec: "+05° 03′" },
  { name: "NGC 6960", aliases: ["Western Veil Nebula", "Witch's Broom"], catalog: "NGC", type: "Nebula", constellation: "Cygnus", magnitude: 7.0, ra: "20h 45m", dec: "+30° 43′" },
  { name: "NGC 6992", aliases: ["Eastern Veil Nebula"], catalog: "NGC", type: "Nebula", constellation: "Cygnus", magnitude: 7.0, ra: "20h 56m", dec: "+31° 43′" },
  { name: "M27", aliases: ["NGC 6853", "Dumbbell Nebula"], catalog: "Messier", type: "Nebula", constellation: "Vulpecula", magnitude: 7.4, ra: "19h 59m", dec: "+22° 43′" },
  { name: "M97", aliases: ["NGC 3587", "Owl Nebula"], catalog: "Messier", type: "Nebula", constellation: "Ursa Major", magnitude: 9.9, ra: "11h 14m", dec: "+55° 01′" },
  { name: "M106", aliases: ["NGC 4258"], catalog: "Messier", type: "Galaxy", constellation: "Canes Venatici", magnitude: 8.4, ra: "12h 18m", dec: "+47° 18′" },
  { name: "NGC 891", aliases: [], catalog: "NGC", type: "Galaxy", constellation: "Andromeda", magnitude: 10.8, ra: "02h 22m", dec: "+42° 21′" },
  { name: "NGC 253", aliases: ["Sculptor Galaxy", "Silver Coin"], catalog: "NGC", type: "Galaxy", constellation: "Sculptor", magnitude: 7.1, ra: "00h 47m", dec: "−25° 17′" },
  { name: "NGC 1499", aliases: ["California Nebula"], catalog: "NGC", type: "Nebula", constellation: "Perseus", magnitude: 6.0, ra: "04h 03m", dec: "+36° 25′" },
  { name: "M8", aliases: ["NGC 6523", "Lagoon Nebula"], catalog: "Messier", type: "Nebula", constellation: "Sagittarius", magnitude: 5.8, ra: "18h 03m", dec: "−24° 23′" },
  { name: "M20", aliases: ["NGC 6514", "Trifid Nebula"], catalog: "Messier", type: "Nebula", constellation: "Sagittarius", magnitude: 6.3, ra: "18h 02m", dec: "−23° 02′" },
  { name: "NGC 5128", aliases: ["Centaurus A"], catalog: "NGC", type: "Galaxy", constellation: "Centaurus", magnitude: 6.8, ra: "13h 25m", dec: "−43° 01′" },
  { name: "M63", aliases: ["NGC 5055", "Sunflower Galaxy"], catalog: "Messier", type: "Galaxy", constellation: "Canes Venatici", magnitude: 8.6, ra: "13h 15m", dec: "+42° 02′" },
  { name: "IC 5070", aliases: ["Pelican Nebula"], catalog: "IC", type: "Nebula", constellation: "Cygnus", magnitude: 8.0, ra: "20h 51m", dec: "+44° 21′" },
  { name: "NGC 7293", aliases: ["Helix Nebula"], catalog: "NGC", type: "Nebula", constellation: "Aquarius", magnitude: 7.3, ra: "22h 29m", dec: "−20° 50′" },
  { name: "M64", aliases: ["NGC 4826", "Black Eye Galaxy"], catalog: "Messier", type: "Galaxy", constellation: "Coma Berenices", magnitude: 8.5, ra: "12h 56m", dec: "+21° 41′" },
  { name: "NGC 4889", aliases: [], catalog: "NGC", type: "Galaxy", constellation: "Coma Berenices", magnitude: 11.4, ra: "13h 00m", dec: "+27° 59′" },
  { name: "M77", aliases: ["NGC 1068", "Cetus A"], catalog: "Messier", type: "Galaxy", constellation: "Cetus", magnitude: 8.9, ra: "02h 42m", dec: "−00° 01′" },
  { name: "NGC 2903", aliases: [], catalog: "NGC", type: "Galaxy", constellation: "Leo", magnitude: 8.9, ra: "09h 32m", dec: "+21° 30′" },
  { name: "M3", aliases: ["NGC 5272"], catalog: "Messier", type: "Globular", constellation: "Canes Venatici", magnitude: 6.2, ra: "13h 42m", dec: "+28° 23′" },
  { name: "M92", aliases: ["NGC 6341"], catalog: "Messier", type: "Globular", constellation: "Hercules", magnitude: 6.4, ra: "17h 17m", dec: "+43° 08′" },
  { name: "NGC 6543", aliases: ["Cat's Eye Nebula"], catalog: "NGC", type: "Nebula", constellation: "Draco", magnitude: 8.1, ra: "17h 58m", dec: "+66° 38′" },
  { name: "SH2-155", aliases: ["Cave Nebula"], catalog: "Sharpless", type: "Nebula", constellation: "Cepheus", magnitude: 7.7, ra: "22h 57m", dec: "+62° 37′" },
  { name: "NGC 2359", aliases: ["Thor's Helmet"], catalog: "NGC", type: "Nebula", constellation: "Canis Major", magnitude: 11.0, ra: "07h 18m", dec: "−13° 13′" },
  { name: "M78", aliases: ["NGC 2068"], catalog: "Messier", type: "Nebula", constellation: "Orion", magnitude: 8.3, ra: "05h 46m", dec: "+00° 03′" },
  { name: "NGC 6888", aliases: ["Crescent Nebula"], catalog: "NGC", type: "Nebula", constellation: "Cygnus", magnitude: 7.4, ra: "20h 12m", dec: "+38° 21′" },
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

export function inventoryStateTone(state: InventorySessionState) {
  switch (state) {
    case "confirmed":
      return "success";
    case "candidate":
    case "needs_review":
      return "warn";
    case "rejected":
      return "danger";
    case "discovered":
    case "ignored":
    default:
      return "neutral";
  }
}

export function inventoryStateLabel(state: InventorySessionState) {
  switch (state) {
    case "discovered":
      return "discovered";
    case "candidate":
      return "candidate";
    case "needs_review":
      return "needs review";
    case "confirmed":
      return "confirmed";
    case "rejected":
      return "rejected";
    case "ignored":
      return "ignored";
  }
}

export function frameTypeLabel(t: InventorySession["type"]) {
  return t;
}

export function inboxTypeLabel(t: InboxItem["type"]) {
  return t;
}
