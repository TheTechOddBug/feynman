param(
  [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

function Normalize-Version {
  param([string]$RequestedVersion)

  if (-not $RequestedVersion) {
    return "latest"
  }

  switch ($RequestedVersion.ToLowerInvariant()) {
    "latest" { return "latest" }
    "stable" { return "latest" }
    "edge" { throw "The edge channel has been removed. Use the default installer for the latest tagged release or pass an exact version." }
    default { return $RequestedVersion.TrimStart("v") }
  }
}

function Resolve-LatestReleaseVersion {
  $page = Invoke-WebRequest `
    -Uri "https://github.com/companion-inc/feynman/releases/latest" `
    -UseBasicParsing
  $match = [regex]::Match($page.Content, 'releases/tag/v([0-9][^"''<>\s]*)')
  if (-not $match.Success) {
    throw "Failed to resolve the latest Feynman release version."
  }

  return $match.Groups[1].Value
}

function Resolve-ReleaseMetadata {
  param(
    [string]$RequestedVersion,
    [string]$AssetTarget,
    [string]$BundleExtension
  )

  $normalizedVersion = Normalize-Version -RequestedVersion $RequestedVersion

  if ($normalizedVersion -eq "latest") {
    $resolvedVersion = Resolve-LatestReleaseVersion
  } else {
    $resolvedVersion = $normalizedVersion
  }

  $bundleName = "feynman-$resolvedVersion-$AssetTarget"
  $archiveName = "$bundleName.$BundleExtension"
  $baseUrl = if ($env:FEYNMAN_INSTALL_BASE_URL) { $env:FEYNMAN_INSTALL_BASE_URL } else { "https://github.com/companion-inc/feynman/releases/download/v$resolvedVersion" }

  return [PSCustomObject]@{
    ResolvedVersion = $resolvedVersion
    BundleName = $bundleName
    ArchiveName = $archiveName
    DownloadUrl = "$baseUrl/$archiveName"
    ChecksumsUrl = "$baseUrl/SHA256SUMS"
  }
}

function Get-ArchSuffix {
  # Prefer PROCESSOR_ARCHITECTURE which is always available on Windows.
  # RuntimeInformation::OSArchitecture requires .NET 4.7.1+ and may not
  # be loaded in every Windows PowerShell 5.1 session.
  $envArch = $env:PROCESSOR_ARCHITECTURE
  if ($envArch) {
    switch ($envArch) {
      "AMD64" { return "x64" }
      # The release currently ships the Windows x64 bundle. Windows 11 on Arm
      # runs that bundle through its supported x64 emulation layer.
      "ARM64" { return "x64" }
    }
  }

  try {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch.ToString()) {
      "X64" { return "x64" }
      "Arm64" { return "x64" }
    }
  } catch {}

  throw "Unsupported architecture: $envArch"
}

$archSuffix = Get-ArchSuffix
$assetTarget = "win32-$archSuffix"
$release = Resolve-ReleaseMetadata -RequestedVersion $Version -AssetTarget $assetTarget -BundleExtension "zip"
$resolvedVersion = $release.ResolvedVersion
$bundleName = $release.BundleName
$archiveName = $release.ArchiveName
$downloadUrl = $release.DownloadUrl
$checksumsUrl = $release.ChecksumsUrl

$installRoot = Join-Path $env:LOCALAPPDATA "Programs\feynman"
$installBinDir = Join-Path $installRoot "bin"
$bundleDir = Join-Path $installRoot $bundleName

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("feynman-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir | Out-Null

try {
  $archivePath = Join-Path $tmpDir $archiveName
  $checksumsPath = Join-Path $tmpDir "SHA256SUMS"
  $extractRoot = Join-Path $tmpDir "extract"
  $extractedBundleDir = Join-Path $extractRoot $bundleName
  Write-Host "==> Downloading $archiveName"
  try {
    Invoke-WebRequest `
      -Uri $downloadUrl `
      -OutFile $archivePath `
      -UseBasicParsing
  } catch {
    throw @"
Failed to download $archiveName from:
  $downloadUrl

The win32-$archSuffix bundle is missing from the GitHub release.
This usually means the release exists, but not all platform bundles were uploaded.

Workarounds:
  - try again after the release finishes publishing
  - pass the latest published version explicitly, e.g.:
    & ([scriptblock]::Create((irm https://feynman.is/install.ps1))) -Version 0.2.31
"@
  }

  Write-Host "==> Verifying $archiveName"
  Invoke-WebRequest `
    -Uri $checksumsUrl `
    -OutFile $checksumsPath `
    -UseBasicParsing
  $escapedArchiveName = [regex]::Escape($archiveName)
  $checksumMatches = @(
    Select-String `
      -LiteralPath $checksumsPath `
      -Pattern "^([0-9a-fA-F]{64})\s+\*?$escapedArchiveName$"
  )
  if ($checksumMatches.Count -eq 0) {
    throw "SHA256SUMS does not contain a valid checksum for $archiveName."
  }
  if ($checksumMatches.Count -ne 1) {
    throw "SHA256SUMS contains multiple checksum entries for $archiveName."
  }
  $expectedChecksum = $checksumMatches[0].Matches[0].Groups[1].Value.ToLowerInvariant()
  $actualChecksum = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualChecksum -ne $expectedChecksum) {
    throw "SHA-256 mismatch for ${archiveName}: expected $expectedChecksum, found $actualChecksum."
  }

  Write-Host "==> Extracting $archiveName"
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
  if (-not (Test-Path $extractedBundleDir)) {
    throw "Downloaded archive did not contain the expected $bundleName directory."
  }
  $candidateCmd = Join-Path $extractedBundleDir "feynman.cmd"
  $candidatePs1 = Join-Path $extractedBundleDir "feynman.ps1"
  foreach ($candidate in @($candidateCmd, $candidatePs1)) {
    if (-not (Test-Path -LiteralPath $candidate)) {
      throw "Downloaded archive did not contain the expected launcher: $candidate"
    }
  }
  $candidateVersionOutput = @(& $candidateCmd --version 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Downloaded launcher failed --version: $candidateCmd"
  }
  $candidateVersion = ($candidateVersionOutput | Select-Object -Last 1).ToString().Trim()
  if ($candidateVersion -ne $resolvedVersion) {
    throw "Downloaded bundle version mismatch: expected=$resolvedVersion actual=$candidateVersion"
  }
  $candidateHelp = @(& $candidateCmd --help 2>&1)
  if ($LASTEXITCODE -ne 0 -or $candidateHelp.Count -eq 0) {
    throw "Downloaded launcher failed --help: $candidateCmd"
  }

  # The public one-line installer can run under Windows PowerShell's default
  # Restricted policy because it executes an in-memory scriptblock. Validate
  # the packaged PowerShell launcher in a child host with an explicit process-
  # scoped bypass rather than invoking the downloaded .ps1 file directly.
  $powerShellExecutable = (Get-Process -Id $PID).Path
  $candidateVersionOutput = @(
    & $powerShellExecutable -NoProfile -ExecutionPolicy Bypass -File $candidatePs1 --version 2>&1
  )
  if ($LASTEXITCODE -ne 0) {
    throw "Downloaded launcher failed --version: $candidatePs1"
  }
  $candidateVersion = ($candidateVersionOutput | Select-Object -Last 1).ToString().Trim()
  if ($candidateVersion -ne $resolvedVersion) {
    throw "Downloaded bundle version mismatch: expected=$resolvedVersion actual=$candidateVersion"
  }
  $candidateHelp = @(
    & $powerShellExecutable -NoProfile -ExecutionPolicy Bypass -File $candidatePs1 --help 2>&1
  )
  if ($LASTEXITCODE -ne 0 -or $candidateHelp.Count -eq 0) {
    throw "Downloaded launcher failed --help: $candidatePs1"
  }

  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  $stagedBinDir = Join-Path $tmpDir "bin"
  New-Item -ItemType Directory -Path $stagedBinDir -Force | Out-Null
  $shimCandidate = Join-Path $stagedBinDir "feynman.cmd"
  $shimPs1Candidate = Join-Path $stagedBinDir "feynman.ps1"
  @"
@echo off
CALL "$bundleDir\feynman.cmd" %*
"@ | Set-Content -Path $shimCandidate -Encoding ASCII

  @"
`$BundleDir = "$bundleDir"
& "`$BundleDir\node\node.exe" "`$BundleDir\app\bin\feynman.js" @args
"@ | Set-Content -Path $shimPs1Candidate -Encoding UTF8

  $backupBundleDir = Join-Path $tmpDir "previous-bundle"
  $backupBinDir = Join-Path $tmpDir "previous-bin"
  $hadPreviousBundle = Test-Path -LiteralPath $bundleDir
  $hadPreviousBin = Test-Path -LiteralPath $installBinDir
  $backupBundleMoved = $false
  $backupBinMoved = $false
  $candidateBundleInstalled = $false
  $candidateBinInstalled = $false
  try {
    if ($hadPreviousBundle) {
      Move-Item -LiteralPath $bundleDir -Destination $backupBundleDir
      $backupBundleMoved = $true
    }
    if ($env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_BACKUP -eq "1") {
      throw "Injected installer failure after bundle backup."
    }
    if ($hadPreviousBin) {
      Move-Item -LiteralPath $installBinDir -Destination $backupBinDir
      $backupBinMoved = $true
    }
    Move-Item -LiteralPath $extractedBundleDir -Destination $bundleDir
    $candidateBundleInstalled = $true
    Write-Host "==> Linking feynman into $installBinDir"
    if ($env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_SWAP -eq "1") {
      throw "Injected installer failure after bundle swap."
    }
    Move-Item -LiteralPath $stagedBinDir -Destination $installBinDir
    $candidateBinInstalled = $true
  } catch {
    if ($candidateBundleInstalled -and (Test-Path -LiteralPath $bundleDir)) {
      Remove-Item -LiteralPath $bundleDir -Recurse -Force
    }
    if ($candidateBinInstalled -and (Test-Path -LiteralPath $installBinDir)) {
      Remove-Item -LiteralPath $installBinDir -Recurse -Force
    }
    if ($backupBundleMoved -and (Test-Path -LiteralPath $backupBundleDir)) {
      Move-Item -LiteralPath $backupBundleDir -Destination $bundleDir
    }
    if ($backupBinMoved -and (Test-Path -LiteralPath $backupBinDir)) {
      Move-Item -LiteralPath $backupBinDir -Destination $installBinDir
    }
    throw
  }
  if (Test-Path -LiteralPath $backupBundleDir) {
    Remove-Item -LiteralPath $backupBundleDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $backupBinDir) {
    Remove-Item -LiteralPath $backupBinDir -Recurse -Force
  }
  Get-ChildItem -LiteralPath $installRoot -Directory -Filter "feynman-*" |
    Where-Object { $_.FullName -ne $bundleDir } |
    Remove-Item -Recurse -Force

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $alreadyOnPath = $false
  if ($currentUserPath) {
    $alreadyOnPath = $currentUserPath.Split(';') -contains $installBinDir
  }
  if (-not $alreadyOnPath) {
    $updatedPath = if ([string]::IsNullOrWhiteSpace($currentUserPath)) {
      $installBinDir
    } else {
      "$currentUserPath;$installBinDir"
    }
    [Environment]::SetEnvironmentVariable("Path", $updatedPath, "User")
    Write-Host "Updated user PATH. Open a new shell to run feynman."
  } else {
    Write-Host "$installBinDir is already on PATH."
  }

  $resolvedCommand = Get-Command feynman -ErrorAction SilentlyContinue
  $expectedShimPaths = @(
    [System.IO.Path]::GetFullPath((Join-Path $installBinDir "feynman.cmd")),
    [System.IO.Path]::GetFullPath((Join-Path $installBinDir "feynman.ps1"))
  )
  $resolvedSource = if ($resolvedCommand) { $resolvedCommand.Source } else { $null }
  $resolvedToInstalledShim = $false
  if ($resolvedSource) {
    $resolvedFullPath = [System.IO.Path]::GetFullPath($resolvedSource)
    foreach ($expectedShimPath in $expectedShimPaths) {
      if ([string]::Equals($resolvedFullPath, $expectedShimPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $resolvedToInstalledShim = $true
        break
      }
    }
  }
  if ($resolvedCommand -and -not $resolvedToInstalledShim) {
    Write-Warning "Current shell resolves feynman to $($resolvedCommand.Source)"
    Write-Host "Run in a new shell, or run: `$env:Path = '$installBinDir;' + `$env:Path"
    Write-Host "Then run: feynman"
    Write-Host "If that path is an old package-manager install, remove it or put $installBinDir first on PATH."
  }

  Write-Host "Feynman $resolvedVersion installed successfully."
} finally {
  if (Test-Path $tmpDir) {
    Remove-Item -Recurse -Force $tmpDir
  }
}
