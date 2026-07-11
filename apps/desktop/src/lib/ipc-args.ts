/**
 * Cast a request object to a generated `commands.*` binding's parameter type.
 *
 * A handful of call sites build a request whose STATIC type is wider than
 * what a specific tauri-specta binding accepts — e.g. the `Serialize |
 * Deserialize` convenience union tauri-specta emits for round-trippable DTOs,
 * or a request the binding's generated tagged-union parameter shape doesn't
 * structurally match (see `features/projects/lifecycleTransition.ts`'s
 * `applyProjectLifecycleTransition` for the documented case). The request is
 * the wire-format truth in every one of these cases; this cast is required,
 * not a type-safety hole being papered over.
 *
 * `Parameters<typeof commands.foo>[0]` pins the cast target to `foo`'s
 * CURRENT signature, so a future rename or signature change on the binding
 * still surfaces as a type error at the call site instead of silently
 * compiling.
 */
export function ipcArgs<F extends (...args: never[]) => unknown>(
  req: unknown,
): Parameters<F>[0] {
  return req as Parameters<F>[0];
}
