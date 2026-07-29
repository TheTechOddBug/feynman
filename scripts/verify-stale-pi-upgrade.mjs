import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { runWithTemporaryTreeCleanup } from "./lib/temporary-tree-cleanup.mjs";

const binaryArgument = process.argv[2];
if (!binaryArgument) {
	console.error("Usage: node scripts/verify-stale-pi-upgrade.mjs <feynman-binary>");
	process.exit(1);
}
const binaryPath = resolve(binaryArgument);

const root = mkdtempSync(resolve(tmpdir(), "feynman-stale-pi-upgrade-"));
const feynmanHome = resolve(root, ".feynman");
const agentDir = resolve(feynmanHome, "agent");
const managedNodeModulesPath = resolve(agentDir, "npm", "node_modules");
const persistentNodeModulesPath = resolve(feynmanHome, "npm-global", "lib", "node_modules");
const otelConfigPath = resolve(persistentNodeModulesPath, "pi-otel", "dist", "config.js");

const staleEditorSource = `\
import { cjkBreakRegex, getGraphemeSegmenter, getWordSegmenter, isWhitespaceChar, truncateToWidth, visibleWidth, } from "../utils.js";

export class Editor {
    render(width) {
        const layoutLines = this.layoutText(width);
        return layoutLines.map((line) => line.text);
    }
    handleInput(data) {
        return data;
    }
}
`;

const staleModelRegistrySource = `\
export class ModelRegistry {
    getModel(provider, modelId) {
        return this.models.find((model) => model.provider === provider && model.id === modelId);
    }
}
`;

const staleTuiManifest = `${JSON.stringify({
	name: "@earendil-works/pi-tui",
	version: "0.80.6",
}, null, 2)}\n`;

const staleCodingAgentManifest = `${JSON.stringify({
	name: "@earendil-works/pi-coding-agent",
	version: "0.80.6",
	piConfig: { name: "pi", configDir: ".pi" },
}, null, 2)}\n`;

const otelConfigSource = `\
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        merged?.endpoint ??
        "http://127.0.0.1:4317";
    const protocol = normalizeProtocol(process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? merged?.protocol);
    const headers = {
        ...(merged?.headers ?? {}),
        ...parseKvList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
    };
`;

function getStaleFiles(nodeModulesPath) {
	const staleTuiRoot = resolve(nodeModulesPath, "@earendil-works", "pi-tui");
	const staleCodingAgentRoot = resolve(nodeModulesPath, "@earendil-works", "pi-coding-agent");
	return new Map([
		[resolve(staleTuiRoot, "package.json"), staleTuiManifest],
		[resolve(staleTuiRoot, "dist", "components", "editor.js"), staleEditorSource],
		[resolve(staleCodingAgentRoot, "package.json"), staleCodingAgentManifest],
		[resolve(staleCodingAgentRoot, "dist", "core", "model-registry.js"), staleModelRegistrySource],
	]);
}

const managedStaleFiles = getStaleFiles(managedNodeModulesPath);
const persistentStaleFiles = getStaleFiles(persistentNodeModulesPath);

function writeFiles(files) {
	for (const [path, source] of files) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, source, "utf8");
	}
}

function runFeynman(pass) {
	const result = spawnSync(binaryPath, ["--mode", "rpc"], {
		cwd: root,
		env: {
			...process.env,
			DO_NOT_TRACK: "1",
			FEYNMAN_HOME: root,
			HOME: root,
		},
		input: "",
		encoding: "utf8",
		shell: process.platform === "win32",
		timeout: process.platform === "win32" ? 300_000 : 120_000,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.signal) {
		throw new Error(`Feynman stale-Pi upgrade smoke pass ${pass} exited with ${result.signal}`);
	}
	if (result.status !== 0) {
		throw new Error(
			[
				`Feynman stale-Pi upgrade smoke pass ${pass} failed with code ${result.status ?? 1}`,
				result.stdout?.trim(),
				result.stderr?.trim(),
			].filter(Boolean).join("\n"),
		);
	}
}

runWithTemporaryTreeCleanup(root, () => {
	writeFiles(managedStaleFiles);
	writeFiles(persistentStaleFiles);
	mkdirSync(dirname(otelConfigPath), { recursive: true });
	writeFileSync(otelConfigPath, otelConfigSource, "utf8");
	writeFileSync(
		resolve(agentDir, "settings.json"),
		JSON.stringify({ packages: [], quietStartup: true }, null, 2) + "\n",
		"utf8",
	);

	runFeynman(1);

	for (const [path, source] of persistentStaleFiles) {
		if (readFileSync(path, "utf8") !== source) {
			throw new Error(`Feynman modified stale Pi 0.80.6 core package file: ${path}`);
		}
	}
	const patchedOtelConfig = readFileSync(otelConfigPath, "utf8");
	for (const marker of ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_HEADERS"]) {
		if (!patchedOtelConfig.includes(marker)) {
			throw new Error(`Feynman stale-Pi upgrade smoke did not patch the extension marker: ${marker}`);
		}
	}

	// Pi may reconcile its managed npm directory after startup. Restore the
	// stale shape so the second launch exercises the same upgrade boundary.
	writeFiles(managedStaleFiles);
	runFeynman(2);
	for (const [path, source] of persistentStaleFiles) {
		if (readFileSync(path, "utf8") !== source) {
			throw new Error(`Feynman modified stale Pi 0.80.6 core package file on pass 2: ${path}`);
		}
	}
	if (readFileSync(otelConfigPath, "utf8") !== patchedOtelConfig) {
		throw new Error("Feynman stale-Pi upgrade extension patch was not idempotent");
	}
	console.log("Feynman stale Pi 0.80.6 user-package isolation smoke passed twice.");
});
