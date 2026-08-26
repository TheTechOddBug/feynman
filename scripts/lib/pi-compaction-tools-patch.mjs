/**
 * Temporary Pi 0.84.2 forward patch for upstream commits and issue-scoped fixes:
 * - 90305d90a049d3f7784f15821d117fc6932248e7 (disable tools during summaries)
 * - 97fa14e39cfce78c273a36b2d9e8509cd5bc6b72 (reject truncated summaries)
 * - earendil-works/pi#8651 (bound compaction budgets to the model context window)
 * - earendil-works/pi#8652 (reject unusable persisted summary checkpoints)
 *
 * Removal condition: delete this patch after Feynman adopts a released Pi
 * version that contains the commits above and equivalent fixes for #8651/#8652.
 */

export const PI_COMPACTION_TOOLS_REQUIRED_VERSION = "0.84.2";

export const PI_COMPACTION_TOOLS_RUNTIME_TARGETS = Object.freeze([
	"dist/core/compaction/compaction.js",
	"dist/core/compaction/branch-summarization.js",
	"dist/core/agent-session.js",
]);
export const PI_COMPACTION_TOOLS_TYPE_TARGETS = Object.freeze([
	"dist/core/compaction/compaction.d.ts",
]);
export const PI_COMPACTION_TOOLS_PATCH_TARGETS = Object.freeze([
	...PI_COMPACTION_TOOLS_RUNTIME_TARGETS,
	...PI_COMPACTION_TOOLS_TYPE_TARGETS,
]);

export const PI_COMPACTION_TOOLS_PATCH_MARKERS = Object.freeze({
	request: "Feynman Pi 0.84.2 forward patch: disable tools during summarization",
	historyResponse: "Feynman Pi 0.84.2 forward patch: reject compaction tool calls",
	prefixResponse: "Feynman Pi 0.84.2 forward patch: reject turn-prefix tool calls",
	branchResponse: "Feynman Pi 0.84.2 forward patch: reject branch-summary tool calls",
	summaryFailure: "Feynman Pi 0.84.2 forward patch: reject truncated summaries",
	summaryFailureTypes: "Feynman Pi 0.84.2 forward patch: type truncated-summary guard",
	contextBudgets: "Feynman Pi 0.84.2 hotfix: bound compaction budgets to model context",
	contextCallers: "Feynman Pi 0.84.2 hotfix: pass model context into compaction preparation",
	contextBudgetTypes: "Feynman Pi 0.84.2 hotfix: type model-bounded compaction budgets",
	summaryIntegrity: "Feynman Pi 0.84.2 hotfix: reject unusable summary checkpoints",
	branchIntegrity: "Feynman Pi 0.84.2 hotfix: reject unusable branch checkpoints",
	summaryIntegrityTypes: "Feynman Pi 0.84.2 hotfix: type summary integrity guard",
});

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequiredOccurrences(source, original, replacement, label, expectedCount = 1) {
	const count = countOccurrences(source, original);
	if (count !== expectedCount) {
		throw new Error(
			`Unsupported Pi ${PI_COMPACTION_TOOLS_REQUIRED_VERSION} ${label} layout; expected ${expectedCount} occurrence${expectedCount === 1 ? "" : "s"}, found ${count}`,
		);
	}
	return source.split(original).join(replacement);
}

function replaceRequired(source, original, replacement, label) {
	return replaceRequiredOccurrences(source, original, replacement, label, 1);
}

function assertFragments(source, relativePath, fragments) {
	for (const fragment of fragments) {
		if (!source.includes(fragment)) {
			throw new Error(`Incomplete Pi compaction tools patch ${relativePath}: missing ${fragment}`);
		}
	}
}

function assertAbsentFragments(source, relativePath, fragments) {
	for (const fragment of fragments) {
		if (source.includes(fragment)) {
			throw new Error(`Invalid Pi compaction tools patch ${relativePath}: retained ${fragment}`);
		}
	}
}

function stripStaleSourceMapDirective(source, sourceMapName, label) {
	const directive = `//# sourceMappingURL=${sourceMapName}`;
	const count = countOccurrences(source, directive);
	if (count > 1) {
		throw new Error(
			`Unsupported Pi ${PI_COMPACTION_TOOLS_REQUIRED_VERSION} ${label} layout; expected at most 1 source map directive, found ${count}`,
		);
	}
	return count === 1 ? source.replace(directive, "") : source;
}

function isFullCompactionSource(source) {
	return [
		"export const DEFAULT_COMPACTION_SETTINGS",
		"export function shouldCompact",
		"export function prepareCompaction",
	].some((fragment) => source.includes(fragment));
}

function isFullBranchSource(source) {
	return source.includes("export async function generateBranchSummary");
}

function isFullCompactionTypesSource(source) {
	return source.includes("export interface CompactionSettings") || source.includes("prepareCompaction(pathEntries:");
}

export function assertPiCompactionToolsPatchedSource(relativePath, source) {
	switch (relativePath) {
		case "dist/core/compaction/compaction.js": {
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.request,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailure,
				'        toolChoice: "none",',
				"export function getSummarizationFailure(response, label) {",
				'response.stopReason === "length"',
				"generation hit the token cap and the summary is incomplete",
				'throw new Error("Summarization attempted to call a tool");',
				'throw new Error("Turn prefix summarization attempted to call a tool");',
			]);
			if (isFullCompactionSource(source)) {
				assertFragments(source, relativePath, [
					PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets,
					PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrity,
					"export function getEffectiveCompactionSettings(settings, contextWindow) {",
					"const reserveCeiling = Math.max(1, Math.floor(windowTokens / 4));",
					"const keepRecentCeiling = Math.max(1, windowTokens - 2 * reserveTokens);",
					"return contextTokens > contextWindow - effectiveSettings.reserveTokens;",
					"export function prepareCompaction(pathEntries, settings, contextWindow) {",
					"findCutPoint(pathEntries, boundaryStart, boundaryEnd, effectiveSettings.keepRecentTokens)",
					"settings: effectiveSettings,",
					"export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS, sourceCharacters) {",
					"return Math.min(512, Math.max(64, Math.floor(sourceCharacters / 200)));",
					"const minimumCharacters = minimumSummaryContentCharacters(sourceCharacters);",
					'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0))',
					'getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS, conversationText.length)',
				]);
				assertAbsentFragments(source, relativePath, [
					"return contextTokens > contextWindow - settings.reserveTokens;",
					"findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens)",
					"text: contentText(response.content),",
				]);
			}
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
		}
		case "dist/core/compaction/branch-summarization.js": {
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse,
				'const failure = getSummarizationFailure(response, "Branch summarization");',
				'return { error: "Branch summarization attempted to call a tool" };',
			]);
			if (isFullBranchSource(source)) {
				assertFragments(source, relativePath, [
					PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets,
					PI_COMPACTION_TOOLS_PATCH_MARKERS.branchIntegrity,
					"getEffectiveCompactionSettings",
					"getSummaryUsabilityFailure",
					"const effectiveSettings = getEffectiveCompactionSettings(",
					"const tokenBudget = contextWindow - effectiveSettings.reserveTokens;",
					'getSummaryUsabilityFailure(summary, "Branch summarization", replaceInstructions && customInstructions ? [] : undefined, conversationText.length)',
				]);
				assertAbsentFragments(source, relativePath, [
					"const tokenBudget = contextWindow - reserveTokens;",
				]);
			} else {
				assertFragments(source, relativePath, [
					'import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.js";',
				]);
			}
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
		}
		case "dist/core/agent-session.js":
			assertFragments(source, relativePath, [PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers]);
			if (countOccurrences(source, PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers) !== 2) {
				throw new Error(`Incomplete Pi compaction tools patch ${relativePath}: expected two model-context call sites`);
			}
			if (countOccurrences(source, "prepareCompaction(pathEntries, settings, requestModel.contextWindow)") !== 2) {
				throw new Error(`Incomplete Pi compaction tools patch ${relativePath}: model context is not wired to both compaction paths`);
			}
			assertAbsentFragments(source, relativePath, ["prepareCompaction(pathEntries, settings);"]);
			return;
		case "dist/core/compaction/compaction.d.ts": {
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes,
				"export declare function getSummarizationFailure(",
				"response: AssistantMessage",
				"label: string",
				"): string | undefined;",
			]);
			if (isFullCompactionTypesSource(source)) {
				assertFragments(source, relativePath, [
					PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgetTypes,
					PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrityTypes,
					"export declare function getEffectiveCompactionSettings(settings: CompactionSettings, contextWindow: number | undefined): CompactionSettings;",
					"export declare function getSummaryUsabilityFailure(summary: string, label: string, requiredSections?: readonly string[], sourceCharacters?: number): string | undefined;",
					"prepareCompaction(pathEntries: SessionEntry[], settings: CompactionSettings, contextWindow?: number)",
				]);
			}
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
		}
		default:
			throw new Error(`Unknown Pi compaction tools patch target: ${relativePath}`);
	}
}

function patchCompactionSource(source) {
	let patched = source;
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.request)) {
		patched = replaceRequired(
			patched,
			[
				'        cacheRetention: "none",',
				"        sessionId: uuidv7(),",
			].join("\n"),
			[
				'        cacheRetention: "none",',
				"        sessionId: uuidv7(),",
				`        // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.request}`,
				'        toolChoice: "none",',
			].join("\n"),
			"summarization request options",
		);
		patched = replaceRequired(
			patched,
			[
				'        throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);',
				"    }",
				"    const textContent = contentText(response.content);",
			].join("\n"),
			[
				'        throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);',
				"    }",
				`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse}`,
				'    if (response.content.some((block) => block.type === "toolCall")) {',
				'        throw new Error("Summarization attempted to call a tool");',
				"    }",
				"    const textContent = contentText(response.content);",
			].join("\n"),
			"history summary response",
		);
		patched = replaceRequired(
			patched,
			[
				'        throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);',
				"    }",
				"    return {",
			].join("\n"),
			[
				'        throw new Error(`Turn prefix summarization failed: ${response.errorMessage || "Unknown error"}`);',
				"    }",
				`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse}`,
				'    if (response.content.some((block) => block.type === "toolCall")) {',
				'        throw new Error("Turn prefix summarization attempted to call a tool");',
				"    }",
				"    return {",
			].join("\n"),
			"turn-prefix summary response",
		);
	}
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailure)) {
		patched = replaceRequired(
			patched,
			"function createSummarizationOptions(",
			`// ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailure}
export function getSummarizationFailure(response, label) {
    if (response.stopReason === "error") {
        return \`\${label} failed: \${response.errorMessage || "Unknown error"}\`;
    }
    if (response.stopReason === "length") {
        return \`\${label} failed: generation hit the token cap and the summary is incomplete\`;
    }
    return undefined;
}

function createSummarizationOptions(`,
			"summarization failure helper",
		);
		patched = replaceRequired(
			patched,
			`    if (response.stopReason === "error") {
        throw new Error(\`Summarization failed: \${response.errorMessage || "Unknown error"}\`);
    }`,
			`    const failure = getSummarizationFailure(response, "Summarization");
    if (failure) {
        throw new Error(failure);
    }`,
			"history summary failure",
		);
		patched = replaceRequired(
			patched,
			`    if (response.stopReason === "error") {
        throw new Error(\`Turn prefix summarization failed: \${response.errorMessage || "Unknown error"}\`);
    }`,
			`    const failure = getSummarizationFailure(response, "Turn prefix summarization");
    if (failure) {
        throw new Error(failure);
    }`,
			"turn-prefix summary failure",
		);
	}
	if (isFullCompactionSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets)) {
		patched = replaceRequired(
			patched,
			`export const DEFAULT_COMPACTION_SETTINGS = {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
};`,
			`export const DEFAULT_COMPACTION_SETTINGS = {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
};
// ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets}
export function getEffectiveCompactionSettings(settings, contextWindow) {
    if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
        return settings;
    }
    const windowTokens = Math.max(4, Math.floor(contextWindow));
    const configuredReserve = Number.isFinite(settings.reserveTokens) && settings.reserveTokens > 0
        ? Math.floor(settings.reserveTokens)
        : DEFAULT_COMPACTION_SETTINGS.reserveTokens;
    const configuredKeepRecent = Number.isFinite(settings.keepRecentTokens) && settings.keepRecentTokens > 0
        ? Math.floor(settings.keepRecentTokens)
        : DEFAULT_COMPACTION_SETTINGS.keepRecentTokens;
    const reserveCeiling = Math.max(1, Math.floor(windowTokens / 4));
    const reserveTokens = Math.max(1, Math.min(configuredReserve, reserveCeiling));
    const keepRecentCeiling = Math.max(1, windowTokens - 2 * reserveTokens);
    const keepRecentTokens = Math.max(1, Math.min(configuredKeepRecent, keepRecentCeiling));
    if (reserveTokens === settings.reserveTokens && keepRecentTokens === settings.keepRecentTokens) {
        return settings;
    }
    return { ...settings, reserveTokens, keepRecentTokens };
}`,
			"default compaction settings",
		);
		patched = replaceRequired(
			patched,
			`export function shouldCompact(contextTokens, contextWindow, settings) {
    if (!settings.enabled)
        return false;
    return contextTokens > contextWindow - settings.reserveTokens;
}`,
			`export function shouldCompact(contextTokens, contextWindow, settings) {
    if (!settings.enabled)
        return false;
    const effectiveSettings = getEffectiveCompactionSettings(settings, contextWindow);
    return contextTokens > contextWindow - effectiveSettings.reserveTokens;
}`,
			"automatic compaction threshold",
		);
		patched = replaceRequired(
			patched,
			"export function prepareCompaction(pathEntries, settings) {",
			`export function prepareCompaction(pathEntries, settings, contextWindow) {
    const effectiveSettings = getEffectiveCompactionSettings(settings, contextWindow);`,
			"compaction preparation signature",
		);
		patched = replaceRequired(
			patched,
			"const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);",
			"const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, effectiveSettings.keepRecentTokens);",
			"compaction keep-recent budget",
		);
		patched = replaceRequired(
			patched,
			"        settings,\n    };",
			"        settings: effectiveSettings,\n    };",
			"compaction preparation settings",
		);
	}
	if (isFullCompactionSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrity)) {
		patched = replaceRequired(
			patched,
			"\nfunction createSummarizationOptions(",
			`
// ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrity}
const CHECKPOINT_REQUIRED_SECTIONS = Object.freeze(["Goal", "Progress", "Next Steps"]);
const TURN_PREFIX_REQUIRED_SECTIONS = Object.freeze(["Original Request", "Early Progress", "Context for Suffix"]);
const FILE_OPERATION_BLOCK = /<(?:read-files|modified-files)>[\\s\\S]*?<\\/(?:read-files|modified-files)>/gi;
function summarySections(summary) {
    const sections = new Map();
    let current;
    for (const line of summary.split(/\\r?\\n/)) {
        const heading = /^##\\s+(.+?)\\s*$/.exec(line);
        if (heading) {
            current = heading[1].trim().toLowerCase();
            if (!sections.has(current))
                sections.set(current, []);
            continue;
        }
        if (current)
            sections.get(current).push(line);
    }
    return sections;
}
function isSubstantiveSummarySection(lines) {
    const normalized = lines
        .join("\\n")
        .replace(/^#{3,}\\s+.*$/gm, "")
        .replace(/^\\s*(?:[-*+]\\s*)?\\[[ xX]\\]\\s*/gm, "")
        .replace(/^\\s*(?:[-*+]|\\d+[.)])\\s+/gm, "")
        .replace(/[\`*_>#()[\\]]/g, " ")
        .replace(/\\s+/g, " ")
        .trim();
    if (!normalized || /^(?:none|n\\/?a|not applicable|unknown|no (?:information|context|progress|steps?|request|goal)(?: available| provided| yet)?)[.!]*$/i.test(normalized)) {
        return false;
    }
    return normalized.replace(/[^\\p{L}\\p{N}]+/gu, "").length >= 4;
}
function summaryContentCharacters(summary) {
    return summary.replace(/[^\\p{L}\\p{N}]+/gu, "").length;
}
function minimumSummaryContentCharacters(sourceCharacters) {
    if (!Number.isFinite(sourceCharacters) || sourceCharacters <= 0)
        return 64;
    return Math.min(512, Math.max(64, Math.floor(sourceCharacters / 200)));
}
export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS, sourceCharacters) {
    const checkpoint = summary.replace(FILE_OPERATION_BLOCK, "").trim();
    if (!checkpoint) {
        return \`\${label} failed: generated an empty or file-list-only checkpoint\`;
    }
    const contentCharacters = summaryContentCharacters(checkpoint);
    const minimumCharacters = minimumSummaryContentCharacters(sourceCharacters);
    if (contentCharacters < minimumCharacters) {
        return \`\${label} failed: generated an implausibly small checkpoint (\${contentCharacters} content characters; minimum \${minimumCharacters})\`;
    }
    const sections = summarySections(checkpoint);
    const missing = requiredSections.filter((heading) => !isSubstantiveSummarySection(sections.get(heading.toLowerCase()) ?? []));
    if (missing.length > 0) {
        return \`\${label} failed: generated a structurally unusable checkpoint (missing substantive \${missing.join(", ")})\`;
    }
    return undefined;
}

function createSummarizationOptions(`,
			"summary integrity helper",
		);
		patched = replaceRequired(
			patched,
			`    const textContent = contentText(response.content);
    return { text: textContent, usage: response.usage };`,
			`    const textContent = contentText(response.content);
    const usabilityFailure = getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0));
    if (usabilityFailure) {
        throw new Error(usabilityFailure);
    }
    return { text: textContent, usage: response.usage };`,
			"history summary integrity",
		);
		patched = replaceRequired(
			patched,
			`    return {
        text: contentText(response.content),
        usage: response.usage,
    };`,
			`    const textContent = contentText(response.content);
    const usabilityFailure = getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS, conversationText.length);
    if (usabilityFailure) {
        throw new Error(usabilityFailure);
    }
    return {
        text: textContent,
        usage: response.usage,
    };`,
			"turn-prefix summary integrity",
		);
	}
	if (
		isFullCompactionSource(patched) &&
		patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrity) &&
		!patched.includes("function minimumSummaryContentCharacters(")
	) {
		patched = replaceRequired(
			patched,
			`export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS) {
    const checkpoint = summary.replace(FILE_OPERATION_BLOCK, "").trim();`,
			`function summaryContentCharacters(summary) {
    return summary.replace(/[^\\p{L}\\p{N}]+/gu, "").length;
}
function minimumSummaryContentCharacters(sourceCharacters) {
    if (!Number.isFinite(sourceCharacters) || sourceCharacters <= 0)
        return 64;
    return Math.min(512, Math.max(64, Math.floor(sourceCharacters / 200)));
}
export function getSummaryUsabilityFailure(summary, label, requiredSections = CHECKPOINT_REQUIRED_SECTIONS, sourceCharacters) {
    const checkpoint = summary.replace(FILE_OPERATION_BLOCK, "").trim();`,
			"summary-size integrity helper",
		);
		patched = replaceRequired(
			patched,
			"    const sections = summarySections(checkpoint);",
			`    const contentCharacters = summaryContentCharacters(checkpoint);
    const minimumCharacters = minimumSummaryContentCharacters(sourceCharacters);
    if (contentCharacters < minimumCharacters) {
        return \`\${label} failed: generated an implausibly small checkpoint (\${contentCharacters} content characters; minimum \${minimumCharacters})\`;
    }
    const sections = summarySections(checkpoint);`,
			"summary-size integrity guard",
		);
		patched = replaceRequired(
			patched,
			'getSummaryUsabilityFailure(textContent, "Summarization")',
			'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0))',
			"history summary-size integrity",
		);
		patched = replaceRequired(
			patched,
			'getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS)',
			'getSummaryUsabilityFailure(textContent, "Turn prefix summarization", TURN_PREFIX_REQUIRED_SECTIONS, conversationText.length)',
			"turn-prefix summary-size integrity",
		);
	}
	if (
		isFullCompactionSource(patched) &&
		patched.includes(
			'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length)',
		)
	) {
		patched = replaceRequired(
			patched,
			'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length)',
			'getSummaryUsabilityFailure(textContent, "Summarization", undefined, conversationText.length + (previousSummary?.length ?? 0))',
			"incremental summary-size integrity",
		);
	}
	patched = stripStaleSourceMapDirective(
		patched,
		"compaction.js.map",
		"compaction JavaScript source map",
	);
	assertPiCompactionToolsPatchedSource("dist/core/compaction/compaction.js", patched);
	return patched;
}

function patchBranchSummarizationSource(source) {
	let patched = source;
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse)) {
		patched = replaceRequired(
			patched,
			[
				'        return { error: response.errorMessage || "Summarization failed" };',
				"    }",
				"    let summary = contentText(response.content);",
			].join("\n"),
			[
				'        return { error: response.errorMessage || "Summarization failed" };',
				"    }",
				`    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse}`,
				'    if (response.content.some((block) => block.type === "toolCall")) {',
				'        return { error: "Branch summarization attempted to call a tool" };',
				"    }",
				"    let summary = contentText(response.content);",
			].join("\n"),
			"branch summary response",
		);
	}
	if (!patched.includes("getSummarizationFailure")) {
		patched = replaceRequired(
			patched,
			'import { completeSummarization, estimateTokens } from "./compaction.js";',
			'import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.js";',
			"branch summary import",
		);
		patched = replaceRequired(
			patched,
			`    if (response.stopReason === "error") {
        return { error: response.errorMessage || "Summarization failed" };
    }`,
			`    const failure = getSummarizationFailure(response, "Branch summarization");
    if (failure) {
        return { error: failure };
    }`,
			"branch summary failure",
		);
	}
	if (isFullBranchSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets)) {
		patched = replaceRequired(
			patched,
			'import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.js";',
			'import { completeSummarization, estimateTokens, getEffectiveCompactionSettings, getSummarizationFailure, getSummaryUsabilityFailure } from "./compaction.js";',
			"branch compaction helper import",
		);
		patched = replaceRequired(
			patched,
			`    const contextWindow = model.contextWindow || 128000;
    const tokenBudget = contextWindow - reserveTokens;`,
			`    const contextWindow = model.contextWindow || 128000;
    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgets}
    const effectiveSettings = getEffectiveCompactionSettings({ enabled: true, reserveTokens, keepRecentTokens: 1 }, contextWindow);
    const tokenBudget = contextWindow - effectiveSettings.reserveTokens;`,
			"branch summarization token budget",
		);
	}
	if (isFullBranchSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchIntegrity)) {
		patched = replaceRequired(
			patched,
			"    let summary = contentText(response.content);",
			`    let summary = contentText(response.content);
    // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.branchIntegrity}
    const usabilityFailure = getSummaryUsabilityFailure(summary, "Branch summarization", replaceInstructions && customInstructions ? [] : undefined, conversationText.length);
    if (usabilityFailure) {
        return { error: usabilityFailure };
    }`,
			"branch summary integrity",
		);
	}
	if (
		isFullBranchSource(patched) &&
		patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchIntegrity) &&
		!patched.includes("replaceInstructions && customInstructions ? [] : undefined")
	) {
		patched = replaceRequired(
			patched,
			'getSummaryUsabilityFailure(summary, "Branch summarization")',
			'getSummaryUsabilityFailure(summary, "Branch summarization", replaceInstructions && customInstructions ? [] : undefined, conversationText.length)',
			"branch replacement-prompt summary integrity",
		);
	}
	patched = stripStaleSourceMapDirective(
		patched,
		"branch-summarization.js.map",
		"branch summarization JavaScript source map",
	);
	assertPiCompactionToolsPatchedSource("dist/core/compaction/branch-summarization.js", patched);
	return patched;
}

function patchAgentSessionSource(source) {
	let patched = source;
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers)) {
		patched = replaceRequiredOccurrences(
			patched,
			"            const preparation = prepareCompaction(pathEntries, settings);",
			`            // ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextCallers}
            const preparation = prepareCompaction(pathEntries, settings, requestModel.contextWindow);`,
			"agent-session compaction preparation",
			2,
		);
	}
	assertPiCompactionToolsPatchedSource("dist/core/agent-session.js", patched);
	return patched;
}

function patchCompactionTypesSource(source) {
	let patched = source;
	if (!patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes)) {
		patched = replaceRequired(
			patched,
			"export declare function completeSummarization(",
			`/** ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes} */
export declare function getSummarizationFailure(response: AssistantMessage, label: string): string | undefined;
export declare function completeSummarization(`,
			"compaction declarations",
		);
	}
	if (isFullCompactionTypesSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgetTypes)) {
		patched = replaceRequired(
			patched,
			"export declare const DEFAULT_COMPACTION_SETTINGS: CompactionSettings;",
			`export declare const DEFAULT_COMPACTION_SETTINGS: CompactionSettings;
/** ${PI_COMPACTION_TOOLS_PATCH_MARKERS.contextBudgetTypes} */
export declare function getEffectiveCompactionSettings(settings: CompactionSettings, contextWindow: number | undefined): CompactionSettings;`,
			"compaction budget declarations",
		);
		patched = replaceRequired(
			patched,
			"export declare function prepareCompaction(pathEntries: SessionEntry[], settings: CompactionSettings): CompactionPreparation | undefined;",
			"export declare function prepareCompaction(pathEntries: SessionEntry[], settings: CompactionSettings, contextWindow?: number): CompactionPreparation | undefined;",
			"compaction preparation declaration",
		);
	}
	if (isFullCompactionTypesSource(patched) && !patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrityTypes)) {
		patched = replaceRequired(
			patched,
			"export declare function completeSummarization(",
			`/** ${PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrityTypes} */
export declare function getSummaryUsabilityFailure(summary: string, label: string, requiredSections?: readonly string[], sourceCharacters?: number): string | undefined;
export declare function completeSummarization(`,
			"summary integrity declaration",
		);
	}
	if (
		isFullCompactionTypesSource(patched) &&
		patched.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryIntegrityTypes) &&
		!patched.includes("sourceCharacters?: number")
	) {
		patched = replaceRequired(
			patched,
			"export declare function getSummaryUsabilityFailure(summary: string, label: string, requiredSections?: readonly string[]): string | undefined;",
			"export declare function getSummaryUsabilityFailure(summary: string, label: string, requiredSections?: readonly string[], sourceCharacters?: number): string | undefined;",
			"summary-size integrity declaration",
		);
	}
	patched = stripStaleSourceMapDirective(
		patched,
		"compaction.d.ts.map",
		"compaction declaration source map",
	);
	assertPiCompactionToolsPatchedSource("dist/core/compaction/compaction.d.ts", patched);
	return patched;
}

export function patchPiCompactionToolsSource(relativePath, source) {
	switch (relativePath) {
		case "dist/core/compaction/compaction.js":
			return patchCompactionSource(source);
		case "dist/core/compaction/branch-summarization.js":
			return patchBranchSummarizationSource(source);
		case "dist/core/agent-session.js":
			return patchAgentSessionSource(source);
		case "dist/core/compaction/compaction.d.ts":
			return patchCompactionTypesSource(source);
		default:
			throw new Error(`Unknown Pi compaction tools patch target: ${relativePath}`);
	}
}
