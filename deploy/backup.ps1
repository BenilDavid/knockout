param([string]$OutputDirectory = '.\backups', [string]$ComposeFile = 'compose.yaml')
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$file = Join-Path (Resolve-Path -LiteralPath $OutputDirectory) "knockout-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
# Dump inside the container and copy binary bytes without PowerShell redirection.
docker compose -f $ComposeFile exec -T db pg_dump -U knockout -d knockout -Fc -f /tmp/knockout-backup.dump
if ($LASTEXITCODE -ne 0) { throw 'Database dump failed.' }
docker compose -f $ComposeFile cp db:/tmp/knockout-backup.dump $file
if ($LASTEXITCODE -ne 0) { throw 'Backup copy failed.' }
Write-Output "Backup saved: $file"
