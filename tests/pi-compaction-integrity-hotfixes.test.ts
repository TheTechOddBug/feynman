import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

import {
	assertPiCompactionToolsPatchedSource,
	PI_COMPACTION_TOOLS_PATCH_MARKERS,
	PI_COMPACTION_TOOLS_PATCH_TARGETS,
	PI_COMPACTION_TOOLS_REQUIRED_VERSION,
	patchPiCompactionToolsSource,
} from "../scripts/lib/pi-compaction-tools-patch.mjs";
import {
	assertPiCompactionToolsPackageTree,
	verifyPiCompactionToolsBehavior,
} from "../scripts/lib/pi-compaction-tools-verifier.mjs";

const appRoot = process.cwd();
const installedPackageRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
);

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assistantMessage(model: Record<string, unknown>, text: string, stopReason = "stop") {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 20,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

function summaryStream(model: Record<string, unknown>, summaries: string[]) {
	let index = 0;
	return async () => ({
		result: async () => assistantMessage(model, summaries[Math.min(index++, summaries.length - 1)] ?? ""),
	});
}

function compactionPreparation(options: {
	isSplitTurn?: boolean;
	file?: string;
	settings?: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
} = {}) {
	return {
		firstKeptEntryId: "kept-entry",
		messagesToSummarize: options.isSplitTurn
			? []
			: [{ role: "user" as const, content: "Preserve this research history.", timestamp: 1 }],
		turnPrefixMessages: options.isSplitTurn
			? [{ role: "user" as const, content: "Verify the BRCA1 evidence trail.", timestamp: 1 }]
			: [],
		isSplitTurn: options.isSplitTurn ?? false,
		tokensBefore: 7000,
		fileOps: {
			read: new Set(options.file ? [options.file] : []),
			written: new Set<string>(),
			edited: new Set<string>(),
		},
		settings: options.settings ?? { enabled: true, reserveTokens: 2048, keepRecentTokens: 4096 },
	};
}

const checkpointSummary = [
	"## Goal",
	"Verify the BRCA1 claim against the primary paper.",
	"",
	"## Progress",
	"- Located the cited experiment and recorded its DOI.",
	"",
	"## Next Steps",
	"1. Reproduce the reported confidence interval.",
].join("\n");

const turnPrefixSummary = [
	"## Original Request",
	"Verify the BRCA1 evidence trail.",
	"",
	"## Early Progress",
	"- Located the paper and extracted the reported cohort size.",
	"",
	"## Context for Suffix",
	"- The retained work still needs an independent confidence-interval check.",
].join("\n");

async function withPatchedFixture(
	run: (fixtureAppRoot: string, packageRoot: string) => Promise<void>,
): Promise<void> {
	const fixtureAppRoot = mkdtempSync(resolve(appRoot, ".pi-compaction-hotfix-"));
	const packageRoot = resolve(
		fixtureAppRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	try {
		cpSync(installedPackageRoot, packageRoot, { recursive: true });
		for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
			const target = resolve(packageRoot, ...relativePath.split("/"));
			const source = readFileSync(target, "utf8");
			writeFileSync(target, patchPiCompactionToolsSource(relativePath, source));
		}
		await run(fixtureAppRoot, packageRoot);
	} finally {
		rmSync(fixtureAppRoot, { recursive: true, force: true });
	}
}

test("Pi 0.84.2 compaction hotfix transforms are exact, idempotent, and fail closed", async () => {
	assert.equal(PI_COMPACTION_TOOLS_REQUIRED_VERSION, "0.84.2");
	const installedHashes = new Map<string, string>();
	for (const relativePath of PI_COMPACTION_TOOLS_PATCH_TARGETS) {
		const target = resolve(installedPackageRoot, ...relativePath.split("/"));
		installedHashes.set(relativePath, sha256(target));
		const source = readFileSync(target, "utf8");
		const patched = patchPiCompactionToolsSource(relativePath, source);
		assert.equal(patchPiCompactionToolsSource(relativePath, patched), patched, relativePath);
		assert.doesNotThrow(() => assertPiCompactionToolsPatchedSource(relativePath, patched));
	}

	const compactionPath = resolve(
		installedPackageRoot,
		"dist/core/compaction/compaction.js",
	);
	const unsupportedLayout = readFileSync(compactionPath, "utf8").replace(
		"return contextTokens > contextWindow - effectiveSettings.reserveTokens;",
		"return contextTokens >= contextWindow - effectiveSettings.reserveTokens;",
	);
	assert.throws(
		() => patchPiCompactionToolsSource("dist/core/compaction/compaction.js", unsupportedLayout),
		/effectiveSettings\.reserveTokens/,
	);

	const patchedCompaction = patchPiCompactionToolsSource(
		"dist/core/compaction/compaction.js",
		readFileSync(compactionPath, "utf8"),
	);
	assert.throws(
		() => assertPiCompactionToolsPatchedSource(
			"dist/core/compaction/compaction.js",
			patchedCompaction.replace(
				"const keepRecentCeiling = Math.max(1, windowTokens - 2 * reserveTokens);",
				"const keepRecentCeiling = Math.max(1, windowTokens - reserveTokens);",
			),
		),
		/keepRecentCeiling/,
	);
	assert.throws(
		() => assertPiCompactionToolsPatchedSource(
				"dist/core/compaction/compaction.js",
				patchedCompaction.replace(
					'const usabilityFailure = getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0));',
					"const usabilityFailure = undefined;",
				),
		),
		/getSummaryUsabilityFailure/,
	);
	assert.throws(
		() => assertPiCompactionToolsPatchedSource(
			"dist/core/compaction/compaction.js",
			patchedCompaction.replace(
				"return Math.min(512, Math.max(64, Math.floor(sourceCharacters / 200)));",
				"return 64;",
			),
		),
		/sourceCharacters \/ 200/,
	);

	await withPatchedFixture(async (fixtureAppRoot) => {
		assert.doesNotThrow(() => assertPiCompactionToolsPackageTree(
			fixtureAppRoot,
			(path) => readFileSync(path, "utf8"),
		));
		await verifyPiCompactionToolsBehavior(fixtureAppRoot);
		assert.throws(
			() => assertPiCompactionToolsPackageTree(
				fixtureAppRoot,
				(path) => path.endsWith("pi-coding-agent/package.json")
					? JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), version: "0.84.3" })
					: readFileSync(path, "utf8"),
			),
			/0\.84\.3.*0\.84\.2|0\.84\.2.*0\.84\.3/,
		);
	});

	for (const [relativePath, hash] of installedHashes) {
		assert.equal(
			sha256(resolve(installedPackageRoot, ...relativePath.split("/"))),
			hash,
			`installed runtime changed: ${relativePath}`,
		);
	}
});

test("model-bounded budgets preserve large-context behavior and make 8K compaction viable", async () => {
	await withPatchedFixture(async (_fixtureAppRoot, packageRoot) => {
		const compaction = await import(
			`${pathToFileURL(resolve(packageRoot, "dist/core/compaction/compaction.js")).href}?budget=${Date.now()}`
		);
		const defaults = compaction.DEFAULT_COMPACTION_SETTINGS;
		assert.deepEqual(
			compaction.getEffectiveCompactionSettings(defaults, 8192),
			{ enabled: true, reserveTokens: 2048, keepRecentTokens: 4096 },
		);
		assert.equal(compaction.shouldCompact(0, 8192, defaults), false);
		assert.equal(compaction.shouldCompact(6144, 8192, defaults), false);
		assert.equal(compaction.shouldCompact(6145, 8192, defaults), true);

		assert.strictEqual(
			compaction.getEffectiveCompactionSettings(defaults, 128000),
			defaults,
			"normal contexts must retain the exact existing settings object",
		);
		assert.equal(compaction.shouldCompact(111616, 128000, defaults), false);
		assert.equal(compaction.shouldCompact(111617, 128000, defaults), true);

		const pathEntries = [
			{
				type: "message",
				id: "entry-1",
				parentId: null,
				timestamp: new Date(1).toISOString(),
				message: { role: "user", content: "A".repeat(12000), timestamp: 1 },
			},
			{
				type: "message",
				id: "entry-2",
				parentId: "entry-1",
				timestamp: new Date(2).toISOString(),
				message: { role: "assistant", content: [{ type: "text", text: "B".repeat(8000) }], timestamp: 2 },
			},
			{
				type: "message",
				id: "entry-3",
				parentId: "entry-2",
				timestamp: new Date(3).toISOString(),
				message: { role: "user", content: "C".repeat(12000), timestamp: 3 },
			},
			{
				type: "message",
				id: "entry-4",
				parentId: "entry-3",
				timestamp: new Date(4).toISOString(),
				message: { role: "assistant", content: [{ type: "text", text: "D".repeat(8000) }], timestamp: 4 },
			},
		];
		const preparation = compaction.prepareCompaction(pathEntries, defaults, 8192);
		assert.ok(preparation, "expected a small-context compaction preparation");
		assert.deepEqual(preparation.settings, {
			enabled: true,
			reserveTokens: 2048,
			keepRecentTokens: 4096,
		});

		const agentSessionSource = readFileSync(resolve(packageRoot, "dist/core/agent-session.js"), "utf8");
		assert.equal(
			agentSessionSource.split(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers).length - 1,
			2,
			"manual and automatic compaction must both pass the active model context",
		);
	});
});

test("history, split-turn, and branch compaction reject unusable checkpoints", async () => {
	await withPatchedFixture(async (_fixtureAppRoot, packageRoot) => {
		const nonce = Date.now();
		const compaction = await import(
			`${pathToFileURL(resolve(packageRoot, "dist/core/compaction/compaction.js")).href}?integrity=${nonce}`
		);
		const branch = await import(
			`${pathToFileURL(resolve(packageRoot, "dist/core/compaction/branch-summarization.js")).href}?integrity=${nonce}`
		);
		const model = {
			id: "research-checkpoint-test",
			name: "Research Checkpoint Test",
			api: "openai-completions",
			provider: "test",
			baseUrl: "https://example.invalid/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192,
			maxTokens: 2048,
		};

		assert.match(
			compaction.getSummaryUsabilityFailure("", "Summarization") ?? "",
			/empty or file-list-only checkpoint/,
		);
		assert.match(
			compaction.getSummaryUsabilityFailure(
				"<read-files>\npapers/brca1.pdf\n</read-files>",
				"Summarization",
			) ?? "",
			/empty or file-list-only checkpoint/,
		);
		assert.match(
			compaction.getSummaryUsabilityFailure(
				"The paper was read and there may be more work to do.",
				"Summarization",
			) ?? "",
			/implausibly small checkpoint|structurally unusable checkpoint/,
		);
		assert.match(
			compaction.getSummaryUsabilityFailure(
				[
					"## Goal",
					"(none)",
					"## Progress",
					"### Done",
					"- [x] none",
					"## Next Steps",
					"1. none",
				].join("\n"),
				"Summarization",
			) ?? "",
			/implausibly small checkpoint|structurally unusable checkpoint/,
		);
		assert.equal(
			compaction.getSummaryUsabilityFailure(checkpointSummary, "Summarization"),
			undefined,
		);
		const tinyStructuredStub = [
			"## Goal",
			"Research",
			"## Progress",
			"Started",
			"## Next Steps",
			"Continue",
		].join("\n");
		assert.match(
			compaction.getSummaryUsabilityFailure(
				tinyStructuredStub,
				"Summarization",
				undefined,
				100_000,
			) ?? "",
			/implausibly small checkpoint/,
		);
		await assert.rejects(
			() => compaction.generateSummaryWithUsage(
				[{ role: "user", content: "A".repeat(100_000), timestamp: 1 }],
				model,
				2048,
				"test",
				undefined,
				undefined,
				undefined,
				undefined,
				"off",
				summaryStream(model, [tinyStructuredStub]),
			),
			/implausibly small checkpoint/,
		);
		await assert.rejects(
			() => compaction.generateSummaryWithUsage(
				[{ role: "user", content: "Record one new observation.", timestamp: 1 }],
				model,
				2048,
				"test",
				undefined,
				undefined,
				undefined,
				`## Goal\n${"A".repeat(100_000)}\n## Progress\nPrior work\n## Next Steps\nContinue`,
				"off",
				summaryStream(model, [checkpointSummary]),
			),
			/implausibly small checkpoint/,
		);

		await assert.rejects(
			() => compaction.compact(
				compactionPreparation({ file: "papers/brca1.pdf" }),
				model,
				"test",
				undefined,
				undefined,
				undefined,
				undefined,
				summaryStream(model, [""]),
			),
			/empty or file-list-only checkpoint/,
		);
		await assert.rejects(
			() => compaction.compact(
				compactionPreparation(),
				model,
				"test",
				undefined,
				undefined,
				undefined,
				undefined,
				summaryStream(model, ["The paper was read, but the checkpoint has no structure."]),
			),
			/implausibly small checkpoint|structurally unusable checkpoint/,
		);
		const historyResult = await compaction.compact(
			compactionPreparation({ file: "papers/brca1.pdf" }),
			model,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			summaryStream(model, [checkpointSummary]),
		);
		assert.match(historyResult.summary, /Verify the BRCA1 claim/);
		assert.match(historyResult.summary, /<read-files>\npapers\/brca1\.pdf\n<\/read-files>/);

		await assert.rejects(
			() => compaction.compact(
				compactionPreparation({ isSplitTurn: true }),
				model,
				"test",
				undefined,
				undefined,
				undefined,
				undefined,
				summaryStream(model, [""]),
			),
			/empty or file-list-only checkpoint/,
		);
		const splitResult = await compaction.compact(
			compactionPreparation({ isSplitTurn: true }),
			model,
			"test",
			undefined,
			undefined,
			undefined,
			undefined,
			summaryStream(model, [turnPrefixSummary]),
		);
		assert.match(splitResult.summary, /Turn Context \(split turn\)/);
		assert.match(splitResult.summary, /independent confidence-interval check/);

		const entries = [{
			type: "message",
			id: "branch-entry",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: { role: "user", content: "Investigate the alternate BRCA1 method.", timestamp: 1 },
		}];
		const unusableBranch = await branch.generateBranchSummary(entries, {
			model,
			apiKey: "test",
			streamFn: summaryStream(model, [""]),
		});
		assert.match(unusableBranch.error ?? "", /empty or file-list-only checkpoint/);
		const acceptedBranch = await branch.generateBranchSummary(entries, {
			model,
			apiKey: "test",
			streamFn: summaryStream(model, [checkpointSummary]),
		});
		assert.match(acceptedBranch.summary ?? "", /Summary of that exploration/);
		assert.match(acceptedBranch.summary ?? "", /Reproduce the reported confidence interval/);
		const customReplacementSummary =
			"The alternate branch established that the primary paper used a distinct BRCA1 cohort, recorded the exact DOI and sample size, and left an independent confidence-interval reproduction as the next research step.";
		const customBranch = await branch.generateBranchSummary(entries, {
			model,
			apiKey: "test",
			customInstructions: "Return one concise paragraph with the result and next research step.",
			replaceInstructions: true,
			streamFn: summaryStream(model, [customReplacementSummary]),
		});
		assert.equal(customBranch.error, undefined);
		assert.match(customBranch.summary ?? "", /alternate branch established/);
	});
});
