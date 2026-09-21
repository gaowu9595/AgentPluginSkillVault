param(
    [string]$ApiBaseUrl = "https://seerdesignmg.sangfor.com"
)

$ErrorActionPreference = "Stop"

$token = [Environment]::GetEnvironmentVariable("MG_MCP_TOKEN", "Process")
if ([string]::IsNullOrWhiteSpace($token)) {
    $token = [Environment]::GetEnvironmentVariable("MG_MCP_TOKEN", "User")
}
if ([string]::IsNullOrWhiteSpace($token)) {
    $token = [Environment]::GetEnvironmentVariable("MG_MCP_TOKEN", "Machine")
}

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Error "MG_MCP_TOKEN is not set in Process/User/Machine environment variables."
    exit 1
}

$env:MG_MCP_TOKEN = $token
$env:API_BASE_URL = $ApiBaseUrl

npx -y @mastergo/magic-mcp --url=$ApiBaseUrl
