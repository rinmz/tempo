# Builds the Chrome Web Store upload: dist/tempo-<version>.zip
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File store\package.ps1
#
# Entries are written with forward slashes. (Compress-Archive in Windows
# PowerShell 5.1 writes backslashes, which other platforms don't read as folders.)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version

# Only the files the extension needs (no store/, dist/ or dev files).
$include = @('manifest.json', 'background.js', 'content.js', 'page.js', 'style.css',
             '_locales', 'icons', 'popup', 'welcome', 'privacy')

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "tempo-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$files = foreach ($item in $include) {
  $full = Join-Path $root $item
  if (-not (Test-Path $full)) { throw "Missing: $full" }
  if ((Get-Item $full).PSIsContainer) { Get-ChildItem $full -Recurse -File } else { Get-Item $full }
}

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    $name = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $name, 'Optimal') | Out-Null
  }
} finally {
  $zip.Dispose()
}

Write-Host "Created $zipPath ($($files.Count) files)"
