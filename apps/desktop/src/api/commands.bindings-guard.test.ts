/**
 * IPC conformance guard for the hand-written wrappers in `commands.ts`.
 *
 * These wrappers call `invoke('<name>', <payload>)` with hand-written command
 * names and payload shapes. The generated tauri-specta bindings
 * (`bindings/index.ts`) are the AUTHORITATIVE source of what the real backend
 * accepts. Two whole classes of bug have shipped because the wrappers drifted
 * from the bindings and mock mode hid it:
 *
 *   1. Dotted / renamed / typo'd command names → "command not found" on the
 *      real backend (e.g. `target.get` instead of `target_get`).
 *   2. snake_case payload keys the camelCase backend rejects (e.g. `scan_depth`
 *      instead of `scanDepth`), making the whole arg fail to deserialize.
 *
 * This test fails CI on both, so the next drift is caught on Linux instead of
 * during a manual Windows session.
 *
 * NOTE: the payload-casing check only covers INLINE object literals passed to
 * invoke(). Pass-through payloads (`invoke('x', args)`) are not statically
 * inspectable here — the durable fix for those is the generated-bindings
 * migration (see docs/development/ipc-wrapper-migration.md).
 */
import { describe, it, expect } from 'vitest';
// Vite `?raw` string imports (typed via vite/client) — avoids node:fs so this
// typechecks without @types/node.
import commandsSrc from './commands.ts?raw';
import bindingsSrc from '../bindings/index.ts?raw';

/** All command names the generated bindings actually register. */
function registeredCommands(): Set<string> {
  const names = new Set<string>();
  const re = /__TAURI_INVOKE\(\s*"([a-zA-Z0-9_.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bindingsSrc)) !== null) names.add(m[1]);
  return names;
}

/** Every `invoke<...>('name', ...)` call site in commands.ts. */
function invokedCommands(): string[] {
  const names: string[] = [];
  const re = /\binvoke<[^>]*>\(\s*'([a-zA-Z0-9_.]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(commandsSrc)) !== null) names.push(m[1]);
  return names;
}

/**
 * Spans of text that are the argument list of each `invoke<...>(...)` call,
 * with the leading command-string literal stripped. Used to scan inline
 * payload object literals for snake_case keys.
 */
function invokeArgSpans(): string[] {
  const spans: string[] = [];
  const re = /\binvoke<[^>]*>\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(commandsSrc)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1; // at the '('
    const start = i + 1;
    for (; i < commandsSrc.length; i++) {
      const c = commandsSrc[i];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    spans.push(commandsSrc.slice(start, i));
  }
  return spans;
}

describe('commands.ts IPC conformance guard', () => {
  // spec-021 dev-tools commands are compile-time gated behind the `dev-tools`
  // cargo feature (default off), so they are intentionally absent from the
  // default generated bindings. They are still real commands in dev builds.
  const FEATURE_GATED = /^dev_/;

  it('every invoked command name is registered in the generated bindings', () => {
    const registered = registeredCommands();
    expect(registered.size).toBeGreaterThan(50); // sanity: bindings parsed
    const unknown = [...new Set(invokedCommands())]
      .filter((n) => !FEATURE_GATED.test(n))
      .filter((n) => !registered.has(n));
    expect(unknown, `unknown/unregistered command names in commands.ts: ${unknown.join(', ')}`).toEqual(
      [],
    );
  });

  it('no dotted command names are invoked (must be snake_case)', () => {
    const dotted = [...new Set(invokedCommands())].filter((n) => n.includes('.'));
    expect(dotted, `dotted command names (use snake_case): ${dotted.join(', ')}`).toEqual([]);
  });

  it('no snake_case keys in inline invoke() payload literals', () => {
    // Object-literal key like `scan_depth:` (allow optional `?`). The backend is
    // camelCase, so any underscore key in a payload is a bug.
    const keyRe = /\b([a-z][a-zA-Z0-9]*_[a-zA-Z0-9_]*)\??\s*:/g;
    const offenders: string[] = [];
    for (const span of invokeArgSpans()) {
      let m: RegExpExecArray | null;
      while ((m = keyRe.exec(span)) !== null) offenders.push(m[1]);
    }
    expect(
      [...new Set(offenders)],
      `snake_case keys in inline invoke payloads (use camelCase): ${[...new Set(offenders)].join(', ')}`,
    ).toEqual([]);
  });
});
