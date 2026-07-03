#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="FinalJudoAuthorizationPlugin"
DESTINATION="/Library/Security/SecurityAgentPlugins/${PLUGIN_NAME}.bundle"

echo "Remove the authorization DB mechanism before deleting the bundle:"
echo "  native/macos-authorization-plugin/scripts/update-authdb-mechanism.sh --remove --apply"
echo
echo "Deleting ${DESTINATION}"
sudo rm -rf "${DESTINATION}"
echo "Removed ${PLUGIN_NAME} bundle."
