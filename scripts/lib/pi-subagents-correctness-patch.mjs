// Remove this patch after the bundled pi-subagents release includes upstream commits
// c00577935732, e556c1692620, 2332d87440fb, and 5ffdcfc18f4e, preserves
// rate-limit fallback, rejects zero-success parallel runs, and passes this runtime verifier.
const CONTEXT_OVERFLOW_HELPER = [
	"/** Context-window failures must not rerun the same input on fallback models. */",
	"const CONTEXT_OVERFLOW_PATTERNS = [",
	"\t/context(?: length| window| limit)? (?:exceed|overflow|too long)/i,",
	"\t/maximum context length/i,",
	"\t/context_length_exceeded/i,",
	"\t/(?:prompt|input|request|messages?).{0,80}(?:too many tokens|token limit)/i,",
	"\t/(?:too many tokens|token limit).{0,80}(?:prompt|input|request|messages?)/i,",
	"\t/prompt.*too long/i,",
	"\t/input.*too long/i,",
	"\t/(?:prompt|input|messages?).{0,80}exceed(?:s|ed)?.{0,80}(?:token|context|maximum)/i,",
	"\t/reduce (?:the )?length of (?:the )?(?:messages?|prompt|input)/i,",
	"\t/exceeded.*context/i,",
	"\t/context.*overflow/i,",
	"];",
	"",
	"export function isContextOverflow(error: string | undefined): boolean {",
	"\tif (!error) return false;",
	"\tif (TOOL_FAILURE_PREFIX.test(error.trim())) return false;",
	"\treturn CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(error));",
	"}",
	"",
].join("\n");

const LEGACY_CONTEXT_OVERFLOW_PATTERNS = [
	"const CONTEXT_OVERFLOW_PATTERNS = [",
	"\t/context(?: length| window| limit)? (?:exceed|overflow|too long)/i,",
	"\t/maximum context length/i,",
	"\t/too many tokens/i,",
	"\t/token limit/i,",
	"\t/context_length_exceeded/i,",
	"\t/length_required/i,",
	"\t/maximum.*tokens/i,",
	"\t/prompt.*too long/i,",
	"\t/input.*too long/i,",
	"\t/exceeded.*context/i,",
	"\t/context.*overflow/i,",
	"];",
].join("\n");

const CURRENT_CONTEXT_OVERFLOW_PATTERNS = CONTEXT_OVERFLOW_HELPER.slice(
	CONTEXT_OVERFLOW_HELPER.indexOf("const CONTEXT_OVERFLOW_PATTERNS = ["),
	CONTEXT_OVERFLOW_HELPER.indexOf("\n\nexport function isContextOverflow("),
);

const FINALIZE_TOOL_RESULT_HELPER = [
	"/** Convert internal logical failures into Pi's canonical errored tool result. */",
	"function finalizeToolResult<T extends { isError?: boolean; content: unknown[] }>(result: T): T {",
	"\tif (result.isError !== true) return result;",
	"\tconst message = result.content",
	"\t\t.filter(",
	"\t\t\t(item): item is { type: \"text\"; text: string } =>",
	"\t\t\t\ttypeof item === \"object\" && item !== null &&",
	"\t\t\t\t(item as { type?: unknown }).type === \"text\" &&",
	"\t\t\t\ttypeof (item as { text?: unknown }).text === \"string\",",
	"\t\t)",
	"\t\t.map((item) => item.text)",
	"\t\t.join(\"\\n\")",
	"\t\t.trim();",
	"\tthrow new Error(message || \"pi-subagents reported a logical tool failure.\");",
	"}",
	"",
].join("\n");

function replaceAll(source, original, replacement) {
	return source.split(original).join(replacement);
}

function addAfter(source, anchor, addition) {
	if (!source.includes(anchor) || source.includes(addition.trim())) return source;
	return source.replace(anchor, `${anchor}\n${addition}`);
}

function addLineAfter(source, lineText, additionText) {
	const lines = source.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		if (lines[index].trim() !== lineText) continue;
		if (lines[index + 1]?.trim() === additionText) continue;
		const indentation = lines[index].match(/^\s*/)?.[0] ?? "";
		lines.splice(index + 1, 0, `${indentation}${additionText}`);
	}
	return lines.join("\n");
}

function patchModelFallback(source) {
	if (source.includes("export function isContextOverflow(")) {
		return source.replace(
			LEGACY_CONTEXT_OVERFLOW_PATTERNS,
			CURRENT_CONTEXT_OVERFLOW_PATTERNS,
		);
	}
	const anchor = "export function formatModelAttemptNote(";
	if (!source.includes("const TOOL_FAILURE_PREFIX =") || !source.includes(anchor)) return source;
	return source.replace(anchor, `${CONTEXT_OVERFLOW_HELPER}${anchor}`);
}

function patchForegroundExecution(source) {
	let patched = source;
	if (!patched.includes("\tisContextOverflow,\n")) {
		patched = patched.replace(
			"\tformatModelAttemptNote,\n\tisRetryableModelFailure,",
			"\tformatModelAttemptNote,\n\tisContextOverflow,\n\tisRetryableModelFailure,",
		);
	}
	const original =
		"\t\t\tif (!isRetryableModelFailure(result.error) || modelIndex === modelsToTry.length - 1) break modelAttemptsLoop;";
	const replacement = [
		"\t\t\tif (isContextOverflow(result.error)) {",
		"\t\t\t\tresult.contextOverflow = true;",
		"\t\t\t\tattemptNotes.push(`[fallback] ${attempt.model} failed: context overflow — reduce the task input or use a larger context window.`);",
		"\t\t\t\tbreak modelAttemptsLoop;",
		"\t\t\t}",
		original,
	].join("\n");
	if (!patched.includes("result.contextOverflow = true;")) {
		patched = patched.replace(original, replacement);
	}
	const toolResultAnchor =
		'\t\t\tif (evt.type === "tool_result_end" && evt.message) {';
	const toolResultReplacement = [
		toolResultAnchor,
		"\t\t\t\t// Some Pi event streams omit tool_execution_end. Treat the completed result as the tool boundary.",
		"\t\t\t\tif (progress.currentTool) {",
		"\t\t\t\t\tprogress.recentTools.push({",
		"\t\t\t\t\t\ttool: progress.currentTool,",
		'\t\t\t\t\t\targs: progress.currentToolArgs || "",',
		"\t\t\t\t\t\tendMs: now,",
		"\t\t\t\t\t});",
		"\t\t\t\t}",
		"\t\t\t\tprogress.currentTool = undefined;",
		"\t\t\t\tprogress.currentToolArgs = undefined;",
		"\t\t\t\tprogress.currentToolStartedAt = undefined;",
		"\t\t\t\tprogress.currentPath = undefined;",
	].join("\n");
	if (!patched.includes("Some Pi event streams omit tool_execution_end.")) {
		patched = patched.replace(toolResultAnchor, toolResultReplacement);
	}
	return patched;
}

function patchBackgroundRunner(source) {
	let patched = source.replace(
		'import { formatModelAttemptNote, isRetryableModelFailure } from "../shared/model-fallback.ts";',
		'import { formatModelAttemptNote, isContextOverflow, isRetryableModelFailure } from "../shared/model-fallback.ts";',
	);
	patched = addLineAfter(
		patched,
		"modelAttempts?: ModelAttempt[];",
		"contextOverflow?: boolean;",
	);
	patched = addLineAfter(
		patched,
		"modelAttempts: imported.modelAttempts,",
		"contextOverflow: imported.contextOverflow,",
	);
	if (!patched.includes("\tlet contextOverflow = false;")) {
		patched = patched.replace(
			"\tlet actualLaunchContractDigest = step.launchContractDigest;",
			"\tlet actualLaunchContractDigest = step.launchContractDigest;\n\tlet contextOverflow = false;",
		);
	}
	const retryOriginal =
		"\t\tif (!isRetryableModelFailure(error) || modelIndex === candidates.length - 1) break modelAttemptsLoop;";
	const retryReplacement = [
		"\t\tif (isContextOverflow(error)) {",
		"\t\t\tcontextOverflow = true;",
		"\t\t\tattemptNotes.push(`[fallback] ${attempt.model} failed: context overflow — reduce the task input or use a larger context window.`);",
		"\t\t\tbreak modelAttemptsLoop;",
		"\t\t}",
		retryOriginal,
	].join("\n");
	if (!patched.includes("\t\t\tcontextOverflow = true;")) {
		patched = patched.replace(retryOriginal, retryReplacement);
	}
	patched = replaceAll(
		patched,
		"\t\tmodelAttempts,\n\t\ttotalCost: costSummaryFromAttempts(modelAttempts),",
		"\t\tmodelAttempts,\n\t\tcontextOverflow: contextOverflow || undefined,\n\t\ttotalCost: costSummaryFromAttempts(modelAttempts),",
	);
	const lines = patched.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const match = lines[index].match(
			/^(\s*)(statusPayload\.steps\[[^\n]+)\.modelAttempts = singleResult\.modelAttempts;$/,
		);
		if (!match) continue;
		const contextLine =
			`${match[1]}${match[2]}.contextOverflow = singleResult.contextOverflow;`;
		if (lines[index + 1] !== contextLine) lines.splice(index + 1, 0, contextLine);
	}
	patched = lines.join("\n");
	for (const name of ["pr", "singleResult", "r"]) {
		patched = addLineAfter(
			patched,
			`modelAttempts: ${name}.modelAttempts,`,
			`contextOverflow: ${name}.contextOverflow,`,
		);
	}
	return patched;
}

function patchSharedTypes(source) {
	return addLineAfter(
		source,
		"modelAttempts?: ModelAttempt[];",
		"contextOverflow?: boolean;",
	);
}

function patchChainRootAttachment(source) {
	let patched = addLineAfter(
		source,
		"modelAttempts?: ModelAttempt[];",
		"contextOverflow?: boolean;",
	);
	patched = addLineAfter(
		patched,
		"...(step?.modelAttempts ? { modelAttempts: step.modelAttempts } : {}),",
		"...(step?.contextOverflow ? { contextOverflow: true } : {}),",
	);
	patched = addLineAfter(
		patched,
		"...(child?.modelAttempts ?? step?.modelAttempts ? { modelAttempts: child?.modelAttempts ?? step?.modelAttempts } : {}),",
		"...(child?.contextOverflow || step?.contextOverflow ? { contextOverflow: true } : {}),",
	);
	return patched;
}

function patchStaleRunReconciler(source) {
	let patched = addLineAfter(
		source,
		'modelAttempts?: NonNullable<AsyncStatus["steps"]>[number]["modelAttempts"];',
		"contextOverflow?: boolean;",
	);
	patched = addLineAfter(
		patched,
		"modelAttempts: child?.modelAttempts ?? step.modelAttempts,",
		"contextOverflow: child?.contextOverflow ?? step.contextOverflow,",
	);
	patched = addLineAfter(
		patched,
		"modelAttempts: step.modelAttempts,",
		"contextOverflow: step.contextOverflow,",
	);
	return patched;
}

function patchAsyncStatus(source) {
	let patched = addLineAfter(
		source,
		"attemptedModels?: string[];",
		"contextOverflow?: boolean;",
	);
	patched = addLineAfter(
		patched,
		"...(step.attemptedModels ? { attemptedModels: step.attemptedModels } : {}),",
		"...(step.contextOverflow ? { contextOverflow: true } : {}),",
	);
	return patched;
}

function patchParallelFailureResult(source) {
	const marker = "...(ok === 0 ? { isError: true } : {}),";
	if (source.includes(marker)) return source;
	const original = [
		"\t\treturn {",
		"\t\t\tcontent: [{ type: \"text\", text: fullContent }],",
		"\t\t\tdetails,",
		"\t\t};",
	].join("\n");
	const replacement = [
		"\t\treturn {",
		"\t\t\tcontent: [{ type: \"text\", text: fullContent }],",
		`\t\t\t${marker}`,
		"\t\t\tdetails,",
		"\t\t};",
	].join("\n");
	return source.replace(original, replacement);
}

function patchPublicToolBoundary(relativePath, source) {
	let patched = source;
	if (relativePath === "src/extension/index.ts") {
		patched = addAfter(
			patched,
			'export { loadConfig } from "./config.ts";\n',
			FINALIZE_TOOL_RESULT_HELPER,
		);
		patched = patched.replace(
			[
				"\t\texecute(id, params, signal, onUpdate, ctx) {",
				"\t\t\treturn executeSubagentCollapsed(id, params, signal, onUpdate, ctx);",
				"\t\t},",
			].join("\n"),
			[
				"\t\tasync execute(id, params, signal, onUpdate, ctx) {",
				"\t\t\treturn finalizeToolResult(await executeSubagentCollapsed(id, params, signal, onUpdate, ctx));",
				"\t\t},",
			].join("\n"),
		);
	}
	if (relativePath === "src/extension/fanout-child.ts") {
		patched = addAfter(
			patched,
			'import { type Details, type SubagentState } from "../shared/types.ts";\n',
			FINALIZE_TOOL_RESULT_HELPER,
		);
		patched = patched.replace(
			[
				"\t\texecute(id, params, signal, onUpdate, ctx) {",
				"\t\t\treturn executor.execute(id, params as SubagentParamsLike, signal, onUpdate, ctx);",
				"\t\t},",
			].join("\n"),
			[
				"\t\tasync execute(id, params, signal, onUpdate, ctx) {",
				"\t\t\treturn finalizeToolResult(await executor.execute(id, params as SubagentParamsLike, signal, onUpdate, ctx));",
				"\t\t},",
			].join("\n"),
		);
	}
	if (relativePath === "src/runs/background/wait-tool.ts") {
		patched = addAfter(
			patched,
			'import { resolveWaitToolConfig, waitForSubagents } from "./subagent-wait.ts";\n',
			FINALIZE_TOOL_RESULT_HELPER,
		);
		patched = patched.replace(
			[
				"\t\texecute(_id, params, signal, onUpdate) {",
				"\t\t\treturn waitForSubagents(params, signal, { state, events: pi.events, enabled, onUpdate });",
				"\t\t},",
			].join("\n"),
			[
				"\t\tasync execute(_id, params, signal, onUpdate) {",
				"\t\t\treturn finalizeToolResult(await waitForSubagents(params, signal, { state, events: pi.events, enabled, onUpdate }));",
				"\t\t},",
			].join("\n"),
		);
	}
	return patched;
}

export function patchPiSubagentsCorrectness(relativePath, source) {
	let patched = patchPublicToolBoundary(relativePath, source);
	if (relativePath === "src/runs/shared/model-fallback.ts") {
		patched = patchModelFallback(patched);
	} else if (relativePath === "src/runs/foreground/execution.ts") {
		patched = patchForegroundExecution(patched);
	} else if (relativePath === "src/runs/background/subagent-runner.ts") {
		patched = patchBackgroundRunner(patched);
	} else if (relativePath === "src/shared/types.ts") {
		patched = patchSharedTypes(patched);
	} else if (relativePath === "src/runs/background/chain-root-attachment.ts") {
		patched = patchChainRootAttachment(patched);
	} else if (relativePath === "src/runs/background/stale-run-reconciler.ts") {
		patched = patchStaleRunReconciler(patched);
	} else if (relativePath === "src/runs/background/async-status.ts") {
		patched = patchAsyncStatus(patched);
	} else if (relativePath === "src/runs/foreground/subagent-executor.ts") {
		patched = patchParallelFailureResult(patched);
	}
	return patched;
}
