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

$texts = @{
    'SKILL.md' = Read-RequiredFile 'skills/database-review/SKILL.md'
    'review-criteria.md' = Read-RequiredFile 'skills/database-review/references/review-criteria.md'
    'evidence-template.md' = Read-RequiredFile 'skills/database-review/references/evidence-template.md'
    'reviewer-prompts.md' = Read-RequiredFile 'skills/database-review/references/reviewer-prompts.md'
    'report-template.md' = Read-RequiredFile 'skills/database-review/references/report-template.md'
    'fixtures.md' = Read-RequiredFile 'skills/database-review/references/fixtures/cases.md'
    'write-skill.md' = Read-RequiredFile 'skills/write/SKILL.md'
}

$checks = [ordered]@{
    'SKILL.md' = @(
        'review-mode: quick/delta/full/deterministic-only',
        'review-only-no-plan',
        'no-auto-full-escalation',
        'minimality-first',
        'risk-based-new-field',
        'max-agents-quick-0-delta-1-full-2',
        'scope_passed',
        'needs_full'
    )
    'review-criteria.md' = @(
        'M1-local-field=>quick',
        'M3-bounded-semantic-change=>delta',
        'M4-table-topology-change=>full',
        'object-baseline',
        'coverage-inheritance'
    )
    'evidence-template.md' = @(
        'template-kind: database-review-evidence-v3',
        'quick-no-full-evidence',
        'implementation plan'
    )
    'reviewer-prompts.md' = @(
        'quick-no-agent',
        'independent-minimal-model',
        'review-no-plan'
    )
    'report-template.md' = @(
        'template-kind: database-review-report-v3',
        'scope-result-supported',
        'scope_passed'
    )
    'write-skill.md' = @(
        'database-review-auto-route',
        'database-review-no-force-full',
        'scope_passed'
    )
}

foreach ($file in $checks.Keys) {
    foreach ($token in $checks[$file]) {
        if (-not $texts[$file].Contains($token)) {
            throw "Missing efficiency token '$token' in $file"
        }
    }
}

if ($texts['write-skill.md'].Contains('execute-full-database-review')) {
    throw 'write skill still forces full database review'
}

1..15 | ForEach-Object {
    $caseId = 'CASE-{0:d2}' -f $_
    if (-not $texts['fixtures.md'].Contains($caseId)) {
        throw "Missing generic fixture: $caseId"
    }
}

$databaseReviewRoot = Join-Path $PluginRoot 'skills/database-review'
$allSkillText = (Get-ChildItem -LiteralPath $databaseReviewRoot -Recurse -File |
    ForEach-Object { Get-Content -Raw -Encoding UTF8 -LiteralPath $_.FullName }) -join "`n"

$forbiddenProjectTerms = @(
    'OverseaPartner',
    'monthly_credit',
    'credit_change',
    'reserved_amount',
    'shortfall_points',
    'invoice_item'
)

foreach ($term in $forbiddenProjectTerms) {
    if ($allSkillText.Contains($term)) {
        throw "Project-specific term '$term' found in database-review skill"
    }
}

Write-Host 'database-review generic efficiency validation passed'
