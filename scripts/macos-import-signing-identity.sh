#!/usr/bin/env bash
# Imports PlateVault's self-signed macOS code signing identity on a CI runner
# and tells the Tauri bundler to sign with it. Called by the macOS build leg in
# .github/workflows/release-please.yml.
#
# Inputs (environment):
#   MACOS_SELF_SIGNED_P12           secret: base64 of the .p12 that
#                                   scripts/macos-signing-identity-create.sh made
#   MACOS_SELF_SIGNED_P12_PASSWORD  secret: its password
#   MACOS_SIGNING_IDENTITY          variable: the certificate's common name,
#                                   "PlateVault Self-Signed"
#   RUNNER_TEMP, GITHUB_ENV         set by GitHub Actions
#
# With both secrets empty it does nothing, and the bundler keeps ad-hoc
# signing. With only one secret set, or no MACOS_SIGNING_IDENTITY, it fails.
# Otherwise it:
#   1. creates a keychain under RUNNER_TEMP with a random password, imports the
#      .p12 into it for /usr/bin/codesign, and adds it to the search list,
#      because the bundler runs `codesign -s <identity>` without --keychain;
#   2. marks the certificate as trusted for code signing (admin trust domain,
#      on this throwaway runner only). codesign answers "no identity found"
#      for an untrusted self-signed identity;
#   3. checks that the keychain now holds exactly one valid code signing
#      identity named MACOS_SIGNING_IDENTITY;
#   4. writes APPLE_SIGNING_IDENTITY=<that name> to GITHUB_ENV, so the later
#      tauri-action step signs with it.
#
# It deliberately sets neither APPLE_CERTIFICATE nor any notarization
# variable: the bundler's own APPLE_CERTIFICATE import only accepts Apple
# certificate names (Developer ID Application:, Apple Development:, ...), and
# without APPLE_ID or APPLE_API_KEY the bundler skips notarization.
set -euo pipefail

p12_b64="${MACOS_SELF_SIGNED_P12:-}"
p12_password="${MACOS_SELF_SIGNED_P12_PASSWORD:-}"
identity="${MACOS_SIGNING_IDENTITY:-}"

if [ -z "${p12_b64}" ] && [ -z "${p12_password}" ]; then
  echo "::notice::MACOS_SELF_SIGNED_P12 is not set; the macOS build stays ad-hoc signed."
  exit 0
fi
if [ -z "${p12_b64}" ] || [ -z "${p12_password}" ]; then
  echo "::error::Set both MACOS_SELF_SIGNED_P12 and MACOS_SELF_SIGNED_P12_PASSWORD, or neither."
  exit 1
fi
if [ -z "${identity}" ]; then
  echo "::error::MACOS_SELF_SIGNED_P12 is set but the MACOS_SIGNING_IDENTITY variable is empty."
  exit 1
fi

: "${RUNNER_TEMP:?RUNNER_TEMP is not set}"
: "${GITHUB_ENV:?GITHUB_ENV is not set}"

umask 077
work="$(mktemp -d "${RUNNER_TEMP}/macos-identity.XXXXXX")"
trap 'rm -rf -- "${work}"' EXIT
keychain="${RUNNER_TEMP}/platevault-signing.keychain-db"
keychain_password="$(openssl rand -hex 32)"

printf '%s' "${p12_b64}" | base64 --decode > "${work}/identity.p12"

security create-keychain -p "${keychain_password}" "${keychain}"
security set-keychain-settings -lut 21600 "${keychain}"
security unlock-keychain -p "${keychain_password}" "${keychain}"
security import "${work}/identity.p12" -k "${keychain}" -f pkcs12 \
  -P "${p12_password}" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "${keychain_password}" "${keychain}" >/dev/null

# Keep the existing keychains searchable and put this one first.
existing=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#\"}"
  line="${line%\"}"
  if [ -n "${line}" ]; then existing+=("${line}"); fi
done < <(security list-keychains -d user)
security list-keychains -d user -s "${keychain}" "${existing[@]}"

# The .p12 holds exactly one certificate; take it back out of the keychain.
security find-certificate -a -p "${keychain}" > "${work}/cert.pem"
if [ "$(grep -c 'BEGIN CERTIFICATE' "${work}/cert.pem")" -ne 1 ]; then
  echo "::error::expected exactly one certificate in MACOS_SELF_SIGNED_P12"
  exit 1
fi
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k "${keychain}" "${work}/cert.pem"

matches="$(security find-identity -v -p codesigning "${keychain}" | grep -cF "\"${identity}\"" || true)"
if [ "${matches}" -ne 1 ]; then
  echo "::error::expected one valid code signing identity named '${identity}' in MACOS_SELF_SIGNED_P12, found ${matches}"
  security find-identity -p codesigning "${keychain}"
  exit 1
fi

fingerprint="$(openssl x509 -in "${work}/cert.pem" -noout -fingerprint -sha256)"
echo "Signing macOS bundles with the self-signed identity '${identity}' (${fingerprint})."
echo "APPLE_SIGNING_IDENTITY=${identity}" >> "${GITHUB_ENV}"
