#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="FinalJudoAuthorizationPlugin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUNDLE="${PLUGIN_DIR}/build/${PLUGIN_NAME}.bundle"
DESTINATION="/Library/Security/SecurityAgentPlugins/${PLUGIN_NAME}.bundle"

if [[ ! -d "${BUNDLE}" ]]; then
  make -C "${PLUGIN_DIR}"
fi

if [[ ! -d "${BUNDLE}" ]]; then
  echo "Bundle not found: ${BUNDLE}" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "${BUNDLE}"

echo "Installing ${BUNDLE} -> ${DESTINATION}"
sudo rm -rf "${DESTINATION}"
sudo ditto "${BUNDLE}" "${DESTINATION}"
sudo chown -R root:wheel "${DESTINATION}"
sudo chmod -R go-w "${DESTINATION}"
sudo codesign --verify --deep --strict --verbose=2 "${DESTINATION}"

echo "Installed ${PLUGIN_NAME}."
echo "Next: run scripts/update-authdb-mechanism.sh in dry-run mode, then with --apply only after review."
