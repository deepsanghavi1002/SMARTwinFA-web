# Keeps the report mailer (scripts/report-mailer.mts) running on this PC and restarts it if it exits.
# Run it on ONE PC only. See docs/operations/report-email.md. Log: .wrangler/logs/report-mailer.log

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root ".wrangler\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "report-mailer.log"

# Only one copy on this PC.
$mutex = New-Object System.Threading.Mutex($false, "Global\SMARTwinFA-report-mailer")
if (-not $mutex.WaitOne(0)) { exit 0 }

function Write-Log($msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Out-File -Append -Encoding utf8 $log
}

while ($true) {
  Write-Log "starting report mailer"
  & cmd.exe /c "node --experimental-strip-types scripts\report-mailer.mts >> `"$log`" 2>&1"
  $code = $LASTEXITCODE
  Write-Log "report mailer exited with code $code; restarting in 60s"
  Start-Sleep -Seconds 60
}
