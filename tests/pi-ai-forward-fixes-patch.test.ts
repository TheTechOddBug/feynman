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
		{ messages: [{ role: "user", content: "Hello", timestamp: 0 }] },
		{
			apiKey: "test",
			reasoning,
			thinkingBudgets,
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
		};
	};
}

test("Pi AI forward patch covers root and nested 0.84.2 runtime copies", () => {
	const patchSource = readFileSync(
		resolve(appRoot, "scripts", "lib", "pi-ai-forward-fixes-patch.mjs"),
		"utf8",
	);
	for (const commit of ["af2c352", "10acee6", "0e4d495", "8720548"]) {
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

	const vertexPayload = await captureGooglePayload(
		resolve(piAiRoot, "dist", "api", "google-vertex.js"),
		googleModel("google-vertex", "gemini-2.5-flash", { max: "high" }),
		"max",
		{ high: 4321 },
	);
	assert.equal(vertexPayload.config?.thinkingConfig?.thinkingBudget, 4321);
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
});
