// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wait for an async mock to be called, or fail saying so.
 *
 * Replaces four identical copies that polled `setTimeout(0)` fifty times and
 * then RETURNED NORMALLY on timeout. That failed open twice over:
 *
 *   1. The timeout surfaced downstream as `expect(mock).toHaveBeenCalledWith(...)`
 *      reporting "Number of calls: 0", which reads like the code never fired the
 *      write rather than like the test gave up waiting for it.
 *   2. The call was still in flight. It landed during the NEXT test, whose
 *      `beforeEach` had just reset the mock — so a test asserting the write is
 *      skipped saw one call and failed too. One slow write, two confusing
 *      failures, neither pointing at the timeout.
 *
 * Fifty ticks is also the wrong budget: the code under test resolves three
 * dynamic imports before it calls anything, and `vi.resetModules()` in
 * `beforeEach` makes every test re-resolve that graph. Under load — the whole
 * suite running, not just this file — that regularly exceeds fifty ticks, which
 * is why this only ever failed in a full run.
 *
 * A wall-clock deadline is therefore the right budget, and a timeout is an
 * error rather than a silent return.
 */
export async function waitForCall(
  fn: { mock: { calls: unknown[][] } },
  {
    timeoutMs = 2000,
    label = 'mock',
  }: { timeoutMs?: number; label?: string } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(
    `waitForCall: ${label} was not called within ${timeoutMs}ms. The write is ` +
      `likely still in flight — it will land in the next test and fail that one ` +
      `instead. Raise the budget or await the work directly.`,
  );
}
