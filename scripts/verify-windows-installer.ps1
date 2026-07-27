param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,

  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
if ((Get-Item -LiteralPath $archive).Length -eq 0) {
  throw "Native archive is empty: $archive"
}

$baseTemp = if ($env:RUNNER_TEMP) {
  $env:RUNNER_TEMP
} else {
  [System.IO.Path]::GetTempPath()
}
$testRoot = Join-Path $baseTemp ("feynman-installer-" + [guid]::NewGuid().ToString("N"))
$serverScript = Join-Path $testRoot "serve-feynman-archive.mjs"
$portFile = Join-Path $testRoot "archive-port.txt"
$checksumFile = Join-Path $testRoot "SHA256SUMS"
$serverJob = $null

New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$archiveName = Split-Path -Leaf $archive
$archiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$archiveSha256  $archiveName" | Set-Content -LiteralPath $checksumFile -Encoding ASCII

try {
  @'
import { createReadStream, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";

const archive = process.env.ARCHIVE_PATH;
const checksumFile = process.env.CHECKSUM_PATH;
const portFile = process.env.ARCHIVE_PORT_FILE;
const archiveName = basename(archive);
const checksumName = basename(checksumFile);
const server = createServer((request, response) => {
  const pathname = new URL(
    request.url ?? "/",
    "http://127.0.0.1",
  ).pathname;

  if (pathname === "/healthz") {
    response.writeHead(204);
    response.end();
    return;
  }

  const source = pathname === `/${archiveName}`
    ? archive
    : pathname === `/${checksumName}`
      ? checksumFile
      : undefined;
  if (!source) {
    response.writeHead(404);
    response.end("not found");
    return;
  }

  const size = statSync(source).size;
  response.writeHead(200, {
    "Content-Type": source === archive ? "application/zip" : "text/plain",
    "Content-Length": size,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(source).pipe(response);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine local archive server port");
  }
  writeFileSync(portFile, String(address.port));
});
'@ | Set-Content -LiteralPath $serverScript -Encoding utf8

  $serverJob = Start-Job -ScriptBlock {
    param($script, $archivePath, $checksumsPath, $serverPortFile)
    $env:ARCHIVE_PATH = $archivePath
    $env:CHECKSUM_PATH = $checksumsPath
    $env:ARCHIVE_PORT_FILE = $serverPortFile
    & node $script
    if ($LASTEXITCODE -ne 0) {
      throw "Local archive server failed: $LASTEXITCODE"
    }
  } -ArgumentList $serverScript, $archive, $checksumFile, $portFile

  $baseUrl = $null
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    if (Test-Path -LiteralPath $portFile) {
      $port = (Get-Content -LiteralPath $portFile -Raw).Trim()
      if ($port -match "^\d+$") {
        $baseUrl = "http://127.0.0.1:$port"
        break
      }
    }

    if ($serverJob.State -eq "Failed" -or $serverJob.State -eq "Completed") {
      Receive-Job -Job $serverJob
      throw "Local archive server exited before becoming ready"
    }
    Start-Sleep -Seconds 1
  }

  if (-not $baseUrl) {
    Receive-Job -Job $serverJob
    throw "Local archive server did not publish a listening port"
  }

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    try {
      $response = Invoke-WebRequest `
        -Uri "$baseUrl/healthz" `
        -UseBasicParsing `
        -TimeoutSec 2
      if ($response.StatusCode -eq 204) {
        $ready = $true
        break
      }
    } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw "Local archive server did not become ready"
  }

  $env:LOCALAPPDATA = Join-Path $testRoot "LocalAppData"
  $env:FEYNMAN_HOME = Join-Path $testRoot "FeynmanHome"
  $env:FEYNMAN_INSTALL_BASE_URL = $baseUrl
  $env:NO_PROXY = "127.0.0.1,localhost"

  $installerSource = Get-Content `
    -LiteralPath "scripts/install/install.ps1" `
    -Raw
  $installer = [scriptblock]::Create($installerSource)

  $installRoot = Join-Path $env:LOCALAPPDATA "Programs\feynman"
  $installBinDir = Join-Path $installRoot "bin"
  $bundleDir = Join-Path $installRoot "feynman-$Version-win32-x64"
  $shim = Join-Path $installRoot "bin\feynman.cmd"
  $shimPs1 = Join-Path $installRoot "bin\feynman.ps1"

  function Assert-InstalledCandidate {
    $launchers = @(
      $shim,
      $shimPs1,
      (Join-Path $bundleDir "feynman.cmd"),
      (Join-Path $bundleDir "feynman.ps1")
    )
    foreach ($launcher in $launchers) {
      if (-not (Test-Path -LiteralPath $launcher)) {
        throw "Installed launcher is missing: $launcher"
      }

      $versionOutput = @(& $launcher --version 2>&1)
      $versionExit = $LASTEXITCODE
      if ($versionExit -ne 0) {
        throw "Installed feynman --version failed for ${launcher}: $versionExit"
      }
      $actualVersion = ($versionOutput | Select-Object -Last 1).ToString().Trim()
      if ($actualVersion -ne $Version) {
        throw "Version mismatch for ${launcher}: expected=$Version actual=$actualVersion"
      }

      $helpOutput = @(& $launcher --help 2>&1)
      $helpExit = $LASTEXITCODE
      if ($helpExit -ne 0) {
        throw "Installed feynman --help failed for ${launcher}: $helpExit"
      }
      if ($helpOutput.Count -eq 0) {
        throw "Installed feynman --help returned no output for $launcher"
      }
      $helpOutput | Select-Object -First 20
    }
  }

  & $installer -Version $Version
  Assert-InstalledCandidate
  $env:PATH = "$installBinDir;$env:PATH"

  for ($pass = 1; $pass -le 2; $pass += 1) {
    $sentinel = Join-Path $bundleDir "stale-pass-$pass.sentinel"
    "must be removed" | Set-Content -LiteralPath $sentinel

    & $installer -Version $Version

    if (Test-Path -LiteralPath $sentinel) {
      throw "Replacement pass $pass retained the old bundle"
    }
    Assert-InstalledCandidate
  }

  $duplicateSentinel = Join-Path $bundleDir "duplicate-checksum-must-preserve.sentinel"
  "must remain" | Set-Content -LiteralPath $duplicateSentinel
  $conflictingChecksum = "0" * 64
  foreach ($checksumLines in @(
    @("$archiveSha256  $archiveName", "$conflictingChecksum  $archiveName"),
    @("$conflictingChecksum  $archiveName", "$archiveSha256  $archiveName")
  )) {
    $checksumLines | Set-Content -LiteralPath $checksumFile -Encoding ASCII
    $duplicateRejected = $false
    try {
      & $installer -Version $Version
    } catch {
      $duplicateRejected = $_.Exception.Message -match "multiple checksum entries"
    }
    if (-not $duplicateRejected) {
      throw "Installer did not reject duplicate checksum entries"
    }
    if (-not (Test-Path -LiteralPath $duplicateSentinel)) {
      throw "Duplicate checksum entries replaced the prior installed bundle"
    }
  }

  "$archiveSha256  $archiveName" | Set-Content -LiteralPath $checksumFile -Encoding ASCII
  $backupFailureSentinel = Join-Path $bundleDir "backup-failure-must-preserve.sentinel"
  "must remain" | Set-Content -LiteralPath $backupFailureSentinel
  $env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_BACKUP = "1"
  $backupFailureRejected = $false
  try {
    & $installer -Version $Version
  } catch {
    $backupFailureRejected = $_.Exception.Message -match "Injected installer failure after bundle backup"
  } finally {
    Remove-Item Env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_BACKUP -ErrorAction SilentlyContinue
  }
  if (-not $backupFailureRejected) {
    throw "Installer did not surface the injected bundle-backup failure"
  }
  if (-not (Test-Path -LiteralPath $backupFailureSentinel)) {
    throw "Failed bundle backup removed the previous bundle"
  }
  Assert-InstalledCandidate

  $preservedSentinel = Join-Path $bundleDir "checksum-failure-must-preserve.sentinel"
  "must remain" | Set-Content -LiteralPath $preservedSentinel
  ("0" * 64) + "  $archiveName" | Set-Content -LiteralPath $checksumFile -Encoding ASCII
  $checksumRejected = $false
  try {
    & $installer -Version $Version
  } catch {
    $checksumRejected = $_.Exception.Message -match "SHA-256 mismatch"
  }
  if (-not $checksumRejected) {
    throw "Installer did not reject a corrupted archive checksum"
  }
  if (-not (Test-Path -LiteralPath $preservedSentinel)) {
    throw "Checksum failure replaced the prior installed bundle"
  }

  $previousBundleDir = Join-Path $installRoot "feynman-previous-win32-x64"
  Move-Item -LiteralPath $bundleDir -Destination $previousBundleDir
  @"
@echo off
CALL "$previousBundleDir\feynman.cmd" %*
"@ | Set-Content -LiteralPath $shim -Encoding ASCII
  @"
`$BundleDir = "$previousBundleDir"
& "`$BundleDir\node\node.exe" "`$BundleDir\app\bin\feynman.js" @args
"@ | Set-Content -LiteralPath $shimPs1 -Encoding UTF8
  $upgradeSentinel = Join-Path $previousBundleDir "upgrade-failure-must-preserve.sentinel"
  "must remain" | Set-Content -LiteralPath $upgradeSentinel
  "$archiveSha256  $archiveName" | Set-Content -LiteralPath $checksumFile -Encoding ASCII

  $env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_SWAP = "1"
  $upgradeFailureRejected = $false
  try {
    & $installer -Version $Version
  } catch {
    $upgradeFailureRejected = $_.Exception.Message -match "Injected installer failure"
  } finally {
    Remove-Item Env:FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_SWAP -ErrorAction SilentlyContinue
  }
  if (-not $upgradeFailureRejected) {
    throw "Installer did not surface the injected upgrade failure"
  }
  if (Test-Path -LiteralPath $bundleDir) {
    throw "Failed upgrade retained the replacement bundle"
  }
  if (-not (Test-Path -LiteralPath $upgradeSentinel)) {
    throw "Failed upgrade removed the previous bundle"
  }
  foreach ($launcher in @($shim, $shimPs1)) {
    $versionOutput = @(& $launcher --version 2>&1)
    $versionExit = $LASTEXITCODE
    if ($versionExit -ne 0) {
      throw "Restored launcher failed after injected upgrade failure: $launcher"
    }
    $actualVersion = ($versionOutput | Select-Object -Last 1).ToString().Trim()
    if ($actualVersion -ne $Version) {
      throw "Restored launcher version mismatch after injected failure: $launcher"
    }
  }
} finally {
  if ($serverJob) {
    Stop-Job -Job $serverJob -ErrorAction SilentlyContinue
    Receive-Job -Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job -Job $serverJob -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
