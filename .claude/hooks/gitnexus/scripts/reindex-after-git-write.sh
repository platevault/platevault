#!/usr/bin/env bash
# PostToolUse hook (matcher: Bash): refresh the GitNexus graph after a git
# commit/merge/push mutates history. Fires the reindex in the background so
# the agent never waits on it; a lock file collapses concurrent triggers.
#
# Worktree note: `gitnexus analyze` and the graph live in the PRIMARY checkout
# (.gitnexus/ at the main repo root). Worktrees share that graph via the
# hook's walk-up discovery only when nested under the repo root, so we always
# reindex the primary checkout regardless of where the commit happened.
set -euo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || true)

case "$CMD" in
  *"git commit"*|*"git merge"*|*"git push"*|*"gh pr merge"*) ;;
  *) exit 0 ;;
esac

command -v gitnexus >/dev/null 2>&1 || exit 0

PRIMARY="/Users/sjors/personal/dev/platevault"
LOCK="$PRIMARY/.gitnexus/reindex.lock"
[ -d "$PRIMARY/.gitnexus" ] || exit 0

# Debounce: skip if a reindex ran in the last 120s or one is in flight.
if [ -f "$LOCK" ]; then
  age=$(( $(date +%s) - $(stat -f %m "$LOCK" 2>/dev/null || echo 0) ))
  [ "$age" -lt 120 ] && exit 0
fi
touch "$LOCK"

nohup sh -c "cd '$PRIMARY' && gitnexus analyze >/dev/null 2>&1; rm -f '$LOCK'" >/dev/null 2>&1 &
exit 0
