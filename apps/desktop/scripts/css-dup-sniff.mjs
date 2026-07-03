#!/usr/bin/env node
// CSS duplicate-declaration-block sniffer.
//
// Usage: node scripts/css-dup-sniff.mjs [path-to-css ...]
// Defaults to src/styles/components.css (the barrel file) when no path is
// given.
//
// Parses top-level `selector { body }` rules, normalises each body (sorted,
// whitespace-collapsed declarations), and groups rules with identical bodies.
// Reports component-clone groups (>=5 decls, the "per-feature clone" shape the
// project mandate bans) and utility-pattern groups (<5 decls, >=2 copies,
// candidates for a shared `.alm-*` utility class). Used to measure CSS dedup
// progress (see CLAUDE.md: "one parameterised component + one CSS class,
// never per-feature clones").
//
// `@import './x.css';` statements are resolved and inlined recursively
// (relative to the importing file), so pointing this at the barrel file
// analyses the whole component stylesheet, not just the barrel's own
// (empty) top level. Diamond imports are only inlined once per run.
//
// Known limitation: rules nested inside `@media` / other at-rule blocks are
// NOT analysed (only true top-level rules are). This project has a handful
// of small responsive `@media` overrides; if that grows, extend the parser
// to descend into `@media` bodies as an additional top-level scope.
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

const IMPORT_RE = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\)?[^;]*;/g;

function readCss(filePath, visited) {
  const abs = resolvePath(filePath);
  if (visited.has(abs)) return '';
  visited.add(abs);

  const dir = dirname(abs);
  const raw = readFileSync(abs, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  return raw.replace(IMPORT_RE, (_match, importPath) =>
    readCss(resolvePath(dir, importPath), visited),
  );
}

const argPaths = process.argv.slice(2);
const paths = argPaths.length > 0 ? argPaths : ['src/styles/components.css'];
const visited = new Set();
const src = paths.map((p) => readCss(p, visited)).join('\n');

const rules = [];
let depth = 0, tokenStart = 0, selector = '', bodyStart = 0;
for (let i = 0; i < src.length; i++) {
  const ch = src[i];
  if (ch === '{') {
    if (depth === 0) { selector = src.slice(tokenStart, i).trim(); bodyStart = i + 1; }
    depth++;
  } else if (ch === '}') {
    depth--;
    if (depth === 0) {
      const body = src.slice(bodyStart, i);
      if (!selector.startsWith('@')) rules.push([selector, body]);
      tokenStart = i + 1;
    }
  }
}
const norm = (b) =>
  b.split(';').map((d) => d.replace(/\s+/g, ' ').trim())
   .filter((d) => d && !d.includes('{') && !d.includes('}')).sort().join(';');
// Collapse newlines/indentation in multi-line comma selector lists so report
// lines stay readable (cosmetic only; grouping key is the declaration body).
const flattenSelector = (s) => s.replace(/\s+/g, ' ').trim();

const groups = new Map();
for (const [s, b] of rules) {
  const nb = norm(b);
  if (!nb) continue;
  (groups.get(nb) || groups.set(nb, []).get(nb)).push(flattenSelector(s));
}
const comp = [], util = [];
for (const [nb, sels] of groups) {
  if (sels.length < 2) continue;
  const decls = nb.split(';').length;
  (decls >= 5 ? comp : util).push([sels.length, decls, nb, sels]);
}
comp.sort((a, b) => b[0] - a[0]); util.sort((a, b) => b[0] - a[0]);
console.log(`Total top-level rules: ${rules.length}`);
console.log(`Component-clone groups (>=5 decls): ${comp.length}`);
console.log(`Utility-pattern groups (<5 decls, >=2 copies): ${util.length}`);
console.log(`Utility groups with >=4 copies: ${util.filter((u) => u[0] >= 4).length}\n`);
console.log('== COMPONENT CLONES ==');
for (const [c, d, , sels] of comp) console.log(`[${c}x ${d}d] ${sels.join('  ')}`);
console.log('\n== UTILITY PATTERNS (>=4 copies) ==');
for (const [c, d, nb, sels] of util) if (c >= 4) console.log(`[${c}x ${d}d] ${nb.slice(0, 80)}\n    ${sels.join('  ')}`);
