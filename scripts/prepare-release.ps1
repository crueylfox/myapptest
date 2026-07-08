param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
    [string]$Version,

    [switch]$Check,

    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot = Split-Path -Parent $scriptRoot

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

function Read-Utf8Text([string]$Path) {
    $resolved = Resolve-Path -LiteralPath $Path
    return [System.IO.File]::ReadAllText($resolved).TrimStart([char]0xFEFF)
}

function Write-Utf8Text([string]$Path, [string]$Text) {
    $resolved = Resolve-Path -LiteralPath $Path
    [System.IO.File]::WriteAllText($resolved, $Text, $utf8NoBom)
}

function Normalize-LineEnding([string]$Text) {
    return $Text -replace "`r`n", "`n"
}

function Replace-ExactVersion([string]$Path, [string]$OldVersion, [string]$NewVersion) {
    $text = Read-Utf8Text $Path
    if ($text -notlike "*$OldVersion*") {
        Fail "Expected $Path to contain current version $OldVersion"
    }
    return $text.Replace($OldVersion, $NewVersion)
}

function Get-MD5ForText([string]$Text) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try {
        $bytes = $utf8NoBom.GetBytes($Text)
        $hash = $md5.ComputeHash($bytes)
        return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $md5.Dispose()
    }
}

function Add-ExpectedFile([System.Collections.ArrayList]$Expected, [string]$Path, [string]$Text) {
    [void]$Expected.Add([pscustomobject]@{
        Path = $Path
        Text = $Text
    })
}

Push-Location $repoRoot
try {
    $status = & git status --short
    if ($LASTEXITCODE -ne 0) {
        Fail 'git status --short failed'
    }
    if ($status -and -not ($Check -or $WhatIf)) {
        Fail 'Working tree must be clean before preparing a release version.'
    }

    if (-not (Test-Path -LiteralPath 'VERSION')) {
        Fail 'Missing VERSION'
    }
    $currentVersion = (Read-Utf8Text 'VERSION').Trim()
    if (-not $currentVersion) {
        Fail 'VERSION is empty'
    }

    Write-Output "Prepare release version"
    Write-Output "Current: $currentVersion"
    Write-Output "Target:  $Version"
    if ($Check) { Write-Output 'Mode: Check' }
    if ($WhatIf) { Write-Output 'Mode: WhatIf' }

    $expected = New-Object System.Collections.ArrayList
    Add-ExpectedFile $expected 'VERSION' "$Version`n"
    Add-ExpectedFile $expected 'internal/version/version.go' (Replace-ExactVersion 'internal/version/version.go' $currentVersion $Version)
    Add-ExpectedFile $expected 'app_test.go' (Replace-ExactVersion 'app_test.go' $currentVersion $Version)

    $packageJsonText = Replace-ExactVersion 'frontend/package.json' $currentVersion $Version
    Add-ExpectedFile $expected 'frontend/package.json' $packageJsonText
    Add-ExpectedFile $expected 'frontend/package-lock.json' (Replace-ExactVersion 'frontend/package-lock.json' $currentVersion $Version)
    Add-ExpectedFile $expected 'frontend/package.json.md5' (Get-MD5ForText $packageJsonText)

    Add-ExpectedFile $expected 'frontend/src/AI_BRIEF.current-handoff.structure.test.ts' (Replace-ExactVersion 'frontend/src/AI_BRIEF.current-handoff.structure.test.ts' $currentVersion $Version)
    Add-ExpectedFile $expected 'AI_BRIEF.md' (Replace-ExactVersion 'AI_BRIEF.md' $currentVersion $Version)

    $changed = $false
    foreach ($item in $expected) {
        if (-not (Test-Path -LiteralPath $item.Path)) {
            Fail "Missing release target file: $($item.Path)"
        }
        $currentText = Read-Utf8Text $item.Path
        $same = (Normalize-LineEnding $currentText) -eq (Normalize-LineEnding $item.Text)
        if ($Check) {
            if ($same) {
                Write-Output "In sync: $($item.Path)"
            } else {
                Write-Output "Out of sync: $($item.Path)"
                $changed = $true
            }
            continue
        }
        if ($WhatIf) {
            if ($same) {
                Write-Output "Would keep: $($item.Path)"
            } else {
                Write-Output "Would update: $($item.Path)"
            }
            continue
        }
        if ($same) {
            Write-Output "Up-to-date: $($item.Path)"
        } else {
            Write-Utf8Text $item.Path $item.Text
            Write-Output "Updated: $($item.Path)"
        }
    }

    if ($Check -and $changed) {
        Fail "Release version files are not synchronized for $Version"
    }

    $briefLines = ((Read-Utf8Text 'AI_BRIEF.md') -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 }).Count
    if (-not $WhatIf -and -not $Check) {
        $briefLines = ((Read-Utf8Text 'AI_BRIEF.md') -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 }).Count
    }
    if ($briefLines -gt 120) {
        Fail "AI_BRIEF.md has $briefLines nonblank lines, exceeding 120"
    }
    Write-Output "AI_BRIEF nonblank lines: $briefLines / 120"
}
finally {
    Pop-Location
}
