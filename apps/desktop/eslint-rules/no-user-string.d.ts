// Minimal ambient types for the local ESLint plugin so the rule's vitest test
// (src/lib/no-user-string.rule.test.ts) type-checks. The rule itself is plain
// ESLint JS; ESLint consumes it untyped at lint time.
import type { ESLint } from 'eslint';
declare const plugin: ESLint.Plugin;
export default plugin;
