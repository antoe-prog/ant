param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$logDir = Join-Path $ProjectRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$healthUrl = "http://localhost:3000/api/health"
try {
  $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
  if ($response.StatusCode -eq 200) {
    Add-Content -Path (Join-Path $logDir "api-server-launcher.log") -Value "$(Get-Date -Format o) API already running on :3000"
    exit 0
  }
} catch {
  # Server is not reachable, start it below.
}

$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$stdout = Join-Path $logDir "api-server.out.log"
$stderr = Join-Path $logDir "api-server.err.log"

Add-Content -Path (Join-Path $logDir "api-server-launcher.log") -Value "$(Get-Date -Format o) Starting API server"
Start-Process -FilePath $pnpm `
  -ArgumentList @("dev:server") `
  -WorkingDirectory $ProjectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr
