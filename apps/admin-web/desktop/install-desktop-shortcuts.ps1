param(
    [string]$DesktopDir
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Repo = Resolve-Path (Join-Path $ScriptDir "..\..\..")

if ([string]::IsNullOrWhiteSpace($DesktopDir)) {
    $DesktopDir = [Environment]::GetFolderPath("Desktop")
}

if ([string]::IsNullOrWhiteSpace($DesktopDir)) {
    throw "바탕화면 경로를 찾지 못했습니다. -DesktopDir 로 직접 지정하세요."
}

New-Item -ItemType Directory -Path $DesktopDir -Force | Out-Null
$DesktopDir = (Resolve-Path $DesktopDir).Path

$urlPath = Join-Path $DesktopDir "MobileGenAI-Admin.url"
$urlContent = @"
[InternetShortcut]
URL=http://127.0.0.1:5173/
"@
[System.IO.File]::WriteAllText($urlPath, $urlContent, [System.Text.Encoding]::ASCII)

$cmdPath = Join-Path $DesktopDir "MobileGenAI-Admin-DevServer.cmd"
$escapedRepo = $Repo.Path.Replace('"', '""')
$cmdContent = @"
@echo off
setlocal
set REPO=$escapedRepo

cd /d "%REPO%\apps\admin-web" || (
  echo [ERROR] 저장소 경로를 찾을 수 없습니다: %REPO%\apps\admin-web
  pause
  exit /b 1
)

where npm >nul 2>&1 || (
  echo [ERROR] npm을 찾을 수 없습니다. Node.js 설치 후 다시 실행하세요.
  pause
  exit /b 1
)

echo [INFO] Installing dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

start "Admin Web Browser" http://127.0.0.1:5173/
echo [INFO] Starting Vite dev server...
call npm run dev
"@
[System.IO.File]::WriteAllText($cmdPath, $cmdContent, [System.Text.Encoding]::ASCII)

Write-Output "생성 완료: $DesktopDir"
Write-Output "  - MobileGenAI-Admin.url (주소만 열기)"
Write-Output "  - MobileGenAI-Admin-DevServer.cmd (npm install 후 npm run dev)"
