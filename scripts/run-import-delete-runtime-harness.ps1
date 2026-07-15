[CmdletBinding()]
param(
    [switch]$ContractValidateOnly,
    [switch]$PreflightOnly,
    [switch]$LaunchPlanValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedAppBaseline = 'b3200d4f8d4187bc25cc1f1d49d55bcbcf277212'
$ExpectedBranch = 'feat/import-delete-runtime-harness'
$EmbeddedPort = 4447
$StreamPort = 3456
$Script:OwnedProcessIdentities = @()

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$HarnessPath = Join-Path $RepoRoot 'scripts\run-import-delete-runtime-harness.ps1'
$ShimSource = Join-Path $RepoRoot 'scripts\yt-dlp-import-delete-shim.rs'
$SpecPath = Join-Path $RepoRoot 'tests\e2e\import-delete-runtime.spec.ts'
$WdioConfig = Join-Path $RepoRoot 'wdio.conf.ts'
$LogicalSnapshotScript = Join-Path $RepoRoot 'scripts\seed-semantic-search-query-fixture.py'

$AllowedHarnessPaths = @(
    'scripts/run-import-delete-runtime-harness.ps1',
    'scripts/yt-dlp-import-delete-shim.rs',
    'tests/e2e/import-delete-runtime.spec.ts'
)
$ProtectedUntrackedPaths = @(
    'AGENTS.md',
    'gdpr-compliance-audit-report.md',
    'docs/GDPR_REMEDIATION_PLAN.md',
    'docs/plan-remediere-gdpr-complete.md'
)
$RequiredEnvironmentNames = @(
    'PATH',
    'TEMP',
    'TMP',
    'YTM_FREE_DATA_DIR',
    'YTM_FREE_SPOTIFY_DIR',
    'WEBVIEW2_USER_DATA_FOLDER',
    'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS',
    'EVIDENCE_ROOT',
    'WDIO_EMBEDDED_PORT',
    'TAURI_WEBDRIVER_PORT'
)
$StopConditions = @(
    'BASELINE-DRIFT',
    'HARNESS-BRANCH-MISMATCH',
    'APP-BASELINE-NOT-ANCESTOR',
    'ORIGIN-MAIN-BASELINE-DRIFT',
    'HARNESS-MERGE-BASE-MISMATCH',
    'HARNESS-MERGE-COMMIT-DETECTED',
    'HARNESS-DELTA-SCOPE-MISMATCH',
    'DIRTY-TRACKED-WORKTREE',
    'NONEMPTY-STAGING',
    'UNEXPECTED-UNTRACKED-FILE',
    'TEMP-ROOT-UNSAFE',
    'APPDATA-ISOLATION-NOT-PROVEN',
    'DOWNLOAD-ISOLATION-NOT-PROVEN',
    'YT_DLP-DETERMINISM-NOT-AVAILABLE',
    'REQUIRED-TOOL-MISSING',
    'PORT-CONFLICT',
    'UNOWNED-PROCESS-CONFLICT',
    'UI-AUTOMATION-PATH-NOT-AVAILABLE',
    'SCOPE-EXPANSION-REQUIRED',
    'UNEXPECTED-YT-DLP-INVOCATION',
    'STANDARD-IMPORT-MODE-NOT-PROVEN',
    'PLAYLIST-NAME-INPUT-NOT-AVAILABLE',
    'TRACKCARD-MENU-STRUCTURE-AMBIGUOUS',
    'EXTERNAL-NETWORK-DEPENDENCY-DETECTED',
    'WEBVIEW2-NETWORK-ISOLATION-NOT-AVAILABLE',
    'UNEXPECTED-OWNED-PROCESS-NETWORK-CONNECTION',
    'WEBVIEW2-BROWSER-ROOT-MISSING',
    'WEBVIEW2-BROWSER-ROOT-AMBIGUOUS',
    'WEBVIEW2-BROWSER-FLAGS-MISSING',
    'CONFLICTING-WEBVIEW2-HOST-RESOLVER-RULES',
    'WEBVIEW2-USER-DATA-DIR-MISMATCH',
    'OLLAMA-INVOCATION-DETECTED',
    'OLLAMA-STATE-EVIDENCE-SCHEMA-MISMATCH',
    'PRIVACY-REPARSE-POINT-DETECTED',
    'PRIVACY-TREE-CONTAINMENT-FAILED',
    'PRIVACY-TREE-ENUMERATION-FAILED',
    'RUNTIME-REPARSE-POINT-DETECTED',
    'RUNTIME-TREE-CONTAINMENT-FAILED',
    'RUNTIME-TREE-ENUMERATION-FAILED',
    'PRIVACY-SNAPSHOT-COMPARABILITY-LOST',
    'WDIO-LAUNCH-EXECUTABLE-NOT-FOUND',
    'WDIO-LAUNCH-EXECUTABLE-AMBIGUOUS',
    'WDIO-LAUNCH-FILEPATH-TYPE-MISMATCH',
    'WDIO-LAUNCH-FILEPATH-EMPTY',
    'WDIO-LAUNCH-ARGUMENT-TYPE-MISMATCH',
    'SYNTHETIC-WDIO-PRELAUNCH-FAILURE',
    'FAILURE-FINALIZATION-INCOMPLETE'
)

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Value
    )
    [IO.File]::WriteAllText($LiteralPath, $Value, [Text.UTF8Encoding]::new($false))
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)]$Value,
        [int]$Depth = 20
    )
    Write-Utf8NoBom -LiteralPath $LiteralPath -Value (($Value | ConvertTo-Json -Depth $Depth) + [Environment]::NewLine)
}

function Write-NonClaims {
    Write-Output 'APPLICATION_LAUNCH: NOT RUN'
    Write-Output 'WDIO_RUNTIME: NOT RUN'
    Write-Output 'APPDATA_MUTATION: NOT RUN'
}

function Invoke-GitRead {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = @(& git @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Git command failed ($exitCode): git $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    return @($output | ForEach-Object { [string]$_ })
}

function Normalize-RepositoryPath {
    param([Parameter(Mandatory = $true)][string]$Value)
    return $Value.Replace('\', '/').Trim()
}

function Test-PathUnderRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Root
    )
    $candidateFull = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    return $candidateFull.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoReparseAncestor {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$StopAt
    )
    $current = [IO.Path]::GetFullPath($Candidate)
    $stop = [IO.Path]::GetFullPath($StopAt).TrimEnd('\')
    while ($current.StartsWith($stop, [StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "TEMP-ROOT-UNSAFE: reparse point detected at $current"
            }
        }
        if ($current.TrimEnd('\').Equals($stop, [StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $parent = Split-Path -Parent $current
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
            break
        }
        $current = $parent
    }
}

function Assert-SafeTemporaryRoot {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$LeafPrefix
    )
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
    $full = [IO.Path]::GetFullPath($Candidate).TrimEnd('\')
    if (-not (Test-PathUnderRoot -Candidate $full -Root $tempRoot)) {
        throw "TEMP-ROOT-UNSAFE: $full is not contained by TEMP"
    }
    $leaf = Split-Path -Leaf $full
    if (-not $leaf.StartsWith($LeafPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "TEMP-ROOT-UNSAFE: unexpected leaf $leaf"
    }
    Assert-NoReparseAncestor -Candidate $full -StopAt $tempRoot
    return $full
}

function Get-SafeFileTree {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$ReparseFailureCode,
        [Parameter(Mandatory = $true)][string]$ContainmentFailureCode,
        [Parameter(Mandatory = $true)][string]$EnumerationFailureCode,
        [byte[]]$HmacKey,
        [string]$ReparseEvidencePath
    )

    try {
        $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
        $rootItem = Get-Item -LiteralPath $rootFull -Force -ErrorAction Stop
        $rootAttributes = $rootItem.Attributes
    }
    catch {
        throw $EnumerationFailureCode
    }
    if (-not $rootItem.PSIsContainer) {
        throw $EnumerationFailureCode
    }
    if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        if ($null -ne $HmacKey -and -not [string]::IsNullOrWhiteSpace($ReparseEvidencePath)) {
            Write-JsonFile -LiteralPath $ReparseEvidencePath -Value ([ordered]@{
                path_hmac = Get-HmacHex -Key $HmacKey -Value '.'
                reparse_point_detected = $true
            })
        }
        throw $ReparseFailureCode
    }

    $stack = [Collections.Generic.Stack[string]]::new()
    $stack.Push($rootFull)
    $entries = [Collections.Generic.List[object]]::new()
    while ($stack.Count -gt 0) {
        $currentDirectory = $stack.Pop()
        try {
            $children = @(Get-ChildItem -LiteralPath $currentDirectory -Force -ErrorAction Stop)
        }
        catch {
            throw $EnumerationFailureCode
        }

        foreach ($child in $children) {
            try {
                $childFull = [IO.Path]::GetFullPath($child.FullName).TrimEnd('\')
                $childAttributes = $child.Attributes
                $childIsContainer = [bool]$child.PSIsContainer
            }
            catch {
                throw $EnumerationFailureCode
            }
            if (-not (Test-PathUnderRoot -Candidate $childFull -Root $rootFull)) {
                throw $ContainmentFailureCode
            }
            if (($childAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                if ($null -ne $HmacKey -and -not [string]::IsNullOrWhiteSpace($ReparseEvidencePath)) {
                    $relative = Get-RelativePathPortable -BasePath $rootFull -ChildPath $childFull
                    Write-JsonFile -LiteralPath $ReparseEvidencePath -Value ([ordered]@{
                        path_hmac = Get-HmacHex -Key $HmacKey -Value $relative.ToLowerInvariant()
                        reparse_point_detected = $true
                    })
                }
                throw $ReparseFailureCode
            }
            $entries.Add($child)
            if ($childIsContainer) {
                $stack.Push($childFull)
            }
        }
    }
    return @($entries)
}

function Assert-NoReparseDescendant {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $safe = Assert-OwnedRoot -LiteralPath $LiteralPath -Prefix $Prefix -Token $Token
    $null = @(Get-SafeFileTree -Root $safe `
        -ReparseFailureCode 'RUNTIME-REPARSE-POINT-DETECTED' `
        -ContainmentFailureCode 'RUNTIME-TREE-CONTAINMENT-FAILED' `
        -EnumerationFailureCode 'RUNTIME-TREE-ENUMERATION-FAILED')
    return $safe
}

function Assert-OllamaStateEvidenceSchema {
    param(
        [Parameter(Mandatory = $true)]$State,
        [Parameter(Mandatory = $true)][string]$Phase
    )
    $settingsProperty = $State.PSObject.Properties['settings']
    if ($null -eq $settingsProperty -or $null -eq $settingsProperty.Value) {
        throw 'OLLAMA-STATE-EVIDENCE-SCHEMA-MISMATCH'
    }
    $settings = $settingsProperty.Value
    $enabledProperty = $settings.PSObject.Properties['ollama_enabled']
    $urlProperty = $settings.PSObject.Properties['ollama_url']
    if ($null -eq $enabledProperty -or $enabledProperty.Value -isnot [bool] -or
        $null -eq $urlProperty -or
        [string]::IsNullOrWhiteSpace([string]$urlProperty.Value)) {
        throw 'OLLAMA-STATE-EVIDENCE-SCHEMA-MISMATCH'
    }
    return [ordered]@{
        phase = $Phase
        ollama_enabled = [bool]$enabledProperty.Value
        ollama_url = [string]$urlProperty.Value
    }
}

function Get-OrdinalSortedPaths {
    param([Parameter(Mandatory = $true)][string[]]$Paths)
    $list = [Collections.Generic.List[string]]::new()
    foreach ($path in $Paths) {
        $list.Add((Normalize-RepositoryPath -Value $path))
    }
    $list.Sort([StringComparer]::Ordinal)
    return @($list)
}

function Get-HarnessGitIdentity {
    $branch = (Invoke-GitRead -Arguments @('branch', '--show-current') | Select-Object -First 1).Trim()
    $head = (Invoke-GitRead -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    $originMain = (Invoke-GitRead -Arguments @('rev-parse', 'origin/main') | Select-Object -First 1).Trim()
    if ($branch -ne $ExpectedBranch) {
        throw "HARNESS-BRANCH-MISMATCH: branch=$branch expected=$ExpectedBranch"
    }
    if ($originMain -ne $ExpectedAppBaseline) {
        throw "ORIGIN-MAIN-BASELINE-DRIFT: origin_main=$originMain"
    }
    try {
        $null = Invoke-GitRead -Arguments @('merge-base', '--is-ancestor', $ExpectedAppBaseline, 'HEAD')
    }
    catch {
        throw 'APP-BASELINE-NOT-ANCESTOR'
    }
    $mergeBase = (Invoke-GitRead -Arguments @('merge-base', 'HEAD', 'origin/main') | Select-Object -First 1).Trim()
    if ($mergeBase -ne $ExpectedAppBaseline) {
        throw "HARNESS-MERGE-BASE-MISMATCH: merge_base=$mergeBase"
    }
    $mergeCommits = @(Invoke-GitRead -Arguments @('rev-list', '--merges', "$ExpectedAppBaseline..HEAD") |
        Where-Object { $_.Trim() })
    if ($mergeCommits.Count -ne 0) {
        throw "HARNESS-MERGE-COMMIT-DETECTED: $($mergeCommits -join ',')"
    }
    $actualDeltaPaths = @(Invoke-GitRead -Arguments @('diff', '--name-only', "$ExpectedAppBaseline..HEAD") |
        Where-Object { $_.Trim() } |
        ForEach-Object { Normalize-RepositoryPath -Value $_ })
    $actualSorted = @(Get-OrdinalSortedPaths -Paths $actualDeltaPaths)
    $allowedSorted = @(Get-OrdinalSortedPaths -Paths $AllowedHarnessPaths)
    if (($actualSorted -join "`n") -cne ($allowedSorted -join "`n")) {
        throw "HARNESS-DELTA-SCOPE-MISMATCH: actual=$($actualSorted -join ',')"
    }
    $commitCount = [int]((Invoke-GitRead -Arguments @('rev-list', '--count', "$ExpectedAppBaseline..HEAD") |
        Select-Object -First 1).Trim())
    return [ordered]@{
        branch = $branch
        APP_BASELINE_SHA = $ExpectedAppBaseline
        HARNESS_HEAD_SHA = $head
        ORIGIN_MAIN_SHA = $originMain
        HARNESS_MERGE_BASE_SHA = $mergeBase
        HARNESS_DELTA_PATHS = $actualSorted
        HARNESS_COMMIT_COUNT = $commitCount
    }
}

function Assert-GitContext {
    $identity = Get-HarnessGitIdentity
    $unstaged = @(Invoke-GitRead -Arguments @('diff', '--name-only') | Where-Object { $_.Trim() })
    if ($unstaged.Count -ne 0) {
        throw 'DIRTY-TRACKED-WORKTREE: unstaged tracked changes exist'
    }
    $cached = @(Invoke-GitRead -Arguments @('diff', '--cached', '--name-only') | Where-Object { $_.Trim() })
    if ($cached.Count -ne 0) {
        throw 'NONEMPTY-STAGING'
    }
    $status = @(Invoke-GitRead -Arguments @('status', '--porcelain=v1', '--untracked-files=all'))
    foreach ($line in $status) {
        if (-not $line.StartsWith('?? ')) {
            throw "DIRTY-TRACKED-WORKTREE: $line"
        }
        $path = Normalize-RepositoryPath -Value $line.Substring(3)
        if ($ProtectedUntrackedPaths -notcontains $path) {
            throw "UNEXPECTED-UNTRACKED-FILE: $path"
        }
    }
    $identity.status = $status
    return $identity
}

function Assert-RequiredTools {
    $tools = @('git.exe', 'node.exe', 'npm.cmd', 'npx.cmd', 'cargo.exe', 'rustc.exe', 'rustfmt.exe', 'powershell.exe', 'py.exe')
    $result = @()
    foreach ($tool in $tools) {
        $command = Get-Command $tool -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $command) {
            throw "REQUIRED-TOOL-MISSING: $tool"
        }
        $result += [ordered]@{ name = $tool; path = $command.Source }
    }
    return $result
}

function Get-ContractPortListeners {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
        $_.LocalPort -in @($StreamPort, $EmbeddedPort)
    } | Select-Object LocalAddress, LocalPort, OwningProcess, State)
    return $listeners
}

function Get-ConflictingProcesses {
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -in @('ytm-free.exe', 'tauri-driver.exe', 'msedgedriver.exe', 'yt-dlp.exe', 'ffmpeg.exe')
    } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate)
}

function Invoke-SafePreflight {
    $gitContext = Assert-GitContext
    $tools = Assert-RequiredTools
    $listeners = @(Get-ContractPortListeners)
    if ($listeners.Count -ne 0) {
        throw "PORT-CONFLICT: $($listeners | ConvertTo-Json -Compress)"
    }
    $conflicts = @(Get-ConflictingProcesses)
    if ($conflicts.Count -ne 0) {
        throw "UNOWNED-PROCESS-CONFLICT: $($conflicts | ConvertTo-Json -Depth 4 -Compress)"
    }
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP)
    Assert-NoReparseAncestor -Candidate $tempRoot -StopAt $tempRoot
    return [ordered]@{
        git = $gitContext
        tools = $tools
        listeners = $listeners
        conflicting_processes = $conflicts
        temp_root_checked = $true
    }
}

function Assert-ContainsAll {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string[]]$Values,
        [Parameter(Mandatory = $true)][string]$Label
    )
    foreach ($value in $Values) {
        if (-not $Text.Contains($value)) {
            throw "Contract validation failed for $Label; missing: $value"
        }
    }
}

function Invoke-ContractValidation {
    $requiredFiles = @(
        $HarnessPath,
        $ShimSource,
        $SpecPath,
        $WdioConfig,
        $LogicalSnapshotScript,
        (Join-Path $RepoRoot 'src\components\views\ImportView.tsx'),
        (Join-Path $RepoRoot 'src\components\views\PlaylistsView.tsx'),
        (Join-Path $RepoRoot 'src\components\views\PlaylistView.tsx'),
        (Join-Path $RepoRoot 'src\components\TrackCard.tsx')
    )
    foreach ($file in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Contract validation required file is absent: $file"
        }
    }

    $shim = Get-Content -LiteralPath $ShimSource -Raw
    $spec = Get-Content -LiteralPath $SpecPath -Raw
    $harness = Get-Content -LiteralPath $HarnessPath -Raw
    $importView = Get-Content -LiteralPath (Join-Path $RepoRoot 'src\components\views\ImportView.tsx') -Raw
    $playlistsView = Get-Content -LiteralPath (Join-Path $RepoRoot 'src\components\views\PlaylistsView.tsx') -Raw
    $playlistView = Get-Content -LiteralPath (Join-Path $RepoRoot 'src\components\views\PlaylistView.tsx') -Raw
    $trackCard = Get-Content -LiteralPath (Join-Path $RepoRoot 'src\components\TrackCard.tsx') -Raw

    Assert-ContainsAll -Text $shim -Label 'shim argv/output contract' -Values @(
        'step6r3b1-shim-1',
        '--dump-json',
        '--flat-playlist',
        '--no-warnings',
        '--ignore-errors',
        'ytsearch5:Step6R3B1 Synthetic Artist Step6R3B1 {track} {token}',
        's6R3B1A001',
        's6R3B1B001',
        'yt-dlp-invocations.jsonl',
        'UNEXPECTED-YT-DLP-INVOCATION'
    )
    Assert-ContainsAll -Text $spec -Label 'WDIO runtime contract' -Values @(
        'IMPORT_DELETE_PHASE',
        'RUN_TOKEN',
        'PLAYLIST_NAME',
        'FIXTURE_STEM',
        'EVIDENCE_ROOT',
        'YTM_FREE_DATA_DIR',
        'track-remove-from-playlist',
        'playlist-track-',
        'STANDARD-IMPORT-MODE-NOT-PROVEN',
        'TRACKCARD-MENU-STRUCTURE-AMBIGUOUS',
        'remove_from_playlist',
        'settings: {',
        'ollama_enabled: Boolean(settings.ollama_enabled)',
        'ollama_url: String(settings.ollama_url)',
        'OLLAMA-STATE-EVIDENCE-SCHEMA-MISMATCH'
    )
    Assert-ContainsAll -Text $importView -Label 'ImportView selectors' -Values @(
        'import-file-${file.name}', 'import-start-button', 'import-create-playlist-button'
    )
    Assert-ContainsAll -Text $playlistsView -Label 'PlaylistsView selectors' -Values @(
        'playlist-${playlist.name}', 'playlist-menu-${playlist.id}', 'playlist-delete-${playlist.id}'
    )
    Assert-ContainsAll -Text $playlistView -Label 'PlaylistView selector' -Values @('playlist-track-${track.id}')
    Assert-ContainsAll -Text $trackCard -Label 'TrackCard selector' -Values @('track-remove-from-playlist')
    Assert-ContainsAll -Text $harness -Label 'environment contract' -Values $RequiredEnvironmentNames
    Assert-ContainsAll -Text $harness -Label 'stop conditions' -Values $StopConditions
    Assert-ContainsAll -Text $harness -Label 'safe tree and Ollama schema gates' -Values @(
        'function Get-SafeFileTree',
        'function Assert-NoReparseDescendant',
        'function Assert-OllamaStateEvidenceSchema',
        'FileAttributes]::ReparsePoint',
        'OLLAMA-STATE-EVIDENCE-SCHEMA-MISMATCH',
        'PRIVACY-REPARSE-POINT-DETECTED',
        'RUNTIME-REPARSE-POINT-DETECTED'
    )
    Assert-ContainsAll -Text $harness -Label 'harness Git identity contract' -Values @(
        'function Get-HarnessGitIdentity',
        'merge-base',
        '--is-ancestor',
        '--merges',
        'HARNESS-DELTA-SCOPE-MISMATCH',
        'APP_BASELINE_SHA',
        'HARNESS_HEAD_SHA',
        'ORIGIN_MAIN_SHA',
        'HARNESS_MERGE_BASE_SHA',
        'HARNESS_DELTA_PATHS',
        'HARNESS_COMMIT_COUNT'
    )
    Assert-ContainsAll -Text $harness -Label 'WDIO launch plan contract' -Values @(
        'function New-WdioLaunchPlan',
        'WDIO-LAUNCH-EXECUTABLE-NOT-FOUND',
        'WDIO-LAUNCH-EXECUTABLE-AMBIGUOUS',
        'WDIO-LAUNCH-FILEPATH-TYPE-MISMATCH',
        'WDIO-LAUNCH-ARGUMENT-TYPE-MISMATCH',
        'LaunchPlanValidateOnly'
    )
    Assert-ContainsAll -Text $harness -Label 'failure finalization contract' -Values @(
        'function Invoke-HarnessFinalization',
        'primary_failure_present',
        'cleanup-ledger.json',
        'final-evidence-inventory.json',
        'final-manifest.json',
        'final_evidence_inventory_sha256',
        'SYNTHETIC-WDIO-PRELAUNCH-FAILURE'
    )

    $validationToken = 'contractvalidation-00000000'
    $alpha = '{"id":"s6R3B1A001","title":"Step6R3B1 Alpha ' + $validationToken + '","channel":"Step6R3B1 Synthetic Artist","duration":123,"thumbnail":"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="}'
    $beta = '{"id":"s6R3B1B001","title":"Step6R3B1 Beta ' + $validationToken + '","channel":"Step6R3B1 Synthetic Artist","duration":234,"thumbnail":"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="}'
    $null = $alpha | ConvertFrom-Json
    $null = $beta | ConvertFrom-Json

    $expectedAllowedPaths = @(
        'scripts/run-import-delete-runtime-harness.ps1',
        'scripts/yt-dlp-import-delete-shim.rs',
        'tests/e2e/import-delete-runtime.spec.ts'
    )
    if ($ExpectedAppBaseline -ne 'b3200d4f8d4187bc25cc1f1d49d55bcbcf277212' -or
        $ExpectedBranch -ne 'feat/import-delete-runtime-harness' -or
        $EmbeddedPort -ne 4447 -or $StreamPort -ne 3456) {
        throw 'Contract constants do not match Step-6R.3B2A'
    }
    if ((@(Get-OrdinalSortedPaths -Paths $AllowedHarnessPaths) -join "`n") -cne
        (@(Get-OrdinalSortedPaths -Paths $expectedAllowedPaths) -join "`n")) {
        throw 'HARNESS-DELTA-SCOPE-MISMATCH'
    }
    $gitIdentity = Get-HarnessGitIdentity
    $safeTreeValidation = Invoke-SafeTreeContractValidation
    $syntheticFailureValidation = Invoke-SyntheticFailureFinalizationValidation
    return [ordered]@{
        result = ('PASS ' + [char]0x2014 + ' CONTRACT-VALIDATED')
        APP_BASELINE_SHA = $gitIdentity.APP_BASELINE_SHA
        HARNESS_HEAD_SHA = $gitIdentity.HARNESS_HEAD_SHA
        ORIGIN_MAIN_SHA = $gitIdentity.ORIGIN_MAIN_SHA
        HARNESS_MERGE_BASE_SHA = $gitIdentity.HARNESS_MERGE_BASE_SHA
        HARNESS_DELTA_PATHS = $gitIdentity.HARNESS_DELTA_PATHS
        HARNESS_COMMIT_COUNT = $gitIdentity.HARNESS_COMMIT_COUNT
        branch = $ExpectedBranch
        ports = @($StreamPort, $EmbeddedPort)
        exact_yt_dlp_argv_classes = @('version', 'search-alpha', 'search-beta')
        exact_outputs_parse = $true
        required_environment_names = $RequiredEnvironmentNames
        stop_conditions = $StopConditions
        APP_BASELINE_CONSTANT = 'PASS'
        ALLOWED_HARNESS_PATH_SET = 'PASS'
        HEAD_DESCENDS_FROM_APP_BASELINE = 'PASS'
        MERGE_BASE_MATCH = 'PASS'
        NO_HARNESS_MERGE_COMMITS = 'PASS'
        HARNESS_DELTA_SCOPE = 'PASS'
        OLLAMA_STATE_SCHEMA_CONTRACT = 'PASS'
        SAFE_TREE_NORMAL_CASE = $safeTreeValidation.SAFE_TREE_NORMAL_CASE
        SNAPSHOT_REPARSE_REJECTION = $safeTreeValidation.SNAPSHOT_REPARSE_REJECTION
        CLEANUP_REPARSE_REJECTION = $safeTreeValidation.CLEANUP_REPARSE_REJECTION
        EXTERNAL_REPARSE_TARGET_UNCHANGED = $safeTreeValidation.EXTERNAL_REPARSE_TARGET_UNCHANGED
        SYNTHETIC_PRIMARY_FAILURE_PRESERVED = $syntheticFailureValidation.SYNTHETIC_PRIMARY_FAILURE_PRESERVED
        SYNTHETIC_PRIVACY_AFTER_CAPTURED = $syntheticFailureValidation.SYNTHETIC_PRIVACY_AFTER_CAPTURED
        SYNTHETIC_PRIVACY_EQUALITY = $syntheticFailureValidation.SYNTHETIC_PRIVACY_EQUALITY
        SYNTHETIC_ENVIRONMENT_RESTORED = $syntheticFailureValidation.SYNTHETIC_ENVIRONMENT_RESTORED
        SYNTHETIC_RUNTIME_ROOT_REMOVED = $syntheticFailureValidation.SYNTHETIC_RUNTIME_ROOT_REMOVED
        SYNTHETIC_EVIDENCE_ROOT_PRESERVED = $syntheticFailureValidation.SYNTHETIC_EVIDENCE_ROOT_PRESERVED
        SYNTHETIC_CLEANUP_LEDGER = $syntheticFailureValidation.SYNTHETIC_CLEANUP_LEDGER
        SYNTHETIC_FINAL_INVENTORY = $syntheticFailureValidation.SYNTHETIC_FINAL_INVENTORY
        SYNTHETIC_FAILED_MANIFEST = $syntheticFailureValidation.SYNTHETIC_FAILED_MANIFEST
        SYNTHETIC_FINALIZATION_FAILURE_COUNT = $syntheticFailureValidation.SYNTHETIC_FINALIZATION_FAILURE_COUNT
        SYNTHETIC_ZERO_PROCESSES_STOPPED = $syntheticFailureValidation.SYNTHETIC_ZERO_PROCESSES_STOPPED
        SYNTHETIC_ZERO_CLEAR_PERSONAL_PATHS = $syntheticFailureValidation.SYNTHETIC_ZERO_CLEAR_PERSONAL_PATHS
        SYNTHETIC_INVENTORY_EXCLUSIONS = $syntheticFailureValidation.SYNTHETIC_INVENTORY_EXCLUSIONS
    }
}

function New-OwnedRoot {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $safe = Assert-SafeTemporaryRoot -Candidate $LiteralPath -LeafPrefix $Prefix
    if (Test-Path -LiteralPath $safe) {
        throw "TEMP-ROOT-UNSAFE: root already exists: $safe"
    }
    $null = New-Item -ItemType Directory -Path $safe
    Write-Utf8NoBom -LiteralPath (Join-Path $safe '.step6r3b1-owned.json') -Value (([ordered]@{
        contract = 'STEP-6R.3B1'
        run_token = $Token
        created_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json) + [Environment]::NewLine)
    return $safe
}

function Assert-OwnedRoot {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)][string]$Prefix,
        [Parameter(Mandatory = $true)][string]$Token
    )
    $safe = Assert-SafeTemporaryRoot -Candidate $LiteralPath -LeafPrefix $Prefix
    $markerPath = Join-Path $safe '.step6r3b1-owned.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        throw "TEMP-ROOT-UNSAFE: ownership marker absent: $safe"
    }
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    if ($marker.contract -ne 'STEP-6R.3B1' -or $marker.run_token -ne $Token) {
        throw "TEMP-ROOT-UNSAFE: ownership marker mismatch: $safe"
    }
    return $safe
}

function Get-RelativePathPortable {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string]$ChildPath
    )
    $base = [Uri](([IO.Path]::GetFullPath($BasePath).TrimEnd('\') + '\'))
    $child = [Uri]([IO.Path]::GetFullPath($ChildPath))
    return [Uri]::UnescapeDataString($base.MakeRelativeUri($child).ToString()).Replace('/', '\')
}

function Get-HmacHex {
    param(
        [Parameter(Mandatory = $true)][byte[]]$Key,
        [Parameter(Mandatory = $true)][string]$Value
    )
    $hmac = [Security.Cryptography.HMACSHA256]::new($Key)
    try {
        return ([BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $hmac.Dispose()
    }
}

function Invoke-SafeTreeContractValidation {
    $token = 'contract-' + [guid]::NewGuid().ToString('N')
    $treePrefix = 'ytm-free-contract-tree-'
    $targetPrefix = 'ytm-free-contract-target-'
    $evidencePrefix = 'ytm-free-contract-evidence-'
    $treeRoot = Join-Path $env:TEMP ($treePrefix + $token)
    $externalTarget = Join-Path $env:TEMP ($targetPrefix + $token)
    $validationEvidence = Join-Path $env:TEMP ($evidencePrefix + $token)
    $createdRoots = [Collections.Generic.List[object]]::new()
    $junctionPath = Join-Path $treeRoot 'owned-junction'
    $junctionCreated = $false
    [byte[]]$hmacKey = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($hmacKey)
    }
    finally {
        $random.Dispose()
    }

    try {
        $treeRoot = New-OwnedRoot -LiteralPath $treeRoot -Prefix $treePrefix -Token $token
        $createdRoots.Add([pscustomobject]@{ path = $treeRoot; prefix = $treePrefix })
        $externalTarget = New-OwnedRoot -LiteralPath $externalTarget -Prefix $targetPrefix -Token $token
        $createdRoots.Add([pscustomobject]@{ path = $externalTarget; prefix = $targetPrefix })
        $validationEvidence = New-OwnedRoot -LiteralPath $validationEvidence -Prefix $evidencePrefix -Token $token
        $createdRoots.Add([pscustomobject]@{ path = $validationEvidence; prefix = $evidencePrefix })

        $normalDirectory = New-Item -ItemType Directory -Path (Join-Path $treeRoot 'normal\nested') -Force
        Write-Utf8NoBom -LiteralPath (Join-Path $normalDirectory.FullName 'normal.txt') -Value "safe-tree`n"
        $normalEntries = @(Get-SafeFileTree -Root $treeRoot `
            -ReparseFailureCode 'PRIVACY-REPARSE-POINT-DETECTED' `
            -ContainmentFailureCode 'PRIVACY-TREE-CONTAINMENT-FAILED' `
            -EnumerationFailureCode 'PRIVACY-TREE-ENUMERATION-FAILED' `
            -HmacKey $hmacKey `
            -ReparseEvidencePath (Join-Path $validationEvidence 'normal-reparse.json'))
        if (@($normalEntries | Where-Object { -not $_.PSIsContainer }).Count -ne 2) {
            throw 'SAFE-TREE-NORMAL-CASE-FAILED'
        }
        $null = Assert-NoReparseDescendant -LiteralPath $treeRoot -Prefix $treePrefix -Token $token

        $sentinelPath = Join-Path $externalTarget 'external-target-sentinel.txt'
        Write-Utf8NoBom -LiteralPath $sentinelPath -Value "external-target-unchanged`n"
        $sentinelHashBefore = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash

        try {
            $null = New-Item -ItemType Junction -Path $junctionPath -Target $externalTarget -ErrorAction Stop
            $junctionCreated = $true
        }
        catch {
            Write-Output 'REPARSE-SYNTHETIC-TEST: UNAVAILABLE'
            throw 'REPARSE-SYNTHETIC-TEST: UNAVAILABLE'
        }

        $snapshotRejected = $false
        try {
            $null = @(Get-SafeFileTree -Root $treeRoot `
                -ReparseFailureCode 'PRIVACY-REPARSE-POINT-DETECTED' `
                -ContainmentFailureCode 'PRIVACY-TREE-CONTAINMENT-FAILED' `
                -EnumerationFailureCode 'PRIVACY-TREE-ENUMERATION-FAILED' `
                -HmacKey $hmacKey `
                -ReparseEvidencePath (Join-Path $validationEvidence 'snapshot-reparse.json'))
        }
        catch {
            if ($_.Exception.Message -ne 'PRIVACY-REPARSE-POINT-DETECTED') { throw }
            $snapshotRejected = $true
        }
        if (-not $snapshotRejected) { throw 'SNAPSHOT-REPARSE-REJECTION-FAILED' }

        $cleanupRejected = $false
        try {
            $null = Assert-NoReparseDescendant -LiteralPath $treeRoot -Prefix $treePrefix -Token $token
        }
        catch {
            if ($_.Exception.Message -ne 'RUNTIME-REPARSE-POINT-DETECTED') { throw }
            $cleanupRejected = $true
        }
        if (-not $cleanupRejected) { throw 'CLEANUP-REPARSE-REJECTION-FAILED' }

        $sentinelHashAfter = (Get-FileHash -LiteralPath $sentinelPath -Algorithm SHA256).Hash
        if ($sentinelHashAfter -ne $sentinelHashBefore) {
            throw 'EXTERNAL-REPARSE-TARGET-CHANGED'
        }

        return [ordered]@{
            SAFE_TREE_NORMAL_CASE = 'PASS'
            SNAPSHOT_REPARSE_REJECTION = 'PASS'
            CLEANUP_REPARSE_REJECTION = 'PASS'
            EXTERNAL_REPARSE_TARGET_UNCHANGED = 'PASS'
        }
    }
    finally {
        if ($junctionCreated -and (Test-Path -LiteralPath $junctionPath)) {
            $junction = Get-Item -LiteralPath $junctionPath -Force -ErrorAction Stop
            if (($junction.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
                throw 'RUNTIME-REPARSE-POINT-DETECTED'
            }
            [IO.Directory]::Delete($junctionPath, $false)
        }
        foreach ($root in @($createdRoots | Sort-Object { $_.path.Length } -Descending)) {
            if (Test-Path -LiteralPath $root.path) {
                $safeRoot = Assert-NoReparseDescendant -LiteralPath $root.path -Prefix $root.prefix -Token $token
                Remove-Item -LiteralPath $safeRoot -Recurse -Force
            }
        }
        [Array]::Clear($hmacKey, 0, $hmacKey.Length)
    }
}

function Get-PrivacySnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][byte[]]$Key,
        [Parameter(Mandatory = $true)][string]$ReparseEvidencePath
    )
    if (-not (Test-Path -LiteralPath $Root)) {
        return @()
    }
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $entries = @()
    $items = @(Get-SafeFileTree -Root $rootFull `
        -ReparseFailureCode 'PRIVACY-REPARSE-POINT-DETECTED' `
        -ContainmentFailureCode 'PRIVACY-TREE-CONTAINMENT-FAILED' `
        -EnumerationFailureCode 'PRIVACY-TREE-ENUMERATION-FAILED' `
        -HmacKey $Key `
        -ReparseEvidencePath $ReparseEvidencePath)
    foreach ($item in $items) {
        $relative = Get-RelativePathPortable -BasePath $rootFull -ChildPath $item.FullName
        $entry = [ordered]@{
            path_hmac = Get-HmacHex -Key $Key -Value $relative.ToLowerInvariant()
            file_type = if ($item.PSIsContainer) { 'directory' } else { 'file' }
            size = if ($item.PSIsContainer) { $null } else { [int64]$item.Length }
            last_write_time_utc = $item.LastWriteTimeUtc.ToString('o')
            content_sha256 = if ($item.PSIsContainer) { $null } else { (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
        }
        $entries += $entry
    }
    return @($entries | Sort-Object path_hmac)
}

function Get-PersonalSurfaceRoots {
    return [ordered]@{
        music = Join-Path ([Environment]::GetFolderPath('MyMusic')) 'YTM-Free'
        downloads = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads\YTM-Free'
        roaming_appdata = Join-Path $env:APPDATA 'ytm-free'
        local_appdata = Join-Path $env:LOCALAPPDATA 'com.gabor.ytm-free'
    }
}

function Capture-PrivacySnapshots {
    param(
        [Parameter(Mandatory = $true)]$Roots,
        [Parameter(Mandatory = $true)][byte[]]$Key,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][string]$Moment
    )
    $result = [ordered]@{}
    foreach ($surface in $Roots.Keys) {
        $reparseEvidencePath = Join-Path $EvidenceRoot "privacy-$surface-reparse-$Moment.json"
        $snapshot = @(Get-PrivacySnapshot -Root $Roots[$surface] -Key $Key -ReparseEvidencePath $reparseEvidencePath)
        $result[$surface] = $snapshot
        Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot "privacy-$surface-$Moment.json") -Value $snapshot
    }
    return $result
}

function ConvertTo-RedactedText {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) { return $null }
    $text = [string]$Value
    $replacements = @(
        [pscustomobject]@{ value = $RepoRoot; replacement = '%REPO%' },
        [pscustomobject]@{ value = $env:USERPROFILE; replacement = '%USERPROFILE%' },
        [pscustomobject]@{ value = $env:TEMP; replacement = '%TEMP%' }
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_.value) } |
        Sort-Object { $_.value.Length } -Descending
    foreach ($replacement in $replacements) {
        $text = $text.Replace([string]$replacement.value, [string]$replacement.replacement)
    }
    return $text
}

function New-PrimaryFailureRecord {
    param(
        [Parameter(Mandatory = $true)]$ErrorRecord,
        [Parameter(Mandatory = $true)][string]$Phase
    )
    $message = [string]$ErrorRecord.Exception.Message
    $failureCode = 'UNCLASSIFIED-HARNESS-FAILURE'
    if ($message -match '^([A-Z0-9][A-Z0-9_-]+)') {
        $failureCode = $Matches[1]
    }
    return [ordered]@{
        failure_code = $failureCode
        failure_phase = $Phase
        exception_type = $ErrorRecord.Exception.GetType().FullName
        message_redacted = ConvertTo-RedactedText -Value $message
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    }
}

function Get-ProtectedFileSnapshots {
    param(
        [Parameter(Mandatory = $true)]$Paths,
        [Parameter(Mandatory = $true)][byte[]]$Key
    )
    $entries = @()
    foreach ($name in $Paths.Keys) {
        $literalPath = [string]$Paths[$name]
        $exists = Test-Path -LiteralPath $literalPath -PathType Leaf
        $entries += [ordered]@{
            path_hmac = Get-HmacHex -Key $Key -Value ([string]$name).ToLowerInvariant()
            exists = $exists
            size = if ($exists) { [int64](Get-Item -LiteralPath $literalPath).Length } else { $null }
            content_sha256 = if ($exists) { (Get-FileHash -LiteralPath $literalPath -Algorithm SHA256).Hash } else { $null }
        }
    }
    return @($entries | Sort-Object path_hmac)
}

function Get-ToolchainMetadata {
    param([Parameter(Mandatory = $true)]$Tools)
    $metadata = @()
    foreach ($tool in $Tools) {
        $metadata += [ordered]@{
            name = [string]$tool.name
            source_redacted = ConvertTo-RedactedText -Value $tool.path
            source_type = if ($tool.path -is [string]) { 'System.String' } else { $tool.path.GetType().FullName }
        }
    }
    return $metadata
}

function Invoke-ExternalCaptured {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$StdoutPath,
        [Parameter(Mandatory = $true)][string]$StderrPath
    )
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "External command failed ($($process.ExitCode)): $FilePath $($Arguments -join ' ')"
    }
    return $process.ExitCode
}

function Get-ProcessTable {
    $table = @{}
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
        $table[[int]$process.ProcessId] = $process
    }
    return $table
}

function Test-ProcessDescendsFrom {
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][int]$RootProcessId,
        [Parameter(Mandatory = $true)]$ProcessTable
    )
    $seen = @{}
    $current = $ProcessId
    while ($current -gt 0 -and -not $seen.ContainsKey($current)) {
        if ($current -eq $RootProcessId) { return $true }
        $seen[$current] = $true
        if (-not $ProcessTable.ContainsKey($current)) { return $false }
        $current = [int]$ProcessTable[$current].ParentProcessId
    }
    return $false
}

function Get-ProcessIdentity {
    param([Parameter(Mandatory = $true)]$CimProcess)
    $creationDate = $null
    if ($null -ne $CimProcess.CreationDate) {
        if ($CimProcess.CreationDate -is [datetime]) {
            $creationDate = ([datetime]$CimProcess.CreationDate).ToUniversalTime().ToString('o')
        }
        else {
            $creationDate = ([Management.ManagementDateTimeConverter]::ToDateTime([string]$CimProcess.CreationDate)).ToUniversalTime().ToString('o')
        }
    }
    return [ordered]@{
        process_id = [int]$CimProcess.ProcessId
        parent_process_id = [int]$CimProcess.ParentProcessId
        name = [string]$CimProcess.Name
        executable_path = [string]$CimProcess.ExecutablePath
        command_line = [string]$CimProcess.CommandLine
        creation_date = $creationDate
    }
}

function Assert-WebViewBrowserRoot {
    param(
        [Parameter(Mandatory = $true)]$OwnedProcesses,
        [Parameter(Mandatory = $true)][string]$WebViewDataDir
    )
    $webViews = @($OwnedProcesses | Where-Object { $_.name -ieq 'msedgewebview2.exe' })
    $browserRoots = @($webViews | Where-Object { $_.command_line -notmatch '(?:^|\s)--type=' })
    if ($browserRoots.Count -eq 0) { throw 'WEBVIEW2-BROWSER-ROOT-MISSING' }
    if ($browserRoots.Count -ne 1) { throw 'WEBVIEW2-BROWSER-ROOT-AMBIGUOUS' }
    $root = $browserRoots[0]
    $hostFlags = @([regex]::Matches($root.command_line, '--host-resolver-rules(?:=|\s)'))
    $backgroundFlags = @([regex]::Matches($root.command_line, '--disable-background-networking(?:\s|$)'))
    if ($hostFlags.Count -ne 1 -or $backgroundFlags.Count -ne 1 -or
        $root.command_line -notmatch 'MAP \* 127\.0\.0\.1, EXCLUDE localhost') {
        throw 'WEBVIEW2-BROWSER-FLAGS-MISSING'
    }
    if (@([regex]::Matches($root.command_line, '--host-resolver-rules')).Count -ne 1) {
        throw 'CONFLICTING-WEBVIEW2-HOST-RESOLVER-RULES'
    }
    if ($root.command_line.IndexOf($WebViewDataDir, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'WEBVIEW2-USER-DATA-DIR-MISMATCH'
    }
    return [ordered]@{ browser_root = $root; subprocess_count = $webViews.Count - 1 }
}

function Monitor-WdioPhase {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][string]$WebViewDataDir
    )
    $ownedByPid = @{}
    $connections = @()
    while (-not $Process.HasExited) {
        $Process.Refresh()
        $table = Get-ProcessTable
        foreach ($pid in @($table.Keys)) {
            if (Test-ProcessDescendsFrom -ProcessId $pid -RootProcessId $Process.Id -ProcessTable $table) {
                $identity = Get-ProcessIdentity -CimProcess $table[$pid]
                $ownedByPid[$pid] = $identity
                $Script:OwnedProcessIdentities += $identity
            }
        }
        $ownedPids = @($ownedByPid.Keys | ForEach-Object { [int]$_ })
        if ($ownedPids.Count -gt 0) {
            foreach ($connection in @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
                $_.OwningProcess -in $ownedPids -and $_.State -ne 'Listen'
            })) {
                $connections += [ordered]@{
                    observed_at_utc = (Get-Date).ToUniversalTime().ToString('o')
                    owning_process = [int]$connection.OwningProcess
                    local_address = [string]$connection.LocalAddress
                    local_port = [int]$connection.LocalPort
                    remote_address = [string]$connection.RemoteAddress
                    remote_port = [int]$connection.RemotePort
                    state = [string]$connection.State
                }
            }
        }
        Start-Sleep -Milliseconds 200
    }
    $Process.WaitForExit()
    $owned = @($ownedByPid.Values | Sort-Object process_id -Unique)
    Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot "owned-processes-$Phase.json") -Value $owned
    Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot "owned-tcp-$Phase.json") -Value $connections

    $nonLoopback = @($connections | Where-Object {
        $_.remote_address -notin @('127.0.0.1', '::1', '0.0.0.0', '::')
    })
    if ($nonLoopback.Count -ne 0) {
        throw 'UNEXPECTED-OWNED-PROCESS-NETWORK-CONNECTION'
    }
    $webViewResult = Assert-WebViewBrowserRoot -OwnedProcesses $owned -WebViewDataDir $WebViewDataDir
    if ($Process.ExitCode -ne 0) {
        throw "WDIO $Phase failed with exit $($Process.ExitCode)"
    }
    return [ordered]@{
        exit_code = $Process.ExitCode
        owned_processes = $owned
        connections = $connections
        webview = $webViewResult
    }
}

function New-WdioLaunchPlan {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('create', 'restart')]
        [string]$Phase
    )

    $wdioCandidate = Join-Path $RepoRoot 'node_modules\.bin\wdio.cmd'
    $resolvedExecutable = @(Resolve-Path -LiteralPath $wdioCandidate -ErrorAction SilentlyContinue)
    if ($resolvedExecutable.Count -eq 0) {
        throw 'WDIO-LAUNCH-EXECUTABLE-NOT-FOUND'
    }
    if ($resolvedExecutable.Count -ne 1) {
        throw 'WDIO-LAUNCH-EXECUTABLE-AMBIGUOUS'
    }
    $filePath = $resolvedExecutable[0].ProviderPath
    if ($filePath -isnot [string]) {
        throw 'WDIO-LAUNCH-FILEPATH-TYPE-MISMATCH'
    }
    $filePath = [IO.Path]::GetFullPath([string]$filePath)
    if (-not [IO.Path]::IsPathRooted($filePath) -or
        -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        throw 'WDIO-LAUNCH-EXECUTABLE-NOT-FOUND'
    }

    $resolvedSpec = @(Resolve-Path -LiteralPath $SpecPath -ErrorAction SilentlyContinue)
    if ($resolvedSpec.Count -eq 0) {
        throw 'WDIO-LAUNCH-SPEC-NOT-FOUND'
    }
    if ($resolvedSpec.Count -ne 1) {
        throw 'WDIO-LAUNCH-SPEC-AMBIGUOUS'
    }
    $resolvedSpecPath = $resolvedSpec[0].ProviderPath
    if ($resolvedSpecPath -isnot [string]) {
        throw 'WDIO-LAUNCH-SPEC-TYPE-MISMATCH'
    }
    $resolvedSpecPath = [IO.Path]::GetFullPath([string]$resolvedSpecPath)
    if (-not $resolvedSpecPath.Equals([IO.Path]::GetFullPath($SpecPath), [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $resolvedSpecPath -PathType Leaf)) {
        throw 'WDIO-LAUNCH-SPEC-MISMATCH'
    }

    [string[]]$argumentList = @(
        'run',
        [IO.Path]::GetFullPath($WdioConfig),
        '--spec',
        $resolvedSpecPath
    )
    return [pscustomobject][ordered]@{
        FilePath = [string]$filePath
        ArgumentList = $argumentList
        WorkingDirectory = [string][IO.Path]::GetFullPath($RepoRoot)
        Phase = [string]$Phase
        SpecPath = [string]$resolvedSpecPath
    }
}

function Invoke-LaunchPlanValidation {
    $gitIdentity = Get-HarnessGitIdentity
    $createOutputs = @(New-WdioLaunchPlan -Phase 'create')
    $restartOutputs = @(New-WdioLaunchPlan -Phase 'restart')
    if ($createOutputs.Count -ne 1 -or $restartOutputs.Count -ne 1) {
        throw 'WDIO-LAUNCH-PLAN-CARDINALITY-MISMATCH'
    }
    $createPlan = $createOutputs[0]
    $restartPlan = $restartOutputs[0]
    $expectedSpec = [IO.Path]::GetFullPath($SpecPath)
    return [ordered]@{
        git = $gitIdentity
        CREATE_FILEPATH_TYPE = $createPlan.FilePath.GetType().FullName
        RESTART_FILEPATH_TYPE = $restartPlan.FilePath.GetType().FullName
        CREATE_FILEPATH_CARDINALITY = @($createPlan.FilePath).Count
        RESTART_FILEPATH_CARDINALITY = @($restartPlan.FilePath).Count
        CREATE_SPEC_PATH_MATCH = $createPlan.SpecPath.Equals($expectedSpec, [StringComparison]::OrdinalIgnoreCase)
        RESTART_SPEC_PATH_MATCH = $restartPlan.SpecPath.Equals($expectedSpec, [StringComparison]::OrdinalIgnoreCase)
        CREATE_ARGUMENT_LIST_TYPE = $createPlan.ArgumentList.GetType().FullName
        RESTART_ARGUMENT_LIST_TYPE = $restartPlan.ArgumentList.GetType().FullName
        START_PROCESS_CALLED = $false
        create_plan = $createPlan
        restart_plan = $restartPlan
    }
}

function Start-WdioPhase {
    param(
        [Parameter(Mandatory = $true)]$LaunchPlan,
        [Parameter(Mandatory = $true)][string]$PhaseEvidenceRoot,
        [Parameter(Mandatory = $true)][string]$WebViewDataDir
    )

    $FilePath = $LaunchPlan.FilePath
    $ArgumentList = $LaunchPlan.ArgumentList
    $WorkingDirectory = $LaunchPlan.WorkingDirectory
    $Phase = $LaunchPlan.Phase
    if ($FilePath -isnot [string]) {
        throw 'WDIO-LAUNCH-FILEPATH-TYPE-MISMATCH'
    }
    if ([string]::IsNullOrWhiteSpace($FilePath)) {
        throw 'WDIO-LAUNCH-FILEPATH-EMPTY'
    }
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw 'WDIO-LAUNCH-EXECUTABLE-NOT-FOUND'
    }
    if ($ArgumentList -isnot [System.Array]) {
        throw 'WDIO-LAUNCH-ARGUMENT-TYPE-MISMATCH'
    }
    foreach ($argument in $ArgumentList) {
        if ($null -eq $argument -or $argument -isnot [string]) {
            throw 'WDIO-LAUNCH-ARGUMENT-TYPE-MISMATCH'
        }
    }
    if ($Phase -notin @('create', 'restart')) {
        throw 'WDIO-LAUNCH-PHASE-MISMATCH'
    }
    if ($WorkingDirectory -isnot [string] -or
        -not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        throw 'WDIO-LAUNCH-WORKING-DIRECTORY-MISMATCH'
    }

    $env:IMPORT_DELETE_PHASE = $Phase
    $env:EVIDENCE_ROOT = $PhaseEvidenceRoot
    $stdout = Join-Path $PhaseEvidenceRoot 'wdio.stdout.log'
    $stderr = Join-Path $PhaseEvidenceRoot 'wdio.stderr.log'
    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    $Script:OwnedProcessIdentities += Get-ProcessIdentity -CimProcess $cim
    return Monitor-WdioPhase -Process $process -EvidenceRoot $PhaseEvidenceRoot -Phase $Phase -WebViewDataDir $WebViewDataDir
}

function Stop-OwnedProcessIdentity {
    param([Parameter(Mandatory = $true)]$Identity)
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($Identity.process_id)" -ErrorAction SilentlyContinue
    if ($null -eq $current) { return }
    $currentIdentity = Get-ProcessIdentity -CimProcess $current
    if ($currentIdentity.executable_path -ne $Identity.executable_path -or
        $currentIdentity.creation_date -ne $Identity.creation_date) {
        throw "Owned PID identity changed: $($Identity.process_id)"
    }
    Stop-Process -Id $Identity.process_id -Force -ErrorAction Stop
    Wait-Process -Id $Identity.process_id -Timeout 10 -ErrorAction SilentlyContinue
}

function Set-ProcessEnvironment {
    param([Parameter(Mandatory = $true)]$Values)
    $previous = @{}
    foreach ($name in $Values.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, [string]$Values[$name], 'Process')
    }
    return $previous
}

function Restore-ProcessEnvironment {
    param([Parameter(Mandatory = $true)]$Previous)
    $results = @()
    foreach ($name in $Previous.Keys) {
        try {
            [Environment]::SetEnvironmentVariable($name, $Previous[$name], 'Process')
            $current = [Environment]::GetEnvironmentVariable($name, 'Process')
            $matches = if ($null -eq $Previous[$name]) { $null -eq $current } else { $current -ceq $Previous[$name] }
            $results += [ordered]@{
                name = [string]$name
                restored = [bool]$matches
                status = if ($matches) { 'PASS' } else { 'FAILED' }
            }
        }
        catch {
            $results += [ordered]@{
                name = [string]$name
                restored = $false
                status = 'FAILED'
                error_redacted = ConvertTo-RedactedText -Value $_.Exception.Message
            }
        }
    }
    return $results
}

function Invoke-LogicalSnapshotFromHelper {
    param(
        [Parameter(Mandatory = $true)][string]$DataDir,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )
    $output = @(& py -3 $LogicalSnapshotScript --data-dir $DataDir --logical-snapshot 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "Logical snapshot helper failed: $($output -join [Environment]::NewLine)"
    }
    $json = $output -join [Environment]::NewLine
    $null = $json | ConvertFrom-Json
    Write-Utf8NoBom -LiteralPath $OutputPath -Value ($json + [Environment]::NewLine)
}

function Get-EvidenceInventory {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [string[]]$ExcludeRelativePaths = @()
    )
    $exclusions = @($ExcludeRelativePaths | ForEach-Object { $_.Replace('\', '/') })
    $entries = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse -Force | Sort-Object FullName)) {
        $relativePath = (Get-RelativePathPortable -BasePath $EvidenceRoot -ChildPath $file.FullName).Replace('\', '/')
        if ($relativePath -in $exclusions) { continue }
        $entries += [ordered]@{
            relative_path = $relativePath
            size = [int64]$file.Length
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
    }
    return $entries
}

function Add-FinalizationFailure {
    param(
        [Parameter(Mandatory = $true)]$List,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$ExceptionType = 'HarnessFinalizationFailure'
    )
    $List.Add([ordered]@{
        stage = $Stage
        exception_type = $ExceptionType
        message_redacted = ConvertTo-RedactedText -Value $Message
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    }) | Out-Null
}

function Compare-SnapshotMaps {
    param(
        [Parameter(Mandatory = $true)]$Before,
        [Parameter(Mandatory = $true)]$After
    )
    $results = [ordered]@{}
    $allEqual = $true
    foreach ($surface in $Before.Keys) {
        $beforeJson = $Before[$surface] | ConvertTo-Json -Depth 20 -Compress
        $afterJson = $After[$surface] | ConvertTo-Json -Depth 20 -Compress
        $equal = $beforeJson -ceq $afterJson
        $results[$surface] = [bool]$equal
        if (-not $equal) { $allEqual = $false }
    }
    return [ordered]@{
        surfaces = $results
        all_equal = [bool]$allEqual
    }
}

function Invoke-HarnessFinalization {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][string]$EvidencePrefix,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][string]$RuntimePrefix,
        [Parameter(Mandatory = $true)][string]$RunToken,
        [Parameter(Mandatory = $true)][byte[]]$HmacKey,
        [Parameter(Mandatory = $true)]$PersonalRoots,
        [AllowNull()]$PrivacyBefore,
        [Parameter(Mandatory = $true)]$ProtectedPaths,
        [AllowNull()]$ProtectedBefore,
        [AllowNull()]$EnvironmentBefore,
        [Parameter(Mandatory = $true)]$OwnedProcessIdentities,
        [AllowNull()]$PrimaryFailure,
        [Parameter(Mandatory = $true)]$Context
    )

    $finalizationFailures = [Collections.Generic.List[object]]::new()
    $environmentRestoreStatus = 'SKIPPED'
    $environmentRestoreResults = @()
    $ownedProcessCleanupStatus = 'PASS'
    $ownedProcessCleanupResults = @()
    $portReleaseStatus = 'UNKNOWN'
    $portListenersAfter = @()
    $runtimeRootCleanupStatus = 'UNKNOWN'
    $privacyAfterSnapshotStatus = 'SKIPPED'
    $privacyComparisonStatus = 'NOT_AVAILABLE'
    $protectedFileComparisonStatus = 'NOT_AVAILABLE'
    $privacyAfter = $null
    $protectedAfter = $null
    $evidenceRootPreserved = $false

    if ($null -ne $EnvironmentBefore) {
        try {
            $environmentRestoreResults = @(Restore-ProcessEnvironment -Previous $EnvironmentBefore)
            $environmentRestoreStatus = if (@($environmentRestoreResults | Where-Object { $_.status -ne 'PASS' }).Count -eq 0) {
                'PASS'
            }
            else {
                'FAILED'
            }
            if ($environmentRestoreStatus -ne 'PASS') {
                Add-FinalizationFailure -List $finalizationFailures -Stage 'environment-restore' `
                    -Message 'ENVIRONMENT-RESTORE-INCOMPLETE'
            }
        }
        catch {
            $environmentRestoreStatus = 'FAILED'
            Add-FinalizationFailure -List $finalizationFailures -Stage 'environment-restore' `
                -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
        }
    }

    foreach ($identity in @($OwnedProcessIdentities | Sort-Object process_id -Descending -Unique)) {
        try {
            Stop-OwnedProcessIdentity -Identity $identity
            $stillPresent = $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId = $($identity.process_id)" -ErrorAction SilentlyContinue)
            $ownedProcessCleanupResults += [ordered]@{
                process_id = [int]$identity.process_id
                status = if ($stillPresent) { 'FAILED' } else { 'PASS' }
            }
            if ($stillPresent) {
                $ownedProcessCleanupStatus = 'FAILED'
                Add-FinalizationFailure -List $finalizationFailures -Stage 'owned-process-cleanup' `
                    -Message 'OWNED-PROCESS-RESIDUAL'
            }
        }
        catch {
            $ownedProcessCleanupStatus = 'FAILED'
            $ownedProcessCleanupResults += [ordered]@{
                process_id = [int]$identity.process_id
                status = 'FAILED'
            }
            Add-FinalizationFailure -List $finalizationFailures -Stage 'owned-process-cleanup' `
                -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
        }
    }

    try {
        $portListenersAfter = @(Get-ContractPortListeners)
        $portReleaseStatus = if ($portListenersAfter.Count -eq 0) { 'PASS' } else { 'FAILED' }
        if ($portReleaseStatus -ne 'PASS') {
            Add-FinalizationFailure -List $finalizationFailures -Stage 'port-release' -Message 'PORT-RELEASE-INCOMPLETE'
        }
    }
    catch {
        $portReleaseStatus = 'FAILED'
        Add-FinalizationFailure -List $finalizationFailures -Stage 'port-release' `
            -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
    }

    if ($null -ne $PrivacyBefore -and $HmacKey.Length -gt 0) {
        try {
            $privacyAfter = Capture-PrivacySnapshots -Roots $PersonalRoots -Key $HmacKey `
                -EvidenceRoot $EvidenceRoot -Moment 'after'
            $privacyComparison = Compare-SnapshotMaps -Before $PrivacyBefore -After $privacyAfter
            $privacyAfterSnapshotStatus = 'PASS'
            $privacyComparisonStatus = if ($privacyComparison.all_equal) { 'PASS' } else { 'FAILED' }
            Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot 'privacy-comparison.json') -Value ([ordered]@{
                surfaces = $privacyComparison.surfaces
                all_unchanged = $privacyComparison.all_equal
                comparison_key_persisted = $false
            })
            if (-not $privacyComparison.all_equal) {
                Add-FinalizationFailure -List $finalizationFailures -Stage 'privacy-comparison' `
                    -Message 'PRIVACY-SNAPSHOT-COMPARABILITY-LOST'
            }
        }
        catch {
            $privacyAfterSnapshotStatus = 'FAILED'
            $privacyComparisonStatus = 'FAILED'
            Add-FinalizationFailure -List $finalizationFailures -Stage 'privacy-after-snapshot' `
                -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
        }
    }

    if ($null -ne $ProtectedBefore -and $HmacKey.Length -gt 0) {
        try {
            $protectedAfter = @(Get-ProtectedFileSnapshots -Paths $ProtectedPaths -Key $HmacKey)
            Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot 'protected-files-after.json') -Value $protectedAfter
            $protectedBeforeMap = [ordered]@{ protected = @($ProtectedBefore) }
            $protectedAfterMap = [ordered]@{ protected = @($protectedAfter) }
            $protectedComparison = Compare-SnapshotMaps -Before $protectedBeforeMap -After $protectedAfterMap
            $protectedFileComparisonStatus = if ($protectedComparison.all_equal) { 'PASS' } else { 'FAILED' }
            Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot 'protected-files-comparison.json') -Value ([ordered]@{
                all_unchanged = $protectedComparison.all_equal
                comparison_key_persisted = $false
            })
            if (-not $protectedComparison.all_equal) {
                Add-FinalizationFailure -List $finalizationFailures -Stage 'protected-file-comparison' `
                    -Message 'PROTECTED-FILE-COMPARISON-FAILED'
            }
        }
        catch {
            $protectedFileComparisonStatus = 'FAILED'
            Add-FinalizationFailure -List $finalizationFailures -Stage 'protected-file-comparison' `
                -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
        }
    }

    try {
        if (Test-Path -LiteralPath $RuntimeRoot) {
            $safeRuntime = Assert-NoReparseDescendant -LiteralPath $RuntimeRoot -Prefix $RuntimePrefix -Token $RunToken
            Remove-Item -LiteralPath $safeRuntime -Recurse -Force
        }
        $runtimeRootCleanupStatus = if (Test-Path -LiteralPath $RuntimeRoot) { 'FAILED' } else { 'PASS' }
        if ($runtimeRootCleanupStatus -ne 'PASS') {
            Add-FinalizationFailure -List $finalizationFailures -Stage 'runtime-root-cleanup' `
                -Message 'RUNTIME-ROOT-CLEANUP-INCOMPLETE'
        }
    }
    catch {
        $runtimeRootCleanupStatus = 'FAILED'
        Add-FinalizationFailure -List $finalizationFailures -Stage 'runtime-root-cleanup' `
            -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
    }

    try {
        $safeEvidence = Assert-OwnedRoot -LiteralPath $EvidenceRoot -Prefix $EvidencePrefix -Token $RunToken
        $evidenceRootPreserved = Test-Path -LiteralPath $safeEvidence -PathType Container
        if (-not $evidenceRootPreserved) {
            Add-FinalizationFailure -List $finalizationFailures -Stage 'evidence-root-preservation' `
                -Message 'EVIDENCE-ROOT-NOT-PRESERVED'
        }
    }
    catch {
        $evidenceRootPreserved = $false
        Add-FinalizationFailure -List $finalizationFailures -Stage 'evidence-root-preservation' `
            -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
    }

    $cleanupLedgerPath = Join-Path $EvidenceRoot 'cleanup-ledger.json'
    $cleanupLedger = [ordered]@{
        primary_failure_present = $null -ne $PrimaryFailure
        environment_restore_status = [ordered]@{
            status = $environmentRestoreStatus
            variables = $environmentRestoreResults
        }
        owned_process_cleanup_status = [ordered]@{
            status = $ownedProcessCleanupStatus
            processes = $ownedProcessCleanupResults
        }
        port_release_status = [ordered]@{
            status = $portReleaseStatus
            listener_count = $portListenersAfter.Count
        }
        runtime_root_cleanup_status = $runtimeRootCleanupStatus
        privacy_after_snapshot_status = $privacyAfterSnapshotStatus
        protected_file_comparison_status = $protectedFileComparisonStatus
        evidence_root_preserved = [bool]$evidenceRootPreserved
        finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
    }
    Write-JsonFile -LiteralPath $cleanupLedgerPath -Value $cleanupLedger

    $inventoryPath = Join-Path $EvidenceRoot 'final-evidence-inventory.json'
    $manifestPath = Join-Path $EvidenceRoot 'final-manifest.json'
    $inventoryExclusions = @('final-evidence-inventory.json', 'final-manifest.json')
    $inventory = @(Get-EvidenceInventory -EvidenceRoot $EvidenceRoot -ExcludeRelativePaths $inventoryExclusions)
    Write-JsonFile -LiteralPath $inventoryPath -Value ([ordered]@{
        schema_version = 1
        excluded_relative_paths = $inventoryExclusions
        entries = $inventory
    })
    $inventorySha256 = (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash

    $cleanupStatus = if ($finalizationFailures.Count -eq 0 -and
        $environmentRestoreStatus -notin @('FAILED') -and
        $ownedProcessCleanupStatus -eq 'PASS' -and
        $portReleaseStatus -eq 'PASS' -and
        $runtimeRootCleanupStatus -eq 'PASS' -and
        $privacyAfterSnapshotStatus -notin @('FAILED') -and
        $protectedFileComparisonStatus -notin @('FAILED') -and
        $evidenceRootPreserved) { 'PASS' } else { 'FAILED' }
    $runStatus = if ($null -ne $PrimaryFailure) { 'FAILED' } elseif ($cleanupStatus -eq 'PASS') { 'PASS' } else { 'BLOCKED' }
    $manifest = [ordered]@{
        run_status = $runStatus
        primary_failure = $PrimaryFailure
        first_incomplete_phase = [string]$Context.first_incomplete_phase
        app_baseline_sha = [string]$Context.app_baseline_sha
        harness_head_sha = [string]$Context.harness_head_sha
        build_status = [string]$Context.build_status
        application_launch_status = [string]$Context.application_launch_status
        wdio_status = [string]$Context.wdio_status
        create_status = [string]$Context.create_status
        restart_status = [string]$Context.restart_status
        cleanup_status = $cleanupStatus
        privacy_comparison_status = $privacyComparisonStatus
        evidence_completeness = if ($inventory.Count -gt 0) { 'FINALIZED' } else { 'INCOMPLETE' }
        finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
        final_evidence_inventory_sha256 = $inventorySha256
        final_evidence_inventory_excludes = $inventoryExclusions
    }
    Write-JsonFile -LiteralPath $manifestPath -Value $manifest
    $manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash

    return [ordered]@{
        cleanup_ledger_path = $cleanupLedgerPath
        inventory_path = $inventoryPath
        inventory_sha256 = $inventorySha256
        inventory_exclusions = $inventoryExclusions
        manifest_path = $manifestPath
        manifest_sha256 = $manifestSha256
        cleanup_status = $cleanupStatus
        privacy_comparison_status = $privacyComparisonStatus
        protected_file_comparison_status = $protectedFileComparisonStatus
        environment_restore_status = $environmentRestoreStatus
        runtime_root_cleanup_status = $runtimeRootCleanupStatus
        evidence_root_preserved = [bool]$evidenceRootPreserved
        finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
    }
}

function Invoke-SyntheticFailureFinalizationValidation {
    $runToken = 'synthetic-' + [guid]::NewGuid().ToString('N')
    $evidencePrefix = 'ytm-free-import-delete-synthetic-evidence-'
    $runtimePrefix = 'ytm-free-import-delete-synthetic-runtime-'
    $evidenceRoot = Join-Path $env:TEMP ($evidencePrefix + $runToken)
    $runtimeRoot = Join-Path $env:TEMP ($runtimePrefix + $runToken)
    $environmentVariableName = 'YTM_FREE_SYNTHETIC_FINALIZATION'
    $environmentOriginalValue = [Environment]::GetEnvironmentVariable($environmentVariableName, 'Process')
    $environmentBefore = $null
    $privacyBefore = $null
    $protectedBefore = $null
    $primaryFailure = $null
    $finalization = $null
    $evidenceCreated = $false
    $runtimeCreated = $false
    [byte[]]$hmacKey = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($hmacKey)
    }
    finally {
        $random.Dispose()
    }

    try {
        $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
        $evidenceCreated = $true
        $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
        $runtimeCreated = $true

        $syntheticSurface = Join-Path $runtimeRoot 'synthetic-surface'
        $null = New-Item -ItemType Directory -Path $syntheticSurface
        Write-Utf8NoBom -LiteralPath (Join-Path $syntheticSurface 'surface.txt') -Value "synthetic-private-surface`n"
        $syntheticProtectedPath = Join-Path $runtimeRoot 'synthetic-protected.txt'
        Write-Utf8NoBom -LiteralPath $syntheticProtectedPath -Value "synthetic-protected`n"
        $syntheticFixturePath = Join-Path $runtimeRoot 'synthetic-fixture.csv'
        Write-Utf8NoBom -LiteralPath $syntheticFixturePath -Value "id,title`n1,Synthetic`n"
        $syntheticShimSource = Join-Path $runtimeRoot 'synthetic-shim.rs'
        $syntheticShimExecutable = Join-Path $runtimeRoot 'synthetic-shim.exe'
        Write-Utf8NoBom -LiteralPath $syntheticShimSource -Value "fn main() {}`n"
        Write-Utf8NoBom -LiteralPath $syntheticShimExecutable -Value "synthetic-executable`n"

        $personalRoots = [ordered]@{ synthetic_surface = $syntheticSurface }
        $protectedPaths = [ordered]@{ synthetic_protected = $syntheticProtectedPath }
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'git-preflight.json') -Value ([ordered]@{
            synthetic = $true
            app_baseline_sha = $ExpectedAppBaseline
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'toolchain.json') -Value ([ordered]@{
            synthetic = $true
            application_build = 'NOT RUN'
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'run-metadata.json') -Value ([ordered]@{
            schema_version = 1
            run_token = $runToken
            scenario = 'SYNTHETIC-FAILURE-BEFORE-WDIO'
            evidence_root_identity = 'owned-synthetic-temp-root'
            runtime_root_identity = 'owned-synthetic-temp-root'
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'build-provenance.json') -Value ([ordered]@{
            synthetic = $true
            build_status = 'NOT RUN'
            build_exit = $null
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'fixture-metadata.json') -Value ([ordered]@{
            synthetic = $true
            fixture_sha256 = (Get-FileHash -LiteralPath $syntheticFixturePath -Algorithm SHA256).Hash
            fixture_size = [int64](Get-Item -LiteralPath $syntheticFixturePath).Length
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'shim-source-metadata.json') -Value ([ordered]@{
            synthetic = $true
            source_sha256 = (Get-FileHash -LiteralPath $syntheticShimSource -Algorithm SHA256).Hash
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'shim-executable-metadata.json') -Value ([ordered]@{
            synthetic = $true
            executable_sha256 = (Get-FileHash -LiteralPath $syntheticShimExecutable -Algorithm SHA256).Hash
            executable_size = [int64](Get-Item -LiteralPath $syntheticShimExecutable).Length
            compile_exit = 0
        })

        $privacyBefore = Capture-PrivacySnapshots -Roots $personalRoots -Key $hmacKey `
            -EvidenceRoot $evidenceRoot -Moment 'before'
        $protectedBefore = @(Get-ProtectedFileSnapshots -Paths $protectedPaths -Key $hmacKey)
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'protected-files-before.json') -Value $protectedBefore
        $environmentBefore = Set-ProcessEnvironment -Values ([ordered]@{
            $environmentVariableName = 'synthetic-mutated-value'
        })

        try {
            throw 'SYNTHETIC-WDIO-PRELAUNCH-FAILURE'
        }
        catch {
            $primaryFailure = New-PrimaryFailureRecord -ErrorRecord $_ -Phase 'wdio-create'
            Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'primary-failure.json') -Value $primaryFailure
        }

        $finalization = Invoke-HarnessFinalization -EvidenceRoot $evidenceRoot -EvidencePrefix $evidencePrefix `
            -RuntimeRoot $runtimeRoot -RuntimePrefix $runtimePrefix -RunToken $runToken -HmacKey $hmacKey `
            -PersonalRoots $personalRoots -PrivacyBefore $privacyBefore -ProtectedPaths $protectedPaths `
            -ProtectedBefore $protectedBefore -EnvironmentBefore $environmentBefore -OwnedProcessIdentities @() `
            -PrimaryFailure $primaryFailure -Context ([ordered]@{
                first_incomplete_phase = 'wdio-create'
                app_baseline_sha = $ExpectedAppBaseline
                harness_head_sha = 'synthetic-no-head'
                build_status = 'NOT RUN'
                application_launch_status = 'NOT RUN'
                wdio_status = 'FAILED-BEFORE-LAUNCH'
                create_status = 'FAILED-BEFORE-LAUNCH'
                restart_status = 'NOT RUN'
            })

        $cleanupLedger = Get-Content -LiteralPath $finalization.cleanup_ledger_path -Raw | ConvertFrom-Json
        $manifest = Get-Content -LiteralPath $finalization.manifest_path -Raw | ConvertFrom-Json
        $inventory = Get-Content -LiteralPath $finalization.inventory_path -Raw | ConvertFrom-Json
        $privacyAfterCaptured = Test-Path -LiteralPath (Join-Path $evidenceRoot 'privacy-synthetic_surface-after.json') -PathType Leaf
        $privacyComparison = Get-Content -LiteralPath (Join-Path $evidenceRoot 'privacy-comparison.json') -Raw | ConvertFrom-Json
        $environmentRestored = [Environment]::GetEnvironmentVariable($environmentVariableName, 'Process') -ceq $environmentOriginalValue
        $inventoryPaths = @($inventory.entries | ForEach-Object { [string]$_.relative_path })
        $inventoryExclusionsCorrect = 'final-evidence-inventory.json' -notin $inventoryPaths -and
            'final-manifest.json' -notin $inventoryPaths
        $clearPersonalPathFound = $false
        foreach ($file in @(Get-ChildItem -LiteralPath $evidenceRoot -File -Recurse -Force)) {
            $content = [IO.File]::ReadAllText($file.FullName)
            if ((-not [string]::IsNullOrWhiteSpace($env:USERPROFILE) -and $content.Contains($env:USERPROFILE)) -or
                (-not [string]::IsNullOrWhiteSpace($env:TEMP) -and $content.Contains($env:TEMP)) -or
                $content.Contains($RepoRoot)) {
                $clearPersonalPathFound = $true
                break
            }
        }

        if ($primaryFailure.failure_code -ne 'SYNTHETIC-WDIO-PRELAUNCH-FAILURE') {
            throw 'SYNTHETIC-PRIMARY-FAILURE-NOT-PRESERVED'
        }
        if (-not $privacyAfterCaptured -or -not $privacyComparison.all_unchanged) {
            throw 'SYNTHETIC-PRIVACY-FINALIZATION-FAILED'
        }
        if (-not $environmentRestored -or $cleanupLedger.environment_restore_status.status -ne 'PASS') {
            throw 'SYNTHETIC-ENVIRONMENT-RESTORE-FAILED'
        }
        if (Test-Path -LiteralPath $runtimeRoot) { throw 'SYNTHETIC-RUNTIME-ROOT-RESIDUAL' }
        if (-not (Test-Path -LiteralPath $evidenceRoot -PathType Container)) { throw 'SYNTHETIC-EVIDENCE-ROOT-MISSING' }
        if (-not (Test-Path -LiteralPath $finalization.cleanup_ledger_path -PathType Leaf)) { throw 'SYNTHETIC-CLEANUP-LEDGER-MISSING' }
        if (-not (Test-Path -LiteralPath $finalization.inventory_path -PathType Leaf) -or -not $inventoryExclusionsCorrect) {
            throw 'SYNTHETIC-FINAL-INVENTORY-FAILED'
        }
        if (-not (Test-Path -LiteralPath $finalization.manifest_path -PathType Leaf) -or
            $manifest.run_status -ne 'FAILED' -or
            $manifest.primary_failure.failure_code -ne 'SYNTHETIC-WDIO-PRELAUNCH-FAILURE') {
            throw 'SYNTHETIC-FAILED-MANIFEST-FAILED'
        }
        if ($finalization.finalization_failures.Count -ne 0) { throw 'SYNTHETIC-FINALIZATION-FAILURES-NONZERO' }
        if ($cleanupLedger.owned_process_cleanup_status.processes.Count -ne 0) { throw 'SYNTHETIC-PROCESS-CLEANUP-NONZERO' }
        if ($clearPersonalPathFound) { throw 'SYNTHETIC-CLEAR-PERSONAL-PATH-DETECTED' }

        return [ordered]@{
            SYNTHETIC_PRIMARY_FAILURE_PRESERVED = 'PASS'
            SYNTHETIC_PRIVACY_AFTER_CAPTURED = 'PASS'
            SYNTHETIC_PRIVACY_EQUALITY = 'PASS'
            SYNTHETIC_ENVIRONMENT_RESTORED = 'PASS'
            SYNTHETIC_RUNTIME_ROOT_REMOVED = 'PASS'
            SYNTHETIC_EVIDENCE_ROOT_PRESERVED = 'PASS'
            SYNTHETIC_CLEANUP_LEDGER = 'PASS'
            SYNTHETIC_FINAL_INVENTORY = 'PASS'
            SYNTHETIC_FAILED_MANIFEST = 'PASS'
            SYNTHETIC_FINALIZATION_FAILURE_COUNT = 0
            SYNTHETIC_ZERO_PROCESSES_STOPPED = 'PASS'
            SYNTHETIC_ZERO_CLEAR_PERSONAL_PATHS = 'PASS'
            SYNTHETIC_INVENTORY_EXCLUSIONS = 'PASS'
        }
    }
    finally {
        [Environment]::SetEnvironmentVariable($environmentVariableName, $environmentOriginalValue, 'Process')
        if ($runtimeCreated -and (Test-Path -LiteralPath $runtimeRoot)) {
            $safeRuntime = Assert-NoReparseDescendant -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
            Remove-Item -LiteralPath $safeRuntime -Recurse -Force
        }
        if ($evidenceCreated -and (Test-Path -LiteralPath $evidenceRoot)) {
            $safeEvidence = Assert-NoReparseDescendant -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
            Remove-Item -LiteralPath $safeEvidence -Recurse -Force
        }
        [Array]::Clear($hmacKey, 0, $hmacKey.Length)
    }
}

function Invoke-FullRuntimeHarness {
    $preflight = Invoke-SafePreflight
    $runToken = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8).ToLowerInvariant()
    $evidencePrefix = 'ytm-free-import-delete-evidence-b3200d4f8d41-'
    $runtimePrefix = 'ytm-free-import-delete-runtime-'
    $evidenceRoot = Join-Path $env:TEMP "ytm-free-import-delete-evidence-b3200d4f8d41-$runToken"
    $runtimeRoot = Join-Path $env:TEMP "ytm-free-import-delete-runtime-$runToken"
    $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
    $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken

    $hmacKey = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($hmacKey)
    }
    finally {
        $random.Dispose()
    }
    $environmentBefore = $null
    $privacyBefore = $null
    $personalRoots = Get-PersonalSurfaceRoots
    $protectedPaths = [ordered]@{}
    foreach ($relativePath in $ProtectedUntrackedPaths) {
        $protectedPaths[$relativePath] = Join-Path $RepoRoot $relativePath
    }
    $protectedBefore = $null
    $primaryFailure = $null
    $finalization = $null
    $firstIncompletePhase = 'setup'
    $buildStatus = 'NOT RUN'
    $applicationLaunchStatus = 'NOT RUN'
    $wdioStatus = 'NOT RUN'
    $createStatus = 'NOT RUN'
    $restartStatus = 'NOT RUN'
    try {
        $dataDir = Join-Path $runtimeRoot 'data'
        $spotifyDir = Join-Path $runtimeRoot 'spotify'
        $webViewDataDir = Join-Path $runtimeRoot 'webview2'
        $processTemp = Join-Path $runtimeRoot 'temp'
        $shimDir = Join-Path $runtimeRoot 'shim'
        foreach ($directory in @($dataDir, $spotifyDir, $webViewDataDir, $processTemp, $shimDir)) {
            $null = New-Item -ItemType Directory -Path $directory
        }
        $createEvidence = Join-Path $evidenceRoot 'create'
        $restartEvidence = Join-Path $evidenceRoot 'restart'
        $null = New-Item -ItemType Directory -Path $createEvidence
        $null = New-Item -ItemType Directory -Path $restartEvidence

        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'git-preflight.json') -Value ([ordered]@{
            branch = $preflight.git.branch
            APP_BASELINE_SHA = $preflight.git.APP_BASELINE_SHA
            HARNESS_HEAD_SHA = $preflight.git.HARNESS_HEAD_SHA
            ORIGIN_MAIN_SHA = $preflight.git.ORIGIN_MAIN_SHA
            HARNESS_MERGE_BASE_SHA = $preflight.git.HARNESS_MERGE_BASE_SHA
            HARNESS_DELTA_PATHS = $preflight.git.HARNESS_DELTA_PATHS
            HARNESS_COMMIT_COUNT = $preflight.git.HARNESS_COMMIT_COUNT
            status = $preflight.git.status
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'toolchain.json') -Value ([ordered]@{
            tools = @(Get-ToolchainMetadata -Tools $preflight.tools)
            full_environment_logged = $false
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'run-metadata.json') -Value ([ordered]@{
            schema_version = 1
            run_token = $runToken
            started_at_utc = (Get-Date).ToUniversalTime().ToString('o')
            evidence_root_identity = 'new-owned-temp-root'
            runtime_root_identity = 'new-owned-temp-root'
            expected_create_phase = 'create'
            expected_restart_phase = 'restart'
        })

        $firstIncompletePhase = 'fixture'
        $fixtureStem = "step6r3b1-import-$runToken"
        $fixtureName = "$fixtureStem.csv"
        $playlistName = "Step6R3B1 Playlist $runToken"
        $fixture = @(
            'Spotify ID,Track Name,Album Name,Artist Name(s),Duration (ms)',
            "spotify:track:step6r3b1alpha,Step6R3B1 Alpha $runToken,Step6R3B1 Synthetic Album,Step6R3B1 Synthetic Artist,123000",
            "spotify:track:step6r3b1beta,Step6R3B1 Beta $runToken,Step6R3B1 Synthetic Album,Step6R3B1 Synthetic Artist,234000"
        ) -join "`r`n"
        $fixturePath = Join-Path $spotifyDir $fixtureName
        Write-Utf8NoBom -LiteralPath $fixturePath -Value ($fixture + "`r`n")
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'fixture-metadata.json') -Value ([ordered]@{
            fixture_name = $fixtureName
            parsed_track_count_expected = 2
            fixture_size = [int64](Get-Item -LiteralPath $fixturePath).Length
            fixture_sha256 = (Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash
        })

        $firstIncompletePhase = 'privacy-before'
        $privacyBefore = Capture-PrivacySnapshots -Roots $personalRoots -Key $hmacKey -EvidenceRoot $evidenceRoot -Moment 'before'
        $protectedBefore = @(Get-ProtectedFileSnapshots -Paths $protectedPaths -Key $hmacKey)
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'protected-files-before.json') -Value $protectedBefore

        $firstIncompletePhase = 'shim-build'
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'shim-source-metadata.json') -Value ([ordered]@{
            source_relative_path = 'scripts/yt-dlp-import-delete-shim.rs'
            source_sha256 = (Get-FileHash -LiteralPath $ShimSource -Algorithm SHA256).Hash
        })
        $shimExe = Join-Path $shimDir 'yt-dlp.exe'
        $rustc = Get-Command rustc.exe -CommandType Application | Select-Object -First 1
        $shimCompileExit = Invoke-ExternalCaptured -FilePath ([string]$rustc.Source) -Arguments @(
            '--edition', '2021', $ShimSource, '-o', $shimExe
        ) -WorkingDirectory $RepoRoot -StdoutPath (Join-Path $evidenceRoot 'shim-build.stdout.log') `
            -StderrPath (Join-Path $evidenceRoot 'shim-build.stderr.log')
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'shim-executable-metadata.json') -Value ([ordered]@{
            executable_sha256 = (Get-FileHash -LiteralPath $shimExe -Algorithm SHA256).Hash
            executable_size = [int64](Get-Item -LiteralPath $shimExe).Length
            compile_exit = $shimCompileExit
        })

        $firstIncompletePhase = 'application-build'
        $buildStatus = 'IN PROGRESS'
        $buildStart = (Get-Date).ToUniversalTime()
        $npm = Get-Command npm.cmd -CommandType Application | Select-Object -First 1
        $buildExit = Invoke-ExternalCaptured -FilePath ([string]$npm.Source) -Arguments @('run', 'harness:build') `
            -WorkingDirectory $RepoRoot -StdoutPath (Join-Path $evidenceRoot 'build.stdout.log') `
            -StderrPath (Join-Path $evidenceRoot 'build.stderr.log')
        $buildEnd = (Get-Date).ToUniversalTime()
        $binaryPath = Join-Path $RepoRoot 'src-tauri\target\debug\ytm-free.exe'
        if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
            throw 'UI-AUTOMATION-PATH-NOT-AVAILABLE: debug executable absent after build'
        }
        $binary = Get-Item -LiteralPath $binaryPath
        if ($binary.LastWriteTimeUtc -lt $buildStart) {
            throw 'UI-AUTOMATION-PATH-NOT-AVAILABLE: binary predates build start'
        }
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'build-provenance.json') -Value ([ordered]@{
            build_start_utc = $buildStart.ToString('o')
            build_end_utc = $buildEnd.ToString('o')
            build_exit = $buildExit
            APP_BASELINE_SHA = $preflight.git.APP_BASELINE_SHA
            HARNESS_HEAD_SHA = $preflight.git.HARNESS_HEAD_SHA
            ORIGIN_MAIN_SHA = $preflight.git.ORIGIN_MAIN_SHA
            HARNESS_MERGE_BASE_SHA = $preflight.git.HARNESS_MERGE_BASE_SHA
            HARNESS_DELTA_PATHS = $preflight.git.HARNESS_DELTA_PATHS
            HARNESS_COMMIT_COUNT = $preflight.git.HARNESS_COMMIT_COUNT
            binary_path = 'src-tauri/target/debug/ytm-free.exe'
            binary_size = [int64]$binary.Length
            binary_last_write_utc = $binary.LastWriteTimeUtc.ToString('o')
            binary_sha256 = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash
        })
        $buildStatus = 'PASS'

        $firstIncompletePhase = 'wdio-launch-plan'
        $createLaunchPlan = New-WdioLaunchPlan -Phase 'create'
        $restartLaunchPlan = New-WdioLaunchPlan -Phase 'restart'
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'wdio-launch-plans.json') -Value ([ordered]@{
            create = [ordered]@{
                file_name = Split-Path -Leaf $createLaunchPlan.FilePath
                file_path_type = $createLaunchPlan.FilePath.GetType().FullName
                argument_list_type = $createLaunchPlan.ArgumentList.GetType().FullName
                phase = $createLaunchPlan.Phase
                spec_relative_path = 'tests/e2e/import-delete-runtime.spec.ts'
            }
            restart = [ordered]@{
                file_name = Split-Path -Leaf $restartLaunchPlan.FilePath
                file_path_type = $restartLaunchPlan.FilePath.GetType().FullName
                argument_list_type = $restartLaunchPlan.ArgumentList.GetType().FullName
                phase = $restartLaunchPlan.Phase
                spec_relative_path = 'tests/e2e/import-delete-runtime.spec.ts'
            }
        })

        $browserArguments = '--host-resolver-rules="MAP * 127.0.0.1, EXCLUDE localhost" --disable-background-networking'
        $environmentValues = [ordered]@{
            PATH = $shimDir + [IO.Path]::PathSeparator + $env:PATH
            TEMP = $processTemp
            TMP = $processTemp
            YTM_FREE_DATA_DIR = $dataDir
            YTM_FREE_SPOTIFY_DIR = $spotifyDir
            WEBVIEW2_USER_DATA_FOLDER = $webViewDataDir
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $browserArguments
            EVIDENCE_ROOT = $createEvidence
            WDIO_EMBEDDED_PORT = [string]$EmbeddedPort
            TAURI_WEBDRIVER_PORT = [string]$EmbeddedPort
            IMPORT_DELETE_PHASE = 'create'
            RUN_TOKEN = $runToken
            PLAYLIST_NAME = $playlistName
            FIXTURE_STEM = $fixtureStem
        }
        $environmentBefore = Set-ProcessEnvironment -Values $environmentValues
        $browserArgumentsReadBack = [Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', 'Process')
        if ($browserArgumentsReadBack -ne $browserArguments) {
            throw 'WEBVIEW2-NETWORK-ISOLATION-NOT-AVAILABLE'
        }
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'controlled-environment-readback.json') -Value ([ordered]@{
            required_variable_names = $RequiredEnvironmentNames
            webview2_additional_browser_arguments = $browserArgumentsReadBack
            full_environment_logged = $false
        })

        $firstIncompletePhase = 'wdio-create'
        $applicationLaunchStatus = 'CREATE ATTEMPTED'
        $wdioStatus = 'CREATE IN PROGRESS'
        $createStatus = 'IN PROGRESS'
        $createResult = Start-WdioPhase -LaunchPlan $createLaunchPlan -PhaseEvidenceRoot $createEvidence -WebViewDataDir $webViewDataDir
        $createStatus = 'PASS'
        $applicationLaunchStatus = 'CREATE PASS'
        $wdioStatus = 'CREATE PASS'

        $firstIncompletePhase = 'wdio-restart'
        $applicationLaunchStatus = 'RESTART ATTEMPTED'
        $wdioStatus = 'RESTART IN PROGRESS'
        $restartStatus = 'IN PROGRESS'
        $restartResult = Start-WdioPhase -LaunchPlan $restartLaunchPlan -PhaseEvidenceRoot $restartEvidence -WebViewDataDir $webViewDataDir
        $restartStatus = 'PASS'
        $applicationLaunchStatus = 'PASS'
        $wdioStatus = 'PASS'

        $firstIncompletePhase = 'runtime-evidence-validation'
        $createDetails = Get-Content -LiteralPath (Join-Path $createEvidence 'create-state.json') -Raw | ConvertFrom-Json
        $restartDetails = Get-Content -LiteralPath (Join-Path $restartEvidence 'restart-state.json') -Raw | ConvertFrom-Json
        $createOllamaState = Assert-OllamaStateEvidenceSchema -State $createDetails -Phase 'create'
        $restartOllamaState = Assert-OllamaStateEvidenceSchema -State $restartDetails -Phase 'restart'
        if ($createOllamaState.ollama_enabled -or $restartOllamaState.ollama_enabled) {
            throw 'OLLAMA-INVOCATION-DETECTED'
        }
        if ($createOllamaState.ollama_url -ne $restartOllamaState.ollama_url) {
            throw 'OLLAMA-STATE-EVIDENCE-SCHEMA-MISMATCH'
        }
        if ($createDetails.runtime_process_id -eq $restartDetails.runtime_process_id) {
            throw 'Restart process identity was not fresh'
        }

        $allConnections = @($createResult.connections + $restartResult.connections)
        $ollamaUrl = [string]$createOllamaState.ollama_url
        if (-not [string]::IsNullOrWhiteSpace($ollamaUrl)) {
            $ollamaUri = [Uri]$ollamaUrl
            $ollamaPort = if ($ollamaUri.IsDefaultPort) { if ($ollamaUri.Scheme -eq 'https') { 443 } else { 80 } } else { $ollamaUri.Port }
            $ollamaConnections = @($allConnections | Where-Object {
                $_.remote_port -eq $ollamaPort -and $_.remote_address -in @('127.0.0.1', '::1')
            })
            if ($ollamaConnections.Count -ne 0) { throw 'OLLAMA-INVOCATION-DETECTED' }
        }

        $ledgerPath = Join-Path $createEvidence 'yt-dlp-invocations.jsonl'
        if (-not (Test-Path -LiteralPath $ledgerPath -PathType Leaf)) {
            throw 'YT_DLP-DETERMINISM-NOT-AVAILABLE: shim ledger missing'
        }
        $ledger = @(Get-Content -LiteralPath $ledgerPath | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
        if (@($ledger | Where-Object { $_.classification -eq 'unexpected' }).Count -ne 0) {
            throw 'UNEXPECTED-YT-DLP-INVOCATION'
        }
        foreach ($classification in @('search-alpha', 'search-beta')) {
            if (@($ledger | Where-Object { $_.classification -eq $classification }).Count -ne 1) {
                throw "YT_DLP-DETERMINISM-NOT-AVAILABLE: $classification cardinality"
            }
        }

        Invoke-LogicalSnapshotFromHelper -DataDir $dataDir -OutputPath (Join-Path $evidenceRoot 'final-logical-snapshot.json')
        $firstIncompletePhase = 'complete'
    }
    catch {
        if ($firstIncompletePhase -eq 'application-build') { $buildStatus = 'FAILED' }
        if ($firstIncompletePhase -eq 'wdio-create') {
            $createStatus = 'FAILED'
            $wdioStatus = 'FAILED'
        }
        if ($firstIncompletePhase -eq 'wdio-restart') {
            $restartStatus = 'FAILED'
            $wdioStatus = 'FAILED'
        }
        $primaryFailure = New-PrimaryFailureRecord -ErrorRecord $_ -Phase $firstIncompletePhase
        try {
            Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'primary-failure.json') -Value $primaryFailure
        }
        catch {
            Write-Warning 'PRIMARY-FAILURE-EVIDENCE-WRITE-FAILED'
        }
    }
    finally {
        try {
            $finalization = Invoke-HarnessFinalization -EvidenceRoot $evidenceRoot -EvidencePrefix $evidencePrefix `
                -RuntimeRoot $runtimeRoot -RuntimePrefix $runtimePrefix -RunToken $runToken -HmacKey $hmacKey `
                -PersonalRoots $personalRoots -PrivacyBefore $privacyBefore -ProtectedPaths $protectedPaths `
                -ProtectedBefore $protectedBefore -EnvironmentBefore $environmentBefore `
                -OwnedProcessIdentities @($Script:OwnedProcessIdentities) -PrimaryFailure $primaryFailure `
                -Context ([ordered]@{
                    first_incomplete_phase = $firstIncompletePhase
                    app_baseline_sha = $preflight.git.APP_BASELINE_SHA
                    harness_head_sha = $preflight.git.HARNESS_HEAD_SHA
                    build_status = $buildStatus
                    application_launch_status = $applicationLaunchStatus
                    wdio_status = $wdioStatus
                    create_status = $createStatus
                    restart_status = $restartStatus
                })
        }
        catch {
            Write-Warning ('FAILURE-FINALIZATION-INCOMPLETE: ' + (ConvertTo-RedactedText -Value $_.Exception.Message))
        }
        [Array]::Clear($hmacKey, 0, $hmacKey.Length)
    }

    Write-Output "EVIDENCE_ROOT=$evidenceRoot"
    if ($null -ne $finalization) {
        Write-Output "FINAL_EVIDENCE_INVENTORY_SHA256:$($finalization.inventory_sha256)"
        Write-Output "FINAL_MANIFEST_SHA256:$($finalization.manifest_sha256)"
        Write-Output "FINAL_EVIDENCE_INVENTORY_EXCLUDES:$($finalization.inventory_exclusions -join ',')"
    }
    if ($null -ne $primaryFailure) {
        throw "$($primaryFailure.failure_code): $($primaryFailure.message_redacted)"
    }
    if ($null -eq $finalization -or $finalization.finalization_failures.Count -ne 0) {
        throw 'FAILURE-FINALIZATION-INCOMPLETE'
    }
}

Set-Location $RepoRoot
$selectedModes = @(@($ContractValidateOnly, $PreflightOnly, $LaunchPlanValidateOnly) | Where-Object { $_ })
if ($selectedModes.Count -gt 1) {
    throw 'ContractValidateOnly, PreflightOnly, and LaunchPlanValidateOnly are mutually exclusive'
}

if ($ContractValidateOnly) {
    $result = Invoke-ContractValidation
    Write-Output "APP_BASELINE_CONSTANT: $($result.APP_BASELINE_CONSTANT)"
    Write-Output "ALLOWED_HARNESS_PATH_SET: $($result.ALLOWED_HARNESS_PATH_SET)"
    Write-Output "HEAD_DESCENDS_FROM_APP_BASELINE: $($result.HEAD_DESCENDS_FROM_APP_BASELINE)"
    Write-Output "MERGE_BASE_MATCH: $($result.MERGE_BASE_MATCH)"
    Write-Output "NO_HARNESS_MERGE_COMMITS: $($result.NO_HARNESS_MERGE_COMMITS)"
    Write-Output "HARNESS_DELTA_SCOPE: $($result.HARNESS_DELTA_SCOPE)"
    Write-Output "OLLAMA_STATE_SCHEMA_CONTRACT: $($result.OLLAMA_STATE_SCHEMA_CONTRACT)"
    Write-Output "SAFE_TREE_NORMAL_CASE: $($result.SAFE_TREE_NORMAL_CASE)"
    Write-Output "SNAPSHOT_REPARSE_REJECTION: $($result.SNAPSHOT_REPARSE_REJECTION)"
    Write-Output "CLEANUP_REPARSE_REJECTION: $($result.CLEANUP_REPARSE_REJECTION)"
    Write-Output "EXTERNAL_REPARSE_TARGET_UNCHANGED: $($result.EXTERNAL_REPARSE_TARGET_UNCHANGED)"
    Write-Output "SYNTHETIC_PRIMARY_FAILURE_PRESERVED:$($result.SYNTHETIC_PRIMARY_FAILURE_PRESERVED)"
    Write-Output "SYNTHETIC_PRIVACY_AFTER_CAPTURED:$($result.SYNTHETIC_PRIVACY_AFTER_CAPTURED)"
    Write-Output "SYNTHETIC_PRIVACY_EQUALITY:$($result.SYNTHETIC_PRIVACY_EQUALITY)"
    Write-Output "SYNTHETIC_ENVIRONMENT_RESTORED:$($result.SYNTHETIC_ENVIRONMENT_RESTORED)"
    Write-Output "SYNTHETIC_RUNTIME_ROOT_REMOVED:$($result.SYNTHETIC_RUNTIME_ROOT_REMOVED)"
    Write-Output "SYNTHETIC_EVIDENCE_ROOT_PRESERVED:$($result.SYNTHETIC_EVIDENCE_ROOT_PRESERVED)"
    Write-Output "SYNTHETIC_CLEANUP_LEDGER:$($result.SYNTHETIC_CLEANUP_LEDGER)"
    Write-Output "SYNTHETIC_FINAL_INVENTORY:$($result.SYNTHETIC_FINAL_INVENTORY)"
    Write-Output "SYNTHETIC_FAILED_MANIFEST:$($result.SYNTHETIC_FAILED_MANIFEST)"
    Write-Output "SYNTHETIC_FINALIZATION_FAILURE_COUNT:$($result.SYNTHETIC_FINALIZATION_FAILURE_COUNT)"
    $result | ConvertTo-Json -Depth 20
    Write-NonClaims
    exit 0
}

if ($LaunchPlanValidateOnly) {
    $result = Invoke-LaunchPlanValidation
    Write-Output "CREATE_FILEPATH_TYPE:$($result.CREATE_FILEPATH_TYPE)"
    Write-Output "RESTART_FILEPATH_TYPE:$($result.RESTART_FILEPATH_TYPE)"
    Write-Output "CREATE_FILEPATH_CARDINALITY:$($result.CREATE_FILEPATH_CARDINALITY)"
    Write-Output "RESTART_FILEPATH_CARDINALITY:$($result.RESTART_FILEPATH_CARDINALITY)"
    Write-Output "CREATE_SPEC_PATH_MATCH:$($result.CREATE_SPEC_PATH_MATCH)"
    Write-Output "RESTART_SPEC_PATH_MATCH:$($result.RESTART_SPEC_PATH_MATCH)"
    Write-Output "CREATE_ARGUMENT_LIST_TYPE:$($result.CREATE_ARGUMENT_LIST_TYPE)"
    Write-Output "RESTART_ARGUMENT_LIST_TYPE:$($result.RESTART_ARGUMENT_LIST_TYPE)"
    Write-Output "START_PROCESS_CALLED:$($result.START_PROCESS_CALLED)"
    Write-NonClaims
    exit 0
}

if ($PreflightOnly) {
    $result = Invoke-SafePreflight
    $result | ConvertTo-Json -Depth 20
    Write-NonClaims
    exit 0
}

Invoke-FullRuntimeHarness
