# Upload the latest code, then build and restart on the server.
# data/ is not uploaded, so app.sqlite and admin-initial.txt stay untouched.
# Usage: powershell -ExecutionPolicy Bypass -File deploy.ps1
$ErrorActionPreference = "Stop"
$Project = Split-Path -Parent $MyInvocation.MyCommand.Path
$Key = Join-Path $env:USERPROFILE ".ssh\cp_aliyun"
$Remote = "root@47.116.71.3"
$SshArgs = @("-i", $Key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new")

if (-not (Test-Path $Key)) {
  throw "Deploy key not found: $Key"
}

Set-Location $Project
& ssh @SshArgs $Remote "rm -rf /opt/cp/src /opt/cp/web/src /opt/cp/web/dist && mkdir -p /opt/cp/web"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& scp @SshArgs server.js package.json README.md DATABASE.md DEPLOY.md "${Remote}:/opt/cp/"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& scp @SshArgs -r src "${Remote}:/opt/cp/"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& scp @SshArgs web/index.html web/package.json web/package-lock.json web/vite.config.js web/.gitignore "${Remote}:/opt/cp/web/"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& scp @SshArgs -r web/src "${Remote}:/opt/cp/web/"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& ssh @SshArgs $Remote "cd /opt/cp && npm run build && systemctl restart cp && systemctl is-active cp"
exit $LASTEXITCODE
