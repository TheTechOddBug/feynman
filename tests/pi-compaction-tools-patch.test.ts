import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
	assertPiCompactionToolsPatchedSource,
	PI_COMPACTION_TOOLS_PATCH_MARKERS,
	PI_COMPACTION_TOOLS_PATCH_TARGETS,
	patchPiCompactionToolsSource,
} from "../scripts/lib/pi-compaction-tools-patch.mjs";
import { verifyPiCompactionToolsBehavior } from "../scripts/lib/pi-compaction-tools-verifier.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
patchPiRuntimeNodeModules(appRoot);

test("Pi compaction patch covers every bundled 0.84.2 summary path", () => {
	const patchSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-compaction-tools-patch.mjs"),
		"utf8",
	);
	assert.match(patchSource, /90305d90a049d3f7784f15821d117fc6932248e7/);
	assert.match(
		patchSource,
		/Removal condition: delete this patch after Feynman adopts a released Pi/,
	);

	const codingAgentRoot = resolve(
		appRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
		const source = readFileSync(
			resolve(codingAgentRoot, ...relativePath.split("/")),
			"utf8",
		);
		assert.doesNotThrow(() => assertPiCompactionToolsPatchedSource(relativePath, source));
		assert.equal(patchPiCompactionToolsSource(relativePath, source), source);
	}
});

test("Pi compaction patch applies exact request and response guards", () => {
	const compaction = patchPiCompactionToolsSource(
		"dist/core/compaction/compaction.js",
		[
			"        cacheRetention: \"none\",",
			"        sessionId: uuidv7(),",
			'        throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);',
			"    }",
			"    const textContent = contentText(response.content);",
			'        throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);',
			"    }",
			"    return {",
		].join("\n"),
	);
	for (const marker of [
		PI_COMPACTION_TOOLS_PATCH_MARKERS.request,
		PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse,
		PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse,
	]) {
		assert.match(compaction, new RegExp(marker));
	}
	assert.match(compaction, /toolChoice: "none"/);
	assert.match(compaction, /Summarization attempted to call a tool/);
	assert.match(compaction, /Turn prefix summarization attempted to call a tool/);

	const branch = patchPiCompactionToolsSource(
		"dist/core/compaction/branch-summarization.js",
		[
			'        return { error: response.errorMessage || "Summarization failed" };',
			"    }",
			"    let summary = contentText(response.content);",
		].join("\n"),
	);
	assert.match(branch, new RegExp(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse));
	assert.match(branch, /Branch summarization attempted to call a tool/);
});

test("Pi summary calls disable tools and reject tool-call responses", async () => {
	await verifyPiCompactionToolsBehavior(appRoot);
});
