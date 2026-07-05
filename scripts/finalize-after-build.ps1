param(
    [ValidateSet("Current", "Milestone", "Rules")]
    [string]$Mode = "Current",

    [string]$ExePath = "build/bin/ServerPilot.exe",

    [switch]$Check,

    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot = Split-Path -Parent $scriptRoot

function U([int[]]$Codes) {
    return -join ($Codes | ForEach-Object { [char]$_ })
}

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

function Read-Utf8Text([string]$Path) {
    $resolved = Resolve-Path -LiteralPath $Path
    $text = [System.IO.File]::ReadAllText($resolved)
    return $text.TrimStart([char]0xFEFF)
}

function Normalize-Text([string]$Text) {
    return ($Text.TrimStart([char]0xFEFF) -replace "`r`n", "`n").TrimEnd() + "`n"
}

function Count-Lines([string]$Text) {
    $normalized = Normalize-Text $Text
    if ($normalized.Length -eq 0) {
        return 0
    }
    return ($normalized -split "`n").Count - 1
}

function New-CompatibleContent([string]$SourceName) {
    $sourceText = Read-Utf8Text $SourceName
    $body = (Normalize-Text $sourceText).TrimEnd()
    $primaryLabel = U @(0x4e2d, 0x6587, 0x4e3b, 0x6587, 0x6863)
    return Normalize-Text ("# Compatibility Entry`n`n$primaryLabel`: ``$SourceName```n`n---`n`n$body")
}

function Add-Pair([System.Collections.ArrayList]$Pairs, [string]$Source, [string]$Target) {
    [void]$Pairs.Add([pscustomobject]@{
        Source = $Source
        Target = $Target
    })
}

Push-Location $repoRoot
try {
    $docCurrent = (U @(0x5f53, 0x524d, 0x8f6e, 0x6b21, 0x72b6, 0x6001)) + ".md"
    $docProgress = (U @(0x5f00, 0x53d1, 0x8fdb, 0x5c55)) + ".md"
    $docHandoff = (U @(0x9879, 0x76ee, 0x4ea4, 0x63a5)) + ".md"
    $docRoadmap = (U @(0x8def, 0x7ebf, 0x56fe)) + ".md"
    $docArchitecture = (U @(0x67b6, 0x6784, 0x8bf4, 0x660e)) + ".md"
    $docSecurity = (U @(0x5b89, 0x5168, 0x8fb9, 0x754c)) + ".md"
    $docRules = "Codex" + (U @(0x5f00, 0x53d1, 0x89c4, 0x5219)) + ".md"

    Write-Output "Post-build finalization"
    Write-Output "Mode: $Mode"
    if ($Check) { Write-Output "Check: true" }
    if ($WhatIf) { Write-Output "WhatIf: true" }

    $pairs = New-Object System.Collections.ArrayList
    if ($Mode -eq "Current" -or $Mode -eq "Milestone") {
        Add-Pair $pairs $docCurrent "AI_BRIEF.md"
        Add-Pair $pairs $docProgress "DEV_PROGRESS.md"
    }
    if ($Mode -eq "Milestone") {
        Add-Pair $pairs $docHandoff "HANDOFF.md"
        Add-Pair $pairs $docRoadmap "ROADMAP.md"
    }
    if ($Mode -eq "Rules") {
        Add-Pair $pairs $docArchitecture "ARCHITECTURE.md"
        Add-Pair $pairs $docSecurity "SECURITY.md"
    }

    foreach ($pair in $pairs) {
        if (-not (Test-Path -LiteralPath $pair.Source)) {
            Fail "Missing source document: $($pair.Source)"
        }
        if (-not (Test-Path -LiteralPath $pair.Target)) {
            Fail "Missing compatibility document: $($pair.Target)"
        }
    }

    if (-not (Test-Path -LiteralPath "AGENTS.md")) {
        Fail "Missing AGENTS.md"
    }
    $agentsText = Read-Utf8Text "AGENTS.md"
    if ($agentsText -notmatch [regex]::Escape($docRules)) {
        Fail "AGENTS.md must point to $docRules"
    }

    $aiExpected = New-CompatibleContent $docCurrent
    $aiLines = Count-Lines $aiExpected
    if ($aiLines -gt 120) {
        Fail "AI_BRIEF.md would have $aiLines lines, exceeding 120"
    }

    $changed = $false
    foreach ($pair in $pairs) {
        $expected = New-CompatibleContent $pair.Source
        $current = Read-Utf8Text $pair.Target
        $inSync = (Normalize-Text $current) -eq (Normalize-Text $expected)

        if ($Check) {
            if (-not $inSync) {
                Write-Output "Out of sync: $($pair.Source) -> $($pair.Target)"
                $changed = $true
            } else {
                Write-Output "In sync: $($pair.Source) -> $($pair.Target)"
            }
            continue
        }

        if ($WhatIf) {
            if ($inSync) {
                Write-Output "Would keep: $($pair.Source) -> $($pair.Target)"
            } else {
                Write-Output "Would sync: $($pair.Source) -> $($pair.Target)"
            }
            continue
        }

        if ($inSync) {
            Write-Output "Up-to-date: $($pair.Source) -> $($pair.Target)"
        } else {
            [System.IO.File]::WriteAllText((Resolve-Path -LiteralPath $pair.Target), $expected, $utf8NoBom)
            Write-Output "Synced: $($pair.Source) -> $($pair.Target)"
        }
    }

    if ($Check -and $changed) {
        Fail "Compatibility documents are out of sync"
    }

    $resolvedExe = Resolve-Path -LiteralPath $ExePath -ErrorAction SilentlyContinue
    if (-not $resolvedExe) {
        Fail "EXE not found: $ExePath"
    }
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedExe.Path
    Write-Output "EXE: $ExePath"
    Write-Output "SHA-256: $($hash.Hash)"
    Write-Output "AI_BRIEF lines: $aiLines / 120"

    & git diff --check
    if ($LASTEXITCODE -ne 0) {
        Fail "git diff --check failed"
    }
    Write-Output "git diff --check: passed"

    $stopwatch.Stop()
    Write-Output ("Elapsed: {0:N1}s" -f $stopwatch.Elapsed.TotalSeconds)
}
finally {
    Pop-Location
}
