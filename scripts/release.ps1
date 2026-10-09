[CmdletBinding()]
param(
    [string]$Tag = "v1.0.0",
    [string]$RemoteUrl = "https://github.com/D1verlin/ProxyRouterDesktop.git",
    [switch]$SkipBuildCheck,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$rootDir/proxy-router-desktop")) {
    $rootDir = $PSScriptRoot
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Proxy Router Desktop - Release Automation ($Tag)" -ForegroundColor Cyan
Write-Host " Target Repository: $RemoteUrl" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check Git
try {
    $null = git --version
} catch {
    Write-Error "Git not found in PATH! Please install Git before running this script."
}

# 2. Initialize Git repo if needed
if (-not (Test-Path "$rootDir/.git")) {
    Write-Host "[+] Initializing new Git repository..." -ForegroundColor Yellow
    git -C "$rootDir" init
    git -C "$rootDir" branch -M main
}

# 3. Configure Remote origin
$existingRemotes = git -C "$rootDir" remote
if ($existingRemotes -contains "origin") {
    Write-Host "[+] Updating existing remote 'origin'..." -ForegroundColor Gray
    git -C "$rootDir" remote set-url origin $RemoteUrl
} else {
    Write-Host "[+] Adding remote 'origin': $RemoteUrl" -ForegroundColor Gray
    git -C "$rootDir" remote add origin $RemoteUrl
}

# 4. Pre-flight build checks
if (-not $SkipBuildCheck) {
    Write-Host "`n[+] Verifying frontend build (npm run build)..." -ForegroundColor Yellow
    Push-Location "$rootDir/proxy-router-desktop"
    try {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
    } finally {
        Pop-Location
    }

    Write-Host "[+] Verifying Rust backend (cargo check)..." -ForegroundColor Yellow
    Push-Location "$rootDir/proxy-router-desktop/src-tauri"
    try {
        cargo check
        if ($LASTEXITCODE -ne 0) { throw "cargo check failed" }
    } finally {
        Pop-Location
    }
    Write-Host "[OK] All pre-flight build checks passed successfully!" -ForegroundColor Green
}

# 5. Stage files with .gitignore respected
Write-Host "`n[+] Staging files for commit..." -ForegroundColor Yellow
git -C "$rootDir" add .

# Check if there are changes to commit
$status = git -C "$rootDir" status --porcelain
if ($status) {
    Write-Host "[+] Creating release commit..." -ForegroundColor Yellow
    git -C "$rootDir" commit -m "feat: release $Tag - Proxy Router Desktop with GitHub Actions CI/CD"
} else {
    Write-Host "[i] No new changes to commit, working tree is clean." -ForegroundColor Gray
}

# 6. Create annotated tag
$existingTags = git -C "$rootDir" tag -l $Tag
if ($existingTags -eq $Tag) {
    Write-Host "[!] Tag $Tag already exists. Recreating..." -ForegroundColor Yellow
    git -C "$rootDir" tag -d $Tag
}
Write-Host "[+] Creating tag $Tag..." -ForegroundColor Yellow
git -C "$rootDir" tag -a $Tag -m "Release $Tag"

# 7. Push to GitHub
if (-not $NoPush) {
    Write-Host "`n[+] Pushing changes and tag to GitHub ($RemoteUrl)..." -ForegroundColor Cyan
    Write-Host "    Command: git push -u origin main --tags" -ForegroundColor Gray
    git -C "$rootDir" push -u origin main --tags
    Write-Host "`n[OK] Push completed! GitHub Actions has triggered the release build." -ForegroundColor Green
    Write-Host "    Track build status at: https://github.com/D1verlin/ProxyRouterDesktop/actions" -ForegroundColor Cyan
} else {
    Write-Host "`n[i] -NoPush switch was provided. When ready to publish, run:" -ForegroundColor Yellow
    Write-Host "    git push -u origin main --tags" -ForegroundColor White
}

Write-Host "`nRelease $Tag prepared successfully!" -ForegroundColor Green
