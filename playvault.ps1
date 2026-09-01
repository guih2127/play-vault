[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [switch]$Install
)

$ErrorActionPreference = 'Stop'
$root     = $PSScriptRoot
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

function Ensure-Deps($dir) {
    $modules = Join-Path $dir 'node_modules'
    if ($Install -or -not (Test-Path $modules)) {
        Write-Host "Installing dependencies in '$dir'..." -ForegroundColor Cyan
        Push-Location $dir
        try { npm install } finally { Pop-Location }
    }
}

function Wait-Url($url, $label, $timeoutSec = 90) {
    Write-Host "Waiting for $label ($url)..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null
            Write-Host "$label ready." -ForegroundColor Green
            return $true
        } catch {
            if ($_.Exception.Response) {
                Write-Host "$label ready." -ForegroundColor Green
                return $true
            }
        }
        Start-Sleep -Milliseconds 700
    }
    Write-Warning "$label did not respond within ${timeoutSec}s."
    return $false
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js not found in PATH. Install Node 24+."
}
$nodeMajor = (node -v).TrimStart('v').Split('.')[0] -as [int]
if ($nodeMajor -lt 24) {
    Write-Warning "Node $((node -v)) detected. The backend uses node:sqlite and requires Node 24+."
}
if (-not (Test-Path (Join-Path $backend '.env'))) {
    Write-Warning "backend\.env not found - the backend may fail. See the README."
}

Ensure-Deps $backend
Ensure-Deps $frontend

$procs = @()
try {
    Write-Host "Starting backend (port 3000)..." -ForegroundColor Green
    $procs += Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run start:dev' `
        -WorkingDirectory $backend -NoNewWindow -PassThru

    Write-Host "Starting frontend (port 5173)..." -ForegroundColor Green
    $procs += Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' `
        -WorkingDirectory $frontend -NoNewWindow -PassThru

    if (-not $NoBrowser) {
        if (Wait-Url 'http://localhost:3000/api/providers' 'backend') {
            Wait-Url 'http://localhost:5173' 'frontend' 30 | Out-Null
            Start-Process 'http://localhost:5173'
        }
    }

    Write-Host ""
    Write-Host "PlayVault running in this window:" -ForegroundColor Green
    Write-Host "  frontend -> http://localhost:5173"
    Write-Host "  backend  -> http://localhost:3000/api"
    Write-Host "Press Ctrl+C to stop both." -ForegroundColor DarkGray

    Wait-Process -Id ($procs | ForEach-Object { $_.Id })
}
finally {
    foreach ($p in $procs) {
        if ($p -and -not $p.HasExited) {
            taskkill /PID $p.Id /T /F *> $null
        }
    }
    Write-Host "PlayVault stopped." -ForegroundColor DarkGray
}
