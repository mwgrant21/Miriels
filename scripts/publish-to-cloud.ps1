<#
.SYNOPSIS
    Publish a clean snapshot of the tarot project to the private GitHub repo
    (github.com/mwgrant21/Miriels) without exposing local git history.

.DESCRIPTION
    The local 'tarot' repo carries history that once contained an API key, so its
    history must never reach the cloud. This script exports ONLY the current
    committed tree (git archive HEAD) into a separate publish repo that has its own
    fresh history, scans the result for secrets, then commits and pushes.

    Run this after committing a major update in the tarot repo. Uncommitted changes
    are NOT published (archive uses HEAD).

.PARAMETER Message
    The commit message for this release snapshot.

.EXAMPLE
    pwsh ./scripts/publish-to-cloud.ps1 -Message "v1.7.0: prophecy dedup + studio suite"

.NOTES
    Write-Host is intentionally used for colored interactive console output; this is
    a manual developer tool, never a PDQ Deploy step. ASCII only.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Message
)

$ErrorActionPreference = 'Stop'

$TarotRepo   = 'C:\Users\Matt\projects\tarot'
$PublishRepo = 'C:\Users\Matt\projects\Miriels-publish'
$KeyPattern  = 'sk-ant-[A-Za-z0-9_-]{12,}'   # a real Anthropic key, not the "sk-ant-..." placeholder

function Fail($msg) { Write-Host "ABORT: $msg" -ForegroundColor Red; exit 1 }

if (-not (Test-Path $PublishRepo)) { Fail "Publish repo not found at $PublishRepo" }
if (-not (Test-Path (Join-Path $PublishRepo '.git'))) { Fail "$PublishRepo is not a git repo" }

# 1. Warn about uncommitted work in the source repo (it will not be published).
$dirty = git -C $TarotRepo status --porcelain
if ($dirty) {
    Write-Host "WARNING: tarot has uncommitted changes; only committed (HEAD) state is published." -ForegroundColor Yellow
}

# 2. Export the committed tree to a temp zip, then unpack into a cleaned publish tree.
Write-Host "Exporting HEAD snapshot from tarot..." -ForegroundColor Cyan
$zip = Join-Path $env:TEMP "miriels-snapshot.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
git -C $TarotRepo archive --format=zip -o $zip HEAD
if ($LASTEXITCODE -ne 0) { Fail "git archive failed" }

# Clear the publish working tree but keep its .git (its own clean history + remote).
Get-ChildItem -Path $PublishRepo -Force |
    Where-Object { $_.Name -ne '.git' } |
    Remove-Item -Recurse -Force

Expand-Archive -Path $zip -DestinationPath $PublishRepo -Force
Remove-Item $zip -Force

# 3. Secret-scan gate. Abort the whole publish if a real key slipped in.
Write-Host "Scanning snapshot for secrets..." -ForegroundColor Cyan
$hits = Get-ChildItem -Path $PublishRepo -Recurse -File |
    Where-Object { $_.FullName -notmatch '\\\.git\\' } |
    Select-String -Pattern $KeyPattern -List
if ($hits) {
    $hits | ForEach-Object { Write-Host "  LEAK: $($_.Path):$($_.LineNumber)" -ForegroundColor Red }
    Fail "Real API key pattern found in snapshot. Nothing pushed."
}
# config.json must never appear (it is untracked, so archive excludes it; verify anyway).
if (Test-Path (Join-Path $PublishRepo 'data\config.json')) {
    Fail "data/config.json present in snapshot. Nothing pushed."
}

# 4. Commit and push the clean snapshot.
Write-Host "Committing and pushing..." -ForegroundColor Cyan
git -C $PublishRepo add -A
$pending = git -C $PublishRepo status --porcelain
if (-not $pending) {
    Write-Host "No changes since last publish. Nothing to push." -ForegroundColor Yellow
    exit 0
}
git -C $PublishRepo -c user.name="mwgrant21" -c user.email="mwgrant21@gmail.com" commit -m $Message
if ($LASTEXITCODE -ne 0) { Fail "commit failed" }
git -C $PublishRepo push origin main
if ($LASTEXITCODE -ne 0) { Fail "push failed (check GitHub auth)" }

Write-Host "Published to github.com/mwgrant21/Miriels (main)." -ForegroundColor Green
