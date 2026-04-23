#!/usr/bin/env bash
# 바탕화면(또는 지정 폴더)에 Admin 웹 바로가기·개발 서버 실행 스크립트를 복사합니다.
# 사용: ./install-desktop-shortcuts.sh
# 또는: DESKTOP_DIR="$HOME/바탕화면" ./install-desktop-shortcuts.sh  (경로가 다른 경우)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"

resolve_dest() {
  if [[ -n "${DESKTOP_DIR:-}" ]]; then
    echo "$DESKTOP_DIR"
    return
  fi
  if [[ -d "$HOME/Desktop" ]]; then
    echo "$HOME/Desktop"
    return
  fi
  if [[ -d "$HOME/바탕화면" ]]; then
    echo "$HOME/바탕화면"
    return
  fi
  echo "$HOME/Desktop"
}

DEST="$(resolve_dest)"
mkdir -p "$DEST"

cp -f "$SCRIPT_DIR/모바일GenAI-Admin.webloc" "$DEST/모바일GenAI-Admin.webloc"

TMP_CMD="$(mktemp)"
trap 'rm -f "$TMP_CMD"' EXIT
{
  echo '#!/bin/bash'
  echo 'set -euo pipefail'
  echo "REPO=$(printf '%q' "$REPO")"
  echo 'export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"'
  echo 'cd "$REPO/apps/admin-web" || { osascript -e '"'"'display dialog "저장소 경로를 찾을 수 없습니다. install-desktop-shortcuts.sh 를 다시 실행하세요." buttons {"OK"} default button 1'"'"' 2>/dev/null || true; exit 1; }'
  echo 'if ! command -v npm >/dev/null 2>&1; then'
  echo '  osascript -e '"'"'display dialog "npm 을 찾을 수 없습니다. Node.js 설치 후 다시 실행하세요." buttons {"OK"} default button 1'"'"' 2>/dev/null || echo "npm 없음" >&2'
  echo '  exit 1'
  echo 'fi'
  echo 'npm install'
  echo 'npm run dev &'
  echo 'VITEPID=$!'
  echo 'for i in $(seq 1 90); do'
  echo '  if nc -z 127.0.0.1 5173 2>/dev/null || bash -c "echo >/dev/tcp/127.0.0.1/5173" 2>/dev/null; then'
  echo '    open "http://127.0.0.1:5173"'
  echo '    wait "$VITEPID"'
  echo '    exit 0'
  echo '  fi'
  echo '  sleep 1'
  echo 'done'
  echo 'osascript -e '"'"'display dialog "Vite(포트 5173)가 90초 안에 뜨지 않았습니다. 터미널 로그를 확인하세요." buttons {"OK"} default button 1'"'"' 2>/dev/null || true'
  echo 'kill "$VITEPID" 2>/dev/null || true'
  echo 'exit 1'
} >"$TMP_CMD"
cp -f "$TMP_CMD" "$DEST/모바일GenAI-Admin-개발서버.command"
chmod +x "$DEST/모바일GenAI-Admin-개발서버.command"

echo "복사 완료: $DEST"
echo "  - 모바일GenAI-Admin.webloc (주소만 열기 — Vite가 먼저 떠 있어야 함)"
echo "  - 모바일GenAI-Admin-개발서버.command (npm run dev 후 브라우저 열기, 권장)"
