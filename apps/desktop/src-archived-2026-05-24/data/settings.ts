// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistent settings store backed by localStorage.
 *
 * For each setting we expose:
 *   - useXxx() hook for reactive reads
 *   - setXxx(value) for writes (which also persist and broadcast)
 *
 * Settings persist across reloads and emit log entries for auditability.
 */

import { useSyncExternalStore } from "react";
import { appendLog } from "./store";
import type { PatternPart } from "../ui/TokenPattern";

const STORAGE_KEY = "alm.settings.v1";

/** Known frame types for naming pattern overrides and calibration matching. */
export type FrameType = "light" | "dark" | "flat" | "bias" | "dark_flat" | "mixed";

export const FRAME_TYPES: FrameType[] = ["light", "dark", "flat", "bias", "dark_flat", "mixed"];

/**
 * Frame types that can have per-type naming pattern overrides.
 * `mixed` is excluded because mixed-content folders are split by the Inbox flow
 * before any pattern can be applied.
 */
export type OverridableFrameType = Exclude<FrameType, "mixed">;

export const OVERRIDABLE_FRAME_TYPES: OverridableFrameType[] = [
  "light",
  "dark",
  "flat",
  "bias",
  "dark_flat",
];

/**
 * Per-frame-type naming pattern overrides.
 * A missing key means "inherit global pattern".
 * `mixed` is excluded from overrides — mixed folders are split by Inbox, not routed via a pattern.
 */
export interface NamingPatterns {
  global: string;
  overrides: Partial<Record<OverridableFrameType, string>>;
}

/**
 * Numeric tolerances for dark-frame matching.
 * Each field is the maximum allowed delta.
 */
export interface DarkMatchTolerances {
  /** Maximum delta in seconds between light and dark exposure times. */
  exposureSecs: number;
  /** Maximum delta in °C between light and dark set-temperature. */
  tempCelsius: number;
  /**
   * Maximum allowed gain delta (arbitrary sensor units).
   * 0 = exact match required. Range hint: 0–1000.
   */
  gainUnits: number;
}

/** Known vocabulary for protected categories. */
export const PROTECTED_CATEGORIES = [
  "raw sessions",
  "processed masters",
  "archived projects",
  "capture exports",
  "calibration libraries",
  "project source views",
] as const;

export type ProtectedCategory = (typeof PROTECTED_CATEGORIES)[number];

/** @deprecated Use PROTECTED_CATEGORIES instead. */
export const PROTECTED_CATEGORY_VOCAB: string[] = [...PROTECTED_CATEGORIES];

/* -----------------------------------------------------------------------
   Calibration rule editor
   ----------------------------------------------------------------------- */

/**
 * Per-frame-type calibration matching rule.
 * `fields` is the list of metadata keys that must match.
 * `sessionOrNight` is a flat-specific boolean toggle.
 * `rotation`, `opticalTrain` are flat-specific booleans.
 */
export interface CalibrationFrameRule {
  fields: string[];
  /** Flat-specific: require same session or night. */
  sessionOrNight?: boolean;
  /** Flat-specific: require same optical rotation. */
  rotation?: boolean;
  /** Flat-specific: require same optical train. */
  opticalTrain?: boolean;
}

export type CalibrationRules = Record<string, CalibrationFrameRule>;

const DEFAULT_CALIBRATION_RULES: CalibrationRules = {
  dark: { fields: ["exposure", "temperature", "gain"] },
  flat: { fields: ["filter"], sessionOrNight: false, rotation: false, opticalTrain: false },
  bias: { fields: ["gain", "camera"] },
  dark_flat: { fields: ["exposure", "gain", "camera"] },
  // Note: "light" intentionally omitted — lights match downstream against these rules, not the other way around.
};

/* -----------------------------------------------------------------------
   Tool workflow profile editor
   ----------------------------------------------------------------------- */

export interface ToolProfile {
  path: string;
  layout: "flat" | "filter-bucketed" | "date-bucketed";
  sourceMapMode: "move" | "symlink" | "hardlink";
  openCommand: string;
  postPrepare: "reveal" | "launch" | "nothing";
}

export type ToolProfiles = Record<string, ToolProfile>;

export interface SettingsState {
  pattern: PatternPart[];
  namingPatterns: NamingPatterns;
  /** @deprecated Auto-apply is always on. Kept for backwards-compat migration only. */
  autoApplyPattern: boolean;
  alwaysPreviewBeforePlan: boolean;
  followSymlinks: boolean;
  hashOnScan: "lazy" | "eager" | "off";
  /** @deprecated replaced by darkMatchTolerances — kept for migration */
  darkMatchTolerance: "strict" | "loose" | "any";
  darkMatchTolerances: DarkMatchTolerances;
  flatMatching: "filter-rot" | "filter" | "manual";
  suggestCalibration: boolean;
  rowDensity: "dense" | "comfortable";
  logLevel: "error" | "warn" | "info" | "debug";
  rememberFollowLogs: boolean;
  defaultProtection: "protected" | "normal" | "unprotected";
  blockPermanentDelete: boolean;
  /** @deprecated use protectedCategories (ProtectedCategory[]) — kept for greenfield migration */
  protectedCategoriesLegacy: string;
  /** Multiselect from PROTECTED_CATEGORIES vocabulary. */
  protectedCategories: ProtectedCategory[];
  /** Catalog object names the user has starred. */
  catalogFavorites: string[];
  /** Per-frame-type calibration matching rules. */
  calibrationRules: CalibrationRules;
  /** Per-tool workflow profiles. */
  toolProfiles: ToolProfiles;
  /**
   * Result of the symlink support check performed during the wizard.
   * null  = not yet checked (wizard not completed or check skipped).
   * "supported"      = symlinks work on this system.
   * "not_supported"  = Windows configuration doesn't support symlinks.
   * "disabled"       = symlinks exist but are not enabled (Windows privilege).
   */
  symlinkSupport: "supported" | "not_supported" | "disabled" | null;
}

const DEFAULT_PATTERN: PatternPart[] = [
  { id: "t1", kind: "token", value: "target" },
  { id: "s1", kind: "separator", value: "/" },
  { id: "t2", kind: "token", value: "filter" },
  { id: "s2", kind: "separator", value: "/" },
  { id: "t3", kind: "token", value: "date" },
  { id: "s3", kind: "separator", value: "/" },
  { id: "t4", kind: "token", value: "frame_type" },
  { id: "s4", kind: "separator", value: "/" },
];

const DEFAULT_NAMING_PATTERNS: NamingPatterns = {
  global: "{target}/{filter}/{date}/{frame_type}/",
  overrides: {},
};

const DEFAULT_DARK_TOLERANCES: DarkMatchTolerances = {
  exposureSecs: 5,
  tempCelsius: 2,
  gainUnits: 0,
};

const DEFAULT_SETTINGS: SettingsState = {
  pattern: DEFAULT_PATTERN,
  namingPatterns: DEFAULT_NAMING_PATTERNS,
  autoApplyPattern: true, // deprecated: always on

  alwaysPreviewBeforePlan: false,
  followSymlinks: false,
  hashOnScan: "lazy",
  darkMatchTolerance: "strict",
  darkMatchTolerances: DEFAULT_DARK_TOLERANCES,
  flatMatching: "filter-rot",
  suggestCalibration: true,
  rowDensity: "dense",
  logLevel: "info",
  rememberFollowLogs: true,
  defaultProtection: "protected",
  blockPermanentDelete: true,
  protectedCategoriesLegacy: "lights, masters, finals",
  protectedCategories: [
    "raw sessions",
    "processed masters",
    "archived projects",
    "capture exports",
    "calibration libraries",
    "project source views",
  ],
  catalogFavorites: [],
  calibrationRules: DEFAULT_CALIBRATION_RULES,
  toolProfiles: {},
  symlinkSupport: null,
};

function load(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(s: SettingsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* swallow — local storage may be unavailable */
  }
}

let snapshot: SettingsState =
  typeof window !== "undefined" ? load() : DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return snapshot;
}

export function useSettings(): SettingsState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Settings keys that change too frequently to log every update. For these
 * we still persist on every change but only emit an audit log entry when
 * the value goes from "present" to "absent" or vice versa, to avoid
 * flooding the log on text-field keystrokes or rapid token edits.
 */
const NOISY_KEYS = new Set<keyof SettingsState>([
  "pattern",
  "namingPatterns",
  "darkMatchTolerances",
  "calibrationRules",
  "toolProfiles",
  "catalogFavorites",
]);

export function updateSettings<K extends keyof SettingsState>(
  key: K,
  value: SettingsState[K],
) {
  const prev = snapshot[key];
  if (prev === value) return;
  snapshot = { ...snapshot, [key]: value };
  persist(snapshot);
  notify();
  if (!NOISY_KEYS.has(key)) {
    appendLog({
      level: "info",
      source: "settings",
      message: `${String(key)} updated`,
    });
  }
}

export function getCurrentPattern(): PatternPart[] {
  return snapshot.pattern;
}

export function formatPattern(pattern: PatternPart[]): string {
  return pattern.map((p) => (p.kind === "token" ? `{${p.value}}` : p.value)).join("");
}

// ---------- calibration rules helpers ----------

export function getCalibrationRules(): CalibrationRules {
  return snapshot.calibrationRules;
}

export function updateCalibrationRule(
  frameType: string,
  patch: Partial<CalibrationFrameRule>,
): void {
  const prev = snapshot.calibrationRules[frameType] ?? DEFAULT_CALIBRATION_RULES[frameType] ?? { fields: [] };
  const next: CalibrationRules = {
    ...snapshot.calibrationRules,
    [frameType]: { ...prev, ...patch },
  };
  updateSettings("calibrationRules", next);
}

// ---------- tool profile helpers ----------

export function getToolProfiles(): ToolProfiles {
  return snapshot.toolProfiles;
}

export function updateToolProfile(
  toolName: string,
  patch: Partial<ToolProfile>,
): void {
  const defaults: ToolProfile = {
    path: "",
    layout: "filter-bucketed",
    sourceMapMode: "symlink",
    openCommand: "",
    postPrepare: "reveal",
  };
  const prev = snapshot.toolProfiles[toolName] ?? defaults;
  const next: ToolProfiles = {
    ...snapshot.toolProfiles,
    [toolName]: { ...prev, ...patch },
  };
  updateSettings("toolProfiles", next);
}

// ---------- catalog favorites helpers ----------

export function toggleCatalogFavorite(name: string): void {
  const prev = snapshot.catalogFavorites;
  const next = prev.includes(name)
    ? prev.filter((n) => n !== name)
    : [...prev, name];
  updateSettings("catalogFavorites", next);
}
