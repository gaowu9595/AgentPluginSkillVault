param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$OutDir,
    [ValidateSet('all', 'png', 'structure')][string]$Mode = 'all',
    [string]$LayerId,
    [string]$PageId,
    [string]$PlaywrightModule,
    [string]$BrowserPath,
    [string]$ProfileDir,
    [int]$TimeoutMs = 90000,
    [switch]$IgnoreHttpsErrors,
    [switch]$Plan
)

$ErrorActionPreference = 'Stop'
$originalToken = $env:MG_MCP_TOKEN
$exitCode = 1
try {
    if ([string]::IsNullOrWhiteSpace($env:MG_MCP_TOKEN)) {
        foreach ($scope in @('User', 'Machine')) {
            $existingToken = [Environment]::GetEnvironmentVariable('MG_MCP_TOKEN', $scope)
            if (-not [string]::IsNullOrWhiteSpace($existingToken)) {
                $env:MG_MCP_TOKEN = $existingToken
                break
            }
        }
    }
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    $scriptFile = Join-Path $PSScriptRoot 'fetch_mastergo.cjs'
    $arguments = @($scriptFile, '--url', $Url, '--out-dir', $OutDir, '--mode', $Mode, '--timeout-ms', $TimeoutMs.ToString())
    $optionalValues = @{
        '--layer-id' = $LayerId; '--page-id' = $PageId; '--playwright-module' = $PlaywrightModule
        '--browser-path' = $BrowserPath; '--profile-dir' = $ProfileDir
    }
    foreach ($key in $optionalValues.Keys) {
        if ($optionalValues[$key]) { $arguments += @($key, $optionalValues[$key]) }
    }
    if ($IgnoreHttpsErrors) { $arguments += '--ignore-https-errors' }
    if ($Plan) { $arguments += '--plan' }
    & $nodeExe @arguments
    $exitCode = $LASTEXITCODE
} finally {
    $env:MG_MCP_TOKEN = $originalToken
    $existingToken = $null
}
exit $exitCode
