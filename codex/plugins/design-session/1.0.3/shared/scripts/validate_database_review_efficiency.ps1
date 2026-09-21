param(
    [string]$PluginRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

function Read-RequiredFile {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $path = Join-Path $PluginRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing required file: $RelativePath"
    }
    Get-Content -Raw -Encoding UTF8 -LiteralPath $path
}

$skill = Read-RequiredFile 'skills/database-review/SKILL.md'
$criteria = Read-RequiredFile 'skills/database-review/references/review-criteria.md'
$evidence = Read-RequiredFile 'skills/database-review/references/evidence-template.md'
$prompts = Read-RequiredFile 'skills/database-review/references/reviewer-prompts.md'
$report = Read-RequiredFile 'skills/database-review/references/report-template.md'
$fixtures = Read-RequiredFile 'skills/database-review/references/fixtures/cases.md'

$checks = [ordered]@{
    'SKILL.md' = @(
        'review-mode: full/delta/deterministic-only',
        'failed-baseline-can-delta',
        'no-fullstack-agent',
        'p2-no-loop',
        'max-auto-repair-rounds: 1',
        'fail-fast-codes: 401/402/403',
        'no-retry-payment-auth',
        'coding_readiness'
    )
    'review-criteria.md' = @(
        'complete-baseline',
        'change-impact-matrix',
        'coverage-inheritance',
        'transaction-topology'
    )
    'evidence-template.md' = @(
        'baseline-review-chain',
        'delta-change-manifest',
        'unchanged-scope-inheritance',
        'estimated-review-cost'
    )
    'reviewer-prompts.md' = @(
        'delta-data-model-reviewer',
        'delta-money-engineering-reviewer',
        'do-not-reread-full-design',
        'affected-scope-only'
    )
    'report-template.md' = @(
        'review-mode-and-cost',
        'inherited-coverage-conclusions',
        'automatic-repair-rounds',
        'coding_readiness'
    )
}

$texts = @{
    'SKILL.md' = $skill
    'review-criteria.md' = $criteria
    'evidence-template.md' = $evidence
    'reviewer-prompts.md' = $prompts
    'report-template.md' = $report
}

foreach ($file in $checks.Keys) {
    foreach ($token in $checks[$file]) {
        if (-not $texts[$file].Contains($token)) {
            throw "Missing V2 token '$token' in $file"
        }
    }
}

if ($skill.Contains('仅在已有有效通过标记')) {
    throw 'Legacy rule still forces failed complete baselines back to full review'
}

10..14 | ForEach-Object {
    $caseId = 'CASE-{0:d2}' -f $_
    if (-not $fixtures.Contains($caseId)) {
        throw "Missing efficiency fixture: $caseId"
    }
}

$modeRows = @(
    'M1 no-complete-baseline=>full',
    'M2 failed-complete-baseline+local-check-change=>delta',
    'M3 table-topology-change=>full',
    'M4 transaction-topology-change=>full',
    'M5 explanation-or-format-only=>deterministic-only'
)
foreach ($row in $modeRows) {
    if (-not $criteria.Contains($row)) {
        throw "Missing mode decision row: $row"
    }
}

Write-Host 'database-review efficiency validation passed'
