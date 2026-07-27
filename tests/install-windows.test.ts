import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Windows installer extracts into staging before replacing installed bundle", () => {
	const installer = readFileSync(resolve(appRoot, "scripts", "install", "install.ps1"), "utf8");

	assert.match(installer, /\$extractRoot = Join-Path \$tmpDir "extract"/);
	assert.match(installer, /\$extractedBundleDir = Join-Path \$extractRoot \$bundleName/);
	assert.match(installer, /Expand-Archive -LiteralPath \$archivePath -DestinationPath \$extractRoot -Force/);
	assert.match(installer, /Downloaded archive did not contain the expected \$bundleName directory/);
	assert.match(installer, /Get-FileHash -LiteralPath \$archivePath -Algorithm SHA256/);
	assert.match(installer, /SHA-256 mismatch/);
	assert.match(installer, /SHA256SUMS contains multiple checksum entries/);
	assert.equal((installer.match(/Invoke-WebRequest/g) ?? []).length, 3);
	assert.equal((installer.match(/-UseBasicParsing/g) ?? []).length, 3);
	assert.match(installer, /\$backupBundleDir = Join-Path \$tmpDir "previous-bundle"/);
	assert.match(installer, /\$backupBinDir = Join-Path \$tmpDir "previous-bin"/);
	assert.match(installer, /FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_BACKUP/);
	assert.match(installer, /Move-Item -LiteralPath \$installBinDir -Destination \$backupBinDir/);
	assert.match(installer, /Move-Item -LiteralPath \$stagedBinDir -Destination \$installBinDir/);
	assert.match(installer, /FEYNMAN_INSTALL_TEST_FAIL_AFTER_BUNDLE_SWAP/);
	assert.match(installer, /Move-Item -LiteralPath \$extractedBundleDir -Destination \$bundleDir/);
	assert.match(installer, /\$candidatePs1 = Join-Path \$extractedBundleDir "feynman\.ps1"/);
	assert.match(
		installer,
		/& \$powerShellExecutable -NoProfile -ExecutionPolicy Bypass -File \$candidatePs1 --version/,
	);
	assert.doesNotMatch(installer, /@\(& \$candidate --version 2>&1\)/);
	assert.match(installer, /"ARM64" \{ return "x64" \}/);
	assert.match(installer, /"Arm64" \{ return "x64" \}/);
	assert.doesNotMatch(installer, /\$resolvedCommand\.Source -ne \$shimPath/);
	assert.doesNotMatch(installer, /Move-Item -LiteralPath \$shimCandidate -Destination \$shimPath/);
	assert.doesNotMatch(installer, /Expand-Archive -LiteralPath \$archivePath -DestinationPath \$installRoot -Force/);
});

test("website Windows installer stays synced with the packaged installer", () => {
	const installer = readFileSync(resolve(appRoot, "scripts", "install", "install.ps1"), "utf8");
	const websiteInstaller = readFileSync(resolve(appRoot, "website", "public", "install.ps1"), "utf8");

	assert.equal(websiteInstaller, installer);
});

test("Windows installer verifier defines every strict-mode install path", () => {
	const verifier = readFileSync(resolve(appRoot, "scripts", "verify-windows-installer.ps1"), "utf8");

	assert.match(verifier, /Set-StrictMode -Version 2\.0/);
	assert.match(verifier, /\$installBinDir = Join-Path \$installRoot "bin"/);
	assert.match(verifier, /\$env:PATH = "\$installBinDir;\$env:PATH"/);
});
