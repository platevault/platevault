// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where the inlang project keeps its catalogues, for the i18n lint scripts.
 * Paths resolve through the message-format plugin's own `pathPattern`, so a
 * renamed catalogue cannot leave a script reading a file that no longer
 * exists (the legacy catalog lint once kept reading en.json after the base
 * catalogue became en-GB.json).
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SETTINGS_PATH = path.join(APP_ROOT, "project.inlang/settings.json")

/** Parsed JSON, or an Error naming what could not be read: a gate that cannot read its inputs must fail, not pass. */
export function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch (err) {
    throw new Error(`could not read ${label} (${filePath}): ${err.message}`)
  }
}

/** The project's base locale, its locales, and the path of each locale's catalogue. */
export function inlangProject() {
  const settings = readJson(SETTINGS_PATH, "inlang settings")
  const { baseLocale } = settings
  const locales = settings.locales ?? []
  if (!baseLocale || locales.length === 0) throw new Error(`${SETTINGS_PATH} declares no baseLocale or no locales`)
  const pattern = settings["plugin.inlang.messageFormat"]?.pathPattern ?? "./messages/{locale}.json"
  return { baseLocale, locales, catalogPath: (locale) => path.join(APP_ROOT, pattern.replace("{locale}", locale)) }
}

/** Message keys only: `$schema` is metadata, not a translatable message. */
export function messageKeys(catalog) {
  return new Set(Object.keys(catalog).filter((key) => key !== "$schema"))
}
