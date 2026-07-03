#!/usr/bin/env bash
set -euo pipefail

RULE="system.login.console"
MECHANISM="FinalJudoAuthorizationPlugin:pass,privileged"
BEFORE=""
AFTER=""
REMOVE=0
APPLY=0

usage() {
  cat <<'USAGE'
Usage:
  update-authdb-mechanism.sh [options]

Options:
  --rule NAME             Authorization DB rule to edit. Default: system.login.console
  --mechanism VALUE       Mechanism entry. Default: FinalJudoAuthorizationPlugin:pass,privileged
  --before VALUE          Insert before an existing mechanism.
  --after VALUE           Insert after an existing mechanism.
  --remove                Remove the mechanism instead of inserting it.
  --apply                 Write the edited rule back with security authorizationdb write.
  -h, --help              Show help.

Default mode is dry-run. Keep another admin session open before using --apply.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rule)
      RULE="$2"
      shift 2
      ;;
    --mechanism)
      MECHANISM="$2"
      shift 2
      ;;
    --before)
      BEFORE="$2"
      shift 2
      ;;
    --after)
      AFTER="$2"
      shift 2
      ;;
    --remove)
      REMOVE=1
      shift
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "${BEFORE}" && -n "${AFTER}" ]]; then
  echo "--before and --after cannot be used together." >&2
  exit 2
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/finaljudo-authdb.XXXXXX")"
trap 'rm -rf "${WORK_DIR}"' EXIT

CURRENT_PLIST="${WORK_DIR}/${RULE}.current.plist"
UPDATED_PLIST="${WORK_DIR}/${RULE}.updated.plist"
BACKUP_DIR="${HOME}/Library/Application Support/FinalJudoAuthorizationPlugin/backups"
BACKUP_PLIST="${BACKUP_DIR}/${RULE}.$(date -u +%Y%m%dT%H%M%SZ).plist"

/usr/bin/security authorizationdb read "${RULE}" > "${CURRENT_PLIST}" 2>/dev/null

python3 - "${CURRENT_PLIST}" "${UPDATED_PLIST}" "${MECHANISM}" "${BEFORE}" "${AFTER}" "${REMOVE}" <<'PY'
import plistlib
import sys

current_path, updated_path, mechanism, before, after, remove_raw = sys.argv[1:7]
remove = remove_raw == "1"

with open(current_path, "rb") as handle:
    rule = plistlib.load(handle)

mechanisms = rule.get("mechanisms")
if not isinstance(mechanisms, list):
    raise SystemExit("Rule does not contain a mechanisms array.")

changed = False

if remove:
    original = list(mechanisms)
    mechanisms[:] = [entry for entry in mechanisms if entry != mechanism]
    changed = mechanisms != original
else:
    if mechanism not in mechanisms:
        if before:
            try:
                index = mechanisms.index(before)
            except ValueError as error:
                raise SystemExit(f"--before mechanism not found: {before}") from error
            mechanisms.insert(index, mechanism)
        elif after:
            try:
                index = mechanisms.index(after)
            except ValueError as error:
                raise SystemExit(f"--after mechanism not found: {after}") from error
            mechanisms.insert(index + 1, mechanism)
        else:
            mechanisms.append(mechanism)
        changed = True

rule["mechanisms"] = mechanisms
with open(updated_path, "wb") as handle:
    plistlib.dump(rule, handle, sort_keys=False)

print("changed=" + ("yes" if changed else "no"))
print("mechanisms:")
for index, entry in enumerate(mechanisms):
    print(f"  {index}: {entry}")
PY

echo
echo "Current plist: ${CURRENT_PLIST}"
echo "Updated plist: ${UPDATED_PLIST}"

if cmp -s "${CURRENT_PLIST}" "${UPDATED_PLIST}"; then
  echo "No authorization DB changes needed."
  exit 0
fi

echo
echo "Diff:"
diff -u "${CURRENT_PLIST}" "${UPDATED_PLIST}" || true

if [[ "${APPLY}" != "1" ]]; then
  echo
  echo "Dry-run only. Re-run with --apply to write ${RULE}."
  exit 0
fi

mkdir -p "${BACKUP_DIR}"
cp "${CURRENT_PLIST}" "${BACKUP_PLIST}"
echo "Backup saved: ${BACKUP_PLIST}"

sudo /usr/bin/security authorizationdb write "${RULE}" < "${UPDATED_PLIST}" >/dev/null
echo "Updated authorization DB rule: ${RULE}"
