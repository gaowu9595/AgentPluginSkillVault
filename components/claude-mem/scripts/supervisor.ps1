param(
    [Parameter(Mandatory=$true)][string]$Runtime,
    [Parameter(Mandatory=$true)][string]$Project,
    [Parameter(Mandatory=$true)][string]$DataDirectory,
    [Parameter(Mandatory=$true)][int]$Port,
    [Parameter(Mandatory=$true)][string]$Token,
    [Parameter(Mandatory=$true)][ValidateSet('true','false')][string]$Observer,
    [switch]$LaunchOwner
)
$ErrorActionPreference = 'Stop'

# DETACHED_PROCESS prevents Windows PowerShell 5.1 from executing on some hosts.
# ShellExecute creates an independent hidden console. No parent-owned pipe is
# retained by the actual supervisor. During startup this launcher holds its
# exact process handle so cancellation also covers pre-receipt initialization.
if ($LaunchOwner) {
    $ownerProcess = $null
    try {
        $arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+$PSCommandPath+'"'),
            '-Runtime',('"'+$Runtime+'"'),'-Project',('"'+$Project+'"'),'-DataDirectory',('"'+$DataDirectory+'"'),
            '-Port',[string]$Port,'-Token',$Token,'-Observer',$Observer)
        $ownerProcess = Start-Process -WindowStyle Hidden -PassThru -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments
        while (-not $ownerProcess.WaitForExit(200)) {
            $stopFile = Join-Path $DataDirectory '.vault-stop.json'
            if ([IO.File]::Exists($stopFile) -and (Get-Content -LiteralPath $stopFile -Raw -Encoding UTF8 | ConvertFrom-Json).token -eq $Token) {
                $ownerProcess.Kill()
                if (-not $ownerProcess.WaitForExit(8000)) { throw 'Supervisor handle cancellation timed out.' }
            }
        }
    } catch {
        if ($ownerProcess -and -not $ownerProcess.HasExited) { throw }
    } finally {
        if (-not $ownerProcess -or $ownerProcess.HasExited) {
            $closed = Join-Path $DataDirectory '.vault-launch-closed.json'
            $temporary = $closed + '.tmp-' + [guid]::NewGuid().ToString('N')
            [IO.File]::WriteAllText($temporary,(@{token=$Token} | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
            [IO.File]::Move($temporary,$closed)
        }
        if ($ownerProcess) { $ownerProcess.Dispose() }
    }
    exit
}

# Windows assigns the job atomically during process creation, before even the
# suspended child exists outside our ownership.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class VaultMemoryJob {
  [StructLayout(LayoutKind.Sequential)] public struct Startup {
    public int cb; public IntPtr reserved, desktop, title; public int x,y,xs,ys,xc,yc,fill,flags;
    public short show,reserved2; public IntPtr reserved3,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] public struct StartupEx { public Startup startup; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] public struct BasicLimit {
    public long perProcess,perJob; public uint flags; public UIntPtr minimum,maximum;
    public uint active; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimit {
    public BasicLimit basic; public Io io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job,int info,ref ExtendedLimit limits,int length);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] public static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll")] public static extern bool TerminateProcess(IntPtr handle,uint exit);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
'@

function Identity([int]$ProcessId, [string]$Executable) {
    $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"
    if (-not $entry) { throw 'Owned child process identity unavailable.' }
    $image = $entry.ExecutablePath
    if (-not $image -and $Executable) { $image = [IO.Path]::GetFullPath($Executable) }
    return @{pid=[int]$entry.ProcessId; startTime=$entry.CreationDate.ToUniversalTime().ToString('o'); commandLine=$entry.CommandLine; executable=$image}
}
function Regular([string]$Target) {
    $current = [IO.Path]::GetFullPath($Target)
    while ($current) {
        if ([IO.File]::Exists($current) -or [IO.Directory]::Exists($current)) {
            if ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked private runtime path.' }
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}
function WriteState([string]$Target, $Value) {
    Regular $Target
    $temporary = $Target + '.tmp-' + [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    [IO.File]::Move($temporary, $Target)
}
function HasToken([string]$Target) {
    Regular $Target
    if (-not [IO.File]::Exists($Target)) { return $false }
    return (Get-Content -LiteralPath $Target -Raw -Encoding UTF8 | ConvertFrom-Json).token -eq $Token
}

$job = [IntPtr]::Zero
$attributes = [IntPtr]::Zero
$jobList = [IntPtr]::Zero
$attributesReady = $false
$child = [VaultMemoryJob+ProcessInfo]::new()
try {
    Regular $Runtime
    Regular $Project
    Regular $DataDirectory
    $job = [VaultMemoryJob]::CreateJobObject([IntPtr]::Zero, $null)
    if ($job -eq [IntPtr]::Zero) { throw 'Cannot create owned worker Job Object.' }
    $limits = [VaultMemoryJob+ExtendedLimit]::new()
    $basic = [VaultMemoryJob+BasicLimit]::new()
    $basic.flags = 0x2000
    $limits.basic = $basic
    if (-not [VaultMemoryJob]::SetInformationJobObject($job,9,[ref]$limits,[Runtime.InteropServices.Marshal]::SizeOf($limits))) { throw 'Cannot set kill-on-close for worker.' }
    $bun = Join-Path $Runtime 'bin/bun.exe'
    $preload = Join-Path $Runtime 'scripts/connection.cjs'
    $worker = Join-Path $Runtime 'plugin/scripts/worker-service.cjs'
    # Paths cannot contain quotes; all arguments are explicitly quoted.
    $command = [Text.StringBuilder]::new(('"{0}" --preload "{1}" "{2}" --daemon' -f $bun,$preload,$worker))
    $attributeBytes = [IntPtr]::Zero
    [void][VaultMemoryJob]::InitializeProcThreadAttributeList([IntPtr]::Zero,1,0,[ref]$attributeBytes)
    if ($attributeBytes -eq [IntPtr]::Zero) { throw 'Cannot size process job attributes.' }
    $attributes = [Runtime.InteropServices.Marshal]::AllocHGlobal($attributeBytes)
    if (-not [VaultMemoryJob]::InitializeProcThreadAttributeList($attributes,1,0,[ref]$attributeBytes)) { throw 'Cannot initialize process job attributes.' }
    $attributesReady = $true
    $jobList = [Runtime.InteropServices.Marshal]::AllocHGlobal([IntPtr]::Size)
    [Runtime.InteropServices.Marshal]::WriteIntPtr($jobList,$job)
    if (-not [VaultMemoryJob]::UpdateProcThreadAttribute($attributes,0,[IntPtr]0x0002000D,$jobList,[IntPtr][IntPtr]::Size,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'Atomic process job assignment is unavailable.' }
    $startup = [VaultMemoryJob+StartupEx]::new()
    $basicStartup = [VaultMemoryJob+Startup]::new()
    $basicStartup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
    $startup.startup = $basicStartup
    $startup.attributes = $attributes
    if (-not [VaultMemoryJob]::CreateProcess($bun,$command,[IntPtr]::Zero,[IntPtr]::Zero,$false,0x08080004,[IntPtr]::Zero,$Project,[ref]$startup,[ref]$child)) { throw 'Cannot atomically launch owned bundled worker.' }
    $state = @{owner='agent-plugin-skill-vault'; project=$Project; dataDirectory=$DataDirectory; runtime=$Runtime;
        port=$Port; token=$Token; observer=($Observer -eq 'true'); supervisor=(Identity $PID); worker=(Identity $child.pid $bun)}
    WriteState (Join-Path $DataDirectory '.vault-worker.json') $state
    if ([VaultMemoryJob]::ResumeThread($child.thread) -eq [uint32]::MaxValue) { throw 'Cannot resume owned worker.' }
    $startDeadline = [DateTime]::UtcNow.AddSeconds(60)
    $nextLogScan = [DateTime]::UtcNow.AddSeconds(10)
    $acknowledged = $false
    while ([VaultMemoryJob]::WaitForSingleObject($child.process,200) -eq 258) {
        if (HasToken (Join-Path $DataDirectory '.vault-stop.json')) { break }
        if (-not $acknowledged) {
            $acknowledged = HasToken (Join-Path $DataDirectory '.vault-running.json')
            if (-not $acknowledged -and [DateTime]::UtcNow -gt $startDeadline) { break }
        }
        # Upstream logs are private; enforce a size ceiling without printing them.
        if ([DateTime]::UtcNow -ge $nextLogScan) {
            $nextLogScan = [DateTime]::UtcNow.AddSeconds(10)
            $logs = Join-Path $DataDirectory 'logs'
            Regular $logs
            if ([IO.Directory]::Exists($logs)) {
                foreach ($log in Get-ChildItem -LiteralPath $logs -File) {
                    Regular $log.FullName
                    if ($log.Length -gt 4194304) { [IO.File]::WriteAllText($log.FullName, '') }
                }
            }
        }
    }
} catch {
    # Never serialize child environment, Hook input, native settings or exception payloads.
    [Console]::Error.WriteLine(('Vault supervisor failure: {0} at line {1}' -f $_.Exception.GetType().Name,$_.InvocationInfo.ScriptLineNumber))
    try {
        WriteState (Join-Path $DataDirectory '.vault-supervisor-error.json') @{kind=$_.Exception.GetType().Name;
            line=$_.InvocationInfo.ScriptLineNumber; nativeError=[Runtime.InteropServices.Marshal]::GetLastWin32Error()}
    } catch { }
    exit 1
} finally {
    if ($attributesReady) { [VaultMemoryJob]::DeleteProcThreadAttributeList($attributes) }
    if ($attributes -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($attributes) }
    if ($jobList -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($jobList) }
    if ($job -ne [IntPtr]::Zero) { [void][VaultMemoryJob]::CloseHandle($job) }
    if ($child.process -ne [IntPtr]::Zero) {
        [void][VaultMemoryJob]::WaitForSingleObject($child.process,5000)
        [void][VaultMemoryJob]::CloseHandle($child.process)
    }
    if ($child.thread -ne [IntPtr]::Zero) { [void][VaultMemoryJob]::CloseHandle($child.thread) }
}
