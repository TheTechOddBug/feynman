import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiAiForwardFixSource,
	PI_AI_FORWARD_FIX_REQUIRED_VERSION,
	PI_AI_FORWARD_FIX_RUNTIME_TARGETS,
	PI_AI_FORWARD_FIX_TARGETS,
} from "./pi-ai-forward-fixes-patch.mjs";
import {
	assertPiSubagentPatchedSources,
	verifyPiSubagentUsageLimitFallbackBehavior,
} from "./pi-subagents-verification.mjs";

const TINY_JPEG_2X1 =
	"/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAABAAIDAREAAhEBAxEB/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4H8Q/8h/Uv+vmX/0M1/o1wJ/ySWU/9g1D/wBNRMOM/wDkp8z/AOv9b/05I//Z";

function app1Segment(payload) {
	const segment = Buffer.alloc(payload.length + 4);
	segment[0] = 0xff;
	segment[1] = 0xe1;
	segment.writeUInt16BE(payload.length + 2, 2);
	segment.set(payload, 4);
	return segment;
}

function jpegWithXmpBeforeOrientation() {
	const jpeg = Buffer.from(TINY_JPEG_2X1, "base64");
	const xmp = app1Segment(
		Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'),
	);
	const orientation6 = app1Segment(
		Buffer.concat([
			Buffer.from("Exif\0\0"),
			Buffer.from("49492a0008000000010012010300010000000600000000000000", "hex"),
		]),
	);
	return Buffer.concat([jpeg.subarray(0, 2), xmp, orientation6, jpeg.subarray(2)]);
}

function sortedRecord(entries) {
	return Object.fromEntries([...entries].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
}

function sha256(source) {
	return createHash("sha256").update(source).digest("hex");
}

function assertPiAiModelDataManifest(readSource, copy, surface) {
	const manifestPath = "dist/providers/data/.manifest.json";
	const manifest = JSON.parse(readSource(manifestPath, copy));
	const structure = [];
	for (const [filename, expectedHash] of Object.entries(manifest.files ?? {})) {
		const relativePath = `dist/providers/data/${filename}`;
		const source = readSource(relativePath, copy);
		assert.equal(
			sha256(source),
			expectedHash,
			`${surface} ${copy} Pi AI model manifest does not match ${filename}`,
		);
		const groups = JSON.parse(source);
		const models = [];
		for (const [api, values] of Object.entries(groups)) {
			for (const modelId of Object.keys(values)) models.push([modelId, api]);
		}
		structure.push([filename.slice(0, -".json".length), sortedRecord(models)]);
	}
	assert.equal(
		sha256(JSON.stringify(sortedRecord(structure))),
		manifest.structureHash,
		`${surface} ${copy} Pi AI model manifest structure hash is stale`,
	);
}

export function assertPiAiForwardFixCopies(readSource, surface, targets = PI_AI_FORWARD_FIX_TARGETS) {
	for (const relativePath of targets) {
		for (const copy of ["root", "nested"]) {
			try {
				assertPiAiForwardFixSource(relativePath, readSource(relativePath, copy));
			} catch (error) {
				throw new Error(
					`${surface} ${copy} Pi AI ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error },
				);
			}
		}
	}
	for (const copy of ["root", "nested"]) {
		assertPiAiModelDataManifest(readSource, copy, surface);
	}
}

export function assertPiAiForwardFixPackageTree(packageRoot, readText, { prunedNative = false } = {}) {
	assertPiAiForwardFixCopies(
		(relativePath, copy) =>
			readText(
				resolve(
					packageRoot,
					"node_modules",
					"@earendil-works",
					...(copy === "nested"
						? ["pi-coding-agent", "node_modules", "@earendil-works", "pi-ai"]
						: ["pi-ai"]),
					...relativePath.split("/"),
				),
				`bundled ${copy} Pi AI ${relativePath}`,
			),
		"bundled",
		prunedNative ? PI_AI_FORWARD_FIX_RUNTIME_TARGETS : PI_AI_FORWARD_FIX_TARGETS,
	);
	const nestedManifest = JSON.parse(
		readText(
			resolve(
				packageRoot,
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
				"node_modules",
				"@earendil-works",
				"pi-ai",
				"package.json",
			),
			"bundled nested Pi AI manifest",
		),
	);
	assert.equal(nestedManifest.version, PI_AI_FORWARD_FIX_REQUIRED_VERSION);
}

export function assertPiAiForwardFixArchive(readEntry) {
	assertPiAiForwardFixCopies(
		(relativePath, copy) =>
			readEntry(
				copy === "nested"
					? `npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/${relativePath}`
					: `npm/node_modules/@earendil-works/pi-ai/${relativePath}`,
			),
		"runtime archive",
		PI_AI_FORWARD_FIX_RUNTIME_TARGETS,
	);
	const nestedManifest = JSON.parse(
		readEntry(
			"npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
		),
	);
	assert.equal(nestedManifest.version, PI_AI_FORWARD_FIX_REQUIRED_VERSION);
}

export function resolvePiAiForwardFixVerificationTargets({ prunedNative = false } = {}) {
	return prunedNative ? PI_AI_FORWARD_FIX_RUNTIME_TARGETS : PI_AI_FORWARD_FIX_TARGETS;
}

export async function verifyRuntimeForwardFixBehavior(packageRoot, { prunedNative = false } = {}) {
	assertPiSubagentPatchedSources(
		(relativePath) => readFileSync(
			resolve(packageRoot, ".feynman", "npm", "node_modules", "pi-subagents", ...relativePath.split("/")),
			"utf8",
		),
		"installed runtime pi-subagents",
	);
	await verifyPiSubagentUsageLimitFallbackBehavior(packageRoot);
	const piAiRoot = resolve(packageRoot, "node_modules", "@earendil-works", "pi-ai");
	const nestedPiAiRoot = resolve(
		packageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
		"node_modules",
		"@earendil-works",
		"pi-ai",
	);
	const codingAgentRoot = resolve(
		packageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	assertPiAiForwardFixCopies(
		(relativePath, copy) =>
			readFileSync(
				resolve(copy === "root" ? piAiRoot : nestedPiAiRoot, ...relativePath.split("/")),
				"utf8",
			),
		"installed",
		resolvePiAiForwardFixVerificationTargets({ prunedNative }),
	);

	const codingAgent = await import(
		`${pathToFileURL(resolve(codingAgentRoot, "dist", "index.js")).href}?installed-forward-fix=${Date.now()}`
	);
	const orderedContent = [
		{ type: "text", text: "Figure A:" },
		{ type: "image", mimeType: "image/png", data: "Zmlyc3Q=" },
		{ type: "text", text: "Figure B:" },
		{ type: "image", mimeType: "image/png", data: "c2Vjb25k" },
	];
	let orderedHandoff;
	await codingAgent.AgentSession.prototype.sendUserMessage.call(
		{
			_prompt: async (_text, _options, content) => {
				orderedHandoff = content;
			},
		},
		orderedContent,
	);
	assert.deepEqual(orderedHandoff, orderedContent);
	assert.deepEqual(
		codingAgent.AgentSession.prototype._createUserContent(
			"normalized",
			orderedContent.filter((part) => part.type === "image"),
			orderedHandoff,
		),
		orderedContent,
	);

	const [{ convertToPng }, { resizeImage }] = await Promise.all([
		import(
			`${pathToFileURL(resolve(codingAgentRoot, "dist", "utils", "image-convert.js")).href}?installed-forward-fix=${Date.now()}`
		),
		import(
			`${pathToFileURL(resolve(codingAgentRoot, "dist", "utils", "image-resize.js")).href}?installed-forward-fix=${Date.now()}`
		),
	]);
	const orientedJpeg = jpegWithXmpBeforeOrientation();
	const converted = await convertToPng(orientedJpeg.toString("base64"), "image/jpeg");
	assert.ok(converted);
	const convertedPng = Buffer.from(converted.data, "base64");
	assert.equal(convertedPng.readUInt32BE(16), 1);
	assert.equal(convertedPng.readUInt32BE(20), 2);
	const resized = await resizeImage(orientedJpeg, "image/jpeg");
	assert.ok(resized);
	assert.equal(resized.originalWidth, 1);
	assert.equal(resized.originalHeight, 2);

	const googleShared = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "google-shared.js")).href}?installed-forward-fix=${Date.now()}`
	);
	const googleModel = {
		id: "gemini-3.7-flash",
		name: "gemini-3.7-flash",
		api: "google-generative-ai",
		provider: "installed-google",
		baseUrl: "https://example.invalid/v1beta",
		reasoning: true,
		thinkingLevelMap: { high: "LOW" },
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
	};
	assert.equal(googleShared.resolveGoogleThinkingLevel(googleModel, "high"), "low");

	const google = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "google-generative-ai.js")).href}?installed-forward-fix=${Date.now()}`
	);
	let googlePayload;
	const googleResult = await google.streamSimple(
		googleModel,
		{
			messages: [{ role: "user", content: "hello", timestamp: 0 }],
			tools: [{
				name: "read",
				description: "Read a file",
				parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
			}],
		},
		{
			apiKey: "test",
			reasoning: "high",
			toolChoice: "none",
			onPayload: (payload) => {
				googlePayload = payload;
				throw new Error("installed Google payload captured");
			},
		},
	).result();
	assert.match(googleResult.errorMessage ?? "", /installed Google payload captured/);
	assert.equal(googlePayload?.config?.thinkingConfig?.thinkingLevel, "LOW");
	assert.equal(googlePayload?.config?.toolConfig?.functionCallingConfig?.mode, "NONE");

	const providers = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "providers", "all.js")).href}?installed-forward-fix=${Date.now()}`
	);
	for (const provider of [
		"xiaomi",
		"xiaomi-token-plan-cn",
		"xiaomi-token-plan-ams",
		"xiaomi-token-plan-sgp",
	]) {
		const modelIds = providers.getBuiltinModels(provider).map((model) => model.id);
		for (const id of ["mimo-v2-flash", "mimo-v2-omni", "mimo-v2-pro"]) {
			assert.equal(modelIds.includes(id), false, `${provider} retained ${id}`);
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

	const openAiCompletions = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "api", "openai-completions.js")).href}?installed-forward-fix=${Date.now()}`
	);
	const openAiModel = {
		id: "proxy-model",
		name: "proxy-model",
		api: "openai-completions",
		provider: "custom-gateway",
		baseUrl: "https://gateway.example/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 4096,
	};
	let compactionPayload;
	const compactionResult = await openAiCompletions.streamSimple(
		openAiModel,
		{ messages: [{ role: "user", content: "summarize", timestamp: 0 }] },
		{
			apiKey: "test",
			toolChoice: "none",
			onPayload: (payload) => {
				compactionPayload = payload;
				throw new Error("installed compaction payload captured");
			},
		},
	).result();
	assert.match(compactionResult.errorMessage ?? "", /installed compaction payload captured/);
	assert.ok(compactionPayload);
	assert.equal("tool_choice" in compactionPayload, false);
	assert.equal("tools" in compactionPayload, false);

	const providerRetry = await import(
		`${pathToFileURL(resolve(piAiRoot, "dist", "utils", "provider-retry.js")).href}?installed-forward-fix=${Date.now()}`
	);
	const rateLimit = Object.assign(new Error("rate limited"), {
		status: 429,
		headers: new Headers({ "retry-after": "0" }),
	});
	let retryAttempts = 0;
	assert.equal(
		await providerRetry.retryProviderRequest(
			async () => {
				retryAttempts++;
				if (retryAttempts === 1) throw rateLimit;
				return "recovered";
			},
			{ maxRetries: 1, retryOn: providerRetry.isTransientInFlightBudgetError },
		),
		"recovered",
	);
	assert.equal(retryAttempts, 2);

	let geminiServer;
	try {
		const firstSignature = "installed-first-signature";
		const laterSignature = "installed-later-signature";
		const encryptedDetail = {
			type: "reasoning.encrypted",
			id: "call_1",
			data: "installed-encrypted-reasoning",
		};
		geminiServer = createServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/event-stream" });
			for (const delta of [
				{ reasoning_details: [encryptedDetail] },
				{
					tool_calls: [{
						index: 0,
						id: "call_1",
						type: "function",
						function: { name: "read", arguments: "{\"path\":\"README.md\"}" },
						extra_content: { google: { thought_signature: firstSignature } },
					}],
				},
				{
					tool_calls: [{
						index: 0,
						id: "call_1",
						type: "function",
						function: { name: "read", arguments: "" },
						extra_content: { google: { thought_signature: laterSignature } },
					}],
				},
			]) {
				response.write(`data: ${JSON.stringify({
					id: "chatcmpl-installed-signature",
					model: "google/gemini-3-test",
					choices: [{ index: 0, delta, finish_reason: null }],
				})}\n\n`);
			}
			response.write(`data: ${JSON.stringify({
				id: "chatcmpl-installed-signature",
				model: "google/gemini-3-test",
				choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
			})}\n\n`);
			response.end("data: [DONE]\n\n");
		});
		await new Promise((resolveListen) => geminiServer.listen(0, "127.0.0.1", resolveListen));
		const address = geminiServer.address();
		assert.ok(address && typeof address !== "string");
		const geminiModel = {
			...openAiModel,
			id: "google/gemini-3-test",
			provider: "openrouter",
			baseUrl: `http://127.0.0.1:${address.port}`,
		};
		const geminiResult = await openAiCompletions.streamSimple(
			geminiModel,
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
		const toolCall = geminiResult.content.find((block) => block.type === "toolCall");
		assert.equal(toolCall?.thoughtSignature, firstSignature);
		assert.deepEqual(geminiResult.reasoningDetails, [encryptedDetail]);

		let replayPayload;
		await openAiCompletions.streamSimple(
			geminiModel,
			{ messages: [JSON.parse(JSON.stringify(geminiResult))] },
			{
				apiKey: "test",
				onPayload: (payload) => {
					replayPayload = payload;
					throw new Error("installed Gemini replay captured");
				},
			},
		).result();
		assert.deepEqual(replayPayload.messages[0].reasoning_details, [encryptedDetail]);
		assert.deepEqual(replayPayload.messages[0].tool_calls[0].extra_content, {
			google: { thought_signature: firstSignature },
		});
	} finally {
		if (geminiServer) {
			await new Promise((resolveClose, rejectClose) => {
				geminiServer.close((error) => (error ? rejectClose(error) : resolveClose()));
			});
		}
	}

	let server;
	try {
		const modelId = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
		server = createServer((_request, response) => {
			response.writeHead(200, {
				"content-type": "application/vnd.amazon.eventstream",
				"x-amzn-requestid": "installed-req-123",
				"x-bifrost-provider": "bedrock",
				"x-bifrost-resolved-model": modelId,
			});
			response.end();
		});
		await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
		const address = server.address();
		assert.ok(address && typeof address !== "string");
		const bedrock = await import(
			`${pathToFileURL(resolve(piAiRoot, "dist", "api", "bedrock-converse-stream.js")).href}?installed-forward-fix=${Date.now()}`
		);
		const compat = await import(
			`${pathToFileURL(resolve(piAiRoot, "dist", "compat.js")).href}?installed-forward-fix=${Date.now()}`
		);
		const responses = [];
		const result = await bedrock.stream(
			{
				...compat.getModel("amazon-bedrock", modelId),
				baseUrl: `http://127.0.0.1:${address.port}`,
			},
			{ messages: [{ role: "user", content: "hello", timestamp: Date.now() }] },
			{
				cacheRetention: "none",
				env: { AWS_BEDROCK_FORCE_HTTP1: "1", AWS_BEDROCK_SKIP_AUTH: "1" },
				onResponse: (response) => responses.push(response),
			},
		).result();
		assert.equal(result.stopReason, "error");
		assert.equal(responses.length, 1);
		assert.equal(responses[0].headers["x-amzn-requestid"], "installed-req-123");
		assert.equal(responses[0].headers["x-bifrost-provider"], "bedrock");
		assert.equal(responses[0].headers["x-bifrost-resolved-model"], modelId);
	} finally {
		if (server) {
			await new Promise((resolveClose, rejectClose) => {
				server.close((error) => (error ? rejectClose(error) : resolveClose()));
			});
		}
	}
}
