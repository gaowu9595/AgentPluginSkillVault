$ErrorActionPreference = 'Stop'

$pluginRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Get-PluginText {
    param([Parameter(Mandatory = $true)][string]$RelativePath)

    $path = Join-Path $pluginRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing required file: $RelativePath"
    }

    return Get-Content -Raw -Encoding UTF8 -LiteralPath $path
}

$manifestRelative = if (Test-Path -LiteralPath (Join-Path $pluginRoot '.claude-plugin\plugin.json')) {
    '.claude-plugin/plugin.json'
} elseif (Test-Path -LiteralPath (Join-Path $pluginRoot '.codex-plugin\plugin.json')) {
    '.codex-plugin/plugin.json'
} else {
    throw 'Missing plugin manifest (.claude-plugin or .codex-plugin)'
}

$required = @(
    $manifestRelative,
    'README.md',
    'skills/database-review/SKILL.md',
    'skills/database-review/agents/openai.yaml',
    'skills/database-review/references/evidence-template.md',
    'skills/database-review/references/review-criteria.md',
    'skills/database-review/references/report-template.md',
    'skills/database-review/references/reviewer-prompts.md',
    'skills/database-review/references/fixtures/cases.md'
)

foreach ($relative in $required) {
    [void](Get-PluginText -RelativePath $relative)
}

$tokenChecks = [ordered]@{
    $manifestRelative = @(
        '"database-review"'
    )
    'README.md' = @(
        '/design-session:database-review',
        'database-review 强制门禁'
    )
    'skills/database-review/SKILL.md' = @(
        'name: database-review',
        'P0/P1',
        '最小化门禁',
        'quick/delta/full/deterministic-only',
        'blocked',
        'scope_passed'
    )
    'skills/database-review/agents/openai.yaml' = @(
        'display_name: "数据库设计审核"',
        '$database-review'
    )
    'skills/database-review/references/review-criteria.md' = @(
        '逐表审核',
        '逐字段审核',
        '删除挑战',
        '最小化门禁',
        '独立最小模型'
    )
    'skills/database-review/references/evidence-template.md' = @(
        'CODE-FACT',
        'REQ-FACT',
        'DECISION',
        'ASSUMPTION'
    )
    'skills/database-review/references/reviewer-prompts.md' = @(
        '数据模型最小化 Agent',
        '数据库工程 Agent',
        '不要给最终 passed 结论',
        '不创建计划'
    )
    'skills/database-review/references/report-template.md' = @(
        '主 Agent 裁决',
        '最终结论',
        '最小化结论',
        'scope_passed'
    )
}

$manifestText = Get-PluginText -RelativePath $manifestRelative
$manifest = $manifestText | ConvertFrom-Json
$coreVersion = [version](($manifest.version -split '\+')[0])
if ($coreVersion -lt [version]'1.0.2') {
    throw "Plugin version must be at least 1.0.2; actual=$($manifest.version)"
}

foreach ($relative in $tokenChecks.Keys) {
    $text = Get-PluginText -RelativePath $relative
    foreach ($token in $tokenChecks[$relative]) {
        if (-not $text.Contains($token)) {
            throw "Missing token '$token' in $relative"
        }
    }
}

$skillText = Get-PluginText -RelativePath 'skills/database-review/SKILL.md'
if ($skillText -notmatch '(?m)^description: Use when ') {
    throw 'database-review description must start with Use when'
}

$openAiText = Get-PluginText -RelativePath 'skills/database-review/agents/openai.yaml'
$shortDescriptionMatch = [regex]::Match(
    $openAiText,
    '(?m)^\s*short_description:\s*"([^"]+)"\s*$'
)
if (-not $shortDescriptionMatch.Success) {
    throw 'Missing quoted short_description in agents/openai.yaml'
}

$shortDescriptionLength = $shortDescriptionMatch.Groups[1].Value.Length
if ($shortDescriptionLength -lt 25 -or $shortDescriptionLength -gt 64) {
    throw "short_description length must be 25-64, got $shortDescriptionLength"
}

$fixtures = Get-PluginText -RelativePath 'skills/database-review/references/fixtures/cases.md'
1..15 | ForEach-Object {
    $id = 'CASE-{0:d2}' -f $_
    if (-not $fixtures.Contains($id)) {
        throw "Missing fixture: $id"
    }
}

$hooks = [ordered]@{
    'skills/write/SKILL.md' = 'database-review'
    'skills/check/SKILL.md' = 'check database'
    'skills/change/SKILL.md' = 'database-review: stale'
    'skills/next/SKILL.md' = '数据库审核'
    'skills/help/SKILL.md' = '/design-session:database-review'
}

foreach ($relative in $hooks.Keys) {
    $text = Get-PluginText -RelativePath $relative
    if (-not $text.Contains($hooks[$relative])) {
        throw "Missing workflow hook '$($hooks[$relative])' in $relative"
    }
}

Write-Host 'database-review skill validation passed'
