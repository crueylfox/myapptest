param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactDirectory,

    [string]$ArtifactName = 'ServerPilot-macos-unsigned'
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

function Read-ExpectedHash([string]$Path) {
    $text = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path))
    $match = [regex]::Match($text, '^[A-Fa-f0-9]{64}')
    if (-not $match.Success) {
        Fail "Invalid SHA-256 file: $Path"
    }
    return $match.Value.ToUpperInvariant()
}

function Assert-FileHash([string]$FilePath, [string]$HashPath) {
    $expected = Read-ExpectedHash $HashPath
    $actual = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actual -ne $expected) {
        Fail "SHA-256 mismatch: $FilePath"
    }
    [pscustomobject]@{
        File = [System.IO.Path]::GetFileName($FilePath)
        SHA256 = $actual
    }
}

$artifactRoot = Resolve-Path -LiteralPath $ArtifactDirectory
$expectedFiles = @(
    'ServerPilot-macos-universal-unsigned.zip',
    'ServerPilot-macos-universal-unsigned.dmg',
    'ServerPilot-macos-universal-unsigned.zip.sha256',
    'ServerPilot-macos-universal-unsigned.dmg.sha256'
)

# Mirrors GitHub upload-artifact if-no-files-found: error behavior without downloading artifacts.
foreach ($file in $expectedFiles) {
    $path = Join-Path $artifactRoot $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Fail "Missing $ArtifactName artifact file: $file"
    }
}

Write-Output "Artifact: $ArtifactName"
Assert-FileHash `
    (Join-Path $artifactRoot 'ServerPilot-macos-universal-unsigned.zip') `
    (Join-Path $artifactRoot 'ServerPilot-macos-universal-unsigned.zip.sha256')
Assert-FileHash `
    (Join-Path $artifactRoot 'ServerPilot-macos-universal-unsigned.dmg') `
    (Join-Path $artifactRoot 'ServerPilot-macos-universal-unsigned.dmg.sha256')
