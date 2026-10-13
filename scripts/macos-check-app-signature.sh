#!/usr/bin/env bash
# Prints how the macOS .app that the Tauri bundler just built is signed, and
# checks it. Called by the macOS build leg in .github/workflows/release-please.yml
# after tauri-action, from the repository root.
#
# Usage: scripts/macos-check-app-signature.sh [PATH/TO/App.app]
# Without an argument it looks for the one .app under target/**/release/bundle/macos.
#
# When APPLE_SIGNING_IDENTITY is set in the environment (the self-signed import
# step exports it through GITHUB_ENV), the bundle must carry that identity as
# its first Authority, must not be ad-hoc signed, and must pass
# `codesign --verify --strict`. Without it, an ad-hoc bundle is only reported:
# that is the expected result while the signing secrets are absent, and failing
# here would hold back latest.json for every platform. Any other signature is
# still verified strictly.
set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [PATH/TO/App.app]" >&2
  exit 2
fi
if [ "$#" -eq 1 ]; then
  app="$1"
else
  shopt -s nullglob
  apps=(target/release/bundle/macos/*.app target/*/release/bundle/macos/*.app)
  if [ "${#apps[@]}" -ne 1 ]; then
    echo "::error::expected one .app under target/**/release/bundle/macos, found ${#apps[@]}: ${apps[*]:-none}"
    exit 1
  fi
  app="${apps[0]}"
fi
if [ ! -d "${app}" ]; then
  echo "::error::${app} is not an app bundle"
  exit 1
fi

details="$(codesign -dv --verbose=2 "${app}" 2>&1)"
echo "codesign -dv ${app}:"
printf '%s\n' "${details}" | grep -E '^(Identifier|Format|Signature|Authority|TeamIdentifier|Runtime Version|CodeDirectory)' || true
echo "Designated requirement:"
codesign -d -r- "${app}" 2>&1 | sed -n 's/^designated => /  /p'

adhoc=false
if printf '%s\n' "${details}" | grep -q '^Signature=adhoc'; then
  adhoc=true
fi

expected="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "${expected}" ]; then
  if [ "${adhoc}" = true ]; then
    echo "::notice::${app} is ad-hoc signed; no signing identity was imported."
    exit 0
  fi
  codesign --verify --strict --verbose=2 "${app}"
  exit 0
fi

if [ "${adhoc}" = true ]; then
  echo "::error::the self-signed identity '${expected}' was imported, but ${app} is ad-hoc signed"
  exit 1
fi
authority="$(printf '%s\n' "${details}" | sed -n 's/^Authority=//p' | head -n 1)"
if [ "${authority}" != "${expected}" ]; then
  echo "::error::${app} is signed by '${authority:-nobody}', expected '${expected}'"
  exit 1
fi
codesign --verify --strict --verbose=2 "${app}"
echo "${app} is signed by '${authority}'."
