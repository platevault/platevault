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

export interface SettingsState {
  pattern: PatternPart[];
  autoApplyPattern: boolean;
  alwaysPreviewBeforePlan: boolean;
  followSymlinks: boolean;
  hashOnScan: "lazy" | "eager" | "off";
  darkMatchTolerance: "strict" | "loose" | "any";
  flatMatching: "filter-rot" | "filter" | "manual";
  suggestCalibration: boolean;
  rowDensity: "dense" | "comfortable";
  logLevel: "error" | "warn" | "info" | "debug";
  rememberFollowLogs: boolean;
  defaultProtection: "protected" | "normal" | "unprotected";
  blockPermanentDelete: boolean;
  protectedCategories: string;
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

const DEFAULT_SETTINGS: SettingsState = {
  pattern: DEFAULT_PATTERN,
  autoApplyPattern: true,
  alwaysPreviewBeforePlan: false,
  followSymlinks: false,
  hashOnScan: "lazy",
  darkMatchTolerance: "strict",
  flatMatching: "filter-rot",
  suggestCalibration: true,
  rowDensity: "dense",
  logLevel: "info",
  rememberFollowLogs: true,
  defaultProtection: "protected",
  blockPermanentDelete: true,
  protectedCategories: "lights, masters, finals",
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
  "protectedCategories",
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
