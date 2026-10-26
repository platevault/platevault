import { describe, expect, it } from "vitest"
import { catalogueGaps } from "../../../scripts/check-catalogue.mjs"

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

describe("check-catalogue", () => {
  it("passes when every component export is in an entry's components", () => {
    expect(catalogueGaps(registry(["KeyValueList", "Stat"]), [MODULE])).toEqual([{ file: MODULE.file, names: ["KeyValueList", "Stat"], missing: [] }])
  })

  it("reports an export without an entry, even when the registry mentions its name elsewhere", () => {
    expect(catalogueGaps(registry(["KeyValueList"]), [MODULE])[0]?.missing).toEqual(["Stat"])
  })

  it("fails when the registry has no components arrays to read", () => {
    expect(() => catalogueGaps("export const CATALOGUE = []", [MODULE])).toThrow(/components/)
  })
})
