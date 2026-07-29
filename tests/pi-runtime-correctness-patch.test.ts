import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Type } from "typebox";

import {
	patchPiAgentSessionSource,
	patchPiSessionManagerSource,
	patchPiTransformMessagesSource,
} from "../scripts/lib/pi-runtime-correctness-patch.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
patchPiRuntimeNodeModules(appRoot);

const agentSessionPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"core",
	"agent-session.js",
);
const sessionManagerPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"core",
	"session-manager.js",
);
const transformMessagesPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"api",
	"transform-messages.js",
);
const nestedTransformMessagesPath = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
	"pi-ai",
	"dist",
	"api",
	"transform-messages.js",
);

function createResourceLoader(runtime: unknown) {
	return {
		getExtensions: () => ({
			extensions: [],
			errors: [],
			runtime,
		}),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

test("Pi 0.82.1 correctness patch is applied, idempotent, and documents its removal condition", () => {
	const agentSessionSource = readFileSync(agentSessionPath, "utf8");
	const sessionManagerSource = readFileSync(sessionManagerPath, "utf8");
	const transformMessagesSource = readFileSync(transformMessagesPath, "utf8");
	const nestedTransformMessagesSource = readFileSync(nestedTransformMessagesPath, "utf8");
	const patchSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-runtime-correctness-patch.mjs"),
		"utf8",
	);

	assert.match(agentSessionSource, /issues #7150 and #7053/);
	assert.match(agentSessionSource, /Cannot submit a prompt while compaction is in progress/);
	assert.match(agentSessionSource, /_feynmanEagerlyPersistedToolResults/);
	assert.match(sessionManagerSource, /restore eager tool results/);
	assert.match(sessionManagerSource, /restoreFeynmanToolResultsInSourceOrder/);
	assert.match(transformMessagesSource, /order eager tool results/);
	assert.match(transformMessagesSource, /flushFeynmanToolResults/);
	assert.match(nestedTransformMessagesSource, /order eager tool results/);
	assert.match(nestedTransformMessagesSource, /flushFeynmanToolResults/);
	assert.match(patchSource, /Removal condition: delete this patch once a supported released Pi version/);

	assert.equal(patchPiAgentSessionSource(agentSessionSource), agentSessionSource);
	assert.equal(patchPiSessionManagerSource(sessionManagerSource), sessionManagerSource);
	assert.equal(patchPiTransformMessagesSource(transformMessagesSource), transformMessagesSource);
	assert.equal(patchPiTransformMessagesSource(nestedTransformMessagesSource), nestedTransformMessagesSource);
	assert.throws(
		() => patchPiAgentSessionSource("export class AgentSession {}\n"),
		/Unsupported Pi 0\.82\.1 agent-session import layout/,
	);
});

test("manual compaction rejects a prompt before RPC preflight can ACK it", async () => {
	const { AgentSession } = await import("@earendil-works/pi-coding-agent");
	const session = Object.create(AgentSession.prototype) as {
		_compactionAbortController: AbortController;
		_isAgentRunActive: boolean;
		prompt: (
			text: string,
			options: { preflightResult: (success: boolean) => void },
		) => Promise<void>;
	};
	session._compactionAbortController = new AbortController();
	session._isAgentRunActive = false;
	const preflight: boolean[] = [];

	await assert.rejects(
		session.prompt("do not lose this", { preflightResult: (success) => preflight.push(success) }),
		/Cannot submit a prompt while compaction is in progress/,
	);
	assert.deepEqual(preflight, [false]);
});

test("completed parallel results persist before a slow sibling and restore in tool-call order", async (t) => {
	const [{ Agent }, codingAgent, piAi] = await Promise.all([
		import("@earendil-works/pi-agent-core"),
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-ai/compat"),
	]);
	const { AgentSession, SessionManager, SettingsManager, convertToLlm } = codingAgent;
	const { fauxAssistantMessage, fauxToolCall, registerFauxProvider, streamSimple } = piAi;
	const tempRoot = mkdtempSync(resolve(tmpdir(), "feynman-pi-7053-"));
	const faux = registerFauxProvider();
	let disposeSession: (() => void) | undefined;
	t.after(() => {
		disposeSession?.();
		faux.unregister();
		if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true });
	});
	let releaseSlow: (() => void) | undefined;
	const slowGate = new Promise<void>((resolveGate) => {
		releaseSlow = resolveGate;
	});
	const makeTool = (name: string, execute: () => Promise<string>) => ({
		name,
		label: name,
		description: `${name} regression tool`,
		parameters: Type.Object({}),
		execute: async () => ({
			content: [{ type: "text" as const, text: await execute() }],
			details: {},
		}),
	});
	const slowTool = makeTool("slow", async () => {
		await slowGate;
		return "slow result";
	});
	const fastTool = makeTool("fast", async () => "fast result");
	const model = faux.getModel();
	const sessionManager = SessionManager.create(tempRoot, tempRoot);
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
	const modelRuntime = {
		hasConfiguredAuth: () => true,
		checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
		getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
		isUsingOAuth: () => false,
	};
	const agent = new Agent({
		getApiKey: () => "faux-key",
		streamFn: streamSimple,
		initialState: {
			model,
			systemPrompt: "You are a test assistant.",
			tools: [],
		},
		convertToLlm,
	});
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: tempRoot,
		modelRuntime: modelRuntime as never,
		resourceLoader: createResourceLoader(codingAgent.createExtensionRuntime()) as never,
		baseToolsOverride: { slow: slowTool, fast: fastTool },
	});
	disposeSession = () => session.dispose();
	const publicMessageEndIds: string[] = [];
	let finishFast: (() => void) | undefined;
	const fastEnded = new Promise<void>((resolveFast) => {
		finishFast = resolveFast;
	});
	session.subscribe((event) => {
		if (event.type === "tool_execution_end" && event.toolCallId === "fast-call") {
			finishFast?.();
		}
		if (event.type === "message_end" && event.message.role === "toolResult") {
			publicMessageEndIds.push(event.message.toolCallId);
		}
	});
	faux.setResponses([
		fauxAssistantMessage(
			[
				fauxToolCall("slow", {}, { id: "slow-call" }),
				fauxToolCall("fast", {}, { id: "fast-call" }),
			],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage("done"),
	]);

	const prompt = session.prompt("run both tools");
	try {
		await fastEnded;
		const persistedWhileSlow = sessionManager
			.getBranch()
			.flatMap((entry) =>
				entry.type === "message" && entry.message.role === "toolResult"
					? [entry.message.toolCallId]
					: [],
			);
		assert.deepEqual(persistedWhileSlow, ["fast-call"]);
	}
	finally {
		releaseSlow?.();
		await prompt;
	}

	const persistedCompletionOrder = sessionManager
		.getBranch()
		.flatMap((entry) =>
			entry.type === "message" && entry.message.role === "toolResult"
				? [entry.message.toolCallId]
				: [],
		);
	assert.deepEqual(persistedCompletionOrder, ["fast-call", "slow-call"]);
	const restoredSourceOrder = sessionManager
		.buildSessionContext()
		.messages.filter((message) => message.role === "toolResult")
		.map((message) => (message.role === "toolResult" ? message.toolCallId : ""));
	assert.deepEqual(restoredSourceOrder, ["slow-call", "fast-call"]);
	assert.deepEqual(publicMessageEndIds, ["slow-call", "fast-call"]);
});

test("provider transformation orders eager results and synthesizes only unresolved calls", async () => {
	const moduleUrl = `${pathToFileURL(nestedTransformMessagesPath).href}?feynman-7053`;
	const { transformMessages } = (await import(moduleUrl)) as {
		transformMessages: (messages: unknown[], model: unknown) => Array<{
			role: string;
			toolCallId?: string;
			isError?: boolean;
		}>;
	};
	const timestamp = Date.now();
	const messages = [
		{ role: "user", content: "run tools", timestamp },
		{
			role: "assistant",
			content: [
				{ type: "toolCall", id: "slow-call", name: "slow", arguments: {} },
				{ type: "toolCall", id: "fast-call", name: "fast", arguments: {} },
			],
			api: "faux",
			provider: "faux",
			model: "faux",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp,
		},
		{
			role: "toolResult",
			toolCallId: "fast-call",
			toolName: "fast",
			content: [{ type: "text", text: "fast result" }],
			isError: false,
			timestamp,
		},
	];
	const transformed = transformMessages(messages, {
		id: "faux",
		name: "faux",
		api: "faux",
		provider: "faux",
		baseUrl: "http://localhost",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
	});
	const toolResults = transformed.filter((message) => message.role === "toolResult");
	assert.deepEqual(toolResults.map((message) => message.toolCallId), ["slow-call", "fast-call"]);
	assert.deepEqual(toolResults.map((message) => message.isError), [true, false]);
});
