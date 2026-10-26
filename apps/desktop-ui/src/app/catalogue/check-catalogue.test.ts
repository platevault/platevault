import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { catalogueGaps, exportsOf, layerModules } from "../../../scripts/check-catalogue.mjs"

// Fixtures in the shape of registry.ts and a components/ module.
const MODULE = {
  file: "components/app/data.tsx",
  source: ["export function KeyValueList() {}", "export const Stat = () => null", "export interface KeyValueItem {}", "export const STATUS_CLASS = ''"].join("\n"),
}

function registry(components: string[]) {
  return [
    'import { DataCatalogue } from "./data"',
    "// KeyValueList and Stat render on the reference page too.",
    "export const CATALOGUE: CatalogueEntry[] = [",
    `  { id: "data", components: [${components.map((name) => JSON.stringify(name)).join(", ")}], Entry: DataCatalogue },`,
    "]",
  ].join("\n")
}

function moduleOf(file: string, ...lines: string[]) {
  return { file, source: lines.join("\n") }
}

describe("check-catalogue", () => {
  it("passes when every component export is in an entry's components", () => {
    expect(catalogueGaps(registry(["KeyValueList", "Stat"]), [MODULE])).toEqual({ modules: [{ file: MODULE.file, names: ["KeyValueList", "Stat"], missing: [] }], unexported: [] })
  })

  it("reports an export without an entry, even when the registry mentions its name elsewhere", () => {
    expect(catalogueGaps(registry(["KeyValueList"]), [MODULE]).modules[0]?.missing).toEqual(["Stat"])
  })

  it("fails when the registry has no components arrays to read", () => {
    expect(() => catalogueGaps("export const CATALOGUE = []", [MODULE])).toThrow(/components/)
  })

  it("reports a registered name that no module exports, a type's name included", () => {
    expect(catalogueGaps(registry(["KeyValueList", "Stat", "Tag", "KeyValueItem"]), [MODULE]).unexported).toEqual(["KeyValueItem", "Tag"])
  })

  it("reads async functions, let, var, destructured consts and classes", () => {
    const module = moduleOf(
      "components/app/forms.tsx",
      "export async function SaveForm() {}",
      "export let Draft = () => null",
      "export var Legacy = () => null",
      "export const { Left, Right: [Pair] } = parts",
      "export class Board {}",
    )
    expect(exportsOf(module)).toEqual(["SaveForm", "Draft", "Legacy", "Left", "Pair", "Board"])
  })

  it("counts a default export under its local name", () => {
    expect(exportsOf(moduleOf("components/app/a.tsx", "export default function Panel() {}"))).toEqual(["Panel"])
    expect(exportsOf(moduleOf("components/app/b.tsx", "const Sheet = () => null", "export default Sheet"))).toEqual(["Sheet"])
    expect(exportsOf(moduleOf("components/app/c.tsx", "function Card() {}", "export { Card as default }"))).toEqual(["Card"])
  })

  it("fails on an anonymous default export, which has no name to catalogue", () => {
    expect(() => exportsOf(moduleOf("components/app/a.tsx", "export default () => null"))).toThrow(/anonymous default/)
    expect(() => exportsOf(moduleOf("components/app/b.tsx", "export default function () {}"))).toThrow(/anonymous default/)
  })

  it("reads export lists and named re-exports under their exported names", () => {
    const module = moduleOf("components/ui/index.ts", "function Inner() {}", "export { Inner as Outer }", 'export { Button, buttonVariants } from "./button"')
    expect(exportsOf(module)).toEqual(["Outer", "Button"])
  })

  it("skips type-only exports", () => {
    const module = moduleOf(
      "components/app/types.ts",
      'import type { Imported } from "./elsewhere"',
      'import { type Marked, Real } from "./elsewhere"',
      "export interface Shape {}",
      "export type Alias = Shape",
      "interface Local {}",
      "export { Local, Imported, Marked, Real }",
      "export type { Alias as Renamed }",
      'export { type Remote, Value } from "./remote"',
      'export type * from "./remote"',
    )
    expect(exportsOf(module)).toEqual(["Real", "Value"])
  })

  it("follows `export * from` a scanned module, through relative and @/ paths, without its default", () => {
    const button = moduleOf("components/ui/button.tsx", "export function Button() {}", "export default function Fallback() {}", "export interface ButtonProps {}")
    const nested = moduleOf("components/ui/menu/index.tsx", "export const Menu = () => null")
    const barrel = moduleOf("components/ui/index.ts", 'export * from "./button"', 'export * from "@/components/ui/menu"')
    expect(exportsOf(barrel, [button, nested, barrel])).toEqual(["Button", "Menu"])
  })

  it("fails on `export * from` a module it cannot read", () => {
    expect(() => exportsOf(moduleOf("components/ui/index.ts", 'export * from "@base-ui/react/menu"'))).toThrow(/cannot list the exports/)
    expect(() => exportsOf(moduleOf("components/ui/index.ts", 'export * from "./gone"'))).toThrow(/cannot list the exports/)
  })

  it("scans the layers' subfolders", () => {
    const src = mkdtempSync(path.join(tmpdir(), "check-catalogue-"))
    try {
      mkdirSync(path.join(src, "components/app/nested/deeper"), { recursive: true })
      writeFileSync(path.join(src, "components/app/top.tsx"), "export function Top() {}")
      writeFileSync(path.join(src, "components/app/nested/deeper/leaf.tsx"), "export function Leaf() {}")
      writeFileSync(path.join(src, "components/app/nested/notes.md"), "not a module")
      expect(layerModules(src).map((module) => module.file)).toEqual(["components/app/nested/deeper/leaf.tsx", "components/app/top.tsx"])
    } finally {
      rmSync(src, { recursive: true, force: true })
    }
  })
})
