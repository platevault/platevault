#!/usr/bin/env python3

# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only

"""Remove stale relative-path speckit-dag-hooks dispatcher hooks left in
.claude/settings.json by the 0.3.2->0.4.1 reinstall (apm added the new anchored
entries but did not prune the old relative ones). Keep the anchored entries and
every other hook untouched."""
import json
import sys

PATH = ".claude/settings.json"
with open(PATH, encoding="utf-8") as fh:
    data = json.load(fh)


def is_stale(hook):
    cmd = hook.get("command", "") if isinstance(hook, dict) else ""
    return (
        "speckit-dag-hooks/scripts/dispatcher.py" in cmd
        and "${CLAUDE_PROJECT_DIR}" not in cmd
    )


removed = 0
hooks_root = data.get("hooks", {})
for event, matchers in list(hooks_root.items()):
    if not isinstance(matchers, list):
        continue
    new_matchers = []
    for m in matchers:
        inner = m.get("hooks") if isinstance(m, dict) else None
        if isinstance(inner, list):
            kept = [h for h in inner if not is_stale(h)]
            removed += len(inner) - len(kept)
            m["hooks"] = kept
            if not kept:
                # drop matcher-object whose only hook was the stale one
                continue
        new_matchers.append(m)
    hooks_root[event] = new_matchers

with open(PATH, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")

print("removed %d stale relative hook(s)" % removed)
