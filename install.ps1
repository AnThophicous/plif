<#
.SYNOPSIS
    Install plif.

.DESCRIPTION
    Checks that Node is new enough, then installs the `@plif/cli` package
    globally from npm. The command it puts on your PATH is `plif`. Nothing runs
    as administrator and nothing is written outside npm's own global prefix, so
    `npm uninstall -g @plif/cli` is a complete removal.

    npm is the delivery mechanism on purpose: it already solves integrity
    checking, version pinning, PATH shims on every platform, and rollback. A
    bespoke downloader would reimplement all four, worse.

.EXAMPLE
    irm https://raw.githubusercontent.com/AnThophicous/plif/main/install.ps1 | iex

.EXAMPLE
    # A specific version, or a rollback.
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/AnThophicous/plif/main/install.ps1))) -Version 0.1.0

.EXAMPLE
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/AnThophicous/plif/main/install.ps1))) -Uninstall
#>

[CmdletBinding()]
param(
    # An npm version or dist-tag. Defaults to the latest release.
    [string] $Version = 'latest',

    # Remove plif.
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Package = '@plif/cli'
$MinimumNode = [Version]'20.11.0'

function Write-Step { param([string] $Message) Write-Host "  $Message" -ForegroundColor Cyan }
function Write-Done { param([string] $Message) Write-Host "  $Message" -ForegroundColor Green }
function Write-Note { param([string] $Message) Write-Host "  $Message" -ForegroundColor DarkGray }

function Fail {
    param([string] $Message, [string] $Hint)
    Write-Host ''
    Write-Host "  plif: $Message" -ForegroundColor Red
    if ($Hint) { Write-Host "  $Hint" -ForegroundColor DarkGray }
    Write-Host ''
    exit 1
}

Write-Host ''
Write-Host '  plif' -ForegroundColor White
Write-Host '  a container-native coding agent for your terminal' -ForegroundColor DarkGray
Write-Host ''

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

if ($Uninstall) {
    Write-Step 'removing plif'
    & npm uninstall -g $Package
    if ($LASTEXITCODE -ne 0) { Fail 'npm could not remove plif.' "Try running: npm uninstall -g $Package" }

    Write-Done 'plif removed'
    Write-Host ''
    Write-Note 'Your sessions, containers and saved credentials were left alone:'
    Write-Note "  $(Join-Path $env:USERPROFILE '.plif')"
    Write-Note "  $(Join-Path $env:USERPROFILE '.config\PlifCode')"
    Write-Note 'Delete those by hand if you want them gone too.'
    Write-Host ''
    exit 0
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Fail 'Node.js is not installed, and plif runs on it.' 'Install Node 20.11 or newer from https://nodejs.org, then run this again.'
}

$rawVersion = (& node --version) -replace '^v', ''
try { $nodeVersion = [Version] ($rawVersion -split '-')[0] } catch { $nodeVersion = $null }
if (-not $nodeVersion -or $nodeVersion -lt $MinimumNode) {
    Fail "Node $rawVersion is too old. plif needs $MinimumNode or newer." 'Update Node from https://nodejs.org, then run this again.'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail 'npm was not found, though Node is installed.' 'Reinstall Node from https://nodejs.org so npm comes with it.'
}

Write-Note "node $rawVersion"

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

Write-Step "installing $Package@$Version"
& npm install -g "$Package@$Version" --loglevel=error
if ($LASTEXITCODE -ne 0) {
    Fail 'npm could not install plif.' "Run it directly to see why: npm install -g $Package@$Version"
}

$installed = Get-Command plif -ErrorAction SilentlyContinue
if (-not $installed) {
    Write-Host ''
    Write-Done 'plif installed'
    Write-Note 'It is not on this shell''s PATH yet. Open a new terminal and run: plif'
    Write-Host ''
    exit 0
}

$reported = (& plif version) -join ' '

Write-Host ''
Write-Done $reported.Trim()
Write-Host ''
Write-Host '  Run it:' -ForegroundColor White
Write-Host '    plif' -ForegroundColor Cyan
Write-Host ''
Write-Note 'plif ships with no model configured and no keys of anyone else''s.'
Write-Note 'Start it, press / and pick a model. The default one is free.'
Write-Host ''
