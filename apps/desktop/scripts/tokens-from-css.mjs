#!/usr/bin/env node
// tokens-from-css.mjs — ONE-TIME migration: tokens.css -> DTCG token sources.
//
// Kept in the repo after the migration as the audit trail for how the DTCG
// sources were derived. It is not part of the build; `build-tokens.mjs` runs
// the other direction (DTCG -> CSS) and is the thing wired into CI.
//
// Comments in tokens.css are load-bearing (measured rationales, issue refs),
// so a preceding comment block is captured as the token's `$description` and
// re-emitted as a comment by the CSS build. Losing them would delete the
// reasoning behind values like --pv-sidebar-width (#962) or --pv-control-h (#616).
//
// Usage: node apps/desktop/scripts/tokens-from-css.mjs [--out apps/desktop/tokens]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'apps/desktop/src/styles/tokens.css';
const outArg = process.argv.indexOf('--out');
const OUT = outArg === -1 ? 'apps/desktop/tokens' : process.argv[outArg + 1];

const css = readFileSync(SRC, 'utf8');

// tokens.css is now an OUTPUT of build-tokens.mjs. Re-running this converter
// against a generated file would parse the build's own output back into the
// sources it was built from — silently flattening the semantic tier (every
// alias resolved to a literal) and losing any block the emitter doesn't
// reproduce. This is a one-way migration tool; refuse to eat its own tail.
if (css.includes('AUTO-GENERATED')) {
  console.error(
    `ERROR: ${SRC} is already generated. This converter only runs against the\n` +
      'hand-written original — recover it with `git show <pre-migration-ref>:' +
      `${SRC}` +
      '` if you need to re-run the migration.',
  );
  process.exit(1);
}

/** DTCG $type inferred from the value. Only the types we actually use. */
function inferType(value) {
  if (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/i.test(value)) return 'color';
  if (/^-?[\d.]+px$/.test(value)) return 'dimension';
  return undefined; // shadows, font stacks, var() aliases: left untyped
}

/**
 * `var(--pv-x)` -> DTCG alias `{x}`, including references embedded inside a
 * composite value (e.g. `0 0 0 2px var(--pv-accent)` for --pv-focus-ring).
 * Missing the embedded case would freeze that reference as a literal colour,
 * so the focus ring would stop following the active theme's accent.
 */
function toDtcgValue(raw) {
  return raw.trim().replace(/var\(\s*--pv-([a-z0-9-]+)\s*\)/g, '{$1}');
}

/**
 * Walk a block body, pairing each declaration with the comment block that
 * immediately precedes it (if any). Declarations sharing a line (this file
 * packs several per line) inherit the line's leading comment.
 */
function parseBlock(body) {
  const tokens = {};
  let pendingComment = null;

  // Split into comments and declarations, preserving order.
  const parts = body.split(/(\/\*[\s\S]*?\*\/)/);
  for (const part of parts) {
    if (part.startsWith('/*')) {
      pendingComment = part
        .replace(/^\/\*+/, '')
        .replace(/\*+\/$/, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\*?\s?/, '').trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      continue;
    }
    let sawDecl = false;
    for (const m of part.matchAll(/--pv-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      const [, name, rawValue] = m;
      const value = toDtcgValue(rawValue);
      const type = inferType(value);
      tokens[name] = {
        $value: value,
        ...(type ? { $type: type } : {}),
        ...(!sawDecl && pendingComment ? { $description: pendingComment } : {}),
      };
      sawDecl = true;
    }
    if (sawDecl) pendingComment = null;
  }
  return tokens;
}

/**
 * Extract every top-level rule as { selector, body }.
 * Must match single-line rules too — the density blocks are written as
 * `.density-compact { --pv-row-height: 24px; }` on one line, and an earlier
 * newline-anchored version of this regex dropped them silently.
 */
function parseRules(source) {
  // Anchor at-rule stripping to line starts. An unanchored `@import[^;]*;`
  // also matches the word "@import" inside a prose comment ("replaces the
  // prior Google Fonts CDN @import ...") and then eats everything up to the
  // next semicolon — which silently deleted the entire semantic block.
  const withoutAtRules = source
    .replace(/^@font-face\s*\{[^}]*\}/gm, '')
    .replace(/^@import[^;]*;/gm, '');
  const rules = [];
  for (const m of withoutAtRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // A rule's captured "selector" also swallows any comment sitting above it
    // (e.g. `/* Density modifiers */ .density-compact`), so strip those first.
    const selector = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    rules.push({ selector, body: m[2] });
  }
  return rules;
}

const rules = parseRules(css);
mkdirSync(join(OUT, 'themes'), { recursive: true });
mkdirSync(join(OUT, 'density'), { recursive: true });

let semanticCount = 0;
const themeCounts = {};
const densityCounts = {};

for (const { selector, body } of rules) {
  const tokens = parseBlock(body);
  if (Object.keys(tokens).length === 0) continue;

  // The bare `:root` block holds semantic aliases + theme-invariant metrics.
  if (selector === ':root') {
    writeFileSync(join(OUT, 'semantic.json'), `${JSON.stringify(tokens, null, 2)}\n`);
    semanticCount = Object.keys(tokens).length;
    continue;
  }

  // Density is a third axis, orthogonal to theme: `.density-compact` etc.
  const density = /^\.density-([a-z-]+)$/.exec(selector);
  if (density) {
    writeFileSync(
      join(OUT, 'density', `${density[1]}.json`),
      `${JSON.stringify(tokens, null, 2)}\n`,
    );
    densityCounts[density[1]] = Object.keys(tokens).length;
    continue;
  }

  // Every other block is one theme's raw palette. Warm Slate is declared as
  // `:root, [data-theme="warm-slate"]` so the default light palette has a
  // single source of truth; it is stored as a normal theme and the build
  // re-emits the dual selector.
  const ids = [...selector.matchAll(/\[data-theme="([a-z-]+)"\]/g)].map((m) => m[1]);
  if (ids.length === 0) {
    console.error(`ERROR: unrecognised selector "${selector}" — it would be dropped silently.`);
    process.exit(1);
  }
  for (const id of ids) {
    writeFileSync(join(OUT, 'themes', `${id}.json`), `${JSON.stringify(tokens, null, 2)}\n`);
    themeCounts[id] = Object.keys(tokens).length;
  }
}

// Completeness invariant. Every `--pv-*` declaration in the source must land in
// exactly one output file. Without this, a parsing slip (a regex eating a
// block, an unmatched selector shape) drops tokens silently and the generated
// CSS just quietly lacks them. Counted against the source text, not the parse.
const declaredInSource = [
  ...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--pv-[a-z0-9-]+\s*:/g),
].length;
const captured =
  semanticCount +
  Object.values(themeCounts).reduce((a, b) => a + b, 0) +
  Object.values(densityCounts).reduce((a, b) => a + b, 0);
if (captured !== declaredInSource) {
  console.error(
    `ERROR: ${declaredInSource} --pv-* declarations in ${SRC} but ${captured} captured — ` +
      `${declaredInSource - captured} would be lost.`,
  );
  process.exit(1);
}

console.log(`semantic.json: ${semanticCount} tokens`);
for (const [id, n] of Object.entries(themeCounts)) console.log(`themes/${id}.json: ${n} tokens`);
for (const [id, n] of Object.entries(densityCounts)) console.log(`density/${id}.json: ${n} tokens`);

// Every theme must carry the same key set, or a theme is silently missing a
// token and the CSS cascade would fall back to Warm Slate's value at runtime.
const keySets = Object.entries(themeCounts);
const sizes = new Set(keySets.map(([, n]) => n));
if (keySets.length === 0) {
  console.error('ERROR: no theme blocks parsed — the tokens.css shape changed.');
  process.exit(1);
}
if (sizes.size > 1) {
  console.error(`ERROR: themes disagree on token count: ${JSON.stringify(themeCounts)}`);
  process.exit(1);
}
console.log(`OK: ${keySets.length} themes, ${[...sizes][0]} tokens each`);
