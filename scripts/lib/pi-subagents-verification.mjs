import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertPiSubagentAgentDiagnosticsSources } from "./pi-subagents-agent-diagnostics-patch.mjs";
import { assertPiSubagentPromptMetadataSources } from "./pi-subagents-prompt-metadata-patch.mjs";

const USAGE_LIMIT_FALLBACK_BLOCK = [
	"const RETRYABLE_MODEL_FAILURE_PATTERNS = [",
	"\t/rate\\s*limit/i,",
	"\t/usage\\s*limit/i,",
	"\t/too many requests/i,",
].join("\n");

export function assertPiSubagentUsageLimitFallbackSource(readSource, label) {
	const source = readSource("src/runs/shared/model-fallback.ts");
	if (!source.includes(USAGE_LIMIT_FALLBACK_BLOCK)) {
		throw new Error(`${label} model fallback does not retry provider usage-limit errors`);
	}
}

export function assertPiSubagentPatchedSources(readSource, label = "pi-subagents") {
	assertPiSubagentAgentDiagnosticsSources(readSource, label);
	assertPiSubagentPromptMetadataSources(readSource, label);
	assertPiSubagentUsageLimitFallbackSource(readSource, label);
}

export async function verifyPiSubagentUsageLimitFallbackBehavior(packageRoot) {
	const runtimeRoot = resolve(packageRoot, ".feynman", "npm");
	const runtimeRequire = createRequire(resolve(runtimeRoot, "package.json"));
	const jitiEntryPath = runtimeRequire.resolve("jiti");
	const jitiModule = await import(pathToFileURL(jitiEntryPath).href);
	assert.equal(typeof jitiModule.createJiti, "function", "Installed Pi Jiti has no createJiti");
	const jiti = jitiModule.createJiti(import.meta.url, { moduleCache: false });
	const fallback = await jiti.import(
		resolve(runtimeRoot, "node_modules", "pi-subagents", "src", "runs", "shared", "model-fallback.ts"),
	);
	assert.equal(typeof fallback.isRetryableModelFailure, "function");
	assert.equal(fallback.isRetryableModelFailure("The usage limit has been reached"), true);
	assert.equal(fallback.isRetryableModelFailure("research-tools failed with exit code 1"), false);
}
