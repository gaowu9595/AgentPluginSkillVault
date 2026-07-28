param(
    [Parameter(Mandatory = $true)]
    [string]$MainDocument,

    [string]$PeerDirectory,

    [string[]]$Attachments = @(),

    [string]$BaselineDocument,

    [int]$HardCharacterLimit = 60000,

    [double]$PeerMultiplier = 1.5,

    [int]$ParagraphWarningLength = 300,

    [int]$ParagraphFailureLength = 500,

    [int]$CodeBlockLineLimit = 150
)

$ErrorActionPreference = "Stop"
$errors = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Read-Utf8Text {
    param([string]$Path)
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8
}

function Get-NonSpaceLength {
    param([string]$Text)
    return [regex]::Replace($Text, "\s", "").Length
}

function Get-Median {
    param([long[]]$Values)

    if (-not $Values -or $Values.Count -eq 0) {
        return 0
    }

    $sorted = @($Values | Sort-Object)
    $middle = [math]::Floor($sorted.Count / 2)
    if (($sorted.Count % 2) -eq 1) {
        return [long]$sorted[$middle]
    }
    return [long](($sorted[$middle - 1] + $sorted[$middle]) / 2)
}

function Get-ParagraphMetrics {
    param([string[]]$Lines)

    $inCode = $false
    $buffer = [System.Collections.Generic.List[string]]::new()
    $lengths = [System.Collections.Generic.List[int]]::new()

    function Flush-Paragraph {
        if ($buffer.Count -gt 0) {
            $joined = $buffer -join " "
            $lengths.Add(([regex]::Replace($joined, "\s", "")).Length)
            $buffer.Clear()
        }
    }

    foreach ($line in @($Lines) + "") {
        if ($line -match '^```') {
            Flush-Paragraph
            $inCode = -not $inCode
            continue
        }

        $structural = $inCode `
            -or [string]::IsNullOrWhiteSpace($line) `
            -or $line -match "^#" `
            -or $line -match "^\|" `
            -or $line -match "^[-*] " `
            -or $line -match "^\d+\. " `
            -or $line -match "^>" `
            -or $line -eq "---"

        if ($structural) {
            Flush-Paragraph
        } else {
            $buffer.Add($line)
        }
    }

    return [pscustomobject]@{
        OverWarning = @($lengths | Where-Object { $_ -gt $ParagraphWarningLength }).Count
        OverFailure = @($lengths | Where-Object { $_ -gt $ParagraphFailureLength }).Count
        Longest = if ($lengths.Count -gt 0) { ($lengths | Measure-Object -Maximum).Maximum } else { 0 }
    }
}

function Get-CodeBlockMetrics {
    param([string[]]$Lines)

    $inCode = $false
    $current = 0
    $maximum = 0
    $count = 0
    foreach ($line in $Lines) {
        if ($line -match '^```') {
            if ($inCode) {
                $maximum = [math]::Max($maximum, $current)
                $count++
                $current = 0
            }
            $inCode = -not $inCode
            continue
        }
        if ($inCode) {
            $current++
        }
    }

    if ($inCode) {
        $errors.Add("unbalanced fenced code block")
    }

    return [pscustomobject]@{
        Count = $count
        MaximumLines = $maximum
    }
}

function Get-Section {
    param([string]$Text, [string]$StartPattern, [string]$EndPattern)

    $start = [regex]::Match($Text, $StartPattern, [Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $start.Success) {
        return ""
    }

    $tail = $Text.Substring($start.Index)
    $end = [regex]::Match($tail.Substring($start.Length), $EndPattern, [Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $end.Success) {
        return $tail
    }
    return $tail.Substring(0, $start.Length + $end.Index)
}

function Normalize-Block {
    param([string]$Text)
    return (($Text.Replace("`r", "").Split("`n") | ForEach-Object { $_.TrimEnd() }) -join "`n").Trim()
}

if (-not (Test-Path -LiteralPath $MainDocument -PathType Leaf)) {
    "STATUS=FAIL"
    "ERROR=main document not found: $MainDocument"
    exit 1
}

$mainPath = (Resolve-Path -LiteralPath $MainDocument).Path
$mainText = Read-Utf8Text $mainPath
$mainLines = Get-Content -LiteralPath $mainPath -Encoding UTF8
$mainCharacters = Get-NonSpaceLength $mainText

$mandatoryPatterns = @(
    "(?m)^## 1\.",
    "(?m)^## 2\.",
    "(?m)^## 3\.",
    "(?m)^## 4\.",
    "(?m)^#{3,5} 4\.6\.1\b",
    "(?m)^#{3,5} 4\.6\.2\b",
    "(?m)^## 5\.",
    "(?m)^## 6\.",
    "(?m)^## 7\.",
    "(?m)^## 8\.",
    "(?m)^## 9\.",
    "(?m)^## 10\.",
    "(?m)^## .*Checklist"
)
foreach ($pattern in $mandatoryPatterns) {
    if ($mainText -notmatch $pattern) {
        $errors.Add("missing mandatory section: $pattern")
    }
}

$peerLengths = [System.Collections.Generic.List[long]]::new()
if ($PeerDirectory -and (Test-Path -LiteralPath $PeerDirectory -PathType Container)) {
    foreach ($file in Get-ChildItem -LiteralPath $PeerDirectory -Filter "*.md" -File) {
        if ($file.FullName -eq $mainPath -or $file.Name -match "编码契约|附录|微型|历史") {
            continue
        }
        $text = Read-Utf8Text $file.FullName
        if ($text -match "(?m)^## 5\." -and $text -match "(?m)^## 6\.") {
            $peerLengths.Add((Get-NonSpaceLength $text))
        }
    }
}

$peerMedian = Get-Median $peerLengths.ToArray()
$adaptiveLimit = if ($peerMedian -gt 0) {
    [long][math]::Ceiling($peerMedian * $PeerMultiplier)
} else {
    $HardCharacterLimit
}
$effectiveLimit = [math]::Max($HardCharacterLimit, $adaptiveLimit)
if ($mainCharacters -gt $effectiveLimit) {
    $errors.Add("main document too large: $mainCharacters > $effectiveLimit")
}

$paragraphs = Get-ParagraphMetrics $mainLines
if ($paragraphs.OverWarning -gt 0) {
    $warnings.Add("paragraphs over $ParagraphWarningLength chars: $($paragraphs.OverWarning)")
}
if ($paragraphs.OverFailure -gt 0) {
    $errors.Add("paragraphs over $ParagraphFailureLength chars: $($paragraphs.OverFailure)")
}

$codeBlocks = Get-CodeBlockMetrics $mainLines
if ($codeBlocks.MaximumLines -gt $CodeBlockLineLimit) {
    $errors.Add("code block too large: $($codeBlocks.MaximumLines) lines > $CodeBlockLineLimit")
}

$selection = Get-Section $mainText "^### 4\.2\b.*$" "^### 4\.3\b"
if (-not $selection) {
    $errors.Add("missing solution selection section 4.2")
} else {
    if ($selection -notmatch "结论先行|最终选择|推荐方案") {
        $errors.Add("section 4.2 must lead with the selected solution")
    }
    if ($selection -notmatch "方案对比|整体方案") {
        $errors.Add("section 4.2 must compare overall alternatives")
    }
    if ($selection -notmatch "用户旅程|业务流程|申请.*计费") {
        $errors.Add("section 4.2 must order local decisions by the business journey")
    }
    if ($selection -notmatch "方案边界|范围边界|不做") {
        $errors.Add("section 4.2 must state scope boundaries")
    }
}

$resolvedAttachments = [System.Collections.Generic.List[string]]::new()
foreach ($attachment in $Attachments) {
    if (-not (Test-Path -LiteralPath $attachment -PathType Leaf)) {
        $errors.Add("attachment not found: $attachment")
    } else {
        $resolvedAttachments.Add((Resolve-Path -LiteralPath $attachment).Path)
    }
}

$baseDirectory = Split-Path -Parent $mainPath
foreach ($match in [regex]::Matches($mainText, "\[[^\]]+\]\(([^)]+)\)")) {
    $target = $match.Groups[1].Value.Trim("<", ">")
    if ($target -match "^(https?://|mailto:|#)") {
        continue
    }
    $relative = ($target -split "#")[0]
    if ([string]::IsNullOrWhiteSpace($relative)) {
        continue
    }
    $resolved = [System.IO.Path]::GetFullPath((Join-Path $baseDirectory $relative))
    if (-not (Test-Path -LiteralPath $resolved)) {
        $errors.Add("broken local link: $target")
    }
}

if ($BaselineDocument) {
    if (-not (Test-Path -LiteralPath $BaselineDocument -PathType Leaf)) {
        $errors.Add("baseline document not found: $BaselineDocument")
    } elseif ($resolvedAttachments.Count -eq 0) {
        $errors.Add("baseline comparison requires attachments")
    } else {
        $baselineText = Read-Utf8Text $BaselineDocument
        $combinedText = $mainText
        foreach ($attachment in $resolvedAttachments) {
            $combinedText += "`n" + (Read-Utf8Text $attachment)
        }
        $normalizedCombined = Normalize-Block $combinedText

        $blocks = [regex]::Matches(
            $baselineText,
            '(?ms)^```[^\r\n]*\r?\n(.*?)^```\s*$'
        )
        $missingBlocks = 0
        foreach ($block in $blocks) {
            $body = Normalize-Block $block.Groups[1].Value
            if (($body -split "`n").Count -lt 5) {
                continue
            }
            if (-not $normalizedCombined.Contains($body)) {
                $missingBlocks++
            }
        }
        if ($missingBlocks -gt 0) {
            $errors.Add("baseline fenced blocks missing from main+attachments: $missingBlocks")
        }

        $tokens = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($match in [regex]::Matches($baselineText, '`([^`\r\n]{3,128})`')) {
            $token = $match.Groups[1].Value
            if ($token -match "^[A-Za-z_][A-Za-z0-9_./:+*?{}<>=\-\[\](), |]*$") {
                [void]$tokens.Add($token)
            }
        }
        $compactCombined = [regex]::Replace($combinedText, '\s', '')
        $missingTokens = [System.Collections.Generic.List[string]]::new()
        foreach ($candidate in $tokens) {
            $found = $combinedText.Contains(('`{0}`' -f $candidate)) `
                -or $compactCombined.Contains(([regex]::Replace($candidate, '\s', '')))

            if (-not $found -and $candidate -match '^[A-Za-z0-9_]+([+/][A-Za-z0-9_]+)+$') {
                $found = $true
                foreach ($part in ($candidate -split '[+/]')) {
                    if (-not $combinedText.Contains($part)) {
                        $found = $false
                        break
                    }
                }
            }

            if (-not $found) {
                $missingTokens.Add($candidate)
            }
        }
        if ($missingTokens.Count -gt 0) {
            $sample = ($missingTokens | Select-Object -First 5) -join ", "
            $errors.Add("baseline contract tokens missing: $($missingTokens.Count) [$sample]")
        }
    }
}

$status = if ($errors.Count -eq 0) { 'PASS' } else { 'FAIL' }
"STATUS=$status"
"MAIN_NONSPACE_CHARS=$mainCharacters"
"PEER_MEDIAN_CHARS=$peerMedian"
"EFFECTIVE_LIMIT=$effectiveLimit"
"PARAGRAPHS_OVER_300=$($paragraphs.OverWarning)"
"PARAGRAPHS_OVER_500=$($paragraphs.OverFailure)"
"MAX_CODE_BLOCK_LINES=$($codeBlocks.MaximumLines)"
"ATTACHMENTS=$($resolvedAttachments.Count)"
foreach ($warning in $warnings) {
    "WARNING=$warning"
}
foreach ($error in $errors) {
    "ERROR=$error"
}

if ($errors.Count -gt 0) {
    exit 1
}
exit 0
