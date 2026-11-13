param(
    [Parameter(Mandatory=$true)][ValidateSet('install','status','check','enable','disable','uninstall','configure','start','stop','viewer')][string]$Action,
    [Parameter(Mandatory=$true)][ValidateSet('claude','codex')][string]$Client,
    [string]$Project = (Get-Location).Path,
    [string]$RuntimeRoot,
    [string]$DataRoot,
    [string]$ClaudeHome,
    [switch]$Capture
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $arguments = @((Join-Path $PSScriptRoot 'scripts/manage.cjs'), '--action', $Action, '--client', $Client, '--project', $Project)
    if ($RuntimeRoot) { $arguments += @('--runtime-root', $RuntimeRoot) }
    if ($DataRoot) { $arguments += @('--data-root', $DataRoot) }
    if ($ClaudeHome) { $arguments += @('--claude-home', $ClaudeHome) }
    if ($Capture) { $arguments += @('--capture', 'true') }
    & (Join-Path $PSScriptRoot 'bin/node.exe') @arguments
    exit $LASTEXITCODE
} catch {
    @{protocolVersion=1; componentId='claude-mem'; componentVersion='1.0.0'; action=$Action;
        ok=$false; status='error'; message=$_.Exception.Message} | ConvertTo-Json -Compress
    exit 1
}
