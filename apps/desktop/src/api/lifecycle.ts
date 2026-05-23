/**
 * Typed adapter for the spec 002 lifecycle command surface.
 *
 * `apps/desktop/src/bindings/index.ts` is regenerated from Rust by
 * `cargo test -p desktop_shell --test bindings` — do not edit it by hand.
 * This module is the human-curated seam between the generated commands and
 * the rest of the React app. It:
 *
 * 1. Detects whether the app is running inside Tauri (vs `pnpm dev` in a
 *    browser tab). When Tauri is absent, the calls reject with a clear
 *    sentinel error so the UI can keep its current mockup-driven path.
 * 2. Carries the `contractVersion` / `requestId` boilerplate so callers
 *    only have to supply the meaningful fields.
 */

import {
  commands,
  type AssetType,
  type LedgerFilterDto,
  type LedgerRowDto,
  type ProvenanceReadResponse_Serialize,
  type TransitionRequest_Deserialize,
  type TransitionResponse_Serialize,
} from "../bindings";

/**
 * Re-export of the input shape the Tauri command expects. tauri-specta emits
 * separate `_Serialize` (response) and `_Deserialize` (request) variants;
 * commands take the deserialize side because that's what Rust will parse.
 */
export type TransitionRequest = TransitionRequest_Deserialize;

export const CONTRACT_VERSION = "2.0.0";

export class NotInTauriRuntimeError extends Error {
  constructor(command: string) {
    super(
      `${command} requires the Tauri runtime. Launch via \`cargo tauri dev\` or \`tauri build\`; \`pnpm dev\` runs the browser mockup.`,
    );
    this.name = "NotInTauriRuntimeError";
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

function requireRuntime(command: string): void {
  if (!isTauriRuntime()) {
    throw new NotInTauriRuntimeError(command);
  }
}

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes (shouldn't happen in WebView2/WebKitGTK).
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface ReadProvenanceArgs {
  assetId: string;
  assetType: AssetType;
  fieldPaths?: string[];
}

/**
 * Read provenance for an asset via the spec 002 contract.
 *
 * Returns the full `ProvenanceReadResponse` envelope; callers branch on
 * `status === "success"` vs `"error"`.
 */
export async function readProvenance(
  args: ReadProvenanceArgs,
): Promise<ProvenanceReadResponse_Serialize> {
  requireRuntime("provenanceRead");
  const result = await commands.provenanceRead({
    contractVersion: CONTRACT_VERSION,
    requestId: newRequestId(),
    assetId: args.assetId,
    assetType: args.assetType,
    fieldPaths: args.fieldPaths ?? [],
  });
  if (result.status === "ok") {
    return result.data;
  }
  throw new Error(`provenance_read invoke failed: ${result.error}`);
}

/**
 * Apply a lifecycle transition. The discriminated `TransitionRequest`
 * variants live in `bindings`; callers construct the appropriate one and
 * pass it in.
 */
export async function applyTransition(
  request: TransitionRequest_Deserialize,
): Promise<TransitionResponse_Serialize> {
  requireRuntime("lifecycleTransitionApply");
  const result = await commands.lifecycleTransitionApply(request);
  if (result.status === "ok") {
    return result.data;
  }
  throw new Error(`lifecycle_transition_apply invoke failed: ${result.error}`);
}

/**
 * List ledger rows. Filter fields default to empty (no constraint).
 */
export async function listLedger(filter: Partial<LedgerFilterDto> = {}): Promise<LedgerRowDto[]> {
  requireRuntime("lifecycleLedgerList");
  const result = await commands.lifecycleLedgerList({
    entityTypes: filter.entityTypes ?? [],
    states: filter.states ?? [],
    projectId: filter.projectId ?? null,
    updatedAfter: filter.updatedAfter ?? null,
    updatedBefore: filter.updatedBefore ?? null,
    limit: filter.limit ?? null,
    offset: filter.offset ?? null,
  });
  if (result.status === "ok") {
    return result.data;
  }
  throw new Error(`lifecycle_ledger_list invoke failed: ${result.error}`);
}

export type { AssetType, LedgerFilterDto, LedgerRowDto };
