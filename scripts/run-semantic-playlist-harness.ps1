[CmdletBinding()]
param(
    [string]$EvidenceRoot,
    [ValidateRange(1, 65535)]
    [int]$EmbeddedPort = 4447,
    [string]$ExpectedHeadSha
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$EmDash = [char]0x2014

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $EvidenceRoot = Join-Path $env:TEMP ("ytm-free-semantic-playlist-evidence-{0}" -f $Timestamp)
}
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
$TempRuntimeRoot = Join-Path $env:TEMP ("ytm-free-semantic-playlist-runtime-{0}" -f $Timestamp)
$DataDir = Join-Path $TempRuntimeRoot 'data'
$CommandLogRoot = Join-Path $EvidenceRoot 'commands'
$CreateRoot = Join-Path $EvidenceRoot 'create'
$RestartRoot = Join-Path $EvidenceRoot 'restart'
$AppBinaryPath = Join-Path $RepoRoot 'src-tauri\target\debug\ytm-free.exe'
$WdioExe = Join-Path $RepoRoot 'node_modules\.bin\wdio.cmd'
$FixtureScript = Join-Path $RepoRoot 'scripts\seed-semantic-search-query-fixture.py'
$RuntimeSpec = 'tests/e2e/semantic-playlist-runtime.spec.ts'
$PackageLockPath = Join-Path $RepoRoot 'package-lock.json'
$BaselineSha = '93594172e68ef7f57dd4fa218e2c39225cdc6d3b'
$ExpectedHeadShaNormalized = if ([string]::IsNullOrWhiteSpace($ExpectedHeadSha)) { $null } else { $ExpectedHeadSha.Trim() }
$ArchivedEvidenceRoot = $null
$AllowedUntrackedProtected = @(
    'AGENTS.md',
    'docs/GDPR_REMEDIATION_PLAN.md',
    'docs/plan-remediere-gdpr-complete.md',
    'gdpr-compliance-audit-report.md'
)
$AllowedHarnessFiles = @(
    'src/api.ts',
    'src/components/views/PlaylistsView.tsx',
    'src-tauri/src/lib.rs',
    'src-tauri/src/db.rs',
    'tests/e2e/semantic-playlist-runtime.spec.ts',
    'scripts/run-semantic-playlist-harness.ps1'
)
$CommandLedger = [System.Collections.Generic.List[object]]::new()
$CommandSequence = 0
$NetstatSequence = 0
$OriginalEnvironment = @{
    YTM_FREE_DATA_DIR = $env:YTM_FREE_DATA_DIR
    EVIDENCE_ROOT = $env:EVIDENCE_ROOT
    WDIO_EMBEDDED_PORT = $env:WDIO_EMBEDDED_PORT
    TAURI_WEBDRIVER_PORT = $env:TAURI_WEBDRIVER_PORT
    SEMANTIC_PLAYLIST_PHASE = $env:SEMANTIC_PLAYLIST_PHASE
}

if (Test-Path -LiteralPath $EvidenceRoot -PathType Leaf) {
    throw "EvidenceRoot points to a file, not a directory: $EvidenceRoot"
}

if (Test-Path -LiteralPath $EvidenceRoot -PathType Container) {
    $existingEvidenceEntries = @(Get-ChildItem -LiteralPath $EvidenceRoot -Force -ErrorAction Stop)
    if ($existingEvidenceEntries.Count -gt 0) {
        $archiveCandidate = '{0}.previous-{1}' -f $EvidenceRoot.TrimEnd('\'), $Timestamp
        $archiveSuffix = 0
        while (Test-Path -LiteralPath $archiveCandidate) {
            $archiveSuffix += 1
            $archiveCandidate = '{0}.previous-{1}-{2:D2}' -f $EvidenceRoot.TrimEnd('\'), $Timestamp, $archiveSuffix
        }
        Move-Item -LiteralPath $EvidenceRoot -Destination $archiveCandidate
        $ArchivedEvidenceRoot = $archiveCandidate
    }
}

New-Item -ItemType Directory -Force -Path $EvidenceRoot, $CommandLogRoot, $DataDir, $CreateRoot, $RestartRoot | Out-Null

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

    if ($GitState.Branch -ne 'feat/semantic-playlist-runtime') {
        throw "Unexpected branch: $($GitState.Branch)"
    }
    if ($GitState.OriginMain -ne $BaselineSha) {
        throw "BLOCKED-BASELINE-MOVED: origin/main=$($GitState.OriginMain)"
    }
    return 'precommit'
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
$gitContextMode = if ($ExpectedHeadShaNormalized) { 'exact-commit' } else { 'precommit' }
$gitTrackedClean = $false
$protectedBefore = $null
$protectedAfter = $null
$appDataBefore = $null
$appDataAfter = $null
$cleanup = $null
$harnessBinarySha256 = $null
$fixtureManifestSha256 = $null
$packageLockSha256 = $null
$createEvidence = $null
$restartEvidence = $null
$dbLogicalShaPreCreate = $null
$dbLogicalShaPostCreate = $null
$dbLogicalShaPostRestart = $null
$createChangedTables = @()
$restartChangedTables = @()
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
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'protected-files-before.json') -Value $protectedBefore
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'appdata-before.json') -Value $appDataBefore
    $packageLockSha256 = Get-Sha256Hex $PackageLockPath

    $ollamaTags = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'ollama-tags.json') -Value $ollamaTags
    if (-not @($ollamaTags.models | ForEach-Object { $_.name } | Where-Object { ($_ -split ':')[0] -eq 'all-minilm' })) {
        throw 'Ollama model all-minilm is absent; ollama pull is prohibited'
    }
    $ollamaVersion = Invoke-CapturedProcess -Name 'ollama-version' -FilePath $OllamaExe -Arguments @('--version')
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'ollama-version.json') -Value ([ordered]@{ raw = $ollamaVersion.Stdout.Trim() })

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

    # ===== CREATE PHASE =====
    Assert-PortFree 3456
    Assert-PortFree $EmbeddedPort
    $env:SEMANTIC_PLAYLIST_PHASE = 'create'
    $env:EVIDENCE_ROOT = $CreateRoot
    Invoke-CapturedProcess -Name 'create-phase-wdio' -FilePath $WdioExe -Arguments @('run', 'wdio.conf.ts', '--spec', $RuntimeSpec) | Out-Null
    Wait-HarnessClean -Phase 'create'
    Invoke-CapturedProcess -Name 'create-db-unlock' -FilePath $PythonExe -Arguments @('-3', $FixtureScript, '--data-dir', $DataDir, '--check-only') | Out-Null

    # ===== RESTART PHASE (new process, same data dir, no reseed) =====
    Assert-PortFree 3456
    Assert-PortFree $EmbeddedPort
    $env:SEMANTIC_PLAYLIST_PHASE = 'restart'
    $env:EVIDENCE_ROOT = $RestartRoot
    Invoke-CapturedProcess -Name 'restart-phase-wdio' -FilePath $WdioExe -Arguments @('run', 'wdio.conf.ts', '--spec', $RuntimeSpec) | Out-Null
    Wait-HarnessClean -Phase 'restart'
    Invoke-CapturedProcess -Name 'restart-db-unlock' -FilePath $PythonExe -Arguments @('-3', $FixtureScript, '--data-dir', $DataDir, '--check-only') | Out-Null

    # ===== VALIDATION =====
    $createProcesses = Read-JsonFile (Join-Path $CreateRoot 'runtime-processes.json')
    $restartProcesses = Read-JsonFile (Join-Path $RestartRoot 'runtime-processes.json')
    $embeddingBackend = if ($createProcesses.PSObject.Properties.Name -contains 'embedding_backend') {
        [string]$createProcesses.embedding_backend
    } else {
        'local-ollama'
    }
    $embeddingModel = if ($createProcesses.PSObject.Properties.Name -contains 'embedding_model') {
        [string]$createProcesses.embedding_model
    } else {
        'all-minilm'
    }
    if ($createProcesses.runtime_process_id -eq $restartProcesses.runtime_process_id) {
        throw 'FAIL-RUNTIME: create PID equals restart PID'
    }

    $createUi = Read-JsonFile (Join-Path $CreateRoot 'created-playlist-ui.json')
    $createIpc = Read-JsonFile (Join-Path $CreateRoot 'created-playlist-ipc.json')
    $restartUi = Read-JsonFile (Join-Path $RestartRoot 'restart-playlist-ui.json')
    $restartIpc = Read-JsonFile (Join-Path $RestartRoot 'restart-playlist-ipc.json')
    $oracle = Read-JsonFile (Join-Path $CreateRoot 'semantic-oracle.json')

    if (-not $createUi.ui_matches_oracle) { throw 'FAIL-RUNTIME: created UI order != oracle order' }
    if (-not $createIpc.ipc_matches_oracle) { throw 'FAIL-RUNTIME: created IPC order != oracle order' }
    if ($createIpc.playlist_id -ne $restartIpc.playlist_id) { throw 'FAIL-RUNTIME: restart playlist ID changed' }
    if (-not $restartUi.restart_matches_create) { throw 'FAIL-RUNTIME: restart UI order != create order' }
    if (-not $restartIpc.restart_matches_create) { throw 'FAIL-RUNTIME: restart IPC order != create order' }
    if ($createIpc.track_count -le 0) { throw 'FAIL-RUNTIME: track count is not > 0' }
    if ($createIpc.track_count -ne $restartIpc.track_count) { throw 'FAIL-RUNTIME: restart track count differs' }

    $dbPreCreate = Read-JsonFile (Join-Path $CreateRoot 'pre-create-logical-snapshot.json')
    $dbPostCreate = Read-JsonFile (Join-Path $CreateRoot 'post-create-logical-snapshot.json')
    $dbPostRestart = Read-JsonFile (Join-Path $RestartRoot 'post-restart-logical-snapshot.json')
    $dbLogicalShaPreCreate = $dbPreCreate.logical_sha256
    $dbLogicalShaPostCreate = $dbPostCreate.logical_sha256
    $dbLogicalShaPostRestart = $dbPostRestart.logical_sha256

    # post-create != pre-create (playlists+playlist_tracks changed)
    if ($dbLogicalShaPreCreate -eq $dbLogicalShaPostCreate) {
        throw 'FAIL-RUNTIME: DB SHA unchanged after create — expected playlists+playlist_tracks mutation'
    }
    # post-restart == post-create
    if ($dbLogicalShaPostCreate -ne $dbLogicalShaPostRestart) {
        throw 'FAIL-RUNTIME: post-restart DB SHA != post-create DB SHA'
    }

    # Compute changed tables
    $tableNames = [System.Collections.Generic.SortedSet[string]]::new()
    foreach ($t in $dbPreCreate.tables.PSObject.Properties.Name) { [void]$tableNames.Add($t) }
    foreach ($t in $dbPostCreate.tables.PSObject.Properties.Name) { [void]$tableNames.Add($t) }
    $createChangedTables = @($tableNames | Where-Object {
        $l = $dbPreCreate.tables.$_
        $r = $dbPostCreate.tables.$_
        -not $l -or -not $r -or $l.row_count -ne $r.row_count -or $l.sha256 -ne $r.sha256
    } | Sort-Object)
    if (($createChangedTables -join ',') -ne 'playlist_tracks,playlists') {
        throw "FAIL-RUNTIME: pre->post changed tables = $($createChangedTables -join ',') expected playlist_tracks,playlists"
    }

    $restartChangedTables = @($tableNames | Where-Object {
        $l = $dbPostCreate.tables.$_
        $r = $dbPostRestart.tables.$_
        -not $l -or -not $r -or $l.row_count -ne $r.row_count -or $l.sha256 -ne $r.sha256
    } | Sort-Object)
    if ($restartChangedTables.Count -ne 0) {
        throw "FAIL-RUNTIME: post-create->post-restart changed tables = $($restartChangedTables -join ',')"
    }

    $wdioLogsInventory = @(
        Write-WdioLogEvidence -PhaseRoot $CreateRoot
        Write-WdioLogEvidence -PhaseRoot $RestartRoot
    )

    # Rename WDIO log files to expected names.
    Copy-Item (Join-Path $CreateRoot 'backend.log') (Join-Path $EvidenceRoot 'backend-create.log') -Force
    Copy-Item (Join-Path $RestartRoot 'backend.log') (Join-Path $EvidenceRoot 'backend-restart.log') -Force
    Copy-Item (Join-Path $CreateRoot 'frontend.log') (Join-Path $EvidenceRoot 'frontend-create.log') -Force
    Copy-Item (Join-Path $RestartRoot 'frontend.log') (Join-Path $EvidenceRoot 'frontend-restart.log') -Force
    if (Test-Path (Join-Path $CreateRoot 'wdio-logs')) {
        $wdioCreateLogs = Get-ChildItem (Join-Path $CreateRoot 'wdio-logs') -Recurse -File
        if ($wdioCreateLogs) { Copy-Item $wdioCreateLogs[0].FullName (Join-Path $EvidenceRoot 'wdio-create.log') -Force }
    }
    if (-not (Test-Path (Join-Path $EvidenceRoot 'wdio-create.log'))) {
        [IO.File]::WriteAllText(
            (Join-Path $EvidenceRoot 'wdio-create.log'),
            "No raw WDIO log files were emitted by @wdio/tauri-service for the create phase.`r`n",
            [Text.UTF8Encoding]::new($false)
        )
    }
    if (Test-Path (Join-Path $RestartRoot 'wdio-logs')) {
        $wdioRestartLogs = Get-ChildItem (Join-Path $RestartRoot 'wdio-logs') -Recurse -File
        if ($wdioRestartLogs) { Copy-Item $wdioRestartLogs[0].FullName (Join-Path $EvidenceRoot 'wdio-restart.log') -Force }
    }
    if (-not (Test-Path (Join-Path $EvidenceRoot 'wdio-restart.log'))) {
        [IO.File]::WriteAllText(
            (Join-Path $EvidenceRoot 'wdio-restart.log'),
            "No raw WDIO log files were emitted by @wdio/tauri-service for the restart phase.`r`n",
            [Text.UTF8Encoding]::new($false)
        )
    }

    $gitTrackedClean = Assert-GitScope
    $result = "PASS $EmDash SEMANTIC-PLAYLIST-RUNTIME-PROVEN"
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
            Write-JsonFile -Path (Join-Path $EvidenceRoot 'protected-files-after.json') -Value $protectedAfter
            Assert-EqualJson $protectedBefore $protectedAfter 'Protected files changed during harness execution'
        }
        if ($appDataBefore) {
            $appDataAfter = Get-RealAppDataSnapshot
            Write-JsonFile -Path (Join-Path $EvidenceRoot 'appdata-after.json') -Value $appDataAfter
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
                -not [IO.Path]::GetFileName($runtime).StartsWith('ytm-free-semantic-playlist-runtime-', [StringComparison]::Ordinal)) {
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
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'cleanup.json') -Value $cleanup

    $env:YTM_FREE_DATA_DIR = $OriginalEnvironment.YTM_FREE_DATA_DIR
    $env:EVIDENCE_ROOT = $OriginalEnvironment.EVIDENCE_ROOT
    $env:WDIO_EMBEDDED_PORT = $OriginalEnvironment.WDIO_EMBEDDED_PORT
    $env:TAURI_WEBDRIVER_PORT = $OriginalEnvironment.TAURI_WEBDRIVER_PORT
    $env:SEMANTIC_PLAYLIST_PHASE = $OriginalEnvironment.SEMANTIC_PLAYLIST_PHASE

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
            Where-Object { $_.Name -ne 'manifest.json' } |
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
        archived_previous_evidence_root = $ArchivedEvidenceRoot
        git_context_mode = $gitContextMode
        head_sha = if ($gitState) { $gitState.Head } else { $null }
        expected_head_sha = $ExpectedHeadShaNormalized
        origin_main_sha = if ($gitState) { $gitState.OriginMain } else { $null }
        baseline_sha = $BaselineSha
        git_tracked_clean = $gitTrackedClean
        query = 'ambient music for calm focus and sleep'
        playlist_name = 'Semantic Calm Focus'
        playlist_id = if ($createIpc) { $createIpc.playlist_id } else { $null }
        expected_track_ids = if ($oracle) { @($oracle.expected_ids) } else { @() }
        expected_track_order = if ($oracle) { @($oracle.expected_order) } else { @() }
        created_track_ids = if ($createIpc) { @($createIpc.ipc_track_ids) } else { @() }
        created_track_order = if ($createIpc) { @($createIpc.ipc_track_titles) } else { @() }
        created_track_count = if ($createIpc) { $createIpc.track_count } else { $null }
        embedding_backend = if ($embeddingBackend) { $embeddingBackend } else { 'local-ollama' }
        embedding_model = if ($embeddingModel) { $embeddingModel } else { 'all-minilm' }
        restart_track_ids = if ($restartIpc) { @($restartIpc.ipc_track_ids) } else { @() }
        restart_track_order = if ($restartIpc) { @($restartIpc.ipc_track_titles) } else { @() }
        create_pid = if ($createProcesses) { $createProcesses.runtime_process_id } else { $null }
        restart_pid = if ($restartProcesses) { $restartProcesses.runtime_process_id } else { $null }
        logical_sha_pre_create = $dbLogicalShaPreCreate
        logical_sha_post_create = $dbLogicalShaPostCreate
        logical_sha_post_restart = $dbLogicalShaPostRestart
        changed_tables_pre_to_post = @($createChangedTables)
        changed_tables_post_to_restart = @($restartChangedTables)
        appdata_equal = if ($appDataBefore -and $appDataAfter) { ($appDataBefore | ConvertTo-Json -Depth 100 -Compress) -eq ($appDataAfter | ConvertTo-Json -Depth 100 -Compress) } else { $false }
        protected_equal = if ($protectedBefore -and $protectedAfter) { ($protectedBefore | ConvertTo-Json -Depth 100 -Compress) -eq ($protectedAfter | ConvertTo-Json -Depth 100 -Compress) } else { $false }
        cleanup_status = $cleanup
        gate_results = [ordered]@{
            ui_create_executed = if ($createUi) { $true } else { $false }
            real_tauri_ipc = if ($createIpc) { $true } else { $false }
            playlist_opened = if ($createUi -and $createUi.ui_matches_oracle) { $true } else { $false }
            track_count_gt_zero = if ($createIpc -and $createIpc.track_count -gt 0) { $true } else { $false }
            created_order_matches_oracle = if ($createIpc) { [bool]$createIpc.ipc_matches_oracle } else { $false }
            db_order_matches_ui = if ($createUi -and $createIpc) { ($createUi.rendered_ids | ConvertTo-Json -Compress) -eq ($createIpc.ipc_track_ids | ConvertTo-Json -Compress) } else { $false }
            restart_pid_differs = if ($createProcesses -and $restartProcesses) { $createProcesses.runtime_process_id -ne $restartProcesses.runtime_process_id } else { $false }
            restart_playlist_id_unchanged = if ($createIpc -and $restartIpc) { $createIpc.playlist_id -eq $restartIpc.playlist_id } else { $false }
            restart_order_unchanged = if ($restartIpc) { [bool]$restartIpc.restart_matches_create } else { $false }
            post_create_sha_equals_post_restart = $dbLogicalShaPostCreate -eq $dbLogicalShaPostRestart
            changed_tables_exactly_playlists_and_playlist_tracks = ($createChangedTables -join ',') -eq 'playlist_tracks,playlists'
            appdata_unchanged = if ($appDataBefore -and $appDataAfter) { ($appDataBefore | ConvertTo-Json -Depth 100 -Compress) -eq ($appDataAfter | ConvertTo-Json -Depth 100 -Compress) } else { $false }
            protected_files_unchanged = if ($protectedBefore -and $protectedAfter) { ($protectedBefore | ConvertTo-Json -Depth 100 -Compress) -eq ($protectedAfter | ConvertTo-Json -Depth 100 -Compress) } else { $false }
            cleanup_complete = if ($cleanup) { [bool]$cleanup.temp_removed } else { $false }
        }
        harness_binary_sha256 = $harnessBinarySha256
        fixture_manifest_sha256 = $fixtureManifestSha256
        package_lock_sha256 = $packageLockSha256
        wdio_logs_inventory = @($wdioLogsInventory)
        command_count = $CommandLedger.Count
        command_nonzero_count = $nonZeroCommands.Count
        evidence_integrity_count = $evidenceFiles.Count
        evidence_files = $evidenceFiles
        generated_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    }
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'manifest.json') -Value $manifest
    $manifestPath = Join-Path $EvidenceRoot 'manifest.json'
    $manifestSha = Get-Sha256Hex $manifestPath
    Write-Host "RESULT: $result"
    Write-Host "EVIDENCE_ROOT: $EvidenceRoot"
    Write-Host "MANIFEST_SHA256: $manifestSha"
    Write-Host "EVIDENCE_FILE_COUNT: $($evidenceFiles.Count)"
}

exit $exitCode