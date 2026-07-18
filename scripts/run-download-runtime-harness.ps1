[CmdletBinding()]
param(
    [string]$ExpectedHeadSha,
    [switch]$CompatibilityValidateOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Token = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([Guid]::NewGuid().ToString('N').Substring(0, 8))
$RuntimeRoot = [IO.Path]::GetFullPath((Join-Path $env:TEMP "ytm-free-download-runtime-$Token"))
$DataDir = Join-Path $RuntimeRoot 'data'
$DownloadRoot = Join-Path $RuntimeRoot 'downloads'
$EvidenceRoot = [IO.Path]::GetFullPath((Join-Path $env:TEMP "ytm-free-download-evidence-$Token"))
$AppBinary = Join-Path $RepoRoot 'src-tauri\target\debug\ytm-free.exe'
$AllowedProtected = @('AGENTS.md', 'gdpr-compliance-audit-report.md', 'docs/GDPR_REMEDIATION_PLAN.md', 'docs/plan-remediere-gdpr-complete.md')
$AuthorizedPaths = @('scripts/run-download-runtime-harness.ps1', 'src-tauri/src/ytdlp.rs', 'tests/e2e/download-runtime.spec.ts', 'wdio.conf.ts')
$OriginalEnvironment = @{
    YTM_FREE_DATA_DIR = $env:YTM_FREE_DATA_DIR; YTM_FREE_DOWNLOAD_DIR = $env:YTM_FREE_DOWNLOAD_DIR
    EVIDENCE_ROOT = $env:EVIDENCE_ROOT; WDIO_EMBEDDED_PORT = $env:WDIO_EMBEDDED_PORT
    TAURI_WEBDRIVER_PORT = $env:TAURI_WEBDRIVER_PORT; DOWNLOAD_RUNTIME_PHASE = $env:DOWNLOAD_RUNTIME_PHASE
}
$Utf8 = [Text.UTF8Encoding]::new($false)
$Failures = [Collections.Generic.List[string]]::new()
$CommandLedger = [Collections.Generic.List[object]]::new()
$RuntimeStatus = 'FAIL'
$CreatePid = $null; $RestartPid = $null; $Downloaded = $null; $FfprobeDuration = $null
$AppDataBefore = $null; $DefaultBefore = $null; $ProtectedBefore = $null
$AppDataUnchanged = $false; $DefaultUnchanged = $false; $ProtectedUnchanged = $false; $CleanupComplete = $false
$EmbeddedPort = $null

function Write-Json([string]$Name, [object]$Value) {
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot $Name), (($Value | ConvertTo-Json -Depth 30) + [Environment]::NewLine), $Utf8)
}

function Get-FullPathNormalized {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$Path)
    return [IO.Path]::GetFullPath($Path)
}

function Test-PathContained {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$BasePath,
        [Parameter(Mandatory)] [string]$TargetPath
    )
    $baseFull = Get-FullPathNormalized -Path $BasePath
    $targetFull = Get-FullPathNormalized -Path $TargetPath
    $separator = [string][IO.Path]::DirectorySeparatorChar
    $basePrefix = $baseFull.TrimEnd('\', '/') + $separator
    return ($targetFull.Equals($baseFull, [StringComparison]::OrdinalIgnoreCase) -or
        $targetFull.StartsWith($basePrefix, [StringComparison]::OrdinalIgnoreCase))
}

function Get-RelativePathCompatible {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$BasePath,
        [Parameter(Mandatory)] [string]$TargetPath
    )
    $baseFull = Get-FullPathNormalized -Path $BasePath
    $targetFull = Get-FullPathNormalized -Path $TargetPath
    if (-not (Test-PathContained -BasePath $baseFull -TargetPath $targetFull)) {
        throw 'Target path is outside the permitted base directory.'
    }
    if ($targetFull.Equals($baseFull, [StringComparison]::OrdinalIgnoreCase)) { return '.' }
    $separator = [string][IO.Path]::DirectorySeparatorChar
    $baseForUri = $baseFull.TrimEnd('\', '/') + $separator
    $baseUri = New-Object System.Uri($baseForUri)
    $targetUri = New-Object System.Uri($targetFull)
    $relativeUri = $baseUri.MakeRelativeUri($targetUri)
    if ($relativeUri.IsAbsoluteUri) { throw 'Cannot calculate a relative path across different roots.' }
    return [Uri]::UnescapeDataString($relativeUri.ToString()).Replace('/', [IO.Path]::DirectorySeparatorChar)
}

function Get-Sha256([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }

function Get-TextHash([string]$Text) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash($Utf8.GetBytes($Text)))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function New-ProcessEvidenceEntry {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$FilePath,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory)] [int]$ExitCode
    )
    [ordered]@{ name = $Name; file = $FilePath; arguments = @($Arguments); exit_code = $ExitCode }
}

function Invoke-External {
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$StdoutName,
        [string]$StderrName,
        [switch]$AllowFailure,
        [string]$WorkingDirectory = $RepoRoot,
        [string]$Name = ([IO.Path]::GetFileNameWithoutExtension($FilePath))
    )
    $recordedArguments = @($Arguments)
    $captureToken = [Guid]::NewGuid().ToString('N')
    $stdoutCapture = Join-Path $EvidenceRoot ".capture-$captureToken.stdout"
    $stderrCapture = Join-Path $EvidenceRoot ".capture-$captureToken.stderr"
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdoutCapture -RedirectStandardError $stderrCapture
    $stdout = if (Test-Path -LiteralPath $stdoutCapture) { [IO.File]::ReadAllText($stdoutCapture) } else { '' }
    $stderr = if (Test-Path -LiteralPath $stderrCapture) { [IO.File]::ReadAllText($stderrCapture) } else { '' }
    Remove-Item -LiteralPath $stdoutCapture, $stderrCapture -Force -ErrorAction SilentlyContinue
    $entry = New-ProcessEvidenceEntry -Name $Name -FilePath $FilePath -Arguments $recordedArguments -ExitCode $process.ExitCode
    $CommandLedger.Add($entry)
    if ($StdoutName) { [IO.File]::WriteAllText((Join-Path $EvidenceRoot $StdoutName), $stdout, $Utf8) }
    if ($StderrName) { [IO.File]::WriteAllText((Join-Path $EvidenceRoot $StderrName), $stderr, $Utf8) }
    if ($process.ExitCode -ne 0 -and -not $AllowFailure) { throw "$FilePath exited $($process.ExitCode): $stderr" }
    [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout; Stderr = $stderr }
}

function Get-GitOutput([string[]]$Arguments) {
    $result = Invoke-External (Get-Command git.exe).Source $Arguments $null $null
    $result.Stdout.TrimEnd()
}

function Get-GitState {
    [ordered]@{
        branch = Get-GitOutput @('branch', '--show-current'); head = Get-GitOutput @('rev-parse', 'HEAD')
        origin_main = Get-GitOutput @('rev-parse', 'origin/main'); status = @((Get-GitOutput @('status', '--short')) -split "`r?`n" | Where-Object { $_ })
        tracked_diff = @((Get-GitOutput @('diff', '--name-only')) -split "`r?`n" | Where-Object { $_ })
        staged_diff = @((Get-GitOutput @('diff', '--cached', '--name-only')) -split "`r?`n" | Where-Object { $_ })
    }
}

function Assert-GitScope([object]$State) {
    if ($State.branch -ne 'fix/download-dir-override-runtime' -or $State.head -ne $ExpectedHeadSha -or $State.origin_main -ne 'b3200d4f8d4187bc25cc1f1d49d55bcbcf277212') { throw 'BLOCKED - STATE-MISMATCH' }
    if ($State.staged_diff.Count -ne 0) { throw 'Staging must remain empty during runtime proof' }
    $changed = [Collections.Generic.List[string]]::new()
    foreach ($line in $State.status) {
        $path = $line.Substring(3).Trim().Replace('\', '/')
        $isUntracked = $line.Length -ge 2 -and $line[0] -eq [char]63 -and $line[1] -eq [char]63
        if ($isUntracked -and $path -in $AllowedProtected) { continue }
        if ($path -notin $AuthorizedPaths) { throw "Out-of-scope repository path: $path" }
        $changed.Add($path)
    }
    if (@(Compare-Object ($AuthorizedPaths | Sort-Object) ($changed | Sort-Object)).Count -ne 0) { throw 'BLOCKED - FINAL-SCOPE-MISMATCH' }
    Invoke-External (Get-Command git.exe).Source @('diff', '--check') $null $null | Out-Null
    Invoke-External (Get-Command git.exe).Source @('diff', '--cached', '--check') $null $null | Out-Null
}

function Get-TreeAggregate([string]$Root, [string]$Alias) {
    if (-not (Test-Path -LiteralPath $Root)) { return [ordered]@{ alias = $Alias; exists = $false; file_count = 0; total_bytes = 0; aggregate_sha256 = Get-TextHash '' } }
    $records = [Collections.Generic.List[string]]::new(); [long]$bytes = 0
    foreach ($file in @(Get-ChildItem -LiteralPath $Root -Recurse -Force -File | Sort-Object FullName)) {
        $relative = (Get-RelativePathCompatible -BasePath $Root -TargetPath $file.FullName).Replace('\', '/')
        $hash = Get-Sha256 $file.FullName; $bytes += $file.Length; $records.Add("$relative`t$($file.Length)`t$hash")
    }
    [ordered]@{ alias = $Alias; exists = $true; file_count = $records.Count; total_bytes = $bytes; aggregate_sha256 = Get-TextHash ($records -join "`n") }
}

function Get-AppDataSnapshot {
    $root = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)) 'ytm-free'
    $items = [ordered]@{}
    foreach ($name in @('ytm-free.db', 'ytm-free.db-wal', 'ytm-free.db-shm')) {
        $path = Join-Path $root $name
        $items[$name] = if (Test-Path -LiteralPath $path -PathType Leaf) { $f = Get-Item $path; [ordered]@{ exists = $true; size = $f.Length; sha256 = Get-Sha256 $path; last_write_utc = $f.LastWriteTimeUtc.ToString('o') } } else { [ordered]@{ exists = $false } }
    }
    [ordered]@{ alias = '%REAL_APPDATA%\ytm-free'; files = $items }
}

function Get-DefaultSnapshots {
    $music = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::MyMusic)) 'YTM-Free'
    $rawDownloads = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders').'{374DE290-123F-4565-9164-39C4925E467B}'
    $downloads = Join-Path ([Environment]::ExpandEnvironmentVariables($rawDownloads)) 'YTM-Free'
    [ordered]@{ music_ytm_free = Get-TreeAggregate $music '%DEFAULT_MUSIC%\YTM-Free'; downloads_ytm_free = Get-TreeAggregate $downloads '%DEFAULT_DOWNLOADS%\YTM-Free' }
}

function Get-ProtectedSnapshot {
    $files = [ordered]@{}
    foreach ($relative in $AllowedProtected) { $path = Join-Path $RepoRoot $relative; $files[$relative] = if (Test-Path -LiteralPath $path -PathType Leaf) { $f = Get-Item $path; [ordered]@{ exists = $true; size = $f.Length; sha256 = Get-Sha256 $path } } else { [ordered]@{ exists = $false } } }
    [ordered]@{ files = $files; spotify = Get-TreeAggregate (Join-Path $RepoRoot 'Spotify') '%REPO%/Spotify'; omx = Get-TreeAggregate (Join-Path $RepoRoot '.omx') '%REPO%/.omx' }
}

function Equal-Json([object]$Left, [object]$Right) { ($Left | ConvertTo-Json -Depth 30 -Compress) -ceq ($Right | ConvertTo-Json -Depth 30 -Compress) }

function Get-ListeningPids([int]$Port) {
    $pids = [Collections.Generic.HashSet[int]]::new()
    foreach ($line in & netstat.exe -ano -p tcp) { $columns = $line.Trim() -split '\s+'; if ($columns.Count -ge 5 -and $columns[0] -eq 'TCP' -and $columns[3] -eq 'LISTENING' -and $columns[1] -match ":$Port$") { [void]$pids.Add([int]$columns[4]) } }
    @($pids)
}

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $listener.Start()
    try { ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Get-AppProcesses {
    if (-not (Test-Path -LiteralPath $AppBinary)) { return @() }
    @(Get-Process -Name 'ytm-free' -ErrorAction SilentlyContinue | Where-Object { try { [IO.Path]::GetFullPath($_.Path) -ieq [IO.Path]::GetFullPath($AppBinary) } catch { $false } })
}

function Assert-PortsAndProcessFree {
    if (@(Get-ListeningPids 3456).Count -gt 0) { throw 'Foreign listener on port 3456' }
    if (@(Get-ListeningPids $EmbeddedPort).Count -gt 0) { throw "Foreign listener on embedded port $EmbeddedPort" }
    if (@(Get-AppProcesses).Count -gt 0) { throw 'Existing YTM-Free process from target binary' }
}

function Wait-RuntimeClean([string]$Phase) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt 60) {
        if (@(Get-ListeningPids 3456).Count -eq 0 -and @(Get-ListeningPids $EmbeddedPort).Count -eq 0 -and @(Get-AppProcesses).Count -eq 0) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "FAIL - CLEANUP: runtime remained active after $Phase"
}

function Assert-OwnedRuntimeTree {
    $runtime = Get-FullPathNormalized -Path $RuntimeRoot
    if (-not (Test-PathContained -BasePath $env:TEMP -TargetPath $runtime) -or -not ([IO.Path]::GetFileName($runtime)).StartsWith('ytm-free-download-runtime-')) { throw 'Runtime root is outside TEMP' }
    foreach ($path in @($RuntimeRoot, $DataDir, $DownloadRoot)) {
        if (Test-PathContained -BasePath $RepoRoot -TargetPath $path) { throw 'Runtime root is inside repository' }
        if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point refused: $path" }
    }
    if (@(Get-ChildItem -LiteralPath $RuntimeRoot -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -gt 0) { throw 'Reparse point found in owned runtime tree' }
}

function Invoke-WdioPhase([ValidateSet('create', 'restart')] [string]$Phase) {
    Assert-OwnedRuntimeTree; Assert-PortsAndProcessFree
    $env:DOWNLOAD_RUNTIME_PHASE = $Phase
    $result = Invoke-External $env:ComSpec @('/d', '/s', '/c', 'npx wdio run wdio.conf.ts --spec tests/e2e/download-runtime.spec.ts') "$Phase-wdio.stdout.log" "$Phase-wdio.stderr.log" -AllowFailure
    Wait-RuntimeClean $Phase
    if ($result.ExitCode -ne 0) { throw "FAIL - UI-$($Phase.ToUpperInvariant()): WDIO exit $($result.ExitCode)" }
}

function Sanitize-Evidence {
    $values = @(
        @($EvidenceRoot, '%EVIDENCE_ROOT%'), @($DownloadRoot, '%DOWNLOAD_ROOT%'), @($DataDir, '%DATA_DIR%'), @($RuntimeRoot, '%RUNTIME_ROOT%'),
        @($RepoRoot, '%REPO%'), @($env:USERPROFILE, '%USERPROFILE%'), @($env:TEMP, '%TEMP%'), @($env:USERNAME, '%USERNAME%')
    ) | Sort-Object { -(([string]$_.Item(0)).Length) }
    foreach ($file in @(Get-ChildItem -LiteralPath $EvidenceRoot -Recurse -File | Where-Object { $_.Extension -in @('.json', '.jsonl', '.html', '.log', '.txt') })) {
        $text = [IO.File]::ReadAllText($file.FullName)
        foreach ($pair in $values) { foreach ($form in @([string]$pair[0], ([string]$pair[0]).Replace('\', '/'), ([string]$pair[0]).Replace('\', '\\'))) { if ($form) { $text = $text.Replace($form, [string]$pair[1]) } } }
        [IO.File]::WriteAllText($file.FullName, $text, $Utf8)
    }
}

function Get-ClearPathMatchCount {
    $count = 0
    foreach ($file in @(Get-ChildItem -LiteralPath $EvidenceRoot -Recurse -File | Where-Object { $_.Extension -in @('.json', '.jsonl', '.html', '.log', '.txt') })) {
        $text = [IO.File]::ReadAllText($file.FullName)
        $count += [regex]::Matches($text, 'C:[\\/]+Users[\\/]+[^\\/\s"<>]+', [Text.RegularExpressions.RegexOptions]::IgnoreCase).Count
        if ($env:USERNAME) { $count += [regex]::Matches($text, [regex]::Escape($env:USERNAME), 'IgnoreCase').Count }
    }
    $count
}

function Invoke-CompatibilityValidation {
    $syntheticRoot = Get-FullPathNormalized -Path (Join-Path $env:TEMP "ytm-free-download-compat-$Token")
    $embeddedValidationPort = 4445
    if ($env:WDIO_EMBEDDED_PORT -and $env:WDIO_EMBEDDED_PORT -match '^\d+$') {
        $embeddedValidationPort = [int]$env:WDIO_EMBEDDED_PORT
    }
    $port3456Before = @((Get-ListeningPids 3456) | Sort-Object)
    $embeddedBefore = @((Get-ListeningPids $embeddedValidationPort) | Sort-Object)
    if (@(Get-AppProcesses).Count -ne 0) { throw 'Existing YTM-Free process from target binary' }
    if (Test-Path -LiteralPath $syntheticRoot) { throw 'Synthetic compatibility root already exists' }

    $cleanupComplete = $false
    try {
        New-Item -ItemType Directory -Path $syntheticRoot | Out-Null
        $base = Join-Path $syntheticRoot 'root'
        $descendant = Join-Path $base 'a\b\file.json'
        New-Item -ItemType Directory -Path (Split-Path -Parent $descendant) | Out-Null
        [IO.File]::WriteAllText($descendant, '{}', $Utf8)

        $relative = Get-RelativePathCompatible -BasePath $base -TargetPath $descendant
        if ($relative -ne 'a\b\file.json') { throw 'Relative descendant validation failed' }
        if (-not (Test-PathContained -BasePath $base -TargetPath $base)) { throw 'Base self containment validation failed' }
        if ((Get-RelativePathCompatible -BasePath $base -TargetPath $base) -ne '.') { throw 'Base self relative validation failed' }

        $prefixTarget = Join-Path $syntheticRoot 'root-other\file.json'
        $prefixRejected = $false
        try { Get-RelativePathCompatible -BasePath $base -TargetPath $prefixTarget | Out-Null }
        catch { $prefixRejected = $true }
        if ((Test-PathContained -BasePath $base -TargetPath $prefixTarget) -or -not $prefixRejected) { throw 'Prefix collision validation failed' }

        $parentTarget = Join-Path $syntheticRoot 'outside\file.json'
        $parentRejected = $false
        try { Get-RelativePathCompatible -BasePath $base -TargetPath $parentTarget | Out-Null }
        catch { $parentRejected = $true }
        if ((Test-PathContained -BasePath $base -TargetPath $parentTarget) -or -not $parentRejected) { throw 'Parent escape validation failed' }

        $syntheticArguments = @('--output', 'C:\synthetic path\file.json', '--flag')
        $entry = New-ProcessEvidenceEntry -Name 'synthetic' -FilePath 'synthetic.exe' -Arguments $syntheticArguments -ExitCode 0
        if ($entry.arguments.Count -ne 3 -or $entry.arguments[1] -ne 'C:\synthetic path\file.json') { throw 'Argument array validation failed' }

        $reportPath = Join-Path $syntheticRoot 'compatibility-validation.json'
        [IO.File]::WriteAllText($reportPath, (($entry | ConvertTo-Json -Depth 10) + [Environment]::NewLine), $Utf8)
        $roundTrip = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
        if ($roundTrip.arguments.Count -ne 3 -or $roundTrip.arguments[1] -ne 'C:\synthetic path\file.json') { throw 'JSON roundtrip validation failed' }

        $runnerPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'run-download-runtime-harness.ps1')).Path
        $runnerContent = [IO.File]::ReadAllText($runnerPath)
        $nonAsciiCount = @($runnerContent.ToCharArray() | Where-Object { [int]$_ -gt 127 }).Count
        if ($nonAsciiCount -ne 0) { throw 'FAIL - RUNNER-NON-ASCII-CONTENT' }

        $questionPattern = [regex]::Escape([string][char]63)
        $forbiddenPatterns = @(
            ('Get' + 'RelativePath'),
            ('\.' + 'ArgumentList'),
            'ForEach-Object\s+-Parallel',
            'ConvertFrom-Json\s+-AsHashtable',
            ('\bGet' + '-Error\b'),
            ($questionPattern + $questionPattern),
            ($questionPattern + '\s*[^:]+\s*:'),
            '\|\|',
            ('&' + '&')
        )
        $forbiddenCount = 0
        foreach ($pattern in $forbiddenPatterns) {
            $forbiddenCount += @(Select-String -LiteralPath $runnerPath -Pattern $pattern -AllMatches).Count
        }
        if ($forbiddenCount -ne 0) { throw 'FAIL - POWERSHELL-7-ONLY-API-DETECTED' }

        $databaseCreated = @(Get-ChildItem -LiteralPath $syntheticRoot -Recurse -File -Filter '*.db').Count -ne 0
        if ($databaseCreated -or (Test-Path -LiteralPath $RuntimeRoot)) { throw 'Compatibility validation created forbidden runtime state' }
    }
    finally {
        if (Test-Path -LiteralPath $syntheticRoot) {
            if (-not (Test-PathContained -BasePath $env:TEMP -TargetPath $syntheticRoot) -or
                -not ([IO.Path]::GetFileName($syntheticRoot)).StartsWith('ytm-free-download-compat-')) {
                throw 'Refusing unsafe compatibility cleanup'
            }
            Remove-Item -LiteralPath $syntheticRoot -Recurse -Force
        }
        $cleanupComplete = -not (Test-Path -LiteralPath $syntheticRoot)
    }

    $port3456After = @((Get-ListeningPids 3456) | Sort-Object)
    $embeddedAfter = @((Get-ListeningPids $embeddedValidationPort) | Sort-Object)
    if (($port3456Before -join ',') -cne ($port3456After -join ',') -or
        ($embeddedBefore -join ',') -cne ($embeddedAfter -join ',') -or
        @(Get-AppProcesses).Count -ne 0 -or -not $cleanupComplete) {
        throw 'Compatibility cleanup validation failed'
    }

    'WINDOWS_POWERSHELL_PARSE: PASS'
    'NON_ASCII_COUNT: 0'
    'RELATIVE_PATH_DESCENDANT: PASS'
    'RELATIVE_PATH_BASE_SELF: PASS'
    'PREFIX_COLLISION_REJECTED: PASS'
    'PARENT_ESCAPE_REJECTED: PASS'
    'ARGUMENT_ARRAY_PRESERVED: PASS'
    'JSON_ROUNDTRIP: PASS'
    'KNOWN_POWERSHELL_7_ONLY_API_MATCHES: 0'
    'APPLICATION_LAUNCHED: False'
    'DATABASE_CREATED: False'
    'DOWNLOAD_ATTEMPTED: False'
    'RUNTIME_ROOT_CREATED: False'
    'COMPATIBILITY_CLEANUP: PASS'
    'POWERSHELL_COMPATIBILITY_VALIDATION: PASS'
}

if ($CompatibilityValidateOnly) {
    Invoke-CompatibilityValidation
    exit 0
}

if ([string]::IsNullOrWhiteSpace($ExpectedHeadSha)) { throw 'ExpectedHeadSha is required for runtime proof' }

try {
    Set-Location $RepoRoot
    if ((Test-Path -LiteralPath $RuntimeRoot) -or (Test-Path -LiteralPath $EvidenceRoot)) { throw 'Owned runtime/evidence root already exists' }
    New-Item -ItemType Directory -Path $EvidenceRoot, $RuntimeRoot, $DataDir, $DownloadRoot | Out-Null
    $EmbeddedPort = Get-FreePort
    Write-Json 'runtime-roots.json' ([ordered]@{ run_token = $Token; data_dir_alias = '%DATA_DIR%'; download_dir_alias = '%DOWNLOAD_ROOT%'; evidence_root_alias = '%EVIDENCE_ROOT%'; embedded_port = $EmbeddedPort })
    Assert-OwnedRuntimeTree
    $gitBefore = Get-GitState; Assert-GitScope $gitBefore
    Write-Json 'preflight.json' ([ordered]@{ branch = $gitBefore.branch; head = $gitBefore.head; origin_main = $gitBefore.origin_main; scope = 'PASS'; ports_free = $true; runtime_roots_safe = $true })
    Write-Json 'git-state-before.json' $gitBefore
    Assert-PortsAndProcessFree

    $toolchain = [ordered]@{}
    foreach ($tool in @(@('node', 'node.exe', @('--version')), @('npm', $env:ComSpec, @('/d', '/s', '/c', 'npm --version')), @('rustc', 'rustc.exe', @('--version')), @('cargo', 'cargo.exe', @('--version')), @('yt-dlp', 'yt-dlp.exe', @('--version')), @('ffmpeg', 'ffmpeg.exe', @('-version')), @('ffprobe', 'ffprobe.exe', @('-version')))) {
        $result = Invoke-External (Get-Command ([string]$tool[1])).Source ([string[]]$tool[2]) $null $null
        $toolchain[$tool[0]] = [ordered]@{ exit = $result.ExitCode; output = (($result.Stdout + $result.Stderr).Trim()) }
    }
    Write-Json 'toolchain.json' $toolchain
    $probeResult = Invoke-External (Get-Command yt-dlp.exe).Source @('--dump-single-json', '--no-warnings', 'https://www.youtube.com/watch?v=jNQXAC9IVRw') $null $null
    $probe = $probeResult.Stdout | ConvertFrom-Json
    if ($probe.id -ne 'jNQXAC9IVRw' -or $null -eq $probe.duration -or [double]$probe.duration -le 0 -or [double]$probe.duration -gt 300) { throw 'BLOCKED - EXTERNAL-TEST-VIDEO-UNAVAILABLE' }
    Write-Json 'test-video-probe.json' ([ordered]@{ id = $probe.id; duration_seconds = [double]$probe.duration; finite_and_small = $true; exit = 0 })

    $AppDataBefore = Get-AppDataSnapshot; $DefaultBefore = Get-DefaultSnapshots; $ProtectedBefore = Get-ProtectedSnapshot
    Write-Json 'real-appdata-before.json' $AppDataBefore; Write-Json 'default-download-roots-before.json' $DefaultBefore; Write-Json 'protected-files-before.json' $ProtectedBefore
    $env:YTM_FREE_DATA_DIR = $DataDir; $env:YTM_FREE_DOWNLOAD_DIR = $DownloadRoot; $env:EVIDENCE_ROOT = $EvidenceRoot
    $env:WDIO_EMBEDDED_PORT = [string]$EmbeddedPort; $env:TAURI_WEBDRIVER_PORT = [string]$EmbeddedPort
    Invoke-External $env:ComSpec @('/d', '/s', '/c', 'npm run build:wdio') 'build-wdio.stdout.log' 'build-wdio.stderr.log' | Out-Null
    Invoke-External $env:ComSpec @('/d', '/s', '/c', 'npm run harness:build') 'harness-build.stdout.log' 'harness-build.stderr.log' | Out-Null
    if (-not (Test-Path -LiteralPath $AppBinary -PathType Leaf)) { throw 'Harness binary missing' }

    Invoke-WdioPhase 'create'
    $create = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'create-state.json') -Raw | ConvertFrom-Json
    $CreatePid = [int]$create.process_id
    $mp3s = @(Get-ChildItem -LiteralPath $DownloadRoot -Recurse -File -Filter '*.mp3')
    if ($mp3s.Count -ne 1) { throw "FAIL - DOWNLOAD-CONTAINMENT: expected one MP3, got $($mp3s.Count)" }
    $relative = Get-RelativePathCompatible -BasePath $DownloadRoot -TargetPath $mp3s[0].FullName
    if ($relative -ne $create.relative_path) { throw 'Downloaded MP3 differs from get_downloads path' }
    $Downloaded = [ordered]@{ relative_path = "%DOWNLOAD_ROOT%\$relative"; size = $mp3s[0].Length; sha256 = Get-Sha256 $mp3s[0].FullName }
    if ($Downloaded.size -le 0) { throw 'FAIL - DOWNLOADED-FILE-INVALID' }
    Write-Json 'downloaded-file.json' $Downloaded
    $ffprobe = Invoke-External (Get-Command ffprobe.exe).Source @('-v', 'error', '-show_entries', 'format=duration', '-of', 'json', ('"{0}"' -f $mp3s[0].FullName)) $null $null
    $ffprobeJson = $ffprobe.Stdout | ConvertFrom-Json; $FfprobeDuration = [double]$ffprobeJson.format.duration
    if ([double]::IsNaN($FfprobeDuration) -or [double]::IsInfinity($FfprobeDuration) -or $FfprobeDuration -le 0) { throw 'FAIL - DOWNLOADED-FILE-INVALID' }
    Write-Json 'ffprobe.json' ([ordered]@{ duration_seconds = $FfprobeDuration; valid_finite_positive = $true })

    Invoke-WdioPhase 'restart'
    $restart = Get-Content -LiteralPath (Join-Path $EvidenceRoot 'restart-state.json') -Raw | ConvertFrom-Json
    $RestartPid = [int]$restart.process_id
    if ($RestartPid -eq $CreatePid) { throw 'FAIL - RESTART-PERSISTENCE: process was reused' }
    $afterMp3s = @(Get-ChildItem -LiteralPath $DownloadRoot -Recurse -File -Filter '*.mp3')
    if ($afterMp3s.Count -ne 1 -or $afterMp3s[0].Length -ne $Downloaded.size -or (Get-Sha256 $afterMp3s[0].FullName) -ne $Downloaded.sha256) { throw 'FAIL - RESTART-PERSISTENCE: MP3 changed' }

    $appDataAfter = Get-AppDataSnapshot; $defaultAfter = Get-DefaultSnapshots; $protectedAfter = Get-ProtectedSnapshot
    Write-Json 'real-appdata-after.json' $appDataAfter; Write-Json 'default-download-roots-after.json' $defaultAfter; Write-Json 'protected-files-after.json' $protectedAfter
    $AppDataUnchanged = Equal-Json $AppDataBefore $appDataAfter; $DefaultUnchanged = Equal-Json $DefaultBefore $defaultAfter; $ProtectedUnchanged = Equal-Json $ProtectedBefore $protectedAfter
    if (-not $AppDataUnchanged -or -not $DefaultUnchanged -or -not $ProtectedUnchanged) { throw 'FAIL - REAL-USER-DATA-MODIFIED' }
    $gitAfter = Get-GitState; Assert-GitScope $gitAfter; Write-Json 'git-state-after.json' $gitAfter
    $RuntimeStatus = 'PASS - DOWNLOAD-UI-RUNTIME-AND-RESTART-PERSISTENCE-PROVEN'
}
catch {
    $Failures.Add($_.Exception.Message); [Console]::Error.WriteLine($_.Exception.Message)
}
finally {
    try { if ($EmbeddedPort) { Wait-RuntimeClean 'final' } } catch { $Failures.Add($_.Exception.Message) }
    try {
        if (Test-Path -LiteralPath $RuntimeRoot) {
            if (-not (Test-PathContained -BasePath $env:TEMP -TargetPath $RuntimeRoot) -or -not ([IO.Path]::GetFileName($RuntimeRoot)).StartsWith('ytm-free-download-runtime-')) { throw 'Refusing unsafe runtime cleanup' }
            Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force
        }
        $CleanupComplete = -not (Test-Path -LiteralPath $RuntimeRoot)
    } catch { $Failures.Add("FAIL - CLEANUP: $($_.Exception.Message)") }
    Write-Json 'cleanup.json' ([ordered]@{ cleanup_complete = $CleanupComplete; runtime_root_removed = $CleanupComplete; ports_free = if ($EmbeddedPort) { @(Get-ListeningPids 3456).Count -eq 0 -and @(Get-ListeningPids $EmbeddedPort).Count -eq 0 } else { $true }; target_process_absent = @(Get-AppProcesses).Count -eq 0 })
    $env:YTM_FREE_DATA_DIR = $OriginalEnvironment.YTM_FREE_DATA_DIR; $env:YTM_FREE_DOWNLOAD_DIR = $OriginalEnvironment.YTM_FREE_DOWNLOAD_DIR
    $env:EVIDENCE_ROOT = $OriginalEnvironment.EVIDENCE_ROOT; $env:WDIO_EMBEDDED_PORT = $OriginalEnvironment.WDIO_EMBEDDED_PORT
    $env:TAURI_WEBDRIVER_PORT = $OriginalEnvironment.TAURI_WEBDRIVER_PORT; $env:DOWNLOAD_RUNTIME_PHASE = $OriginalEnvironment.DOWNLOAD_RUNTIME_PHASE
    Write-Json 'process-commands.json' @($CommandLedger)
    Sanitize-Evidence
    $pathMatches = Get-ClearPathMatchCount
    if ($pathMatches -ne 0) { $Failures.Add('BLOCKED - PERSONAL-DATA-DETECTED'); $RuntimeStatus = 'FAIL' }
    if (-not $CleanupComplete -and $RuntimeStatus -like 'PASS*') { $RuntimeStatus = 'FAIL - CLEANUP' }
    $files = @(Get-ChildItem -LiteralPath $EvidenceRoot -Recurse -File | Where-Object Name -ne 'final-manifest.json' | Sort-Object FullName | ForEach-Object { [ordered]@{ path = (Get-RelativePathCompatible -BasePath $EvidenceRoot -TargetPath $_.FullName).Replace('\', '/'); size = $_.Length; sha256 = Get-Sha256 $_.FullName } })
    $createState = if (Test-Path (Join-Path $EvidenceRoot 'create-state.json')) { Get-Content (Join-Path $EvidenceRoot 'create-state.json') -Raw | ConvertFrom-Json } else { $null }
    $restartState = if (Test-Path (Join-Path $EvidenceRoot 'restart-state.json')) { Get-Content (Join-Path $EvidenceRoot 'restart-state.json') -Raw | ConvertFrom-Json } else { $null }
    Write-Json 'final-manifest.json' ([ordered]@{
        run_token = $Token; branch = 'fix/download-dir-override-runtime'; HEAD = $ExpectedHeadSha; origin_main = 'b3200d4f8d4187bc25cc1f1d49d55bcbcf277212'
        runtime_status = $RuntimeStatus; create_pid = $CreatePid; restart_pid = $RestartPid; data_dir_alias = '%DATA_DIR%'; download_dir_alias = '%DOWNLOAD_ROOT%'
        downloaded_relative_path = if ($Downloaded) { $Downloaded.relative_path } else { $null }; downloaded_size = if ($Downloaded) { $Downloaded.size } else { $null }
        downloaded_sha256 = if ($Downloaded) { $Downloaded.sha256 } else { $null }; ffprobe_duration_seconds = $FfprobeDuration
        downloads_count_create = if ($createState) { $createState.downloads_count } else { $null }; downloads_count_restart = if ($restartState) { $restartState.downloads_count } else { $null }
        real_appdata_unchanged = $AppDataUnchanged; default_download_roots_unchanged = $DefaultUnchanged; protected_files_unchanged = $ProtectedUnchanged
        cleanup_complete = $CleanupComplete; evidence_clear_path_match_count = $pathMatches; evidence_files = $files; failures = @($Failures)
    })
    Sanitize-Evidence
    "EVIDENCE_ROOT=$EvidenceRoot"; "RUNTIME_STATUS=$RuntimeStatus"; "EVIDENCE_CLEAR_PATH_MATCH_COUNT=$pathMatches"
}

if ($RuntimeStatus -notlike 'PASS*' -or $Failures.Count -gt 0) { exit 1 }
