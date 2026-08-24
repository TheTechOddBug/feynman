/**
 * Temporary Pi 0.84.2 forward patch for upstream commits:
 * - 90305d90a049d3f7784f15821d117fc6932248e7 (disable tools during summaries)
 * - 97fa14e39cfce78c273a36b2d9e8509cd5bc6b72 (reject truncated summaries)
 *
 * Removal condition: delete this patch after Feynman adopts a released Pi
 * version that contains the commits above.
 */

export const PI_COMPACTION_TOOLS_REQUIRED_VERSION = "0.84.2";

export const PI_COMPACTION_TOOLS_RUNTIME_TARGETS = Object.freeze([
	"dist/core/compaction/compaction.js",
	"dist/core/compaction/branch-summarization.js",
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
});

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	const count = countOccurrences(source, original);
	if (count !== 1) {
		throw new Error(
			`Unsupported Pi ${PI_COMPACTION_TOOLS_REQUIRED_VERSION} ${label} layout; expected 1 occurrence, found ${count}`,
		);
	}
	return source.replace(original, replacement);
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

export function assertPiCompactionToolsPatchedSource(relativePath, source) {
	switch (relativePath) {
		case "dist/core/compaction/compaction.js":
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.request,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailure,
				'        toolChoice: "none",',
				'export function getSummarizationFailure(response, label) {',
				'response.stopReason === "length"',
				'generation hit the token cap and the summary is incomplete',
				'throw new Error("Summarization attempted to call a tool");',
				'throw new Error("Turn prefix summarization attempted to call a tool");',
			]);
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
		case "dist/core/compaction/branch-summarization.js":
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse,
				'import { completeSummarization, estimateTokens, getSummarizationFailure } from "./compaction.js";',
				'const failure = getSummarizationFailure(response, "Branch summarization");',
				'return { error: "Branch summarization attempted to call a tool" };',
			]);
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
		case "dist/core/compaction/compaction.d.ts":
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.summaryFailureTypes,
				"export declare function getSummarizationFailure(",
				"response: AssistantMessage",
				"label: string",
				"): string | undefined;",
			]);
			assertAbsentFragments(source, relativePath, ["//# sourceMappingURL="]);
			return;
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
			"        cacheRetention: \"none\",",
			"        sessionId: uuidv7(),",
		].join("\n"),
		[
			"        cacheRetention: \"none\",",
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
	patched = stripStaleSourceMapDirective(
		patched,
		"branch-summarization.js.map",
		"branch summarization JavaScript source map",
	);
	assertPiCompactionToolsPatchedSource("dist/core/compaction/branch-summarization.js", patched);
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
		case "dist/core/compaction/compaction.d.ts":
			return patchCompactionTypesSource(source);
		default:
			throw new Error(`Unknown Pi compaction tools patch target: ${relativePath}`);
	}
}
