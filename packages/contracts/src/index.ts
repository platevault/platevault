export type {
  AlmClient,
  AlmClientOptions,
  AlmCancellationSignal,
  AlmTransport,
  ExecuteOperationOptions,
  ResponseEnvelope,
  SubscribeOperationOptions,
  TypedOkResponseEnvelope,
  TypedRequestEnvelope,
} from "./client";
export { AlmContractError, createAlmClient } from "./client";

export type * from "./generated/envelope";

// Spec 002 — Data Lifecycle State Model. Namespaced re-export because the
// `lifecycle.transition` and `provenance.read` schemas share generic names
// (`Request`, `Response`, `ErrorCode`, `Timestamp`, `Uuid`, …) at the top
// level after json2ts; the namespace keeps callers explicit.
export type * as LifecycleTransition from "./generated/lifecycle.transition";
export type * as ProvenanceRead from "./generated/provenance.read";

// Spec 004 — Native Filesystem Controls.
export type * as NativeDirectoryPick from "./generated/native.directory.pick";
export type * as NativeFilePick from "./generated/native.file.pick";
export type * as NativeReveal from "./generated/native.reveal";

// Spec 022 — Desktop theme mode (theme.get / theme.set).
export type * as ThemeGet from "./generated/theme.get";
export type * as ThemeSet from "./generated/theme.set";
