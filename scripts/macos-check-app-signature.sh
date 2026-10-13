#!/usr/bin/env bash
# Prints how the macOS .app that the Tauri bundler just built is signed, and
# checks it. Called by the macOS build leg in .github/workflows/release-please.yml
# after tauri-action, from the repository root.
#
# When APPLE_SIGNING_IDENTITY is set in the environment (the self-signed import
# step exports it through GITHUB_ENV), the bundle must carry that identity as
# its first Authority and must not be ad-hoc signed. Otherwise the script only
# reports the signature, which is ad-hoc unless Developer ID signing is on.
set -euo pipefail

shopt -s nullglob
apps=(target/release/bundle/macos/*.app target/*/release/bundle/macos/*.app)
if [ "${#apps[@]}" -ne 1 ]; then
  echo "::error::expected one .app under target/**/release/bundle/macos, found ${#apps[@]}: ${apps[*]:-none}"
  exit 1
fi
app="${apps[0]}"

details="$(codesign -dv --verbose=2 "${app}" 2>&1)"
echo "codesign -dv ${app}:"
printf '%s\n' "${details}" | grep -E '^(Identifier|Format|Signature|Authority|TeamIdentifier|Runtime Version|CodeDirectory)' || true
echo "Designated requirement:"
codesign -d -r- "${app}" 2>&1 | sed -n 's/^designated => /  /p'
codesign --verify --strict --verbose=2 "${app}"

expected="${APPLE_SIGNING_IDENTITY:-}"
if [ -z "${expected}" ]; then
  exit 0
fi
if printf '%s\n' "${details}" | grep -q '^Signature=adhoc'; then
  echo "::error::the self-signed identity '${expected}' was imported, but ${app} is ad-hoc signed"
  exit 1
fi
authority="$(printf '%s\n' "${details}" | sed -n 's/^Authority=//p' | head -n 1)"
if [ "${authority}" != "${expected}" ]; then
  echo "::error::${app} is signed by '${authority:-nobody}', expected '${expected}'"
  exit 1
fi
echo "${app} is signed by '${authority}'."
