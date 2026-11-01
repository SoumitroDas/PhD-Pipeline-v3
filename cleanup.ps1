<#
.SYNOPSIS
    PhD Pipeline v3.1 Guarded - Strict Environment & Temporary File Purge Script
.DESCRIPTION
    Scans the repository root recursively and strips all compiler artifacts, python caches,
    OS metadata (Thumbs.db, .DS_Store), swap files, and temporary logs without touching
    active production code, assets, or local authentication tokens.
#>

$TargetDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $TargetDir) {
    $TargetDir = "D:\AI\phd-pipeline-v3"
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Purging Compiler Artifacts & Cache: $TargetDir" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$PatternsToPurge = @(
    "__pycache__",
    "*.pyc",
    "*.pyo",
    "*.pyd",
    ".DS_Store",
    "Thumbs.db",
    "*~",
    "*.swp",
    "*.swo",
    "*.tmp"
)

$DeletedCount = 0

foreach ($Pattern in $PatternsToPurge) {
    $Items = Get-ChildItem -Path $TargetDir -Recurse -Include $Pattern -Force -ErrorAction SilentlyContinue
    foreach ($Item in $Items) {
        try {
            Remove-Item -Path $Item.FullName -Recurse -Force -ErrorAction Stop
            Write-Host "[-] Removed: $($Item.FullName)" -ForegroundColor Yellow
            $DeletedCount++
        } catch {
            Write-Warning "Failed to delete: $($Item.FullName)"
        }
    }
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Purge Complete! Purged $DeletedCount item(s)." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
