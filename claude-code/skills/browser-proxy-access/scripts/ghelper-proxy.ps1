[CmdletBinding()]
param(
    [ValidateSet("All", "Chrome", "Edge")]
    [string]$Profile = "All",

    [switch]$List,
    [switch]$Fastest,

    [int]$Index = 0,
    [int]$Limit = 12,
    [int]$ScriptSample = 5,
    [int]$TimeoutSeconds = 8,

    [string]$TestUrl = "https://www.google.com/generate_204",

    [switch]$NoBrowserPac,
    [switch]$KnownExtensionsOnly,
    [switch]$NoExistingEnv,
    [switch]$NoSystemProxy,
    [switch]$NoCommonLocal,

    [switch]$PrintEnv,
    [string]$RunCommand,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Run
)

$ErrorActionPreference = "Stop"

$pythonScript = Join-Path $PSScriptRoot "ghelper-proxy.py"
if (-not (Test-Path -LiteralPath $pythonScript)) {
    throw "Missing helper script: $pythonScript"
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $python) {
    throw "Python is required for Ghelper PAC parsing, but python/py was not found in PATH."
}

$argsList = @(
    $pythonScript,
    "--profile", $Profile,
    "--limit", $Limit,
    "--script-sample", $ScriptSample,
    "--timeout", $TimeoutSeconds,
    "--test-url", $TestUrl
)

if ($List) { $argsList += "--list" }
if ($Fastest) { $argsList += "--fastest" }
if ($Index -gt 0) { $argsList += @("--index", $Index) }
if ($NoBrowserPac) { $argsList += "--no-use-browser-pac" }
if ($KnownExtensionsOnly) { $argsList += "--known-extensions-only" }
if ($NoExistingEnv) { $argsList += "--no-use-existing-env" }
if ($NoSystemProxy) { $argsList += "--no-use-system-proxy" }
if ($NoCommonLocal) { $argsList += "--no-use-common-local" }
if ($PrintEnv) { $argsList += "--print-env" }
if ($RunCommand) { $argsList += @("--run-command", $RunCommand) }
if ($Run) {
    $argsList += "--run"
    $argsList += $Run
}

& $python.Source @argsList
exit $LASTEXITCODE
