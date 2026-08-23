import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PI_CLI_ARGS_REQUIRED_VERSION = "0.84.2";
export const PI_CLI_ARGS_UPSTREAM_FIX =
	"https://github.com/earendil-works/pi/commit/74786a748f5314cc2127ebbcfa2d732e9b8433f5";
export const PI_CLI_ARGS_UPSTREAM_DOCS =
	"https://github.com/earendil-works/pi/commit/62bcbf6be0206cc4fd2ca0e35dd5eb879ca6c8e7";
// Remove this forward patch after the first supported Pi release containing
// the upstream parser fix above.

const PATCH_MARKER =
	"        // Feynman: support Pi's -- end-of-options delimiter for research prompts.";
const UNPATCHED_ANCHOR =
	'        if (arg === "--help" || arg === "-h") {';
const PATCHED_ANCHOR =
	'        else if (arg === "--help" || arg === "-h") {';
const PARSE_ARGS_DECLARATION = "export function parseArgs(args) {";
const LOOP_PREFIX = `    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
`;
const PATCH_BRANCH = `${PATCH_MARKER}
        if (arg === "--") {
            for (const positionalArg of args.slice(i + 1)) {
                if (positionalArg.startsWith("@")) {
                    result.fileArgs.push(positionalArg.slice(1));
                }
                else {
                    result.messages.push(positionalArg);
                }
            }
            break;
        }
${PATCHED_ANCHOR}`;

function countOccurrences(source, value) {
	return source.split(value).length - 1;
}

function requireCount(source, value, expected, label) {
	const actual = countOccurrences(source, value);
	if (actual !== expected) {
		throw new Error(
			`Unsupported Pi ${PI_CLI_ARGS_REQUIRED_VERSION} CLI args ${label}: expected ${expected} occurrences, found ${actual}`,
		);
	}
}

function createExecutableCodeMask(source) {
	const mask = new Uint8Array(source.length);
	let state = "code";
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		const next = source[index + 1];
		if (state === "code") {
			if (char === "/" && next === "/") {
				state = "line-comment";
				index += 1;
			} else if (char === "/" && next === "*") {
				state = "block-comment";
				index += 1;
			} else if (char === "'") {
				state = "single-quote";
			} else if (char === '"') {
				state = "double-quote";
			} else if (char === "`") {
				state = "template";
			} else {
				mask[index] = 1;
			}
		} else if (state === "line-comment") {
			if (char === "\n") {
				state = "code";
				mask[index] = 1;
			}
		} else if (state === "block-comment") {
			if (char === "*" && next === "/") {
				state = "code";
				index += 1;
			}
		} else if (char === "\\") {
			index += 1;
		} else if (
			(state === "single-quote" && char === "'")
			|| (state === "double-quote" && char === '"')
			|| (state === "template" && char === "`")
		) {
			state = "code";
		}
	}
	return mask;
}

function findParseArgsRange(source, executableCodeMask, label) {
	requireCount(
		source,
		PARSE_ARGS_DECLARATION,
		1,
		`${label} parseArgs declaration`,
	);
	const declarationIndex = source.indexOf(PARSE_ARGS_DECLARATION);
	if (executableCodeMask[declarationIndex] !== 1) {
		throw new Error(
			`Unsupported Pi ${PI_CLI_ARGS_REQUIRED_VERSION} CLI args ${label}: parseArgs declaration is not executable`,
		);
	}
	const openBraceIndex =
		declarationIndex + PARSE_ARGS_DECLARATION.length - 1;
	let depth = 0;
	for (let index = openBraceIndex; index < source.length; index += 1) {
		if (executableCodeMask[index] !== 1) continue;
		if (source[index] === "{") {
			depth += 1;
		} else if (source[index] === "}") {
			depth -= 1;
			if (depth === 0) {
				return {
					start: declarationIndex,
					end: index + 1,
				};
			}
		}
	}
	throw new Error(
		`Unsupported Pi ${PI_CLI_ARGS_REQUIRED_VERSION} CLI args ${label}: parseArgs body is incomplete`,
	);
}

export function assertPiCliArgsVersion(
	version,
	label = "pi-coding-agent",
) {
	if (version !== PI_CLI_ARGS_REQUIRED_VERSION) {
		throw new Error(
			`Pi CLI args patch requires ${PI_CLI_ARGS_REQUIRED_VERSION} for ${label}, found ${version ?? "missing"}`,
		);
	}
}

export function assertPiCliArgsPatchSource(source, label = "dist/cli/args.js") {
	const executableCodeMask = createExecutableCodeMask(source);
	const parseArgsRange = findParseArgsRange(
		source,
		executableCodeMask,
		label,
	);
	const parseArgsSource = source.slice(parseArgsRange.start, parseArgsRange.end);
	requireCount(source, PATCH_MARKER, 1, `${label} patch marker`);
	requireCount(source, PATCH_BRANCH, 1, `${label} exact ordered patch block`);
	requireCount(
		parseArgsSource,
		`${LOOP_PREFIX}${PATCH_BRANCH}`,
		1,
		`${label} exact parseArgs loop`,
	);
	requireCount(source, UNPATCHED_ANCHOR, 0, `${label} unpatched branch`);
	requireCount(source, PATCHED_ANCHOR, 1, `${label} patched help branch`);
	requireCount(
		source,
		'        if (arg === "--") {',
		1,
		`${label} delimiter branch`,
	);
	requireCount(
		source,
		"            for (const positionalArg of args.slice(i + 1)) {",
		1,
		`${label} remaining-argument loop`,
	);
	requireCount(
		source,
		'                if (positionalArg.startsWith("@")) {',
		1,
		`${label} file argument branch`,
	);
	requireCount(
		source,
		"                    result.fileArgs.push(positionalArg.slice(1));",
		1,
		`${label} file argument write`,
	);
	requireCount(
		source,
		"                    result.messages.push(positionalArg);",
		1,
		`${label} message write`,
	);
	const patchBranchIndex = source.indexOf(PATCH_BRANCH);
	const delimiterBranchIndex =
		patchBranchIndex + PATCH_BRANCH.indexOf('        if (arg === "--") {');
	if (
		delimiterBranchIndex < parseArgsRange.start
		|| delimiterBranchIndex >= parseArgsRange.end
		|| executableCodeMask[delimiterBranchIndex] !== 1
	) {
		throw new Error(
			`Unsupported Pi ${PI_CLI_ARGS_REQUIRED_VERSION} CLI args ${label}: delimiter branch is not executable inside parseArgs`,
		);
	}
}

export function patchPiCliArgsSource(source) {
	if (source.includes(PATCH_MARKER)) {
		assertPiCliArgsPatchSource(source);
		return source;
	}

	requireCount(source, UNPATCHED_ANCHOR, 1, "unpatched help branch");
	requireCount(source, PATCHED_ANCHOR, 0, "unexpected patched help branch");
	requireCount(source, '        if (arg === "--") {', 0, "unexpected delimiter branch");

	const patched = source.replace(UNPATCHED_ANCHOR, PATCH_BRANCH);
	assertPiCliArgsPatchSource(patched);
	return patched;
}

function readPiCliArgsPackageRoot(packageRoot, label) {
	const manifestPath = resolve(packageRoot, "package.json");
	const argsPath = resolve(packageRoot, "dist", "cli", "args.js");
	if (!existsSync(manifestPath) || !existsSync(argsPath)) {
		throw new Error(`Pi CLI args package is incomplete for ${label}: ${packageRoot}`);
	}
	assertPiCliArgsVersion(
		JSON.parse(readFileSync(manifestPath, "utf8")).version,
		label,
	);
	return { argsPath, source: readFileSync(argsPath, "utf8") };
}

export function preflightPiCliArgsPackageRoot(packageRoot, label) {
	if (!packageRoot || !existsSync(packageRoot)) return;
	const { source } = readPiCliArgsPackageRoot(packageRoot, label);
	patchPiCliArgsSource(source);
}

export function assertPatchedPiCliArgsPackageRoot(packageRoot, label) {
	const { argsPath, source } = readPiCliArgsPackageRoot(packageRoot, label);
	assertPiCliArgsPatchSource(source, `${label} ${argsPath}`);
}
