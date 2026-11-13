param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..\.."))
)

$ErrorActionPreference = "Stop"
$failures = [System.Collections.Generic.List[string]]::new()

function Require-Text {
    param([string]$Path, [string[]]$Patterns)

    if (-not (Test-Path -LiteralPath $Path)) {
        $failures.Add("missing file: $Path")
        return
    }

    $content = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    foreach ($pattern in $Patterns) {
        if (-not $content.Contains($pattern)) {
            $failures.Add("$Path missing rule: $pattern")
        }
    }
}

$pluginRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$writeSkill = Join-Path $pluginRoot "skills\write\SKILL.md"
$guide = Join-Path $pluginRoot "skills\write\references\design-guide.md"
$template = Join-Path $pluginRoot "skills\write\references\design-template.md"
$checkSkill = Join-Path $pluginRoot "skills\check\SKILL.md"
$databaseReview = Join-Path $pluginRoot "skills\database-review\SKILL.md"
$validator = Join-Path $PSScriptRoot "validate_design_readability.ps1"

Require-Text $writeSkill @("评审主文档", "编码附件", "validate_design_readability.ps1", "结论先行")
Require-Text $guide @("60000", "1.5", "300", "500", "150", "结论先行")
Require-Text $template @("编码附件", "结论先行", "完整 DDL")
Require-Text $checkSkill @("design-quality", "validate_design_readability.ps1")
Require-Text $databaseReview @("数据库编码契约", "主概要设计只回写", "不得把 Agent")

if (-not (Test-Path -LiteralPath $validator)) {
    $failures.Add("missing validator: $validator")
} else {
    $main = Join-Path $WorkspaceRoot "OverseaPartner\架构设计\概要设计\迭代3-按月计费概要设计-V1.3.md"
    $peer = Split-Path -Parent $main
    $attachments = @(
        (Join-Path $peer "迭代3-按月计费-接口与前端编码契约.md"),
        (Join-Path $peer "迭代3-按月计费-数据库编码契约.md"),
        (Join-Path $peer "迭代3-按月计费-测试与发布附录.md")
    )
    $baseline = Join-Path ([System.IO.Path]::GetTempPath()) "monthly-billing-r13-$PID.md"

    try {
        $old = & git -C $WorkspaceRoot show "126dad8c:OverseaPartner/架构设计/概要设计/迭代3-按月计费概要设计-V1.3.md"
        if ($LASTEXITCODE -ne 0) {
            throw "cannot load baseline commit 126dad8c"
        }
        [System.IO.File]::WriteAllLines($baseline, $old, [System.Text.UTF8Encoding]::new($false))

        $redOutput = & $validator -MainDocument $baseline -PeerDirectory $peer 2>&1
        if ($LASTEXITCODE -eq 0) {
            $failures.Add("r13 must fail readability validation")
        }
        if (($redOutput -join "`n") -notmatch "STATUS=FAIL") {
            $failures.Add("r13 failure must emit STATUS=FAIL")
        }

        $greenOutput = & $validator -MainDocument $main -PeerDirectory $peer -Attachments $attachments -BaselineDocument $baseline 2>&1
        if ($LASTEXITCODE -ne 0) {
            $failures.Add("r14 must pass: $($greenOutput -join '; ')")
        }

        $lossOutput = & $validator -MainDocument $main -PeerDirectory $peer -Attachments $attachments[0] -BaselineDocument $baseline 2>&1
        if ($LASTEXITCODE -eq 0) {
            $failures.Add("r14 with incomplete attachments must fail no-loss validation")
        }
        if (($lossOutput -join "`n") -notmatch "STATUS=FAIL") {
            $failures.Add("no-loss failure must emit STATUS=FAIL")
        }
    } finally {
        Remove-Item -LiteralPath $baseline -ErrorAction SilentlyContinue
    }
}

if ($failures.Count -gt 0) {
    "STATUS=FAIL"
    $failures | ForEach-Object { "- $_" }
    exit 1
}

"STATUS=PASS"
"SCENARIOS=3"
