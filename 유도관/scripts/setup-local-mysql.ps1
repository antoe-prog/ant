param(
  [string]$DatabaseName = "judokan",
  [string]$AppUser = "judokan_app"
)

$ErrorActionPreference = "Stop"

if ($DatabaseName -notmatch "^[A-Za-z0-9_]+$") {
  throw "DatabaseName must contain only letters, numbers, and underscores."
}

if ($AppUser -notmatch "^[A-Za-z0-9_]+$") {
  throw "AppUser must contain only letters, numbers, and underscores."
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$mysqlCandidates = @(
  "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
  "C:\Program Files\MySQL\MySQL Workbench 8.0\mysql.exe"
)
$mysql = $mysqlCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $mysql) {
  $mysqlCommand = Get-Command mysql.exe -ErrorAction SilentlyContinue
  if ($mysqlCommand) {
    $mysql = $mysqlCommand.Source
  }
}
if (-not $mysql) {
  throw "mysql.exe was not found. Install MySQL Server or add mysql.exe to PATH."
}

function ConvertTo-PlainText([Security.SecureString]$secureString) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureString)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

function New-UrlSafePassword {
  $alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $chars = 1..32 | ForEach-Object {
    $alphabet[(Get-Random -Minimum 0 -Maximum $alphabet.Length)]
  }
  return -join $chars
}

function Set-DotEnvValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = [System.Collections.Generic.List[string]]::new()
  if (Test-Path $Path) {
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
      $lines.Add($line)
    }
  }

  $updated = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*$([regex]::Escape($Key))\s*=") {
      $lines[$i] = "$Key=$Value"
      $updated = $true
      break
    }
  }
  if (-not $updated) {
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1].Trim() -ne "") {
      $lines.Add("")
    }
    $lines.Add("$Key=$Value")
  }

  Set-Content -LiteralPath $Path -Value $lines -Encoding UTF8
}

$secureRootPassword = Read-Host "MySQL root password" -AsSecureString
$rootPassword = ConvertTo-PlainText $secureRootPassword
$appPassword = New-UrlSafePassword
$databaseUrl = "mysql://$AppUser`:$appPassword@127.0.0.1:3306/$DatabaseName"

$sql = @"
CREATE DATABASE IF NOT EXISTS ``$DatabaseName`` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '$AppUser'@'localhost' IDENTIFIED BY '$appPassword';
ALTER USER '$AppUser'@'localhost' IDENTIFIED BY '$appPassword';
CREATE USER IF NOT EXISTS '$AppUser'@'127.0.0.1' IDENTIFIED BY '$appPassword';
ALTER USER '$AppUser'@'127.0.0.1' IDENTIFIED BY '$appPassword';
GRANT ALL PRIVILEGES ON ``$DatabaseName``.* TO '$AppUser'@'localhost';
GRANT ALL PRIVILEGES ON ``$DatabaseName``.* TO '$AppUser'@'127.0.0.1';
FLUSH PRIVILEGES;
"@

Push-Location $projectRoot
try {
  $oldMysqlPwd = $env:MYSQL_PWD
  $env:MYSQL_PWD = $rootPassword
  try {
    $sql | & $mysql -h 127.0.0.1 -P 3306 -u root
  } finally {
    if ($null -eq $oldMysqlPwd) {
      Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    } else {
      $env:MYSQL_PWD = $oldMysqlPwd
    }
  }

  Set-DotEnvValue -Path (Join-Path $projectRoot ".env") -Key "DATABASE_URL" -Value $databaseUrl
  $env:DATABASE_URL = $databaseUrl

  pnpm exec drizzle-kit push --config drizzle.config.ts --force
  node scripts/import-local-users-to-db.mjs

  $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot "scripts/start-api-server.ps1")

  Start-Sleep -Seconds 4
  Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000/api/health" -TimeoutSec 10 | Select-Object StatusCode, Content
  Invoke-WebRequest -UseBasicParsing -Uri "https://api.judokan.store/api/health" -TimeoutSec 10 | Select-Object StatusCode, Content

  Write-Host ""
  Write-Host "Local MySQL setup completed."
  Write-Host "DATABASE_URL=$databaseUrl"
} finally {
  Pop-Location
}
