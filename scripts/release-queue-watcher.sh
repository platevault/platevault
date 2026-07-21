#!/usr/bin/env bash
set -Eeuo pipefail

# Durable, diff-only release-queue watcher. It deliberately does not merge,
# close, rebase, push, or otherwise mutate GitHub or Beads state.

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
interval_seconds=${ASTRO_PLAN_WATCH_INTERVAL_SECONDS:-300}
state_dir=${ASTRO_PLAN_WATCH_STATE_DIR:-${TMPDIR:-/tmp}/astro-plan-release-watcher}
state_file="$state_dir/state.json"
events_file="$state_dir/events.jsonl"
lock_dir="$state_dir/lock"
pid_file="$state_dir/pid"

mkdir -p "$state_dir"

if ! mkdir "$lock_dir" 2>/dev/null; then
  if [[ -f "$pid_file" ]] && kill -0 "$(<"$pid_file")" 2>/dev/null; then
    exit 0
  fi
  rmdir "$lock_dir"
  mkdir "$lock_dir"
fi

cleanup() {
  rm -f "$pid_file"
  rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
printf '%s\n' "$$" >"$pid_file"

require_commands() {
  command -v gh >/dev/null
  command -v bd >/dev/null
  command -v jq >/dev/null
  command -v sha256sum >/dev/null
}

snapshot() {
  local prs beads
  prs=$(gh pr list --repo platevault/platevault --state open --limit 100 \
    --json number,title,baseRefName,headRefOid,mergeStateStatus,statusCheckRollup \
    | jq -c 'sort_by(.number) | map({number,title,baseRefName,headRefOid,mergeStateStatus,checks:([.statusCheckRollup[]|{name,status,conclusion}]|sort_by(.name))})')
  beads=$(
    cd "$repo_root"
    BD_NO_PAGER=1 BD_NON_INTERACTIVE=1 \
      bd ready --label agent:integrator --unassigned --json
  )
  jq -cn --argjson prs "$prs" --argjson beads "$beads" \
    '{prs:$prs,integrator_queue:$beads}'
}

require_commands
cd "$repo_root"

while :; do
  current=$(snapshot)
  digest=$(printf '%s' "$current" | sha256sum | awk '{print $1}')
  previous_digest=''
  if [[ -f "$state_file" ]]; then
    previous_digest=$(jq -r '.digest // empty' "$state_file" 2>/dev/null || true)
  fi
  if [[ -n "$previous_digest" && "$digest" != "$previous_digest" ]]; then
    jq -cn --arg observed_at "$(date -Is)" --arg digest "$digest" \
      --arg previous_digest "$previous_digest" --argjson snapshot "$current" \
      '{observed_at:$observed_at,digest:$digest,previous_digest:$previous_digest,snapshot:$snapshot}' >>"$events_file"
  fi
  jq -cn --arg observed_at "$(date -Is)" --arg digest "$digest" \
    --argjson snapshot "$current" \
    '{observed_at:$observed_at,digest:$digest,snapshot:$snapshot}' >"$state_file"
  if [[ "${ASTRO_PLAN_WATCH_ONCE:-0}" == "1" ]]; then
    exit 0
  fi
  sleep "$interval_seconds"
done
