[CmdletBinding()]
param(
    [string]$EvidenceRoot,
    [ValidateRange(1, 65535)]
    [int]$EmbeddedPort = 4445,
    [string]$ExpectedHeadSha
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# This harness proves the SEMANTIC SEARCH RUNTIME flow:
#   UI query -> SearchView Semantic mode -> Tauri semantic_search ->
#   Ollama all-minilm query embedding -> cosine vs track_embeddings -> UI results
# It is a sibling of scripts/run-semantic-harness.ps1 (which proves the embedded
# WDIO runtime + indexing progress). This one drives the QUERY flow against a
# 5-track fixture with metadata, via the real UI (Header input -> Enter ->
# YouTube preflight -> Semantic button -> results).

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
    $EvidenceRoot = Join-Path $env:TEMP ("ytm-free-semantic-search-evidence-{0}" -f $Timestamp)
}
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
$TempRuntimeRoot = Join-Path $env:TEMP ("ytm-free-semantic-search-runtime-{0}" -f $Timestamp)
$DataDir = Join-Path $TempRuntimeRoot 'data'
$CommandLogRoot = Join-Path $EvidenceRoot 'commands'
$WdioLogRoot = Join-Path $EvidenceRoot 'wdio-logs'
$AppBinaryPath = Join-Path $RepoRoot 'src-tauri\target\debug\ytm-free.exe'
$WdioExe = Join-Path $RepoRoot 'node_modules\.bin\wdio.cmd'
$PackageLockPath = Join-Path $RepoRoot 'package-lock.json'
$FixtureScript = Join-Path $RepoRoot 'scripts\seed-semantic-search-query-fixture.py'
$RuntimeSpec = 'tests/e2e/semantic-search-runtime.spec.ts'
$ExpectedHeadShaNormalized = if ([string]::IsNullOrWhiteSpace($ExpectedHeadSha)) { $null } else { $ExpectedHeadSha.Trim() }
$AllowedUntrackedProtected = @(
    'AGENTS.md',
    'docs/GDPR_REMEDIATION_PLAN.md',
    'docs/plan-remediere-gdpr-complete.md',
    'gdpr-compliance-audit-report.md'
)
# A pre-commit proof may run with only these three harness files modified.
# A final commit-bound run (ExpectedHeadSha supplied) still requires a fully
# clean tracked tree.
$AllowedHarnessFiles = @(
    'tests/e2e/semantic-search-runtime.spec.ts',
    'scripts/run-semantic-search-harness.ps1',
    'scripts/seed-semantic-search-query-fixture.py'
)
$CommandLedger = [System.Collections.Generic.List[object]]::new()
$NetstatSequence = 0
$CommandSequence = 0
$OriginalEnvironment = @{
    YTM_FREE_DATA_DIR = $env:YTM_FREE_DATA_DIR
    EVIDENCE_ROOT = $env:EVIDENCE_ROOT
    WDIO_EMBEDDED_PORT = $env:WDIO_EMBEDDED_PORT
    TAURI_WEBDRIVER_PORT = $env:TAURI_WEBDRIVER_PORT
}

New-Item -ItemType Directory -Force -Path $EvidenceRoot, $CommandLogRoot, $DataDir | Out-Null

function Write-JsonFile {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [object]$Value
    )
    $json = $Value | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function Write-PhaseMarker {
    param([Parameter(Mandatory)] [string]$Phase)
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'phase-marker.json') -Value ([ordered]@{
        phase = $Phase
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    })
}

function Get-RelativePathCompatible {
    param(
        [Parameter(Mandatory)] [string]$BasePath,
        [Parameter(Mandatory)] [string]$TargetPath
    )
    $baseFullPath = [IO.Path]::GetFullPath($BasePath)
    if (-not $baseFullPath.EndsWith([IO.Path]::DirectorySeparatorChar)) {
        $baseFullPath += [IO.Path]::DirectorySeparatorChar
    }
    $baseUri = [Uri]$baseFullPath
    $targetUri = [Uri]([IO.Path]::GetFullPath($TargetPath))
    $relativeUri = $baseUri.MakeRelativeUri($targetUri)
    return [Uri]::UnescapeDataString($relativeUri.ToString()).Replace('/', [IO.Path]::DirectorySeparatorChar)
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)] [string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $sha256.ComputeHash($stream)
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
    return ([BitConverter]::ToString($hashBytes)).Replace('-', '')
}

function Resolve-Application {
    param([Parameter(Mandatory)] [string]$Name)
    $command = Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
    return $command.Source
}

function Invoke-CapturedProcess {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $RepoRoot,
        [switch]$AllowNonZeroExit
    )
    $safeName = $Name -replace '[^A-Za-z0-9._-]', '_'
    # Sequence-based log filenames guarantee one unique stdout/stderr file per
    # invocation. No log is ever overwritten.
    $script:CommandSequence += 1
    $logBase = '{0:D3}-{1}' -f $script:CommandSequence, $safeName
    $stdoutPath = Join-Path $CommandLogRoot ($logBase + '.stdout.log')
    $stderrPath = Join-Path $CommandLogRoot ($logBase + '.stderr.log')
    $startedAt = (Get-Date).ToUniversalTime()
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -NoNewWindow -Wait -PassThru
    $finishedAt = (Get-Date).ToUniversalTime()
    $stdout = if (Test-Path -LiteralPath $stdoutPath) { [IO.File]::ReadAllText($stdoutPath) } else { '' }
    $stderr = if (Test-Path -LiteralPath $stderrPath) { [IO.File]::ReadAllText($stderrPath) } else { '' }

    $entry = [ordered]@{
        name = $Name
        file = $FilePath
        arguments = $Arguments
        working_directory = $WorkingDirectory
        started_at_utc = $startedAt.ToString('o')
        finished_at_utc = $finishedAt.ToString('o')
        exit_code = $process.ExitCode
        stdout = $stdoutPath
        stderr = $stderrPath
    }
    $CommandLedger.Add([pscustomobject]$entry)
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'command-ledger.json') -Value $CommandLedger
    if ($process.ExitCode -ne 0 -and -not $AllowNonZeroExit) {
        if ($stdout) { Write-Host ($stdout.TrimEnd()) }
        if ($stderr) { Write-Warning ($stderr.TrimEnd()) }
        throw "Command '$Name' failed with exit code $($process.ExitCode)"
    }
    return [pscustomobject]@{ Stdout = $stdout; Stderr = $stderr; ExitCode = $process.ExitCode }
}

function Get-ListeningPids {
    param([Parameter(Mandatory)] [int]$Port)
    $script:NetstatSequence += 1
    $result = Invoke-CapturedProcess -Name ("netstat-{0:D3}-port-{1}" -f $script:NetstatSequence, $Port) `
        -FilePath $NetstatExe -Arguments @('-ano', '-p', 'tcp')
    $pids = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($line in ($result.Stdout -split "`r?`n")) {
        $columns = $line.Trim() -split '\s+'
        if ($columns.Count -lt 5 -or $columns[0] -ne 'TCP' -or $columns[3] -ne 'LISTENING') { continue }
        if ($columns[1] -match ':(\d+)$' -and [int]$Matches[1] -eq $Port) {
            [void]$pids.Add([int]$columns[4])
        }
    }
    return @($pids | Sort-Object)
}

function Assert-PortFree {
    param([Parameter(Mandatory)] [int]$Port)
    $pids = @(Get-ListeningPids -Port $Port)
    if ($pids.Count -gt 0) {
        throw "Foreign listener detected on TCP port $Port (PID $($pids -join ', ')); no process was terminated"
    }
}

function Get-HarnessProcesses {
    $resolvedBinary = [IO.Path]::GetFullPath($AppBinaryPath)
    return @(
        Get-CimInstance Win32_Process -Filter "Name = 'ytm-free.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $resolvedBinary } |
            Select-Object ProcessId, Name, ExecutablePath, CommandLine, CreationDate
    )
}

function Save-PidSnapshot {
    param([Parameter(Mandatory)] [string]$Name)
    $snapshot = [ordered]@{
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
        phase = $Name
        processes = @(Get-HarnessProcesses)
        port_3456_pids = @(Get-ListeningPids -Port 3456)
        embedded_port = $EmbeddedPort
        embedded_port_pids = @(Get-ListeningPids -Port $EmbeddedPort)
    }
    Write-JsonFile -Path (Join-Path $EvidenceRoot ("pid-{0}.json" -f $Name)) -Value $snapshot
    return $snapshot
}

function Wait-HarnessClean {
    param([Parameter(Mandatory)] [string]$Phase)
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        $processes = @(Get-HarnessProcesses)
        $port3456 = @(Get-ListeningPids -Port 3456)
        $embedded = @(Get-ListeningPids -Port $EmbeddedPort)
        if ($processes.Count -eq 0 -and $port3456.Count -eq 0 -and $embedded.Count -eq 0) {
            Save-PidSnapshot -Name ($Phase + '-clean') | Out-Null
            return
        }
        Start-Sleep -Milliseconds 500
    }
    Save-PidSnapshot -Name ($Phase + '-residual') | Out-Null
    throw "Residual harness process or listener detected after $Phase; no process was terminated"
}

function Get-FileMetadata {
    param([Parameter(Mandatory)] [string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{ path = $Path; exists = $false }
    }
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
        $full = Join-Path $RepoRoot $relative
        $entries.Add([pscustomobject](Get-FileMetadata -Path $full))
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
    param(
        [Parameter(Mandatory)] [object]$Before,
        [Parameter(Mandatory)] [object]$After,
        [Parameter(Mandatory)] [string]$Failure
    )
    $beforeJson = $Before | ConvertTo-Json -Depth 100 -Compress
    $afterJson = $After | ConvertTo-Json -Depth 100 -Compress
    if ($beforeJson -ne $afterJson) { throw $Failure }
}

function Get-GitState {
    $branch = (Invoke-CapturedProcess -Name 'git-branch' -FilePath $GitExe -Arguments @('branch', '--show-current')).Stdout.Trim()
    $headSha = (Invoke-CapturedProcess -Name 'git-head-sha' -FilePath $GitExe -Arguments @('rev-parse', 'HEAD')).Stdout.Trim()
    $originMain = Invoke-CapturedProcess -Name 'git-origin-main-sha' -FilePath $GitExe -Arguments @('rev-parse', 'origin/main') -AllowNonZeroExit
    $originMainSha = if ($originMain.ExitCode -eq 0) { $originMain.Stdout.Trim() } else { $null }
    return [pscustomobject]@{
        Branch = $branch
        HeadSha = $headSha
        OriginMainSha = $originMainSha
    }
}

function Assert-GitScope {
    $diff = Invoke-CapturedProcess -Name 'git-diff-tracked' -FilePath $GitExe -Arguments @('diff', '--quiet') -AllowNonZeroExit
    $cached = Invoke-CapturedProcess -Name 'git-diff-cached' -FilePath $GitExe -Arguments @('diff', '--cached', '--quiet') -AllowNonZeroExit
    if ($cached.ExitCode -ne 0) {
        throw "Tracked index has staged modifications; refusing to run harness"
    }
    $trackedClean = $diff.ExitCode -eq 0 -and $cached.ExitCode -eq 0
    if ($ExpectedHeadShaNormalized -and -not $trackedClean) {
        throw "Final commit-bound harness requires a clean tracked tree"
    }
    $status = (Invoke-CapturedProcess -Name 'git-scope-status' -FilePath $GitExe -Arguments @('status', '--porcelain=v1', '-uall')).Stdout
    foreach ($line in ($status -split "`r?`n")) {
        if (-not $line) { continue }
        $code = $line.Substring(0, 2)
        $path = $line.Substring(3).Replace('\', '/')
        if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
        # Python bytecode artifacts (created by py_compile verification, NOT by
        # running the fixture as a script) are not source and must not block the
        # harness; the fixture runs as __main__ so it does not create them, but any
        # pre-existing __pycache__/*.pyc from earlier syntax checks is ignored here.
        if ($path -match '(?:^|/)__pycache__/.*\.pyc$') { continue }
        if ($code -eq '??') {
            if (($AllowedUntrackedProtected -notcontains $path) -and ($AllowedHarnessFiles -notcontains $path)) {
                throw "Out-of-scope untracked repository path detected: $path"
            }
        }
        elseif (-not $ExpectedHeadShaNormalized -and $code[0] -eq ' ' -and
                $code[1] -ne ' ' -and $AllowedHarnessFiles -contains $path) {
            continue
        }
        else {
            throw "Out-of-scope tracked repository change detected: $line"
        }
    }
    return $trackedClean
}

function Write-WdioLogs {
    # The @wdio/tauri-service (captureBackendLogs + captureFrontendLogs) writes
    # into $WdioLogRoot. Produce backend.log + frontend.log in the evidence root
    # from whatever the service emitted; never overwrite the per-command logs.
    $backendLines = [System.Collections.Generic.List[string]]::new()
    $frontendLines = [System.Collections.Generic.List[string]]::new()
    $inventory = @()
    if (Test-Path -LiteralPath $WdioLogRoot) {
        $files = @(Get-ChildItem -LiteralPath $WdioLogRoot -Recurse -File | Sort-Object FullName)
        foreach ($file in $files) {
            $inventory += [pscustomobject]@{ path = $file.FullName; size = $file.Length }
            $content = [IO.File]::ReadAllText($file.FullName)
            $name = $file.Name
            if ($name -match 'backend|driver|tauri|rust') {
                $backendLines.Add("===== $name =====")
                $backendLines.Add($content)
            }
            elseif ($name -match 'frontend|console|webview|browser') {
                $frontendLines.Add("===== $name =====")
                $frontendLines.Add($content)
            }
            else {
                $backendLines.Add("===== $name =====")
                $backendLines.Add($content)
            }
        }
    }
    if ($backendLines.Count -eq 0) {
        $backendLines.Add("No backend/driver logs were emitted by @wdio/tauri-service into $WdioLogRoot.")
    }
    if ($frontendLines.Count -eq 0) {
        $frontendLines.Add("No frontend/console logs were emitted by @wdio/tauri-service into $WdioLogRoot.")
        $frontendLines.Add("See backend.log and the wdio-logs inventory for any captured logs.")
    }
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'backend.log'), ($backendLines -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'frontend.log'), ($frontendLines -join "`r`n") + "`r`n", [Text.UTF8Encoding]::new($false))
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
$protectedBefore = $null
$appDataBefore = $null
$currentBranch = $null
$currentHeadSha = $null
$originMainSha = $null
$gitTrackedClean = $false
$packageLockSha256 = $null
$harnessBinarySha256 = $null
$fixtureManifestSha256 = $null
$query = $null
$resultOrder = @()
$similarityValues = @()
$expectedTopMatch = $null
$actualTopMatch = $null
$topMatchPass = $false
$calmPianoRank = $null
$dbLogicalEqual = $false
$changedTables = @()
$dbBeforeQueryLogicalSha256 = $null
$dbAfterQueryLogicalSha256 = $null
$dbBeforeIndex = $null
$dbFinalState = $null
$ollamaVersion = $null
$ollamaModel = 'all-minilm'
$wdioLogsInventory = @()

try {
    Set-Location $RepoRoot
    if (Test-Path -LiteralPath (Join-Path $RepoRoot '.git\index.lock')) { throw 'BLOCKED-INDEX-LOCK' }
    if (-not (Test-Path -LiteralPath $FixtureScript -PathType Leaf)) { throw "Fixture script missing: $FixtureScript" }
    if (-not (Test-Path -LiteralPath $WdioExe -PathType Leaf)) { throw "wdio binary missing: $WdioExe (run npm install)" }

    $gitState = Get-GitState
    $currentBranch = $gitState.Branch
    $currentHeadSha = $gitState.HeadSha
    $originMainSha = $gitState.OriginMainSha
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'git-state-before.json') -Value ([ordered]@{
        branch = $currentBranch
        head_sha = $currentHeadSha
        origin_main_sha = $originMainSha
        expected_head_sha = $ExpectedHeadShaNormalized
        captured_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    })

    if ($ExpectedHeadShaNormalized -and $currentHeadSha -ne $ExpectedHeadShaNormalized) {
        throw "ExpectedHeadSha mismatch: expected=$ExpectedHeadShaNormalized actual=$currentHeadSha"
    }

    $gitTrackedClean = Assert-GitScope

    if (Test-Path -LiteralPath $PackageLockPath -PathType Leaf) {
        $packageLockSha256 = Get-Sha256Hex -Path $PackageLockPath
    }

    Assert-PortFree -Port 3456
    Assert-PortFree -Port $EmbeddedPort
    if (@(Get-HarnessProcesses).Count -gt 0) { throw 'A pre-existing harness binary process is running' }

    $protectedBefore = Get-ProtectedSnapshot
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'protected-before.json') -Value $protectedBefore
    $appDataBefore = Get-RealAppDataSnapshot
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'real-appdata-before.json') -Value $appDataBefore
    Save-PidSnapshot -Name 'before' | Out-Null

    $ollamaTags = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'ollama-tags.json') -Value $ollamaTags
    $modelNames = @($ollamaTags.models | ForEach-Object { $_.name })
    if (-not ($modelNames | Where-Object { ($_ -split ':')[0] -eq 'all-minilm' })) {
        throw 'Ollama model all-minilm is absent; model pull is prohibited'
    }

    $ollamaVersionResult = Invoke-CapturedProcess -Name 'ollama-version' -FilePath $OllamaExe -Arguments @('--version')
    $ollamaVersionRaw = $ollamaVersionResult.Stdout.Trim()
    $ollamaVersionMatch = [regex]::Match($ollamaVersionRaw, 'version\s+is\s+([0-9][0-9A-Za-z.\-+]*)')
    $ollamaVersion = if ($ollamaVersionMatch.Success) { $ollamaVersionMatch.Groups[1].Value } else { $ollamaVersionRaw }
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'ollama-version.json') -Value ([ordered]@{
        raw = $ollamaVersionRaw
        version = $ollamaVersion
        captured_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    })

    $ollamaModelInfo = Invoke-CapturedProcess -Name 'ollama-show-all-minilm' -FilePath $OllamaExe -Arguments @('show', 'all-minilm')
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'ollama-model-info.json') -Value ([ordered]@{
        model = 'all-minilm'
        raw = $ollamaModelInfo.Stdout
        captured_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    })

    $env:YTM_FREE_DATA_DIR = $DataDir
    $env:EVIDENCE_ROOT = $EvidenceRoot
    $env:WDIO_EMBEDDED_PORT = [string]$EmbeddedPort
    $env:TAURI_WEBDRIVER_PORT = [string]$EmbeddedPort

    Write-PhaseMarker -Phase 'harness-build:start'
    Invoke-CapturedProcess -Name 'harness-build' -FilePath $NpmExe -Arguments @('run', 'harness:build') | Out-Null
    Write-PhaseMarker -Phase 'harness-build:done'
    if (-not (Test-Path -LiteralPath $AppBinaryPath -PathType Leaf)) { throw "Harness binary missing: $AppBinaryPath" }
    $harnessBinaryMetadata = Get-FileMetadata -Path $AppBinaryPath
    $harnessBinarySha256 = $harnessBinaryMetadata.sha256
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'harness-binary.json') -Value $harnessBinaryMetadata

    Write-PhaseMarker -Phase 'harness-schema:start'
    Invoke-CapturedProcess -Name 'harness-schema' -FilePath $NpmExe -Arguments @('run', 'harness:schema') | Out-Null
    Write-PhaseMarker -Phase 'harness-schema:done'
    Wait-HarnessClean -Phase 'schema'
    Invoke-CapturedProcess -Name 'schema-db-unlock' -FilePath $PythonExe -Arguments @(
        '-3', $FixtureScript, '--data-dir', $DataDir, '--check-only'
    ) | Out-Null

    Write-PhaseMarker -Phase 'seed-fixture:start'
    $seedResult = Invoke-CapturedProcess -Name 'seed-semantic-search-fixture' -FilePath $PythonExe -Arguments @(
        '-3', $FixtureScript, '--data-dir', $DataDir, '--evidence-root', $EvidenceRoot
    )
    Write-PhaseMarker -Phase 'seed-fixture:done'
    $seedJson = $seedResult.Stdout | ConvertFrom-Json
    $fixtureManifestSha256 = $seedJson.manifest_sha256

    $dbBeforeIndexResult = Invoke-CapturedProcess -Name 'db-snapshot-before-index' -FilePath $PythonExe -Arguments @(
        '-3', $FixtureScript, '--data-dir', $DataDir, '--snapshot'
    )
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'db-before-index.json'), $dbBeforeIndexResult.Stdout, [Text.UTF8Encoding]::new($false))
    $dbBeforeIndex = $dbBeforeIndexResult.Stdout | ConvertFrom-Json

    Assert-PortFree -Port 3456
    Assert-PortFree -Port $EmbeddedPort
    Write-PhaseMarker -Phase 'harness-semantic-search-runtime:start'
    Invoke-CapturedProcess -Name 'harness-semantic-search-runtime' -FilePath $WdioExe -Arguments @(
        'run', 'wdio.conf.ts', '--spec', $RuntimeSpec
    ) | Out-Null
    Write-PhaseMarker -Phase 'harness-semantic-search-runtime:done'
    Wait-HarnessClean -Phase 'semantic-search-runtime'
    Invoke-CapturedProcess -Name 'semantic-db-unlock' -FilePath $PythonExe -Arguments @(
        '-3', $FixtureScript, '--data-dir', $DataDir, '--check-only'
    ) | Out-Null
    $verifyFinalResult = Invoke-CapturedProcess -Name 'semantic-db-final' -FilePath $PythonExe -Arguments @(
        '-3', $FixtureScript, '--data-dir', $DataDir, '--verify-final'
    )
    [IO.File]::WriteAllText((Join-Path $EvidenceRoot 'db-final-state.json'), $verifyFinalResult.Stdout, [Text.UTF8Encoding]::new($false))
    $dbFinalState = $verifyFinalResult.Stdout | ConvertFrom-Json

    $wdioLogsInventory = Write-WdioLogs

    # Read the spec's results evidence (written during the WDIO run).
    $resultsPath = Join-Path $EvidenceRoot 'semantic-query-results.json'
    if (-not (Test-Path -LiteralPath $resultsPath -PathType Leaf)) {
        throw "Semantic query results evidence is missing: $resultsPath"
    }
    $resultsJson = Get-Content -LiteralPath $resultsPath -Raw | ConvertFrom-Json
    $query = $resultsJson.query
    $resultOrder = @($resultsJson.result_order)
    $similarityValues = @($resultsJson.similarity_values)
    $expectedTopMatch = $resultsJson.expected_top_match
    $actualTopMatch = $resultsJson.actual_top_match
    $topMatchPass = [bool]$resultsJson.top_match_pass
    $calmPianoRank = $resultsJson.calm_piano_rank
    $dbLogicalEqual = [bool]$resultsJson.db_logical_equal
    $changedTables = @($resultsJson.changed_tables)

    $dbBeforeQueryPath = Join-Path $EvidenceRoot 'db-before-query.json'
    $dbAfterQueryPath = Join-Path $EvidenceRoot 'db-after-query.json'
    if (-not (Test-Path -LiteralPath $dbBeforeQueryPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $dbAfterQueryPath -PathType Leaf)) {
        throw 'Logical SQLite query snapshots are missing'
    }
    $dbBeforeQuery = Get-Content -LiteralPath $dbBeforeQueryPath -Raw | ConvertFrom-Json
    $dbAfterQuery = Get-Content -LiteralPath $dbAfterQueryPath -Raw | ConvertFrom-Json
    $dbBeforeQueryLogicalSha256 = $dbBeforeQuery.logical_sha256
    $dbAfterQueryLogicalSha256 = $dbAfterQuery.logical_sha256
    if ($dbBeforeQuery.mode -ne 'logical-read-only-snapshot' -or
        $dbAfterQuery.mode -ne 'logical-read-only-snapshot') {
        throw 'Unexpected logical SQLite snapshot mode'
    }
    if (-not $topMatchPass -or $actualTopMatch -ne 'Calm Piano Sleep Meditation' -or $calmPianoRank -ne 1) {
        throw 'Expected top semantic match evidence did not pass'
    }
    if (-not $dbLogicalEqual -or $changedTables.Count -ne 0 -or
        $dbBeforeQueryLogicalSha256 -ne $dbAfterQueryLogicalSha256) {
        throw 'FAIL — SEMANTIC-QUERY-MUTATED-DB'
    }

    $appDataAfter = Get-RealAppDataSnapshot
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'real-appdata-after.json') -Value $appDataAfter
    Assert-EqualJson -Before $appDataBefore -After $appDataAfter -Failure 'FAIL — REAL-APPDATA-MUTATED'

    $protectedAfter = Get-ProtectedSnapshot
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'protected-after.json') -Value $protectedAfter
    Assert-EqualJson -Before $protectedBefore -After $protectedAfter -Failure 'Protected files changed during harness execution'
    $gitTrackedClean = Assert-GitScope

    $result = 'PASS — SEMANTIC-SEARCH-RUNTIME-PROVEN'
    $exitCode = 0
}
catch {
    $failureMessage = $_.Exception.Message
    Write-Error $failureMessage
}
finally {
    $tempInventory = if (Test-Path -LiteralPath $TempRuntimeRoot) {
        @(Get-ChildItem -LiteralPath $TempRuntimeRoot -Recurse -Force | Select-Object FullName, Length, LastWriteTimeUtc)
    } else { @() }
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'temp-runtime-inventory.json') -Value $tempInventory

    $cleanup = [ordered]@{
        attempted_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        temp_runtime_root = $TempRuntimeRoot
        evidence_root = $EvidenceRoot
        temp_removed = $false
        evidence_preserved = (Test-Path -LiteralPath $EvidenceRoot)
        error = $null
    }
    try {
        if (Test-Path -LiteralPath $TempRuntimeRoot) {
            $resolvedTempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
            $resolvedRuntimeRoot = [IO.Path]::GetFullPath($TempRuntimeRoot)
            if (-not $resolvedRuntimeRoot.StartsWith($resolvedTempBase, [StringComparison]::OrdinalIgnoreCase) -or
                -not ([IO.Path]::GetFileName($resolvedRuntimeRoot)).StartsWith('ytm-free-semantic-search-runtime-', [StringComparison]::Ordinal)) {
                throw "Refusing recursive cleanup outside the owned temp runtime root: $resolvedRuntimeRoot"
            }
            Remove-Item -LiteralPath $TempRuntimeRoot -Recurse -Force
        }
        $cleanup.temp_removed = -not (Test-Path -LiteralPath $TempRuntimeRoot)
    }
    catch {
        $cleanup.error = $_.Exception.Message
        $exitCode = 1
        $result = 'FAIL'
        if (-not $failureMessage) { $failureMessage = "TEMP_RUNTIME_ROOT cleanup failed: $($cleanup.error)" }
    }
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'cleanup-ledger.json') -Value $cleanup

    $env:YTM_FREE_DATA_DIR = $OriginalEnvironment.YTM_FREE_DATA_DIR
    $env:EVIDENCE_ROOT = $OriginalEnvironment.EVIDENCE_ROOT
    $env:WDIO_EMBEDDED_PORT = $OriginalEnvironment.WDIO_EMBEDDED_PORT
    $env:TAURI_WEBDRIVER_PORT = $OriginalEnvironment.TAURI_WEBDRIVER_PORT

    $appDataBeforeSha = $null
    $appDataAfterSha = $null
    if ($appDataBefore -and $appDataBefore.database -and $appDataBefore.database.exists) { $appDataBeforeSha = $appDataBefore.database.sha256 }
    if ($appDataAfter -and $appDataAfter.database -and $appDataAfter.database.exists) { $appDataAfterSha = $appDataAfter.database.sha256 }
    $appDataEqual = if ($null -ne $appDataBeforeSha -and $null -ne $appDataAfterSha) { $appDataBeforeSha -eq $appDataAfterSha } else { $null }

    $evidenceFiles = @(
        Get-ChildItem -LiteralPath $EvidenceRoot -Recurse -File |
            Where-Object { $_.Name -ne 'final-manifest.json' } |
            Sort-Object FullName |
            ForEach-Object {
                [ordered]@{
                    path = Get-RelativePathCompatible -BasePath $EvidenceRoot -Target $_.FullName
                    size = $_.Length
                    sha256 = Get-Sha256Hex -Path $_.FullName
                }
            }
    )
    $manifest = [ordered]@{
        result = $result
        failure = $failureMessage
        branch = $currentBranch
        head_sha = $currentHeadSha
        expected_head_sha = $ExpectedHeadShaNormalized
        origin_main_sha = $originMainSha
        git_tracked_clean = $gitTrackedClean
        package_lock_sha256 = $packageLockSha256
        harness_binary_sha256 = $harnessBinarySha256
        fixture_manifest_sha256 = $fixtureManifestSha256
        query = $query
        result_order = $resultOrder
        similarity_values = $similarityValues
        expected_top_match = $expectedTopMatch
        actual_top_match = $actualTopMatch
        top_match_pass = $topMatchPass
        calm_piano_rank = $calmPianoRank
        db_logical_equal = $dbLogicalEqual
        changed_tables = $changedTables
        db_before_query_logical_sha256 = $dbBeforeQueryLogicalSha256
        db_after_query_logical_sha256 = $dbAfterQueryLogicalSha256
        ollama_version = $ollamaVersion
        ollama_model = $ollamaModel
        db_before_index = $dbBeforeIndex
        db_final_state = $dbFinalState
        appdata_before_sha256 = $appDataBeforeSha
        appdata_after_sha256 = $appDataAfterSha
        appdata_equal = $appDataEqual
        temp_runtime_root = $TempRuntimeRoot
        evidence_root = $EvidenceRoot
        embedded_port = $EmbeddedPort
        cleanup_status = $cleanup
        wdio_logs_inventory = $wdioLogsInventory
        generated_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        evidence_files = $evidenceFiles
    }
    Write-JsonFile -Path (Join-Path $EvidenceRoot 'final-manifest.json') -Value $manifest
    Write-Host "RESULT: $result"
    Write-Host "EVIDENCE_ROOT: $EvidenceRoot"
}

exit $exitCode
