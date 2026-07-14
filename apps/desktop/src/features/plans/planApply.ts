// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plan-apply IPC helper (spec 037 caller migration).
 *
 * Bridges the optional `onEvent` subscriber onto the `tauri::ipc::Channel`
 * required by the generated `commands.plansApplyReal` signature (spec 042 US16,
 * T240) and unwraps the generated `Result` into the throw-on-error contract.
 *
 * This glue previously lived in the hand-written `@/api/commands` wrapper; it is
 * moved here (not dropped — FR-004) so the call site uses the generated binding
 * directly while keeping the Channel-bridging behaviour.
 */

import { Channel } from '@tauri-apps/api/core';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { OperationEvent, PlanApplyResponse } from '@/bindings/index';

export async function applyPlan(args: {
  id: string;
  approvalToken?: string;
  /**
   * Optional live long-operation subscriber. When supplied, the backend streams
   * `OperationEvent`s over the channel: a `Started` event, per-item
   * `progress`/`item_applied`/`item_failed` events, then a terminal
   * `completed`/`failed` event. The durable DB audit trail is unaffected — the
   * channel is the live UI projection only.
   */
  onEvent?: (event: OperationEvent) => void;
}): Promise<PlanApplyResponse> {
  const channel = new Channel<OperationEvent>();
  if (args.onEvent) {
    const handler = args.onEvent;
    channel.onmessage = (event) => handler(event);
  }
  // `plansApplyReal(planId, approvalToken, onEvent)` requires a token; when
  // absent we default to '' which the backend rejects — the real flow supplies
  // the token from `plansApprove.approvalToken`.
  return unwrap(
    await commands.plansApplyReal(args.id, args.approvalToken ?? '', channel),
  );
}
