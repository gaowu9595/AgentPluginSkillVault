param(
    [Parameter(Mandatory=$true)][ValidateSet('install','status','check','uninstall')][string]$Action,
    [Parameter(Mandatory=$true)][ValidateSet('claude','codex')][string]$Client,
    [ValidateSet('project','user')][string]$Scope = 'project',
    [string]$Project = (Get-Location).Path,
    [string]$ClientHome,
    [switch]$AllowDowngrade
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$owner = 'agent-plugin-skill-vault'
$componentVersion = 'unknown'
$receiptName = '.vault-install.json'
$lock = $null
$stage = $null

function Read-Object([string]$Path) {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Resolve-Base([string]$Path) {
    $absolute = [IO.Path]::GetFullPath($Path)
    if ($absolute.Length -gt [IO.Path]::GetPathRoot($absolute).Length) { $absolute = $absolute.TrimEnd('\','/') }
    return $absolute
}

function Write-Object([string]$Path, $Value) {
    $temporary = $Path + '.tmp-' + [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 15), [Text.UTF8Encoding]::new($false))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
}

function Assert-Regular([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        try {
            if ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Linked files and directories are not supported.'
            }
        } catch [IO.FileNotFoundException] { }
        catch [IO.DirectoryNotFoundException] { }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function File-Hash([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Tree-Hashes([string]$Root) {
    Assert-Regular $Root
    $result = @{}
    $pending = [Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($Root)
    while ($pending.Count) {
        foreach ($entry in Get-ChildItem -LiteralPath $pending.Dequeue() -Force) {
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked tree entry.' }
            if ($entry.PSIsContainer) { $pending.Enqueue($entry.FullName) }
            else { $result[$entry.FullName.Substring($Root.Length + 1).Replace('\','/')] = File-Hash $entry.FullName }
        }
    }
    return $result
}

function Object-Map($Value) {
    $result = @{}
    foreach ($property in $Value.PSObject.Properties) { $result[$property.Name] = [string]$property.Value }
    return $result
}

function Safe-Child([string]$Root, [string]$Relative) {
    if (-not $Relative -or $Relative -match '(^/|\\|:|(^|/)\.\.?(/|$))') { throw 'Unsafe manifest path.' }
    $child = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $child.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Path escapes its managed root.'
    }
    Assert-Regular $child
    return $child
}

function Assert-Map($Expected, $Actual, [switch]$Exact) {
    foreach ($name in $Expected.Keys) {
        if (-not $Actual.ContainsKey($name) -or $Actual[$name] -ne $Expected[$name]) {
            throw "Managed file changed or missing: $name"
        }
    }
    if ($Exact -and $Expected.Count -ne $Actual.Count) { throw 'Unexpected files in managed tree.' }
}

function Installed-Receipt {
    $receipt = Read-Object (Join-Path $target $receiptName)
    if ($receipt.owner -ne $owner -or $receipt.componentId -ne 'impeccable' -or $receipt.protocolVersion -ne 1) {
        throw 'Existing installation is not managed by this component.'
    }
    foreach ($name in (Object-Map $receipt.files).Keys) { $null = Safe-Child $target $name }
    return $receipt
}

function Remove-StateTree([string]$Path) {
    $absolute = [IO.Path]::GetFullPath($Path)
    if (-not $absolute.StartsWith($stateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Cleanup path is outside the component state directory.'
    }
    $null = Tree-Hashes $absolute
    Remove-Item -LiteralPath $absolute -Recurse -Force
}

function Result([string]$Status, [string]$Message, [bool]$Changed=$false, $Details=@{}) {
    return @{protocolVersion=1; componentId='impeccable'; componentVersion=$componentVersion;
        action=$Action; ok=$true; status=$Status; message=$Message; changed=$Changed;
        client=$Client; scope=$Scope; target=$target; details=$Details}
}

try {
    $bundle = Resolve-Base $PSScriptRoot
    $manifest = Read-Object (Join-Path $bundle 'manifest.json')
    if ($manifest.schemaVersion -ne 1 -or $manifest.protocolVersion -ne 1 -or $manifest.componentId -ne 'impeccable' -or $manifest.platform -ne 'windows-x64') {
        throw 'Unsupported component manifest.'
    }
    $componentVersion = [string]$manifest.componentVersion
    $null = [version]$componentVersion
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
        throw 'This component supports Windows x64 only.'
    }
    if ($Scope -eq 'user') {
        if (-not $ClientHome -or -not [IO.Path]::IsPathRooted($ClientHome)) {
            throw 'User scope requires an explicit absolute -ClientHome.'
        }
        $base = Resolve-Base $ClientHome
        $skillRoot = Join-Path $base 'skills'
    } else {
        $base = Resolve-Base $Project
        if (-not (Test-Path -LiteralPath $base -PathType Container)) { throw 'Project directory does not exist.' }
        $native = if ($Client -eq 'claude') { '.claude' } else { '.agents' }
        $skillRoot = Join-Path $base "$native/skills"
    }
    $target = Join-Path $skillRoot 'impeccable'
    $stateRoot = Join-Path $base ".agent-vault/impeccable/$Client/$Scope"
    Assert-Regular $target
    Assert-Regular $stateRoot

    if ($Action -in @('install','uninstall')) {
        New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
        $lock = [IO.File]::Open((Join-Path $stateRoot 'management.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    }
    $exists = Test-Path -LiteralPath $target
    $receipt = $null
    if ($exists) {
        if (-not (Test-Path -LiteralPath (Join-Path $target $receiptName) -PathType Leaf)) {
            if ($Action -eq 'status') { $result = Result 'unmanaged' 'An existing Skill was found; it will not be overwritten.' }
            else { throw 'An unmanaged Skill already exists; preserve it before installing.' }
        } else { $receipt = Installed-Receipt }
    }

    if ($Action -eq 'status') {
        if ($receipt) { $result = Result 'installed' 'Installed; integrity and model discovery have not been checked.' $false @{installedVersion=$receipt.componentVersion; health='unchecked'} }
        elseif (-not $exists) { $result = Result 'not-installed' 'Not installed in this scope.' }
    } elseif ($Action -eq 'install') {
        $expected = Object-Map $manifest.files
        foreach ($name in $expected.Keys) { $null = Safe-Child $bundle $name }
        $actual = Tree-Hashes $bundle
        $null = $actual.Remove('manifest.json')
        Assert-Map $expected $actual -Exact
        $incoming = @{}
        foreach ($name in $expected.Keys) { if ($name.StartsWith('skill/')) { $incoming[$name.Substring(6)] = $expected[$name] } }
        $engineRelative = 'scripts/bin/windows-x64/impeccable.exe'
        if ($incoming[$engineRelative] -ne $manifest.engine.sha256 -or -not $incoming.ContainsKey('SKILL.md') -or -not $incoming.ContainsKey('LICENSE')) {
            throw 'Required pinned component files are missing.'
        }
        $before = @{}
        if ($receipt) {
            $before = Tree-Hashes $target
            $oldFiles = Object-Map $receipt.files
            Assert-Map $oldFiles $before
            if ([version]$componentVersion -lt [version]$receipt.componentVersion -and -not $AllowDowngrade) {
                throw 'Downgrade requires explicit -AllowDowngrade and a verified old bundle.'
            }
            foreach ($name in $incoming.Keys) {
                if ($before.ContainsKey($name) -and -not $oldFiles.ContainsKey($name)) { throw "New version conflicts with a personal file: $name" }
            }
            if ($receipt.componentVersion -eq $componentVersion) {
                Assert-Map $incoming $oldFiles -Exact
                $result = Result 'installed' 'This version is already installed.'
            }
        }
        if (-not $result) {
            $previous = Join-Path $stateRoot 'previous'
            $previousIndex = Join-Path $stateRoot 'previous.json'
            if ($receipt -and (Test-Path -LiteralPath $previous)) {
                $previousMap = Object-Map (Read-Object $previousIndex).files
                Assert-Map $previousMap (Tree-Hashes $previous) -Exact
            }
            $stage = Join-Path $stateRoot ('stage-' + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $stage | Out-Null
            if ($receipt) {
                foreach ($name in $before.Keys) {
                    if ($name -eq $receiptName -or $oldFiles.ContainsKey($name)) { continue }
                    $destination = Safe-Child $stage $name
                    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
                    Copy-Item -LiteralPath (Safe-Child $target $name) -Destination $destination
                }
            }
            foreach ($name in $incoming.Keys) {
                $destination = Safe-Child $stage $name
                New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
                Copy-Item -LiteralPath (Safe-Child $bundle ('skill/' + $name)) -Destination $destination
            }
            Write-Object (Join-Path $stage $receiptName) @{owner=$owner; componentId='impeccable';
                protocolVersion=1; componentVersion=$componentVersion; upstreamVersion=$manifest.upstream.version;
                engine=$manifest.engine; files=$incoming; installedAt=[DateTime]::UtcNow.ToString('o')}
            Assert-Map $incoming (Tree-Hashes $stage)
            New-Item -ItemType Directory -Path $skillRoot -Force | Out-Null
            $retired = $null
            try {
                if ($receipt) {
                    Assert-Map $before (Tree-Hashes $target) -Exact
                    if (Test-Path -LiteralPath $previous) {
                        $retired = Join-Path $stateRoot ('retired-' + [guid]::NewGuid().ToString('N'))
                        Move-Item -LiteralPath $previous -Destination $retired
                    }
                    Move-Item -LiteralPath $target -Destination $previous
                }
                Move-Item -LiteralPath $stage -Destination $target
                $stage = $null
            }
            catch {
                if ($receipt -and -not (Test-Path -LiteralPath $target) -and (Test-Path -LiteralPath $previous)) {
                    Move-Item -LiteralPath $previous -Destination $target
                }
                if ($retired -and (Test-Path -LiteralPath $retired) -and -not (Test-Path -LiteralPath $previous)) {
                    Move-Item -LiteralPath $retired -Destination $previous
                }
                throw
            }
            if ($receipt) {
                Write-Object $previousIndex @{files=$before; version=$receipt.componentVersion}
                if ($retired) { Remove-StateTree $retired }
            }
            $result = Result 'installed' 'Skill installed. Start a new client session to refresh discovery; Hooks remain unchanged.' $true @{backup=($(if ($receipt) {$previous} else {$null})); installedVersion=$componentVersion}
        }
    } elseif ($Action -eq 'check') {
        if (-not $receipt) { throw 'No managed installation exists in this scope.' }
        Assert-Map (Object-Map $receipt.files) (Tree-Hashes $target)
        $engine = Safe-Child $target 'scripts/bin/windows-x64/impeccable.exe'
        if ((File-Hash $engine) -ne $receipt.engine.sha256) { throw 'Engine hash mismatch.' }
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName=$engine; $start.Arguments='engine-probe'; $start.UseShellExecute=$false
        $start.CreateNoWindow=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
        $process = [Diagnostics.Process]::Start($start)
        try {
            if (-not $process.WaitForExit(15000)) { $process.Kill(); $process.WaitForExit(); throw 'Engine self-check timed out.' }
            if ($process.ExitCode -ne 0 -or $process.StandardOutput.ReadToEnd().Trim() -ne ('impeccable-engine ' + $receipt.engine.version)) {
                throw 'Native engine self-check failed.'
            }
        } finally { $process.Dispose() }
        $result = Result 'ready' 'File integrity and native engine check passed; model selection is not tested.' $false @{installedVersion=$receipt.componentVersion; engineVersion=$receipt.engine.version}
    } elseif ($Action -eq 'uninstall') {
        if (-not $exists) { $result = Result 'not-installed' 'No managed files to remove.' }
        else {
            $installed = Tree-Hashes $target
            $owned = Object-Map $receipt.files
            Assert-Map $owned $installed
            foreach ($name in $owned.Keys) { Remove-Item -LiteralPath (Safe-Child $target $name) -Force }
            Remove-Item -LiteralPath (Join-Path $target $receiptName) -Force
            Get-ChildItem -LiteralPath $target -Directory -Recurse -Force | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
                if (-not @(Get-ChildItem -LiteralPath $_.FullName -Force).Count) { Remove-Item -LiteralPath $_.FullName -Force }
            }
            $retained = @(Get-ChildItem -LiteralPath $target -Force)
            if (-not $retained.Count) { Remove-Item -LiteralPath $target -Force }
            $result = Result 'removed' 'Managed Skill files removed. Personal files, native configuration and any prior backup are retained.' $true @{retainedPersonalFiles=($retained.Count -gt 0)}
        }
    }
    $result | ConvertTo-Json -Depth 12 -Compress
} catch {
    @{protocolVersion=1; componentId='impeccable'; componentVersion=$componentVersion;
        action=$Action; ok=$false; status='error'; message=$_.Exception.Message} | ConvertTo-Json -Compress
    exit 1
} finally {
    try { if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-StateTree $stage } }
    finally { if ($lock) { $lock.Dispose() } }
}
