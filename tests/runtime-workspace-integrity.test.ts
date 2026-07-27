import assert from "node:assert/strict";
import { appendFileSync, linkSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
	computeRuntimeArchiveTreeHash,
	computeRuntimeInputHash,
	computeRuntimeTreeHash,
	RUNTIME_INPUT_FILES,
	runtimeArchiveMatches,
	workspacePackagesMatch,
	writeFileSha256,
} from "../scripts/lib/runtime-workspace-integrity.mjs";
import { createDeterministicTarGz } from "../scripts/lib/deterministic-archive.mjs";

test("runtime workspace integrity checks installed versions and the exact archive digest", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-integrity-"));
	const feynmanDir = join(root, ".feynman");
	const workspace = join(feynmanDir, "npm");
	const nodeModules = join(workspace, "node_modules");
	const packageRoot = join(nodeModules, "@scope", "runtime");
	const manifestPath = join(workspace, ".runtime-manifest.json");
	const lockPath = join(feynmanDir, "runtime-package-lock.json");
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	const inputPath = join(root, "runtime-input.txt");
	const inputFiles = ["runtime-input.txt"];
	const specs = ["@scope/runtime@1.2.3"];

	mkdirSync(packageRoot, { recursive: true });
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
		name: "@scope/runtime",
		version: "1.2.3",
	}));
	const lockSource = JSON.stringify({
		lockfileVersion: 3,
		packages: {
			"": { dependencies: { "@scope/runtime": "1.2.3" } },
			"node_modules/@scope/runtime": { version: "1.2.3" },
		},
	}) + "\n";
	writeFileSync(join(workspace, "package-lock.json"), lockSource);
	writeFileSync(lockPath, lockSource);
	writeFileSync(inputPath, "runtime input\n");
	const runtimeInputHash = computeRuntimeInputHash(root, inputFiles);
	writeFileSync(manifestPath, JSON.stringify({
		packageSpecs: specs,
		runtimeInputHash,
		runtimeTreeHash: computeRuntimeTreeHash(workspace),
	}) + "\n");

	const packed = spawnSync("tar", ["-czf", archivePath, "-C", feynmanDir, "npm"], {
		env: { ...process.env, COPYFILE_DISABLE: "1" },
	});
	assert.equal(packed.status, 0);
	writeFileSha256(archivePath, digestPath);

	assert.equal(workspacePackagesMatch(nodeModules, specs), true);
	assert.equal(runtimeArchiveMatches({
		archivePath,
		digestPath,
		lockPath,
		manifestPath,
		packageSpecs: specs,
		runtimeInputHash,
	}), true);

	appendFileSync(inputPath, "changed\n");
	assert.equal(runtimeArchiveMatches({
		archivePath,
		digestPath,
		lockPath,
		manifestPath,
		packageSpecs: specs,
		runtimeInputHash: computeRuntimeInputHash(root, inputFiles),
	}), false);

	appendFileSync(archivePath, "tampered");
	assert.equal(runtimeArchiveMatches({
		archivePath,
		digestPath,
		lockPath,
		manifestPath,
		packageSpecs: specs,
		runtimeInputHash,
	}), false);
	assert.equal(workspacePackagesMatch(nodeModules, ["@scope/runtime@9.9.9"]), false);
});

test("runtime archive integrity rejects a lock that differs from the committed graph", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-lock-integrity-"));
	const feynmanDir = join(root, ".feynman");
	const workspace = join(feynmanDir, "npm");
	const packageRoot = join(workspace, "node_modules", "runtime");
	const manifestPath = join(workspace, ".runtime-manifest.json");
	const lockPath = join(feynmanDir, "runtime-package-lock.json");
	const archivePath = join(feynmanDir, "runtime-workspace.tgz");
	const digestPath = join(feynmanDir, "runtime-workspace.sha256");
	const inputPath = join(root, "runtime-input.txt");
	const specs = ["runtime@1.0.0"];

	mkdirSync(packageRoot, { recursive: true });
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
	writeFileSync(join(workspace, "package-lock.json"), '{"lockfileVersion":3}\n');
	writeFileSync(lockPath, '{"lockfileVersion":3,"packages":{}}\n');
	writeFileSync(inputPath, "runtime input\n");
	const runtimeInputHash = computeRuntimeInputHash(root, ["runtime-input.txt"]);
	writeFileSync(manifestPath, JSON.stringify({
		packageSpecs: specs,
		runtimeInputHash,
		runtimeTreeHash: computeRuntimeTreeHash(workspace),
	}) + "\n");
	assert.equal(spawnSync("tar", ["-czf", archivePath, "-C", feynmanDir, "npm"], {
		env: { ...process.env, COPYFILE_DISABLE: "1" },
	}).status, 0);
	writeFileSha256(archivePath, digestPath);

	assert.equal(runtimeArchiveMatches({
		archivePath,
		digestPath,
		lockPath,
		manifestPath,
		packageSpecs: specs,
		runtimeInputHash,
	}), false);
});

test("runtime archive tree hashes normalize tar hardlinks to file contents", async () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-hardlink-integrity-"));
	const workspace = join(root, "npm");
	const original = join(workspace, "original.txt");
	const hardlink = join(workspace, "hardlink.txt");
	const archivePath = join(root, "runtime-workspace.tgz");

	mkdirSync(workspace, { recursive: true });
	writeFileSync(original, "shared bytes\n");
	linkSync(original, hardlink);
	await createDeterministicTarGz(workspace, archivePath);

	assert.equal(
		computeRuntimeArchiveTreeHash(archivePath),
		computeRuntimeTreeHash(workspace),
	);
});

test("runtime input hashes are independent of the checkout root", () => {
	const left = mkdtempSync(join(tmpdir(), "feynman-runtime-input-left-"));
	const right = mkdtempSync(join(tmpdir(), "feynman-runtime-input-right-"));
	const inputFiles = ["scripts/prepare-runtime-workspace.mjs", ".feynman/settings.json"];
	for (const root of [left, right]) {
		mkdirSync(join(root, "scripts"), { recursive: true });
		mkdirSync(join(root, ".feynman"), { recursive: true });
		writeFileSync(join(root, "scripts", "prepare-runtime-workspace.mjs"), "same source\n");
		writeFileSync(join(root, ".feynman", "settings.json"), '{"same":true}\n');
	}

	assert.equal(
		computeRuntimeInputHash(left, inputFiles),
		computeRuntimeInputHash(right, inputFiles),
	);
});

test("runtime input hashes use only files shipped in installed packages", () => {
	assert.equal(RUNTIME_INPUT_FILES.includes("package-lock.json"), false);
	assert.equal(RUNTIME_INPUT_FILES.includes(".feynman/runtime-package-lock.json"), true);
	assert.equal(RUNTIME_INPUT_FILES.includes("package.json"), true);
});
