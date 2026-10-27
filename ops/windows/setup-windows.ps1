<#
  SMARTwinFA fleet demo on a fresh Windows 10/11 PC.
  Installs WSL 2, Docker Desktop and Git (with winget), downloads SMARTwinFA-web, builds the app,
  then starts the dashboard (Portainer, Grafana, Uptime Kuma) and the Rishabh Plastic demo stack.

  Run in PowerShell as Administrator:
      Set-ExecutionPolicy -Scope Process Bypass -Force
      .\setup-windows.ps1                      # default folder D:\SMARTwinFA-web (C:\ if there is no D:)
      .\setup-windows.ps1 -Folder C:\SMARTwinFA-web -Branch ops-fleet-dashboard

  Safe to run again: each step is skipped when it is already done. If Windows asks for a restart
  (after WSL or Docker Desktop is installed), restart and run the script again.
#>
param(
  [string]$Folder = $(if (Test-Path 'D:\') { 'D:\SMARTwinFA-web' } else { 'C:\SMARTwinFA-web' }),
  [string]$Repo = 'https://github.com/deepsanghavi1002/SMARTwinFA-web.git',
  [string]$Branch = 'ops-fleet-dashboard',
  [string]$SeedDump = '',  # optional: path to rishabh-plastic27.dump, copied into the private fixtures folder
  [string]$SiteEnv = ''    # client's own machine (on-prem): the <client>.env made by "ops/smartwinfa.sh fleet enroll <client>"
)
$ErrorActionPreference = 'Stop'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Done($text) { Write-Host "    $text" -ForegroundColor Green }
function Stop-With($text) { Write-Host "`n$text" -ForegroundColor Yellow; exit 1 }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

# 1. Windows version and administrator rights
Step 'Checking Windows'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Stop-With 'Please run PowerShell as Administrator (right-click > Run as administrator) and start the script again.' }
$build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
if ($build -lt 19045) { Stop-With "Windows build $build is too old for Docker Desktop. Run Windows Update until Windows 10 22H2 (build 19045) or Windows 11, then run this script again." }
if (-not (Have 'winget')) { Stop-With 'winget is missing. Install "App Installer" from the Microsoft Store, then run this script again.' }
Done "Windows build $build, administrator: yes"

# 2. WSL 2 (Docker Desktop runs Linux containers on it)
Step 'WSL 2'
$wslOk = $false
try { wsl.exe --status *> $null; $wslOk = ($LASTEXITCODE -eq 0) } catch { $wslOk = $false }
if (-not $wslOk) {
  wsl.exe --install --no-distribution
  Stop-With 'WSL was installed. Restart Windows, then run this script again.'
}
wsl.exe --update *> $null
Done 'WSL 2 ready'

# 3. Git (also brings Git Bash, which runs ops/smartwinfa.sh)
Step 'Git'
if (-not (Have 'git')) {
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements --silent
  Refresh-Path
}
$bash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) { Stop-With 'Git was installed but Git Bash was not found. Close this window, open a new Administrator PowerShell and run the script again.' }
Done "Git ready ($bash)"

# 4. Docker Desktop
Step 'Docker Desktop'
$dockerExe = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerExe)) {
  winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements --silent
  Stop-With 'Docker Desktop was installed. Restart Windows (or sign out and in), open Docker Desktop once and accept its terms, then run this script again.'
}
Refresh-Path
if (-not (Have 'docker')) { $env:Path += ";$env:ProgramFiles\Docker\Docker\resources\bin" }
if (-not (Have 'docker')) { Stop-With 'The docker command is not available yet. Restart Windows, open Docker Desktop once, then run this script again.' }
$ErrorActionPreference = 'Continue'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Start-Process $dockerExe
  Write-Host '    waiting for Docker Desktop to start (up to 3 minutes)...'
  $deadline = (Get-Date).AddMinutes(3)
  do { Start-Sleep 5; docker info *> $null } until ($LASTEXITCODE -eq 0 -or (Get-Date) -gt $deadline)
  if ($LASTEXITCODE -ne 0) { Stop-With 'Docker Desktop did not start. Open it from the Start menu, accept its terms, wait until it says "Engine running", then run this script again.' }
}
$ErrorActionPreference = 'Stop'
Done 'Docker engine running'

# 5. The code
Step "SMARTwinFA-web in $Folder (branch $Branch)"
if (-not (Test-Path "$Folder\.git")) {
  git clone -c core.autocrlf=false --branch $Branch $Repo $Folder
  if ($LASTEXITCODE -ne 0) { Stop-With 'git clone failed. If GitHub asks you to sign in, sign in with the account that has access to the repository and run the script again.' }
} else {
  git -C $Folder fetch origin $Branch
  git -C $Folder checkout $Branch
  git -C $Folder pull --rebase origin $Branch
}
# Shell scripts and container configs must keep Linux line endings (see .gitattributes).
git -C $Folder config core.autocrlf false
Done 'code ready'

# 6. Optional: the Rishabh Plastic database dump
if ($SeedDump -ne '') {
  Step 'Rishabh Plastic database dump'
  if (-not (Test-Path $SeedDump)) { Stop-With "Dump not found: $SeedDump" }
  New-Item -ItemType Directory -Force "$Folder\database\fixtures\private" | Out-Null
  Copy-Item $SeedDump "$Folder\database\fixtures\private\rishabh-plastic27.dump" -Force
  Done 'dump copied; it is restored on the first start of the Rishabh stack'
}

# 7. Client settings: the enrolled site file (on-prem install) or the Rishabh demo with a random database password
$siteId = ''
if ($SiteEnv -ne '') {
  Step 'Client site settings'
  if (-not (Test-Path $SiteEnv)) { Stop-With "Site settings file not found: $SiteEnv" }
  $siteId = ((Select-String -Path $SiteEnv -Pattern '^CLIENT_ID=(.*)$').Matches[0].Groups[1].Value).Trim()
  if ($siteId -notmatch '^[a-z0-9][a-z0-9-]{1,30}$') { Stop-With "CLIENT_ID missing or invalid in $SiteEnv" }
  $text = (Get-Content $SiteEnv) -join "`n"
  [IO.File]::WriteAllText("$Folder\ops\clients\$siteId.env", $text + "`n")
  Done "ops\clients\$siteId.env installed"
}
Step 'Rishabh Plastic settings'
$envFile = "$Folder\ops\clients\rishabh.env"
if (-not (Test-Path $envFile)) {
  $password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
  $lines = (Get-Content "$Folder\ops\clients\rishabh.env.example") -replace '^DB_PASSWORD=.*', "DB_PASSWORD=$password"
  [IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"))   # Linux line endings for docker compose
  Done 'created ops\clients\rishabh.env'
} else { Done 'ops\clients\rishabh.env already exists (kept)' }

# 8. Build and start everything (through Git Bash, which runs ops/smartwinfa.sh)
Step 'Building the app images (first time takes 5-15 minutes)'
$posix = $Folder -replace '\\','/'
function Ops($cmd) { & $bash -c "cd '$posix' && ops/smartwinfa.sh $cmd"; if ($LASTEXITCODE -ne 0) { throw "ops/smartwinfa.sh $cmd failed" } }
try {
  Ops 'build-local'
  if ($siteId -ne '') {
    Step "Starting client site $siteId (app, support agent, log agent, tunnel, offsite backup as configured)"
    Ops "site up $siteId"
    Ops "site status $siteId"
    Write-Host "`nSite $siteId is running: http://localhost (port in ops\clients\$siteId.env). It now shows in your Portainer." -ForegroundColor Green
    Write-Host "Switch vendor support off/on:  & `"$bash`" -c `"cd '$posix' && ops/smartwinfa.sh site support $siteId off`"" -ForegroundColor Green
    exit 0
  }
  Step 'Starting the dashboard'
  Ops 'fleet up'
  Step 'Starting Rishabh Plastic'
  Ops 'client up rishabh'
  Ops 'list'
} catch {
  Stop-With "Stopped: $_. Send the text above to support; running the script again continues from here."
}

$grafana = (Select-String -Path "$Folder\ops\fleet\.env" -Pattern '^GRAFANA_ADMIN_PASSWORD=(.*)$').Matches[0].Groups[1].Value
$portainer = (Get-Content "$Folder\ops\fleet\.portainer-admin-password" -Raw).Trim()
Write-Host @"

SMARTwinFA demo is running.
  Rishabh Plastic app   http://localhost:4101
  Portainer (stacks)    http://localhost:9000   user admin   password $portainer
  Grafana (logs)        http://localhost:3001   user admin   password $grafana
  Uptime Kuma (checks)  http://localhost:3002   create an admin on first visit, then add an HTTP
                        monitor for http://rishabh-web:3000/api/health

Passwords are stored in $Folder\ops\fleet. Stop everything: Docker Desktop > Containers, or
  & "$bash" -c "cd '$posix' && ops/smartwinfa.sh client down rishabh && ops/smartwinfa.sh fleet down"
"@ -ForegroundColor Green
Start-Process 'http://localhost:9000'
