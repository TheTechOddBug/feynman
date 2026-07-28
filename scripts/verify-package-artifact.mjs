import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	computeFileSha256,
	computeRuntimeArchiveTreeHash,
	computeRuntimeInputHash,
	parseExactRuntimePackageSpec,
	readArchiveEntry,
	verifyFileSha256,
} from "./lib/runtime-workspace-integrity.mjs";

const packageRoot = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));

function fail(message) {
	throw new Error(`[feynman artifact] ${message}`);
}

function readJson(path, label) {
	if (!existsSync(path)) fail(`${label} is missing`);
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		fail(`${label} is not valid JSON`);
	}
}

function readText(path, label) {
	if (!existsSync(path)) fail(`${label} is missing`);
	return readFileSync(path, "utf8");
}

function requireMarkers(source, label, markers) {
	for (const marker of markers) {
		if (!source.includes(marker)) {
			fail(`${label} is missing required marker: ${marker}`);
		}
	}
}

function readArchivedJson(archivePath, entryPath) {
	const source = readArchiveEntry(archivePath, entryPath);
	if (!source) fail(`runtime archive entry is missing: ${entryPath}`);
	try {
		return JSON.parse(source);
	} catch {
		fail(`runtime archive entry is not valid JSON: ${entryPath}`);
	}
}

function readArchivedText(archivePath, entryPath) {
	const source = readArchiveEntry(archivePath, entryPath);
	if (source === undefined) fail(`runtime archive entry is missing: ${entryPath}`);
	return source;
}

const manifest = readJson(resolve(packageRoot, "package.json"), "package.json");
const expectedPiVersion = manifest.dependencies?.["@earendil-works/pi-coding-agent"];
if (typeof expectedPiVersion !== "string") fail("package.json has no exact Pi runtime version");

for (const name of [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
]) {
	const expected = manifest.dependencies?.[name];
	const installed = readJson(
		resolve(packageRoot, "node_modules", ...name.split("/"), "package.json"),
		`${name} package manifest`,
	).version;
	if (installed !== expected) {
		fail(`${name} version mismatch: expected ${expected}, found ${installed}`);
	}
}

requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-runtime.js"),
		"bundled Pi ModelRuntime",
	),
	"bundled Pi ModelRuntime",
	["function assertHeaderSafeRequestConfig(", "providerOptions.apiKey ?? resolution.auth.apiKey"],
);
requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "core", "model-registry.js"),
		"bundled Pi ModelRegistry",
	),
	"bundled Pi ModelRegistry",
	[
		"function assertHeaderSafeRequestConfig(",
		"assertHeaderSafeRequestConfig(model.provider, undefined, headers);",
		"assertHeaderSafeRequestConfig(model.provider, resolution.auth.apiKey, headers);",
	],
);
requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "tui.js"),
		"bundled Pi TUI",
	),
	"bundled Pi TUI",
	["line = sliceByColumn(line, 0, width, true);"],
);
requireMarkers(
	readText(
		resolve(packageRoot, "node_modules", "@earendil-works", "pi-tui", "dist", "components", "editor.js"),
		"bundled Pi editor",
	),
	"bundled Pi editor",
	[
		"applyBackgroundToLine",
		"const styleInput = typeof this.theme.input",
		'const cursor = `\\x1b[7m${firstGrapheme}\\x1b[27m`',
		'const cursor = "\\x1b[7m \\x1b[27m"',
	],
);

const alphaLib = resolve(packageRoot, "node_modules", "@companion-ai", "alpha-hub", "src", "lib");
requireMarkers(
	readText(resolve(alphaLib, "auth.js"), "bundled alpha-hub auth"),
	"bundled alpha-hub auth",
	[
		"https://api.alphaxiv.org/auth",
		"/oauth2/authorize",
		"waitForCallback(server, state)",
		"OAuth state mismatch",
	],
);
requireMarkers(
	readText(resolve(alphaLib, "alphaxiv.js"), "bundled alpha-hub search"),
	"bundled alpha-hub search",
	["async function searchRestFast(", "return await fallbackSearch("],
);
requireMarkers(
	readText(resolve(alphaLib, "index.js"), "bundled alpha-hub parser"),
	"bundled alpha-hub parser",
	["function parseStructuredSearchResults("],
);

const mcpManifest = readJson(
	resolve(packageRoot, "node_modules", "@modelcontextprotocol", "sdk", "package.json"),
	"bundled MCP SDK manifest",
);
if (mcpManifest.dependencies?.["@hono/node-server"] !== "2.0.12") {
	fail("bundled MCP SDK does not pin @hono/node-server 2.0.12");
}
if (
	readJson(
		resolve(packageRoot, "node_modules", "@hono", "node-server", "package.json"),
		"bundled Hono node server manifest",
	).version !== "2.0.12"
) {
	fail("bundled Hono node server is not 2.0.12");
}
if (
	readJson(
		resolve(
			packageRoot,
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"node_modules",
			"brace-expansion",
			"package.json",
		),
		"bundled Pi brace-expansion manifest",
	).version !== "5.0.8"
) {
	fail("bundled Pi brace-expansion is not 5.0.8");
}

const archivePath = resolve(packageRoot, ".feynman", "runtime-workspace.tgz");
const digestPath = resolve(packageRoot, ".feynman", "runtime-workspace.sha256");
const runtimeLockPath = resolve(packageRoot, ".feynman", "runtime-package-lock.json");
if (!verifyFileSha256(archivePath, digestPath)) {
	fail("runtime workspace archive SHA-256 does not match its sidecar");
}
const runtimeLockSource = readText(runtimeLockPath, "committed runtime package lock");
const runtimeLock = JSON.parse(runtimeLockSource);
const expectedPiWebAccessVersion = runtimeLock.packages?.[""]?.dependencies?.["pi-web-access"];
if (typeof expectedPiWebAccessVersion !== "string") {
	fail("committed runtime lock does not pin pi-web-access");
}
if (
	runtimeLock.packages?.["node_modules/@hono/node-server"]?.version !== "2.0.12"
) {
	fail("committed runtime lock does not pin @hono/node-server 2.0.12");
}
for (const [packagePath, entry] of Object.entries(runtimeLock.packages ?? {})) {
	if (
		packagePath.endsWith("/pi-coding-agent/node_modules/brace-expansion") &&
		entry?.version !== "5.0.8"
	) {
		fail("committed runtime lock does not pin Pi brace-expansion 5.0.8");
	}
}
if (readArchivedText(archivePath, "npm/package-lock.json") !== runtimeLockSource) {
	fail("runtime archive package lock differs from the committed runtime lock");
}
const runtimeManifest = readArchivedJson(archivePath, "npm/.runtime-manifest.json");
if (!Array.isArray(runtimeManifest.packageSpecs)) {
	fail("runtime archive manifest has no packageSpecs");
}
const currentRuntimeInputHash = computeRuntimeInputHash(packageRoot);
if (runtimeManifest.runtimeInputHash !== currentRuntimeInputHash) {
	fail(
		`runtime archive inputs are stale: expected ${currentRuntimeInputHash}, found ${runtimeManifest.runtimeInputHash ?? "missing"}`,
	);
}
if (
	typeof runtimeManifest.runtimeTreeHash !== "string" ||
	!/^[a-f0-9]{64}$/.test(runtimeManifest.runtimeTreeHash)
) {
	fail("runtime archive manifest has no valid runtimeTreeHash");
}
const archivedRuntimeTreeHash = computeRuntimeArchiveTreeHash(archivePath);
if (archivedRuntimeTreeHash !== runtimeManifest.runtimeTreeHash) {
	fail(
		`runtime archive tree mismatch: expected ${runtimeManifest.runtimeTreeHash}, found ${archivedRuntimeTreeHash}`,
	);
}
for (const spec of runtimeManifest.packageSpecs) {
	const { name, version } = parseExactRuntimePackageSpec(spec);
	const archived = readArchivedJson(
		archivePath,
		`npm/node_modules/${name}/package.json`,
	);
	if (archived.version !== version) {
		fail(`runtime archive ${name} version mismatch: expected ${version}, found ${archived.version}`);
	}
}

requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js",
	),
	"runtime Pi ModelRuntime",
	["function assertHeaderSafeRequestConfig(", "providerOptions.apiKey ?? resolution.auth.apiKey"],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js",
	),
	"runtime Pi ModelRegistry",
	[
		"function assertHeaderSafeRequestConfig(",
		"assertHeaderSafeRequestConfig(model.provider, undefined, headers);",
		"assertHeaderSafeRequestConfig(model.provider, resolution.auth.apiKey, headers);",
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@earendil-works/pi-tui/dist/components/editor.js",
	),
	"runtime Pi editor",
	[
		"applyBackgroundToLine",
		"const styleInput = typeof this.theme.input",
		'const cursor = `\\x1b[7m${firstGrapheme}\\x1b[27m`',
		'const cursor = "\\x1b[7m \\x1b[27m"',
	],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/@companion-ai/alpha-hub/src/lib/auth.js",
	),
	"runtime alpha-hub auth",
	["https://api.alphaxiv.org/auth", "waitForCallback(server, state)", "OAuth state mismatch"],
);
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-otel/dist/otel/sdk.js",
	),
	"runtime pi-otel SDK",
	["createFeynmanResource", "resourceFromAttributes"],
);
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/pi-web-access/package.json",
	).version !== expectedPiWebAccessVersion
) {
	fail(`runtime pi-web-access is not ${expectedPiWebAccessVersion}`);
}
requireMarkers(
	readArchivedText(
		archivePath,
		"npm/node_modules/pi-web-access/utils.ts",
	),
	"runtime pi-web-access config helper",
	["FEYNMAN_WEB_SEARCH_CONFIG", "PI_WEB_SEARCH_CONFIG", "configuredPath || join(getWebSearchConfigDir()"],
);
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/@modelcontextprotocol/sdk/package.json",
	).dependencies?.["@hono/node-server"] !== "2.0.12"
) {
	fail("runtime MCP SDK does not pin @hono/node-server 2.0.12");
}
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/@hono/node-server/package.json",
	).version !== "2.0.12"
) {
	fail("runtime Hono node server is not 2.0.12");
}
if (
	readArchivedJson(
		archivePath,
		"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion/package.json",
	).version !== "5.0.8"
) {
	fail("runtime Pi brace-expansion is not 5.0.8");
}

console.log(JSON.stringify({
	ok: true,
	package: `${manifest.name}@${manifest.version}`,
	piVersion: expectedPiVersion,
	piWebAccessVersion: expectedPiWebAccessVersion,
	runtimePackages: runtimeManifest.packageSpecs.length,
	runtimeArchiveSha256: computeFileSha256(archivePath),
}));
