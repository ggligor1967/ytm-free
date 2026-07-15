[CmdletBinding()]
param(
    [switch]$ContractValidateOnly,
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedBaseline = 'b3200d4f8d4187bc25cc1f1d49d55bcbcf277212'
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

$AuthorizedPaths = @(
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
    'DIRTY-TRACKED-WORKTREE',
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
    'PRIVACY-SNAPSHOT-COMPARABILITY-LOST'
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

function Assert-GitContext {
    $branch = (Invoke-GitRead -Arguments @('branch', '--show-current') | Select-Object -First 1).Trim()
    $head = (Invoke-GitRead -Arguments @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    $originMain = (Invoke-GitRead -Arguments @('rev-parse', 'origin/main') | Select-Object -First 1).Trim()
    if ($branch -ne $ExpectedBranch -or $head -ne $ExpectedBaseline -or $originMain -ne $ExpectedBaseline) {
        throw "BASELINE-DRIFT: branch=$branch head=$head origin_main=$originMain"
    }

    $unstaged = @(Invoke-GitRead -Arguments @('diff', '--name-only') | Where-Object { $_.Trim() })
    if ($unstaged.Count -ne 0) {
        throw 'DIRTY-TRACKED-WORKTREE: unstaged tracked changes exist'
    }
    $cached = @(Invoke-GitRead -Arguments @('diff', '--cached', '--name-only') |
        Where-Object { $_.Trim() } |
        ForEach-Object { Normalize-RepositoryPath -Value $_ })
    if ($cached.Count -ne 0) {
        $expectedCached = @($AuthorizedPaths | Sort-Object)
        $actualCached = @($cached | Sort-Object)
        if (($actualCached -join "`n") -ne ($expectedCached -join "`n")) {
            throw 'DIRTY-TRACKED-WORKTREE: staged paths differ from the authorized harness patch'
        }
        $cachedStatus = @(Invoke-GitRead -Arguments @('diff', '--cached', '--name-status'))
        foreach ($line in $cachedStatus) {
            $parts = $line -split "`t", 2
            if ($parts.Count -ne 2 -or $parts[0] -ne 'A' -or
                $AuthorizedPaths -notcontains (Normalize-RepositoryPath -Value $parts[1])) {
                throw "DIRTY-TRACKED-WORKTREE: staged entry is not an authorized addition: $line"
            }
        }
    }

    $status = @(Invoke-GitRead -Arguments @('status', '--porcelain=v1', '--untracked-files=all'))
    foreach ($line in $status) {
        if ($line.StartsWith('?? ')) {
            $path = Normalize-RepositoryPath -Value $line.Substring(3)
            if ($ProtectedUntrackedPaths -notcontains $path) {
                throw "SCOPE-EXPANSION-REQUIRED: unexpected untracked path $path"
            }
            continue
        }
        if (-not $line.StartsWith('A  ')) {
            throw "DIRTY-TRACKED-WORKTREE: $line"
        }
        $path = Normalize-RepositoryPath -Value $line.Substring(3)
        if ($AuthorizedPaths -notcontains $path) {
            throw "DIRTY-TRACKED-WORKTREE: unauthorized staged path $path"
        }
    }
    return [ordered]@{ branch = $branch; head = $head; origin_main = $originMain; status = $status }
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

    $validationToken = 'contractvalidation-00000000'
    $alpha = '{"id":"s6R3B1A001","title":"Step6R3B1 Alpha ' + $validationToken + '","channel":"Step6R3B1 Synthetic Artist","duration":123,"thumbnail":"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="}'
    $beta = '{"id":"s6R3B1B001","title":"Step6R3B1 Beta ' + $validationToken + '","channel":"Step6R3B1 Synthetic Artist","duration":234,"thumbnail":"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="}'
    $null = $alpha | ConvertFrom-Json
    $null = $beta | ConvertFrom-Json

    if ($ExpectedBaseline -ne 'b3200d4f8d4187bc25cc1f1d49d55bcbcf277212' -or
        $ExpectedBranch -ne 'feat/import-delete-runtime-harness' -or
        $EmbeddedPort -ne 4447 -or $StreamPort -ne 3456) {
        throw 'Contract constants do not match Step-6R.3B2A'
    }
    $safeTreeValidation = Invoke-SafeTreeContractValidation
    return [ordered]@{
        result = ('PASS ' + [char]0x2014 + ' CONTRACT-VALIDATED')
        baseline = $ExpectedBaseline
        branch = $ExpectedBranch
        ports = @($StreamPort, $EmbeddedPort)
        exact_yt_dlp_argv_classes = @('version', 'search-alpha', 'search-beta')
        exact_outputs_parse = $true
        required_environment_names = $RequiredEnvironmentNames
        stop_conditions = $StopConditions
        OLLAMA_STATE_SCHEMA_CONTRACT = 'PASS'
        SAFE_TREE_NORMAL_CASE = $safeTreeValidation.SAFE_TREE_NORMAL_CASE
        SNAPSHOT_REPARSE_REJECTION = $safeTreeValidation.SNAPSHOT_REPARSE_REJECTION
        CLEANUP_REPARSE_REJECTION = $safeTreeValidation.CLEANUP_REPARSE_REJECTION
        EXTERNAL_REPARSE_TARGET_UNCHANGED = $safeTreeValidation.EXTERNAL_REPARSE_TARGET_UNCHANGED
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

function Start-WdioPhase {
    param(
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][string]$PhaseEvidenceRoot,
        [Parameter(Mandatory = $true)][string]$WebViewDataDir
    )
    $env:IMPORT_DELETE_PHASE = $Phase
    $env:EVIDENCE_ROOT = $PhaseEvidenceRoot
    $stdout = Join-Path $PhaseEvidenceRoot 'wdio.stdout.log'
    $stderr = Join-Path $PhaseEvidenceRoot 'wdio.stderr.log'
    $npx = (Get-Command npx.cmd -CommandType Application).Source
    $process = Start-Process -FilePath $npx -ArgumentList @(
        'wdio', 'run', 'wdio.conf.ts', '--spec', 'tests/e2e/import-delete-runtime.spec.ts'
    ) -WorkingDirectory $RepoRoot -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden -PassThru
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
    foreach ($name in $Previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $Previous[$name], 'Process')
    }
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
    param([Parameter(Mandatory = $true)][string]$EvidenceRoot)
    $entries = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse -Force | Sort-Object FullName)) {
        $entries += [ordered]@{
            relative_path = (Get-RelativePathPortable -BasePath $EvidenceRoot -ChildPath $file.FullName).Replace('\', '/')
            size = [int64]$file.Length
            sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        }
    }
    return $entries
}

function Invoke-FullRuntimeHarness {
    $preflight = Invoke-SafePreflight
    $runToken = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8).ToLowerInvariant()
    $evidenceRoot = Join-Path $env:TEMP "ytm-free-import-delete-evidence-b3200d4f8d41-$runToken"
    $runtimeRoot = Join-Path $env:TEMP "ytm-free-import-delete-runtime-$runToken"
    $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix 'ytm-free-import-delete-evidence-b3200d4f8d41-' -Token $runToken
    $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix 'ytm-free-import-delete-runtime-' -Token $runToken

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
    $privacyAfter = $null
    $personalRoots = Get-PersonalSurfaceRoots
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

        $fixtureStem = "step6r3b1-import-$runToken"
        $fixtureName = "$fixtureStem.csv"
        $playlistName = "Step6R3B1 Playlist $runToken"
        $fixture = @(
            'Spotify ID,Track Name,Album Name,Artist Name(s),Duration (ms)',
            "spotify:track:step6r3b1alpha,Step6R3B1 Alpha $runToken,Step6R3B1 Synthetic Album,Step6R3B1 Synthetic Artist,123000",
            "spotify:track:step6r3b1beta,Step6R3B1 Beta $runToken,Step6R3B1 Synthetic Album,Step6R3B1 Synthetic Artist,234000"
        ) -join "`r`n"
        Write-Utf8NoBom -LiteralPath (Join-Path $spotifyDir $fixtureName) -Value ($fixture + "`r`n")

        $privacyBefore = Capture-PrivacySnapshots -Roots $personalRoots -Key $hmacKey -EvidenceRoot $evidenceRoot -Moment 'before'

        $shimExe = Join-Path $shimDir 'yt-dlp.exe'
        Invoke-ExternalCaptured -FilePath (Get-Command rustc.exe).Source -Arguments @(
            '--edition', '2021', $ShimSource, '-o', $shimExe
        ) -WorkingDirectory $RepoRoot -StdoutPath (Join-Path $evidenceRoot 'shim-build.stdout.log') `
            -StderrPath (Join-Path $evidenceRoot 'shim-build.stderr.log') | Out-Null

        $buildStart = (Get-Date).ToUniversalTime()
        $buildExit = Invoke-ExternalCaptured -FilePath (Get-Command npm.cmd).Source -Arguments @('run', 'harness:build') `
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
            baseline_sha = $ExpectedBaseline
            binary_path = 'src-tauri/target/debug/ytm-free.exe'
            binary_size = [int64]$binary.Length
            binary_last_write_utc = $binary.LastWriteTimeUtc.ToString('o')
            binary_sha256 = (Get-FileHash -LiteralPath $binaryPath -Algorithm SHA256).Hash
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

        $createResult = Start-WdioPhase -Phase 'create' -PhaseEvidenceRoot $createEvidence -WebViewDataDir $webViewDataDir
        $restartResult = Start-WdioPhase -Phase 'restart' -PhaseEvidenceRoot $restartEvidence -WebViewDataDir $webViewDataDir

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
        $privacyAfter = Capture-PrivacySnapshots -Roots $personalRoots -Key $hmacKey -EvidenceRoot $evidenceRoot -Moment 'after'
        foreach ($surface in $personalRoots.Keys) {
            $beforeJson = $privacyBefore[$surface] | ConvertTo-Json -Depth 10 -Compress
            $afterJson = $privacyAfter[$surface] | ConvertTo-Json -Depth 10 -Compress
            if ($beforeJson -ne $afterJson) {
                if ($surface -eq 'downloads' -or $surface -eq 'music') {
                    throw 'DOWNLOAD-ISOLATION-NOT-PROVEN'
                }
                throw 'APPDATA-ISOLATION-NOT-PROVEN'
            }
        }

        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'privacy-comparison.json') -Value ([ordered]@{
            music_unchanged = $true
            downloads_unchanged = $true
            roaming_appdata_unchanged = $true
            local_appdata_unchanged = $true
            comparison_key_persisted = $false
        })

        $inventory = @(Get-EvidenceInventory -EvidenceRoot $evidenceRoot)
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'manifest.json') -Value ([ordered]@{
            result = ('PASS ' + [char]0x2014 + ' IMPORT-DELETE-RESTART-RUNTIME-PROVEN')
            baseline_sha = $ExpectedBaseline
            run_token = $runToken
            evidence_root_identity = 'new-owned-temp-root'
            runtime_root_cleanup_required = $true
            appdata_unchanged = $true
            downloads_unchanged = $true
            hmac_key_persisted = $false
            create_runtime_pid = $createDetails.runtime_process_id
            restart_runtime_pid = $restartDetails.runtime_process_id
            evidence_inventory = $inventory
            preflight = $preflight
        })
        Write-Output "EVIDENCE_ROOT=$evidenceRoot"
    }
    finally {
        if ($null -ne $environmentBefore) {
            Restore-ProcessEnvironment -Previous $environmentBefore
        }
        foreach ($identity in @($Script:OwnedProcessIdentities | Sort-Object process_id -Descending -Unique)) {
            Stop-OwnedProcessIdentity -Identity $identity
        }
        if (Test-Path -LiteralPath $runtimeRoot) {
            $safeRuntime = Assert-NoReparseDescendant -LiteralPath $runtimeRoot `
                -Prefix 'ytm-free-import-delete-runtime-' -Token $runToken
            Remove-Item -LiteralPath $safeRuntime -Recurse -Force
        }
        [Array]::Clear($hmacKey, 0, $hmacKey.Length)
    }
}

Set-Location $RepoRoot
if ($ContractValidateOnly -and $PreflightOnly) {
    throw 'ContractValidateOnly and PreflightOnly are mutually exclusive'
}

if ($ContractValidateOnly) {
    $result = Invoke-ContractValidation
    Write-Output "OLLAMA_STATE_SCHEMA_CONTRACT: $($result.OLLAMA_STATE_SCHEMA_CONTRACT)"
    Write-Output "SAFE_TREE_NORMAL_CASE: $($result.SAFE_TREE_NORMAL_CASE)"
    Write-Output "SNAPSHOT_REPARSE_REJECTION: $($result.SNAPSHOT_REPARSE_REJECTION)"
    Write-Output "CLEANUP_REPARSE_REJECTION: $($result.CLEANUP_REPARSE_REJECTION)"
    Write-Output "EXTERNAL_REPARSE_TARGET_UNCHANGED: $($result.EXTERNAL_REPARSE_TARGET_UNCHANGED)"
    $result | ConvertTo-Json -Depth 20
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
