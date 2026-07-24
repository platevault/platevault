---
paths:
  - "**/*"
---

# GitNexus — Code Intelligence

This repo is indexed by GitNexus (MCP server `gitnexus`; graph in `.gitnexus/`,
auto-refreshed after commits by a PostToolUse hook). Reach for it BEFORE
grep/read when the question is structural.

Always:

- Before modifying a function, class, or method, run
  `impact({target, direction: "upstream"})` and account for the blast radius
  (direct callers, affected flows, risk level). Warn the user on HIGH/CRITICAL.
- When exploring unfamiliar code, use `query({search_query})` first — it
  returns execution-flow-grouped results; fall back to `rg` only for exact
  text/path lookups.
- For a symbol's callers/callees/flows use `context({name})`; to connect two
  points use `trace`.
- Before committing, `detect_changes()` to confirm only expected symbols and
  flows changed (`{scope: "compare", base_ref: "main"}` for branch review).
- Rename symbols with `rename` (call-graph aware), never find-and-replace.

Worktree caveat: the graph lives in the primary checkout only; in disposable
worktrees the MCP tools answer from the primary's graph (near-main is fine for
architecture questions) and the enrichment hook no-ops.

Stale index? `gitnexus analyze` from the repo root (~100s).
