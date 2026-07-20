#!/usr/bin/env bash
# Emit a content key for the cached `desktop_shell` E2E binary.
#
# Why this exists
# ---------------
# e2e.yml previously keyed the cached app binary on `hashFiles(..., '**/*.rs',
# ...)` — every Rust file in the workspace. That is correct but far too broad:
# editing a journey under `crates/e2e-tests/` (which is NOT in desktop_shell's
# dependency closure) invalidated the key and forced a full rebuild for a
# byte-identical binary. Measured cost of that needless rebuild: ~340s on
# ubuntu and ~600s on windows.
#
# The obvious fix — hand-maintaining a list of "test-only paths to exclude" —
# is the dangerous kind of optimisation: the first time someone adds a crate
# the list does not know about, CI silently reuses a stale binary and the
# resulting green means nothing. So the key is derived from `cargo metadata`
# instead: we resolve desktop_shell's actual dependency closure and hash the
# sources of exactly those crates. A new dependency is picked up automatically;
# nothing has to be remembered.
#
# Inputs that can change the binary, and are therefore hashed:
#   - every workspace crate in desktop_shell's resolved closure: src/**, build.rs, Cargo.toml
#   - Cargo.lock (dependency versions)
#   - tauri.conf.json + capabilities/** (baked into the binary)
#   - crates/**/migrations/** (embedded via sqlx::migrate!)
#
# Deliberately NOT hashed, because they cannot change the binary:
#   - tests/, benches/, examples/ inside closure crates (separate compilation units)
#   - any crate outside the closure (crates/e2e-tests, dev-only tooling)
#
# Note the nextest archive is a SEPARATE artifact and must keep its own,
# broader key — it genuinely does depend on test sources.
#
# Usage:
#   scripts/e2e-app-cache-key.sh              # print the key
#   scripts/e2e-app-cache-key.sh --self-test  # verify the key reacts correctly
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

closure_files() {
  cargo metadata --format-version 1 2>/dev/null | python3 -c '
import json,os,sys
md=json.load(sys.stdin)
pkgs={p["id"]:p for p in md["packages"]}
res={n["id"]:n for n in md["resolve"]["nodes"]}

target=next((p["id"] for p in md["packages"] if p["name"]=="desktop_shell"), None)
if target is None:
    sys.exit("desktop_shell not found in cargo metadata")

seen=set(); stack=[target]
while stack:
    cur=stack.pop()
    if cur in seen: continue
    seen.add(cur)
    for d in res.get(cur,{}).get("deps",[]):
        stack.append(d["pkg"])

root=os.getcwd()
out=[]
for pid in seen:
    p=pkgs[pid]
    if p.get("source") is not None:      # registry dep: pinned by Cargo.lock, not hashed here
        continue
    d=os.path.dirname(p["manifest_path"])
    if not d.startswith(root):
        continue
    out.append(os.path.relpath(p["manifest_path"], root))
    for sub in ("src",):
        base=os.path.join(d,sub)
        for dirpath,dirnames,filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in ("tests","benches","examples")]
            for f in filenames:
                out.append(os.path.relpath(os.path.join(dirpath,f), root))
    b=os.path.join(d,"build.rs")
    if os.path.exists(b):
        out.append(os.path.relpath(b, root))
print("\n".join(sorted(set(out))))
'
}

extra_files() {
  # Inputs outside the crate sources that are still baked into the binary.
  { echo Cargo.lock
    git ls-files 'apps/desktop/src-tauri/tauri.conf.json' \
                 'apps/desktop/src-tauri/capabilities/*' \
                 'crates/**/migrations/*'
  } 2>/dev/null
}

# Portable across the three runner images: coreutils `sha256sum` exists on
# ubuntu and in Git Bash on windows, but NOT on macOS, which ships `shasum`.
# `xargs -d` is GNU-only and absent from Git Bash, so the file list is fed
# through a plain read loop instead.
_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256
  else echo "no sha256 tool available" >&2; return 1
  fi
}

hash_list() {
  sort -u \
    | while IFS= read -r f; do
        [ -f "$f" ] || continue
        printf '%s  ' "$f"
        _sha256 < "$f"
      done \
    | _sha256 \
    | cut -c1-40
}

# Conservative fallback: hash every tracked Rust source plus the manifests.
# Used when the closure cannot be resolved. It is deliberately BROADER than
# the precise key — the failure mode of a wrong-but-broad key is a needless
# rebuild, whereas a wrong-but-narrow key is a stale binary and a meaningless
# green. Always fail towards rebuilding.
fallback_key() {
  { git ls-files '*.rs' '*/Cargo.toml' 'Cargo.toml'
    extra_files
  } 2>/dev/null | hash_list
}

compute_key() {
  local files
  if ! files=$(closure_files 2>/dev/null) || [ -z "$files" ]; then
    echo "cargo metadata unavailable; falling back to the broad key" >&2
    fallback_key
    return
  fi
  { printf '%s\n' "$files"; extra_files; } | hash_list
}

if [ "${1:-}" != "--self-test" ]; then
  compute_key
  exit 0
fi

# ---- self-test -------------------------------------------------------------
# Two directions, both required. A key that never changes is as broken as one
# that always changes; only checking one direction would miss the failure that
# actually matters (stale binary reused after a real change).
fail=0
base=$(compute_key)
echo "  baseline key: $base"

probe_in_closure="crates/app/core/src/__cache_key_probe.rs"
probe_outside="crates/e2e-tests/tests/__cache_key_probe.rs"
cleanup() { rm -f "$probe_in_closure" "$probe_outside"; }
trap cleanup EXIT

: > "$probe_in_closure"
k=$(compute_key)
if [ "$k" = "$base" ]; then
  echo "  FAIL: key did NOT change when a file inside desktop_shell's closure was added"
  echo "        (this is the dangerous direction: a real code change would reuse a stale binary)"
  fail=1
else
  echo "  ok: key changes for a source file inside the closure"
fi
rm -f "$probe_in_closure"

: > "$probe_outside"
k=$(compute_key)
if [ "$k" != "$base" ]; then
  echo "  FAIL: key changed for crates/e2e-tests, which is not in the closure"
  echo "        (harmless but defeats the entire point of the split)"
  fail=1
else
  echo "  ok: key is stable for test-only crates outside the closure"
fi
rm -f "$probe_outside"

k=$(compute_key)
if [ "$k" != "$base" ]; then
  echo "  FAIL: key is not reproducible — got $k, expected $base"
  fail=1
else
  echo "  ok: key is reproducible"
fi

[ "$fail" = 0 ] && echo "  self-test passed" || echo "  self-test FAILED"
exit "$fail"
