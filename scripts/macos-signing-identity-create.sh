#!/usr/bin/env bash
# Creates PlateVault's long-lived self-signed macOS code signing identity and
# stores it where the release workflow reads it. The owner runs this once, and
# again only to rotate the identity (see docs/release/macos-signing.md).
#
# What it does, stopping at the first failure:
#   1. Checks the tools, and with --op-vault that 1Password is signed in and no
#      item with the same title exists yet.
#   2. In a private temporary directory (mode 700), generates an RSA 4096 key
#      and a self-signed certificate "PlateVault Self-Signed", valid for 9125
#      days (25 years), with keyUsage digitalSignature and extendedKeyUsage
#      codeSigning.
#   3. Bundles them into a .p12 (`openssl pkcs12 -export -legacy`: macOS
#      `security import` cannot read the OpenSSL 3 default encryption),
#      protected by a random 32-byte password.
#   4. With --op-vault, saves the .p12 (as a file) and its password in one
#      1Password item, then lists that item's title and field names.
#   5. Sets the repository secrets MACOS_SELF_SIGNED_P12 (base64 of the .p12)
#      and MACOS_SELF_SIGNED_P12_PASSWORD, and the repository variable
#      MACOS_SIGNING_IDENTITY, then lists the secret and variable names.
#   6. Shreds the temporary directory when it exits, whether it succeeded or
#      not. On failure nothing was stored, or the 1Password item holds the
#      only copy.
#
# Secrets never reach the terminal, another process's command line or a log.
# The password lives in a mode-600 file that openssl, jq, op and gh read
# directly. The script prints only public facts: the certificate subject,
# expiry and fingerprints, and names of the stored items.
#
# Usage:
#   scripts/macos-signing-identity-create.sh [--repo OWNER/NAME]
#       [--op-vault VAULT [--op-title TITLE]] [--yes]
#
# Requires: OpenSSL 3 (`brew install openssl@3`), jq, gh logged in with admin
# rights on the repository, and op (1Password CLI, signed in) with --op-vault.
# Any op call that has not finished within 60 seconds, for example while it
# waits for a 1Password approval, stops the script.
set -euo pipefail

repo="platevault/platevault"
op_vault=""
op_title="PlateVault macOS signing identity"
assume_yes=false
common_name="PlateVault Self-Signed"
validity_days=9125
op_timeout_seconds=60

usage() {
  sed -n '2,/^set -euo/{/^set -euo/d;s/^# \{0,1\}//;p;}' "$0"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) repo="${2:?--repo needs OWNER/NAME}"; shift 2 ;;
    --op-vault) op_vault="${2:?--op-vault needs a vault name}"; shift 2 ;;
    --op-title) op_title="${2:?--op-title needs a title}"; shift 2 ;;
    --yes) assume_yes=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

# Runs a command, killing it after $1 seconds. Its stdin is /dev/null.
run_with_timeout() {
  local seconds="$1"
  shift
  "$@" < /dev/null &
  local pid=$!
  (sleep "${seconds}" && kill -TERM "${pid}" 2>/dev/null) &
  local watcher=$!
  local status=0
  wait "${pid}" || status=$?
  kill "${watcher}" 2>/dev/null || true
  wait "${watcher}" 2>/dev/null || true
  return "${status}"
}

op_call() {
  run_with_timeout "${op_timeout_seconds}" op "$@"
}

command -v openssl >/dev/null || die "openssl not found; install OpenSSL 3 (brew install openssl@3)"
case "$(openssl version)" in
  "OpenSSL 3."*) ;;
  *) die "need OpenSSL 3 for 'pkcs12 -legacy', found '$(openssl version)'; put Homebrew's openssl@3 first on PATH" ;;
esac
command -v jq >/dev/null || die "jq not found"
command -v gh >/dev/null || die "gh not found"
gh auth status >/dev/null 2>&1 || die "gh is not logged in; run 'gh auth login'"
[ "$(gh api "repos/${repo}" --jq .permissions.admin 2>/dev/null)" = "true" ] \
  || die "gh has no admin rights on ${repo}, which setting secrets and variables needs"
if [ -n "${op_vault}" ]; then
  command -v op >/dev/null || die "--op-vault given but the 1Password CLI (op) is not installed"
  # `op whoami` reports "not signed in" under the desktop-app integration even
  # when every other command works, so probe the target vault instead.
  op_call vault get "${op_vault}" --format json >/dev/null \
    || die "op cannot open vault '${op_vault}': not signed in, no such vault, or no answer within ${op_timeout_seconds}s; unlock 1Password (or run 'op signin') and retry"
  if op_call item get "${op_title}" --vault "${op_vault}" --format json >/dev/null 2>&1; then
    die "1Password vault '${op_vault}' already has an item '${op_title}'; rename it (keep it until the new identity ships), or pass --op-title"
  fi
fi

umask 077
work="$(mktemp -d "${TMPDIR:-/tmp}/platevault-macos-identity.XXXXXX")"
chmod 700 "${work}"

shred_work() {
  if command -v shred >/dev/null; then
    find "${work}" -type f -exec shred -u -- {} + 2>/dev/null || true
  fi
  rm -rf -- "${work}"
}
trap shred_work EXIT

pass_file="${work}/p12.pass"
key_pass_file="${work}/key.pass"
key_file="${work}/key.pem"
cert_file="${work}/cert.pem"
p12_file="${work}/identity.p12"
b64_file="${work}/identity.p12.b64"
op_template="${work}/op-item.json"

# 32 random bytes, base64 without a newline: openssl's file: source reads the
# first line, and gh stores stdin as is. The key gets the same password from a
# second copy, because openssl reads two different lines when -passin and
# -passout name the same file.
openssl rand -base64 32 | tr -d '\n' > "${pass_file}"
cp "${pass_file}" "${key_pass_file}"

openssl req -x509 -newkey rsa:4096 -sha256 -days "${validity_days}" \
  -keyout "${key_file}" -passout "file:${key_pass_file}" \
  -out "${cert_file}" \
  -subj "/CN=${common_name}/O=PlateVault" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" 2>/dev/null

openssl pkcs12 -export -legacy \
  -inkey "${key_file}" -passin "file:${key_pass_file}" \
  -in "${cert_file}" -name "${common_name}" \
  -out "${p12_file}" -passout "file:${pass_file}"

# Prove the bundle opens with the password before anything is stored.
openssl pkcs12 -legacy -in "${p12_file}" -passin "file:${pass_file}" -noout \
  || die "the new .p12 does not open with its password"

openssl base64 -A -in "${p12_file}" -out "${b64_file}"

echo "Created a self-signed code signing certificate:"
openssl x509 -in "${cert_file}" -noout -subject -enddate
openssl x509 -in "${cert_file}" -noout -fingerprint -sha1
openssl x509 -in "${cert_file}" -noout -fingerprint -sha256
echo

if [ "${assume_yes}" != true ]; then
  if [ -n "${op_vault}" ]; then
    echo "Next: save it to 1Password vault '${op_vault}' as '${op_title}',"
  else
    echo "Next: no 1Password backup (pass --op-vault to keep one),"
  fi
  echo "then set MACOS_SELF_SIGNED_P12, MACOS_SELF_SIGNED_P12_PASSWORD and MACOS_SIGNING_IDENTITY on ${repo}."
  printf 'Continue? [y/N] '
  read -r answer
  case "${answer}" in
    y | Y | yes) ;;
    *) echo "Stopped. Nothing was stored; the temporary files are shredded."; exit 1 ;;
  esac
fi

if [ -n "${op_vault}" ]; then
  # The password goes in through a JSON template file, never through argv, as
  # `op item create --help` advises for sensitive values. The file attachment
  # argument carries only a path. Its backslash keeps op from reading the dot
  # in "identity.p12" as a section separator.
  jq -n --rawfile password "${pass_file}" --arg title "${op_title}" '{
      title: $title,
      category: "PASSWORD",
      fields: [{id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: $password}]
    }' > "${op_template}"
  op_call item create --vault "${op_vault}" --template "${op_template}" \
    "identity\\.p12[file]=${p12_file}" >/dev/null \
    || die "op item create failed or timed out after ${op_timeout_seconds}s; no repository secret was set"
  echo "1Password item (names only):"
  op_call item get "${op_title}" --vault "${op_vault}" --format json \
    | jq -c '{title, category, fields: [.fields[]? | .label], files: [.files[]? | .name]}' \
    || die "could not read back the 1Password item; no repository secret was set"
fi

gh secret set MACOS_SELF_SIGNED_P12 --repo "${repo}" < "${b64_file}"
gh secret set MACOS_SELF_SIGNED_P12_PASSWORD --repo "${repo}" < "${pass_file}"
gh variable set MACOS_SIGNING_IDENTITY --repo "${repo}" --body "${common_name}"

echo "Repository secrets and variable (names only):"
secrets="$(gh secret list --repo "${repo}" --json name,updatedAt \
  --jq '.[] | select(.name | startswith("MACOS_SELF_SIGNED_")) | "\(.name) \(.updatedAt)"')"
printf '%s\n' "${secrets}"
variable="$(gh variable list --repo "${repo}" --json name,value \
  --jq '.[] | select(.name == "MACOS_SIGNING_IDENTITY") | "\(.name)=\(.value)"')"
printf '%s\n' "${variable}"
[ "$(printf '%s\n' "${secrets}" | grep -c .)" -eq 2 ] || die "expected both MACOS_SELF_SIGNED_* secrets on ${repo}"
[ "${variable}" = "MACOS_SIGNING_IDENTITY=${common_name}" ] || die "MACOS_SIGNING_IDENTITY on ${repo} is not '${common_name}'"

echo "Done. Keep the fingerprints above: the updater's designated-requirement check pins this certificate."
