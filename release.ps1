[CmdletBinding()]
param(
    [string]$Tag = "v1.0.0",
    [string]$RemoteUrl = "https://github.com/D1verlin/ProxyRouterDesktop.git",
    [switch]$SkipBuildCheck,
    [switch]$NoPush
)

& "$PSScriptRoot/scripts/release.ps1" -Tag $Tag -RemoteUrl $RemoteUrl -SkipBuildCheck:$SkipBuildCheck -NoPush:$NoPush
