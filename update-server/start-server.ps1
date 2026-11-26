param(
  [Parameter(Mandatory = $true)][string]$Domain,
  [string]$Email = ""
)
$ErrorActionPreference = "Stop"
if (-not $env:NEXA_RELEASE_TOKEN) {
  throw "Set NEXA_RELEASE_TOKEN before starting the release server. Do not store it in this file."
}
$env:NEXA_DOMAIN = $Domain
$env:NEXA_FEED_DIR = Join-Path $PSScriptRoot "..\release-feed"
Push-Location $PSScriptRoot
try {
  $caddy = Get-Command caddy -ErrorAction SilentlyContinue
  if (-not $caddy) { throw "Install Caddy for Windows and add it to PATH." }
  $arguments = @("run", "--config", "Caddyfile", "--adapter", "caddyfile")
  if ($Email) { $arguments += @("--email", $Email) }
  & $caddy.Source @arguments
} finally {
  Pop-Location
}
