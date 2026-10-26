// Types for scripts/check-catalogue.mjs, so its checks can be tested from src/.

export interface ModuleSource {
  /** "components/app/data.tsx". */
  file: string
  source: string
}

export interface CatalogueGap {
  file: string
  /** The module's PascalCase component exports. */
  names: string[]
  /** The exports no registry entry covers. */
  missing: string[]
}

export interface CatalogueGaps {
  /** Each module with component exports. */
  modules: CatalogueGap[]
  /** Registered names no module exports, sorted. */
  unexported: string[]
}

export function exportsOf(module: ModuleSource, modules?: ModuleSource[]): string[]
export function registeredNames(registry: string): Set<string>
export function catalogueGaps(registry: string, modules: ModuleSource[]): CatalogueGaps
export function layerModules(src: string): ModuleSource[]
