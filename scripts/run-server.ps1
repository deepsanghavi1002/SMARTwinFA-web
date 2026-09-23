# Keeps the SMARTwinFA web server running on this PC.
#
# `npm run dev` dies whenever the terminal (or the Claude/VS Code session) that
# launched it is closed, so the program "stops" day after day. This script runs
# the server in its own hidden process and restarts it if it ever exits.
# Started at Windows logon by the "SMARTwinFA Web Server" scheduled task
# (see scripts/install-server-task.ps1). Logs go to .wrangler/logs/server.log.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root ".wrangler\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "server.log"

# Only one copy may own port 3000.
$mutex = New-Object System.Threading.Mutex($false, "Global\SMARTwinFA-web-server")
if (-not $mutex.WaitOne(0)) { exit 0 }

function Write-Log($msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -Append -Encoding utf8 $log
}

# Wait for the database (local on PC1, over the LAN on PC2/laptop) after a
# reboot, up to 5 minutes, using DB_HOST/DB_PORT from .env.local.
$envFile = Get-Content (Join-Path $root ".env.local") -ErrorAction SilentlyContinue
$dbHost = (($envFile | Select-String '^DB_HOST=(.*)$').Matches.Groups[1].Value, "localhost" -ne "")[0]
$dbPort = (($envFile | Select-String '^DB_PORT=(\d+)').Matches.Groups[1].Value, "5432" -ne "")[0]
for ($i = 0; $i -lt 60; $i++) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  try { $tcp.Connect($dbHost, [int]$dbPort); $tcp.Close(); break } catch { Start-Sleep -Seconds 5 }
}
Write-Log "database $dbHost`:$dbPort reachable after $($i * 5)s"

while ($true) {
  # Clear anything left holding port 3000 from a previous crashed run.
  Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

  Write-Log "starting server"
  & cmd.exe /c "npm run dev -- --port 3000 --strictPort >> `"$log`" 2>&1"
  Write-Log "server exited with code $LASTEXITCODE; restarting in 5s"
  Start-Sleep -Seconds 5
}
