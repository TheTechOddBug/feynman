import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiAiForwardFixSource,
	PI_AI_FORWARD_FIX_MARKERS,
	PI_AI_FORWARD_FIX_TARGETS,
	patchPiAiForwardFixSource,
} from "../scripts/lib/pi-ai-forward-fixes-patch.mjs";
import { assertPiAiForwardFixPackageTree } from "../scripts/lib/pi-ai-forward-fixes-verifier.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
patchPiRuntimeNodeModules(appRoot);

const piAiRoot = resolve(appRoot, "node_modules", "@earendil-works", "pi-ai");
const nestedPiAiRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"node_modules",
	"@earendil-works",
	"pi-ai",
);

function readPiAiSource(root: string, relativePath: string): string {
	return readFileSync(resolve(root, ...relativePath.split("/")), "utf8");
}

function googleModel(
	api: "google-generative-ai" | "google-vertex",
	id: string,
	thinkingLevelMap: Record<string, string>,
) {
	return {
		id,
		name: id,
		api,
		provider: `test-${api}`,
		baseUrl: "https://example.invalid/v1",
		reasoning: true,
		thinkingLevelMap,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

async function captureGooglePayload(
	modulePath: string,
	model: ReturnType<typeof googleModel>,
	reasoning: string,
	thinkingBudgets?: Record<string, number>,
) {
	const provider = await import(`${pathToFileURL(modulePath).href}?forward-fix=${Date.now()}`);
	let payload: unknown;
	const result = await provider.streamSimple(
		model,
		{
			messages: [{ role: "user", content: "Hello", timestamp: 0 }],
			tools: [{
				name: "read",
				description: "Read a file",
				parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
			}],
		},
		{
			apiKey: "test",
			reasoning,
			thinkingBudgets,
			toolChoice: "none",
			onPayload: (request: unknown) => {
				payload = request;
				throw new Error("payload captured");
			},
		},
	).result();
	assert.match(result.errorMessage ?? "", /payload captured/);
	assert.ok(payload, "Google payload was not captured");
	return payload as {
		config?: {
			thinkingConfig?: {
				thinkingLevel?: string;
				thinkingBudget?: number;
			};
			toolConfig?: {
				functionCallingConfig?: { mode?: string };
			};
		};
	};
}

test("Pi AI forward patch covers root and nested 0.84.2 runtime copies", () => {
	const patchSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-ai-forward-fixes-patch.mjs"),
		"utf8",
	);
	for (const commit of ["af2c352", "10acee6", "0e4d495", "8720548", "ad58801", "e5dde9a"]) {
		assert.match(patchSource, new RegExp(commit));
	}
	assert.match(
		patchSource,
		/Removal condition: delete this patch after Feynman adopts a released Pi/,
	);

	for (const relativePath of PI_AI_FORWARD_FIX_TARGETS) {
		for (const root of [piAiRoot, nestedPiAiRoot]) {
			const source = readPiAiSource(root, relativePath);
			assert.doesNotThrow(() => assertPiAiForwardFixSource(relativePath, source));
			assert.equal(patchPiAiForwardFixSource(relativePath, source), source);
		}
	}
});

test("pruned native Pi AI verification does not require declaration files", () => {
	const readText = (path: string, label: string): string => {
		if (path.endsWith(".d.ts")) {
			throw new Error(`${label} is missing`);
		}
		return readFileSync(path, "utf8");
	};

	assert.doesNotThrow(() =>
		assertPiAiForwardFixPackageTree(appRoot, readText, { prunedNative: true }),
	);
	assert.throws(
		() => assertPiAiForwardFixPackageTree(appRoot, readText),
		/bundled root Pi AI dist\/utils\/provider-retry\.d\.ts is missing/,
	);
});

test("Pi AI forward patch applies each unsupported 0.84.2 source layout once", () => {
	const shared = patchPiAiForwardFixSource(
		"dist/api/google-shared.js",
		'import { transformMessages } from "./transform-messages.js";',
	);
	assert.match(shared, new RegExp(PI_AI_FORWARD_FIX_MARKERS.googleShared));
	assert.match(shared, /export function resolveGoogleThinkingLevel/);

	const generative = patchPiAiForwardFixSource(
		"dist/api/google-generative-ai.js",
		[
			'import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";',
			'    const effort = (clampedReasoning === "off" ? "high" : clampedReasoning);',
			"level: getThinkingLevel(effort, googleModel)",
			"budgetTokens: getGoogleBudget(googleModel, effort, options.thinkingBudgets)",
			"function getGoogleBudget(model, effort, customBudgets) {",
			"customBudgets?.[effort]",
			"customBudgets[effort]",
			"budgets[effort]",
			"budgets[effort]",
			"budgets[effort]",
			"    const base = buildBaseOptions(model, context, options, apiKey);",
		].join("\n"),
	);
	assert.match(generative, new RegExp(PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi));
	assert.match(generative, /getThinkingLevel\(resolvedLevel, googleModel\)/);
	assert.doesNotMatch(generative, /budgets\[effort\]/);

	const vertex = patchPiAiForwardFixSource(
		"dist/api/google-vertex.js",
		[
			'import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";',
			'    const effort = (clampedReasoning === "off" ? "high" : clampedReasoning);',
			"level: getGemini3ThinkingLevel(effort, geminiModel)",
			"budgetTokens: getGoogleBudget(geminiModel, effort, options.thinkingBudgets)",
			"function getGoogleBudget(model, effort, customBudgets) {",
			"customBudgets?.[effort]",
			"customBudgets[effort]",
			"budgets[effort]",
			"budgets[effort]",
			"    const base = buildBaseOptions(model, context, options, undefined);",
		].join("\n"),
	);
	assert.match(vertex, new RegExp(PI_AI_FORWARD_FIX_MARKERS.googleVertex));
	assert.match(vertex, /getGemini3ThinkingLevel\(resolvedLevel, geminiModel\)/);
	assert.doesNotMatch(vertex, /budgets\[effort\]/);

	const bedrock = patchPiAiForwardFixSource(
		"dist/api/bedrock-converse-stream.js",
		[
			"            const client = new BedrockRuntimeClient(config);",
			"            if (response.$metadata.httpStatusCode !== undefined) {",
			'    client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });',
			"}",
			"export const streamSimple",
			"    const base = buildBaseOptions(model, context, options, undefined);",
		].join("\n"),
	);
	assert.match(bedrock, new RegExp(PI_AI_FORWARD_FIX_MARKERS.bedrock));
	assert.match(bedrock, /step: "deserialize", name: "pi-ai-response-headers"/);
	assert.match(bedrock, /!observedRawResponse/);

	const xiaomi = patchPiAiForwardFixSource(
		"dist/providers/data/xiaomi.json",
		JSON.stringify({
			"openai-completions": {
				"mimo-v2-flash": { id: "mimo-v2-flash" },
				"mimo-v2-omni": { id: "mimo-v2-omni" },
				"mimo-v2-pro": { id: "mimo-v2-pro" },
				"mimo-v2.5": { id: "mimo-v2.5" },
				"mimo-v2.5-pro": { id: "mimo-v2.5-pro" },
			},
		}),
	);
	assert.doesNotMatch(xiaomi, /mimo-v2-flash|mimo-v2-omni|mimo-v2-pro"/);
	assert.match(xiaomi, /mimo-v2\.5-pro/);

	const zai = patchPiAiForwardFixSource(
		"dist/providers/data/zai-coding-cn.json",
		JSON.stringify({
			"openai-completions": Object.fromEntries(
				["glm-4.7", "glm-5-turbo", "glm-5.2"].map((id) => [
					id,
					{ id, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
				]),
			),
		}),
	);
	const zaiModels = JSON.parse(zai)["openai-completions"];
	assert.deepEqual(Object.keys(zaiModels), [
		"glm-4.6v",
		"glm-4.7",
		"glm-5-turbo",
		"glm-5.1",
		"glm-5.2",
		"glm-5v-turbo",
	]);
	assert.deepEqual(zaiModels["glm-4.7"].cost, {
		input: 0.6,
		output: 2.2,
		cacheRead: 0.11,
		cacheWrite: 0,
	});
	for (const id of ["glm-4.6v", "glm-5.1", "glm-5v-turbo"]) {
		assert.equal(zaiModels[id].id, id);
	}

	const baseten = patchPiAiForwardFixSource(
		"dist/providers/data/baseten.json",
		JSON.stringify({
			"openai-completions": Object.fromEntries(
				["zai-org/GLM-5.2", "zai-org/GLM-5.2-Fast"].map((id) => [
					id,
					{ id, input: ["text"] },
				]),
			),
		}),
	);
	const basetenModels = JSON.parse(baseten)["openai-completions"];
	for (const id of ["zai-org/GLM-5.2", "zai-org/GLM-5.2-Fast"]) {
		assert.deepEqual(basetenModels[id].input, ["text", "image"]);
	}

	const manifest = JSON.parse(
		patchPiAiForwardFixSource(
			"dist/providers/data/.manifest.json",
			JSON.stringify({
				schemaVersion: 3,
				generatedAt: "2026-08-14T10:02:30.583Z",
				structureHash: "stale",
				files: {
					"baseten.json": "stale",
					"xiaomi.json": "stale",
					"xiaomi-token-plan-cn.json": "stale",
					"xiaomi-token-plan-ams.json": "stale",
					"xiaomi-token-plan-sgp.json": "stale",
					"zai.json": "stale",
					"zai-coding-cn.json": "stale",
				},
			}),
		),
	);
	assert.equal(manifest.structureHash, "a2a167065a0bd00645b34c52292f2f2b468af195d0d58e15382a3e071ebf94dd");
	assert.equal(
		manifest.files["baseten.json"],
		"245c6ef6381f3d8e9d251857e07585db0aeef4156e8d4c31de31aef12444f2e0",
	);
});

test("Google providers honor model thinking maps and mapped token budgets", async () => {
	const shared = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "google-shared.js")).href}?forward-fix=${Date.now()}`
	);
	assert.equal(
		shared.resolveGoogleThinkingLevel(
			googleModel("google-generative-ai", "gemini-3.7-flash", { high: "LOW" }),
			"high",
		),
		"low",
	);
	assert.throws(
		() =>
			shared.resolveGoogleThinkingLevel(
				googleModel("google-generative-ai", "gemini-3.7-flash", { xhigh: "extreme" }),
				"xhigh",
			),
		/Unsupported Google thinking level mapping/,
	);

	const generativePayload = await captureGooglePayload(
		resolve(piAiRoot, "dist", "api", "google-generative-ai.js"),
		googleModel("google-generative-ai", "gemini-3.7-flash", { high: "LOW" }),
		"high",
	);
	assert.equal(generativePayload.config?.thinkingConfig?.thinkingLevel, "LOW");
	assert.equal(generativePayload.config?.toolConfig?.functionCallingConfig?.mode, "NONE");

	const vertexPayload = await captureGooglePayload(
		resolve(piAiRoot, "dist", "api", "google-vertex.js"),
		googleModel("google-vertex", "gemini-2.5-flash", { max: "high" }),
		"max",
		{ high: 4321 },
	);
	assert.equal(vertexPayload.config?.thinkingConfig?.thinkingBudget, 4321);
	assert.equal(vertexPayload.config?.toolConfig?.functionCallingConfig?.mode, "NONE");
});

test("Bedrock forwards raw Smithy response headers to onResponse", async (t) => {
	let server: Server | undefined;
	t.after(async () => {
		if (!server) return;
		await new Promise<void>((resolveClose, rejectClose) => {
			server?.close((error) => (error ? rejectClose(error) : resolveClose()));
		});
	});
	const modelId = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
	server = createServer((_request, response) => {
		response.writeHead(200, {
			"content-type": "application/vnd.amazon.eventstream",
			"x-amzn-requestid": "req-123",
			"x-bifrost-provider": "bedrock",
			"x-bifrost-resolved-model": modelId,
		});
		response.end();
	});
	await new Promise<void>((resolveListen) => server?.listen(0, "127.0.0.1", resolveListen));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	const bedrock = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "bedrock-converse-stream.js")).href}?forward-fix=${Date.now()}`
	);
	const compat = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "compat.js")).href}?forward-fix=${Date.now()}`
	);
	const responses: Array<{ status: number; headers: Record<string, string> }> = [];
	const model = {
		...compat.getModel("amazon-bedrock", modelId),
		baseUrl: `http://127.0.0.1:${address.port}`,
	};
	const result = await bedrock.stream(
		model,
		{ messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
		{
			cacheRetention: "none",
			env: { AWS_BEDROCK_FORCE_HTTP1: "1", AWS_BEDROCK_SKIP_AUTH: "1" },
			onResponse: (response: { status: number; headers: Record<string, string> }) => {
				responses.push(response);
			},
		},
	).result();

	assert.equal(result.stopReason, "error");
	assert.equal(responses.length, 1);
	assert.equal(responses[0].status, 200);
	assert.equal(responses[0].headers["x-amzn-requestid"], "req-123");
	assert.equal(responses[0].headers["x-bifrost-provider"], "bedrock");
	assert.equal(responses[0].headers["x-bifrost-resolved-model"], modelId);
});

test("patched Xiaomi and China ZAI catalogs expose only current provider models", async () => {
	const providers = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "providers", "all.js")).href}?forward-fix=${Date.now()}`
	);
	for (const provider of [
		"xiaomi",
		"xiaomi-token-plan-cn",
		"xiaomi-token-plan-ams",
		"xiaomi-token-plan-sgp",
	]) {
		const modelIds = providers.getBuiltinModels(provider).map((model: { id: string }) => model.id);
		for (const id of ["mimo-v2-flash", "mimo-v2-omni", "mimo-v2-pro"]) {
			assert.equal(modelIds.includes(id), false, `${provider} retained ${id}`);
		}
		for (const id of ["mimo-v2.5", "mimo-v2.5-pro"]) {
			assert.equal(modelIds.includes(id), true, `${provider} omitted ${id}`);
		}
	}
	assert.deepEqual(providers.getBuiltinModel("zai", "glm-5.2").cost, {
		input: 1.4,
		output: 4.4,
		cacheRead: 0.26,
		cacheWrite: 0,
	});
	for (const id of ["glm-4.6v", "glm-5.1", "glm-5v-turbo"]) {
		assert.equal(providers.getBuiltinModel("zai-coding-cn", id).id, id);
	}
	for (const id of ["zai-org/GLM-5.2", "zai-org/GLM-5.2-Fast"]) {
		assert.deepEqual(providers.getBuiltinModel("baseten", id).input, ["text", "image"]);
	}
});

function openAiCompletionsModel(provider: string, id: string, baseUrl: string) {
	return {
		id,
		name: id,
		api: "openai-completions" as const,
		provider,
		baseUrl,
		reasoning: true,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	};
}

test("OpenAI-compatible history bounds foreign tool IDs and preserves result pairing", async () => {
	const openAiCompletions = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "openai-completions.js")).href}?tool-ids=${Date.now()}`
	);
	const ids = [
		"a".repeat(40),
		"a".repeat(41),
		`${"same-prefix-".repeat(6)}first`,
		`${"same-prefix-".repeat(6)}second`,
		"short.native:1",
	];
	const assistant = {
		role: "assistant" as const,
		content: ids.map((id, index) => ({
			type: "toolCall" as const,
			id,
			name: "read",
			arguments: { path: `file-${index}` },
		})),
		api: "other",
		provider: "other",
		model: "other",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse" as const,
		timestamp: 1,
	};
	const results = ids.map((toolCallId, index) => ({
		role: "toolResult" as const,
		toolCallId,
		toolName: "read",
		content: [{ type: "text" as const, text: `result-${index}` }],
		isError: false,
		timestamp: 2 + index,
	}));
	let payload: any;
	const response = await openAiCompletions.streamSimple(
		openAiCompletionsModel("custom-gateway", "proxy-model", "https://gateway.example/v1"),
		{ messages: [{ role: "user", content: "read", timestamp: 0 }, assistant, ...results] },
		{
			apiKey: "test",
			onPayload: (next: unknown) => {
				payload = next;
				throw new Error("captured tool IDs");
			},
		},
	).result();
	assert.match(response.errorMessage ?? "", /captured tool IDs/);
	const callIds = payload.messages.find((message: any) => message.role === "assistant")
		.tool_calls.map((call: any) => call.id);
	const resultIds = payload.messages.filter((message: any) => message.role === "tool")
		.map((message: any) => message.tool_call_id);
	assert.deepEqual(callIds, resultIds);
	assert.equal(callIds[0], ids[0]);
	assert.equal(callIds[4], ids[4]);
	assert.equal(callIds[1].length, 40);
	assert.equal(new Set(callIds).size, ids.length);
	for (const id of callIds.slice(1, 4)) {
		assert.match(id, /^[A-Za-z0-9_-]+$/);
		assert.ok(id.length <= 40);
	}
});

test("Gemini 3 thought signatures are captured from SSE and replayed verbatim", async (t) => {
	const signature = "AgGDja8BCEmVrN0base64sig";
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.write(`data: ${JSON.stringify({
			id: "chatcmpl-signature",
			model: "google/gemini-3-test",
			choices: [{
				index: 0,
				delta: {
					tool_calls: [{
						index: 0,
						id: "call_1",
						type: "function",
						function: { name: "read", arguments: "{\"path\":\"README.md\"}" },
						extra_content: { google: { thought_signature: signature } },
					}],
				},
				finish_reason: null,
			}],
		})}\n\n`);
		response.write(`data: ${JSON.stringify({
			id: "chatcmpl-signature",
			model: "google/gemini-3-test",
			choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
		})}\n\n`);
		response.end("data: [DONE]\n\n");
	});
	t.after(async () => {
		await new Promise<void>((resolveClose, rejectClose) =>
			server.close((error) => error ? rejectClose(error) : resolveClose())
		);
	});
	await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
	const address = server.address();
	assert.ok(address && typeof address !== "string");

	const openAiCompletions = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "openai-completions.js")).href}?signature=${Date.now()}`
	);
	const model = openAiCompletionsModel(
		"openrouter",
		"google/gemini-3-test",
		`http://127.0.0.1:${address.port}`,
	);
	const first = await openAiCompletions.streamSimple(
		model,
		{
			messages: [{ role: "user", content: "read", timestamp: 0 }],
			tools: [{
				name: "read",
				description: "Read",
				parameters: { type: "object", properties: { path: { type: "string" } } },
			}],
		},
		{ apiKey: "test" },
	).result();
	const toolCall = first.content.find((block: any) => block.type === "toolCall") as any;
	assert.equal(toolCall?.thoughtSignature, signature);

	let replayPayload: any;
	await openAiCompletions.streamSimple(
		model,
		{ messages: [first] },
		{
			apiKey: "test",
			onPayload: (next: unknown) => {
				replayPayload = next;
				throw new Error("captured signature replay");
			},
		},
	).result();
	assert.deepEqual(replayPayload.messages[0].tool_calls[0].extra_content, {
		google: { thought_signature: signature },
	});
});

test("provider retry handles only Retry-After in-flight budget 402 errors", async () => {
	const { retryProviderRequest } = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "utils", "provider-retry.js")).href}?budget=${Date.now()}`
	);
	const transient = Object.assign(
		new Error("OpenRouter in_flight_budget_exhausted"),
		{
			status: 402,
			headers: new Headers({ "retry-after": "0" }),
			error: { code: "in_flight_budget_exhausted" },
		},
	);
	let transientAttempts = 0;
	assert.equal(
		await retryProviderRequest(async () => {
			transientAttempts++;
			if (transientAttempts === 1) throw transient;
			return "recovered";
		}, { maxRetries: 1 }),
		"recovered",
	);
	assert.equal(transientAttempts, 2);

	for (const error of [
		Object.assign(new Error("payment required"), {
			status: 402,
			headers: new Headers({ "retry-after": "0" }),
		}),
		Object.assign(new Error("in_flight_budget_exhausted"), {
			status: 402,
			headers: new Headers(),
		}),
	]) {
		let attempts = 0;
		await assert.rejects(
			retryProviderRequest(async () => {
				attempts++;
				throw error;
			}, { maxRetries: 1 }),
			new RegExp((error as Error).message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
		assert.equal(attempts, 1);
	}
});
