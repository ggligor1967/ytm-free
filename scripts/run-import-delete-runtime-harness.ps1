[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedProductSha,
    [string]$ExpectedProductBranch = 'main',
    [switch]$HashCompatibilityValidateOnly,
    [switch]$ContractValidateOnly,
    [switch]$PreflightOnly,
    [switch]$LaunchPlanValidateOnly,
    [switch]$MonitorAndFinalizationValidateOnly,
    [switch]$ExternalCommandValidateOnly,
    [switch]$WebViewIsolationValidateOnly,
    [ValidateSet('Enforce', 'Observe')]
    [string]$NetworkGateMode = 'Enforce'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$EmbeddedPort = 4447
$StreamPort = 3456
$Script:OwnedProcessIdentities = @()
$Script:OwnedProcessObjects = [Collections.Generic.List[object]]::new()
$Script:LogCaptures = [Collections.Generic.List[object]]::new()
$Script:ActiveEvidenceRoot = $null
$Script:ActiveRuntimeRoot = $null
$Script:AdditionalCleanupPorts = @()
$Script:CachedUsernameRedactionValues = $null
$Script:RuntimeChildExitCodes = [ordered]@{}
$Script:UsernameRedactionLedger = [ordered]@{
    total_count = 0
    non_path_context_count = 0
    non_path_categories = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
}

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$HarnessPath = Join-Path $RepoRoot 'scripts\run-import-delete-runtime-harness.ps1'
$ShimSource = Join-Path $RepoRoot 'scripts\yt-dlp-import-delete-shim.rs'
$SpecPath = Join-Path $RepoRoot 'tests\e2e\import-delete-runtime.spec.ts'
$WdioConfig = Join-Path $RepoRoot 'wdio.conf.ts'
$ProductionTauriConfig = Join-Path $RepoRoot 'src-tauri\tauri.conf.json'
$WdioTauriConfig = Join-Path $RepoRoot 'src-tauri\tauri.wdio.conf.json'
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
    'WDIO-MONITOR-FAILURE',
    'POWERSHELL-AUTOMATIC-VARIABLE-COLLISION',
    'CLEAR-PERSONAL-PATH-IN-EVIDENCE',
    'EVIDENCE-FILE-UNREADABLE',
    'SANITIZED-LOG-PUBLICATION-FAILED',
    'RAW-LOG-CLEANUP-FAILED',
    'RUNTIME-FILE-LOCK-PERSISTED',
    'EXTERNAL-COMMAND-WAIT-TIMEOUT',
    'EXTERNAL-COMMAND-NOT-EXITED',
    'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE',
    'EXTERNAL-COMMAND-EXITCODE-TYPE-MISMATCH',
    'EXTERNAL-COMMAND-FAILED',
    'TAURI-CONFIG-OVERRIDE-UNAVAILABLE',
    'TEMP-TAURI-CONFIG-INVALID',
    'DENY-PROXY-OWNERSHIP-INVALID',
    'BROWSER-ADDITIONAL-ARGS-NOT-APPLIED',
    'SYNTHETIC-WDIO-PRELAUNCH-FAILURE',
    'FAILURE-FINALIZATION-INCOMPLETE'
)

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)]
        [AllowNull()]
        [AllowEmptyString()]
        [object]$Value
    )
    if ($null -eq $Value) {
        throw 'WRITE-UTF8-VALUE-NULL'
    }
    if ($Value -isnot [string]) {
        throw 'WRITE-UTF8-VALUE-TYPE-MISMATCH'
    }
    [IO.File]::WriteAllText($LiteralPath, [string]$Value, [Text.UTF8Encoding]::new($false))
}

function Get-Sha256 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath
    )

    $resolvedPath = (
        Resolve-Path `
            -LiteralPath $LiteralPath `
            -ErrorAction Stop
    ).ProviderPath

    $algorithm = [Security.Cryptography.SHA256]::Create()

    if ($null -eq $algorithm) {
        throw 'SHA256-PROVIDER-CREATION-FAILED'
    }

    $stream = [IO.File]::Open(
        $resolvedPath,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::Read
    )

    try {
        $hashBytes = $algorithm.ComputeHash($stream)

        return (
            [BitConverter]::ToString($hashBytes)
        ).Replace('-', '')
    }
    finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)]$Value,
        [int]$Depth = 20
    )
    Write-Utf8NoBom -LiteralPath $LiteralPath -Value (($Value | ConvertTo-Json -Depth $Depth) + [Environment]::NewLine)
}

function Invoke-HashCompatibilityValidation {
    $runToken = 'hash-' + [guid]::NewGuid().ToString('N')
    $validationPrefix = 'ytm-free-hash-validation-'
    $validationRoot = Join-Path $env:TEMP ($validationPrefix + $runToken)
    $validationCreated = $false
    $validationRemoved = $false
    $result = $null

    try {
        $validationRoot = New-OwnedRoot -LiteralPath $validationRoot -Prefix $validationPrefix -Token $runToken
        $validationCreated = $true

        $asciiPath = Join-Path $validationRoot 'ascii-abc.bin'
        $emptyPath = Join-Path $validationRoot 'empty.bin'
        $binaryPath = Join-Path $validationRoot 'binary.bin'
        [IO.File]::WriteAllBytes($asciiPath, [Text.Encoding]::ASCII.GetBytes('abc'))
        [IO.File]::WriteAllBytes($emptyPath, [byte[]]@())
        $binaryBytes = [byte[]](0x00, 0x01, 0x02, 0x7F, 0x80, 0xFE, 0xFF)
        [IO.File]::WriteAllBytes($binaryPath, $binaryBytes)

        $asciiExpected = 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD'
        $emptyExpected = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855'
        $independentAlgorithm = [Security.Cryptography.SHA256]::Create()
        if ($null -eq $independentAlgorithm) { throw 'SHA256-PROVIDER-CREATION-FAILED' }
        try {
            $binaryExpected = ([BitConverter]::ToString(
                $independentAlgorithm.ComputeHash($binaryBytes)
            )).Replace('-', '')
        }
        finally {
            $independentAlgorithm.Dispose()
        }

        $asciiFirst = Get-Sha256 -LiteralPath $asciiPath
        $asciiSecond = Get-Sha256 -LiteralPath $asciiPath
        $emptyFirst = Get-Sha256 -LiteralPath $emptyPath
        $emptySecond = Get-Sha256 -LiteralPath $emptyPath
        $binaryFirst = Get-Sha256 -LiteralPath $binaryPath
        $binarySecond = Get-Sha256 -LiteralPath $binaryPath

        $allHashes = @(
            $asciiFirst, $asciiSecond, $emptyFirst,
            $emptySecond, $binaryFirst, $binarySecond
        )
        $repeatable = $asciiFirst -ceq $asciiSecond -and
            $emptyFirst -ceq $emptySecond -and $binaryFirst -ceq $binarySecond
        $formatValid = @($allHashes | Where-Object {
            $_ -cnotmatch '^[0-9A-F]{64}$'
        }).Count -eq 0
        if ($asciiFirst -cne $asciiExpected) { throw 'ASCII-ABC-HASH-MISMATCH' }
        if ($emptyFirst -cne $emptyExpected) { throw 'EMPTY-FILE-HASH-MISMATCH' }
        if ($binaryFirst -cne $binaryExpected) { throw 'BINARY-HASH-MISMATCH' }
        if (-not $repeatable) { throw 'HASH-REPEATABILITY-MISMATCH' }
        if (-not $formatValid) { throw 'HASH-OUTPUT-FORMAT-MISMATCH' }

        $result = [ordered]@{
            HASH_IMPLEMENTATION = 'DOTNET-SHA256'
            GET_FILE_HASH_DEPENDENCY = $false
            ASCII_ABC_VECTOR = 'PASS'
            EMPTY_FILE_VECTOR = 'PASS'
            BINARY_VECTOR = 'PASS'
            HASH_REPEATABILITY = 'PASS'
            HASH_OUTPUT_FORMAT = 'PASS'
            APPLICATION_LAUNCHED = $false
            RUNTIME_ROOT_CREATED = $false
        }
    }
    finally {
        if ($validationCreated -and (Test-Path -LiteralPath $validationRoot)) {
            $safeValidationRoot = Assert-NoReparseDescendant -LiteralPath $validationRoot `
                -Prefix $validationPrefix -Token $runToken
            Remove-Item -LiteralPath $safeValidationRoot -Recurse -Force
        }
        $validationRemoved = -not (Test-Path -LiteralPath $validationRoot)
    }

    if (-not $validationRemoved) { throw 'HASH-VALIDATION-ROOT-CLEANUP-FAILED' }
    $result.VALIDATION_ROOT_REMOVED = $true
    return $result
}

function Write-NonClaims {
    Write-Output 'APPLICATION_LAUNCH: NOT RUN'
    Write-Output 'WDIO_RUNTIME: NOT RUN'
    Write-Output 'APPDATA_MUTATION: NOT RUN'
    Write-Output 'APPLICATION_LAUNCHED:False'
    Write-Output 'APPLICATION_RUNTIME_EXECUTED:False'
    Write-Output 'RUNTIME_ATTEMPT_COUNT:0'
    Write-Output 'PERSONAL_SPOTIFY_EXPORT_ACCESSED:False'
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
    $productRemoteRef = "origin/$ExpectedProductBranch"
    $originProductBranch = (Invoke-GitRead -Arguments @('rev-parse', $productRemoteRef) |
        Select-Object -First 1).Trim()
    if ([string]::IsNullOrWhiteSpace($branch) -or $branch -eq $ExpectedProductBranch) {
        throw "HARNESS-BRANCH-MISMATCH: branch=$branch product_branch=$ExpectedProductBranch"
    }
    if ($originMain -ne $ExpectedProductSha -or $originProductBranch -ne $ExpectedProductSha) {
        throw "ORIGIN-MAIN-BASELINE-DRIFT: origin_main=$originMain"
    }

    $identityMode = $null
    $firstParent = $null
    $mergeBase = $ExpectedProductSha
    $commitCount = 0
    if ($head -eq $ExpectedProductSha) {
        $identityMode = 'WORKTREE-INSTRUMENTATION'
    }
    else {
        $firstParent = (Invoke-GitRead -Arguments @('rev-parse', 'HEAD^') | Select-Object -First 1).Trim()
        if ($firstParent -ne $ExpectedProductSha) {
            throw "HARNESS-FIRST-PARENT-MISMATCH: parent=$firstParent expected=$ExpectedProductSha"
        }
        $commitCount = [int]((Invoke-GitRead -Arguments @(
            'rev-list', '--count', "$ExpectedProductSha..HEAD"
        ) | Select-Object -First 1).Trim())
        if ($commitCount -ne 1) {
            throw "HARNESS-COMMIT-COUNT-MISMATCH: count=$commitCount"
        }
        $mergeBase = (Invoke-GitRead -Arguments @('merge-base', 'HEAD', $productRemoteRef) |
            Select-Object -First 1).Trim()
        if ($mergeBase -ne $ExpectedProductSha) {
            throw "HARNESS-MERGE-BASE-MISMATCH: merge_base=$mergeBase"
        }
        $identityMode = 'COMMITTED-INSTRUMENTATION'
    }

    try {
        $null = Invoke-GitRead -Arguments @('merge-base', '--is-ancestor', $ExpectedProductSha, 'HEAD')
    }
    catch {
        throw 'APP-BASELINE-NOT-ANCESTOR'
    }
    $mergeCommits = @(Invoke-GitRead -Arguments @('rev-list', '--merges', "$ExpectedProductSha..HEAD") |
        Where-Object { $_.Trim() })
    if ($mergeCommits.Count -ne 0) {
        throw "HARNESS-MERGE-COMMIT-DETECTED: $($mergeCommits -join ',')"
    }
    $committedDeltaPaths = @(Invoke-GitRead -Arguments @('diff', '--name-only', "$ExpectedProductSha..HEAD") |
        Where-Object { $_.Trim() } |
        ForEach-Object { Normalize-RepositoryPath -Value $_ })
    $worktreeDeltaPaths = @()
    if ($identityMode -eq 'WORKTREE-INSTRUMENTATION') {
        $worktreeTrackedPaths = @(Invoke-GitRead -Arguments @('diff', '--name-only') |
            Where-Object { $_.Trim() } |
            ForEach-Object { Normalize-RepositoryPath -Value $_ })
        $worktreeUntrackedPaths = @(Invoke-GitRead -Arguments @('ls-files', '--others', '--exclude-standard') |
            Where-Object { $_.Trim() } |
            ForEach-Object { Normalize-RepositoryPath -Value $_ })
        $worktreeDeltaPaths = @($worktreeTrackedPaths + $worktreeUntrackedPaths |
            Where-Object { $_ -in $AllowedHarnessPaths })
    }
    $actualDeltaPaths = @($committedDeltaPaths + $worktreeDeltaPaths | Select-Object -Unique)
    $actualSorted = @(Get-OrdinalSortedPaths -Paths $actualDeltaPaths)
    $allowedSorted = @(Get-OrdinalSortedPaths -Paths $AllowedHarnessPaths)
    if (($actualSorted -join "`n") -cne ($allowedSorted -join "`n")) {
        throw "HARNESS-DELTA-SCOPE-MISMATCH: actual=$($actualSorted -join ',')"
    }
    $productSourcePaths = @(Invoke-GitRead -Arguments @(
        'diff', '--name-only', $ExpectedProductSha, '--', 'src', 'src-tauri'
    ) | Where-Object { $_.Trim() })
    $untrackedProductSourcePaths = @(Invoke-GitRead -Arguments @(
        'ls-files', '--others', '--exclude-standard', '--', 'src', 'src-tauri'
    ) | Where-Object { $_.Trim() })
    if (($productSourcePaths.Count + $untrackedProductSourcePaths.Count) -ne 0) {
        throw 'PRODUCT-SOURCE-PARITY-MISMATCH'
    }
    return [ordered]@{
        branch = $branch
        expected_product_branch = $ExpectedProductBranch
        identity_mode = $identityMode
        APP_BASELINE_SHA = $ExpectedProductSha
        HARNESS_HEAD_SHA = $head
        HARNESS_FIRST_PARENT_SHA = $firstParent
        ORIGIN_MAIN_SHA = $originMain
        HARNESS_MERGE_BASE_SHA = $mergeBase
        HARNESS_DELTA_PATHS = $actualSorted
        HARNESS_COMMIT_COUNT = $commitCount
        PRODUCT_SOURCE_CHANGED_PATH_COUNT = 0
    }
}

function Assert-GitContext {
    $identity = Get-HarnessGitIdentity
    $unstaged = @(Invoke-GitRead -Arguments @('diff', '--name-only') | Where-Object { $_.Trim() })
    $unexpectedUnstaged = @($unstaged | ForEach-Object { Normalize-RepositoryPath -Value $_ } |
        Where-Object { $_ -notin $AllowedHarnessPaths })
    if ($unexpectedUnstaged.Count -ne 0 -or
        ($identity.identity_mode -eq 'COMMITTED-INSTRUMENTATION' -and $unstaged.Count -ne 0)) {
        throw 'DIRTY-TRACKED-WORKTREE: unstaged tracked changes exist'
    }
    $cached = @(Invoke-GitRead -Arguments @('diff', '--cached', '--name-only') | Where-Object { $_.Trim() })
    if ($cached.Count -ne 0) {
        throw 'NONEMPTY-STAGING'
    }
    $status = @(Invoke-GitRead -Arguments @('status', '--porcelain=v1', '--untracked-files=all'))
    foreach ($line in $status) {
        $path = Normalize-RepositoryPath -Value $line.Substring(3)
        if (-not $line.StartsWith('?? ')) {
            if ($identity.identity_mode -ne 'WORKTREE-INSTRUMENTATION' -or $path -notin $AllowedHarnessPaths) {
                throw "DIRTY-TRACKED-WORKTREE: $line"
            }
            continue
        }
        $allowedPendingInstrument = $identity.identity_mode -eq 'WORKTREE-INSTRUMENTATION' -and
            $path -in $AllowedHarnessPaths
        if ($ProtectedUntrackedPaths -notcontains $path -and -not $allowedPendingInstrument) {
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
    $contractPorts = @($StreamPort, $EmbeddedPort) + @($Script:AdditionalCleanupPorts | ForEach-Object { [int]$_ })
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
        $_.LocalPort -in $contractPorts
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

function Get-AutomaticVariableWriteCollisions {
    $forbiddenNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($forbiddenName in @(
        'PID', 'HOME', 'Host', 'Error', 'Args', 'Input', 'Matches', 'PSItem', 'This',
        'PSScriptRoot', 'PSCommandPath', 'MyInvocation', 'LASTEXITCODE', 'NestedPromptLevel',
        'StackTrace', 'ExecutionContext', 'ShellId'
    )) {
        $null = $forbiddenNames.Add($forbiddenName)
    }

    $parserTokens = $null
    $parserErrors = $null
    $scriptAst = [Management.Automation.Language.Parser]::ParseFile(
        $HarnessPath,
        [ref]$parserTokens,
        [ref]$parserErrors
    )
    if ($parserErrors.Count -ne 0) {
        throw 'POWERSHELL-PARSE-FAILED-DURING-AUTOMATIC-VARIABLE-AUDIT'
    }

    $writeVariables = @($scriptAst.FindAll({
        param($astNode)
        if ($astNode -isnot [Management.Automation.Language.VariableExpressionAst]) { return $false }
        $parentAst = $astNode.Parent
        if ($parentAst -is [Management.Automation.Language.AssignmentStatementAst] -and
            $parentAst.Left -eq $astNode) { return $true }
        if ($parentAst -is [Management.Automation.Language.ParameterAst] -and
            $parentAst.Name -eq $astNode) { return $true }
        if ($parentAst -is [Management.Automation.Language.ForEachStatementAst] -and
            $parentAst.Variable -eq $astNode) { return $true }
        if ($parentAst -is [Management.Automation.Language.UnaryExpressionAst] -and
            $parentAst.Child -eq $astNode -and
            $parentAst.TokenKind -in @(
                [Management.Automation.Language.TokenKind]::PlusPlus,
                [Management.Automation.Language.TokenKind]::MinusMinus
            )) { return $true }
        return $false
    }, $true))

    $collisions = @()
    foreach ($writeVariable in $writeVariables) {
        $variableName = $writeVariable.VariablePath.UserPath
        if ($forbiddenNames.Contains($variableName)) {
            $collisions += [ordered]@{
                variable_name = $variableName
                line = $writeVariable.Extent.StartLineNumber
                column = $writeVariable.Extent.StartColumnNumber
            }
        }
    }
    return @($collisions | Sort-Object line, column)
}

function Invoke-ContractValidation {
    $requiredFiles = @(
        $HarnessPath,
        $ShimSource,
        $SpecPath,
        $WdioConfig,
        $ProductionTauriConfig,
        $WdioTauriConfig,
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
        'function Write-Utf8NoBom',
        'WRITE-UTF8-VALUE-NULL',
        'primary_failure_present',
        'cleanup-ledger.json',
        'final-evidence-inventory.json',
        'final-manifest.json',
        'final_evidence_inventory_sha256',
        'SYNTHETIC-WDIO-PRELAUNCH-FAILURE',
        'MonitorAndFinalizationValidateOnly',
        'WDIO-MONITOR-FAILURE',
        'CLEAR-PERSONAL-PATH-IN-EVIDENCE',
        'EVIDENCE-FILE-UNREADABLE',
        'RUNTIME-FILE-LOCK-PERSISTED',
        'SANITIZED-LOG-PUBLICATION-FAILED',
        'RAW-LOG-CLEANUP-FAILED',
        'persistently_locked_file_count',
        'finalization_status',
        'evidence_completeness',
        'SYNTHETIC-EMPTY-STDOUT-STDERR',
        'SYNTHETIC-SANITIZED-PUBLICATION-FAILURE'
    )
    Assert-ContainsAll -Text $harness -Label 'external command capture contract' -Values @(
        'function Invoke-ExternalCaptured',
        'function Assert-ExternalCommandSucceeded',
        'ExternalCommandValidateOnly',
        'EXTERNAL-COMMAND-WAIT-TIMEOUT',
        'EXTERNAL-COMMAND-NOT-EXITED',
        'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE',
        'EXTERNAL-COMMAND-EXITCODE-TYPE-MISMATCH',
        'EXTERNAL-COMMAND-FAILED',
        'compile_exit_status',
        'stdout_metadata',
        'stderr_metadata'
    )
    Assert-ContainsAll -Text $harness -Label 'portable hashing and direct exit contract' -Values @(
        'function Get-Sha256',
        'HashCompatibilityValidateOnly',
        'DOTNET-SHA256',
        '$RuntimeChildExitCode = [int]$RuntimeProcess.ExitCode',
        'DIRECT-PROCESS-EXITCODE',
        'function Invoke-WrapperFailureSeparationValidation',
        'WRAPPER_EXIT0_METADATA_FAILURE_TEST',
        'WRAPPER_EXIT1_METADATA_SUCCESS_TEST',
        'WRAPPER_EXIT0_CLEANUP_FAILURE_TEST'
    )
    Assert-ContainsAll -Text $harness -Label 'test-only WebView isolation contract' -Values @(
        'function New-TemporaryTauriConfiguration',
        'function Start-OwnedDenyProxy',
        'function Publish-DenyProxyLedger',
        'WebViewIsolationValidateOnly',
        'additionalBrowserArgs',
        '--proxy-server=http://127.0.0.1:',
        '--proxy-bypass-list=localhost,127.0.0.1,[::1]',
        'OWNED_NON_LOOPBACK_TCP_CONNECTION_COUNT',
        'tauri_config_mode'
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
    if ($ExpectedProductSha -notmatch '^[0-9a-f]{40}$' -or
        [string]::IsNullOrWhiteSpace($ExpectedProductBranch) -or
        $EmbeddedPort -ne 4447 -or $StreamPort -ne 3456) {
        throw 'Contract parameters are invalid'
    }
    if ((@(Get-OrdinalSortedPaths -Paths $AllowedHarnessPaths) -join "`n") -cne
        (@(Get-OrdinalSortedPaths -Paths $expectedAllowedPaths) -join "`n")) {
        throw 'HARNESS-DELTA-SCOPE-MISMATCH'
    }
    $gitIdentity = Get-HarnessGitIdentity
    $parserTokens = $null
    $parserErrors = $null
    $runnerAst = [Management.Automation.Language.Parser]::ParseFile(
        $HarnessPath,
        [ref]$parserTokens,
        [ref]$parserErrors
    )
    if ($parserErrors.Count -ne 0) { throw 'POWERSHELL-PARSER-ERRORS-DETECTED' }
    $runnerCommands = @($runnerAst.FindAll({
        param($node)
        $node -is [Management.Automation.Language.CommandAst]
    }, $true))
    $runnerFunctions = @($runnerAst.FindAll({
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst]
    }, $true))
    $getFileHashCommandAstCount = @($runnerCommands | Where-Object {
        $_.GetCommandName() -eq 'Get-FileHash'
    }).Count
    $utilityModuleImportAstCount = @($runnerCommands | Where-Object {
        $_.GetCommandName() -eq 'Import-Module' -and
        $_.Extent.Text -match 'Microsoft\.PowerShell\.Utility'
    }).Count
    $dotnetSha256HelperCount = @($runnerFunctions | Where-Object {
        $_.Name -eq 'Get-Sha256'
    }).Count
    $utilityModuleVersionAssertionCount = @($runnerAst.FindAll({
        param($node)
        $node -is [Management.Automation.Language.IfStatementAst] -and
        $node.Extent.Text -match '(?i)Microsoft\.PowerShell\.Utility' -and
        $node.Extent.Text -match '(?i)Version'
    }, $true)).Count
    $commandInfoVersionHashGateCount = @($runnerCommands | Where-Object {
        $_.GetCommandName() -eq 'Get-Command' -and
        $_.Extent.Text -match '(?i)Get-FileHash' -and
        $_.Extent.Text -match '(?i)(Version|Source)'
    }).Count
    if ($getFileHashCommandAstCount -ne 0 -or $utilityModuleImportAstCount -ne 0 -or
        $utilityModuleVersionAssertionCount -ne 0 -or $commandInfoVersionHashGateCount -ne 0 -or
        $dotnetSha256HelperCount -ne 1) {
        throw 'PORTABLE-HASHING-AST-CONTRACT-FAILED'
    }
    $automaticVariableCollisions = @(Get-AutomaticVariableWriteCollisions)
    if ($automaticVariableCollisions.Count -ne 0) {
        throw ('POWERSHELL-AUTOMATIC-VARIABLE-COLLISION: ' +
            (($automaticVariableCollisions | ConvertTo-Json -Compress) -join ''))
    }
    $evidenceCompletenessFinalizedAssignmentCount = [regex]::Matches(
        $harness,
        '(?im)evidence_completeness\s*=\s*[''\"]FINALIZED[''\"]'
    ).Count
    if ($evidenceCompletenessFinalizedAssignmentCount -ne 0) {
        throw 'MANIFEST-EVIDENCE-COMPLETENESS-SEMANTICS-INVALID'
    }
    $safeTreeValidation = Invoke-SafeTreeContractValidation
    $syntheticFailureValidation = Invoke-SyntheticFailureFinalizationValidation
    $temporaryConfigValidation = Invoke-TemporaryWebViewConfigValidation
    return [ordered]@{
        result = ('PASS ' + [char]0x2014 + ' CONTRACT-VALIDATED')
        APP_BASELINE_SHA = $gitIdentity.APP_BASELINE_SHA
        HARNESS_HEAD_SHA = $gitIdentity.HARNESS_HEAD_SHA
        ORIGIN_MAIN_SHA = $gitIdentity.ORIGIN_MAIN_SHA
        HARNESS_MERGE_BASE_SHA = $gitIdentity.HARNESS_MERGE_BASE_SHA
        HARNESS_DELTA_PATHS = $gitIdentity.HARNESS_DELTA_PATHS
        HARNESS_COMMIT_COUNT = $gitIdentity.HARNESS_COMMIT_COUNT
        branch = $gitIdentity.branch
        expected_product_branch = $ExpectedProductBranch
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
        AUTOMATIC_VARIABLE_WRITE_COLLISION_COUNT = $automaticVariableCollisions.Count
        GET_FILE_HASH_COMMAND_AST_COUNT = $getFileHashCommandAstCount
        UTILITY_MODULE_IMPORT_AST_COUNT = $utilityModuleImportAstCount
        UTILITY_MODULE_VERSION_ASSERTION_COUNT = $utilityModuleVersionAssertionCount
        COMMANDINFO_VERSION_HASH_GATE_COUNT = $commandInfoVersionHashGateCount
        DOTNET_SHA256_HELPER_COUNT = $dotnetSha256HelperCount
        EVIDENCE_COMPLETENESS_FINALIZED_ASSIGNMENT_COUNT = $evidenceCompletenessFinalizedAssignmentCount
        DEFAULT_WRY_DISABLE_FEATURES_PRESERVED = $temporaryConfigValidation.DEFAULT_WRY_DISABLE_FEATURES_PRESERVED
        PROXY_SERVER_COUNT = $temporaryConfigValidation.PROXY_SERVER_COUNT
        PROXY_BYPASS_COUNT = $temporaryConfigValidation.PROXY_BYPASS_COUNT
        DISABLE_BACKGROUND_COUNT = $temporaryConfigValidation.DISABLE_BACKGROUND_COUNT
        CONFLICTING_PROXY_FLAG_COUNT = $temporaryConfigValidation.CONFLICTING_PROXY_FLAG_COUNT
        TEMP_CONFIG_JSON_PARSE = $temporaryConfigValidation.TEMP_CONFIG_JSON_PARSE
        TEMP_CONFIG_UNDER_RUNTIME_ROOT = $temporaryConfigValidation.TEMP_CONFIG_UNDER_RUNTIME_ROOT
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
        $sentinelHashBefore = Get-Sha256 -LiteralPath $sentinelPath

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

        $sentinelHashAfter = Get-Sha256 -LiteralPath $sentinelPath
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
            content_sha256 = if ($item.PSIsContainer) { $null } else { Get-Sha256 -LiteralPath $item.FullName }
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

function Get-UsernameRedactionValues {
    if ($null -ne $Script:CachedUsernameRedactionValues) { return @($Script:CachedUsernameRedactionValues) }
    $usernameValues = [Collections.Generic.List[string]]::new()
    $usernameValue = [string]$env:USERNAME
    if (-not [string]::IsNullOrWhiteSpace($usernameValue)) { $usernameValues.Add($usernameValue) }
    try {
        if (-not [string]::IsNullOrWhiteSpace([string]$env:USERPROFILE)) {
            $shortProfilePath = [string](New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:USERPROFILE).ShortPath
            $shortProfileLeaf = [string](Split-Path -Leaf $shortProfilePath)
            if (-not [string]::IsNullOrWhiteSpace($shortProfileLeaf) -and
                @($usernameValues | Where-Object {
                    [string]::Equals($_, $shortProfileLeaf, [StringComparison]::OrdinalIgnoreCase)
                }).Count -eq 0) {
                $usernameValues.Add($shortProfileLeaf)
            }
        }
    }
    catch { }
    $Script:CachedUsernameRedactionValues = @($usernameValues)
    return @($Script:CachedUsernameRedactionValues)
}

function Get-ClearPathScanTokens {
    $scanTokens = @()
    foreach ($usernameValue in @(Get-UsernameRedactionValues)) {
        $scanTokens += [pscustomobject]@{ category = 'USERNAME'; value = $usernameValue }
    }
    foreach ($usersPathPrefix in @(
        'C:\Users\', 'C:/Users/', 'C:\\Users\\', 'file:///C:/Users/', '%5CUsers', '%2FUsers'
    )) {
        $scanTokens += [pscustomobject]@{ category = 'USERS_PATH_PREFIX'; value = $usersPathPrefix }
    }
    return @($scanTokens)
}

function Get-EvidenceRedactionRules {
    param(
        [AllowNull()][string]$EvidenceRoot = $Script:ActiveEvidenceRoot,
        [AllowNull()][string]$RuntimeRoot = $Script:ActiveRuntimeRoot
    )

    $candidates = @(
        [pscustomobject]@{ category = 'EVIDENCE_ROOT'; value = $EvidenceRoot; replacement = '%EVIDENCE_ROOT%' },
        [pscustomobject]@{ category = 'RUNTIME_ROOT'; value = $RuntimeRoot; replacement = '%RUNTIME_ROOT%' },
        [pscustomobject]@{ category = 'REPOSITORY_ROOT'; value = $RepoRoot; replacement = '%REPO%' },
        [pscustomobject]@{ category = 'LOCALAPPDATA'; value = $env:LOCALAPPDATA; replacement = '%LOCALAPPDATA%' },
        [pscustomobject]@{ category = 'APPDATA'; value = $env:APPDATA; replacement = '%APPDATA%' },
        [pscustomobject]@{ category = 'TEMP'; value = $env:TEMP; replacement = '%TEMP%' },
        [pscustomobject]@{ category = 'USERPROFILE'; value = $env:USERPROFILE; replacement = '%REDACTED_USERPROFILE%' }
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.value) } |
        Sort-Object { ([string]$_.value).Length } -Descending

    $seenValues = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $rules = @()
    foreach ($candidate in $candidates) {
        $sourceValue = [string]$candidate.value
        if (-not $seenValues.Add($sourceValue)) { continue }
        $variants = @(
            $sourceValue,
            $sourceValue.Replace('\', '/'),
            $sourceValue.Replace('\', '\\')
        ) | Select-Object -Unique | Sort-Object Length -Descending
        foreach ($variant in $variants) {
            if ([string]::IsNullOrWhiteSpace($variant)) { continue }
            $rules += [pscustomobject]@{
                category = [string]$candidate.category
                value = [string]$variant
                replacement = [string]$candidate.replacement
            }
        }
    }
    return @($rules | Sort-Object { $_.value.Length } -Descending)
}

function ConvertTo-RedactedText {
    param(
        [AllowNull()][object]$Value,
        [AllowNull()][string]$EvidenceRoot = $Script:ActiveEvidenceRoot,
        [AllowNull()][string]$RuntimeRoot = $Script:ActiveRuntimeRoot
    )
    if ($null -eq $Value) { return $null }
    $redactedText = [string]$Value
    foreach ($redactionRule in @(Get-EvidenceRedactionRules -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot)) {
        $redactedText = [regex]::Replace(
            $redactedText,
            [regex]::Escape($redactionRule.value),
            $redactionRule.replacement,
            [Text.RegularExpressions.RegexOptions]::IgnoreCase
        )
    }
    return $redactedText
}

function Test-RedactedStructuredText {
    param(
        [Parameter(Mandatory = $true)][string]$LiteralPath,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Text
    )
    $extension = [IO.Path]::GetExtension($LiteralPath)
    if ($extension -ieq '.json') {
        $null = $Text | ConvertFrom-Json
    }
    elseif ($extension -ieq '.jsonl') {
        foreach ($jsonLine in @($Text -split "`r?`n" | Where-Object { $_.Trim() })) {
            $null = $jsonLine | ConvertFrom-Json
        }
    }
}

function Invoke-EvidenceSanitization {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot
    )

    $supportedExtensions = @('.json', '.jsonl', '.log', '.txt', '.csv')
    $unreadableFiles = @()
    foreach ($evidenceFile in @(Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse -Force | Sort-Object FullName)) {
        if ([IO.Path]::GetExtension($evidenceFile.Name) -notin $supportedExtensions) { continue }
        try {
            $originalText = [IO.File]::ReadAllText($evidenceFile.FullName)
            $sanitizedText = ConvertTo-RedactedText -Value $originalText -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
            foreach ($usernameValue in @(Get-UsernameRedactionValues)) {
                $usernamePattern = [regex]::Escape($usernameValue)
                foreach ($usernameMatch in @([regex]::Matches(
                    $sanitizedText, $usernamePattern, [Text.RegularExpressions.RegexOptions]::IgnoreCase))) {
                    $Script:UsernameRedactionLedger.total_count++
                    $precedingStart = [Math]::Max(0, $usernameMatch.Index - 12)
                    $precedingText = $sanitizedText.Substring($precedingStart, $usernameMatch.Index - $precedingStart)
                    if ($precedingText -match '(?i)users[\\/]{1,2}$' -or $precedingText -match '[\\/]$') { continue }
                    $Script:UsernameRedactionLedger.non_path_context_count++
                    $windowStart = [Math]::Max(0, $usernameMatch.Index - 40)
                    $windowEnd = [Math]::Min($sanitizedText.Length, $usernameMatch.Index + $usernameMatch.Length + 40)
                    $contextWindow = $sanitizedText.Substring($windowStart, $windowEnd - $windowStart)
                    $usernameContextCategory = if ($contextWindow -match '(?i)\berror\b|\bwarning\b') { 'compiler message' }
                    elseif ($contextWindow -match '(?i)node_modules|package') { 'package name' }
                    elseif ([IO.Path]::GetExtension($evidenceFile.Name) -in @('.json', '.jsonl')) { 'unrelated JSON value' }
                    else { 'other' }
                    $null = $Script:UsernameRedactionLedger.non_path_categories.Add($usernameContextCategory)
                }
                $sanitizedText = [regex]::Replace($sanitizedText, $usernamePattern, '%REDACTED_USERNAME%',
                    [Text.RegularExpressions.RegexOptions]::IgnoreCase)
            }
            Test-RedactedStructuredText -LiteralPath $evidenceFile.FullName -Text $sanitizedText
            if ($sanitizedText -cne $originalText) {
                Write-Utf8NoBom -LiteralPath $evidenceFile.FullName -Value $sanitizedText
            }
        }
        catch {
            $unreadableFiles += [ordered]@{
                relative_file = (Get-RelativePathPortable -BasePath $EvidenceRoot -ChildPath $evidenceFile.FullName).Replace('\', '/')
                error_code = 'EVIDENCE-FILE-UNREADABLE'
            }
        }
    }

    $clearPathMatches = @()
    $redactionRules = @(Get-EvidenceRedactionRules -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot) +
        @(Get-ClearPathScanTokens)
    foreach ($evidenceFile in @(Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse -Force | Sort-Object FullName)) {
        if ([IO.Path]::GetExtension($evidenceFile.Name) -notin $supportedExtensions) { continue }
        try {
            $currentText = [IO.File]::ReadAllText($evidenceFile.FullName)
            foreach ($redactionRule in $redactionRules) {
                $occurrenceCount = [regex]::Matches(
                    $currentText,
                    [regex]::Escape($redactionRule.value),
                    [Text.RegularExpressions.RegexOptions]::IgnoreCase
                ).Count
                if ($occurrenceCount -gt 0) {
                    $clearPathMatches += [ordered]@{
                        relative_file = (Get-RelativePathPortable -BasePath $EvidenceRoot -ChildPath $evidenceFile.FullName).Replace('\', '/')
                        token_category = $redactionRule.category
                        occurrence_count = $occurrenceCount
                    }
                }
            }
        }
        catch {
            if (-not ($unreadableFiles | Where-Object { $_.relative_file -eq
                (Get-RelativePathPortable -BasePath $EvidenceRoot -ChildPath $evidenceFile.FullName).Replace('\', '/') })) {
                $unreadableFiles += [ordered]@{
                    relative_file = (Get-RelativePathPortable -BasePath $EvidenceRoot -ChildPath $evidenceFile.FullName).Replace('\', '/')
                    error_code = 'EVIDENCE-FILE-UNREADABLE'
                }
            }
        }
    }

    $clearPathMatchCount = 0
    foreach ($clearPathMatch in $clearPathMatches) {
        $clearPathMatchCount += [int]$clearPathMatch.occurrence_count
    }
    Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot 'clear-path-scan.json') -Value ([ordered]@{
        schema_version = 1
        clear_personal_path_match_count = $clearPathMatchCount
        username_replacement_total_count = [int]$Script:UsernameRedactionLedger.total_count
        username_replacement_non_path_context_count = [int]$Script:UsernameRedactionLedger.non_path_context_count
        username_replacement_non_path_categories = @($Script:UsernameRedactionLedger.non_path_categories | Sort-Object)
        matches = $clearPathMatches
        unreadable_files = $unreadableFiles
    })
    return [ordered]@{
        clear_personal_path_match_count = [int]$clearPathMatchCount
        matches = $clearPathMatches
        unreadable_files = $unreadableFiles
    }
}

function New-PrimaryFailureRecord {
    param(
        [Parameter(Mandatory = $true)]$ErrorRecord,
        [Parameter(Mandatory = $true)][string]$Phase
    )
    $message = [string]$ErrorRecord.Exception.Message
    $failureCode = 'UNCLASSIFIED-HARNESS-FAILURE'
    $failureCodeMatch = [regex]::Match($message, '^([A-Z0-9][A-Z0-9_-]+)')
    if ($failureCodeMatch.Success) { $failureCode = $failureCodeMatch.Groups[1].Value }
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
            content_sha256 = if ($exists) { Get-Sha256 -LiteralPath $literalPath } else { $null }
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

function ConvertTo-WindowsCommandLineArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value.Length -eq 0) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    $builder = [Text.StringBuilder]::new()
    $null = $builder.Append('"')
    $backslashCount = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashCount++
            continue
        }
        if ($character -eq '"') {
            $null = $builder.Append(('\' * (($backslashCount * 2) + 1)))
            $null = $builder.Append('"')
            $backslashCount = 0
            continue
        }
        if ($backslashCount -gt 0) {
            $null = $builder.Append(('\' * $backslashCount))
            $backslashCount = 0
        }
        $null = $builder.Append($character)
    }
    if ($backslashCount -gt 0) {
        $null = $builder.Append(('\' * ($backslashCount * 2)))
    }
    $null = $builder.Append('"')
    return $builder.ToString()
}

function Invoke-ExternalCaptured {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)]
        [ValidatePattern('^[A-Za-z0-9._-]+$')]
        [string]$LogName,
        [ValidateRange(1000, 3600000)]
        [int]$WaitTimeoutMilliseconds = 900000
    )
    $rawLogRoot = Join-Path $RuntimeRoot 'raw-logs\external'
    $null = New-Item -ItemType Directory -Path $rawLogRoot -Force
    $captureRecord = [pscustomobject][ordered]@{
        role = $LogName
        process_launched = $false
        raw_stdout_path = Join-Path $rawLogRoot "$LogName.stdout.raw.log"
        raw_stderr_path = Join-Path $rawLogRoot "$LogName.stderr.raw.log"
        evidence_stdout_path = Join-Path $EvidenceRoot "$LogName.stdout.log"
        evidence_stderr_path = Join-Path $EvidenceRoot "$LogName.stderr.log"
        stream_publications = @()
        sanitized_logs_created = $false
        raw_logs_removed = $false
    }
    $Script:LogCaptures.Add($captureRecord) | Out-Null

    $externalResult = [ordered]@{
        process_id = $null
        has_exited = $false
        captured_ok = $false
        exit_code_status = 'UNAVAILABLE'
        exit_code = $null
        start_utc = (Get-Date).ToUniversalTime().ToString('o')
        end_utc = $null
        stdout_metadata = $null
        stderr_metadata = $null
        failure_code = 'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE'
        child_exit_capture = 'DIRECT-PROCESS-EXITCODE'
        child_exit_reconstruction = $false
        child_exit_evidence = "$LogName.child-exit-code.txt"
    }
    $externalProcess = $null
    $stdoutTask = $null
    $stderrTask = $null
    try {
        $resolvedExecutable = (Resolve-Path -LiteralPath $FilePath -ErrorAction Stop).ProviderPath
        $startFilePath = $resolvedExecutable
        $startArguments = (@($Arguments | ForEach-Object {
            ConvertTo-WindowsCommandLineArgument -Value ([string]$_)
        }) -join ' ')
        if ([IO.Path]::GetExtension($resolvedExecutable) -in @('.cmd', '.bat')) {
            $commandParts = @('"' + $resolvedExecutable.Replace('"', '""') + '"')
            foreach ($argument in $Arguments) {
                $commandParts += '"' + ([string]$argument).Replace('"', '""') + '"'
            }
            $startFilePath = $env:ComSpec
            $startArguments = '/d /s /c "' + ($commandParts -join ' ') + '"'
        }

        $processStartInfo = [Diagnostics.ProcessStartInfo]::new()
        $processStartInfo.FileName = $startFilePath
        $processStartInfo.Arguments = $startArguments
        $processStartInfo.WorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
        $processStartInfo.UseShellExecute = $false
        $processStartInfo.CreateNoWindow = $true
        $processStartInfo.RedirectStandardOutput = $true
        $processStartInfo.RedirectStandardError = $true
        $externalProcess = [Diagnostics.Process]::new()
        $externalProcess.StartInfo = $processStartInfo
        if (-not $externalProcess.Start()) {
            throw 'EXTERNAL-COMMAND-NOT-EXITED: process start returned false'
        }
        $captureRecord.process_launched = $true
        $externalResult.process_id = [int]$externalProcess.Id
        $stdoutTask = $externalProcess.StandardOutput.ReadToEndAsync()
        $stderrTask = $externalProcess.StandardError.ReadToEndAsync()

        $waitCompleted = $externalProcess.WaitForExit($WaitTimeoutMilliseconds)
        if (-not $waitCompleted) {
            try { $externalProcess.Kill() } catch { }
            $externalProcess.WaitForExit()
        }
        else {
            $externalProcess.WaitForExit()
        }
        $externalProcess.Refresh()
        $externalResult.has_exited = [bool]$externalProcess.HasExited
        if (-not $externalResult.has_exited) {
            $externalResult.exit_code_status = 'NOT_EXITED'
            $externalResult.failure_code = 'EXTERNAL-COMMAND-NOT-EXITED'
        }
        else {
            $ExternalChildExitCode = [int]$externalProcess.ExitCode
            Set-Variable -Name ExternalChildExitCode -Value $ExternalChildExitCode `
                -Option ReadOnly -Scope Local -Force
            [IO.File]::WriteAllText(
                (Join-Path $EvidenceRoot "$LogName.child-exit-code.txt"),
                [string]$ExternalChildExitCode,
                [Text.UTF8Encoding]::new($false)
            )
            $externalResult.exit_code = $ExternalChildExitCode
            if ($waitCompleted) {
                $externalResult.exit_code_status = 'CAPTURED'
                $externalResult.captured_ok = $true
                if ($ExternalChildExitCode -eq 0) {
                    $externalResult.failure_code = $null
                }
                else {
                    $externalResult.failure_code = 'EXTERNAL-COMMAND-FAILED'
                }
            }
            else {
                $externalResult.exit_code_status = 'CAPTURED_AFTER_TIMEOUT'
                $externalResult.failure_code = 'EXTERNAL-COMMAND-WAIT-TIMEOUT'
            }
        }

        $stdoutTask.Wait()
        $stderrTask.Wait()
        [IO.File]::WriteAllText(
            [string]$captureRecord.raw_stdout_path,
            $stdoutTask.Result,
            [Text.UTF8Encoding]::new($false)
        )
        [IO.File]::WriteAllText(
            [string]$captureRecord.raw_stderr_path,
            $stderrTask.Result,
            [Text.UTF8Encoding]::new($false)
        )
    }
    catch {
        if (-not $externalResult.captured_ok -and $externalResult.exit_code_status -eq 'UNAVAILABLE') {
            $externalResult.failure_code = 'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE'
        }
        if (-not (Test-Path -LiteralPath $captureRecord.raw_stdout_path -PathType Leaf)) {
            [IO.File]::WriteAllBytes($captureRecord.raw_stdout_path, [byte[]]@())
        }
        if (-not (Test-Path -LiteralPath $captureRecord.raw_stderr_path -PathType Leaf)) {
            [IO.File]::WriteAllText(
                $captureRecord.raw_stderr_path,
                $_.Exception.Message,
                [Text.UTF8Encoding]::new($false)
            )
        }
    }
    finally {
        $externalResult.end_utc = (Get-Date).ToUniversalTime().ToString('o')
        try {
            Publish-SanitizedLogCapture -CaptureRecord $captureRecord -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
        }
        catch {
            if ([string]::IsNullOrWhiteSpace([string]$externalResult.failure_code)) {
                if ($_.Exception.Message -match '^RAW-LOG-CLEANUP-FAILED') {
                    $externalResult.failure_code = 'RAW-LOG-CLEANUP-FAILED'
                }
                else {
                    $externalResult.failure_code = 'SANITIZED-LOG-PUBLICATION-FAILED'
                }
            }
        }
        $stdoutPublications = @($captureRecord.stream_publications | Where-Object { $_.stream -eq 'stdout' })
        $stderrPublications = @($captureRecord.stream_publications | Where-Object { $_.stream -eq 'stderr' })
        if ($stdoutPublications.Count -eq 1) { $externalResult.stdout_metadata = $stdoutPublications[0] }
        if ($stderrPublications.Count -eq 1) { $externalResult.stderr_metadata = $stderrPublications[0] }
        if ($null -ne $externalProcess) { $externalProcess.Dispose() }
    }

    if ($null -eq $externalResult.end_utc) {
        $externalResult.end_utc = (Get-Date).ToUniversalTime().ToString('o')
    }
    return [pscustomobject]$externalResult
}

function Assert-ExternalCommandSucceeded {
    param(
        [Parameter(Mandatory = $true)]$Result,
        [Parameter(Mandatory = $true)][string]$CommandLabel
    )
    if (-not [bool]$Result.captured_ok) {
        $failureCode = switch ([string]$Result.exit_code_status) {
            'WAIT_TIMEOUT' { 'EXTERNAL-COMMAND-WAIT-TIMEOUT'; break }
            'NOT_EXITED' { 'EXTERNAL-COMMAND-NOT-EXITED'; break }
            'UNAVAILABLE' { 'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE'; break }
            'TYPE_MISMATCH' { 'EXTERNAL-COMMAND-EXITCODE-TYPE-MISMATCH'; break }
            default { 'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE' }
        }
        throw "$failureCode`: $CommandLabel"
    }
    if (-not [string]::IsNullOrWhiteSpace([string]$Result.failure_code)) {
        throw "$($Result.failure_code): $CommandLabel"
    }
    if ($Result.exit_code -ne 0) {
        throw "EXTERNAL-COMMAND-FAILED: $CommandLabel"
    }
}

function Test-FileExclusiveAccess {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)
    if (-not (Test-Path -LiteralPath $LiteralPath -PathType Leaf)) { return $true }
    $exclusiveStream = $null
    try {
        $exclusiveStream = [IO.File]::Open(
            $LiteralPath,
            [IO.FileMode]::Open,
            [IO.FileAccess]::ReadWrite,
            [IO.FileShare]::None
        )
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $exclusiveStream) { $exclusiveStream.Dispose() }
    }
}

function Publish-SanitizedLogCapture {
    param(
        [Parameter(Mandatory = $true)]$CaptureRecord,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [ValidateSet('stdout', 'stderr')][string]$InjectFailureStream
    )
    if ($CaptureRecord.sanitized_logs_created -and $CaptureRecord.raw_logs_removed) { return }

    if ([string]::IsNullOrWhiteSpace($InjectFailureStream) -and
        $null -ne $CaptureRecord.PSObject.Properties['inject_publication_failure_stream']) {
        $InjectFailureStream = [string]$CaptureRecord.inject_publication_failure_stream
    }

    $processLaunched = $false
    if ($null -ne $CaptureRecord.PSObject.Properties['process_launched']) {
        $processLaunched = [bool]$CaptureRecord.process_launched
    }
    $publicationRecords = [Collections.Generic.List[object]]::new()
    $publicationFailed = $false
    $rawCleanupFailed = $false

    foreach ($logPair in @(
        [pscustomobject]@{
            stream = 'stdout'
            raw = $CaptureRecord.raw_stdout_path
            sanitized = $CaptureRecord.evidence_stdout_path
        },
        [pscustomobject]@{
            stream = 'stderr'
            raw = $CaptureRecord.raw_stderr_path
            sanitized = $CaptureRecord.evidence_stderr_path
        }
    )) {
        $rawExists = Test-Path -LiteralPath $logPair.raw -PathType Leaf
        $rawSize = if ($rawExists) { [int64](Get-Item -LiteralPath $logPair.raw).Length } else { $null }
        $publicationRecord = [ordered]@{
            role = [string]$CaptureRecord.role
            stream = [string]$logPair.stream
            raw_exists = [bool]$rawExists
            raw_status = if ($rawExists) { 'PRESENT' } elseif ($processLaunched) { 'MISSING' } else { 'NOT_CREATED' }
            raw_size = $rawSize
            sanitized_exists = $false
            sanitized_size = $null
            publication_status = 'FAILED'
            raw_cleanup_status = 'NOT_ATTEMPTED'
            clear_path_match_count = 0
            error_code = $null
        }

        if (-not $rawExists) {
            $publicationRecord.publication_status = if ($processLaunched) { 'FAILED' } else { 'NOT_CREATED' }
            $publicationRecord.raw_cleanup_status = 'NOT_CREATED'
            if ($processLaunched) {
                $publicationRecord.error_code = 'SANITIZED-LOG-PUBLICATION-FAILED'
                $publicationFailed = $true
            }
            $publicationRecords.Add($publicationRecord) | Out-Null
            continue
        }

        if (-not (Test-FileExclusiveAccess -LiteralPath $logPair.raw)) {
            $publicationRecord.error_code = 'SANITIZED-LOG-PUBLICATION-FAILED'
            $publicationFailed = $true
            $publicationRecords.Add($publicationRecord) | Out-Null
            continue
        }

        try {
            $rawText = [IO.File]::ReadAllText($logPair.raw)
            if ($InjectFailureStream -eq $logPair.stream) {
                throw 'SANITIZED-LOG-PUBLICATION-FAILED: synthetic publication failure'
            }
            $sanitizedText = ConvertTo-RedactedText -Value $rawText -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
            Write-Utf8NoBom -LiteralPath $logPair.sanitized -Value $sanitizedText
            $publicationRecord.sanitized_exists = Test-Path -LiteralPath $logPair.sanitized -PathType Leaf
            if (-not $publicationRecord.sanitized_exists) {
                throw 'SANITIZED-LOG-PUBLICATION-FAILED: sanitized file missing after write'
            }
            $publicationRecord.sanitized_size = [int64](Get-Item -LiteralPath $logPair.sanitized).Length
            foreach ($redactionRule in @(Get-EvidenceRedactionRules -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot)) {
                $publicationRecord.clear_path_match_count += [regex]::Matches(
                    $sanitizedText,
                    [regex]::Escape($redactionRule.value),
                    [Text.RegularExpressions.RegexOptions]::IgnoreCase
                ).Count
            }
            if ($publicationRecord.clear_path_match_count -ne 0) {
                throw 'SANITIZED-LOG-PUBLICATION-FAILED: clear path remains after sanitization'
            }
            if ($rawSize -eq 0 -and $publicationRecord.sanitized_size -ne 0) {
                throw 'SANITIZED-LOG-PUBLICATION-FAILED: empty stream was not published as zero bytes'
            }
            $publicationRecord.publication_status = if ($rawSize -eq 0) { 'PASS_EMPTY' } else { 'PASS_CONTENT' }
        }
        catch {
            $publicationRecord.publication_status = 'FAILED'
            $publicationRecord.error_code = 'SANITIZED-LOG-PUBLICATION-FAILED'
            $publicationFailed = $true
            $publicationRecords.Add($publicationRecord) | Out-Null
            continue
        }

        try {
            Remove-Item -LiteralPath $logPair.raw -Force
            $publicationRecord.raw_cleanup_status = if (Test-Path -LiteralPath $logPair.raw) { 'FAILED' } else { 'PASS' }
            if ($publicationRecord.raw_cleanup_status -ne 'PASS') {
                $publicationRecord.error_code = 'RAW-LOG-CLEANUP-FAILED'
                $rawCleanupFailed = $true
            }
        }
        catch {
            $publicationRecord.raw_cleanup_status = 'FAILED'
            $publicationRecord.error_code = 'RAW-LOG-CLEANUP-FAILED'
            $rawCleanupFailed = $true
        }
        $publicationRecords.Add($publicationRecord) | Out-Null
    }

    $CaptureRecord.stream_publications = @($publicationRecords | ForEach-Object { $_ })
    $CaptureRecord.sanitized_logs_created = @(
        $CaptureRecord.stream_publications | Where-Object { $_.publication_status -eq 'FAILED' }
    ).Count -eq 0
    $remainingRawLogs = @(@(
        $CaptureRecord.raw_stdout_path,
        $CaptureRecord.raw_stderr_path
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
    $CaptureRecord.raw_logs_removed = $remainingRawLogs.Count -eq 0

    if ($publicationFailed) {
        throw 'SANITIZED-LOG-PUBLICATION-FAILED'
    }
    if ($rawCleanupFailed) {
        throw 'RAW-LOG-CLEANUP-FAILED'
    }
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

function Register-OwnedProcessIdentity {
    param([Parameter(Mandatory = $true)]$Identity)
    $alreadyRegistered = @($Script:OwnedProcessIdentities | Where-Object {
        $_.process_id -eq $Identity.process_id -and $_.creation_date -eq $Identity.creation_date
    }).Count -gt 0
    if (-not $alreadyRegistered) { $Script:OwnedProcessIdentities += $Identity }
}

function Get-OwnedProcessTreeSnapshot {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)
    $processTable = Get-ProcessTable
    $snapshot = @()
    foreach ($candidateProcessId in @($processTable.Keys)) {
        if (-not (Test-ProcessDescendsFrom -ProcessId $candidateProcessId -RootProcessId $RootProcessId `
            -ProcessTable $processTable)) { continue }
        $identity = Get-ProcessIdentity -CimProcess $processTable[$candidateProcessId]
        $depth = 0
        $ancestorProcessId = [int]$candidateProcessId
        $seenAncestors = @{}
        while ($ancestorProcessId -ne $RootProcessId -and $ancestorProcessId -gt 0 -and
            -not $seenAncestors.ContainsKey($ancestorProcessId) -and $processTable.ContainsKey($ancestorProcessId)) {
            $seenAncestors[$ancestorProcessId] = $true
            $ancestorProcessId = [int]$processTable[$ancestorProcessId].ParentProcessId
            $depth++
        }
        $identity['depth'] = $depth
        $snapshot += $identity
        Register-OwnedProcessIdentity -Identity $identity
    }
    return @($snapshot | Sort-Object depth, process_id)
}

function Register-OwnedProcessObject {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][string]$Role,
        [Parameter(Mandatory = $true)]$CaptureRecord
    )
    $record = [pscustomobject][ordered]@{
        process_object = $Process
        process_id = [int]$Process.Id
        role = $Role
        capture_record = $CaptureRecord
        wait_completed = $false
        exit_code_capture = 'PENDING'
        exit_code = $null
        exit_code_evidence = $null
        disposed = $false
    }
    $Script:OwnedProcessObjects.Add($record) | Out-Null
    return $record
}

function Stop-OwnedProcessIdentity {
    param([Parameter(Mandatory = $true)]$Identity)
    $currentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($Identity.process_id)" -ErrorAction SilentlyContinue
    if ($null -eq $currentProcess) {
        return [ordered]@{ process_id = [int]$Identity.process_id; stop_status = 'ALREADY_EXITED' }
    }
    $currentIdentity = Get-ProcessIdentity -CimProcess $currentProcess
    if (-not [string]::Equals(
            [string]$currentIdentity.executable_path,
            [string]$Identity.executable_path,
            [StringComparison]::OrdinalIgnoreCase
        ) -or
        $currentIdentity.creation_date -ne $Identity.creation_date) {
        throw "Owned PID identity changed: $($Identity.process_id)"
    }
    Stop-Process -Id $Identity.process_id -Force -ErrorAction Stop
    return [ordered]@{ process_id = [int]$Identity.process_id; stop_status = 'STOP_REQUESTED' }
}

function Invoke-OwnedProcessShutdown {
    param(
        [Parameter(Mandatory = $true)]$ProcessIdentities,
        [Parameter(Mandatory = $true)]$ProcessObjectRecords,
        [Parameter(Mandatory = $true)]$LogCaptures,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][string]$Stage,
        [int]$TimeoutSeconds = 10,
        [bool]$StopRunning = $true
    )

    $finalSnapshot = @()
    foreach ($processObjectRecord in @($ProcessObjectRecords)) {
        $finalSnapshot += @(Get-OwnedProcessTreeSnapshot -RootProcessId ([int]$processObjectRecord.process_id))
    }
    $knownIdentities = @($ProcessIdentities) + @($Script:OwnedProcessIdentities) + @($finalSnapshot)
    $uniqueIdentityMap = [ordered]@{}
    foreach ($knownIdentity in $knownIdentities) {
        $identityKey = '{0}|{1}' -f ([int]$knownIdentity.process_id), ([string]$knownIdentity.creation_date)
        if (-not $uniqueIdentityMap.Contains($identityKey)) {
            $uniqueIdentityMap[$identityKey] = $knownIdentity
        }
    }
    $uniqueIdentities = @($uniqueIdentityMap.Values | Sort-Object process_id, creation_date)
    Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot "owned-process-final-snapshot-$Stage.json") -Value ([ordered]@{
        captured_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        observed_final_tree = $finalSnapshot
        known_owned_identities = $uniqueIdentities
    })

    $identityProcessHandles = @()
    foreach ($ownedIdentity in $uniqueIdentities) {
        $identityHandleRecord = [pscustomobject][ordered]@{
            process_id = [int]$ownedIdentity.process_id
            process_object = $null
            identity_verified = $false
            wait_completed = $false
            disposed = $false
        }
        try {
            $identityCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($ownedIdentity.process_id)" -ErrorAction SilentlyContinue
            if ($null -eq $identityCim) {
                $identityHandleRecord.identity_verified = $true
                $identityHandleRecord.wait_completed = $true
                $identityHandleRecord.disposed = $true
            }
            else {
                $currentIdentity = Get-ProcessIdentity -CimProcess $identityCim
                $identityMatches = [string]::Equals(
                    [string]$currentIdentity.executable_path,
                    [string]$ownedIdentity.executable_path,
                    [StringComparison]::OrdinalIgnoreCase
                ) -and $currentIdentity.creation_date -eq $ownedIdentity.creation_date
                if ($identityMatches) {
                    $identityHandleRecord.identity_verified = $true
                    $identityHandleRecord.process_object = [Diagnostics.Process]::GetProcessById([int]$ownedIdentity.process_id)
                }
            }
        }
        catch { }
        $identityProcessHandles += $identityHandleRecord
    }

    $stopResults = @()
    if ($StopRunning) {
        foreach ($ownedIdentity in @($uniqueIdentities | Sort-Object `
            @{ Expression = {
                    $depthProperty = $_.PSObject.Properties['depth']
                    if ($null -ne $depthProperty) { [int]$depthProperty.Value } else { 0 }
                }; Descending = $true }, `
            @{ Expression = { [int]$_.process_id }; Descending = $true })) {
            try {
                $stopResults += Stop-OwnedProcessIdentity -Identity $ownedIdentity
            }
            catch {
                $stopResults += [ordered]@{
                    process_id = [int]$ownedIdentity.process_id
                    stop_status = 'FAILED'
                    error_redacted = ConvertTo-RedactedText -Value $_.Exception.Message
                }
            }
        }
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $waitResults = @()
    foreach ($ownedIdentity in $uniqueIdentities) {
        while ([DateTime]::UtcNow -lt $deadline -and
            $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId = $($ownedIdentity.process_id)" -ErrorAction SilentlyContinue)) {
            Start-Sleep -Milliseconds 100
        }
        $stillPresent = $null -ne (Get-CimInstance Win32_Process -Filter "ProcessId = $($ownedIdentity.process_id)" -ErrorAction SilentlyContinue)
        $waitResults += [ordered]@{
            process_id = [int]$ownedIdentity.process_id
            wait_status = if ($stillPresent) { 'TIMEOUT' } else { 'EXITED' }
        }
    }

    $processObjectResults = @()
    foreach ($processObjectRecord in @($ProcessObjectRecords)) {
        if (-not $processObjectRecord.disposed) {
            try {
                $processObject = $processObjectRecord.process_object
                $processObject.Refresh()
                if (-not $processObject.HasExited) {
                    $remainingMilliseconds = [Math]::Max(0, [int]([DateTime]::UtcNow.Subtract($deadline).TotalMilliseconds * -1))
                    $processObjectRecord.wait_completed = $processObject.WaitForExit($remainingMilliseconds)
                }
                else {
                    $processObject.WaitForExit()
                    $processObjectRecord.wait_completed = $true
                }
                $processObject.Refresh()
                if ($processObject.HasExited) {
                    $ownedChildExitCode = [int]$processObject.ExitCode
                    $exitEvidenceName = 'owned-child-exit-{0}-{1}.txt' -f `
                        ([string]$processObjectRecord.role -replace '[^A-Za-z0-9._-]', '-'),
                        ([int]$processObjectRecord.process_id)
                    $processObjectRecord.exit_code_capture = 'DIRECT-PROCESS-EXITCODE'
                    $processObjectRecord.exit_code = $ownedChildExitCode
                    try {
                        [IO.File]::WriteAllText(
                            (Join-Path $EvidenceRoot $exitEvidenceName),
                            [string]$ownedChildExitCode,
                            [Text.UTF8Encoding]::new($false)
                        )
                        $processObjectRecord.exit_code_evidence = $exitEvidenceName
                    }
                    catch {
                        $processObjectRecord.exit_code_evidence = 'WRITE-FAILED'
                    }
                }
                $processObject.Dispose()
                $processObjectRecord.disposed = $true
            }
            catch {
                $processObjectRecord.wait_completed = $false
            }
        }
        $processObjectResults += [ordered]@{
            process_id = [int]$processObjectRecord.process_id
            role = [string]$processObjectRecord.role
            wait_completed = [bool]$processObjectRecord.wait_completed
            exit_code_capture = [string]$processObjectRecord.exit_code_capture
            exit_code = $processObjectRecord.exit_code
            exit_code_evidence = $processObjectRecord.exit_code_evidence
            disposed = [bool]$processObjectRecord.disposed
        }
    }

    $identityWaitResults = @()
    foreach ($identityHandleRecord in $identityProcessHandles) {
        if ($null -ne $identityHandleRecord.process_object) {
            try {
                $identityProcessObject = $identityHandleRecord.process_object
                $identityProcessObject.Refresh()
                if ($identityProcessObject.HasExited) {
                    $identityProcessObject.WaitForExit()
                    $identityHandleRecord.wait_completed = $true
                }
                else {
                    $remainingMilliseconds = [Math]::Max(
                        0,
                        [int]($deadline.Subtract([DateTime]::UtcNow).TotalMilliseconds)
                    )
                    $identityHandleRecord.wait_completed = $identityProcessObject.WaitForExit($remainingMilliseconds)
                }
            }
            catch {
                $identityHandleRecord.wait_completed = $false
            }
            finally {
                try {
                    $identityHandleRecord.process_object.Dispose()
                    $identityHandleRecord.disposed = $true
                }
                catch {
                    $identityHandleRecord.disposed = $false
                }
            }
        }
        $identityWaitResults += [ordered]@{
            process_id = [int]$identityHandleRecord.process_id
            identity_verified = [bool]$identityHandleRecord.identity_verified
            wait_completed = [bool]$identityHandleRecord.wait_completed
            disposed = [bool]$identityHandleRecord.disposed
        }
    }

    $logHandleResults = @()
    foreach ($captureRecord in @($LogCaptures)) {
        $stdoutReleased = Test-FileExclusiveAccess -LiteralPath $captureRecord.raw_stdout_path
        $stderrReleased = Test-FileExclusiveAccess -LiteralPath $captureRecord.raw_stderr_path
        $logHandleResults += [ordered]@{
            role = [string]$captureRecord.role
            stdout_released = [bool]$stdoutReleased
            stderr_released = [bool]$stderrReleased
            sanitized_logs_created = [bool]$captureRecord.sanitized_logs_created
            raw_logs_removed = [bool]$captureRecord.raw_logs_removed
        }
    }

    return [ordered]@{
        final_snapshot = $finalSnapshot
        stop_results = $stopResults
        wait_results = $waitResults
        identity_wait_results = $identityWaitResults
        process_object_results = $processObjectResults
        log_handle_results = $logHandleResults
        all_processes_exited = @($waitResults | Where-Object { $_.wait_status -ne 'EXITED' }).Count -eq 0
        all_process_waits_completed = @($processObjectResults | Where-Object { -not $_.wait_completed }).Count -eq 0 -and
            @($identityWaitResults | Where-Object { -not $_.identity_verified -or -not $_.wait_completed }).Count -eq 0
        all_process_objects_disposed = @($processObjectResults | Where-Object { -not $_.disposed }).Count -eq 0 -and
            @($identityWaitResults | Where-Object { -not $_.disposed }).Count -eq 0
        all_log_handles_released = @($logHandleResults | Where-Object { -not $_.stdout_released -or -not $_.stderr_released }).Count -eq 0
        all_raw_logs_removed = @($logHandleResults | Where-Object { -not $_.raw_logs_removed }).Count -eq 0
        all_sanitized_logs_created = @($logHandleResults | Where-Object { -not $_.sanitized_logs_created }).Count -eq 0
    }
}

function Get-StringSha256 {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString(
            $algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))
        )).Replace('-', '')
    }
    finally {
        $algorithm.Dispose()
    }
}

function New-WebViewIsolationAdditionalBrowserArguments {
    param([Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$ProxyPort)
    return [string](
        '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection ' +
        '--disable-background-networking ' +
        '--disable-component-update ' +
        '--no-first-run ' +
        '--disable-quic ' +
        "--proxy-server=http://127.0.0.1:$ProxyPort " +
        '--proxy-bypass-list=localhost,127.0.0.1,[::1]'
    )
}

function New-TemporaryTauriConfiguration {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$ProxyPort
    )
    $runtimeFullPath = [IO.Path]::GetFullPath($RuntimeRoot)
    $temporaryConfigPath = [IO.Path]::GetFullPath((Join-Path $runtimeFullPath 'tauri.webview-isolation.conf.json'))
    $runtimePrefixPath = $runtimeFullPath.TrimEnd('\') + '\'
    if (-not $temporaryConfigPath.StartsWith($runtimePrefixPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'TEMP-TAURI-CONFIG-INVALID'
    }
    if (-not (Test-Path -LiteralPath $ProductionTauriConfig -PathType Leaf) -or
        -not (Test-Path -LiteralPath $WdioTauriConfig -PathType Leaf)) {
        throw 'TEMP-TAURI-CONFIG-INVALID'
    }

    $configuration = Get-Content -LiteralPath $ProductionTauriConfig -Raw | ConvertFrom-Json
    $wdioOverlay = Get-Content -LiteralPath $WdioTauriConfig -Raw | ConvertFrom-Json
    if ($null -eq $configuration.app -or @($configuration.app.windows).Count -lt 1 -or
        $null -eq $configuration.build -or $null -eq $configuration.app.security) {
        throw 'TEMP-TAURI-CONFIG-INVALID'
    }
    $configuration.build.beforeBuildCommand = [string]$wdioOverlay.build.beforeBuildCommand
    $configuration.build.frontendDist = [string]$wdioOverlay.build.frontendDist
    $configuration.app.security.capabilities = @($wdioOverlay.app.security.capabilities)

    $additionalBrowserArguments = New-WebViewIsolationAdditionalBrowserArguments -ProxyPort $ProxyPort
    $firstWindow = @($configuration.app.windows)[0]
    $additionalArgumentsProperty = $firstWindow.PSObject.Properties['additionalBrowserArgs']
    if ($null -eq $additionalArgumentsProperty) {
        $firstWindow | Add-Member -NotePropertyName 'additionalBrowserArgs' -NotePropertyValue $additionalBrowserArguments
    }
    else {
        $additionalArgumentsProperty.Value = $additionalBrowserArguments
    }

    $configurationText = ($configuration | ConvertTo-Json -Depth 100) + [Environment]::NewLine
    Write-Utf8NoBom -LiteralPath $temporaryConfigPath -Value $configurationText
    $readBack = Get-Content -LiteralPath $temporaryConfigPath -Raw | ConvertFrom-Json
    $readBackArguments = [string]@($readBack.app.windows)[0].additionalBrowserArgs
    if ($readBackArguments -cne $additionalBrowserArguments) {
        throw 'TEMP-TAURI-CONFIG-INVALID'
    }

    $proxyServerCount = [regex]::Matches($readBackArguments, '--proxy-server(?:=|\s)').Count
    $proxyBypassCount = [regex]::Matches($readBackArguments, '--proxy-bypass-list(?:=|\s)').Count
    $disableBackgroundCount = [regex]::Matches($readBackArguments, '--disable-background-networking(?:\s|$)').Count
    $conflictingProxyCount = [regex]::Matches(
        $readBackArguments,
        '--(?:no-proxy-server|proxy-pac-url)(?:=|\s|$)'
    ).Count + [Math]::Max(0, $proxyServerCount - 1)
    $defaultWryDisableFeaturesPreserved = $readBackArguments.Contains(
        '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection'
    )
    if (-not $defaultWryDisableFeaturesPreserved -or $proxyServerCount -ne 1 -or
        $proxyBypassCount -ne 1 -or $disableBackgroundCount -ne 1 -or $conflictingProxyCount -ne 0) {
        throw 'TEMP-TAURI-CONFIG-INVALID'
    }

    $productionBlobOutput = @(Invoke-GitRead -Arguments @('hash-object', 'src-tauri/tauri.conf.json'))
    if ($productionBlobOutput.Count -ne 1) { throw 'TEMP-TAURI-CONFIG-INVALID' }
    return [pscustomobject][ordered]@{
        config_path = [string]$temporaryConfigPath
        production_config_blob = [string]$productionBlobOutput[0]
        temporary_config_sha256 = Get-Sha256 -LiteralPath $temporaryConfigPath
        additional_browser_args = [string]$additionalBrowserArguments
        additional_browser_args_sha256 = Get-StringSha256 -Value $additionalBrowserArguments
        proxy_port = [int]$ProxyPort
        DEFAULT_WRY_DISABLE_FEATURES_PRESERVED = [bool]$defaultWryDisableFeaturesPreserved
        PROXY_SERVER_COUNT = [int]$proxyServerCount
        PROXY_BYPASS_COUNT = [int]$proxyBypassCount
        DISABLE_BACKGROUND_COUNT = [int]$disableBackgroundCount
        CONFLICTING_PROXY_FLAG_COUNT = [int]$conflictingProxyCount
        TEMP_CONFIG_JSON_PARSE = 'PASS'
        TEMP_CONFIG_UNDER_RUNTIME_ROOT = $true
    }
}

function Invoke-TemporaryWebViewConfigValidation {
    $runToken = 'synthetic-' + [guid]::NewGuid().ToString('N')
    $runtimePrefix = 'ytm-free-webview-config-validation-'
    $runtimeRoot = Join-Path $env:TEMP ($runtimePrefix + $runToken)
    $created = $false
    try {
        $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
        $created = $true
        $result = New-TemporaryTauriConfiguration -RuntimeRoot $runtimeRoot -ProxyPort 43210
        if ($result.PROXY_SERVER_COUNT -ne 1 -or $result.PROXY_BYPASS_COUNT -ne 1 -or
            $result.DISABLE_BACKGROUND_COUNT -ne 1 -or $result.CONFLICTING_PROXY_FLAG_COUNT -ne 0 -or
            -not $result.DEFAULT_WRY_DISABLE_FEATURES_PRESERVED -or
            $result.TEMP_CONFIG_JSON_PARSE -ne 'PASS' -or -not $result.TEMP_CONFIG_UNDER_RUNTIME_ROOT) {
            throw 'TEMP-TAURI-CONFIG-INVALID'
        }
        return $result
    }
    finally {
        if ($created -and (Test-Path -LiteralPath $runtimeRoot)) {
            $safeRuntime = Assert-NoReparseDescendant -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
            Remove-Item -LiteralPath $safeRuntime -Recurse -Force
        }
    }
}

function Start-OwnedDenyProxy {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][byte[]]$HmacKey
    )
    $proxyRoot = Join-Path $RuntimeRoot 'deny-proxy'
    $rawLogRoot = Join-Path $RuntimeRoot 'raw-logs\deny-proxy'
    $null = New-Item -ItemType Directory -Path $proxyRoot -Force
    $null = New-Item -ItemType Directory -Path $rawLogRoot -Force
    $planPath = Join-Path $proxyRoot 'deny-proxy-plan.json'
    $proxyScriptPath = Join-Path $proxyRoot 'deny-proxy.ps1'
    $readyPath = Join-Path $proxyRoot 'deny-proxy-ready.json'
    $ledgerPath = Join-Path $proxyRoot 'deny-proxy-ledger.jsonl'
    $captureRecord = [pscustomobject][ordered]@{
        role = 'deny-proxy'
        process_launched = $false
        raw_stdout_path = Join-Path $rawLogRoot 'deny-proxy.stdout.raw.log'
        raw_stderr_path = Join-Path $rawLogRoot 'deny-proxy.stderr.raw.log'
        evidence_stdout_path = Join-Path $EvidenceRoot 'deny-proxy.stdout.log'
        evidence_stderr_path = Join-Path $EvidenceRoot 'deny-proxy.stderr.log'
        stream_publications = @()
        sanitized_logs_created = $false
        raw_logs_removed = $false
    }
    $Script:LogCaptures.Add($captureRecord) | Out-Null
    Write-JsonFile -LiteralPath $planPath -Value ([ordered]@{
        ready_path = $readyPath
        ledger_path = $ledgerPath
        hmac_key_base64 = [Convert]::ToBase64String($HmacKey)
    })
    $proxySource = @'
param([Parameter(Mandatory = $true)][string]$PlanPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$hmacKey = [Convert]::FromBase64String([string]$plan.hmac_key_base64)
function Get-TargetHmac {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)
    $algorithm = [Security.Cryptography.HMACSHA256]::new($hmacKey)
    try {
        return ([BitConverter]::ToString(
            $algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant()))
        )).Replace('-', '').ToLowerInvariant()
    }
    finally { $algorithm.Dispose() }
}
function Get-TargetDescription {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$RequestTarget)
    $targetValue = $RequestTarget
    if ($RequestTarget.StartsWith('[')) {
        $closingBracket = $RequestTarget.IndexOf(']')
        if ($closingBracket -gt 0) { $targetValue = $RequestTarget.Substring(1, $closingBracket - 1) }
    }
    else {
        $parsedUri = $null
        if ([Uri]::TryCreate($RequestTarget, [UriKind]::Absolute, [ref]$parsedUri)) {
            $targetValue = [string]$parsedUri.Host
        }
        elseif ($RequestTarget -match '^(?<name>[^:]+):\d+$') {
            $targetValue = [string]$Matches.name
        }
    }
    $parsedAddress = $null
    $targetKind = if ([Net.IPAddress]::TryParse($targetValue, [ref]$parsedAddress)) {
        if ($parsedAddress.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) {
            'IPV4_LITERAL'
        }
        else {
            'IPV6_LITERAL'
        }
    }
    elseif ($targetValue -match '^[A-Za-z0-9.-]+$' -and $targetValue.Contains('.')) {
        'HOSTNAME'
    }
    else {
        'UNKNOWN'
    }
    return [ordered]@{ kind = $targetKind; value = $targetValue }
}
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
try {
    $listener.Start()
    $listenerPort = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    [IO.File]::WriteAllText(
        [string]$plan.ready_path,
        (([ordered]@{
            process_id = $PID
            listen_address = '127.0.0.1'
            listen_port = $listenerPort
            ready_utc = [DateTime]::UtcNow.ToString('o')
        } | ConvertTo-Json -Compress) + [Environment]::NewLine),
        [Text.UTF8Encoding]::new($false)
    )
    while ($true) {
        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 25
            continue
        }
        $client = $listener.AcceptTcpClient()
        $connectionClosed = $false
        $method = 'UNKNOWN'
        $requestTarget = ''
        try {
            $client.ReceiveTimeout = 2000
            $stream = $client.GetStream()
            $requestBytes = [Collections.Generic.List[byte]]::new()
            while ($requestBytes.Count -lt 4096) {
                $nextByte = $stream.ReadByte()
                if ($nextByte -lt 0 -or $nextByte -eq 10) { break }
                if ($nextByte -ne 13) { $requestBytes.Add([byte]$nextByte) }
            }
            $requestLine = [Text.Encoding]::ASCII.GetString($requestBytes.ToArray())
            if ($requestLine -match '^(?<verb>[A-Za-z]+)\s+(?<target>\S+)') {
                $method = ([string]$Matches.verb).ToUpperInvariant()
                $requestTarget = [string]$Matches.target
            }
            $responseBytes = [Text.Encoding]::ASCII.GetBytes(
                "HTTP/1.1 502 Bad Gateway`r`nConnection: close`r`nContent-Length: 0`r`n`r`n"
            )
            $stream.Write($responseBytes, 0, $responseBytes.Length)
            $stream.Flush()
        }
        catch { }
        finally {
            $client.Close()
            $client.Dispose()
            $connectionClosed = $true
        }
        $targetDescription = Get-TargetDescription -RequestTarget $requestTarget
        $ledgerRecord = [ordered]@{
            timestamp_utc = [DateTime]::UtcNow.ToString('o')
            method = $method
            target_kind = [string]$targetDescription.kind
            target_hmac = Get-TargetHmac -Value ([string]$targetDescription.value)
            connection_closed = $connectionClosed
        }
        [IO.File]::AppendAllText(
            [string]$plan.ledger_path,
            (($ledgerRecord | ConvertTo-Json -Compress) + [Environment]::NewLine),
            [Text.UTF8Encoding]::new($false)
        )
    }
}
finally {
    $listener.Stop()
    [Array]::Clear($hmacKey, 0, $hmacKey.Length)
}
'@
    Write-Utf8NoBom -LiteralPath $proxyScriptPath -Value $proxySource

    $powershellCandidates = @(Get-Command powershell.exe -CommandType Application -ErrorAction SilentlyContinue)
    if ($powershellCandidates.Count -ne 1 -or $powershellCandidates[0].Source -isnot [string]) {
        throw 'DENY-PROXY-OWNERSHIP-INVALID'
    }
    $quotedProxyScriptPath = '"' + $proxyScriptPath.Replace('"', '\"') + '"'
    $quotedPlanPath = '"' + $planPath.Replace('"', '\"') + '"'
    $startedProcesses = @(Start-Process -FilePath ([string]$powershellCandidates[0].Source) -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $quotedProxyScriptPath, '-PlanPath', $quotedPlanPath
    ) -WorkingDirectory $RuntimeRoot -RedirectStandardOutput $captureRecord.raw_stdout_path `
        -RedirectStandardError $captureRecord.raw_stderr_path -WindowStyle Hidden -PassThru)
    if ($startedProcesses.Count -ne 1 -or
        $startedProcesses[0].GetType().FullName -cne 'System.Diagnostics.Process') {
        throw 'DENY-PROXY-OWNERSHIP-INVALID'
    }
    $proxyProcess = $startedProcesses[0]
    $captureRecord.process_launched = $true
    $null = Register-OwnedProcessObject -Process $proxyProcess -Role 'deny-proxy' -CaptureRecord $captureRecord
    $proxyCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($proxyProcess.Id)" -ErrorAction Stop
    if ($null -eq $proxyCim) { throw 'DENY-PROXY-OWNERSHIP-INVALID' }
    $proxyIdentity = Get-ProcessIdentity -CimProcess $proxyCim
    Register-OwnedProcessIdentity -Identity $proxyIdentity

    $readyDeadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $readyPath -PathType Leaf) -and [DateTime]::UtcNow -lt $readyDeadline) {
        $proxyProcess.Refresh()
        if ($proxyProcess.HasExited) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path -LiteralPath $readyPath -PathType Leaf)) {
        throw 'DENY-PROXY-OWNERSHIP-INVALID'
    }
    $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
    $proxyPort = [int]$ready.listen_port
    if ([int]$ready.process_id -ne [int]$proxyProcess.Id -or
        [string]$ready.listen_address -ne '127.0.0.1' -or $proxyPort -lt 1) {
        throw 'DENY-PROXY-OWNERSHIP-INVALID'
    }
    $proxyListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
        $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq $proxyPort -and
        $_.OwningProcess -eq $proxyProcess.Id
    })
    if ($proxyListeners.Count -ne 1) { throw 'DENY-PROXY-OWNERSHIP-INVALID' }
    $Script:AdditionalCleanupPorts = @($proxyPort)

    return [pscustomobject][ordered]@{
        process = $proxyProcess
        identity = $proxyIdentity
        port = $proxyPort
        ledger_path = $ledgerPath
        ownership_validated = $true
        listen_address = '127.0.0.1'
    }
}

function Publish-DenyProxyLedger {
    param(
        [Parameter(Mandatory = $true)]$ProxyState,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot
    )
    $records = @()
    if (Test-Path -LiteralPath $ProxyState.ledger_path -PathType Leaf) {
        $records = @(Get-Content -LiteralPath $ProxyState.ledger_path | Where-Object {
            -not [string]::IsNullOrWhiteSpace([string]$_)
        } | ForEach-Object { $_ | ConvertFrom-Json })
    }
    foreach ($record in $records) {
        if ([string]$record.target_kind -notin @('HOSTNAME', 'IPV4_LITERAL', 'IPV6_LITERAL', 'UNKNOWN') -or
            [string]::IsNullOrWhiteSpace([string]$record.target_hmac)) {
            throw 'DENY-PROXY-LEDGER-INVALID'
        }
    }
    $publishedLedgerPath = Join-Path $EvidenceRoot 'deny-proxy-ledger.jsonl'
    $ledgerText = if ($records.Count -eq 0) {
        ''
    }
    else {
        (($records | ForEach-Object { $_ | ConvertTo-Json -Compress }) -join [Environment]::NewLine) +
            [Environment]::NewLine
    }
    Write-Utf8NoBom -LiteralPath $publishedLedgerPath -Value $ledgerText
    $summary = [ordered]@{
        listen_address = [string]$ProxyState.listen_address
        listen_port = [int]$ProxyState.port
        ownership_validated = [bool]$ProxyState.ownership_validated
        hostname_attempt_count = @($records | Where-Object { $_.target_kind -eq 'HOSTNAME' }).Count
        ipv4_literal_attempt_count = @($records | Where-Object { $_.target_kind -eq 'IPV4_LITERAL' }).Count
        ipv6_literal_attempt_count = @($records | Where-Object { $_.target_kind -eq 'IPV6_LITERAL' }).Count
        unknown_attempt_count = @($records | Where-Object { $_.target_kind -eq 'UNKNOWN' }).Count
        total_attempt_count = $records.Count
    }
    Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot 'deny-proxy-summary.json') -Value $summary
    return $summary
}

function Assert-WebViewBrowserRoot {
    param(
        [Parameter(Mandatory = $true)]$OwnedProcesses,
        [Parameter(Mandatory = $true)][string]$WebViewDataDir,
        [Nullable[int]]$ExpectedProxyPort = $null
    )
    $webViews = @($OwnedProcesses | Where-Object { $_.name -ieq 'msedgewebview2.exe' })
    $browserRoots = @($webViews | Where-Object { $_.command_line -notmatch '(?:^|\s)--type=' })
    if ($browserRoots.Count -eq 0) { throw 'WEBVIEW2-BROWSER-ROOT-MISSING' }
    if ($browserRoots.Count -ne 1) { throw 'WEBVIEW2-BROWSER-ROOT-AMBIGUOUS' }
    $root = $browserRoots[0]
    $commandLine = [string]$root.command_line
    $hostFlags = @([regex]::Matches($commandLine, '--host-resolver-rules(?:=|\s)'))
    $backgroundFlags = @([regex]::Matches($commandLine, '--disable-background-networking(?:\s|$)'))
    $disableFeaturesFlags = @([regex]::Matches($commandLine, '--disable-features(?:=|\s)'))
    $componentUpdateFlags = @([regex]::Matches($commandLine, '--disable-component-update(?:\s|$)'))
    $noFirstRunFlags = @([regex]::Matches($commandLine, '--no-first-run(?:\s|$)'))
    $disableQuicFlags = @([regex]::Matches($commandLine, '--disable-quic(?:\s|$)'))
    $proxyServerFlags = @([regex]::Matches($commandLine, '--proxy-server(?:=|\s)'))
    $proxyBypassFlags = @([regex]::Matches($commandLine, '--proxy-bypass-list(?:=|\s)'))
    $conflictingProxyFlags = @([regex]::Matches($commandLine, '--(?:no-proxy-server|proxy-pac-url)(?:=|\s|$)'))

    $flagAudit = [ordered]@{
        disable_features_count = $disableFeaturesFlags.Count
        disable_background_count = $backgroundFlags.Count
        disable_component_update_count = $componentUpdateFlags.Count
        no_first_run_count = $noFirstRunFlags.Count
        disable_quic_count = $disableQuicFlags.Count
        proxy_server_count = $proxyServerFlags.Count
        proxy_bypass_count = $proxyBypassFlags.Count
        conflicting_proxy_count = $conflictingProxyFlags.Count + [Math]::Max(0, $proxyServerFlags.Count - 1)
        proxy_port_match = $false
        default_wry_disable_features_preserved = $commandLine -match '--disable-features(?:=|\s)[^\s\"]*msWebOOUI,msPdfOOUI,msSmartScreenProtection'
    }
    if ($null -ne $ExpectedProxyPort) {
        $expectedProxyText = "--proxy-server=http://127.0.0.1:$ExpectedProxyPort"
        $flagAudit.proxy_port_match = $commandLine.IndexOf(
            $expectedProxyText,
            [StringComparison]::OrdinalIgnoreCase
        ) -ge 0
        $requiredFlagsValid = $flagAudit.disable_features_count -eq 1 -and
            $flagAudit.disable_background_count -eq 1 -and
            $flagAudit.disable_component_update_count -eq 1 -and
            $flagAudit.no_first_run_count -eq 1 -and
            $flagAudit.disable_quic_count -eq 1 -and
            $flagAudit.proxy_server_count -eq 1 -and
            $flagAudit.proxy_bypass_count -eq 1 -and
            $flagAudit.conflicting_proxy_count -eq 0 -and
            $flagAudit.proxy_port_match -and
            $flagAudit.default_wry_disable_features_preserved
        if (-not $requiredFlagsValid) {
            throw 'BROWSER-ADDITIONAL-ARGS-NOT-APPLIED'
        }
    }
    else {
        if ($hostFlags.Count -ne 1 -or $backgroundFlags.Count -ne 1 -or
            $commandLine -notmatch 'MAP \* 127\.0\.0\.1, EXCLUDE localhost') {
            throw 'WEBVIEW2-BROWSER-FLAGS-MISSING'
        }
        if (@([regex]::Matches($commandLine, '--host-resolver-rules')).Count -ne 1) {
            throw 'CONFLICTING-WEBVIEW2-HOST-RESOLVER-RULES'
        }
    }
    if ($root.command_line.IndexOf($WebViewDataDir, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'WEBVIEW2-USER-DATA-DIR-MISMATCH'
    }
    $networkServices = @($webViews | Where-Object {
        $_.command_line -match '--type=utility' -and $_.command_line -match 'network\.mojom\.NetworkService'
    })
    return [ordered]@{
        browser_root = $root
        subprocess_count = $webViews.Count - 1
        network_services = $networkServices
        flag_audit = $flagAudit
        additional_args_present = if ($null -ne $ExpectedProxyPort) { [bool]$requiredFlagsValid } else { $true }
    }
}

function Monitor-WdioPhase {
    param(
        [Parameter(Mandatory = $true)]$RuntimeProcess,
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][string]$WebViewDataDir,
        [Parameter(Mandatory = $true)][Threading.Tasks.Task[string]]$StdoutTask,
        [Parameter(Mandatory = $true)][Threading.Tasks.Task[string]]$StderrTask,
        [Parameter(Mandatory = $true)]$CaptureRecord,
        [Nullable[int]]$ExpectedProxyPort = $null,
        [object[]]$AdditionalOwnedProcessIdentities = @()
    )
    $ownedByProcessId = @{}
    $connections = @()
    try {
        while (-not $RuntimeProcess.HasExited) {
            $RuntimeProcess.Refresh()
            $processTable = Get-ProcessTable
            foreach ($ownedProcessId in @($processTable.Keys)) {
                if (Test-ProcessDescendsFrom -ProcessId $ownedProcessId -RootProcessId $RuntimeProcess.Id `
                    -ProcessTable $processTable) {
                    $identity = Get-ProcessIdentity -CimProcess $processTable[$ownedProcessId]
                    $ownedByProcessId[$ownedProcessId] = $identity
                    Register-OwnedProcessIdentity -Identity $identity
                }
            }
            foreach ($additionalIdentity in @($AdditionalOwnedProcessIdentities)) {
                $additionalProcessId = [int]$additionalIdentity.process_id
                if (-not $processTable.ContainsKey($additionalProcessId)) {
                    throw 'DENY-PROXY-OWNERSHIP-INVALID'
                }
                $currentAdditionalIdentity = Get-ProcessIdentity -CimProcess $processTable[$additionalProcessId]
                $additionalIdentityMatches = [string]::Equals(
                    [string]$currentAdditionalIdentity.executable_path,
                    [string]$additionalIdentity.executable_path,
                    [StringComparison]::OrdinalIgnoreCase
                ) -and $currentAdditionalIdentity.creation_date -eq $additionalIdentity.creation_date
                if (-not $additionalIdentityMatches) {
                    throw 'DENY-PROXY-OWNERSHIP-INVALID'
                }
                $ownedByProcessId[$additionalProcessId] = $currentAdditionalIdentity
                Register-OwnedProcessIdentity -Identity $currentAdditionalIdentity
            }
            $ownedProcessIds = @($ownedByProcessId.Keys | ForEach-Object { [int]$_ })
            if ($ownedProcessIds.Count -gt 0) {
                foreach ($connection in @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
                    $_.OwningProcess -in $ownedProcessIds -and $_.State -ne 'Listen'
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
    }
    catch {
        $monitorMessage = ConvertTo-RedactedText -Value $_.Exception.Message
        $monitorAbort = $null
        try {
            $monitorAbort = Invoke-OwnedProcessShutdown -ProcessIdentities @($Script:OwnedProcessIdentities) `
                -ProcessObjectRecords @($Script:OwnedProcessObjects) -LogCaptures @($Script:LogCaptures) `
                -EvidenceRoot $EvidenceRoot `
                -RuntimeRoot $Script:ActiveRuntimeRoot -Stage "monitor-abort-$Phase" -StopRunning $true
            Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot "monitor-abort-$Phase.json") -Value $monitorAbort
        }
        catch {
            Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot "monitor-abort-$Phase.json") -Value ([ordered]@{
                status = 'FAILED'
                error_redacted = ConvertTo-RedactedText -Value $_.Exception.Message
            })
        }
        throw "WDIO-MONITOR-FAILURE: $monitorMessage"
    }
    $RuntimeProcess.WaitForExit()
    $RuntimeProcess.Refresh()
    if (-not $RuntimeProcess.HasExited) {
        throw 'WDIO-EXIT-CODE-CAPTURE-FAILED'
    }
    $RuntimeChildExitCode = [int]$RuntimeProcess.ExitCode
    Set-Variable -Name RuntimeChildExitCode -Value $RuntimeChildExitCode `
        -Option ReadOnly -Scope Local -Force
    [IO.File]::WriteAllText(
        (Join-Path $EvidenceRoot 'runtime-child-exit-code.txt'),
        [string]$RuntimeChildExitCode,
        [Text.UTF8Encoding]::new($false)
    )
    $Script:RuntimeChildExitCodes[$Phase] = $RuntimeChildExitCode
    $StdoutTask.Wait()
    $StderrTask.Wait()
    [IO.File]::WriteAllText([string]$CaptureRecord.raw_stdout_path, $StdoutTask.Result, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText([string]$CaptureRecord.raw_stderr_path, $StderrTask.Result, [Text.UTF8Encoding]::new($false))
    [int]$exitCode = $RuntimeChildExitCode
    $owned = @($ownedByProcessId.Values | Sort-Object process_id)
    Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot "owned-processes-$Phase.json") -Value $owned
    Write-JsonFile -LiteralPath (Join-Path $EvidenceRoot "owned-tcp-$Phase.json") -Value $connections

    $nonLoopback = @($connections | Where-Object {
        $_.remote_address -notin @('127.0.0.1', '::1', '0.0.0.0', '::')
    })
    $nonLoopbackTuples = @()
    foreach ($tupleGroup in @($nonLoopback | Group-Object {
        "$($_.owning_process)|$($_.remote_address)|$($_.remote_port)|$($_.state)"
    })) {
        $tupleSample = $tupleGroup.Group[0]
        $tupleOwnerIdentity = @($owned | Where-Object {
            [int]$_.process_id -eq [int]$tupleSample.owning_process
        }) | Select-Object -First 1
        $tupleTimesSorted = @($tupleGroup.Group | Sort-Object observed_at_utc)
        $nonLoopbackTuples += [ordered]@{
            phase = $Phase
            owning_process = [int]$tupleSample.owning_process
            process_role = if ($null -ne $tupleOwnerIdentity) { [string]$tupleOwnerIdentity.name } else { 'UNKNOWN' }
            ownership_evidence = if ($null -ne $tupleOwnerIdentity) { 'owned-process-identity-table' }
                else { 'pid-missing-from-owned-table' }
            remote_address = [string]$tupleSample.remote_address
            remote_port = [int]$tupleSample.remote_port
            tcp_state = [string]$tupleSample.state
            first_seen_utc = [string]$tupleTimesSorted[0].observed_at_utc
            last_seen_utc = [string]$tupleTimesSorted[-1].observed_at_utc
            observation_count = [int]$tupleGroup.Count
        }
    }
    $networkGatePath = Join-Path $EvidenceRoot "network-gate-$Phase.json"
    $networkGateRecord = [ordered]@{
        schema_version = 1
        network_gate_mode = [string]$NetworkGateMode
        phase = $Phase
        owned_non_loopback_tcp_connection_count = $nonLoopback.Count
        owned_non_loopback_tcp_tuples = $nonLoopbackTuples
        enforcement_action = if ($nonLoopback.Count -eq 0) { 'NONE' }
            elseif ($NetworkGateMode -eq 'Enforce') { 'ABORT' } else { 'OBSERVE-CONTINUE' }
        webview_gate_status = 'NOT RUN'
        webview_gate_error = $null
    }
    Write-JsonFile -LiteralPath $networkGatePath -Value $networkGateRecord
    if ($nonLoopback.Count -ne 0 -and $NetworkGateMode -eq 'Enforce') {
        throw 'UNEXPECTED-OWNED-PROCESS-NETWORK-CONNECTION'
    }
    $webViewResult = $null
    try {
        $webViewResult = Assert-WebViewBrowserRoot -OwnedProcesses $owned -WebViewDataDir $WebViewDataDir `
            -ExpectedProxyPort $ExpectedProxyPort
        $networkGateRecord.webview_gate_status = 'PASS'
    }
    catch {
        $networkGateRecord.webview_gate_error = ConvertTo-RedactedText -Value $_.Exception.Message
        if ($NetworkGateMode -ne 'Observe') {
            $networkGateRecord.webview_gate_status = 'FAILED'
            Write-JsonFile -LiteralPath $networkGatePath -Value $networkGateRecord
            throw
        }
        $networkGateRecord.webview_gate_status = 'OBSERVED-FAILED'
        $webViewResult = [ordered]@{
            browser_root = $null
            subprocess_count = $null
            network_services = @()
            flag_audit = $null
            additional_args_present = $false
        }
    }
    Write-JsonFile -LiteralPath $networkGatePath -Value $networkGateRecord
    if ($exitCode -ne 0) {
        throw "WDIO $Phase failed with exit $exitCode"
    }
    return [ordered]@{
        exit_code = $exitCode
        exit_code_capture = 'DIRECT-PROCESS-EXITCODE'
        exit_code_reconstruction = $false
        owned_processes = $owned
        connections = $connections
        webview = $webViewResult
    }
}

function New-WdioLaunchPlan {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('create', 'restart', 'startup')]
        [string]$Phase,
        [AllowNull()][string]$RequestedSpecPath = $null,
        [AllowNull()][string]$RuntimeRoot = $null
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

    $launchSpecPath = if ($Phase -eq 'startup') { $RequestedSpecPath } else { $SpecPath }
    if ([string]::IsNullOrWhiteSpace($launchSpecPath)) {
        throw 'WDIO-LAUNCH-SPEC-NOT-FOUND'
    }
    $resolvedSpec = @(Resolve-Path -LiteralPath $launchSpecPath -ErrorAction SilentlyContinue)
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
    $expectedResolvedSpecPath = [IO.Path]::GetFullPath($launchSpecPath)
    $specScopeMatches = $resolvedSpecPath.Equals($expectedResolvedSpecPath, [StringComparison]::OrdinalIgnoreCase)
    if ($Phase -eq 'startup') {
        if ([string]::IsNullOrWhiteSpace($RuntimeRoot)) { throw 'WDIO-LAUNCH-SPEC-MISMATCH' }
        $runtimePrefixPath = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\') + '\'
        $specScopeMatches = $specScopeMatches -and
            $resolvedSpecPath.StartsWith($runtimePrefixPath, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedSpecPath) -eq 'startup-probe.spec.ts'
    }
    else {
        $specScopeMatches = $specScopeMatches -and
            $resolvedSpecPath.Equals([IO.Path]::GetFullPath($SpecPath), [StringComparison]::OrdinalIgnoreCase)
    }
    if (-not $specScopeMatches -or -not (Test-Path -LiteralPath $resolvedSpecPath -PathType Leaf)) {
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
        [Parameter(Mandatory = $true)][string]$WebViewDataDir,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Nullable[int]]$ExpectedProxyPort = $null,
        [object[]]$AdditionalOwnedProcessIdentities = @()
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
    if ($Phase -notin @('create', 'restart', 'startup')) {
        throw 'WDIO-LAUNCH-PHASE-MISMATCH'
    }
    if ($WorkingDirectory -isnot [string] -or
        -not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        throw 'WDIO-LAUNCH-WORKING-DIRECTORY-MISMATCH'
    }

    $env:IMPORT_DELETE_PHASE = $Phase
    $env:EVIDENCE_ROOT = $PhaseEvidenceRoot
    $rawLogRoot = Join-Path $RuntimeRoot "raw-logs\$Phase"
    $null = New-Item -ItemType Directory -Path $rawLogRoot -Force
    $captureRecord = [pscustomobject][ordered]@{
        role = "wdio-$Phase"
        process_launched = $false
        raw_stdout_path = Join-Path $rawLogRoot 'wdio.stdout.raw.log'
        raw_stderr_path = Join-Path $rawLogRoot 'wdio.stderr.raw.log'
        evidence_stdout_path = Join-Path $PhaseEvidenceRoot 'wdio.stdout.log'
        evidence_stderr_path = Join-Path $PhaseEvidenceRoot 'wdio.stderr.log'
        stream_publications = @()
        sanitized_logs_created = $false
        raw_logs_removed = $false
    }
    $Script:LogCaptures.Add($captureRecord) | Out-Null
    $commandParts = @('"' + $FilePath.Replace('"', '""') + '"')
    foreach ($argument in $ArgumentList) {
        $commandParts += '"' + $argument.Replace('"', '""') + '"'
    }
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $env:ComSpec
    $startInfo.Arguments = '/d /s /c "' + ($commandParts -join ' ') + '"'
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'WDIO-MONITOR-FAILURE: process start returned false' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $captureRecord.process_launched = $true
    $null = Register-OwnedProcessObject -Process $process -Role "wdio-$Phase" -CaptureRecord $captureRecord
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    if ($null -eq $cim) { throw 'WDIO-MONITOR-FAILURE: launcher identity unavailable immediately after start' }
    Register-OwnedProcessIdentity -Identity (Get-ProcessIdentity -CimProcess $cim)

    $phaseResult = $null
    $phaseFailureRecord = $null
    $lifecycleFailureRecord = $null
    try {
        $phaseResult = Monitor-WdioPhase -RuntimeProcess $process -EvidenceRoot $PhaseEvidenceRoot `
            -Phase $Phase -WebViewDataDir $WebViewDataDir -ExpectedProxyPort $ExpectedProxyPort `
            -StdoutTask $stdoutTask -StderrTask $stderrTask -CaptureRecord $captureRecord `
            -AdditionalOwnedProcessIdentities $AdditionalOwnedProcessIdentities
    }
    catch {
        $phaseFailureRecord = $_
    }
    finally {
        try {
            $phaseLifecycle = Invoke-OwnedProcessShutdown -ProcessIdentities @($Script:OwnedProcessIdentities) `
                -ProcessObjectRecords @($Script:OwnedProcessObjects) -LogCaptures @($Script:LogCaptures) `
                -EvidenceRoot $PhaseEvidenceRoot `
                -RuntimeRoot $RuntimeRoot -Stage "phase-end-$Phase" -StopRunning $true
            Write-JsonFile -LiteralPath (Join-Path $PhaseEvidenceRoot "owned-process-lifecycle-$Phase.json") -Value $phaseLifecycle
        }
        catch {
            $lifecycleFailureRecord = $_
        }
    }
    if ($null -ne $phaseFailureRecord) { throw $phaseFailureRecord }
    if ($null -ne $lifecycleFailureRecord) {
        throw ('WDIO-MONITOR-FAILURE: lifecycle finalization failed: ' +
            (ConvertTo-RedactedText -Value $lifecycleFailureRecord.Exception.Message))
    }
    return $phaseResult
}

function Set-ProcessEnvironment {
    param([Parameter(Mandatory = $true)]$Values)
    $previous = @{}
    foreach ($name in $Values.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        $nextValue = $Values[$name]
        if ($null -eq $nextValue) {
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        else {
            [Environment]::SetEnvironmentVariable($name, [string]$nextValue, 'Process')
        }
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
            $restoredValueMatches = if ($null -eq $Previous[$name]) { $null -eq $current } else { $current -ceq $Previous[$name] }
            $results += [ordered]@{
                name = [string]$name
                restored = [bool]$restoredValueMatches
                status = if ($restoredValueMatches) { 'PASS' } else { 'FAILED' }
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

function Test-SqliteReadOnlyOpenClose {
    param([Parameter(Mandatory = $true)][string]$DatabasePath)
    if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) {
        return [ordered]@{ status = 'NOT_PRESENT'; success = $true }
    }
    $probeCode = @'
import pathlib, sqlite3, sys
p = pathlib.Path(sys.argv[1]).resolve()
c = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True, timeout=0.2)
c.execute('PRAGMA schema_version').fetchone()
c.close()
'@
    $probeOutput = @(& py -3 -c $probeCode $DatabasePath 2>&1)
    $probeExitCode = $LASTEXITCODE
    return [ordered]@{
        status = if ($probeExitCode -eq 0) { 'PASS' } else { 'FAILED' }
        success = $probeExitCode -eq 0
        error_code = if ($probeExitCode -eq 0) { $null } else { 'RUNTIME-DATABASE-READONLY-OPEN-FAILED' }
    }
}

function Invoke-RuntimeUnlockGate {
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)]$LogCaptures,
        [Parameter(Mandatory = $true)][byte[]]$HmacKey,
        [int]$MaximumAttempts = 5,
        [int]$DelayMilliseconds = 200
    )
    $attempts = @()
    $lockedFileProbeCount = 0
    $persistentlyLockedFiles = @()
    $databasePath = Join-Path $RuntimeRoot 'data\ytm-free.db'
    for ($attemptNumber = 1; $attemptNumber -le $MaximumAttempts; $attemptNumber++) {
        $lockedFiles = [Collections.Generic.List[string]]::new()
        foreach ($captureRecord in @($LogCaptures)) {
            foreach ($rawLogPath in @($captureRecord.raw_stdout_path, $captureRecord.raw_stderr_path)) {
                if (-not (Test-Path -LiteralPath $rawLogPath -PathType Leaf)) { continue }
                $lockedFileProbeCount++
                if (-not (Test-FileExclusiveAccess -LiteralPath $rawLogPath)) {
                    $lockedFiles.Add([IO.Path]::GetFullPath($rawLogPath)) | Out-Null
                }
            }
        }
        $databasePresent = Test-Path -LiteralPath $databasePath -PathType Leaf
        $databaseExclusive = $true
        if ($databasePresent) {
            $lockedFileProbeCount++
            $databaseExclusive = Test-FileExclusiveAccess -LiteralPath $databasePath
            if (-not $databaseExclusive) {
                $lockedFiles.Add([IO.Path]::GetFullPath($databasePath)) | Out-Null
            }
        }
        $databaseReadOnly = Test-SqliteReadOnlyOpenClose -DatabasePath $databasePath
        $lockedRelativePathHmacs = @($lockedFiles | Sort-Object -Unique | ForEach-Object {
            $lockedRelativePath = (Get-RelativePathPortable -BasePath $RuntimeRoot -ChildPath $_).Replace('\', '/')
            Get-HmacHex -Key $HmacKey -Value $lockedRelativePath.ToLowerInvariant()
        })
        $attemptPassed = $lockedFiles.Count -eq 0 -and $databaseReadOnly.success
        $attempts += [ordered]@{
            attempt = $attemptNumber
            timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
            locked_file_count = $lockedFiles.Count
            locked_relative_path_hmacs = $lockedRelativePathHmacs
            database_exclusive_access = [bool]$databaseExclusive
            database_read_only_open_close = [string]$databaseReadOnly.status
            status = if ($attemptPassed) { 'PASS' } else { 'RETRY' }
        }
        if ($attemptPassed) {
            return [ordered]@{
                status = 'PASS'
                error_code = $null
                attempts = $attempts
                locked_file_probe_count = $lockedFileProbeCount
                persistently_locked_file_count = 0
                persistently_locked_relative_path_hmacs = @()
            }
        }
        $persistentlyLockedFiles = @($lockedFiles | Sort-Object -Unique)
        if ($attemptNumber -lt $MaximumAttempts) { Start-Sleep -Milliseconds $DelayMilliseconds }
    }
    $attempts[-1].status = 'FAILED'
    $persistentlyLockedRelativePathHmacs = @($persistentlyLockedFiles | ForEach-Object {
        $persistentlyLockedRelativePath = (Get-RelativePathPortable -BasePath $RuntimeRoot -ChildPath $_).Replace('\', '/')
        Get-HmacHex -Key $HmacKey -Value $persistentlyLockedRelativePath.ToLowerInvariant()
    })
    return [ordered]@{
        status = 'FAILED'
        error_code = if ($persistentlyLockedFiles.Count -gt 0) {
            'RUNTIME-FILE-LOCK-PERSISTED'
        }
        else {
            'RUNTIME-UNLOCK-GATE-FAILED'
        }
        attempts = $attempts
        locked_file_probe_count = $lockedFileProbeCount
        persistently_locked_file_count = $persistentlyLockedFiles.Count
        persistently_locked_relative_path_hmacs = $persistentlyLockedRelativePathHmacs
    }
}

function Get-EvidenceInventory {
    param(
        [Parameter(Mandatory = $true)][string]$EvidenceRoot,
        [Parameter(Mandatory = $true)][byte[]]$HmacKey,
        [string[]]$ExcludeRelativePaths = @()
    )
    $exclusions = @($ExcludeRelativePaths | ForEach-Object { $_.Replace('\', '/') })
    $entries = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse -Force | Sort-Object FullName)) {
        $relativePath = (Get-RelativePathPortable -BasePath $EvidenceRoot -ChildPath $file.FullName).Replace('\', '/')
        if ($relativePath -in $exclusions) { continue }
        $relativePathHmac = Get-HmacHex -Key $HmacKey -Value $relativePath.ToLowerInvariant()
        try {
            $entries += [ordered]@{
                relative_path = $relativePath
                relative_path_hmac = $relativePathHmac
                size = [int64]$file.Length
                hash_status = 'OK'
                sha256 = Get-Sha256 -LiteralPath $file.FullName
                error_code = $null
            }
        }
        catch {
            $entries += [ordered]@{
                relative_path_hmac = $relativePathHmac
                size = [int64]$file.Length
                hash_status = 'UNREADABLE'
                sha256 = $null
                error_code = 'EVIDENCE-FILE-UNREADABLE'
            }
        }
    }
    return $entries
}

function Add-FinalizationFailure {
    param(
        [Parameter(Mandatory = $true)]$List,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$ExceptionType = 'HarnessFinalizationFailure',
        [AllowNull()][string]$FailureCode
    )
    if ([string]::IsNullOrWhiteSpace($FailureCode)) {
        foreach ($stopCondition in $StopConditions) {
            if ($Message -match [regex]::Escape($stopCondition)) {
                $FailureCode = $stopCondition
                break
            }
        }
    }
    if ([string]::IsNullOrWhiteSpace($FailureCode)) {
        $FailureCode = 'UNCLASSIFIED-FINALIZATION-FAILURE'
    }
    $List.Add([ordered]@{
        failure_code = $FailureCode
        stage = $Stage
        exception_type = $ExceptionType
        message_redacted = ConvertTo-RedactedText -Value $Message
        timestamp_utc = (Get-Date).ToUniversalTime().ToString('o')
    }) | Out-Null
}

function Add-FinalizationFailureOnce {
    param(
        [Parameter(Mandatory = $true)]$List,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$FailureCode,
        [Parameter(Mandatory = $true)][string]$Message,
        [string]$ExceptionType = 'HarnessFinalizationFailure'
    )
    if (@($List | Where-Object {
        $_.failure_code -eq $FailureCode -and $_.stage -eq $Stage
    }).Count -eq 0) {
        Add-FinalizationFailure -List $List -Stage $Stage -Message $Message `
            -ExceptionType $ExceptionType -FailureCode $FailureCode
    }
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

function Get-WrapperOutcomeClassification {
    param(
        [Parameter(Mandatory = $true)][int]$ChildExitCode,
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'FAILED')][string]$MetadataStatus,
        [Parameter(Mandatory = $true)][ValidateSet('PASS', 'FAILED')][string]$CleanupStatus
    )

    $childStatus = if ($ChildExitCode -eq 0) { 'PASS' } else { 'FAILED' }
    $wrapperStatus = if ($MetadataStatus -eq 'PASS' -and $CleanupStatus -eq 'PASS') {
        'PASS'
    }
    else {
        'FAILED'
    }
    $classification = 'PASS'
    if ($childStatus -eq 'FAILED') {
        $classification = 'CHILD-FAILED'
    }
    elseif ($MetadataStatus -eq 'FAILED') {
        $classification = 'WRAPPER-METADATA-FAILED'
    }
    elseif ($CleanupStatus -eq 'FAILED') {
        $classification = 'WRAPPER-CLEANUP-FAILED'
    }

    return [ordered]@{
        child_exit_code = $ChildExitCode
        child_status = $childStatus
        metadata_status = $MetadataStatus
        cleanup_status = $CleanupStatus
        wrapper_status = $wrapperStatus
        classification = $classification
        child_exit_capture = 'DIRECT-PROCESS-EXITCODE'
        child_exit_reconstruction = $false
    }
}

function Invoke-WrapperFailureSeparationValidation {
    $metadataFailure = Get-WrapperOutcomeClassification -ChildExitCode 0 `
        -MetadataStatus 'FAILED' -CleanupStatus 'PASS'
    $childFailure = Get-WrapperOutcomeClassification -ChildExitCode 1 `
        -MetadataStatus 'PASS' -CleanupStatus 'PASS'
    $cleanupFailure = Get-WrapperOutcomeClassification -ChildExitCode 0 `
        -MetadataStatus 'PASS' -CleanupStatus 'FAILED'

    if ($metadataFailure.child_status -ne 'PASS' -or
        $metadataFailure.wrapper_status -ne 'FAILED' -or
        $metadataFailure.classification -ne 'WRAPPER-METADATA-FAILED') {
        throw 'WRAPPER-EXIT0-METADATA-FAILURE-CLASSIFICATION-MISMATCH'
    }
    if ($childFailure.child_status -ne 'FAILED' -or
        $childFailure.wrapper_status -ne 'PASS' -or
        $childFailure.classification -ne 'CHILD-FAILED') {
        throw 'WRAPPER-EXIT1-METADATA-SUCCESS-CLASSIFICATION-MISMATCH'
    }
    if ($cleanupFailure.child_status -ne 'PASS' -or
        $cleanupFailure.wrapper_status -ne 'FAILED' -or
        $cleanupFailure.classification -ne 'WRAPPER-CLEANUP-FAILED') {
        throw 'WRAPPER-EXIT0-CLEANUP-FAILURE-CLASSIFICATION-MISMATCH'
    }

    return [ordered]@{
        RUNTIME_CHILD_EXIT_CAPTURE = 'DIRECT-PROCESS-EXITCODE'
        RUNTIME_CHILD_EXIT_RECONSTRUCTION = $false
        WRAPPER_EXIT0_METADATA_FAILURE_TEST = 'PASS'
        WRAPPER_EXIT1_METADATA_SUCCESS_TEST = 'PASS'
        WRAPPER_EXIT0_CLEANUP_FAILURE_TEST = 'PASS'
        metadata_failure = $metadataFailure
        child_failure = $childFailure
        cleanup_failure = $cleanupFailure
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
        [Parameter(Mandatory = $true)]$OwnedProcessObjects,
        [Parameter(Mandatory = $true)]$LogCaptures,
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
    $processLifecycle = $null
    $processWaitStatus = 'UNKNOWN'
    $processObjectDisposeStatus = 'UNKNOWN'
    $logHandleReleaseStatus = 'UNKNOWN'
    $rawLogCleanupStatus = 'UNKNOWN'
    $sanitizedLogStatus = 'UNKNOWN'
    $runtimeUnlockResult = [ordered]@{
        status = 'NOT_RUN'
        error_code = $null
        attempts = @()
        locked_file_probe_count = 0
        persistently_locked_file_count = 0
        persistently_locked_relative_path_hmacs = @()
    }
    $logPublicationRecords = @()
    $clearPathMatchCount = 0
    $evidenceSanitization = $null
    $unreadableEvidenceCount = 0
    $contextRuntimeChildExitCodes = [ordered]@{}
    if ($Context -is [Collections.IDictionary] -and $Context.Contains('runtime_child_exit_codes')) {
        $contextRuntimeChildExitCodes = $Context.runtime_child_exit_codes
    }

    try {
        $processLifecycle = Invoke-OwnedProcessShutdown -ProcessIdentities $OwnedProcessIdentities `
            -ProcessObjectRecords $OwnedProcessObjects -LogCaptures $LogCaptures `
            -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot `
            -Stage 'finalizer' -StopRunning $true
        $ownedProcessCleanupResults = @($processLifecycle.stop_results)
        $ownedProcessCleanupStatus = if ($processLifecycle.all_processes_exited) { 'PASS' } else { 'FAILED' }
        $processWaitStatus = if ($processLifecycle.all_process_waits_completed) { 'PASS' } else { 'FAILED' }
        $processObjectDisposeStatus = if ($processLifecycle.all_process_objects_disposed) { 'PASS' } else { 'FAILED' }
        $logHandleReleaseStatus = if ($processLifecycle.all_log_handles_released) { 'PASS' } else { 'FAILED' }
        if ($ownedProcessCleanupStatus -ne 'PASS' -or $processWaitStatus -ne 'PASS' -or
            $processObjectDisposeStatus -ne 'PASS' -or $logHandleReleaseStatus -ne 'PASS') {
            Add-FinalizationFailure -List $finalizationFailures -Stage 'owned-process-lifecycle' `
                -Message 'OWNED-PROCESS-WAIT-OR-HANDLE-RELEASE-INCOMPLETE'
        }
    }
    catch {
        $ownedProcessCleanupStatus = 'FAILED'
        $processWaitStatus = 'FAILED'
        $processObjectDisposeStatus = 'FAILED'
        $logHandleReleaseStatus = 'FAILED'
        Add-FinalizationFailure -List $finalizationFailures -Stage 'owned-process-lifecycle' `
            -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
    }

    try {
        $runtimeUnlockResult = Invoke-RuntimeUnlockGate -RuntimeRoot $RuntimeRoot -LogCaptures $LogCaptures `
            -HmacKey $HmacKey
        if ($runtimeUnlockResult.status -ne 'PASS') {
            Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'runtime-unlock-gate' `
                -FailureCode ([string]$runtimeUnlockResult.error_code) `
                -Message ([string]$runtimeUnlockResult.error_code)
        }
    }
    catch {
        $runtimeUnlockResult = [ordered]@{
            status = 'FAILED'
            error_code = 'RUNTIME-UNLOCK-GATE-FAILED'
            attempts = @()
            locked_file_probe_count = 0
            persistently_locked_file_count = 0
            persistently_locked_relative_path_hmacs = @()
        }
        Add-FinalizationFailure -List $finalizationFailures -Stage 'runtime-unlock-gate' `
            -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName `
            -FailureCode 'RUNTIME-UNLOCK-GATE-FAILED'
    }

    if ($logHandleReleaseStatus -eq 'PASS' -and
        [int]$runtimeUnlockResult.persistently_locked_file_count -eq 0) {
        foreach ($captureRecord in @($LogCaptures)) {
            try {
                Publish-SanitizedLogCapture -CaptureRecord $captureRecord -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
            }
            catch {
                $publicationFailureCode = if ($_.Exception.Message -match 'RAW-LOG-CLEANUP-FAILED') {
                    'RAW-LOG-CLEANUP-FAILED'
                }
                else {
                    'SANITIZED-LOG-PUBLICATION-FAILED'
                }
                Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'sanitized-log-publication' `
                    -FailureCode $publicationFailureCode -Message $publicationFailureCode `
                    -ExceptionType $_.Exception.GetType().FullName
            }
        }
    }
    $logPublicationRecords = @($LogCaptures | ForEach-Object { @($_.stream_publications) })
    $failedPublicationRecords = @($logPublicationRecords | Where-Object { $_.publication_status -eq 'FAILED' })
    $failedRawCleanupRecords = @($logPublicationRecords | Where-Object { $_.raw_cleanup_status -eq 'FAILED' })
    $retainedRawRecords = @($logPublicationRecords | Where-Object { $_.raw_cleanup_status -eq 'NOT_ATTEMPTED' })
    $rawLogCleanupStatus = if ($failedRawCleanupRecords.Count -gt 0) {
        'FAILED'
    }
    elseif ($retainedRawRecords.Count -gt 0) {
        'SKIPPED'
    }
    else {
        'PASS'
    }
    $sanitizedLogStatus = if ($failedPublicationRecords.Count -eq 0) { 'PASS' } else { 'FAILED' }
    if ($sanitizedLogStatus -eq 'FAILED') {
        Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'sanitized-log-publication' `
            -FailureCode 'SANITIZED-LOG-PUBLICATION-FAILED' -Message 'SANITIZED-LOG-PUBLICATION-FAILED'
    }
    if ($rawLogCleanupStatus -eq 'FAILED') {
        Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'raw-log-cleanup' `
            -FailureCode 'RAW-LOG-CLEANUP-FAILED' -Message 'RAW-LOG-CLEANUP-FAILED'
    }

    if ($null -ne $EnvironmentBefore) {
        try {
            $environmentRestoreResults = @(Restore-ProcessEnvironment -Previous $EnvironmentBefore)
            $environmentRestoreStatus = if (@($environmentRestoreResults | Where-Object { $_.status -ne 'PASS' }).Count -eq 0) {
                'PASS'
            }
            else { 'FAILED' }
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

    if ($runtimeUnlockResult.status -eq 'PASS' -and $ownedProcessCleanupStatus -eq 'PASS' -and
        $processObjectDisposeStatus -eq 'PASS' -and $logHandleReleaseStatus -eq 'PASS' -and
        $sanitizedLogStatus -eq 'PASS' -and $rawLogCleanupStatus -eq 'PASS') {
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
    }
    else {
        $runtimeRootCleanupStatus = 'FAILED'
        if ([int]$runtimeUnlockResult.persistently_locked_file_count -gt 0) {
            Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'runtime-root-cleanup' `
                -FailureCode 'RUNTIME-FILE-LOCK-PERSISTED' -Message 'RUNTIME-FILE-LOCK-PERSISTED'
        }
        else {
            Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'runtime-root-cleanup' `
                -FailureCode 'RUNTIME-ROOT-CLEANUP-INCOMPLETE' -Message 'RUNTIME-ROOT-CLEANUP-INCOMPLETE'
        }
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
        process_wait_status = $processWaitStatus
        process_object_dispose_status = $processObjectDisposeStatus
        log_handle_release_status = $logHandleReleaseStatus
        raw_log_cleanup_status = $rawLogCleanupStatus
        sanitized_log_status = $sanitizedLogStatus
        log_publications = $logPublicationRecords
        runtime_unlock_status = $runtimeUnlockResult
        locked_file_probe_count = [int]$runtimeUnlockResult.locked_file_probe_count
        persistently_locked_file_count = [int]$runtimeUnlockResult.persistently_locked_file_count
        persistently_locked_relative_path_hmacs = @($runtimeUnlockResult.persistently_locked_relative_path_hmacs)
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

    try {
        $evidenceSanitization = Invoke-EvidenceSanitization -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
        $clearPathMatchCount = [int]$evidenceSanitization.clear_personal_path_match_count
        if ($clearPathMatchCount -ne 0) {
            Add-FinalizationFailure -List $finalizationFailures -Stage 'evidence-redaction' `
                -Message 'CLEAR-PERSONAL-PATH-IN-EVIDENCE'
        }
        if ($evidenceSanitization.unreadable_files.Count -ne 0) {
            Add-FinalizationFailure -List $finalizationFailures -Stage 'evidence-redaction' `
                -Message 'EVIDENCE-FILE-UNREADABLE'
        }
    }
    catch {
        Add-FinalizationFailure -List $finalizationFailures -Stage 'evidence-redaction' `
            -Message $_.Exception.Message -ExceptionType $_.Exception.GetType().FullName
    }

    $mandatoryEvidencePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $notApplicableEvidencePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($mandatoryEvidencePath in @('.step6r3b1-owned.json', 'owned-process-final-snapshot-finalizer.json', 'cleanup-ledger.json')) {
        $mandatoryEvidencePaths.Add($mandatoryEvidencePath) | Out-Null
    }
    if ($null -ne $PrimaryFailure) { $mandatoryEvidencePaths.Add('primary-failure.json') | Out-Null }
    if ($null -ne $PrivacyBefore) {
        foreach ($privacySurface in $PrivacyBefore.Keys) {
            $mandatoryEvidencePaths.Add("privacy-$privacySurface-after.json") | Out-Null
        }
        $mandatoryEvidencePaths.Add('privacy-comparison.json') | Out-Null
    }
    if ($null -ne $ProtectedBefore) {
        $mandatoryEvidencePaths.Add('protected-files-after.json') | Out-Null
        $mandatoryEvidencePaths.Add('protected-files-comparison.json') | Out-Null
    }
    if ($Context -is [Collections.IDictionary] -and $Context.Contains('mandatory_evidence_relative_paths')) {
        foreach ($contextMandatoryPath in @($Context.mandatory_evidence_relative_paths)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$contextMandatoryPath)) {
                $mandatoryEvidencePaths.Add(([string]$contextMandatoryPath).Replace('\', '/')) | Out-Null
            }
        }
    }
    if ($Context -is [Collections.IDictionary] -and $Context.Contains('not_applicable_evidence_relative_paths')) {
        foreach ($contextNotApplicablePath in @($Context.not_applicable_evidence_relative_paths)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$contextNotApplicablePath)) {
                $notApplicableEvidencePaths.Add(([string]$contextNotApplicablePath).Replace('\', '/')) | Out-Null
            }
        }
    }
    foreach ($captureRecord in @($LogCaptures)) {
        $captureProcessLaunched = $null -ne $captureRecord.PSObject.Properties['process_launched'] -and
            [bool]$captureRecord.process_launched
        foreach ($evidenceLogPath in @($captureRecord.evidence_stdout_path, $captureRecord.evidence_stderr_path)) {
            $relativeEvidenceLogPath = (Get-RelativePathPortable -BasePath $EvidenceRoot -ChildPath $evidenceLogPath).Replace('\', '/')
            if ($captureProcessLaunched) {
                $mandatoryEvidencePaths.Add($relativeEvidenceLogPath) | Out-Null
            }
            else {
                $notApplicableEvidencePaths.Add($relativeEvidenceLogPath) | Out-Null
            }
        }
    }
    foreach ($mandatoryEvidencePath in @($mandatoryEvidencePaths)) {
        $notApplicableEvidencePaths.Remove($mandatoryEvidencePath) | Out-Null
    }

    $missingMandatoryPaths = @($mandatoryEvidencePaths | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $EvidenceRoot $_) -PathType Leaf)
    })
    if ($missingMandatoryPaths.Count -gt 0) {
        Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'evidence-completeness' `
            -FailureCode 'MANDATORY-EVIDENCE-MISSING' -Message 'MANDATORY-EVIDENCE-MISSING'
    }

    $cleanupLedger.finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
    Write-JsonFile -LiteralPath $cleanupLedgerPath -Value $cleanupLedger
    $evidenceSanitization = Invoke-EvidenceSanitization -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
    $clearPathMatchCount = [int]$evidenceSanitization.clear_personal_path_match_count
    if ($clearPathMatchCount -ne 0) {
        Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'evidence-redaction' `
            -FailureCode 'CLEAR-PERSONAL-PATH-IN-EVIDENCE' -Message 'CLEAR-PERSONAL-PATH-IN-EVIDENCE'
        $cleanupLedger.finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
        Write-JsonFile -LiteralPath $cleanupLedgerPath -Value $cleanupLedger
    }

    $inventoryPath = Join-Path $EvidenceRoot 'final-evidence-inventory.json'
    $manifestPath = Join-Path $EvidenceRoot 'final-manifest.json'
    $inventoryExclusions = @('final-evidence-inventory.json', 'final-manifest.json')
    $inventory = @(Get-EvidenceInventory -EvidenceRoot $EvidenceRoot -HmacKey $HmacKey `
        -ExcludeRelativePaths $inventoryExclusions)
    $unreadableEvidenceCount = @($inventory | Where-Object { $_.hash_status -ne 'OK' }).Count
    if ($unreadableEvidenceCount -ne 0) {
        Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'evidence-inventory' `
            -FailureCode 'EVIDENCE-FILE-UNREADABLE' -Message 'EVIDENCE-FILE-UNREADABLE'
        $cleanupLedger.finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
        Write-JsonFile -LiteralPath $cleanupLedgerPath -Value $cleanupLedger
        $inventory = @(Get-EvidenceInventory -EvidenceRoot $EvidenceRoot -HmacKey $HmacKey `
            -ExcludeRelativePaths $inventoryExclusions)
        $unreadableEvidenceCount = @($inventory | Where-Object { $_.hash_status -ne 'OK' }).Count
    }

    $evidenceRequirements = @()
    foreach ($mandatoryEvidencePath in @($mandatoryEvidencePaths | Sort-Object)) {
        $mandatoryPathHmac = Get-HmacHex -Key $HmacKey -Value $mandatoryEvidencePath.ToLowerInvariant()
        $matchingInventoryEntries = @($inventory | Where-Object { $_.relative_path_hmac -eq $mandatoryPathHmac })
        $requirementStatus = if ($matchingInventoryEntries.Count -eq 0) {
            'MISSING'
        }
        elseif ($matchingInventoryEntries[0].hash_status -ne 'OK') {
            'UNREADABLE'
        }
        else {
            'PRODUCED'
        }
        $evidenceRequirements += [ordered]@{
            relative_path = $mandatoryEvidencePath
            phase_requirement = 'REACHED'
            status = $requirementStatus
        }
    }
    foreach ($notApplicableEvidencePath in @($notApplicableEvidencePaths | Sort-Object)) {
        $evidenceRequirements += [ordered]@{
            relative_path = $notApplicableEvidencePath
            phase_requirement = 'NOT_REACHED'
            status = 'NOT_APPLICABLE'
        }
    }
    $missingMandatoryEvidenceCount = @($evidenceRequirements | Where-Object {
        $_.phase_requirement -eq 'REACHED' -and $_.status -ne 'PRODUCED'
    }).Count
    $publicationFailureCount = @($logPublicationRecords | Where-Object {
        $_.publication_status -eq 'FAILED'
    }).Count
    $evidenceCompleteness = if ($unreadableEvidenceCount -eq 0 -and
        $publicationFailureCount -eq 0 -and $missingMandatoryEvidenceCount -eq 0 -and
        $clearPathMatchCount -eq 0) {
        'COMPLETE'
    }
    else {
        'INCOMPLETE'
    }

    Write-JsonFile -LiteralPath $inventoryPath -Value ([ordered]@{
        schema_version = 1
        excluded_relative_paths = $inventoryExclusions
        unreadable_entry_count = $unreadableEvidenceCount
        entries = $inventory
    })
    $inventorySha256 = Get-Sha256 -LiteralPath $inventoryPath

    $cleanupStatus = if ($environmentRestoreStatus -notin @('FAILED') -and
        $ownedProcessCleanupStatus -eq 'PASS' -and
        $processWaitStatus -eq 'PASS' -and
        $processObjectDisposeStatus -eq 'PASS' -and
        $logHandleReleaseStatus -eq 'PASS' -and
        $rawLogCleanupStatus -eq 'PASS' -and
        $runtimeUnlockResult.status -eq 'PASS' -and
        $portReleaseStatus -eq 'PASS' -and
        $runtimeRootCleanupStatus -eq 'PASS' -and
        $evidenceRootPreserved) { 'PASS' } else { 'FAILED' }
    $runStatus = if ($null -ne $PrimaryFailure) {
        'FAILED'
    }
    elseif ($cleanupStatus -eq 'PASS' -and $evidenceCompleteness -eq 'COMPLETE') {
        'PASS'
    }
    else {
        'BLOCKED'
    }
    $manifest = [ordered]@{
        run_status = $runStatus
        primary_failure = $PrimaryFailure
        runtime_child_exit_capture = 'DIRECT-PROCESS-EXITCODE'
        runtime_child_exit_reconstruction = $false
        runtime_child_exit_codes = $contextRuntimeChildExitCodes
        wrapper_status = if ($finalizationFailures.Count -eq 0) { 'PASS' } else { 'FAILED' }
        wrapper_failures = @($finalizationFailures | ForEach-Object { $_ })
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
        finalization_status = 'PARTIAL'
        evidence_completeness = $evidenceCompleteness
        evidence_requirements = $evidenceRequirements
        finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
        final_evidence_inventory_sha256 = $inventorySha256
        final_evidence_inventory_excludes = $inventoryExclusions
    }
    $manifestText = ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine
    $sanitizedManifestText = ConvertTo-RedactedText -Value $manifestText -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
    Test-RedactedStructuredText -LiteralPath $manifestPath -Text $sanitizedManifestText
    Write-Utf8NoBom -LiteralPath $manifestPath -Value $sanitizedManifestText

    $postManifestClearPathCount = 0
    $finalRedactionRules = @(Get-EvidenceRedactionRules -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot) +
        @(Get-ClearPathScanTokens)
    foreach ($finalEvidenceFile in @(Get-ChildItem -LiteralPath $EvidenceRoot -File -Recurse -Force)) {
        if ([IO.Path]::GetExtension($finalEvidenceFile.Name) -notin @('.json', '.jsonl', '.log', '.txt', '.csv')) { continue }
        try {
            $finalEvidenceText = [IO.File]::ReadAllText($finalEvidenceFile.FullName)
            foreach ($finalRedactionRule in $finalRedactionRules) {
                $postManifestClearPathCount += [regex]::Matches(
                    $finalEvidenceText,
                    [regex]::Escape($finalRedactionRule.value),
                    [Text.RegularExpressions.RegexOptions]::IgnoreCase
                ).Count
            }
        }
        catch { }
    }
    if ($postManifestClearPathCount -ne 0) {
        Add-FinalizationFailureOnce -List $finalizationFailures -Stage 'evidence-redaction' `
            -FailureCode 'CLEAR-PERSONAL-PATH-IN-EVIDENCE' -Message 'CLEAR-PERSONAL-PATH-IN-EVIDENCE'
        $evidenceCompleteness = 'INCOMPLETE'
        $cleanupLedger.finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
        Write-JsonFile -LiteralPath $cleanupLedgerPath -Value $cleanupLedger
        $inventory = @(Get-EvidenceInventory -EvidenceRoot $EvidenceRoot -HmacKey $HmacKey `
            -ExcludeRelativePaths $inventoryExclusions)
        Write-JsonFile -LiteralPath $inventoryPath -Value ([ordered]@{
            schema_version = 1
            excluded_relative_paths = $inventoryExclusions
            unreadable_entry_count = @($inventory | Where-Object { $_.hash_status -ne 'OK' }).Count
            entries = $inventory
        })
        $inventorySha256 = Get-Sha256 -LiteralPath $inventoryPath
        $manifest.cleanup_status = $cleanupStatus
        if ($null -eq $PrimaryFailure) { $manifest.run_status = 'BLOCKED' }
        $manifest.evidence_completeness = $evidenceCompleteness
        $manifest.finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
        $manifest.final_evidence_inventory_sha256 = $inventorySha256
        $manifestText = ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine
        $sanitizedManifestText = ConvertTo-RedactedText -Value $manifestText -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
        Test-RedactedStructuredText -LiteralPath $manifestPath -Text $sanitizedManifestText
        Write-Utf8NoBom -LiteralPath $manifestPath -Value $sanitizedManifestText
    }

    $manifestReadBack = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $primaryFailurePreserved = if ($null -eq $PrimaryFailure) {
        $null -eq $manifestReadBack.primary_failure
    }
    else {
        $manifestReadBack.primary_failure.failure_code -eq $PrimaryFailure.failure_code
    }
    $finalizationFailuresRecorded = @($manifestReadBack.finalization_failures).Count -eq $finalizationFailures.Count
    $structuralFinalizationComplete = (Test-Path -LiteralPath $cleanupLedgerPath -PathType Leaf) -and
        (Test-Path -LiteralPath $inventoryPath -PathType Leaf) -and
        (Test-Path -LiteralPath $manifestPath -PathType Leaf) -and
        $primaryFailurePreserved -and $finalizationFailuresRecorded
    if ($structuralFinalizationComplete) {
        $manifest.finalization_status = 'FINALIZED'
        $manifestText = ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine
        $sanitizedManifestText = ConvertTo-RedactedText -Value $manifestText -EvidenceRoot $EvidenceRoot -RuntimeRoot $RuntimeRoot
        Test-RedactedStructuredText -LiteralPath $manifestPath -Text $sanitizedManifestText
        Write-Utf8NoBom -LiteralPath $manifestPath -Value $sanitizedManifestText
    }
    $manifestSha256 = Get-Sha256 -LiteralPath $manifestPath

    return [ordered]@{
        cleanup_ledger_path = $cleanupLedgerPath
        inventory_path = $inventoryPath
        inventory_sha256 = $inventorySha256
        inventory_exclusions = $inventoryExclusions
        manifest_path = $manifestPath
        manifest_sha256 = $manifestSha256
        cleanup_status = $cleanupStatus
        finalization_status = [string]$manifest.finalization_status
        evidence_completeness = $evidenceCompleteness
        privacy_comparison_status = $privacyComparisonStatus
        protected_file_comparison_status = $protectedFileComparisonStatus
        environment_restore_status = $environmentRestoreStatus
        runtime_root_cleanup_status = $runtimeRootCleanupStatus
        evidence_root_preserved = [bool]$evidenceRootPreserved
        clear_personal_path_match_count = $postManifestClearPathCount
        persistently_locked_file_count = [int]$runtimeUnlockResult.persistently_locked_file_count
        finalization_failures = @($finalizationFailures | ForEach-Object { $_ })
        wrapper_status = if ($finalizationFailures.Count -eq 0) { 'PASS' } else { 'FAILED' }
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
            app_baseline_sha = $ExpectedProductSha
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
            fixture_sha256 = Get-Sha256 -LiteralPath $syntheticFixturePath
            fixture_size = [int64](Get-Item -LiteralPath $syntheticFixturePath).Length
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'shim-source-metadata.json') -Value ([ordered]@{
            synthetic = $true
            source_sha256 = Get-Sha256 -LiteralPath $syntheticShimSource
        })
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'shim-executable-metadata.json') -Value ([ordered]@{
            synthetic = $true
            executable_sha256 = Get-Sha256 -LiteralPath $syntheticShimExecutable
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
            -OwnedProcessObjects @() -LogCaptures @() `
            -PrimaryFailure $primaryFailure -Context ([ordered]@{
                first_incomplete_phase = 'wdio-create'
                app_baseline_sha = $ExpectedProductSha
                harness_head_sha = 'synthetic-no-head'
                build_status = 'NOT RUN'
                application_launch_status = 'NOT RUN'
                wdio_status = 'FAILED-BEFORE-LAUNCH'
                create_status = 'FAILED-BEFORE-LAUNCH'
                restart_status = 'NOT RUN'
                mandatory_evidence_relative_paths = @(
                    'git-preflight.json',
                    'toolchain.json',
                    'run-metadata.json',
                    'build-provenance.json',
                    'fixture-metadata.json',
                    'shim-source-metadata.json',
                    'shim-executable-metadata.json',
                    'protected-files-before.json'
                )
                not_applicable_evidence_relative_paths = @(
                    'create/create-state.json',
                    'restart/restart-state.json'
                )
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
            $manifest.primary_failure.failure_code -ne 'SYNTHETIC-WDIO-PRELAUNCH-FAILURE' -or
            $manifest.finalization_status -ne 'FINALIZED' -or
            $manifest.evidence_completeness -ne 'COMPLETE') {
            throw 'SYNTHETIC-FAILED-MANIFEST-FAILED'
        }
        if ($finalization.finalization_failures.Count -ne 0) {
            throw ('SYNTHETIC-FINALIZATION-FAILURES-NONZERO:' +
                ($finalization.finalization_failures | ConvertTo-Json -Depth 10 -Compress))
        }
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

function Invoke-MonitorAndFinalizationValidation {
    $Script:OwnedProcessIdentities = @()
    $Script:OwnedProcessObjects.Clear()
    $Script:LogCaptures.Clear()
    $runToken = 'monitor-finalization-' + [guid]::NewGuid().ToString('N')
    $evidencePrefix = 'ytm-free-import-delete-monitor-evidence-'
    $runtimePrefix = 'ytm-free-import-delete-monitor-runtime-'
    $evidenceRoot = Join-Path $env:TEMP ($evidencePrefix + $runToken)
    $runtimeRoot = Join-Path $env:TEMP ($runtimePrefix + $runToken)
    $evidenceCreated = $false
    $runtimeCreated = $false
    $environmentBefore = $null
    $privacyBefore = $null
    $protectedBefore = $null
    $primaryFailure = $null
    $finalization = $null
    $syntheticProcess = $null
    [byte[]]$hmacKey = New-Object byte[] 32
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $randomGenerator.GetBytes($hmacKey) }
    finally { $randomGenerator.Dispose() }

    try {
        $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
        $evidenceCreated = $true
        $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
        $runtimeCreated = $true
        $Script:ActiveEvidenceRoot = $evidenceRoot
        $Script:ActiveRuntimeRoot = $runtimeRoot

        $dataDir = Join-Path $runtimeRoot 'data'
        $rawLogRoot = Join-Path $runtimeRoot 'raw-logs\synthetic-monitor'
        $syntheticSurface = Join-Path $runtimeRoot 'synthetic-surface'
        foreach ($directory in @($dataDir, $rawLogRoot, $syntheticSurface)) {
            $null = New-Item -ItemType Directory -Path $directory -Force
        }
        Write-Utf8NoBom -LiteralPath (Join-Path $syntheticSurface 'surface.txt') -Value "synthetic-private-surface`n"
        $syntheticProtectedPath = Join-Path $runtimeRoot 'synthetic-protected.txt'
        Write-Utf8NoBom -LiteralPath $syntheticProtectedPath -Value "synthetic-protected`n"
        $databasePath = Join-Path $dataDir 'ytm-free.db'
        $databaseCreateCode = "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('create table synthetic(id integer primary key)'); c.commit(); c.close()"
        $null = @(& py -3 -c $databaseCreateCode $databasePath 2>&1)
        $databaseCreateExitCode = $LASTEXITCODE
        if ($databaseCreateExitCode -ne 0) { throw 'SYNTHETIC-DATABASE-CREATE-FAILED' }

        $personalRoots = [ordered]@{ synthetic_surface = $syntheticSurface }
        $protectedPaths = [ordered]@{ synthetic_protected = $syntheticProtectedPath }
        $privacyBefore = Capture-PrivacySnapshots -Roots $personalRoots -Key $hmacKey `
            -EvidenceRoot $evidenceRoot -Moment 'before'
        $protectedBefore = @(Get-ProtectedFileSnapshots -Paths $protectedPaths -Key $hmacKey)
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'protected-files-before.json') -Value $protectedBefore
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'run-metadata.json') -Value ([ordered]@{
            schema_version = 1
            run_token = $runToken
            scenario = 'SYNTHETIC-WDIO-MONITOR-FAILURE'
        })

        $environmentBefore = Set-ProcessEnvironment -Values ([ordered]@{
            YTM_SYNTHETIC_DB_PATH = $databasePath
            YTM_SYNTHETIC_REPO_PATH = $RepoRoot
            YTM_SYNTHETIC_RUNTIME_PATH = $runtimeRoot
            YTM_SYNTHETIC_EVIDENCE_PATH = $evidenceRoot
            YTM_SYNTHETIC_USERPROFILE_PATH = $env:USERPROFILE
            YTM_SYNTHETIC_TEMP_PATH = $env:TEMP
            YTM_SYNTHETIC_APPDATA_PATH = $env:APPDATA
            YTM_SYNTHETIC_LOCALAPPDATA_PATH = $env:LOCALAPPDATA
        })
        $childScript = @'
$databaseStream = [IO.File]::Open($env:YTM_SYNTHETIC_DB_PATH, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
try {
    Write-Output "repo=$env:YTM_SYNTHETIC_REPO_PATH"
    Write-Output "runtime=$env:YTM_SYNTHETIC_RUNTIME_PATH"
    Write-Output "evidence=$env:YTM_SYNTHETIC_EVIDENCE_PATH"
    Write-Output "userprofile=$env:YTM_SYNTHETIC_USERPROFILE_PATH"
    [Console]::Error.WriteLine("temp=$env:YTM_SYNTHETIC_TEMP_PATH")
    [Console]::Error.WriteLine("appdata=$env:YTM_SYNTHETIC_APPDATA_PATH")
    [Console]::Error.WriteLine("localappdata=$env:YTM_SYNTHETIC_LOCALAPPDATA_PATH")
    while ($true) { Start-Sleep -Milliseconds 250 }
}
finally { $databaseStream.Dispose() }
'@
        $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childScript))
        $captureRecord = [pscustomobject][ordered]@{
            role = 'synthetic-monitor'
            process_launched = $false
            raw_stdout_path = Join-Path $rawLogRoot 'synthetic.stdout.raw.log'
            raw_stderr_path = Join-Path $rawLogRoot 'synthetic.stderr.raw.log'
            evidence_stdout_path = Join-Path $evidenceRoot 'synthetic.stdout.log'
            evidence_stderr_path = Join-Path $evidenceRoot 'synthetic.stderr.log'
            stream_publications = @()
            sanitized_logs_created = $false
            raw_logs_removed = $false
        }
        $Script:LogCaptures.Add($captureRecord) | Out-Null
        $syntheticProcess = Start-Process -FilePath 'powershell.exe' `
            -ArgumentList @('-NoProfile', '-EncodedCommand', $encodedCommand) -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $captureRecord.raw_stdout_path -RedirectStandardError $captureRecord.raw_stderr_path
        $captureRecord.process_launched = $true
        $null = Register-OwnedProcessObject -Process $syntheticProcess -Role 'synthetic-monitor' -CaptureRecord $captureRecord
        $launcherIdentity = $null
        for ($identityAttempt = 1; $identityAttempt -le 20 -and $null -eq $launcherIdentity; $identityAttempt++) {
            $launcherCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($syntheticProcess.Id)" -ErrorAction SilentlyContinue
            if ($null -ne $launcherCim) { $launcherIdentity = Get-ProcessIdentity -CimProcess $launcherCim }
            else { Start-Sleep -Milliseconds 100 }
        }
        if ($null -eq $launcherIdentity) { throw 'SYNTHETIC-LAUNCHER-IDENTITY-MISSING' }
        Register-OwnedProcessIdentity -Identity $launcherIdentity

        $childReady = $false
        for ($readyAttempt = 1; $readyAttempt -le 30 -and -not $childReady; $readyAttempt++) {
            $stdoutReady = (Test-Path -LiteralPath $captureRecord.raw_stdout_path -PathType Leaf) -and
                ((Get-Item -LiteralPath $captureRecord.raw_stdout_path).Length -gt 0)
            $databaseLocked = -not (Test-FileExclusiveAccess -LiteralPath $databasePath)
            $childReady = $stdoutReady -and $databaseLocked
            if (-not $childReady) { Start-Sleep -Milliseconds 100 }
        }
        if (-not $childReady) { throw 'SYNTHETIC-OWNED-PROCESS-NOT-READY' }

        try { throw 'WDIO-MONITOR-FAILURE: synthetic monitor failure' }
        catch {
            $primaryFailure = New-PrimaryFailureRecord -ErrorRecord $_ -Phase 'wdio-monitor'
            Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'primary-failure.json') -Value $primaryFailure
        }

        $finalization = Invoke-HarnessFinalization -EvidenceRoot $evidenceRoot -EvidencePrefix $evidencePrefix `
            -RuntimeRoot $runtimeRoot -RuntimePrefix $runtimePrefix -RunToken $runToken -HmacKey $hmacKey `
            -PersonalRoots $personalRoots -PrivacyBefore $privacyBefore -ProtectedPaths $protectedPaths `
            -ProtectedBefore $protectedBefore -EnvironmentBefore $environmentBefore `
            -OwnedProcessIdentities @($Script:OwnedProcessIdentities) `
            -OwnedProcessObjects @($Script:OwnedProcessObjects) -LogCaptures @($Script:LogCaptures) `
            -PrimaryFailure $primaryFailure -Context ([ordered]@{
                first_incomplete_phase = 'wdio-monitor'
                app_baseline_sha = $ExpectedProductSha
                harness_head_sha = 'synthetic-no-head'
                build_status = 'NOT RUN'
                application_launch_status = 'NOT RUN'
                wdio_status = 'FAILED-MONITOR'
                create_status = 'FAILED-MONITOR'
                restart_status = 'NOT RUN'
                mandatory_evidence_relative_paths = @(
                    'run-metadata.json',
                    'protected-files-before.json'
                )
                not_applicable_evidence_relative_paths = @('restart/restart-state.json')
            })

        $cleanupLedger = Get-Content -LiteralPath $finalization.cleanup_ledger_path -Raw | ConvertFrom-Json
        $manifest = Get-Content -LiteralPath $finalization.manifest_path -Raw | ConvertFrom-Json
        $inventory = Get-Content -LiteralPath $finalization.inventory_path -Raw | ConvertFrom-Json
        if (-not (Test-Path -LiteralPath $captureRecord.evidence_stdout_path -PathType Leaf) -or
            -not (Test-Path -LiteralPath $captureRecord.evidence_stderr_path -PathType Leaf)) {
            $sanitizedLogDiagnostic = [ordered]@{
                owned_process_cleanup_status = $cleanupLedger.owned_process_cleanup_status.status
                process_wait_status = $cleanupLedger.process_wait_status
                process_object_dispose_status = $cleanupLedger.process_object_dispose_status
                log_handle_release_status = $cleanupLedger.log_handle_release_status
                runtime_unlock_status = $cleanupLedger.runtime_unlock_status.status
                raw_log_cleanup_status = $cleanupLedger.raw_log_cleanup_status
                sanitized_log_status = $cleanupLedger.sanitized_log_status
            }
            throw ('SYNTHETIC-SANITIZED-LOGS-MISSING:' + ($sanitizedLogDiagnostic | ConvertTo-Json -Compress))
        }
        $sanitizedStdout = Get-Content -LiteralPath $captureRecord.evidence_stdout_path -Raw
        $sanitizedStderr = Get-Content -LiteralPath $captureRecord.evidence_stderr_path -Raw
        $syntheticClearPathCount = [int]$finalization.clear_personal_path_match_count
        $privacyAfterCaptured = Test-Path -LiteralPath (Join-Path $evidenceRoot 'privacy-synthetic_surface-after.json') -PathType Leaf
        $environmentRestored = @($cleanupLedger.environment_restore_status.variables | Where-Object { $_.status -ne 'PASS' }).Count -eq 0
        $inventoryPaths = @($inventory.entries | Where-Object { $_.hash_status -eq 'OK' } | ForEach-Object { [string]$_.relative_path })

        if ($primaryFailure.failure_code -ne 'WDIO-MONITOR-FAILURE') { throw 'SYNTHETIC-MONITOR-FAILURE-NOT-PRESERVED' }
        if ($cleanupLedger.owned_process_cleanup_status.status -ne 'PASS') { throw 'SYNTHETIC-OWNED-PROCESS-NOT-STOPPED' }
        if ($cleanupLedger.process_wait_status -ne 'PASS') { throw 'SYNTHETIC-PROCESS-WAIT-INCOMPLETE' }
        if ($cleanupLedger.log_handle_release_status -ne 'PASS') { throw 'SYNTHETIC-LOG-HANDLE-NOT-RELEASED' }
        if ($cleanupLedger.runtime_unlock_status.status -ne 'PASS') { throw 'SYNTHETIC-DB-HANDLE-NOT-RELEASED' }
        if ($cleanupLedger.raw_log_cleanup_status -ne 'PASS' -or
            @($cleanupLedger.log_publications | Where-Object { $_.raw_cleanup_status -ne 'PASS' }).Count -ne 0) {
            $rawLogResidualDiagnostic = [ordered]@{
                runtime_unlock_status = $cleanupLedger.runtime_unlock_status.status
                persistently_locked_file_count = $cleanupLedger.persistently_locked_file_count
                log_handle_release_status = $cleanupLedger.log_handle_release_status
                raw_log_cleanup_status = $cleanupLedger.raw_log_cleanup_status
                sanitized_log_status = $cleanupLedger.sanitized_log_status
                log_publications = $cleanupLedger.log_publications
            }
            throw ('SYNTHETIC-RAW-LOGS-RESIDUAL:' + ($rawLogResidualDiagnostic | ConvertTo-Json -Depth 10 -Compress))
        }
        if ($cleanupLedger.sanitized_log_status -ne 'PASS' -or
            @($cleanupLedger.log_publications | Where-Object {
                $_.publication_status -notin @('PASS_EMPTY', 'PASS_CONTENT', 'NOT_CREATED')
            }).Count -ne 0 -or
            $sanitizedStdout -notmatch '%REPO%' -or $sanitizedStdout -notmatch '%RUNTIME_ROOT%' -or
            $sanitizedStdout -notmatch '%EVIDENCE_ROOT%' -or $sanitizedStdout -notmatch '%REDACTED_USERPROFILE%' -or
            $sanitizedStderr -notmatch '%TEMP%' -or $sanitizedStderr -notmatch '%APPDATA%' -or
            $sanitizedStderr -notmatch '%LOCALAPPDATA%') { throw 'SYNTHETIC-SANITIZED-LOGS-INVALID' }
        if ($syntheticClearPathCount -ne 0) { throw 'SYNTHETIC-CLEAR-PERSONAL-PATH-DETECTED' }
        if (-not $privacyAfterCaptured) { throw 'SYNTHETIC-PRIVACY-AFTER-MISSING' }
        if (-not $environmentRestored) { throw 'SYNTHETIC-ENVIRONMENT-RESTORE-FAILED' }
        if (Test-Path -LiteralPath $runtimeRoot) { throw 'SYNTHETIC-RUNTIME-ROOT-RESIDUAL' }
        if (-not (Test-Path -LiteralPath $finalization.cleanup_ledger_path -PathType Leaf)) { throw 'SYNTHETIC-CLEANUP-LEDGER-MISSING' }
        if (-not (Test-Path -LiteralPath $finalization.inventory_path -PathType Leaf) -or
            'final-evidence-inventory.json' -in $inventoryPaths -or 'final-manifest.json' -in $inventoryPaths) {
            throw 'SYNTHETIC-FINAL-INVENTORY-FAILED'
        }
        if (-not (Test-Path -LiteralPath $finalization.manifest_path -PathType Leaf) -or
            $manifest.run_status -ne 'FAILED' -or $manifest.primary_failure.failure_code -ne 'WDIO-MONITOR-FAILURE' -or
            $manifest.finalization_status -ne 'FINALIZED' -or $manifest.evidence_completeness -ne 'COMPLETE') {
            throw 'SYNTHETIC-FINAL-MANIFEST-FAILED'
        }
        if ($finalization.finalization_failures.Count -ne 0) {
            throw ('SYNTHETIC-FINALIZATION-FAILURES-NONZERO:' +
                ($finalization.finalization_failures | ConvertTo-Json -Depth 10 -Compress))
        }

        return [ordered]@{
            SYNTHETIC_MONITOR_FAILURE_PRESERVED = 'PASS'
            SYNTHETIC_OWNED_PROCESS_STOPPED = 'PASS'
            SYNTHETIC_PROCESS_WAIT_COMPLETED = 'PASS'
            SYNTHETIC_LOG_HANDLES_RELEASED = 'PASS'
            SYNTHETIC_DB_HANDLE_RELEASED = 'PASS'
            SYNTHETIC_RAW_LOGS_REMOVED = 'PASS'
            SYNTHETIC_SANITIZED_LOGS_CREATED = 'PASS'
            SYNTHETIC_CLEAR_PATH_COUNT = 0
            SYNTHETIC_PRIVACY_AFTER_CAPTURED = 'PASS'
            SYNTHETIC_RUNTIME_ROOT_REMOVED = 'PASS'
            SYNTHETIC_CLEANUP_LEDGER = 'PASS'
            SYNTHETIC_FINAL_INVENTORY = 'PASS'
            SYNTHETIC_FINAL_MANIFEST = 'PASS'
            SYNTHETIC_FINALIZATION_FAILURE_COUNT = 0
        }
    }
    finally {
        if ($null -ne $environmentBefore) { $null = Restore-ProcessEnvironment -Previous $environmentBefore }
        if ($null -ne $syntheticProcess) {
            try {
                $syntheticProcess.Refresh()
                if (-not $syntheticProcess.HasExited) {
                    $launcherCim = Get-CimInstance Win32_Process -Filter "ProcessId = $($syntheticProcess.Id)" -ErrorAction SilentlyContinue
                    if ($null -ne $launcherCim) {
                        $null = Stop-OwnedProcessIdentity -Identity (Get-ProcessIdentity -CimProcess $launcherCim)
                        $null = $syntheticProcess.WaitForExit(5000)
                    }
                }
            }
            catch { }
            try { $syntheticProcess.Dispose() } catch { }
        }
        if ($runtimeCreated -and (Test-Path -LiteralPath $runtimeRoot)) {
            $safeRuntime = Assert-NoReparseDescendant -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
            Remove-Item -LiteralPath $safeRuntime -Recurse -Force
        }
        if ($evidenceCreated -and (Test-Path -LiteralPath $evidenceRoot)) {
            $safeEvidence = Assert-NoReparseDescendant -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
            Remove-Item -LiteralPath $safeEvidence -Recurse -Force
        }
        [Array]::Clear($hmacKey, 0, $hmacKey.Length)
        $Script:ActiveEvidenceRoot = $null
        $Script:ActiveRuntimeRoot = $null
        $Script:OwnedProcessIdentities = @()
        $Script:OwnedProcessObjects.Clear()
        $Script:LogCaptures.Clear()
    }
}

function Invoke-EmptyLogFinalizationValidation {
    $runToken = 'empty-log-' + [guid]::NewGuid().ToString('N')
    $evidencePrefix = 'ytm-free-import-delete-empty-log-evidence-'
    $runtimePrefix = 'ytm-free-import-delete-empty-log-runtime-'
    $evidenceRoot = Join-Path $env:TEMP ($evidencePrefix + $runToken)
    $runtimeRoot = Join-Path $env:TEMP ($runtimePrefix + $runToken)
    $evidenceCreated = $false
    $runtimeCreated = $false
    [byte[]]$hmacKey = New-Object byte[] 32
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $randomGenerator.GetBytes($hmacKey) }
    finally { $randomGenerator.Dispose() }

    try {
        $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
        $evidenceCreated = $true
        $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
        $runtimeCreated = $true
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'run-metadata.json') -Value ([ordered]@{
            schema_version = 1
            scenario = 'SYNTHETIC-EMPTY-STDOUT-STDERR'
            application_launch = 'NOT RUN'
        })
        $rawLogRoot = Join-Path $runtimeRoot 'raw-logs\empty'
        $null = New-Item -ItemType Directory -Path $rawLogRoot -Force
        $captureRecord = [pscustomobject][ordered]@{
            role = 'synthetic-empty'
            process_launched = $true
            raw_stdout_path = Join-Path $rawLogRoot 'empty.stdout.raw.log'
            raw_stderr_path = Join-Path $rawLogRoot 'empty.stderr.raw.log'
            evidence_stdout_path = Join-Path $evidenceRoot 'empty.stdout.log'
            evidence_stderr_path = Join-Path $evidenceRoot 'empty.stderr.log'
            stream_publications = @()
            sanitized_logs_created = $false
            raw_logs_removed = $false
        }
        [IO.File]::WriteAllBytes($captureRecord.raw_stdout_path, [byte[]]@())
        [IO.File]::WriteAllBytes($captureRecord.raw_stderr_path, [byte[]]@())

        $nullValueRejected = $false
        try {
            Write-Utf8NoBom -LiteralPath (Join-Path $runtimeRoot 'null-value-must-not-exist.txt') -Value $null
        }
        catch {
            $nullValueRejected = $_.Exception.Message -match 'WRITE-UTF8-VALUE-NULL'
        }
        if (-not $nullValueRejected) { throw 'SYNTHETIC-NULL-TEXT-VALUE-NOT-REJECTED' }

        Publish-SanitizedLogCapture -CaptureRecord $captureRecord -EvidenceRoot $evidenceRoot -RuntimeRoot $runtimeRoot
        $finalization = Invoke-HarnessFinalization -EvidenceRoot $evidenceRoot -EvidencePrefix $evidencePrefix `
            -RuntimeRoot $runtimeRoot -RuntimePrefix $runtimePrefix -RunToken $runToken -HmacKey $hmacKey `
            -PersonalRoots ([ordered]@{}) -PrivacyBefore $null -ProtectedPaths ([ordered]@{}) `
            -ProtectedBefore $null -EnvironmentBefore $null -OwnedProcessIdentities @() `
            -OwnedProcessObjects @() -LogCaptures @($captureRecord) -PrimaryFailure $null -Context ([ordered]@{
                first_incomplete_phase = 'complete'
                app_baseline_sha = $ExpectedProductSha
                harness_head_sha = 'synthetic-no-head'
                build_status = 'NOT RUN'
                application_launch_status = 'NOT RUN'
                wdio_status = 'NOT RUN'
                create_status = 'NOT RUN'
                restart_status = 'NOT RUN'
                mandatory_evidence_relative_paths = @('run-metadata.json', 'empty.stdout.log', 'empty.stderr.log')
                not_applicable_evidence_relative_paths = @(
                    'create/create-state.json',
                    'restart/restart-state.json'
                )
            })

        $cleanupLedger = Get-Content -LiteralPath $finalization.cleanup_ledger_path -Raw | ConvertFrom-Json
        $manifest = Get-Content -LiteralPath $finalization.manifest_path -Raw | ConvertFrom-Json
        $stdoutPublication = @($cleanupLedger.log_publications | Where-Object { $_.stream -eq 'stdout' })
        $stderrPublication = @($cleanupLedger.log_publications | Where-Object { $_.stream -eq 'stderr' })
        $stdoutBytes = [IO.File]::ReadAllBytes($captureRecord.evidence_stdout_path)
        $stderrBytes = [IO.File]::ReadAllBytes($captureRecord.evidence_stderr_path)
        $falseLockFailures = @($manifest.finalization_failures | Where-Object {
            $_.failure_code -eq 'RUNTIME-FILE-LOCK-PERSISTED'
        })

        if ($stdoutPublication.Count -ne 1 -or $stdoutPublication[0].publication_status -ne 'PASS_EMPTY' -or
            $stderrPublication.Count -ne 1 -or $stderrPublication[0].publication_status -ne 'PASS_EMPTY') {
            throw 'SYNTHETIC-EMPTY-LOG-PUBLICATION-FAILED'
        }
        if ($stdoutBytes.Length -ne 0 -or $stderrBytes.Length -ne 0) {
            throw 'SYNTHETIC-EMPTY-LOG-SIZE-MISMATCH'
        }
        if ($cleanupLedger.raw_log_cleanup_status -ne 'PASS' -or
            @($cleanupLedger.log_publications | Where-Object { $_.raw_cleanup_status -ne 'PASS' }).Count -ne 0 -or
            (Test-Path -LiteralPath $captureRecord.raw_stdout_path) -or
            (Test-Path -LiteralPath $captureRecord.raw_stderr_path)) {
            throw 'SYNTHETIC-EMPTY-RAW-LOGS-RESIDUAL'
        }
        if ([int]$finalization.clear_personal_path_match_count -ne 0) { throw 'SYNTHETIC-EMPTY-CLEAR-PATH-DETECTED' }
        if ($falseLockFailures.Count -ne 0 -or [int]$cleanupLedger.persistently_locked_file_count -ne 0) {
            throw 'SYNTHETIC-EMPTY-FALSE-LOCK-CLASSIFICATION'
        }
        if ($manifest.finalization_status -ne 'FINALIZED' -or $manifest.evidence_completeness -ne 'COMPLETE') {
            throw 'SYNTHETIC-EMPTY-MANIFEST-SEMANTICS-INVALID'
        }
        if (-not (Test-Path -LiteralPath $finalization.inventory_path -PathType Leaf) -or
            -not (Test-Path -LiteralPath $finalization.manifest_path -PathType Leaf)) {
            throw 'SYNTHETIC-EMPTY-FINAL-EVIDENCE-MISSING'
        }
        if ($finalization.finalization_failures.Count -ne 0) {
            throw ('SYNTHETIC-EMPTY-FINALIZATION-FAILURES-NONZERO:' +
                ($finalization.finalization_failures | ConvertTo-Json -Depth 10 -Compress))
        }
        if (Test-Path -LiteralPath $runtimeRoot) { throw 'SYNTHETIC-EMPTY-RUNTIME-ROOT-RESIDUAL' }

        return [ordered]@{
            SYNTHETIC_NULL_VALUE_REJECTED = 'PASS'
            SYNTHETIC_EMPTY_STDOUT_PUBLICATION = 'PASS'
            SYNTHETIC_EMPTY_STDERR_PUBLICATION = 'PASS'
            SYNTHETIC_EMPTY_STDOUT_SIZE = 0
            SYNTHETIC_EMPTY_STDERR_SIZE = 0
            SYNTHETIC_EMPTY_LOG_BOM_ABSENT = 'PASS'
            SYNTHETIC_EMPTY_RAW_LOGS_REMOVED = 'PASS'
            SYNTHETIC_EMPTY_CLEAR_PATH_COUNT = 0
            SYNTHETIC_EMPTY_FALSE_LOCK_CODE_ABSENT = 'PASS'
            SYNTHETIC_EMPTY_PERSISTENT_LOCK_COUNT = 0
            SYNTHETIC_EMPTY_FINALIZATION_STATUS = 'FINALIZED'
            SYNTHETIC_EMPTY_EVIDENCE_COMPLETENESS = 'COMPLETE'
            SYNTHETIC_EMPTY_INVENTORY = 'PASS'
            SYNTHETIC_EMPTY_MANIFEST = 'PASS'
            SYNTHETIC_EMPTY_FINALIZATION_FAILURE_COUNT = 0
        }
    }
    finally {
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

function Invoke-PublicationFailureFinalizationValidation {
    $runToken = 'publication-failure-' + [guid]::NewGuid().ToString('N')
    $evidencePrefix = 'ytm-free-import-delete-publication-failure-evidence-'
    $runtimePrefix = 'ytm-free-import-delete-publication-failure-runtime-'
    $evidenceRoot = Join-Path $env:TEMP ($evidencePrefix + $runToken)
    $runtimeRoot = Join-Path $env:TEMP ($runtimePrefix + $runToken)
    $evidenceCreated = $false
    $runtimeCreated = $false
    [byte[]]$hmacKey = New-Object byte[] 32
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $randomGenerator.GetBytes($hmacKey) }
    finally { $randomGenerator.Dispose() }

    try {
        $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
        $evidenceCreated = $true
        $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
        $runtimeCreated = $true
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'run-metadata.json') -Value ([ordered]@{
            schema_version = 1
            scenario = 'SYNTHETIC-SANITIZED-PUBLICATION-FAILURE'
            application_launch = 'NOT RUN'
        })
        $rawLogRoot = Join-Path $runtimeRoot 'raw-logs\publication-failure'
        $null = New-Item -ItemType Directory -Path $rawLogRoot -Force
        $captureRecord = [pscustomobject][ordered]@{
            role = 'synthetic-publication-failure'
            process_launched = $true
            raw_stdout_path = Join-Path $rawLogRoot 'failure.stdout.raw.log'
            raw_stderr_path = Join-Path $rawLogRoot 'failure.stderr.raw.log'
            evidence_stdout_path = Join-Path $evidenceRoot 'failure.stdout.log'
            evidence_stderr_path = Join-Path $evidenceRoot 'failure.stderr.log'
            stream_publications = @()
            sanitized_logs_created = $false
            raw_logs_removed = $false
            inject_publication_failure_stream = 'stdout'
        }
        Write-Utf8NoBom -LiteralPath $captureRecord.raw_stdout_path -Value "synthetic stdout`n"
        Write-Utf8NoBom -LiteralPath $captureRecord.raw_stderr_path -Value ''

        $primaryFailure = $null
        try { throw 'SYNTHETIC-WDIO-PRELAUNCH-FAILURE' }
        catch {
            $primaryFailure = New-PrimaryFailureRecord -ErrorRecord $_ -Phase 'synthetic-publication'
            Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'primary-failure.json') -Value $primaryFailure
        }

        $finalization = Invoke-HarnessFinalization -EvidenceRoot $evidenceRoot -EvidencePrefix $evidencePrefix `
            -RuntimeRoot $runtimeRoot -RuntimePrefix $runtimePrefix -RunToken $runToken -HmacKey $hmacKey `
            -PersonalRoots ([ordered]@{}) -PrivacyBefore $null -ProtectedPaths ([ordered]@{}) `
            -ProtectedBefore $null -EnvironmentBefore $null -OwnedProcessIdentities @() `
            -OwnedProcessObjects @() -LogCaptures @($captureRecord) -PrimaryFailure $primaryFailure -Context ([ordered]@{
                first_incomplete_phase = 'synthetic-publication'
                app_baseline_sha = $ExpectedProductSha
                harness_head_sha = 'synthetic-no-head'
                build_status = 'NOT RUN'
                application_launch_status = 'NOT RUN'
                wdio_status = 'NOT RUN'
                create_status = 'NOT RUN'
                restart_status = 'NOT RUN'
                mandatory_evidence_relative_paths = @('run-metadata.json', 'failure.stdout.log', 'failure.stderr.log')
                not_applicable_evidence_relative_paths = @(
                    'create/create-state.json',
                    'restart/restart-state.json'
                )
            })

        $cleanupLedger = Get-Content -LiteralPath $finalization.cleanup_ledger_path -Raw | ConvertFrom-Json
        $manifest = Get-Content -LiteralPath $finalization.manifest_path -Raw | ConvertFrom-Json
        $publicationFailures = @($manifest.finalization_failures | Where-Object {
            $_.failure_code -eq 'SANITIZED-LOG-PUBLICATION-FAILED'
        })
        $falseLockFailures = @($manifest.finalization_failures | Where-Object {
            $_.failure_code -eq 'RUNTIME-FILE-LOCK-PERSISTED'
        })
        if ($publicationFailures.Count -eq 0) { throw 'SYNTHETIC-PUBLICATION-FAILURE-CODE-MISSING' }
        if ($falseLockFailures.Count -ne 0 -or [int]$cleanupLedger.persistently_locked_file_count -ne 0) {
            throw 'SYNTHETIC-PUBLICATION-FALSE-LOCK-CLASSIFICATION'
        }
        if ($manifest.finalization_status -ne 'FINALIZED' -or $manifest.evidence_completeness -ne 'INCOMPLETE') {
            throw 'SYNTHETIC-PUBLICATION-MANIFEST-SEMANTICS-INVALID'
        }
        if (-not (Test-Path -LiteralPath $finalization.inventory_path -PathType Leaf) -or
            -not (Test-Path -LiteralPath $finalization.manifest_path -PathType Leaf)) {
            throw 'SYNTHETIC-PUBLICATION-FINAL-EVIDENCE-MISSING'
        }
        if ($manifest.primary_failure.failure_code -ne $primaryFailure.failure_code) {
            throw 'SYNTHETIC-PUBLICATION-PRIMARY-FAILURE-NOT-PRESERVED'
        }

        return [ordered]@{
            SYNTHETIC_PUBLICATION_FAILURE_CODE = 'SANITIZED-LOG-PUBLICATION-FAILED'
            SYNTHETIC_PUBLICATION_FALSE_LOCK_CODE_ABSENT = 'PASS'
            SYNTHETIC_PUBLICATION_PERSISTENT_LOCK_COUNT = 0
            SYNTHETIC_PUBLICATION_FINALIZATION_STATUS = 'FINALIZED'
            SYNTHETIC_PUBLICATION_EVIDENCE_COMPLETENESS = 'INCOMPLETE'
            SYNTHETIC_PUBLICATION_INVENTORY_PRESENT = 'PASS'
            SYNTHETIC_PUBLICATION_MANIFEST_PRESENT = 'PASS'
            SYNTHETIC_PUBLICATION_PRIMARY_FAILURE_PRESERVED = 'PASS'
        }
    }
    finally {
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

function Invoke-UnreadableEvidenceFinalizationValidation {
    $runToken = 'unreadable-evidence-' + [guid]::NewGuid().ToString('N')
    $evidencePrefix = 'ytm-free-import-delete-unreadable-evidence-'
    $runtimePrefix = 'ytm-free-import-delete-unreadable-runtime-'
    $evidenceRoot = Join-Path $env:TEMP ($evidencePrefix + $runToken)
    $runtimeRoot = Join-Path $env:TEMP ($runtimePrefix + $runToken)
    $evidenceCreated = $false
    $runtimeCreated = $false
    $lockedEvidenceStream = $null
    [byte[]]$hmacKey = New-Object byte[] 32
    $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $randomGenerator.GetBytes($hmacKey) }
    finally { $randomGenerator.Dispose() }

    try {
        $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
        $evidenceCreated = $true
        $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
        $runtimeCreated = $true
        $lockedEvidencePath = Join-Path $evidenceRoot 'intentionally-unreadable.json'
        Write-JsonFile -LiteralPath $lockedEvidencePath -Value ([ordered]@{
            schema_version = 1
            scenario = 'SYNTHETIC-EVIDENCE-FILE-UNREADABLE'
        })
        $lockedEvidenceStream = [IO.File]::Open(
            $lockedEvidencePath,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::None
        )

        $finalization = Invoke-HarnessFinalization -EvidenceRoot $evidenceRoot -EvidencePrefix $evidencePrefix `
            -RuntimeRoot $runtimeRoot -RuntimePrefix $runtimePrefix -RunToken $runToken -HmacKey $hmacKey `
            -PersonalRoots ([ordered]@{}) -PrivacyBefore $null -ProtectedPaths ([ordered]@{}) `
            -ProtectedBefore $null -EnvironmentBefore $null -OwnedProcessIdentities @() `
            -OwnedProcessObjects @() -LogCaptures @() -PrimaryFailure $null -Context ([ordered]@{
                first_incomplete_phase = 'synthetic-unreadable-evidence'
                app_baseline_sha = $ExpectedProductSha
                harness_head_sha = 'synthetic-no-head'
                build_status = 'NOT RUN'
                application_launch_status = 'NOT RUN'
                wdio_status = 'NOT RUN'
                create_status = 'NOT RUN'
                restart_status = 'NOT RUN'
                mandatory_evidence_relative_paths = @('intentionally-unreadable.json')
                not_applicable_evidence_relative_paths = @(
                    'create/create-state.json',
                    'restart/restart-state.json'
                )
            })

        $inventoryDocument = Get-Content -LiteralPath $finalization.inventory_path -Raw | ConvertFrom-Json
        $manifestDocument = Get-Content -LiteralPath $finalization.manifest_path -Raw | ConvertFrom-Json
        $unreadableEntries = @($inventoryDocument.entries | Where-Object {
            $_.hash_status -eq 'UNREADABLE' -and $_.error_code -eq 'EVIDENCE-FILE-UNREADABLE'
        })
        if ($unreadableEntries.Count -ne 1 -or
            [string]::IsNullOrWhiteSpace([string]$unreadableEntries[0].relative_path_hmac) -or
            $null -ne $unreadableEntries[0].PSObject.Properties['relative_path']) {
            throw 'SYNTHETIC-UNREADABLE-INVENTORY-ENTRY-INVALID'
        }
        if ($manifestDocument.finalization_status -ne 'FINALIZED' -or
            $manifestDocument.evidence_completeness -ne 'INCOMPLETE' -or
            -not (Test-Path -LiteralPath $finalization.inventory_path -PathType Leaf) -or
            -not (Test-Path -LiteralPath $finalization.manifest_path -PathType Leaf)) {
            throw 'SYNTHETIC-UNREADABLE-MANIFEST-NOT-FINALIZED'
        }
        return 'PASS'
    }
    finally {
        if ($null -ne $lockedEvidenceStream) { $lockedEvidenceStream.Dispose() }
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

function Invoke-ExternalCommandValidation {
    $Script:LogCaptures.Clear()
    $runToken = 'external-command-' + [guid]::NewGuid().ToString('N')
    $evidencePrefix = 'ytm-free-import-delete-external-evidence-'
    $runtimePrefix = 'ytm-free-import-delete-external-runtime-'
    $evidenceRoot = Join-Path $env:TEMP ($evidencePrefix + $runToken)
    $runtimeRoot = Join-Path $env:TEMP ($runtimePrefix + $runToken)
    $evidenceCreated = $false
    $runtimeCreated = $false

    try {
        $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
        $evidenceCreated = $true
        $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
        $runtimeCreated = $true

        $powershellCandidates = @(Get-Command powershell.exe -CommandType Application -ErrorAction SilentlyContinue)
        if ($powershellCandidates.Count -ne 1 -or $powershellCandidates[0].Source -isnot [string]) {
            throw 'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE: validation powershell executable unavailable or ambiguous'
        }
        $powershellPath = [string]$powershellCandidates[0].Source

        $zeroResults = @(Invoke-ExternalCaptured -FilePath $powershellPath -Arguments @(
            '-NoProfile', '-Command', 'exit 0'
        ) -WorkingDirectory $runtimeRoot -RuntimeRoot $runtimeRoot -EvidenceRoot $evidenceRoot -LogName 'exit-zero')
        if ($zeroResults.Count -ne 1) { throw 'EXTERNAL-COMMAND-EXITCODE-TYPE-MISMATCH: zero result cardinality' }
        $zeroResult = $zeroResults[0]
        Assert-ExternalCommandSucceeded -Result $zeroResult -CommandLabel 'synthetic exit zero'
        if (-not $zeroResult.has_exited -or $zeroResult.exit_code -isnot [int] -or
            $zeroResult.exit_code_status -ne 'CAPTURED' -or $zeroResult.exit_code -ne 0) {
            throw 'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE: zero exit code contract failed'
        }

        $sevenResults = @(Invoke-ExternalCaptured -FilePath $powershellPath -Arguments @(
            '-NoProfile', '-Command', "Write-Output test; [Console]::Error.WriteLine('test-error'); exit 7"
        ) -WorkingDirectory $runtimeRoot -RuntimeRoot $runtimeRoot -EvidenceRoot $evidenceRoot -LogName 'exit-seven')
        if ($sevenResults.Count -ne 1) { throw 'EXTERNAL-COMMAND-EXITCODE-TYPE-MISMATCH: seven result cardinality' }
        $sevenResult = $sevenResults[0]
        if (-not $sevenResult.has_exited -or $sevenResult.exit_code -isnot [int] -or
            $sevenResult.exit_code_status -ne 'CAPTURED' -or $sevenResult.exit_code -ne 7 -or
            $sevenResult.failure_code -ne 'EXTERNAL-COMMAND-FAILED' -or
            $sevenResult.stdout_metadata.publication_status -ne 'PASS_CONTENT' -or
            $sevenResult.stderr_metadata.publication_status -ne 'PASS_CONTENT') {
            throw ("EXTERNAL-COMMAND-FAILED: seven exit contract failed " +
                "has_exited=$($sevenResult.has_exited) type=$($sevenResult.exit_code.GetType().FullName) " +
                "status=$($sevenResult.exit_code_status) code=$($sevenResult.exit_code) " +
                "failure=$($sevenResult.failure_code) stdout=$($sevenResult.stdout_metadata.publication_status) " +
                "stderr=$($sevenResult.stderr_metadata.publication_status)")
        }
        $requiredResultProperties = @(
            'process_id', 'has_exited', 'captured_ok', 'exit_code_status', 'exit_code',
            'start_utc', 'end_utc', 'stdout_metadata', 'stderr_metadata', 'failure_code'
        )
        $metadataPreserved = @($requiredResultProperties | Where-Object {
            $null -eq $sevenResult.PSObject.Properties[$_]
        }).Count -eq 0
        if (-not $metadataPreserved) { throw 'EXTERNAL-COMMAND-EXITCODE-UNAVAILABLE: result metadata incomplete' }

        $rustcCandidates = @(Get-Command rustc.exe -CommandType Application -ErrorAction SilentlyContinue)
        if ($rustcCandidates.Count -ne 1 -or $rustcCandidates[0].Source -isnot [string]) {
            throw 'REQUIRED-TOOL-MISSING: rustc.exe unavailable or ambiguous'
        }
        $rustcPath = [string]$rustcCandidates[0].Source
        $rustcVersionResults = @(Invoke-ExternalCaptured -FilePath $rustcPath -Arguments @('--version') `
            -WorkingDirectory $runtimeRoot -RuntimeRoot $runtimeRoot -EvidenceRoot $evidenceRoot `
            -LogName 'rustc-version')
        if ($rustcVersionResults.Count -ne 1) {
            throw 'EXTERNAL-COMMAND-EXITCODE-TYPE-MISMATCH: rustc version result cardinality'
        }
        $rustcVersionResult = $rustcVersionResults[0]
        Assert-ExternalCommandSucceeded -Result $rustcVersionResult -CommandLabel 'rustc version validation'
        if ($rustcVersionResult.stdout_metadata.publication_status -ne 'PASS_CONTENT') {
            throw 'SANITIZED-LOG-PUBLICATION-FAILED: rustc version stdout was not captured'
        }

        $rustSource = Join-Path $runtimeRoot 'minimal.rs'
        $rustExecutable = Join-Path $runtimeRoot 'minimal.exe'
        Write-Utf8NoBom -LiteralPath $rustSource -Value 'fn main() {}'
        $rustcCompileResults = @(Invoke-ExternalCaptured -FilePath $rustcPath -Arguments @(
            '--edition', '2021', $rustSource, '-o', $rustExecutable
        ) -WorkingDirectory $runtimeRoot -RuntimeRoot $runtimeRoot -EvidenceRoot $evidenceRoot `
            -LogName 'rustc-compile')
        if ($rustcCompileResults.Count -ne 1) {
            throw 'EXTERNAL-COMMAND-EXITCODE-TYPE-MISMATCH: rustc compile result cardinality'
        }
        $rustcCompileResult = $rustcCompileResults[0]
        Assert-ExternalCommandSucceeded -Result $rustcCompileResult -CommandLabel 'rustc minimal compile validation'
        $rustExecutablePresent = Test-Path -LiteralPath $rustExecutable -PathType Leaf
        $rustExecutableSha256 = if ($rustExecutablePresent) {
            Get-Sha256 -LiteralPath $rustExecutable
        }
        else {
            $null
        }
        if (-not $rustExecutablePresent -or [string]::IsNullOrWhiteSpace([string]$rustExecutableSha256)) {
            throw 'EXTERNAL-COMMAND-FAILED: rustc executable or hash unavailable'
        }

        return [ordered]@{
            RESULT_CARDINALITY = $zeroResults.Count
            HAS_EXITED = [bool]$zeroResult.has_exited
            EXIT_CODE_TYPE = $zeroResult.exit_code.GetType().FullName
            EXIT_CODE_STATUS = [string]$zeroResult.exit_code_status
            EXIT_CODE = $zeroResult.exit_code
            FAILURE_CODE = [string]$sevenResult.failure_code
            EXIT_SEVEN_CODE_TYPE = $sevenResult.exit_code.GetType().FullName
            EXIT_SEVEN_CODE_STATUS = [string]$sevenResult.exit_code_status
            EXIT_SEVEN_CODE = $sevenResult.exit_code
            STDOUT = [string]$sevenResult.stdout_metadata.publication_status
            STDERR = [string]$sevenResult.stderr_metadata.publication_status
            METADATA_PRESERVED = 'PASS'
            RUSTC_VERSION_EXIT_CODE_STATUS = [string]$rustcVersionResult.exit_code_status
            RUSTC_VERSION_EXIT_CODE = $rustcVersionResult.exit_code
            RUSTC_VERSION_STDOUT = [string]$rustcVersionResult.stdout_metadata.publication_status
            RUSTC_EXIT_CODE_TYPE = $rustcCompileResult.exit_code.GetType().FullName
            RUSTC_EXIT_CODE_STATUS = [string]$rustcCompileResult.exit_code_status
            RUSTC_EXIT_CODE = $rustcCompileResult.exit_code
            RUSTC_EXECUTABLE_PRESENT = [bool]$rustExecutablePresent
            RUSTC_EXECUTABLE_SHA256 = 'AVAILABLE'
            RUNTIME_CHILD_EXIT_CAPTURE = [string]$zeroResult.child_exit_capture
            RUNTIME_CHILD_EXIT_RECONSTRUCTION = [bool]$zeroResult.child_exit_reconstruction
        }
    }
    finally {
        if ($runtimeCreated -and (Test-Path -LiteralPath $runtimeRoot)) {
            $safeRuntime = Assert-NoReparseDescendant -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
            Remove-Item -LiteralPath $safeRuntime -Recurse -Force
        }
        if ($evidenceCreated -and (Test-Path -LiteralPath $evidenceRoot)) {
            $safeEvidence = Assert-NoReparseDescendant -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
            Remove-Item -LiteralPath $safeEvidence -Recurse -Force
        }
        $Script:LogCaptures.Clear()
    }
}

function New-StartupProbeSpec {
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot)
    $specPath = Join-Path $RuntimeRoot 'startup-probe.spec.ts'
    $specSource = @'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('WebView2 isolation startup probe', () => {
  it('initializes the application session and renders the root', async () => {
    const evidenceRoot = process.env.EVIDENCE_ROOT;
    if (!evidenceRoot) throw new Error('STARTUP-PROBE-EVIDENCE-ROOT-MISSING');
    const root = await $('#root');
    await root.waitForExist({ timeout: 10_000 });
    await root.waitForDisplayed({ timeout: 10_000 });
    writeFileSync(
      join(evidenceRoot, 'startup-probe-state.json'),
      JSON.stringify({
        schema_version: 1,
        application_session_initialized: true,
        application_root_visible: await root.isDisplayed(),
        observed_at_utc: new Date().toISOString(),
      }, null, 2) + '\n',
      { encoding: 'utf8' },
    );
    await browser.pause(5_000);
  });
});
'@
    Write-Utf8NoBom -LiteralPath $specPath -Value $specSource
    return [string][IO.Path]::GetFullPath($specPath)
}

function Invoke-WebViewIsolationValidation {
    $Script:OwnedProcessIdentities = @()
    $Script:OwnedProcessObjects.Clear()
    $Script:LogCaptures.Clear()
    $Script:AdditionalCleanupPorts = @()
    $runToken = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' +
        [guid]::NewGuid().ToString('N').Substring(0, 8).ToLowerInvariant()
    $evidencePrefix = 'ytm-free-webview-isolation-evidence-'
    $runtimePrefix = 'ytm-free-webview-isolation-runtime-'
    $evidenceRoot = Join-Path $env:TEMP ($evidencePrefix + $runToken)
    $runtimeRoot = Join-Path $env:TEMP ($runtimePrefix + $runToken)
    $preflight = $null
    $proxyState = $null
    $temporaryConfig = $null
    $phaseResult = $null
    $environmentBefore = $null
    $primaryFailure = $null
    $finalization = $null
    $firstIncompletePhase = 'preflight'
    $buildStatus = 'NOT RUN'
    $applicationLaunchStatus = 'NOT RUN'
    $wdioStatus = 'NOT RUN'
    $contextHarnessHead = 'UNKNOWN'
    $productionConfigBlobBefore = $null
    $productionConfigBlobAfter = $null
    $proxySummary = $null
    $mandatoryEvidenceRelativePaths = [Collections.Generic.List[string]]::new()
    $phaseEvidenceCatalog = @(
        'git-preflight.json',
        'toolchain.json',
        'run-metadata.json',
        'deny-proxy-metadata.json',
        'temporary-tauri-config-metadata.json',
        'build-provenance.json',
        'wdio-startup-launch-plan.json',
        'startup/startup-probe-state.json',
        'startup/owned-processes-startup.json',
        'startup/owned-tcp-startup.json',
        'startup/owned-process-lifecycle-startup.json',
        'deny-proxy-ledger.jsonl',
        'deny-proxy-summary.json',
        'webview-isolation-gates.json',
        'production-config-integrity.json'
    )
    [byte[]]$hmacKey = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $random.GetBytes($hmacKey)
    }
    finally {
        $random.Dispose()
    }

    try {
        $preflight = Invoke-SafePreflight
        $contextHarnessHead = [string]$preflight.git.HARNESS_HEAD_SHA
        $productionConfigBlobBeforeOutput = @(Invoke-GitRead -Arguments @(
            'hash-object', 'src-tauri/tauri.conf.json'
        ))
        if ($productionConfigBlobBeforeOutput.Count -ne 1) {
            throw 'PRODUCTION-TAURI-CONFIG-BLOB-READ-FAILED'
        }
        $productionConfigBlobBefore = [string]$productionConfigBlobBeforeOutput[0]

        $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
        $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
        $Script:ActiveEvidenceRoot = $evidenceRoot
        $Script:ActiveRuntimeRoot = $runtimeRoot
        $startupEvidenceRoot = Join-Path $evidenceRoot 'startup'
        $dataDir = Join-Path $runtimeRoot 'data'
        $spotifyDir = Join-Path $runtimeRoot 'spotify'
        $webViewDataDir = Join-Path $runtimeRoot 'webview2'
        $processTemp = Join-Path $runtimeRoot 'temp'
        foreach ($directory in @(
            $startupEvidenceRoot, $dataDir, $spotifyDir, $webViewDataDir, $processTemp
        )) {
            $null = New-Item -ItemType Directory -Path $directory -Force
        }

        foreach ($initialEvidencePath in @('git-preflight.json', 'toolchain.json', 'run-metadata.json')) {
            $mandatoryEvidenceRelativePaths.Add($initialEvidencePath) | Out-Null
        }
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
            mode = 'WEBVIEW-ISOLATION-STARTUP-PROBE'
            started_at_utc = (Get-Date).ToUniversalTime().ToString('o')
            functional_import_spec = 'NOT RUN'
            shim_compilation = 'NOT RUN'
        })

        $firstIncompletePhase = 'deny-proxy'
        $mandatoryEvidenceRelativePaths.Add('deny-proxy-metadata.json') | Out-Null
        $proxyState = Start-OwnedDenyProxy -RuntimeRoot $runtimeRoot -EvidenceRoot $evidenceRoot -HmacKey $hmacKey
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'deny-proxy-metadata.json') -Value ([ordered]@{
            listen_address = [string]$proxyState.listen_address
            listen_port = [int]$proxyState.port
            ownership_validated = [bool]$proxyState.ownership_validated
            process_id = [int]$proxyState.identity.process_id
            process_creation_utc = [string]$proxyState.identity.creation_date
            executable_name = Split-Path -Leaf ([string]$proxyState.identity.executable_path)
            outbound_connection_capability = 'NONE'
        })

        $firstIncompletePhase = 'temporary-tauri-config'
        $mandatoryEvidenceRelativePaths.Add('temporary-tauri-config-metadata.json') | Out-Null
        $temporaryConfig = New-TemporaryTauriConfiguration -RuntimeRoot $runtimeRoot -ProxyPort $proxyState.port
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'temporary-tauri-config-metadata.json') -Value ([ordered]@{
            production_config_blob = $temporaryConfig.production_config_blob
            temporary_config_sha256 = $temporaryConfig.temporary_config_sha256
            additional_browser_args_sha256 = $temporaryConfig.additional_browser_args_sha256
            proxy_port = $temporaryConfig.proxy_port
            DEFAULT_WRY_DISABLE_FEATURES_PRESERVED = $temporaryConfig.DEFAULT_WRY_DISABLE_FEATURES_PRESERVED
            PROXY_SERVER_COUNT = $temporaryConfig.PROXY_SERVER_COUNT
            PROXY_BYPASS_COUNT = $temporaryConfig.PROXY_BYPASS_COUNT
            DISABLE_BACKGROUND_COUNT = $temporaryConfig.DISABLE_BACKGROUND_COUNT
            CONFLICTING_PROXY_FLAG_COUNT = $temporaryConfig.CONFLICTING_PROXY_FLAG_COUNT
            TEMP_CONFIG_JSON_PARSE = $temporaryConfig.TEMP_CONFIG_JSON_PARSE
            TEMP_CONFIG_UNDER_RUNTIME_ROOT = $temporaryConfig.TEMP_CONFIG_UNDER_RUNTIME_ROOT
        })

        $firstIncompletePhase = 'application-build'
        $mandatoryEvidenceRelativePaths.Add('build-provenance.json') | Out-Null
        $buildStatus = 'IN PROGRESS'
        $buildStart = [DateTime]::UtcNow
        $tauriExecutablePath = Join-Path $RepoRoot 'node_modules\.bin\tauri.cmd'
        if (-not (Test-Path -LiteralPath $tauriExecutablePath -PathType Leaf)) {
            throw 'TAURI-CONFIG-OVERRIDE-UNAVAILABLE'
        }
        $buildResult = Invoke-ExternalCaptured -FilePath $tauriExecutablePath -Arguments @(
            'build', '--debug', '--no-bundle', '--features', 'wdio', '--config', $temporaryConfig.config_path
        ) -WorkingDirectory $RepoRoot -RuntimeRoot $runtimeRoot -EvidenceRoot $evidenceRoot `
            -LogName 'webview-isolation-build'
        $buildEnd = [DateTime]::UtcNow
        $binaryPath = Join-Path $RepoRoot 'src-tauri\target\debug\ytm-free.exe'
        $binaryPresent = Test-Path -LiteralPath $binaryPath -PathType Leaf
        $binaryItem = if ($binaryPresent) { Get-Item -LiteralPath $binaryPath } else { $null }
        $binaryFresh = $binaryPresent -and $binaryItem.LastWriteTimeUtc -ge $buildStart
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'build-provenance.json') -Value ([ordered]@{
            tauri_config_mode = 'TEMPORARY_OVERRIDE'
            production_config_blob = $productionConfigBlobBefore
            temporary_config_sha256 = $temporaryConfig.temporary_config_sha256
            additional_browser_args_sha256 = $temporaryConfig.additional_browser_args_sha256
            proxy_port = $temporaryConfig.proxy_port
            build_start_utc = $buildStart.ToString('o')
            build_end_utc = $buildEnd.ToString('o')
            build_exit_status = $buildResult.exit_code_status
            build_exit = $buildResult.exit_code
            binary_present = [bool]$binaryPresent
            binary_fresh = [bool]$binaryFresh
            binary_size = if ($binaryPresent) { [int64]$binaryItem.Length } else { $null }
            binary_sha256 = if ($binaryPresent) {
                Get-Sha256 -LiteralPath $binaryPath
            }
            else { $null }
        })
        Assert-ExternalCommandSucceeded -Result $buildResult -CommandLabel 'test-only WebView isolation build'
        if (-not $binaryFresh -or $binaryItem.Length -le 0) {
            throw 'UI-AUTOMATION-PATH-NOT-AVAILABLE'
        }
        $buildStatus = 'PASS'

        $firstIncompletePhase = 'startup-launch-plan'
        $startupSpecPath = New-StartupProbeSpec -RuntimeRoot $runtimeRoot
        $startupLaunchPlan = New-WdioLaunchPlan -Phase 'startup' -RequestedSpecPath $startupSpecPath `
            -RuntimeRoot $runtimeRoot
        $mandatoryEvidenceRelativePaths.Add('wdio-startup-launch-plan.json') | Out-Null
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'wdio-startup-launch-plan.json') -Value ([ordered]@{
            phase = $startupLaunchPlan.Phase
            executable_name = Split-Path -Leaf $startupLaunchPlan.FilePath
            file_path_type = $startupLaunchPlan.FilePath.GetType().FullName
            argument_list_type = $startupLaunchPlan.ArgumentList.GetType().FullName
            spec_location = '%RUNTIME_ROOT%\startup-probe.spec.ts'
            functional_spec_used = $false
        })

        $environmentBefore = Set-ProcessEnvironment -Values ([ordered]@{
            TEMP = $processTemp
            TMP = $processTemp
            YTM_FREE_DATA_DIR = $dataDir
            YTM_FREE_SPOTIFY_DIR = $spotifyDir
            WEBVIEW2_USER_DATA_FOLDER = $webViewDataDir
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null
            EVIDENCE_ROOT = $startupEvidenceRoot
            WDIO_EMBEDDED_PORT = [string]$EmbeddedPort
            TAURI_WEBDRIVER_PORT = [string]$EmbeddedPort
            IMPORT_DELETE_PHASE = 'startup'
            RUN_TOKEN = $runToken
        })
        if ($null -ne [Environment]::GetEnvironmentVariable(
            'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS',
            'Process'
        )) {
            throw 'BROWSER-ADDITIONAL-ARGS-NOT-APPLIED'
        }

        $firstIncompletePhase = 'wdio-startup'
        foreach ($runtimeEvidencePath in @(
            'startup/startup-probe-state.json',
            'startup/owned-processes-startup.json',
            'startup/owned-tcp-startup.json',
            'startup/owned-process-lifecycle-startup.json',
            'webview-isolation-gates.json'
        )) {
            $mandatoryEvidenceRelativePaths.Add($runtimeEvidencePath) | Out-Null
        }
        $applicationLaunchStatus = 'STARTUP ATTEMPTED'
        $wdioStatus = 'STARTUP IN PROGRESS'
        $phaseResult = Start-WdioPhase -LaunchPlan $startupLaunchPlan `
            -PhaseEvidenceRoot $startupEvidenceRoot -WebViewDataDir $webViewDataDir `
            -RuntimeRoot $runtimeRoot -ExpectedProxyPort $proxyState.port `
            -AdditionalOwnedProcessIdentities @($proxyState.identity)
        $startupStatePath = Join-Path $startupEvidenceRoot 'startup-probe-state.json'
        if (-not (Test-Path -LiteralPath $startupStatePath -PathType Leaf)) {
            throw 'APPLICATION-SESSION-NOT-INITIALIZED'
        }
        $startupState = Get-Content -LiteralPath $startupStatePath -Raw | ConvertFrom-Json
        $nonLoopbackConnections = @($phaseResult.connections | Where-Object {
            $_.remote_address -notin @('127.0.0.1', '::1', '0.0.0.0', '::')
        })
        $flagAudit = $phaseResult.webview.flag_audit
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'webview-isolation-gates.json') -Value ([ordered]@{
            application_session_initialized = [bool]$startupState.application_session_initialized
            application_root_visible = [bool]$startupState.application_root_visible
            browser_root_additional_args_present = [bool]$phaseResult.webview.additional_args_present
            browser_root_flag_audit = $flagAudit
            owned_non_loopback_tcp_connection_count = $nonLoopbackConnections.Count
            network_service_command_lines = @($phaseResult.webview.network_services | ForEach-Object {
                ConvertTo-RedactedText -Value ([string]$_.command_line) `
                    -EvidenceRoot $evidenceRoot -RuntimeRoot $runtimeRoot
            })
        })
        if (-not $startupState.application_session_initialized -or -not $startupState.application_root_visible -or
            -not $phaseResult.webview.additional_args_present -or $nonLoopbackConnections.Count -ne 0) {
            throw 'WEBVIEW2-NETWORK-ISOLATION-NOT-AVAILABLE'
        }
        $applicationLaunchStatus = 'PASS'
        $wdioStatus = 'PASS'
        $firstIncompletePhase = 'complete'
    }
    catch {
        if ($firstIncompletePhase -eq 'application-build') { $buildStatus = 'FAILED' }
        if ($firstIncompletePhase -eq 'wdio-startup') {
            $applicationLaunchStatus = 'FAILED'
            $wdioStatus = 'FAILED'
        }
        $primaryFailure = New-PrimaryFailureRecord -ErrorRecord $_ -Phase $firstIncompletePhase
        if (Test-Path -LiteralPath $evidenceRoot -PathType Container) {
            Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'primary-failure.json') -Value $primaryFailure
        }
    }
    finally {
        if ((Test-Path -LiteralPath $evidenceRoot -PathType Container) -and
            (Test-Path -LiteralPath $runtimeRoot -PathType Container)) {
            try {
                $preFinalizerLifecycle = Invoke-OwnedProcessShutdown `
                    -ProcessIdentities @($Script:OwnedProcessIdentities) `
                    -ProcessObjectRecords @($Script:OwnedProcessObjects) `
                    -LogCaptures @($Script:LogCaptures) -EvidenceRoot $evidenceRoot `
                    -RuntimeRoot $runtimeRoot -Stage 'startup-pre-finalizer' -StopRunning $true
                Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'startup-pre-finalizer-lifecycle.json') `
                    -Value $preFinalizerLifecycle
            }
            catch {
                if ($null -eq $primaryFailure) {
                    $primaryFailure = New-PrimaryFailureRecord -ErrorRecord $_ -Phase 'startup-pre-finalizer'
                    Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'primary-failure.json') -Value $primaryFailure
                }
            }
            if ($null -ne $proxyState) {
                try {
                    $proxySummary = Publish-DenyProxyLedger -ProxyState $proxyState -EvidenceRoot $evidenceRoot
                    foreach ($proxyEvidencePath in @('deny-proxy-ledger.jsonl', 'deny-proxy-summary.json')) {
                        $mandatoryEvidenceRelativePaths.Add($proxyEvidencePath) | Out-Null
                    }
                }
                catch {
                    if ($null -eq $primaryFailure) {
                        $primaryFailure = New-PrimaryFailureRecord -ErrorRecord $_ -Phase 'deny-proxy-ledger'
                        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'primary-failure.json') -Value $primaryFailure
                    }
                }
            }
            try {
                $productionConfigBlobAfterOutput = @(Invoke-GitRead -Arguments @(
                    'hash-object', 'src-tauri/tauri.conf.json'
                ))
                if ($productionConfigBlobAfterOutput.Count -ne 1) {
                    throw 'PRODUCTION-TAURI-CONFIG-BLOB-READ-FAILED'
                }
                $productionConfigBlobAfter = [string]$productionConfigBlobAfterOutput[0]
                Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'production-config-integrity.json') -Value ([ordered]@{
                    blob_before = $productionConfigBlobBefore
                    blob_after = $productionConfigBlobAfter
                    blob_match = $productionConfigBlobBefore -ceq $productionConfigBlobAfter
                })
                $mandatoryEvidenceRelativePaths.Add('production-config-integrity.json') | Out-Null
                if ($productionConfigBlobBefore -cne $productionConfigBlobAfter -and $null -eq $primaryFailure) {
                    throw 'PRODUCTION-TAURI-CONFIG-BLOB-CHANGED'
                }
            }
            catch {
                if ($null -eq $primaryFailure) {
                    $primaryFailure = New-PrimaryFailureRecord -ErrorRecord $_ -Phase 'production-config-integrity'
                    Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'primary-failure.json') -Value $primaryFailure
                }
            }

            try {
                $finalization = Invoke-HarnessFinalization -EvidenceRoot $evidenceRoot `
                    -EvidencePrefix $evidencePrefix -RuntimeRoot $runtimeRoot -RuntimePrefix $runtimePrefix `
                    -RunToken $runToken -HmacKey $hmacKey -PersonalRoots ([ordered]@{}) `
                    -PrivacyBefore $null -ProtectedPaths ([ordered]@{}) -ProtectedBefore $null `
                    -EnvironmentBefore $environmentBefore `
                    -OwnedProcessIdentities @($Script:OwnedProcessIdentities) `
                    -OwnedProcessObjects @($Script:OwnedProcessObjects) `
                    -LogCaptures @($Script:LogCaptures) -PrimaryFailure $primaryFailure `
                    -Context ([ordered]@{
                        first_incomplete_phase = $firstIncompletePhase
                        app_baseline_sha = if ($null -ne $preflight) {
                            [string]$preflight.git.APP_BASELINE_SHA
                        }
                        else { $ExpectedProductSha }
                        harness_head_sha = $contextHarnessHead
                        build_status = $buildStatus
                        application_launch_status = $applicationLaunchStatus
                        wdio_status = $wdioStatus
                        create_status = 'NOT_APPLICABLE'
                        restart_status = 'NOT_APPLICABLE'
                        mandatory_evidence_relative_paths = @($mandatoryEvidenceRelativePaths)
                        not_applicable_evidence_relative_paths = @($phaseEvidenceCatalog | Where-Object {
                            $_ -notin @($mandatoryEvidenceRelativePaths)
                        })
                    })
            }
            catch {
                Write-Warning ('FAILURE-FINALIZATION-INCOMPLETE: ' +
                    (ConvertTo-RedactedText -Value $_.Exception.Message))
            }
        }
        [Array]::Clear($hmacKey, 0, $hmacKey.Length)
        $Script:AdditionalCleanupPorts = @()
        $Script:ActiveEvidenceRoot = $null
        $Script:ActiveRuntimeRoot = $null
    }

    $evidenceFiles = if (Test-Path -LiteralPath $evidenceRoot -PathType Container) {
        @(Get-ChildItem -LiteralPath $evidenceRoot -Recurse -File -Force)
    }
    else { @() }
    $manifestReadBack = if (Test-Path -LiteralPath (Join-Path $evidenceRoot 'final-manifest.json') -PathType Leaf) {
        Get-Content -LiteralPath (Join-Path $evidenceRoot 'final-manifest.json') -Raw | ConvertFrom-Json
    }
    else { $null }
    $result = [ordered]@{
        RUN_TOKEN = $runToken
        EVIDENCE_ROOT = '%TEMP%\' + (Split-Path -Leaf $evidenceRoot)
        EVIDENCE_FILE_COUNT = $evidenceFiles.Count
        EVIDENCE_TOTAL_BYTES = [int64](($evidenceFiles | Measure-Object Length -Sum).Sum)
        PRODUCTION_TAURI_CONFIG_BLOB_BEFORE = $productionConfigBlobBefore
        PRODUCTION_TAURI_CONFIG_BLOB_AFTER = $productionConfigBlobAfter
        APPLICATION_SESSION_INITIALIZED = if ($null -ne $phaseResult) { $true } else { $false }
        BROWSER_ROOT_ADDITIONAL_ARGS_PRESENT = if ($null -ne $phaseResult) {
            [bool]$phaseResult.webview.additional_args_present
        }
        else { $false }
        OWNED_NON_LOOPBACK_TCP_CONNECTION_COUNT = if ($null -ne $phaseResult) {
            @($phaseResult.connections | Where-Object {
                $_.remote_address -notin @('127.0.0.1', '::1', '0.0.0.0', '::')
            }).Count
        }
        else { $null }
        DENY_PROXY_LISTEN_ADDRESS = if ($null -ne $proxyState) { $proxyState.listen_address } else { $null }
        DENY_PROXY_PORT = if ($null -ne $proxyState) { $proxyState.port } else { $null }
        DENY_PROXY_OWNERSHIP_VALIDATED = if ($null -ne $proxyState) {
            [bool]$proxyState.ownership_validated
        }
        else { $false }
        PROXY_HOSTNAME_ATTEMPT_COUNT = if ($null -ne $proxySummary) { $proxySummary.hostname_attempt_count } else { $null }
        PROXY_IPV4_LITERAL_ATTEMPT_COUNT = if ($null -ne $proxySummary) { $proxySummary.ipv4_literal_attempt_count } else { $null }
        PROXY_IPV6_LITERAL_ATTEMPT_COUNT = if ($null -ne $proxySummary) { $proxySummary.ipv6_literal_attempt_count } else { $null }
        PROXY_UNKNOWN_ATTEMPT_COUNT = if ($null -ne $proxySummary) { $proxySummary.unknown_attempt_count } else { $null }
        BROWSER_FLAG_AUDIT = if ($null -ne $phaseResult) { $phaseResult.webview.flag_audit } else { $null }
        FINAL_EVIDENCE_INVENTORY_SHA256 = if ($null -ne $finalization) { $finalization.inventory_sha256 } else { $null }
        FINAL_MANIFEST_SHA256 = if ($null -ne $finalization) { $finalization.manifest_sha256 } else { $null }
        CLEAR_PERSONAL_PATH_MATCH_COUNT = if ($null -ne $finalization) {
            $finalization.clear_personal_path_match_count
        }
        else { $null }
        cleanup_status = if ($null -ne $finalization) { $finalization.cleanup_status } else { $null }
        finalization_status = if ($null -ne $finalization) { $finalization.finalization_status } else { $null }
        evidence_completeness = if ($null -ne $finalization) { $finalization.evidence_completeness } else { $null }
        RUNTIME_ROOT_REMOVED = -not (Test-Path -LiteralPath $runtimeRoot)
        EVIDENCE_ROOT_PRESERVED = Test-Path -LiteralPath $evidenceRoot -PathType Container
        PRIMARY_FAILURE = $primaryFailure
        FINALIZATION_FAILURES = if ($null -ne $finalization) { @($finalization.finalization_failures) } else { @() }
        MANIFEST_RUN_STATUS = if ($null -ne $manifestReadBack) { $manifestReadBack.run_status } else { $null }
    }
    if ($null -ne $primaryFailure) {
        throw "$($primaryFailure.failure_code): $($primaryFailure.message_redacted)"
    }
    if ($null -eq $finalization -or $finalization.cleanup_status -ne 'PASS' -or
        $finalization.finalization_status -ne 'FINALIZED' -or
        $finalization.evidence_completeness -ne 'COMPLETE' -or
        $finalization.finalization_failures.Count -ne 0) {
        throw 'FAILURE-FINALIZATION-INCOMPLETE'
    }
    return $result
}

function Invoke-FullRuntimeHarness {
    $Script:OwnedProcessIdentities = @()
    $Script:OwnedProcessObjects.Clear()
    $Script:LogCaptures.Clear()
    $Script:RuntimeChildExitCodes = [ordered]@{}
    $preflight = $null
    $runToken = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8).ToLowerInvariant()
    $productShaPrefix = $ExpectedProductSha.Substring(0, 12)
    $evidencePrefix = "ytm-free-import-delete-evidence-$productShaPrefix-"
    $runtimePrefix = 'ytm-free-import-delete-runtime-'
    $evidenceRoot = Join-Path $env:TEMP "$evidencePrefix$runToken"
    $runtimeRoot = Join-Path $env:TEMP "ytm-free-import-delete-runtime-$runToken"
    $evidenceRoot = New-OwnedRoot -LiteralPath $evidenceRoot -Prefix $evidencePrefix -Token $runToken
    $runtimeRoot = New-OwnedRoot -LiteralPath $runtimeRoot -Prefix $runtimePrefix -Token $runToken
    $Script:ActiveEvidenceRoot = $evidenceRoot
    $Script:ActiveRuntimeRoot = $runtimeRoot

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
    $wrapperFailure = $null
    $finalization = $null
    $firstIncompletePhase = 'setup'
    $contextHarnessHead = 'UNKNOWN'
    $buildStatus = 'NOT RUN'
    $applicationLaunchStatus = 'NOT RUN'
    $wdioStatus = 'NOT RUN'
    $createStatus = 'NOT RUN'
    $restartStatus = 'NOT RUN'
    $phaseEvidenceCatalog = @(
        'git-preflight.json',
        'toolchain.json',
        'run-metadata.json',
        'fixture-metadata.json',
        'protected-files-before.json',
        'shim-source-metadata.json',
        'shim-executable-metadata.json',
        'build-provenance.json',
        'wdio-launch-plans.json',
        'controlled-environment-readback.json',
        'create/runtime-child-exit-code.txt',
        'create/create-state.json',
        'restart/runtime-child-exit-code.txt',
        'restart/restart-state.json',
        'final-logical-snapshot.json'
    )
    $mandatoryEvidenceRelativePaths = [Collections.Generic.List[string]]::new()
    try {
        $firstIncompletePhase = 'preflight'
        foreach ($preflightEvidencePath in @('git-preflight.json', 'toolchain.json', 'run-metadata.json')) {
            $mandatoryEvidenceRelativePaths.Add($preflightEvidencePath) | Out-Null
        }
        $headRead = @(Invoke-GitRead -Arguments @('rev-parse', 'HEAD'))
        if ($headRead.Count -eq 1) { $contextHarnessHead = [string]$headRead[0] }
        $preflight = Invoke-SafePreflight
        if ($preflight.git.identity_mode -ne 'COMMITTED-INSTRUMENTATION') {
            throw 'HARNESS-COMMIT-REQUIRED-BEFORE-RUNTIME'
        }

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
        $mandatoryEvidenceRelativePaths.Add('fixture-metadata.json') | Out-Null
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
            fixture_sha256 = Get-Sha256 -LiteralPath $fixturePath
        })

        $firstIncompletePhase = 'privacy-before'
        foreach ($privacySurfaceName in $personalRoots.Keys) {
            $mandatoryEvidenceRelativePaths.Add("privacy-$privacySurfaceName-before.json") | Out-Null
        }
        $mandatoryEvidenceRelativePaths.Add('protected-files-before.json') | Out-Null
        $privacyBefore = Capture-PrivacySnapshots -Roots $personalRoots -Key $hmacKey -EvidenceRoot $evidenceRoot -Moment 'before'
        $protectedBefore = @(Get-ProtectedFileSnapshots -Paths $protectedPaths -Key $hmacKey)
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'protected-files-before.json') -Value $protectedBefore

        $firstIncompletePhase = 'shim-build'
        $mandatoryEvidenceRelativePaths.Add('shim-source-metadata.json') | Out-Null
        $mandatoryEvidenceRelativePaths.Add('shim-executable-metadata.json') | Out-Null
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'shim-source-metadata.json') -Value ([ordered]@{
            source_relative_path = 'scripts/yt-dlp-import-delete-shim.rs'
            source_sha256 = Get-Sha256 -LiteralPath $ShimSource
        })
        $shimSourceSha256 = Get-Sha256 -LiteralPath $ShimSource
        $shimExe = Join-Path $shimDir 'yt-dlp.exe'
        $rustc = Get-Command rustc.exe -CommandType Application | Select-Object -First 1
        $shimCompileResult = Invoke-ExternalCaptured -FilePath ([string]$rustc.Source) -Arguments @(
            '--edition', '2021', $ShimSource, '-o', $shimExe
        ) -WorkingDirectory $RepoRoot -RuntimeRoot $runtimeRoot -EvidenceRoot $evidenceRoot -LogName 'shim-build'
        $shimExecutablePresent = Test-Path -LiteralPath $shimExe -PathType Leaf
        $shimExecutableSize = if ($shimExecutablePresent) { [int64](Get-Item -LiteralPath $shimExe).Length } else { $null }
        $shimExecutableSha256 = if ($shimExecutablePresent) {
            Get-Sha256 -LiteralPath $shimExe
        }
        else {
            $null
        }
        $shimFailureCode = if (-not [string]::IsNullOrWhiteSpace([string]$shimCompileResult.failure_code)) {
            [string]$shimCompileResult.failure_code
        }
        elseif (-not $shimExecutablePresent) {
            'YT_DLP-DETERMINISM-NOT-AVAILABLE'
        }
        else {
            $null
        }
        Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'shim-executable-metadata.json') -Value ([ordered]@{
            source_sha256 = $shimSourceSha256
            compile_started_utc = [string]$shimCompileResult.start_utc
            compile_finished_utc = [string]$shimCompileResult.end_utc
            compile_exit_status = [string]$shimCompileResult.exit_code_status
            compile_exit = $shimCompileResult.exit_code
            executable_present = [bool]$shimExecutablePresent
            executable_size = $shimExecutableSize
            executable_sha256 = $shimExecutableSha256
            stdout_metadata = $shimCompileResult.stdout_metadata
            stderr_metadata = $shimCompileResult.stderr_metadata
            failure_code = $shimFailureCode
        })
        Assert-ExternalCommandSucceeded -Result $shimCompileResult -CommandLabel 'rustc shim compilation'
        if (-not $shimExecutablePresent -or $shimExecutableSize -le 0 -or
            [string]::IsNullOrWhiteSpace([string]$shimExecutableSha256)) {
            throw 'YT_DLP-DETERMINISM-NOT-AVAILABLE: shim executable missing or empty after successful compile'
        }

        $firstIncompletePhase = 'application-build'
        $mandatoryEvidenceRelativePaths.Add('build-provenance.json') | Out-Null
        $buildStatus = 'IN PROGRESS'
        $buildStart = (Get-Date).ToUniversalTime()
        $npm = Get-Command npm.cmd -CommandType Application | Select-Object -First 1
        $buildResult = Invoke-ExternalCaptured -FilePath ([string]$npm.Source) -Arguments @('run', 'harness:build') `
            -WorkingDirectory $RepoRoot -RuntimeRoot $runtimeRoot -EvidenceRoot $evidenceRoot -LogName 'build'
        Assert-ExternalCommandSucceeded -Result $buildResult -CommandLabel 'application harness build'
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
            build_exit = $buildResult.exit_code
            APP_BASELINE_SHA = $preflight.git.APP_BASELINE_SHA
            HARNESS_HEAD_SHA = $preflight.git.HARNESS_HEAD_SHA
            ORIGIN_MAIN_SHA = $preflight.git.ORIGIN_MAIN_SHA
            HARNESS_MERGE_BASE_SHA = $preflight.git.HARNESS_MERGE_BASE_SHA
            HARNESS_DELTA_PATHS = $preflight.git.HARNESS_DELTA_PATHS
            HARNESS_COMMIT_COUNT = $preflight.git.HARNESS_COMMIT_COUNT
            binary_path = 'src-tauri/target/debug/ytm-free.exe'
            binary_size = [int64]$binary.Length
            binary_last_write_utc = $binary.LastWriteTimeUtc.ToString('o')
            binary_sha256 = Get-Sha256 -LiteralPath $binaryPath
        })
        $buildStatus = 'PASS'

        $firstIncompletePhase = 'wdio-launch-plan'
        $mandatoryEvidenceRelativePaths.Add('wdio-launch-plans.json') | Out-Null
        $mandatoryEvidenceRelativePaths.Add('controlled-environment-readback.json') | Out-Null
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
        $mandatoryEvidenceRelativePaths.Add('create/create-state.json') | Out-Null
        $mandatoryEvidenceRelativePaths.Add('create/runtime-child-exit-code.txt') | Out-Null
        $applicationLaunchStatus = 'CREATE ATTEMPTED'
        $wdioStatus = 'CREATE IN PROGRESS'
        $createStatus = 'IN PROGRESS'
        $createResult = Start-WdioPhase -LaunchPlan $createLaunchPlan -PhaseEvidenceRoot $createEvidence `
            -WebViewDataDir $webViewDataDir -RuntimeRoot $runtimeRoot
        $createStatus = 'PASS'
        $applicationLaunchStatus = 'CREATE PASS'
        $wdioStatus = 'CREATE PASS'

        $firstIncompletePhase = 'wdio-restart'
        $mandatoryEvidenceRelativePaths.Add('restart/restart-state.json') | Out-Null
        $mandatoryEvidenceRelativePaths.Add('restart/runtime-child-exit-code.txt') | Out-Null
        $applicationLaunchStatus = 'RESTART ATTEMPTED'
        $wdioStatus = 'RESTART IN PROGRESS'
        $restartStatus = 'IN PROGRESS'
        $restartResult = Start-WdioPhase -LaunchPlan $restartLaunchPlan -PhaseEvidenceRoot $restartEvidence `
            -WebViewDataDir $webViewDataDir -RuntimeRoot $runtimeRoot
        $restartStatus = 'PASS'
        $applicationLaunchStatus = 'PASS'
        $wdioStatus = 'PASS'

        $firstIncompletePhase = 'runtime-evidence-validation'
        $mandatoryEvidenceRelativePaths.Add('final-logical-snapshot.json') | Out-Null
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
                -OwnedProcessObjects @($Script:OwnedProcessObjects) -LogCaptures @($Script:LogCaptures) `
                -Context ([ordered]@{
                    first_incomplete_phase = $firstIncompletePhase
                    app_baseline_sha = if ($null -ne $preflight) {
                        [string]$preflight.git.APP_BASELINE_SHA
                    }
                    else { $ExpectedProductSha }
                    harness_head_sha = if ($null -ne $preflight) {
                        [string]$preflight.git.HARNESS_HEAD_SHA
                    }
                    else { $contextHarnessHead }
                    build_status = $buildStatus
                    application_launch_status = $applicationLaunchStatus
                    wdio_status = $wdioStatus
                    create_status = $createStatus
                    restart_status = $restartStatus
                    runtime_child_exit_codes = $Script:RuntimeChildExitCodes
                    mandatory_evidence_relative_paths = @($mandatoryEvidenceRelativePaths)
                    not_applicable_evidence_relative_paths = @($phaseEvidenceCatalog | Where-Object {
                        $_ -notin @($mandatoryEvidenceRelativePaths)
                    })
                })
        }
        catch {
            $wrapperFailureMessage = ConvertTo-RedactedText -Value $_.Exception.Message
            $wrapperFailure = [ordered]@{
                failure_code = 'POST-RUNTIME-WRAPPER-FAILURE'
                failure_phase = 'finalization-metadata'
                message_redacted = $wrapperFailureMessage
            }
            $fallbackCleanupStatus = if (Test-Path -LiteralPath $runtimeRoot) { 'FAILED' } else { 'PASS' }
            try {
                Write-JsonFile -LiteralPath (Join-Path $evidenceRoot 'final-manifest.json') -Value ([ordered]@{
                    run_status = if ($null -ne $primaryFailure) { 'FAILED' } else { 'BLOCKED' }
                    primary_failure = $primaryFailure
                    runtime_child_exit_capture = 'DIRECT-PROCESS-EXITCODE'
                    runtime_child_exit_reconstruction = $false
                    runtime_child_exit_codes = $Script:RuntimeChildExitCodes
                    wrapper_status = 'FAILED'
                    wrapper_failure = $wrapperFailure
                    metadata_status = 'FAILED'
                    cleanup_status = $fallbackCleanupStatus
                    application_launch_status = $applicationLaunchStatus
                    create_status = $createStatus
                    restart_status = $restartStatus
                    automatic_runtime_retry = $false
                })
            }
            catch {
                Write-Warning 'FINAL-MANIFEST-FALLBACK-WRITE-FAILED'
            }
            Write-Warning ('FAILURE-FINALIZATION-INCOMPLETE: ' + $wrapperFailureMessage)
        }
        [Array]::Clear($hmacKey, 0, $hmacKey.Length)
        $Script:ActiveEvidenceRoot = $null
        $Script:ActiveRuntimeRoot = $null
    }

    Write-Output "EVIDENCE_ROOT=%TEMP%\$(Split-Path -Leaf $evidenceRoot)"
    if ($null -ne $finalization) {
        Write-Output "FINAL_EVIDENCE_INVENTORY_SHA256:$($finalization.inventory_sha256)"
        Write-Output "FINAL_MANIFEST_SHA256:$($finalization.manifest_sha256)"
        Write-Output "FINAL_EVIDENCE_INVENTORY_EXCLUDES:$($finalization.inventory_exclusions -join ',')"
    }
    if ($null -ne $primaryFailure) {
        throw "$($primaryFailure.failure_code): $($primaryFailure.message_redacted)"
    }
    if ($null -ne $wrapperFailure) {
        throw "POST-RUNTIME-WRAPPER-FAILURE: $($wrapperFailure.message_redacted)"
    }
    if ($null -eq $finalization -or $finalization.finalization_failures.Count -ne 0) {
        throw 'FAILURE-FINALIZATION-INCOMPLETE'
    }
}

Set-Location $RepoRoot
$selectedModes = @(@(
    $HashCompatibilityValidateOnly,
    $ContractValidateOnly,
    $PreflightOnly,
    $LaunchPlanValidateOnly,
    $MonitorAndFinalizationValidateOnly,
    $ExternalCommandValidateOnly,
    $WebViewIsolationValidateOnly
) | Where-Object { $_ })
if ($selectedModes.Count -gt 1) {
    throw 'HashCompatibilityValidateOnly, ContractValidateOnly, PreflightOnly, LaunchPlanValidateOnly, MonitorAndFinalizationValidateOnly, ExternalCommandValidateOnly, and WebViewIsolationValidateOnly are mutually exclusive'
}

if ($HashCompatibilityValidateOnly) {
    $result = Invoke-HashCompatibilityValidation
    Write-Output "HASH_IMPLEMENTATION:$($result.HASH_IMPLEMENTATION)"
    Write-Output "GET_FILE_HASH_DEPENDENCY:$($result.GET_FILE_HASH_DEPENDENCY)"
    Write-Output "ASCII_ABC_VECTOR:$($result.ASCII_ABC_VECTOR)"
    Write-Output "EMPTY_FILE_VECTOR:$($result.EMPTY_FILE_VECTOR)"
    Write-Output "BINARY_VECTOR:$($result.BINARY_VECTOR)"
    Write-Output "HASH_REPEATABILITY:$($result.HASH_REPEATABILITY)"
    Write-Output "HASH_OUTPUT_FORMAT:$($result.HASH_OUTPUT_FORMAT)"
    Write-Output "APPLICATION_LAUNCHED:$($result.APPLICATION_LAUNCHED)"
    Write-Output "RUNTIME_ROOT_CREATED:$($result.RUNTIME_ROOT_CREATED)"
    Write-Output "VALIDATION_ROOT_REMOVED:$($result.VALIDATION_ROOT_REMOVED)"
    Write-NonClaims
    exit 0
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
    Write-Output "AUTOMATIC_VARIABLE_WRITE_COLLISION_COUNT:$($result.AUTOMATIC_VARIABLE_WRITE_COLLISION_COUNT)"
    Write-Output "GET_FILE_HASH_COMMAND_AST_COUNT:$($result.GET_FILE_HASH_COMMAND_AST_COUNT)"
    Write-Output "UTILITY_MODULE_IMPORT_AST_COUNT:$($result.UTILITY_MODULE_IMPORT_AST_COUNT)"
    Write-Output "UTILITY_MODULE_VERSION_ASSERTION_COUNT:$($result.UTILITY_MODULE_VERSION_ASSERTION_COUNT)"
    Write-Output "COMMANDINFO_VERSION_HASH_GATE_COUNT:$($result.COMMANDINFO_VERSION_HASH_GATE_COUNT)"
    Write-Output "DOTNET_SHA256_HELPER_COUNT:$($result.DOTNET_SHA256_HELPER_COUNT)"
    Write-Output "EVIDENCE_COMPLETENESS_FINALIZED_ASSIGNMENT_COUNT:$($result.EVIDENCE_COMPLETENESS_FINALIZED_ASSIGNMENT_COUNT)"
    Write-Output "DEFAULT_WRY_DISABLE_FEATURES_PRESERVED:$($result.DEFAULT_WRY_DISABLE_FEATURES_PRESERVED)"
    Write-Output "PROXY_SERVER_COUNT:$($result.PROXY_SERVER_COUNT)"
    Write-Output "PROXY_BYPASS_COUNT:$($result.PROXY_BYPASS_COUNT)"
    Write-Output "DISABLE_BACKGROUND_COUNT:$($result.DISABLE_BACKGROUND_COUNT)"
    Write-Output "CONFLICTING_PROXY_FLAG_COUNT:$($result.CONFLICTING_PROXY_FLAG_COUNT)"
    Write-Output "TEMP_CONFIG_JSON_PARSE:$($result.TEMP_CONFIG_JSON_PARSE)"
    Write-Output "TEMP_CONFIG_UNDER_RUNTIME_ROOT:$($result.TEMP_CONFIG_UNDER_RUNTIME_ROOT)"
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

if ($MonitorAndFinalizationValidateOnly) {
    $result = Invoke-MonitorAndFinalizationValidation
    $wrapperSeparationResult = Invoke-WrapperFailureSeparationValidation
    $emptyLogResult = Invoke-EmptyLogFinalizationValidation
    $publicationFailureResult = Invoke-PublicationFailureFinalizationValidation
    $unreadableEvidenceResult = Invoke-UnreadableEvidenceFinalizationValidation
    Write-Output "SYNTHETIC_MONITOR_FAILURE_PRESERVED:$($result.SYNTHETIC_MONITOR_FAILURE_PRESERVED)"
    Write-Output "SYNTHETIC_OWNED_PROCESS_STOPPED:$($result.SYNTHETIC_OWNED_PROCESS_STOPPED)"
    Write-Output "SYNTHETIC_PROCESS_WAIT_COMPLETED:$($result.SYNTHETIC_PROCESS_WAIT_COMPLETED)"
    Write-Output "SYNTHETIC_LOG_HANDLES_RELEASED:$($result.SYNTHETIC_LOG_HANDLES_RELEASED)"
    Write-Output "SYNTHETIC_DB_HANDLE_RELEASED:$($result.SYNTHETIC_DB_HANDLE_RELEASED)"
    Write-Output "SYNTHETIC_RAW_LOGS_REMOVED:$($result.SYNTHETIC_RAW_LOGS_REMOVED)"
    Write-Output "SYNTHETIC_SANITIZED_LOGS_CREATED:$($result.SYNTHETIC_SANITIZED_LOGS_CREATED)"
    Write-Output "SYNTHETIC_CLEAR_PATH_COUNT:$($result.SYNTHETIC_CLEAR_PATH_COUNT)"
    Write-Output "SYNTHETIC_PRIVACY_AFTER_CAPTURED:$($result.SYNTHETIC_PRIVACY_AFTER_CAPTURED)"
    Write-Output "SYNTHETIC_RUNTIME_ROOT_REMOVED:$($result.SYNTHETIC_RUNTIME_ROOT_REMOVED)"
    Write-Output "SYNTHETIC_CLEANUP_LEDGER:$($result.SYNTHETIC_CLEANUP_LEDGER)"
    Write-Output "SYNTHETIC_FINAL_INVENTORY:$($result.SYNTHETIC_FINAL_INVENTORY)"
    Write-Output "SYNTHETIC_FINAL_MANIFEST:$($result.SYNTHETIC_FINAL_MANIFEST)"
    Write-Output "SYNTHETIC_FINALIZATION_FAILURE_COUNT:$($result.SYNTHETIC_FINALIZATION_FAILURE_COUNT)"
    Write-Output "SYNTHETIC_NULL_VALUE_REJECTED:$($emptyLogResult.SYNTHETIC_NULL_VALUE_REJECTED)"
    Write-Output "SYNTHETIC_EMPTY_STDOUT_PUBLICATION:$($emptyLogResult.SYNTHETIC_EMPTY_STDOUT_PUBLICATION)"
    Write-Output "SYNTHETIC_EMPTY_STDERR_PUBLICATION:$($emptyLogResult.SYNTHETIC_EMPTY_STDERR_PUBLICATION)"
    Write-Output "SYNTHETIC_EMPTY_STDOUT_SIZE:$($emptyLogResult.SYNTHETIC_EMPTY_STDOUT_SIZE)"
    Write-Output "SYNTHETIC_EMPTY_STDERR_SIZE:$($emptyLogResult.SYNTHETIC_EMPTY_STDERR_SIZE)"
    Write-Output "SYNTHETIC_EMPTY_LOG_BOM_ABSENT:$($emptyLogResult.SYNTHETIC_EMPTY_LOG_BOM_ABSENT)"
    Write-Output "SYNTHETIC_EMPTY_RAW_LOGS_REMOVED:$($emptyLogResult.SYNTHETIC_EMPTY_RAW_LOGS_REMOVED)"
    Write-Output "SYNTHETIC_EMPTY_CLEAR_PATH_COUNT:$($emptyLogResult.SYNTHETIC_EMPTY_CLEAR_PATH_COUNT)"
    Write-Output "SYNTHETIC_EMPTY_FALSE_LOCK_CODE_ABSENT:$($emptyLogResult.SYNTHETIC_EMPTY_FALSE_LOCK_CODE_ABSENT)"
    Write-Output "SYNTHETIC_EMPTY_PERSISTENT_LOCK_COUNT:$($emptyLogResult.SYNTHETIC_EMPTY_PERSISTENT_LOCK_COUNT)"
    Write-Output "SYNTHETIC_EMPTY_FINALIZATION_STATUS:$($emptyLogResult.SYNTHETIC_EMPTY_FINALIZATION_STATUS)"
    Write-Output "SYNTHETIC_EMPTY_EVIDENCE_COMPLETENESS:$($emptyLogResult.SYNTHETIC_EMPTY_EVIDENCE_COMPLETENESS)"
    Write-Output "SYNTHETIC_EMPTY_INVENTORY:$($emptyLogResult.SYNTHETIC_EMPTY_INVENTORY)"
    Write-Output "SYNTHETIC_EMPTY_MANIFEST:$($emptyLogResult.SYNTHETIC_EMPTY_MANIFEST)"
    Write-Output "SYNTHETIC_EMPTY_FINALIZATION_FAILURE_COUNT:$($emptyLogResult.SYNTHETIC_EMPTY_FINALIZATION_FAILURE_COUNT)"
    Write-Output "SYNTHETIC_PUBLICATION_FAILURE_CODE:$($publicationFailureResult.SYNTHETIC_PUBLICATION_FAILURE_CODE)"
    Write-Output "SYNTHETIC_PUBLICATION_FALSE_LOCK_CODE_ABSENT:$($publicationFailureResult.SYNTHETIC_PUBLICATION_FALSE_LOCK_CODE_ABSENT)"
    Write-Output "SYNTHETIC_PUBLICATION_PERSISTENT_LOCK_COUNT:$($publicationFailureResult.SYNTHETIC_PUBLICATION_PERSISTENT_LOCK_COUNT)"
    Write-Output "SYNTHETIC_PUBLICATION_FINALIZATION_STATUS:$($publicationFailureResult.SYNTHETIC_PUBLICATION_FINALIZATION_STATUS)"
    Write-Output "SYNTHETIC_PUBLICATION_EVIDENCE_COMPLETENESS:$($publicationFailureResult.SYNTHETIC_PUBLICATION_EVIDENCE_COMPLETENESS)"
    Write-Output "SYNTHETIC_PUBLICATION_INVENTORY_PRESENT:$($publicationFailureResult.SYNTHETIC_PUBLICATION_INVENTORY_PRESENT)"
    Write-Output "SYNTHETIC_PUBLICATION_MANIFEST_PRESENT:$($publicationFailureResult.SYNTHETIC_PUBLICATION_MANIFEST_PRESENT)"
    Write-Output "SYNTHETIC_PUBLICATION_PRIMARY_FAILURE_PRESERVED:$($publicationFailureResult.SYNTHETIC_PUBLICATION_PRIMARY_FAILURE_PRESERVED)"
    Write-Output "SYNTHETIC_UNREADABLE_EVIDENCE_FINALIZATION:$unreadableEvidenceResult"
    Write-Output "RUNTIME_CHILD_EXIT_CAPTURE:$($wrapperSeparationResult.RUNTIME_CHILD_EXIT_CAPTURE)"
    Write-Output "RUNTIME_CHILD_EXIT_RECONSTRUCTION:$($wrapperSeparationResult.RUNTIME_CHILD_EXIT_RECONSTRUCTION)"
    Write-Output "WRAPPER_EXIT0_METADATA_FAILURE_TEST:$($wrapperSeparationResult.WRAPPER_EXIT0_METADATA_FAILURE_TEST)"
    Write-Output "WRAPPER_EXIT1_METADATA_SUCCESS_TEST:$($wrapperSeparationResult.WRAPPER_EXIT1_METADATA_SUCCESS_TEST)"
    Write-Output "WRAPPER_EXIT0_CLEANUP_FAILURE_TEST:$($wrapperSeparationResult.WRAPPER_EXIT0_CLEANUP_FAILURE_TEST)"
    Write-NonClaims
    exit 0
}

if ($ExternalCommandValidateOnly) {
    $result = Invoke-ExternalCommandValidation
    Write-Output 'SMOKE_EXIT_ZERO'
    Write-Output "RESULT_CARDINALITY:$($result.RESULT_CARDINALITY)"
    Write-Output "HAS_EXITED:$($result.HAS_EXITED)"
    Write-Output "EXIT_CODE_TYPE:$($result.EXIT_CODE_TYPE)"
    Write-Output "EXIT_CODE_STATUS:$($result.EXIT_CODE_STATUS)"
    Write-Output "EXIT_CODE:$($result.EXIT_CODE)"
    Write-Output 'SMOKE_EXIT_SEVEN'
    Write-Output "FAILURE_CODE:$($result.FAILURE_CODE)"
    Write-Output "EXIT_CODE_TYPE:$($result.EXIT_SEVEN_CODE_TYPE)"
    Write-Output "EXIT_CODE_STATUS:$($result.EXIT_SEVEN_CODE_STATUS)"
    Write-Output "EXIT_CODE:$($result.EXIT_SEVEN_CODE)"
    Write-Output "EXIT_SEVEN_CODE_TYPE:$($result.EXIT_SEVEN_CODE_TYPE)"
    Write-Output "EXIT_SEVEN_CODE_STATUS:$($result.EXIT_SEVEN_CODE_STATUS)"
    Write-Output "EXIT_SEVEN_CODE:$($result.EXIT_SEVEN_CODE)"
    Write-Output "STDOUT:$($result.STDOUT)"
    Write-Output "STDERR:$($result.STDERR)"
    Write-Output "METADATA_PRESERVED:$($result.METADATA_PRESERVED)"
    Write-Output 'RUSTC_VERSION'
    Write-Output "EXIT_CODE_STATUS:$($result.RUSTC_VERSION_EXIT_CODE_STATUS)"
    Write-Output "EXIT_CODE:$($result.RUSTC_VERSION_EXIT_CODE)"
    Write-Output "STDOUT:$($result.RUSTC_VERSION_STDOUT)"
    Write-Output "RUSTC_VERSION_EXIT_CODE_STATUS:$($result.RUSTC_VERSION_EXIT_CODE_STATUS)"
    Write-Output "RUSTC_VERSION_EXIT_CODE:$($result.RUSTC_VERSION_EXIT_CODE)"
    Write-Output "RUSTC_VERSION_STDOUT:$($result.RUSTC_VERSION_STDOUT)"
    Write-Output 'RUSTC_COMPILE'
    Write-Output "RUSTC_EXIT_CODE_TYPE:$($result.RUSTC_EXIT_CODE_TYPE)"
    Write-Output "RUSTC_EXIT_CODE_STATUS:$($result.RUSTC_EXIT_CODE_STATUS)"
    Write-Output "RUSTC_EXIT_CODE:$($result.RUSTC_EXIT_CODE)"
    Write-Output "RUSTC_EXECUTABLE_PRESENT:$($result.RUSTC_EXECUTABLE_PRESENT)"
    Write-Output "RUSTC_EXECUTABLE_SHA256:$($result.RUSTC_EXECUTABLE_SHA256)"
    Write-Output "RUNTIME_CHILD_EXIT_CAPTURE:$($result.RUNTIME_CHILD_EXIT_CAPTURE)"
    Write-Output "RUNTIME_CHILD_EXIT_RECONSTRUCTION:$($result.RUNTIME_CHILD_EXIT_RECONSTRUCTION)"
    Write-NonClaims
    exit 0
}

if ($WebViewIsolationValidateOnly) {
    $result = Invoke-WebViewIsolationValidation
    Write-Output "RUN_TOKEN:$($result.RUN_TOKEN)"
    Write-Output "EVIDENCE_ROOT:$($result.EVIDENCE_ROOT)"
    Write-Output "EVIDENCE_FILE_COUNT:$($result.EVIDENCE_FILE_COUNT)"
    Write-Output "EVIDENCE_TOTAL_BYTES:$($result.EVIDENCE_TOTAL_BYTES)"
    Write-Output "PRODUCTION_TAURI_CONFIG_BLOB_BEFORE:$($result.PRODUCTION_TAURI_CONFIG_BLOB_BEFORE)"
    Write-Output "PRODUCTION_TAURI_CONFIG_BLOB_AFTER:$($result.PRODUCTION_TAURI_CONFIG_BLOB_AFTER)"
    Write-Output "APPLICATION_SESSION_INITIALIZED:$($result.APPLICATION_SESSION_INITIALIZED)"
    Write-Output "BROWSER_ROOT_ADDITIONAL_ARGS_PRESENT:$($result.BROWSER_ROOT_ADDITIONAL_ARGS_PRESENT)"
    Write-Output "OWNED_NON_LOOPBACK_TCP_CONNECTION_COUNT:$($result.OWNED_NON_LOOPBACK_TCP_CONNECTION_COUNT)"
    Write-Output "DENY_PROXY_LISTEN_ADDRESS:$($result.DENY_PROXY_LISTEN_ADDRESS)"
    Write-Output "DENY_PROXY_PORT:$($result.DENY_PROXY_PORT)"
    Write-Output "DENY_PROXY_OWNERSHIP_VALIDATED:$($result.DENY_PROXY_OWNERSHIP_VALIDATED)"
    Write-Output "PROXY_HOSTNAME_ATTEMPT_COUNT:$($result.PROXY_HOSTNAME_ATTEMPT_COUNT)"
    Write-Output "PROXY_IPV4_LITERAL_ATTEMPT_COUNT:$($result.PROXY_IPV4_LITERAL_ATTEMPT_COUNT)"
    Write-Output "PROXY_IPV6_LITERAL_ATTEMPT_COUNT:$($result.PROXY_IPV6_LITERAL_ATTEMPT_COUNT)"
    Write-Output "PROXY_UNKNOWN_ATTEMPT_COUNT:$($result.PROXY_UNKNOWN_ATTEMPT_COUNT)"
    if ($null -ne $result.BROWSER_FLAG_AUDIT) {
        Write-Output "BROWSER_ROOT_DISABLE_FEATURES_COUNT:$($result.BROWSER_FLAG_AUDIT.disable_features_count)"
        Write-Output "BROWSER_ROOT_DISABLE_BACKGROUND_COUNT:$($result.BROWSER_FLAG_AUDIT.disable_background_count)"
        Write-Output "BROWSER_ROOT_DISABLE_COMPONENT_UPDATE_COUNT:$($result.BROWSER_FLAG_AUDIT.disable_component_update_count)"
        Write-Output "BROWSER_ROOT_NO_FIRST_RUN_COUNT:$($result.BROWSER_FLAG_AUDIT.no_first_run_count)"
        Write-Output "BROWSER_ROOT_DISABLE_QUIC_COUNT:$($result.BROWSER_FLAG_AUDIT.disable_quic_count)"
        Write-Output "BROWSER_ROOT_PROXY_SERVER_COUNT:$($result.BROWSER_FLAG_AUDIT.proxy_server_count)"
        Write-Output "BROWSER_ROOT_PROXY_BYPASS_COUNT:$($result.BROWSER_FLAG_AUDIT.proxy_bypass_count)"
        Write-Output "BROWSER_ROOT_CONFLICTING_PROXY_COUNT:$($result.BROWSER_FLAG_AUDIT.conflicting_proxy_count)"
        Write-Output "BROWSER_ROOT_PROXY_PORT_MATCH:$($result.BROWSER_FLAG_AUDIT.proxy_port_match)"
    }
    Write-Output "CLEAR_PERSONAL_PATH_MATCH_COUNT:$($result.CLEAR_PERSONAL_PATH_MATCH_COUNT)"
    Write-Output "cleanup_status:$($result.cleanup_status)"
    Write-Output "finalization_status:$($result.finalization_status)"
    Write-Output "evidence_completeness:$($result.evidence_completeness)"
    Write-Output "FINAL_EVIDENCE_INVENTORY_SHA256:$($result.FINAL_EVIDENCE_INVENTORY_SHA256)"
    Write-Output "FINAL_MANIFEST_SHA256:$($result.FINAL_MANIFEST_SHA256)"
    Write-Output "RUNTIME_ROOT_REMOVED:$($result.RUNTIME_ROOT_REMOVED)"
    Write-Output "EVIDENCE_ROOT_PRESERVED:$($result.EVIDENCE_ROOT_PRESERVED)"
    exit 0
}

if ($PreflightOnly) {
    $result = Invoke-SafePreflight
    $sanitizedTools = @($result.tools | ForEach-Object {
        [ordered]@{
            name = [string]$_.name
            path_alias = "%TOOL_ROOT%\$([string]$_.name)"
        }
    })
    [ordered]@{
        git = $result.git
        tools = $sanitizedTools
        listeners = $result.listeners
        conflicting_processes = $result.conflicting_processes
        temp_root_checked = $result.temp_root_checked
    } | ConvertTo-Json -Depth 20
    Write-NonClaims
    exit 0
}

Invoke-FullRuntimeHarness
