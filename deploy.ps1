# File: deploy.ps1
# deploy.ps1 - Clean-environment deploy for Tajiri POS to Cloudflare Pages
# Usage:
#   .\deploy.ps1              -> build + deploy
#   .\deploy.ps1 -DryRun      -> build only, no deploy
#   .\deploy.ps1 -FixNode     -> relocate Node.js to %LOCALAPPDATA%\nodejs and refresh PATH
param(
    [switch]$DryRun,
    [switch]$FixNode
)

$ErrorActionPreference = "Stop"
$NodeDir = Join-Path $env:LOCALAPPDATA "nodejs"

# ---------------------------------------------------------------- FixNode
if ($FixNode) {
    Write-Host "==> Relocating Node.js to $NodeDir" -ForegroundColor Cyan
    winget uninstall OpenJS.NodeJS --silent
    winget install OpenJS.NodeJS.LTS --location $NodeDir --silent
    # Persist for future sessions (User PATH only, never touches system PATH)
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$NodeDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$NodeDir", "User")
    }
    # Refresh the CURRENT session so the new node is picked up immediately
    $env:Path = "$NodeDir;" + ($env:Path -split ";" |
        Where-Object { $_ -and $_ -notmatch "Program Files\\nodejs" }) -join ";"
}

# ---------------------------------------------------------------- Sanity checks
Write-Host "==> Environment check" -ForegroundColor Cyan
$nodeVersion = & node --version
Write-Host "    node  : $nodeVersion  ($((Get-Command node).Source))"
Write-Host "    npm   : $(& npm --version)"
Write-Host "    cwd   : $(Get-Location)"

if (-not (Test-Path ".\package.json")) {
    throw "Run this script from the repository root (package.json not found)."
}

# ---------------------------------------------------------------- Install deps
# Version-LOCKED wrangler: avoids surprise majors that break bundling rules.
# If package.json already pins it, npm ci is enough and much faster.
Write-Host "==> Installing dependencies" -ForegroundColor Cyan
if ((Test-Path ".\node_modules\.package-lock.json") -or (Test-Path ".\package-lock.json")) {
    npm ci --no-audit --no-fund
} else {
    npm install --no-audit --no-fund
}
if ($LASTEXITCODE -ne 0) { throw "Dependency install failed." }

# Pin wrangler for this session to a known-good minor (never auto-bump majors).
$knownGoodWrangler = "4.146.0"
npx --yes wrangler@$knownGoodWrangler --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Wrangler $knownGoodWrangler failed to run." }

# ---------------------------------------------------------------- Build
Write-Host "==> Building static hosting bundle" -ForegroundColor Cyan
npm run build:hosting
if ($LASTEXITCODE -ne 0) { throw "Build failed. Aborting before deploy." }

# Gate: the build must have produced the entry files wrangler will upload.
foreach ($f in @("index.html", "welcome.js", "welcome.css")) {
    if (-not (Test-Path ".\public\$f")) { throw "Build output missing: public\$f" }
}
Write-Host "    build output verified (public/)" -ForegroundColor Green

if ($DryRun) {
    Write-Host "`nDryRun: skipping deploy. Files are staged in .\public" -ForegroundColor Yellow
    exit 0
}

# ---------------------------------------------------------------- Deploy
Write-Host "==> Deploying to Cloudflare Pages (project: tajiri-pos)" -ForegroundColor Cyan
# Plain static-assets deploy: NO worker bundling -> no .d.ts / constants errors.
npx wrangler@4.146.0 pages deploy ./public `
    --project-name=tajiri-pos `
    --branch=main `
    --exclude-glob="*.map,**/_worker*,**/*.d.ts"

if ($LASTEXITCODE -ne 0) { throw "Deploy failed." }
Write-Host "`nDeploy complete. https://tajiri-pos.pages.dev" -ForegroundColor Green
