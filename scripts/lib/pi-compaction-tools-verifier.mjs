import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiCompactionToolsPatchedSource,
	PI_COMPACTION_TOOLS_PATCH_TARGETS,
	PI_COMPACTION_TOOLS_REQUIRED_VERSION,
} from "./pi-compaction-tools-patch.mjs";

export function assertPiCompactionToolsPackageTree(packageRoot, readText) {
	const codingAgentRoot = resolve(
		packageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const manifest = JSON.parse(
		readText(resolve(codingAgentRoot, "package.json"), "bundled Pi coding-agent manifest"),
	);
	assert.equal(manifest.version, PI_COMPACTION_TOOLS_REQUIRED_VERSION);
	for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
		assertPiCompactionToolsPatchedSource(
			relativePath,
			readText(
				resolve(codingAgentRoot, ...relativePath.split("/")),
				`bundled Pi coding-agent ${relativePath}`,
			),
		);
	}
}

export function assertPiCompactionToolsArchive(readEntry) {
	for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
		assertPiCompactionToolsPatchedSource(
			relativePath,
			readEntry(`npm/node_modules/@earendil-works/pi-coding-agent/${relativePath}`),
		);
	}
}

function assistantMessage(model, content, stopReason = "stop") {
	return {
		role: "assistant",
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

export async function verifyPiCompactionToolsBehavior(packageRoot) {
	const codingAgentRoot = resolve(
		packageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
		assertPiCompactionToolsPatchedSource(
			relativePath,
			readFileSync(resolve(codingAgentRoot, ...relativePath.split("/")), "utf8"),
		);
	}

	const compaction = await import(
		`${pathToFileURL(resolve(codingAgentRoot, "dist", "core", "compaction", "compaction.js")).href}?feynman-tools=${Date.now()}`
	);
	const branch = await import(
		`${pathToFileURL(resolve(codingAgentRoot, "dist", "core", "compaction", "branch-summarization.js")).href}?feynman-tools=${Date.now()}`
	);
	const model = {
		id: "summary-test",
		name: "Summary Test",
		api: "openai-completions",
		provider: "test",
		baseUrl: "https://example.invalid/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
	let observedOptions;
	const textStream = async (_model, _context, options) => {
		observedOptions = options;
		return {
			result: async () => assistantMessage(model, [{ type: "text", text: "summary" }]),
		};
	};
	await compaction.completeSummarization(
		model,
		{ messages: [{ role: "user", content: "summarize", timestamp: 1 }] },
		{ apiKey: "test" },
		textStream,
	);
	assert.equal(observedOptions?.toolChoice, "none");

	const toolStream = async () => ({
		result: async () => assistantMessage(
			model,
			[{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } }],
			"toolUse",
		),
	});
	await assert.rejects(
		() => compaction.generateSummaryWithUsage(
			[{ role: "user", content: "summarize", timestamp: 1 }],
			model,
			2048,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			"off",
			toolStream,
		),
		/Summarization attempted to call a tool/,
	);
	await assert.rejects(
		() => compaction.compact(
			{
				firstKeptEntryId: "entry-keep",
				messagesToSummarize: [],
				turnPrefixMessages: [{ role: "user", content: "split turn", timestamp: 1 }],
				isSplitTurn: true,
				tokensBefore: 100,
				fileOps: { read: new Set(), written: new Set(), edited: new Set() },
				settings: { enabled: true, reserveTokens: 2048, keepRecentTokens: 20 },
			},
			model,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			toolStream,
		),
		/Turn prefix summarization attempted to call a tool/,
	);
	const branchResult = await branch.generateBranchSummary(
		[{
			type: "message",
			id: "entry-1",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: { role: "user", content: "abandoned work", timestamp: 1 },
		}],
		{ model, apiKey: "test", streamFn: toolStream },
	);
	assert.equal(branchResult.error, "Branch summarization attempted to call a tool");
}
