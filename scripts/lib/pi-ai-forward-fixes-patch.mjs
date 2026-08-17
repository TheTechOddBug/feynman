/**
 * Temporary Pi 0.84.2 forward patches for upstream commits:
 * - af2c352238cffd12d404d5a4cd35a21f93a78fe0 (Google thinking maps)
 * - 10acee6045e9025a22dff7e5220ed0d7538f12aa (Bedrock response headers)
 * - 0e4d49541477c4fc6e404f845ad40ed47d157f24 (deprecated Xiaomi models)
 * - 87205484bf749c2140fef5d1bea68995d57e739c (China ZAI catalog)
 *
 * Removal condition: delete this patch after Feynman adopts a released Pi
 * version that contains all four commits.
 */

export const PI_AI_FORWARD_FIX_REQUIRED_VERSION = "0.84.2";

export const PI_AI_FORWARD_FIX_TARGETS = Object.freeze([
	"dist/api/google-generative-ai.js",
	"dist/api/google-shared.js",
	"dist/api/google-vertex.js",
	"dist/api/bedrock-converse-stream.js",
	"dist/providers/data/xiaomi.json",
	"dist/providers/data/xiaomi-token-plan-cn.json",
	"dist/providers/data/xiaomi-token-plan-ams.json",
	"dist/providers/data/xiaomi-token-plan-sgp.json",
	"dist/providers/data/zai.json",
	"dist/providers/data/zai-coding-cn.json",
]);

export const PI_AI_FORWARD_FIX_MARKERS = Object.freeze({
	googleGenerativeAi: "Feynman Pi 0.84.2 forward patch: Google thinking level maps",
	googleShared: "Feynman Pi 0.84.2 forward patch: resolve Google thinking level maps",
	googleVertex: "Feynman Pi 0.84.2 forward patch: Vertex thinking level maps",
	bedrock: "Feynman Pi 0.84.2 forward patch: Bedrock Smithy response headers",
});

const XIAOMI_DEPRECATED_MODEL_IDS = Object.freeze([
	"mimo-v2-flash",
	"mimo-v2-omni",
	"mimo-v2-pro",
]);

const ZAI_REFERENCE_COSTS = Object.freeze({
	"glm-4.7": Object.freeze({ input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 }),
	"glm-5-turbo": Object.freeze({ input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 }),
	"glm-5.2": Object.freeze({ input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }),
});

const ZAI_CHINA_ADDITIONS = Object.freeze({
	"glm-4.6v": Object.freeze({
		id: "glm-4.6v",
		name: "GLM-4.6V",
		api: "openai-completions",
		provider: "zai-coding-cn",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		reasoning: true,
		input: Object.freeze(["text", "image"]),
		cost: Object.freeze({ input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 }),
		compat: Object.freeze({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			thinkingFormat: "zai",
			zaiToolStream: true,
		}),
		contextWindow: 128000,
		maxTokens: 32768,
	}),
	"glm-5.1": Object.freeze({
		id: "glm-5.1",
		name: "GLM-5.1",
		api: "openai-completions",
		provider: "zai-coding-cn",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		reasoning: true,
		input: Object.freeze(["text"]),
		cost: Object.freeze({ input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 }),
		compat: Object.freeze({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			thinkingFormat: "zai",
			zaiToolStream: true,
		}),
		contextWindow: 200000,
		maxTokens: 131072,
	}),
	"glm-5v-turbo": Object.freeze({
		id: "glm-5v-turbo",
		name: "GLM-5V-Turbo",
		api: "openai-completions",
		provider: "zai-coding-cn",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		reasoning: true,
		input: Object.freeze(["text", "image"]),
		cost: Object.freeze({ input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 }),
		compat: Object.freeze({
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			thinkingFormat: "zai",
			zaiToolStream: true,
		}),
		contextWindow: 200000,
		maxTokens: 131072,
	}),
});

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	const count = countOccurrences(source, original);
	if (count !== 1) {
		throw new Error(
			`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${label} layout; expected 1 occurrence, found ${count}`,
		);
	}
	return source.replace(original, replacement);
}

function replaceRequiredCount(source, original, replacement, expectedCount, label) {
	const count = countOccurrences(source, original);
	if (count !== expectedCount) {
		throw new Error(
			`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${label} layout; expected ${expectedCount} occurrences, found ${count}`,
		);
	}
	return source.replaceAll(original, replacement);
}

function deepEqual(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function parseCatalog(source, relativePath) {
	try {
		const parsed = JSON.parse(source);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("catalog root is not an object");
		}
		return parsed;
	} catch (error) {
		throw new Error(`Invalid Pi AI model catalog ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function getOpenAiModels(catalog, relativePath) {
	const models = catalog["openai-completions"];
	if (!models || typeof models !== "object" || Array.isArray(models)) {
		throw new Error(`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${relativePath}: missing openai-completions`);
	}
	return models;
}

function assertXiaomiCatalog(relativePath, catalog) {
	const models = getOpenAiModels(catalog, relativePath);
	for (const modelId of XIAOMI_DEPRECATED_MODEL_IDS) {
		if (modelId in models) {
			throw new Error(`Incomplete Pi AI Xiaomi catalog patch ${relativePath}: retained ${modelId}`);
		}
	}
	for (const modelId of ["mimo-v2.5", "mimo-v2.5-pro"]) {
		if (!(modelId in models)) {
			throw new Error(`Incomplete Pi AI Xiaomi catalog patch ${relativePath}: missing ${modelId}`);
		}
	}
}

function assertZaiCatalog(relativePath, catalog) {
	const models = getOpenAiModels(catalog, relativePath);
	for (const [modelId, cost] of Object.entries(ZAI_REFERENCE_COSTS)) {
		if (!deepEqual(models[modelId]?.cost, cost)) {
			throw new Error(`Incomplete Pi AI ZAI catalog patch ${relativePath}: incorrect ${modelId} cost`);
		}
	}
	if (relativePath.endsWith("/zai-coding-cn.json")) {
		for (const [modelId, expected] of Object.entries(ZAI_CHINA_ADDITIONS)) {
			if (!deepEqual(models[modelId], expected)) {
				throw new Error(`Incomplete Pi AI China ZAI catalog patch ${relativePath}: incorrect ${modelId}`);
			}
		}
		const modelIds = Object.keys(models);
		const sortedModelIds = [...modelIds].sort((left, right) => left.localeCompare(right));
		if (!deepEqual(modelIds, sortedModelIds)) {
			throw new Error(`Incomplete Pi AI China ZAI catalog patch ${relativePath}: model order differs from upstream`);
		}
	}
}

function patchModelCatalog(relativePath, source) {
	const catalog = parseCatalog(source, relativePath);
	const models = getOpenAiModels(catalog, relativePath);

	if (relativePath.includes("/xiaomi")) {
		for (const modelId of XIAOMI_DEPRECATED_MODEL_IDS) {
			delete models[modelId];
		}
		assertXiaomiCatalog(relativePath, catalog);
		return JSON.stringify(catalog);
	}

	if (relativePath.endsWith("/zai.json") || relativePath.endsWith("/zai-coding-cn.json")) {
		for (const [modelId, cost] of Object.entries(ZAI_REFERENCE_COSTS)) {
			if (!models[modelId]) {
				throw new Error(`Unsupported Pi ${PI_AI_FORWARD_FIX_REQUIRED_VERSION} ${relativePath}: missing ${modelId}`);
			}
			models[modelId].cost = { ...cost };
		}
		if (relativePath.endsWith("/zai-coding-cn.json")) {
			for (const [modelId, model] of Object.entries(ZAI_CHINA_ADDITIONS)) {
				models[modelId] = structuredClone(model);
			}
			catalog["openai-completions"] = Object.fromEntries(
				Object.entries(models).sort(([left], [right]) => left.localeCompare(right)),
			);
		}
		assertZaiCatalog(relativePath, catalog);
		return JSON.stringify(catalog);
	}

	throw new Error(`Unknown Pi AI model catalog patch target: ${relativePath}`);
}

function assertSourceFragments(source, relativePath, fragments) {
	for (const fragment of fragments) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete Pi AI forward patch ${relativePath}: missing ${fragment}`);
		}
	}
}

export function assertPiAiForwardFixSource(relativePath, source) {
	if (relativePath.includes("/providers/data/")) {
		const catalog = parseCatalog(source, relativePath);
		if (relativePath.includes("/xiaomi")) {
			assertXiaomiCatalog(relativePath, catalog);
			return;
		}
		assertZaiCatalog(relativePath, catalog);
		return;
	}

	switch (relativePath) {
		case "dist/api/google-generative-ai.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi,
				"resolveGoogleThinkingLevel(model, clampedReasoning)",
				"level: getThinkingLevel(resolvedLevel, googleModel)",
				"budgetTokens: getGoogleBudget(googleModel, resolvedLevel, options.thinkingBudgets)",
			]);
			return;
		case "dist/api/google-shared.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.googleShared,
				"export function resolveGoogleThinkingLevel(model, level)",
				"Unsupported Google thinking level mapping",
			]);
			return;
		case "dist/api/google-vertex.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.googleVertex,
				"resolveGoogleThinkingLevel(model, clampedReasoning)",
				"level: getGemini3ThinkingLevel(resolvedLevel, geminiModel)",
				"budgetTokens: getGoogleBudget(geminiModel, resolvedLevel, options.thinkingBudgets)",
			]);
			return;
		case "dist/api/bedrock-converse-stream.js":
			assertSourceFragments(source, relativePath, [
				PI_AI_FORWARD_FIX_MARKERS.bedrock,
				"addResponseHeadersMiddleware(client, options.onResponse, model",
				"if (!observedRawResponse && response.$metadata.httpStatusCode !== undefined)",
				'name: "pi-ai-response-headers"',
			]);
			return;
		default:
			throw new Error(`Unknown Pi AI forward patch target: ${relativePath}`);
	}
}

function patchGoogleShared(source) {
	const relativePath = "dist/api/google-shared.js";
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.googleShared)) {
		assertPiAiForwardFixSource(relativePath, source);
		return source;
	}
	const anchor = 'import { transformMessages } from "./transform-messages.js";';
	const helper = `${anchor}
// ${PI_AI_FORWARD_FIX_MARKERS.googleShared}
export function resolveGoogleThinkingLevel(model, level) {
    if (level === "off")
        return "high";
    const mapped = model.thinkingLevelMap?.[level];
    const resolvedLevel = typeof mapped === "string" ? mapped.toLowerCase() : level;
    switch (resolvedLevel) {
        case "minimal":
        case "low":
        case "medium":
        case "high":
            return resolvedLevel;
        default:
            throw new Error(\`Unsupported Google thinking level mapping for \${model.provider}/\${model.id}: \${level} -> \${String(mapped)}\`);
    }
}`;
	const patched = replaceRequired(source, anchor, helper, "Google shared thinking map");
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

function patchGoogleGenerativeAi(source) {
	const relativePath = "dist/api/google-generative-ai.js";
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi)) {
		assertPiAiForwardFixSource(relativePath, source);
		return source;
	}
	let patched = replaceRequired(
		source,
		'import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";',
		`import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, resolveGoogleThinkingLevel, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";
// ${PI_AI_FORWARD_FIX_MARKERS.googleGenerativeAi}`,
		"Google Generative AI import",
	);
	patched = replaceRequired(
		patched,
		'    const effort = (clampedReasoning === "off" ? "high" : clampedReasoning);',
		"    const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);",
		"Google Generative AI level resolution",
	);
	patched = replaceRequired(patched, "level: getThinkingLevel(effort, googleModel)", "level: getThinkingLevel(resolvedLevel, googleModel)", "Google Generative AI thinking level");
	patched = replaceRequired(patched, "budgetTokens: getGoogleBudget(googleModel, effort, options.thinkingBudgets)", "budgetTokens: getGoogleBudget(googleModel, resolvedLevel, options.thinkingBudgets)", "Google Generative AI thinking budget");
	patched = replaceRequired(patched, "function getGoogleBudget(model, effort, customBudgets) {", "function getGoogleBudget(model, level, customBudgets) {", "Google Generative AI budget parameter");
	patched = replaceRequired(patched, "customBudgets?.[effort]", "customBudgets?.[level]", "Google Generative AI custom budget check");
	patched = replaceRequired(patched, "customBudgets[effort]", "customBudgets[level]", "Google Generative AI custom budget value");
	patched = replaceRequiredCount(patched, "budgets[effort]", "budgets[level]", 3, "Google Generative AI built-in budgets");
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

function patchGoogleVertex(source) {
	const relativePath = "dist/api/google-vertex.js";
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.googleVertex)) {
		assertPiAiForwardFixSource(relativePath, source);
		return source;
	}
	let patched = replaceRequired(
		source,
		'import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";',
		`import { convertMessages, convertTools, isThinkingPart, mapStopReason, resolveGoogleFunctionCallingMode, resolveGoogleThinkingLevel, retainThoughtSignature, retryGoogleRequest, supportsGoogleStrictToolSampling, } from "./google-shared.js";
// ${PI_AI_FORWARD_FIX_MARKERS.googleVertex}`,
		"Google Vertex import",
	);
	patched = replaceRequired(
		patched,
		'    const effort = (clampedReasoning === "off" ? "high" : clampedReasoning);',
		"    const resolvedLevel = resolveGoogleThinkingLevel(model, clampedReasoning);",
		"Google Vertex level resolution",
	);
	patched = replaceRequired(patched, "level: getGemini3ThinkingLevel(effort, geminiModel)", "level: getGemini3ThinkingLevel(resolvedLevel, geminiModel)", "Google Vertex thinking level");
	patched = replaceRequired(patched, "budgetTokens: getGoogleBudget(geminiModel, effort, options.thinkingBudgets)", "budgetTokens: getGoogleBudget(geminiModel, resolvedLevel, options.thinkingBudgets)", "Google Vertex thinking budget");
	patched = replaceRequired(patched, "function getGoogleBudget(model, effort, customBudgets) {", "function getGoogleBudget(model, level, customBudgets) {", "Google Vertex budget parameter");
	patched = replaceRequired(patched, "customBudgets?.[effort]", "customBudgets?.[level]", "Google Vertex custom budget check");
	patched = replaceRequired(patched, "customBudgets[effort]", "customBudgets[level]", "Google Vertex custom budget value");
	patched = replaceRequiredCount(patched, "budgets[effort]", "budgets[level]", 2, "Google Vertex built-in budgets");
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

function patchBedrock(source) {
	const relativePath = "dist/api/bedrock-converse-stream.js";
	if (source.includes(PI_AI_FORWARD_FIX_MARKERS.bedrock)) {
		assertPiAiForwardFixSource(relativePath, source);
		return source;
	}
	let patched = replaceRequired(
		source,
		"            const client = new BedrockRuntimeClient(config);",
		`            const client = new BedrockRuntimeClient(config);
            let observedRawResponse = false;
            if (options.onResponse) {
                addResponseHeadersMiddleware(client, options.onResponse, model, () => {
                    observedRawResponse = true;
                });
            }`,
		"Bedrock response middleware registration",
	);
	patched = replaceRequired(
		patched,
		"            if (response.$metadata.httpStatusCode !== undefined) {",
		"            if (!observedRawResponse && response.$metadata.httpStatusCode !== undefined) {",
		"Bedrock metadata fallback",
	);
	const anchor = `    client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });
}
export const streamSimple`;
	const helper = `    client.middlewareStack.add(middleware, { step: "build", name: "pi-ai-custom-headers", priority: "low" });
}
// ${PI_AI_FORWARD_FIX_MARKERS.bedrock}
function isSmithyHttpResponse(response) {
    if (!response || typeof response !== "object")
        return false;
    const candidate = response;
    return typeof candidate.statusCode === "number" && !!candidate.headers && typeof candidate.headers === "object";
}
function toProviderResponse(response) {
    if (!isSmithyHttpResponse(response))
        return undefined;
    return { status: response.statusCode, headers: { ...response.headers } };
}
function addResponseHeadersMiddleware(client, onResponse, model, onObserved) {
    const middleware = (next) => async (args) => {
        const result = await next(args);
        const providerResponse = toProviderResponse(result.response);
        if (providerResponse) {
            onObserved();
            await onResponse(providerResponse, model);
        }
        return result;
    };
    client.middlewareStack.add(middleware, { step: "deserialize", name: "pi-ai-response-headers" });
}
export const streamSimple`;
	patched = replaceRequired(patched, anchor, helper, "Bedrock response middleware");
	assertPiAiForwardFixSource(relativePath, patched);
	return patched;
}

export function patchPiAiForwardFixSource(relativePath, source) {
	if (relativePath.includes("/providers/data/")) {
		return patchModelCatalog(relativePath, source);
	}
	switch (relativePath) {
		case "dist/api/google-generative-ai.js":
			return patchGoogleGenerativeAi(source);
		case "dist/api/google-shared.js":
			return patchGoogleShared(source);
		case "dist/api/google-vertex.js":
			return patchGoogleVertex(source);
		case "dist/api/bedrock-converse-stream.js":
			return patchBedrock(source);
		default:
			throw new Error(`Unknown Pi AI forward patch target: ${relativePath}`);
	}
}
