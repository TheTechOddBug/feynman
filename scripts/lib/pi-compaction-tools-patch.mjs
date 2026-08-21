/**
 * Temporary Pi 0.84.2 forward patch for upstream commit:
 * - 90305d90a049d3f7784f15821d117fc6932248e7 (disable tools during summaries)
 *
 * Removal condition: delete this patch after Feynman adopts a released Pi
 * version that contains the commit above.
 */

export const PI_COMPACTION_TOOLS_REQUIRED_VERSION = "0.84.2";

export const PI_COMPACTION_TOOLS_PATCH_TARGETS = Object.freeze([
	"dist/core/compaction/compaction.js",
	"dist/core/compaction/branch-summarization.js",
]);

export const PI_COMPACTION_TOOLS_PATCH_MARKERS = Object.freeze({
	request: "Feynman Pi 0.84.2 forward patch: disable tools during summarization",
	historyResponse: "Feynman Pi 0.84.2 forward patch: reject compaction tool calls",
	prefixResponse: "Feynman Pi 0.84.2 forward patch: reject turn-prefix tool calls",
	branchResponse: "Feynman Pi 0.84.2 forward patch: reject branch-summary tool calls",
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

export function assertPiCompactionToolsPatchedSource(relativePath, source) {
	switch (relativePath) {
		case "dist/core/compaction/compaction.js":
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.request,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.historyResponse,
				PI_COMPACTION_TOOLS_PATCH_MARKERS.prefixResponse,
				'        toolChoice: "none",',
				'throw new Error("Summarization attempted to call a tool");',
				'throw new Error("Turn prefix summarization attempted to call a tool");',
			]);
			return;
		case "dist/core/compaction/branch-summarization.js":
			assertFragments(source, relativePath, [
				PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse,
				'return { error: "Branch summarization attempted to call a tool" };',
			]);
			return;
		default:
			throw new Error(`Unknown Pi compaction tools patch target: ${relativePath}`);
	}
}

function patchCompactionSource(source) {
	if (source.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.request)) {
		assertPiCompactionToolsPatchedSource("dist/core/compaction/compaction.js", source);
		return source;
	}
	let patched = replaceRequired(
		source,
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
	assertPiCompactionToolsPatchedSource("dist/core/compaction/compaction.js", patched);
	return patched;
}

function patchBranchSummarizationSource(source) {
	if (source.includes(PI_COMPACTION_TOOLS_PATCH_MARKERS.branchResponse)) {
		assertPiCompactionToolsPatchedSource("dist/core/compaction/branch-summarization.js", source);
		return source;
	}
	const patched = replaceRequired(
		source,
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
	assertPiCompactionToolsPatchedSource("dist/core/compaction/branch-summarization.js", patched);
	return patched;
}

export function patchPiCompactionToolsSource(relativePath, source) {
	switch (relativePath) {
		case "dist/core/compaction/compaction.js":
			return patchCompactionSource(source);
		case "dist/core/compaction/branch-summarization.js":
			return patchBranchSummarizationSource(source);
		default:
			throw new Error(`Unknown Pi compaction tools patch target: ${relativePath}`);
	}
}
