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
