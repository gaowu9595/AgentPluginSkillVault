$ErrorActionPreference = "Stop"
$failures = [System.Collections.Generic.List[string]]::new()
$pluginRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$targets = @(
    (Join-Path $pluginRoot "skills\write\SKILL.md"),
    (Join-Path $pluginRoot "skills\check\SKILL.md")
)
$required = @("权限事实源", "复用或新增", "代码证据", "禁止创造", "项目校验命令")
$forbidden = @("channel-mssp", "mss-auth", "mongodb_permission_points", "app_page")
$pattern = "(?s)<!-- permission-evidence-gate:start -->(.*?)<!-- permission-evidence-gate:end -->"

foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target)) {
        $failures.Add("missing file: $target")
        continue
    }
    $content = Get-Content -LiteralPath $target -Raw -Encoding UTF8
    $match = [regex]::Match($content, $pattern)
    if (-not $match.Success) {
        $failures.Add("missing permission evidence block: $target")
        continue
    }
    $block = $match.Groups[1].Value
    foreach ($token in $required) {
        if (-not $block.Contains($token)) {
            $failures.Add("$target missing generic token: $token")
        }
    }
    foreach ($token in $forbidden) {
        if ($block.Contains($token)) {
            $failures.Add("$target contains project-specific token: $token")
        }
    }
}

if ($failures.Count -gt 0) {
    "STATUS=FAIL"
    $failures | ForEach-Object { "- $_" }
    exit 1
}

"STATUS=PASS"
"FILES=$($targets.Count)"
