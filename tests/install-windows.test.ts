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
	assert.match(installer, /Move-Item -LiteralPath \$extractedBundleDir -Destination \$bundleDir/);
	assert.doesNotMatch(installer, /Expand-Archive -LiteralPath \$archivePath -DestinationPath \$installRoot -Force/);
});

test("website Windows installer stays synced with the packaged installer", () => {
	const installer = readFileSync(resolve(appRoot, "scripts", "install", "install.ps1"), "utf8");
	const websiteInstaller = readFileSync(resolve(appRoot, "website", "public", "install.ps1"), "utf8");

	assert.equal(websiteInstaller, installer);
});
