import assert from "node:assert/strict";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function requireMarker(readSource, relativePath, marker, label) {
	if (!readSource(relativePath).includes(marker)) {
		throw new Error(`${label} ${relativePath} is missing ${marker}`);
	}
}

export function assertPiSubagentCorrectnessSources(readSource, label) {
	for (const marker of [
		"export function isContextOverflow(",
		"/context_length_exceeded/i",
		"if (TOOL_FAILURE_PREFIX.test(error.trim())) return false;",
	]) {
		requireMarker(readSource, "src/runs/shared/model-fallback.ts", marker, label);
	}
	for (const marker of [
		"if (isContextOverflow(result.error)) {",
		"result.contextOverflow = true;",
		"break modelAttemptsLoop;",
		"Some Pi event streams omit tool_execution_end.",
	]) {
		requireMarker(readSource, "src/runs/foreground/execution.ts", marker, label);
	}
	for (const marker of [
		"if (isContextOverflow(error)) {",
		"contextOverflow: contextOverflow || undefined,",
		".contextOverflow = singleResult.contextOverflow;",
		"contextOverflow: r.contextOverflow,",
	]) {
		requireMarker(readSource, "src/runs/background/subagent-runner.ts", marker, label);
	}
	requireMarker(readSource, "src/shared/types.ts", "contextOverflow?: boolean;", label);
	requireMarker(
		readSource,
		"src/runs/background/chain-root-attachment.ts",
		"child?.contextOverflow || step?.contextOverflow",
		label,
	);
	requireMarker(
		readSource,
		"src/runs/background/stale-run-reconciler.ts",
		"contextOverflow: child?.contextOverflow ?? step.contextOverflow",
		label,
	);
	requireMarker(
		readSource,
		"src/runs/background/async-status.ts",
		"...(step.contextOverflow ? { contextOverflow: true } : {}),",
		label,
	);
	for (const [relativePath, call] of [
		["src/extension/index.ts", "finalizeToolResult(await executeSubagentCollapsed("],
		["src/extension/fanout-child.ts", "finalizeToolResult(await executor.execute("],
		["src/runs/background/wait-tool.ts", "finalizeToolResult(await waitForSubagents("],
	]) {
		requireMarker(readSource, relativePath, "function finalizeToolResult<", label);
		requireMarker(readSource, relativePath, call, label);
	}
	requireMarker(
		readSource,
		"src/runs/foreground/subagent-executor.ts",
		"...(ok === 0 ? { isError: true } : {}),",
		label,
	);
}

export function assertPiSubagentPatchedSources(readSource, label = "pi-subagents") {
	assertPiSubagentAgentDiagnosticsSources(readSource, label);
	assertPiSubagentPromptMetadataSources(readSource, label);
	assertPiSubagentUsageLimitFallbackSource(readSource, label);
	assertPiSubagentCorrectnessSources(readSource, label);
}

function restoreEnv(name, value) {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

async function verifyContextOverflowBehavior(runtimeRoot, jiti) {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-overflow-"));
	const queue = join(root, "queue");
	const bin = join(root, "bin");
	mkdirSync(queue);
	mkdirSync(bin);
	const mockPath = join(root, "mock-pi.mjs");
	writeFileSync(
		mockPath,
		[
			'import fs from "node:fs";',
			'import path from "node:path";',
			"const queue = process.env.FEYNMAN_MOCK_PI_QUEUE;",
			'const file = fs.readdirSync(queue).filter((name) => name.startsWith("pending-")).sort()[0];',
			"if (!file) process.exit(2);",
			"const source = path.join(queue, file);",
			'const response = JSON.parse(fs.readFileSync(source, "utf8"));',
			'fs.renameSync(source, path.join(queue, file.replace("pending-", "used-")));',
			'fs.writeFileSync(path.join(queue, `call-${Date.now()}-${process.pid}`), JSON.stringify(process.argv.slice(2)));',
			'for (const entry of response.jsonl ?? []) process.stdout.write(`${JSON.stringify(entry)}\\n`);',
			"if (response.output) process.stdout.write(`${JSON.stringify({ type: \"message_end\", message: { role: \"assistant\", content: [{ type: \"text\", text: response.output }], model: \"mock/test\", stopReason: \"stop\", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } })}\\n`);",
			"if (response.stderr) process.stderr.write(response.stderr);",
			"process.exit(response.exitCode ?? 0);",
			"",
		].join("\n"),
	);
	const piPath = join(bin, "pi");
	writeFileSync(
		piPath,
		`#!/bin/sh\nexec "${process.execPath}" "${mockPath}" "$@"\n`,
	);
	chmodSync(piPath, 0o755);
	const error =
		"model error: context_length_exceeded: maximum context length is 8192 tokens";
	const errorMessage = {
		type: "message_end",
		message: {
			role: "assistant",
			content: [],
			model: "mock/test",
			stopReason: "error",
			errorMessage: error,
			usage: {
				input: 1,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0 },
			},
		},
	};
	writeFileSync(
		join(queue, "pending-000001.json"),
		JSON.stringify({ jsonl: [errorMessage], exitCode: 1 }),
	);
	writeFileSync(
		join(queue, "pending-000002.json"),
		JSON.stringify({ output: "MUST_NOT_RUN_FALLBACK" }),
	);
	const previousQueue = process.env.FEYNMAN_MOCK_PI_QUEUE;
	const previousBinary = process.env.PI_SUBAGENT_PI_BINARY;
	const previousCli = process.env.FEYNMAN_PI_CLI_PATH;
	process.env.FEYNMAN_MOCK_PI_QUEUE = queue;
	process.env.PI_SUBAGENT_PI_BINARY = piPath;
	delete process.env.FEYNMAN_PI_CLI_PATH;
	try {
		const execution = await jiti.import(
			resolve(
				runtimeRoot,
				"node_modules",
				"pi-subagents",
				"src",
				"runs",
				"foreground",
				"execution.ts",
			),
		);
		const result = await execution.runSync(
			root,
			[{
				name: "worker",
				description: "worker",
				systemPrompt: "",
				systemPromptMode: "replace",
				inheritProjectContext: false,
				inheritSkills: false,
				model: "openai/gpt-5-mini",
				fallbackModels: ["anthropic/claude-sonnet-4"],
			}],
			"worker",
			"Summarize a huge file",
			{ runId: "context-overflow-stops-fallback", acceptance: false },
		);
		assert.equal(result.exitCode, 1);
		assert.equal(result.contextOverflow, true);
		assert.deepEqual(result.attemptedModels, ["openai/gpt-5-mini"]);
		assert.equal(result.modelAttempts?.length, 1);
		assert.equal(
			readdirSync(queue).filter((entry) => entry.startsWith("call-")).length,
			1,
		);
		assert.notEqual(result.finalOutput, "MUST_NOT_RUN_FALLBACK");
		assert.match(result.error ?? "", /context/i);

		rmSync(join(queue, "pending-000002.json"));
		writeFileSync(
			join(queue, "pending-000003.json"),
			JSON.stringify({
				jsonl: [{
					...errorMessage,
					message: {
						...errorMessage.message,
						errorMessage:
							"429 rate limit exceeded: maximum 100000 tokens per minute",
					},
				}],
				exitCode: 1,
			}),
		);
		writeFileSync(
			join(queue, "pending-000004.json"),
			JSON.stringify({ output: "FALLBACK_RECOVERED" }),
		);
		const recovered = await execution.runSync(
			root,
			[{
				name: "worker",
				description: "worker",
				systemPrompt: "",
				systemPromptMode: "replace",
				inheritProjectContext: false,
				inheritSkills: false,
				model: "openai/gpt-5-mini",
				fallbackModels: ["anthropic/claude-sonnet-4"],
			}],
			"worker",
			"Retry a rate-limited request",
			{ runId: "token-rate-limit-still-falls-back", acceptance: false },
		);
		assert.equal(recovered.exitCode, 0);
		assert.equal(recovered.contextOverflow, undefined);
		assert.equal(recovered.finalOutput, "FALLBACK_RECOVERED");
		assert.deepEqual(recovered.attemptedModels, [
			"openai/gpt-5-mini",
			"anthropic/claude-sonnet-4",
		]);
		assert.equal(recovered.modelAttempts?.length, 2);
		assert.equal(
			readdirSync(queue).filter((entry) => entry.startsWith("call-")).length,
			3,
		);
	} finally {
		restoreEnv("FEYNMAN_MOCK_PI_QUEUE", previousQueue);
		restoreEnv("PI_SUBAGENT_PI_BINARY", previousBinary);
		restoreEnv("FEYNMAN_PI_CLI_PATH", previousCli);
		rmSync(root, { recursive: true, force: true });
	}
}

async function verifyBackfilledToolResultBehavior(runtimeRoot, jiti) {
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-tool-backfill-"));
	const bin = join(root, "bin");
	mkdirSync(bin);
	const mockPath = join(root, "mock-pi.mjs");
	writeFileSync(
		mockPath,
		[
			"const events = [",
			'\t{ type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash", args: { command: "echo PROBE_OK" } },',
			'\t{ type: "tool_result_end", message: { role: "toolResult", toolCallId: "bash-1", toolName: "bash", isError: false, content: [{ type: "text", text: "PROBE_OK" }] } },',
			'\t{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "PROBE_OK" }], model: "mock/test", stopReason: "stop", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } },',
			"];",
			'for (const event of events) process.stdout.write(`${JSON.stringify(event)}\\n`);',
			"",
		].join("\n"),
	);
	const piPath = join(bin, "pi");
	writeFileSync(
		piPath,
		`#!/bin/sh\nexec "${process.execPath}" "${mockPath}" "$@"\n`,
	);
	chmodSync(piPath, 0o755);
	const previousBinary = process.env.PI_SUBAGENT_PI_BINARY;
	const previousCli = process.env.FEYNMAN_PI_CLI_PATH;
	process.env.PI_SUBAGENT_PI_BINARY = piPath;
	delete process.env.FEYNMAN_PI_CLI_PATH;
	try {
		const execution = await jiti.import(
			resolve(
				runtimeRoot,
				"node_modules",
				"pi-subagents",
				"src",
				"runs",
				"foreground",
				"execution.ts",
			),
		);
		const result = await execution.runSync(
			root,
			[{
				name: "worker",
				description: "worker",
				systemPrompt: "",
				systemPromptMode: "replace",
				inheritProjectContext: false,
				inheritSkills: false,
				model: "openai/gpt-5-mini",
			}],
			"worker",
			"Run exactly one tool",
			{
				runId: "tool-result-backfill-clears-active-tool",
				acceptance: false,
				timeoutMs: 2_000,
			},
		);
		assert.equal(result.exitCode, 0);
		assert.equal(result.finalOutput, "PROBE_OK");
		assert.equal(result.progress?.currentTool, undefined);
		assert.equal(result.progress?.currentToolArgs, undefined);
		assert.equal(result.progress?.currentToolStartedAt, undefined);
		assert.equal(result.progress?.currentPath, undefined);
		assert.equal(result.progress?.recentTools?.length, 1);
		assert.equal(result.progress?.recentTools?.[0]?.tool, "bash");
		assert.equal(result.progress?.recentTools?.[0]?.args, "echo PROBE_OK");
	} finally {
		restoreEnv("PI_SUBAGENT_PI_BINARY", previousBinary);
		restoreEnv("FEYNMAN_PI_CLI_PATH", previousCli);
		rmSync(root, { recursive: true, force: true });
	}
}

async function verifyLogicalToolFailureBehavior(runtimeRoot, jiti) {
	let registeredTool;
	const events = { on: () => () => {}, emit: () => {} };
	const pi = new Proxy({
		events,
		registerTool(tool) {
			if (tool.name === "subagent") registeredTool = tool;
		},
		registerCommand() {},
		on: () => () => {},
	}, {
		get(target, property) {
			return property in target ? target[property] : () => undefined;
		},
	});
	const extension = await jiti.import(
		resolve(runtimeRoot, "node_modules", "pi-subagents", "src", "extension", "index.ts"),
	);
	extension.default(pi);
	assert.ok(registeredTool, "Installed pi-subagents did not register subagent");
	const sessionManager = new Proxy({
		getSessionFile: () => null,
		getSessionId: () => "feynman-logical-error",
		getEntries: () => [],
	}, {
		get(target, property) {
			return property in target ? target[property] : () => undefined;
		},
	});
	const toolContext = {
		cwd: process.cwd(),
		hasUI: false,
		sessionManager,
		modelRegistry: { getAvailable: () => [] },
	};
	await assert.rejects(
		registeredTool.execute(
			"logical-error",
			{ action: "not-a-real-action" },
			new AbortController().signal,
			undefined,
			toolContext,
		),
		/Unknown action: not-a-real-action/,
	);
	const success = await registeredTool.execute(
		"logical-success",
		{ action: "list" },
		new AbortController().signal,
		undefined,
		toolContext,
	);
	assert.notEqual(success.isError, true, "Successful subagent actions must still resolve");

	const parallelRoot = mkdtempSync(join(tmpdir(), "feynman-subagent-parallel-error-"));
	const parallelBin = join(parallelRoot, "pi");
	writeFileSync(
		parallelBin,
		`#!/bin/sh\nprintf '%s' 'provider error: forced child failure' >&2\nexit 1\n`,
	);
	chmodSync(parallelBin, 0o755);
	const previousParallelBinary = process.env.PI_SUBAGENT_PI_BINARY;
	const previousParallelCli = process.env.FEYNMAN_PI_CLI_PATH;
	process.env.PI_SUBAGENT_PI_BINARY = parallelBin;
	delete process.env.FEYNMAN_PI_CLI_PATH;
	try {
		const parallelToolContext = { ...toolContext, cwd: parallelRoot };
		await assert.rejects(
			registeredTool.execute(
				"logical-parallel-error",
				{
					tasks: [
						{ agent: "researcher", task: "fail one" },
						{ agent: "researcher", task: "fail two" },
					],
					concurrency: 1,
				},
				new AbortController().signal,
				undefined,
				parallelToolContext,
			),
			/0\/2 succeeded/,
		);
	} finally {
		restoreEnv("PI_SUBAGENT_PI_BINARY", previousParallelBinary);
		restoreEnv("FEYNMAN_PI_CLI_PATH", previousParallelCli);
		rmSync(parallelRoot, { recursive: true, force: true });
	}

	let registeredWaitTool;
	const waitPi = {
		events,
		registerTool(tool) {
			if (tool.name === "subagent_wait") registeredWaitTool = tool;
		},
	};
	const waitToolModule = await jiti.import(
		resolve(
			runtimeRoot,
			"node_modules",
			"pi-subagents",
			"src",
			"runs",
			"background",
			"wait-tool.ts",
		),
	);
	waitToolModule.registerWaitTool(
		waitPi,
		{ currentSessionId: null },
		true,
	);
	assert.ok(registeredWaitTool, "Installed pi-subagents did not register subagent_wait");
	await assert.rejects(
		registeredWaitTool.execute(
			"logical-wait-error",
			{},
			new AbortController().signal,
			undefined,
		),
		/requires an active session identity/,
	);

	const previousChild = process.env.PI_SUBAGENT_CHILD;
	const previousFanout = process.env.PI_SUBAGENT_FANOUT_CHILD;
	process.env.PI_SUBAGENT_CHILD = "1";
	process.env.PI_SUBAGENT_FANOUT_CHILD = "1";
	try {
		let registeredFanoutTool;
		const fanoutPi = {
			events,
			registerTool(tool) {
				if (tool.name === "subagent") registeredFanoutTool = tool;
			},
			getSessionName: () => undefined,
		};
		const fanoutModule = await jiti.import(
			resolve(
				runtimeRoot,
				"node_modules",
				"pi-subagents",
				"src",
				"extension",
				"fanout-child.ts",
			),
		);
		fanoutModule.default(fanoutPi);
		assert.ok(registeredFanoutTool, "Installed pi-subagents did not register the fanout-child subagent");
		const fanoutContext = {
			cwd: process.cwd(),
			hasUI: false,
			sessionManager: {
				getSessionId: () => "feynman-logical-fanout",
				getSessionFile: () => null,
			},
			modelRegistry: { getAvailable: () => [] },
		};
		const fanoutList = await registeredFanoutTool.execute(
			"logical-fanout-success",
			{ action: "list" },
			new AbortController().signal,
			undefined,
			fanoutContext,
		);
		assert.notEqual(fanoutList.isError, true, "Successful fanout-child actions must still resolve");
		await assert.rejects(
			registeredFanoutTool.execute(
				"logical-fanout-error",
				{ action: "create", config: { name: "blocked" } },
				new AbortController().signal,
				undefined,
				fanoutContext,
			),
			/not available from child-safe subagent fanout mode/,
		);
	} finally {
		restoreEnv("PI_SUBAGENT_CHILD", previousChild);
		restoreEnv("PI_SUBAGENT_FANOUT_CHILD", previousFanout);
	}

	const codingAgent = await import(
		pathToFileURL(
			resolve(
				runtimeRoot,
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
				"dist",
				"index.js",
			),
		).href
	);
	const piCompat = await import(
		pathToFileURL(
			resolve(
				runtimeRoot,
				"node_modules",
				"@earendil-works",
				"pi-ai",
				"dist",
				"compat.js",
			),
		).href
	);
	const root = mkdtempSync(join(tmpdir(), "feynman-subagent-tool-error-"));
	const faux = piCompat.registerFauxProvider();
	let session;
	try {
		const settingsManager = codingAgent.SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: false },
			packages: [],
		});
		const extensionPath = resolve(
			runtimeRoot,
			"node_modules",
			"pi-subagents",
			"src",
			"extension",
			"index.ts",
		);
		const loader = new codingAgent.DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			additionalExtensionPaths: [extensionPath],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await loader.reload();
		assert.deepEqual(
			loader.getExtensions().errors,
			[],
			"Installed pi-subagents failed to load for the logical-error probe",
		);
		const modelRuntime = {
			hasConfiguredAuth: () => true,
			checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			isUsingOAuth: () => false,
			streamSimple: piCompat.streamSimple,
		};
		faux.setResponses([
			piCompat.fauxAssistantMessage(
				piCompat.fauxToolCall(
					"subagent",
					{ action: "not-a-real-action" },
					{ id: "logical-subagent-error" },
				),
				{ stopReason: "toolUse" },
			),
			piCompat.fauxAssistantMessage("done"),
		]);
		const created = await codingAgent.createAgentSession({
			cwd: root,
			agentDir: root,
			modelRuntime,
			model: faux.getModel(),
			resourceLoader: loader,
			sessionManager: codingAgent.SessionManager.inMemory(root),
			settingsManager,
			noTools: "builtin",
		});
		session = created.session;
		await session.prompt("Exercise the installed subagent error boundary.", {
			expandPromptTemplates: false,
		});
		const toolResult = session.messages.find(
			(message) =>
				message.role === "toolResult" &&
				message.toolCallId === "logical-subagent-error",
		);
		assert.ok(toolResult, "Pi emitted no tool result for the logical subagent failure");
		assert.equal(
			toolResult.isError,
			true,
			"Pi presented a logical subagent failure as a successful tool result",
		);
		assert.match(
			toolResult.content
				.filter((item) => item.type === "text")
				.map((item) => item.text)
				.join("\n"),
			/Unknown action: not-a-real-action/,
		);
	} finally {
		session?.dispose();
		faux.unregister();
		rmSync(root, { recursive: true, force: true });
	}
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
	assert.equal(
		fallback.isContextOverflow(
			"model error: context_length_exceeded: maximum context length is 8192 tokens",
		),
		true,
	);
	assert.equal(
		fallback.isContextOverflow(
			"research-tools failed with exit code 1 maximum context length",
		),
		false,
	);
	for (const message of [
		"429 rate limit exceeded: maximum 100000 tokens per minute",
		"output max_tokens must be less than or equal to 8192",
		"HTTP 411 length_required",
	]) {
		assert.equal(
			fallback.isContextOverflow(message),
			false,
			`Misclassified non-context failure: ${message}`,
		);
	}
	await verifyContextOverflowBehavior(runtimeRoot, jiti);
	await verifyBackfilledToolResultBehavior(runtimeRoot, jiti);
	await verifyLogicalToolFailureBehavior(runtimeRoot, jiti);
}
