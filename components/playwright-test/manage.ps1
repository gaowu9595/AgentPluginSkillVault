param(
    [Parameter(Mandatory=$true)][ValidateSet('install','status','check','enable','disable','uninstall')][string]$Action,
    [Parameter(Mandatory=$true)][ValidateSet('claude','codex')][string]$Client,
    [string]$Project = (Get-Location).Path,
    [string]$RuntimeRoot
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $node = Join-Path $PSScriptRoot 'bin/node.exe'
    $manager = Join-Path $PSScriptRoot 'scripts/manage.cjs'
    $arguments = @($manager, '--action', $Action, '--client', $Client, '--project', $Project)
    if ($RuntimeRoot) { $arguments += @('--runtime-root', $RuntimeRoot) }
    & $node @arguments
    exit $LASTEXITCODE
} catch {
    @{protocolVersion=1; componentId='playwright-test'; componentVersion='1.0.0'; action=$Action;
        ok=$false; status='error'; message=$_.Exception.Message} | ConvertTo-Json -Compress
    exit 1
}
