[CmdletBinding()]
param(
    [string]$EvidenceRoot,
    [ValidateRange(1, 65535)]
    [int]$EmbeddedPort = 4446,
    [string]$ExpectedHeadSha
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$EmDash = [char]0x2014

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $EvidenceRoot = Join-Path $env:TEMP ("ytm-free-semantic-filtered-evidence-{0}" -f $Timestamp)
}
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
$TempRuntimeRoot = Join-Path $env:TEMP ("ytm-free-semantic-filtered-runtime-{0}" -f $Timestamp)
$DataDir = Join-Path $TempRuntimeRoot 'data'
$CommandLogRoot = Join-Path $EvidenceRoot 'commands'
$PhaseARoot = Join-Path $EvidenceRoot 'phase-a'
$PhaseBRoot = Join-Path $EvidenceRoot 'phase-b'
$AppBinaryPath = Join-Path $RepoRoot 'src-tauri\target\debug\ytm-free.exe'
$WdioExe = Join-Path $RepoRoot 'node_modules\.bin\wdio.cmd'
$FixtureScript = Join-Path $RepoRoot 'scripts\seed-semantic-search-query-fixture.py'
$RuntimeSpec = 'tests/e2e/semantic-filtered-search-runtime.spec.ts'
$PackageLockPath = Join-Path $RepoRoot 'package-lock.json'
$BaselineSha = '2439d2c36dcde78589ab9c1e50d555de1b6c3435'
$ExpectedHeadShaNormalized = if ([string]::IsNullOrWhiteSpace($ExpectedHeadSha)) { $null } else { $ExpectedHeadSha.Trim() }
$AllowedUntrackedProtected = @(
    'AGENTS.md',
    'docs/GDPR_REMEDIATION_PLAN.md',
    'docs/plan-remediere-gdpr-complete.md',
    'gdpr-compliance-audit-report.md'
)
$AllowedHarnessFiles = @(
    'src-tauri/src/lib.rs',
    'tests/e2e/semantic-filtered-search-runtime.spec.ts',
    'scripts/run-semantic-filtered-search-harness.ps1'
)
$CommandLedger = [System.Collections.Generic.List[object]]::new()
$CommandSequence = 0
$NetstatSequence = 0
$OriginalEnvironment = @{
    YTM_FREE_DATA_DIR = $env:YTM_FREE_DATA_DIR
    EVIDENCE_ROOT = $env:EVIDENCE_ROOT
    WDIO_EMBEDDED_PORT = $env:WDIO_EMBEDDED_PORT
    TAURI_WEBDRIVER_PORT = $env:TAURI_WEBDRIVER_PORT
    SEMANTIC_FILTERED_PHASE = $env:SEMANTIC_FILTERED_PHASE
}

New-Item -ItemType Directory -Force -Path $EvidenceRoot, $CommandLogRoot, $DataDir, $PhaseARoot, $PhaseBRoot | Out-Null

function Write-JsonFile {
    param([Parameter(Mandatory)] [string]$Path, [Parameter(Mandatory)] [object]$Value)
    $json = $Value | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Get-RelativePathCompatible {
    param([Parameter(Mandatory)] [string]$BasePath, [Parameter(Mandatory)] [string]$TargetPath)
    $base = [IO.Path]::GetFullPath($BasePath).TrimEnd('\') + '\'
    $baseUri = [Uri]$base
    $targetUri = [Uri]([IO.Path]::GetFullPath($TargetPath))
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString()).Replace('/', '\')
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)] [string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    try {
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $bytes = $algorithm.ComputeHash($stream) } finally { $algorithm.Dispose() }
    }
    finally { $stream.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '')
}

function Resolve-Application {
    param([Parameter(Mandatory)] [string]$Name)
    return (Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $RepoRoot
    )
    $script:CommandSequence += 1
    $safeName = $Name -replace '[^A-Za-z0-9._-]', '_'
    $base = '{0:D3}-{1}' -f $script:CommandSequence, $safeName
    $stdoutPath = Join-Path $CommandLogRoot ($base + '.stdout.log')
    $stderrPath = Join-Path $CommandLogRoot ($base + '.stderr.log')
    $started = (Get-Date).ToUniversalTime()
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -NoNewWindow -Wait -PassThru
    $finished = (Get-Date).ToUniversalTime()
    $stdout = if (Test-Path -LiteralPath $stdoutPath) { [IO.File]::ReadAllText($stdoutPath) } else { '' }
    $stderr = if (Test-Path -LiteralPath $stderrPath) { [IO.File]::ReadAllText($stderrPath) } else { '' }
    $entry = [ordered]@{
        name = $Name
        file = $FilePath
        arguments = $Arguments
        working_directory = $WorkingDirectory
        started_at_utc = $started.ToString('o')
        finished_at_utc = $finished.ToString('o')
        exit_code = $process.ExitCode
        stdout = $stdoutPath
        stderr = $stderrPath
    }
    $CommandLedger.Add([pscustomobject]$entry)
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'command-ledger.json') -Value $CommandLedger
    if ($process.ExitCode -ne 0) {
        if ($stdout) { Write-Host $stdout.TrimEnd() }
        if ($stderr) { Write-Warning $stderr.TrimEnd() }
        throw "Command '$Name' failed with exit code $($process.ExitCode)"
    }
    return [pscustomobject]@{ Stdout = $stdout; Stderr = $stderr; ExitCode = $process.ExitCode }
}

function Get-ListeningPids {
    param([Parameter(Mandatory)] [int]$Port)
    $script:NetstatSequence += 1
    $output = (Invoke-CapturedProcess -Name ("netstat-{0:D3}-port-{1}" -f $script:NetstatSequence, $Port) `
        -FilePath $NetstatExe -Arguments @('-ano', '-p', 'tcp')).Stdout
    $pids = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($line in ($output -split "`r?`n")) {
        $columns = $line.Trim() -split '\s+'
        if ($columns.Count -lt 5 -or $columns[0] -ne 'TCP' -or $columns[3] -ne 'LISTENING') { continue }
        if ($columns[1] -match ':(\d+)$' -and [int]$Matches[1] -eq $Port) { [void]$pids.Add([int]$columns[4]) }
    }
    return @($pids | Sort-Object)
}

function Assert-PortFree {
    param([Parameter(Mandatory)] [int]$Port)
    $pids = @(Get-ListeningPids -Port $Port)
    if ($pids.Count -gt 0) { throw "BLOCKED-FOREIGN-LISTENER: TCP $Port is owned by PID $($pids -join ', ')" }
}

function Get-HarnessProcesses {
    $binary = [IO.Path]::GetFullPath($AppBinaryPath)
    return @(
        Get-CimInstance Win32_Process -Filter "Name = 'ytm-free.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $binary } |
            Select-Object ProcessId, Name, ExecutablePath, CommandLine, CreationDate
    )
}

function Save-ProcessSnapshot {
    param([Parameter(Mandatory)] [string]$Name)
    $value = [ordered]@{
        captured_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        phase = $Name
        processes = @(Get-HarnessProcesses)
        port_3456_pids = @(Get-ListeningPids -Port 3456)
        embedded_port = $EmbeddedPort
        embedded_port_pids = @(Get-ListeningPids -Port $EmbeddedPort)
    }
    Write-JsonFile -Path (Join-Path $EvidenceRoot ("process-{0}.json" -f $Name)) -Value $value
    return $value
}

function Wait-HarnessClean {
    param([Parameter(Mandatory)] [string]$Phase)
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        $processes = @(Get-HarnessProcesses)
        $port3456 = @(Get-ListeningPids -Port 3456)
        $embedded = @(Get-ListeningPids -Port $EmbeddedPort)
        if ($processes.Count -eq 0 -and $port3456.Count -eq 0 -and $embedded.Count -eq 0) {
            Save-ProcessSnapshot -Name ($Phase + '-clean') | Out-Null
            return
        }
        Start-Sleep -Milliseconds 500
    }
    Save-ProcessSnapshot -Name ($Phase + '-residual') | Out-Null
    throw "FAIL - RESIDUAL-PROCESS after $Phase; no process was terminated"
}

function Get-FileMetadata {
    param([Parameter(Mandatory)] [string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [ordered]@{ path = $Path; exists = $false } }
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        path = $Path
        exists = $true
        size = $item.Length
        last_write_time_utc = $item.LastWriteTimeUtc.ToString('o')
        sha256 = Get-Sha256Hex -Path $Path
    }
}

function Get-RealAppDataSnapshot {
    $database = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'ytm-free\ytm-free.db'
    return [ordered]@{
        database = Get-FileMetadata -Path $database
        wal = Get-FileMetadata -Path ($database + '-wal')
        shm = Get-FileMetadata -Path ($database + '-shm')
    }
}

function Get-ProtectedSnapshot {
    $entries = [System.Collections.Generic.List[object]]::new()
    foreach ($relative in $AllowedUntrackedProtected) {
        $entries.Add([pscustomobject](Get-FileMetadata -Path (Join-Path $RepoRoot $relative)))
    }
    foreach ($tree in @('Spotify', '.omx')) {
        $root = Join-Path $RepoRoot $tree
        if (-not (Test-Path -LiteralPath $root)) {
            $entries.Add([pscustomobject]@{ path = $root; exists = $false })
            continue
        }
        foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName) {
            $entries.Add([pscustomobject](Get-FileMetadata -Path $file.FullName))
        }
    }
    return @($entries)
}

function Assert-EqualJson {
    param([Parameter(Mandatory)] [object]$Before, [Parameter(Mandatory)] [object]$After, [Parameter(Mandatory)] [string]$Failure)
    if (($Before | ConvertTo-Json -Depth 100 -Compress) -ne ($After | ConvertTo-Json -Depth 100 -Compress)) { throw $Failure }
}

function Get-GitState {
    $branch = (Invoke-CapturedProcess -Name 'git-branch' -FilePath $GitExe -Arguments @('branch', '--show-current')).Stdout.Trim()
    $head = (Invoke-CapturedProcess -Name 'git-head' -FilePath $GitExe -Arguments @('rev-parse', 'HEAD')).Stdout.Trim()
    $originMain = (Invoke-CapturedProcess -Name 'git-origin-main' -FilePath $GitExe -Arguments @('rev-parse', 'origin/main')).Stdout.Trim()
    return [pscustomobject]@{ Branch = $branch; Head = $head; OriginMain = $originMain }
}

function Assert-GitContext {
    param([Parameter(Mandatory)] [object]$GitState)

    if ($ExpectedHeadShaNormalized) {
        if ($GitState.Head -ne $ExpectedHeadShaNormalized) {
            throw "ExpectedHeadSha mismatch: expected=$ExpectedHeadShaNormalized actual=$($GitState.Head)"
        }
        if (@($BaselineSha, $ExpectedHeadShaNormalized) -notcontains $GitState.OriginMain) {
            throw "BLOCKED-BASELINE-MOVED: origin/main=$($GitState.OriginMain)"
        }
        return 'exact-commit'
    }

    if ($GitState.Branch -ne 'test/semantic-filtered-search-runtime') {
        throw "Unexpected branch: $($GitState.Branch)"
    }
    if ($GitState.OriginMain -ne $BaselineSha) {
        throw "BLOCKED-BASELINE-MOVED: origin/main=$($GitState.OriginMain)"
    }
    return 'precommit-branch'
}

function Assert-GitScope {
    $status = (Invoke-CapturedProcess -Name 'git-status-scope' -FilePath $GitExe -Arguments @('status', '--porcelain=v1', '-uall')).Stdout
    $trackedClean = $true
    foreach ($line in ($status -split "`r?`n")) {
        if (-not $line) { continue }
        $code = $line.Substring(0, 2)
        $path = $line.Substring(3).Replace('\', '/')
        if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
        if ($code -eq '??') {
            if (($AllowedUntrackedProtected -notcontains $path) -and ($AllowedHarnessFiles -notcontains $path)) {
                throw "FAIL-SCOPE: unexpected untracked path $path"
            }
            if ($AllowedHarnessFiles -contains $path) { $trackedClean = $false }
            continue
        }
        if ($AllowedHarnessFiles -contains $path -and -not $ExpectedHeadShaNormalized -and $code[0] -eq ' ' -and $code[1] -ne ' ') {
            $trackedClean = $false
            continue
        }
        throw "FAIL-SCOPE: unexpected repository change $line"
    }
    if ($ExpectedHeadShaNormalized -and -not $trackedClean) { throw 'Final commit-bound harness requires a clean tracked tree' }
    return $trackedClean
}

function Read-JsonFile {
    param([Parameter(Mandatory)] [string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Evidence file missing: $Path" }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-WdioLogEvidence {
    param([Parameter(Mandatory)] [string]$PhaseRoot)
    $logRoot = Join-Path $PhaseRoot 'wdio-logs'
    $files = if (Test-Path -LiteralPath $logRoot) { @(Get-ChildItem -LiteralPath $logRoot -Recurse -File | Sort-Object FullName) } else { @() }
    $inventory = @($files | ForEach-Object {
        [ordered]@{ path = Get-RelativePathCompatible -BasePath $EvidenceRoot -TargetPath $_.FullName; size = $_.Length; sha256 = Get-Sha256Hex $_.FullName }
    })
    $backend = [System.Collections.Generic.List[string]]::new()
    $frontend = [System.Collections.Generic.List[string]]::new()
    foreach ($file in $files) {
        $content = [IO.File]::ReadAllText($file.FullName)
        if ($file.Name -match 'frontend|console|webview|browser') { $frontend.Add("===== $($file.Name) =====`r`n$content") }
        else { $backend.Add("===== $($file.Name) =====`r`n$content") }
    }
    if ($backend.Count -eq 0) { $backend.Add("No backend/driver logs were emitted by @wdio/tauri-service into $logRoot.") }
    if ($frontend.Count -eq 0) { $frontend.Add("No frontend/console logs were emitted by @wdio/tauri-service into $logRoot.") }
    [IO.File]::WriteAllText((Join-Path $PhaseRoot 'backend.log'), ($backend -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $PhaseRoot 'frontend.log'), ($frontend -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
    return $inventory
}

$GitExe = Resolve-Application 'git.exe'
$NpmExe = Resolve-Application 'npm.cmd'
$PythonExe = Resolve-Application 'py.exe'
$NetstatExe = Resolve-Application 'netstat.exe'
$OllamaExe = Resolve-Application 'ollama.exe'
$exitCode = 1
$result = 'FAIL'
$failureMessage = $null
$gitState = $null
$gitContextMode = if ($ExpectedHeadShaNormalized) { 'exact-commit' } else { 'precommit-branch' }
$gitTrackedClean = $false
$protectedBefore = $null
$protectedAfter = $null
$appDataBefore = $null
$appDataAfter = $null
$cleanup = $null
$harnessBinarySha256 = $null
$fixtureManifestSha256 = $null
$packageLockSha256 = $null
$phaseA = $null
$phaseB = $null
$dbLogicalSha256 = $null
$changedTables = @()
$wdioLogsInventory = @()

try {
    Set-Location $RepoRoot
    if (Test-Path -LiteralPath (Join-Path $RepoRoot '.git\index.lock')) { throw 'BLOCKED-INDEX-LOCK' }
    if (-not (Test-Path -LiteralPath $FixtureScript -PathType Leaf)) { throw "Fixture missing: $FixtureScript" }
    if (-not (Test-Path -LiteralPath $WdioExe -PathType Leaf)) { throw "WDIO binary missing: $WdioExe" }
    if ($EmbeddedPort -eq 3456) { throw 'EmbeddedPort must differ from the application stream port 3456' }
    $resolvedEvidence = $EvidenceRoot.TrimEnd('\') + '\'
    $resolvedRuntime = [IO.Path]::GetFullPath($TempRuntimeRoot).TrimEnd('\') + '\'
    if ($resolvedEvidence.StartsWith($resolvedRuntime, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'EvidenceRoot must not be inside the owned temporary runtime root'
    }

    $gitState = Get-GitState
    $gitContextMode = Assert-GitContext -GitState $gitState
    $gitTrackedClean = Assert-GitScope
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'git-state-before.json') -Value ([ordered]@{
        git_context_mode = $gitContextMode
        branch = $gitState.Branch
        head_sha = $gitState.Head
        expected_head_sha = $ExpectedHeadShaNormalized
        origin_main_sha = $gitState.OriginMain
        baseline_sha = $BaselineSha
        git_tracked_clean = $gitTrackedClean
    })

    Assert-PortFree 3456
    Assert-PortFree $EmbeddedPort
    if (@(Get-HarnessProcesses).Count -gt 0) { throw 'BLOCKED-FOREIGN-LISTENER: pre-existing harness binary process' }
    Save-ProcessSnapshot -Name 'before' | Out-Null

    $protectedBefore = Get-ProtectedSnapshot
    $appDataBefore = Get-RealAppDataSnapshot
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'protected-before.json') -Value $protectedBefore
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'real-appdata-before.json') -Value $appDataBefore
    $packageLockSha256 = Get-Sha256Hex $PackageLockPath

    $ollamaTags = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'ollama-tags.json') -Value $ollamaTags
    if (-not @($ollamaTags.models | ForEach-Object { $_.name } | Where-Object { ($_ -split ':')[0] -eq 'all-minilm' })) {
        throw 'Ollama model all-minilm is absent; ollama pull is prohibited'
    }
    $ollamaVersion = Invoke-CapturedProcess -Name 'ollama-version' -FilePath $OllamaExe -Arguments @('--version')
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'ollama-version.json') -Value ([ordered]@{ raw = $ollamaVersion.Stdout.Trim() })
    $ollamaModel = Invoke-CapturedProcess -Name 'ollama-show-all-minilm' -FilePath $OllamaExe -Arguments @('show', 'all-minilm')
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'ollama-model-info.json') -Value ([ordered]@{ model = 'all-minilm'; raw = $ollamaModel.Stdout })

    $env:YTM_FREE_DATA_DIR = $DataDir
    $env:WDIO_EMBEDDED_PORT = [string]$EmbeddedPort
    $env:TAURI_WEBDRIVER_PORT = [string]$EmbeddedPort
    $env:EVIDENCE_ROOT = $EvidenceRoot

    Invoke-CapturedProcess -Name 'harness-build' -FilePath $NpmExe -Arguments @('run', 'harness:build') | Out-Null
    if (-not (Test-Path -LiteralPath $AppBinaryPath -PathType Leaf)) { throw "Harness binary missing: $AppBinaryPath" }
    $harnessBinarySha256 = Get-Sha256Hex $AppBinaryPath
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'harness-binary.json') -Value (Get-FileMetadata $AppBinaryPath)

    Invoke-CapturedProcess -Name 'harness-schema' -FilePath $NpmExe -Arguments @('run', 'harness:schema') | Out-Null
    Wait-HarnessClean -Phase 'schema'
    Invoke-CapturedProcess -Name 'schema-db-unlock' -FilePath $PythonExe -Arguments @('-3', $FixtureScript, '--data-dir', $DataDir, '--check-only') | Out-Null
    $seed = Invoke-CapturedProcess -Name 'seed-fixture' -FilePath $PythonExe -Arguments @('-3', $FixtureScript, '--data-dir', $DataDir, '--evidence-root', $EvidenceRoot)
    $seedJson = $seed.Stdout | ConvertFrom-Json
    $fixtureManifestSha256 = $seedJson.manifest_sha256

    Assert-PortFree 3456
    Assert-PortFree $EmbeddedPort
    $env:SEMANTIC_FILTERED_PHASE = 'ann'
    $env:EVIDENCE_ROOT = $PhaseARoot
    Invoke-CapturedProcess -Name 'phase-a-ann-wdio' -FilePath $WdioExe -Arguments @('run', 'wdio.conf.ts', '--spec', $RuntimeSpec) | Out-Null
    Wait-HarnessClean -Phase 'phase-a'
    Invoke-CapturedProcess -Name 'phase-a-db-unlock' -FilePath $PythonExe -Arguments @('-3', $FixtureScript, '--data-dir', $DataDir, '--check-only') | Out-Null
    $phaseAVerify = Invoke-CapturedProcess -Name 'phase-a-db-final' -FilePath $PythonExe -Arguments @('-3', $FixtureScript, '--data-dir', $DataDir, '--verify-final')
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'db-after-phase-a.json'), $phaseAVerify.Stdout, [Text.UTF8Encoding]::new($false))

    Assert-PortFree 3456
    Assert-PortFree $EmbeddedPort
    $env:SEMANTIC_FILTERED_PHASE = 'db-fallback'
    $env:EVIDENCE_ROOT = $PhaseBRoot
    Invoke-CapturedProcess -Name 'phase-b-db-fallback-wdio' -FilePath $WdioExe -Arguments @('run', 'wdio.conf.ts', '--spec', $RuntimeSpec) | Out-Null
    Wait-HarnessClean -Phase 'phase-b'
    Invoke-CapturedProcess -Name 'phase-b-db-unlock' -FilePath $PythonExe -Arguments @('-3', $FixtureScript, '--data-dir', $DataDir, '--check-only') | Out-Null
    $phaseBVerify = Invoke-CapturedProcess -Name 'phase-b-db-final' -FilePath $PythonExe -Arguments @('-3', $FixtureScript, '--data-dir', $DataDir, '--verify-final')
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'db-after-phase-b.json'), $phaseBVerify.Stdout, [Text.UTF8Encoding]::new($false))

    $phaseA = Read-JsonFile (Join-Path $PhaseARoot 'phase-summary.json')
    $phaseB = Read-JsonFile (Join-Path $PhaseBRoot 'phase-summary.json')
    $phaseAProbeBefore = Read-JsonFile (Join-Path $PhaseARoot 'probe-before.json')
    $phaseAProbeAfterIndex = Read-JsonFile (Join-Path $PhaseARoot 'probe-after-index.json')
    $phaseAGenreProbe = Read-JsonFile (Join-Path $PhaseARoot 'probe-after-genre-filter.json')
    $phaseACombinedProbe = Read-JsonFile (Join-Path $PhaseARoot 'probe-after-combined-filter.json')
    $phaseBProbeBefore = Read-JsonFile (Join-Path $PhaseBRoot 'probe-before.json')
    $phaseBGenreProbe = Read-JsonFile (Join-Path $PhaseBRoot 'probe-after-genre-filter.json')
    $phaseBCombinedProbe = Read-JsonFile (Join-Path $PhaseBRoot 'probe-after-combined-filter.json')
    $reindexEvidence = Read-JsonFile (Join-Path $PhaseBRoot 'reindex-clicked.json')

    if ($phaseAProbeBefore.ann_index_size -ne 0 -or $phaseAProbeBefore.semantic_filtered_runtime_path) { throw 'FAIL - ANN-PATH-NOT-PROVEN: invalid Phase A initial probe' }
    if ($phaseAProbeAfterIndex.indexed_tracks -ne 5 -or $phaseAProbeAfterIndex.ann_index_size -ne 5 -or $phaseAProbeAfterIndex.semantic_filtered_runtime_path) { throw 'FAIL - ANN-PATH-NOT-PROVEN: invalid post-index probe' }
    if ($phaseAGenreProbe.semantic_filtered_runtime_path -ne 'ann' -or $phaseACombinedProbe.semantic_filtered_runtime_path -ne 'ann') { throw 'FAIL - ANN-PATH-NOT-PROVEN' }
    if ($phaseBProbeBefore.runtime_process_id -eq $phaseAProbeBefore.runtime_process_id) { throw 'FAIL - DB-FALLBACK-PATH-NOT-PROVEN: process IDs are equal' }
    if ($phaseBProbeBefore.indexed_tracks -ne 5 -or $phaseBProbeBefore.ann_index_size -ne 0 -or $phaseBProbeBefore.semantic_filtered_runtime_path) { throw 'FAIL - DB-FALLBACK-PATH-NOT-PROVEN: invalid Phase B initial probe' }
    if ($phaseBGenreProbe.semantic_filtered_runtime_path -ne 'db_fallback' -or $phaseBCombinedProbe.semantic_filtered_runtime_path -ne 'db_fallback') { throw 'FAIL - DB-FALLBACK-PATH-NOT-PROVEN' }
    if ([bool]$reindexEvidence.reindex_clicked) { throw 'Phase B reindex evidence is true' }
    if (($phaseA.genre_result_ids | ConvertTo-Json -Compress) -ne ($phaseB.genre_result_ids | ConvertTo-Json -Compress) -or
        ($phaseA.genre_result_order | ConvertTo-Json -Compress) -ne ($phaseB.genre_result_order | ConvertTo-Json -Compress) -or
        ($phaseA.combined_result_ids | ConvertTo-Json -Compress) -ne ($phaseB.combined_result_ids | ConvertTo-Json -Compress) -or
        ($phaseA.combined_result_order | ConvertTo-Json -Compress) -ne ($phaseB.combined_result_order | ConvertTo-Json -Compress)) {
        throw 'FAIL - RESULT-PARITY'
    }

    $dbAStart = Read-JsonFile (Join-Path $PhaseARoot 'db-before-query.json')
    $dbAEnd = Read-JsonFile (Join-Path $PhaseARoot 'db-after-query.json')
    $dbBStart = Read-JsonFile (Join-Path $PhaseBRoot 'db-before-query.json')
    $dbBEnd = Read-JsonFile (Join-Path $PhaseBRoot 'db-after-query.json')
    foreach ($snapshot in @($dbAStart, $dbAEnd, $dbBStart, $dbBEnd)) {
        if ($snapshot.mode -ne 'logical-read-only-snapshot') { throw 'Unexpected logical SQLite snapshot mode' }
    }
    $logicalHashes = @(
        [string]$dbAStart.logical_sha256
        [string]$dbAEnd.logical_sha256
        [string]$dbBStart.logical_sha256
        [string]$dbBEnd.logical_sha256
    )
    if ($logicalHashes.Count -ne 4) {
        throw 'FAIL - DB-MUTATED: expected four logical hashes'
    }
    $mismatchedLogicalHashes = @(
        $logicalHashes | Where-Object {
            $_ -ne $logicalHashes[0]
        }
    )
    if ($mismatchedLogicalHashes.Count -ne 0) {
        throw 'FAIL - DB-MUTATED'
    }
    $dbLogicalSha256 = $logicalHashes[0]
    $tablesCanonical = $dbAStart.tables | ConvertTo-Json -Depth 100 -Compress
    foreach ($snapshot in @($dbAEnd, $dbBStart, $dbBEnd)) {
        if (($snapshot.tables | ConvertTo-Json -Depth 100 -Compress) -ne $tablesCanonical) { throw 'FAIL - DB-MUTATED: per-table digest mismatch' }
    }
    $changedTables = @($phaseA.changed_tables) + @($phaseB.changed_tables) | Select-Object -Unique
    if ($changedTables.Count -ne 0) { throw 'FAIL - DB-MUTATED: changed_tables is not empty' }

    $wdioLogsInventory = @(
        Write-WdioLogEvidence -PhaseRoot $PhaseARoot
        Write-WdioLogEvidence -PhaseRoot $PhaseBRoot
    )
    $gitTrackedClean = Assert-GitScope
    $result = "PASS $EmDash SEMANTIC-FILTERED-RUNTIME-PROVEN"
    $exitCode = 0
}
catch {
    $failureMessage = $_.Exception.Message
    Write-Error $failureMessage
}
finally {
    try { Wait-HarnessClean -Phase 'final' } catch {
        if (-not $failureMessage) { $failureMessage = $_.Exception.Message }
        $result = 'FAIL'
        $exitCode = 1
    }

    try {
        if ($protectedBefore) {
            $protectedAfter = Get-ProtectedSnapshot
            Write-JsonFile -Path (Join-Path $EvidenceRoot 'protected-after.json') -Value $protectedAfter
            Assert-EqualJson $protectedBefore $protectedAfter 'Protected files changed during harness execution'
        }
        if ($appDataBefore) {
            $appDataAfter = Get-RealAppDataSnapshot
            Write-JsonFile -Path (Join-Path $EvidenceRoot 'real-appdata-after.json') -Value $appDataAfter
            Assert-EqualJson $appDataBefore $appDataAfter 'FAIL - REAL-APPDATA-MUTATED'
        }
    }
    catch {
        if (-not $failureMessage) { $failureMessage = $_.Exception.Message }
        $result = 'FAIL'
        $exitCode = 1
    }

    $tempInventory = if (Test-Path -LiteralPath $TempRuntimeRoot) {
        @(Get-ChildItem -LiteralPath $TempRuntimeRoot -Recurse -Force | Select-Object FullName, Length, LastWriteTimeUtc)
    } else { @() }
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'temp-runtime-inventory.json') -Value $tempInventory
    $cleanup = [ordered]@{
        temp_runtime_root = $TempRuntimeRoot
        evidence_root = $EvidenceRoot
        temp_removed = $false
        evidence_preserved = (Test-Path -LiteralPath $EvidenceRoot)
        error = $null
    }
    try {
        if (Test-Path -LiteralPath $TempRuntimeRoot) {
            $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
            $runtime = [IO.Path]::GetFullPath($TempRuntimeRoot)
            if (-not $runtime.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or
                -not [IO.Path]::GetFileName($runtime).StartsWith('ytm-free-semantic-filtered-runtime-', [StringComparison]::Ordinal)) {
                throw "Refusing cleanup outside owned runtime root: $runtime"
            }
            Remove-Item -LiteralPath $runtime -Recurse -Force
        }
        $cleanup.temp_removed = -not (Test-Path -LiteralPath $TempRuntimeRoot)
    }
    catch {
        $cleanup.error = $_.Exception.Message
        if (-not $failureMessage) { $failureMessage = "Temporary cleanup failed: $($cleanup.error)" }
        $result = 'FAIL'
        $exitCode = 1
    }
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'cleanup-ledger.json') -Value $cleanup

    $env:YTM_FREE_DATA_DIR = $OriginalEnvironment.YTM_FREE_DATA_DIR
    $env:EVIDENCE_ROOT = $OriginalEnvironment.EVIDENCE_ROOT
    $env:WDIO_EMBEDDED_PORT = $OriginalEnvironment.WDIO_EMBEDDED_PORT
    $env:TAURI_WEBDRIVER_PORT = $OriginalEnvironment.TAURI_WEBDRIVER_PORT
    $env:SEMANTIC_FILTERED_PHASE = $OriginalEnvironment.SEMANTIC_FILTERED_PHASE

    $nonZeroCommands = @($CommandLedger | Where-Object { $_.exit_code -ne 0 })
    if ($exitCode -eq 0 -and $nonZeroCommands.Count -ne 0) {
        $result = 'FAIL'
        $failureMessage = 'Command ledger contains non-zero exits'
        $exitCode = 1
    }
    $stdoutFiles = @(Get-ChildItem -LiteralPath $CommandLogRoot -Filter '*.stdout.log' -File)
    $stderrFiles = @(Get-ChildItem -LiteralPath $CommandLogRoot -Filter '*.stderr.log' -File)
    if ($exitCode -eq 0 -and ($stdoutFiles.Count -ne $CommandLedger.Count -or $stderrFiles.Count -ne $CommandLedger.Count)) {
        $result = 'FAIL'
        $failureMessage = 'Command stdout/stderr file counts are not unique and complete'
        $exitCode = 1
    }

    $evidenceFiles = @(
        Get-ChildItem -LiteralPath $EvidenceRoot -Recurse -File |
            Where-Object { $_.Name -ne 'final-manifest.json' } |
            Sort-Object FullName |
            ForEach-Object {
                [ordered]@{
                    path = Get-RelativePathCompatible -BasePath $EvidenceRoot -TargetPath $_.FullName
                    size = $_.Length
                    sha256 = Get-Sha256Hex $_.FullName
                }
            }
    )
    $manifest = [ordered]@{
        result = $result
        failure = $failureMessage
        git_context_mode = $gitContextMode
        branch = if ($gitState) { $gitState.Branch } else { $null }
        head_sha = if ($gitState) { $gitState.Head } else { $null }
        expected_head_sha = $ExpectedHeadShaNormalized
        origin_main_sha = if ($gitState) { $gitState.OriginMain } else { $null }
        baseline_sha = $BaselineSha
        git_tracked_clean = $gitTrackedClean
        query = 'ambient music for calm focus and sleep'
        filters = [ordered]@{
            genre_only = [ordered]@{ genres = @('Ambient'); moods = @(); activities = @() }
            combined = [ordered]@{ genres = @('Ambient'); moods = @('Calm'); activities = @('sleep') }
        }
        phase_a_pid = if ($phaseA) { $phaseA.runtime_process_id } else { $null }
        phase_b_pid = if ($phaseB) { $phaseB.runtime_process_id } else { $null }
        phase_a_ann_before = if ($phaseA) { $phaseA.ann_index_size_before } else { $null }
        phase_a_ann_after = if ($phaseA) { $phaseA.ann_index_size_after_filters } else { $null }
        phase_b_ann_before = if ($phaseB) { $phaseB.ann_index_size_before } else { $null }
        phase_b_ann_after = if ($phaseB) { $phaseB.ann_index_size_after_filters } else { $null }
        phase_a_runtime_path = if ($phaseA) { $phaseA.semantic_filtered_runtime_path } else { $null }
        phase_b_runtime_path = if ($phaseB) { $phaseB.semantic_filtered_runtime_path } else { $null }
        phase_a_genre_result_ids = if ($phaseA) { @($phaseA.genre_result_ids) } else { @() }
        phase_b_genre_result_ids = if ($phaseB) { @($phaseB.genre_result_ids) } else { @() }
        phase_a_genre_result_order = if ($phaseA) { @($phaseA.genre_result_order) } else { @() }
        phase_b_genre_result_order = if ($phaseB) { @($phaseB.genre_result_order) } else { @() }
        phase_a_combined_result_ids = if ($phaseA) { @($phaseA.combined_result_ids) } else { @() }
        phase_b_combined_result_ids = if ($phaseB) { @($phaseB.combined_result_ids) } else { @() }
        phase_a_combined_result_order = if ($phaseA) { @($phaseA.combined_result_order) } else { @() }
        phase_b_combined_result_order = if ($phaseB) { @($phaseB.combined_result_order) } else { @() }
        db_logical_sha256 = $dbLogicalSha256
        db_logical_equal = if ($phaseA -and $phaseB) { [bool]$phaseA.db_logical_equal -and [bool]$phaseB.db_logical_equal } else { $false }
        changed_tables = @($changedTables)
        fixture_manifest_sha256 = $fixtureManifestSha256
        harness_binary_sha256 = $harnessBinarySha256
        package_lock_sha256 = $packageLockSha256
        appdata_before = $appDataBefore
        appdata_after = $appDataAfter
        appdata_equal = if ($appDataBefore -and $appDataAfter) { ($appDataBefore | ConvertTo-Json -Depth 100 -Compress) -eq ($appDataAfter | ConvertTo-Json -Depth 100 -Compress) } else { $false }
        protected_equal = if ($protectedBefore -and $protectedAfter) { ($protectedBefore | ConvertTo-Json -Depth 100 -Compress) -eq ($protectedAfter | ConvertTo-Json -Depth 100 -Compress) } else { $false }
        cleanup_status = $cleanup
        embedded_port = $EmbeddedPort
        wdio_logs_inventory = @($wdioLogsInventory)
        command_count = $CommandLedger.Count
        command_nonzero_count = $nonZeroCommands.Count
        command_stdout_count = $stdoutFiles.Count
        command_stderr_count = $stderrFiles.Count
        evidence_integrity_count = $evidenceFiles.Count
        evidence_files = $evidenceFiles
        generated_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    }
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'final-manifest.json') -Value $manifest
    Write-Host "RESULT: $result"
    Write-Host "EVIDENCE_ROOT: $EvidenceRoot"
}

exit $exitCode
