import { createHash } from "node:crypto";

export const PI_SESSION_TAIL_PATCH_MARKER =
	"Feynman Pi 0.84.2 correctness patch: upstream #8345";
const PI_SESSION_TAIL_FUNCTION_START =
	"export function loadEntriesFromFile(filePath) {";
const PI_SESSION_TAIL_FUNCTION_END =
	"\n/**\n * Inspect a physical line while searching for the first parsed session entry.";
const PI_SESSION_TAIL_PATCHED_FUNCTION_SHA256 =
	"056801a48b9b4601e7011ca893c2a85cf417f576c3e50f6fc0a11c77411f8cac";

function countOccurrences(source, fragment) {
	return source.split(fragment).length - 1;
}

function replaceRequired(source, original, replacement, label) {
	if (countOccurrences(source, original) !== 1) {
		throw new Error(`Unsupported Pi 0.84.2 session tail repair layout: ${label}`);
	}
	return source.replace(original, replacement);
}

function extractLoadEntriesFromFile(source, surface) {
	const startIndex = source.indexOf(PI_SESSION_TAIL_FUNCTION_START);
	if (
		startIndex === -1 ||
		source.indexOf(
			PI_SESSION_TAIL_FUNCTION_START,
			startIndex + PI_SESSION_TAIL_FUNCTION_START.length,
		) !== -1
	) {
		throw new Error(
			`Incomplete Pi session tail repair ${surface}: expected one loadEntriesFromFile implementation`,
		);
	}
	const endIndex = source.indexOf(
		PI_SESSION_TAIL_FUNCTION_END,
		startIndex + PI_SESSION_TAIL_FUNCTION_START.length,
	);
	if (endIndex === -1) {
		throw new Error(
			`Incomplete Pi session tail repair ${surface}: missing loadEntriesFromFile boundary`,
		);
	}
	return source.slice(startIndex, endIndex);
}

export function assertPiSessionTailPatchedSource(
	source,
	surface = "Pi SessionManager",
) {
	if (countOccurrences(source, PI_SESSION_TAIL_PATCH_MARKER) !== 1) {
		throw new Error(
			`Incomplete Pi session tail repair ${surface}: expected one patch marker`,
		);
	}
	const functionSource = extractLoadEntriesFromFile(source, surface);
	const functionDigest = createHash("sha256")
		.update(functionSource)
		.digest("hex");
	if (functionDigest !== PI_SESSION_TAIL_PATCHED_FUNCTION_SHA256) {
		throw new Error(
			`Incomplete Pi session tail repair ${surface}: expected exact loadEntriesFromFile ${PI_SESSION_TAIL_PATCHED_FUNCTION_SHA256}, found ${functionDigest}`,
		);
	}
}

export function patchPiSessionTailSource(source) {
	if (source.includes(PI_SESSION_TAIL_PATCH_MARKER)) {
		assertPiSessionTailPatchedSource(source);
		return source;
	}

	let patched = replaceRequired(
		source,
		`    const entries = [];
    const fd = openSync(resolvedFilePath, "r");`,
		`    const entries = [];
    let pending = "";
    const fd = openSync(resolvedFilePath, "r");`,
		"pending tail ownership",
	);
	patched = replaceRequired(
		patched,
		`        const decoder = new StringDecoder("utf8");
        const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE);
        let pending = "";`,
		`        const decoder = new StringDecoder("utf8");
        const buffer = Buffer.allocUnsafe(SESSION_READ_BUFFER_SIZE);`,
		"pending tail scope",
	);
	patched = replaceRequired(
		patched,
		`    // Validate session header
    if (entries.length === 0)
        return entries;
    const header = entries[0];
    if (header.type !== "session" || typeof header.id !== "string") {
        return [];
    }
    return entries;`,
		`    // Validate session header before repairing the file.
    if (entries.length === 0)
        return entries;
    const header = entries[0];
    if (header.type !== "session" || typeof header.id !== "string") {
        return [];
    }
    // ${PI_SESSION_TAIL_PATCH_MARKER}. Remove after the bundled Pi release includes commit 0b5ee5d8.
    if (pending) appendFileSync(resolvedFilePath, "\\n");
    return entries;`,
		"unterminated tail repair",
	);
	assertPiSessionTailPatchedSource(patched);
	return patched;
}
