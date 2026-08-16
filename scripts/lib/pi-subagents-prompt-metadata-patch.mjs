export const PI_SUBAGENTS_PROMPT_METADATA_UPSTREAM_FIX =
	"https://github.com/nicobailon/pi-subagents/commit/27784eed57dd62021a7add4990ac2dada6690baa";
export const PI_SUBAGENTS_PROMPT_METADATA_PATCH_MARKER =
	"feynman-pi-subagents-prompt-metadata-v1";

const PATCH_MARKER = PI_SUBAGENTS_PROMPT_METADATA_PATCH_MARKER;

function replaceRequired(source, original, replacement, label) {
	if (!source.includes(original)) {
		throw new Error(`Cannot apply ${PATCH_MARKER}: missing ${label}.`);
	}
	return source.replace(original, replacement);
}

function patchToolDescription(source) {
	if (source.includes(PATCH_MARKER)) {
		return source;
	}

	let patched = replaceRequired(
		source,
		[
			'const CUSTOM_TOOL_DESCRIPTION_FILE = "subagent-tool-description.md";',
			"const CUSTOM_TOOL_DESCRIPTION_MAX_BYTES = 50 * 1024;",
		].join("\n"),
		[
			'const CUSTOM_TOOL_DESCRIPTION_FILE = "subagent-tool-description.md";',
			"const CUSTOM_TOOL_DESCRIPTION_MAX_BYTES = 50 * 1024;",
			`const FEYNMAN_PROMPT_METADATA_PATCH = "${PATCH_MARKER}";`,
			"",
			"export const DEFAULT_SUBAGENT_TOOL_DESCRIPTION = `Delegate to configured research subagents. Omit action and use { agent, task? } for one child, { tasks } for parallel work, or { chain } for a sequence. Use action only for management and control. Call { action: \"list\" } before execution. Use the pi-subagents skill for advanced workflows.`;",
			"",
			"export const SUBAGENT_TOOL_PROMPT_SNIPPET = \"Delegate research work to configured subagents.\";",
			"",
			"export const SUBAGENT_TOOL_PROMPT_GUIDELINES = [",
			'\t"Use subagent only when delegation helps the current task. Call { action: \\"list\\" } first and run only executable, non-disabled agents or chains.",',
			'\t"Omit action for subagent execution. Use { agent, task? } for one child, { tasks } for parallel work, or { chain } for sequential work.",',
			'\t"For subagent async work, continue useful work or return control. Use subagent_wait only when the current turn must receive the result.",',
			'\t"Keep one subagent writer per cwd or worktree. Use fresh read-only reviewers, then let the parent synthesize and apply fixes.",',
			'\t"Ordinary subagent children do not delegate. Use the pi-subagents skill for advanced execution, control, and safety details.",',
			"];",
		].join("\n"),
		"tool-description constants",
	);

	patched = replaceRequired(
		patched,
		[
			"export interface ToolDescriptionOptions {",
			"\tcwd?: string;",
			"\tagentDir?: string;",
			"\twarn?: (message: string) => void;",
			"}",
			"",
			"export function resolveToolDescriptionMode(",
		].join("\n"),
		[
			"export interface ToolDescriptionOptions {",
			"\tcwd?: string;",
			"\tagentDir?: string;",
			"\twarn?: (message: string) => void;",
			"}",
			"",
			"export interface SubagentToolPromptMetadata {",
			"\tpromptSnippet?: string;",
			"\tpromptGuidelines?: string[];",
			"}",
			"",
			'export function buildSubagentToolPromptMetadata(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}): SubagentToolPromptMetadata {',
			"\tif (config.toolDescriptionMode !== undefined) return {};",
			"\treturn {",
			"\t\tpromptSnippet: SUBAGENT_TOOL_PROMPT_SNIPPET,",
			"\t\tpromptGuidelines: SUBAGENT_TOOL_PROMPT_GUIDELINES,",
			"\t};",
			"}",
			"",
			"export function resolveToolDescriptionMode(",
		].join("\n"),
		"prompt metadata builder",
	);

	patched = replaceRequired(
		patched,
		[
			'export function buildSubagentToolDescription(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}, options?: ToolDescriptionOptions): string {',
			"\tconst mode = resolveToolDescriptionMode(config, options);",
		].join("\n"),
		[
			'export function buildSubagentToolDescription(config: Pick<ExtensionConfig, "toolDescriptionMode"> = {}, options?: ToolDescriptionOptions): string {',
			"\tif (config.toolDescriptionMode === undefined) return DEFAULT_SUBAGENT_TOOL_DESCRIPTION;",
			"\tconst mode = resolveToolDescriptionMode(config, options);",
		].join("\n"),
		"default split-metadata description",
	);

	return patched;
}

function patchExtensionIndex(source) {
	if (source.includes("...buildSubagentToolPromptMetadata(config),")) {
		return source;
	}
	if (!source.includes('import { buildSubagentToolDescription } from "./tool-description.ts";')) {
		return source;
	}
	let patched = replaceRequired(
		source,
		'import { buildSubagentToolDescription } from "./tool-description.ts";',
		'import { buildSubagentToolDescription, buildSubagentToolPromptMetadata } from "./tool-description.ts";',
		"extension prompt metadata import",
	);
	patched = replaceRequired(
		patched,
		[
			'\t\tdescription: buildSubagentToolDescription(config),',
			"\t\tparameters: SubagentParams,",
		].join("\n"),
		[
			'\t\tdescription: buildSubagentToolDescription(config),',
			"\t\t...buildSubagentToolPromptMetadata(config),",
			"\t\tparameters: SubagentParams,",
		].join("\n"),
		"extension prompt metadata registration",
	);
	return patched;
}

export function patchPiSubagentPromptMetadata(relativePath, source) {
	switch (relativePath) {
		case "src/extension/tool-description.ts":
			return patchToolDescription(source);
		case "src/extension/index.ts":
			return patchExtensionIndex(source);
		default:
			return source;
	}
}

const PI_SUBAGENTS_PROMPT_METADATA_REQUIREMENTS = Object.freeze([
	["src/extension/tool-description.ts", [
		PI_SUBAGENTS_PROMPT_METADATA_PATCH_MARKER,
		"export const DEFAULT_SUBAGENT_TOOL_DESCRIPTION",
		"export const SUBAGENT_TOOL_PROMPT_SNIPPET",
		"export const SUBAGENT_TOOL_PROMPT_GUIDELINES",
		"export function buildSubagentToolPromptMetadata(",
		"if (config.toolDescriptionMode === undefined) return DEFAULT_SUBAGENT_TOOL_DESCRIPTION;",
	]],
	["src/extension/index.ts", [
		"buildSubagentToolPromptMetadata",
		"...buildSubagentToolPromptMetadata(config),",
	]],
]);

export function assertPiSubagentPromptMetadataSources(readSource, label = "pi-subagents") {
	for (const [relativePath, markers] of PI_SUBAGENTS_PROMPT_METADATA_REQUIREMENTS) {
		const source = readSource(relativePath);
		if (typeof source !== "string") {
			throw new Error(`${label} is missing ${relativePath}`);
		}
		for (const marker of markers) {
			if (!source.includes(marker)) {
				throw new Error(`${label} ${relativePath} is missing required marker: ${marker}`);
			}
		}
	}
}
