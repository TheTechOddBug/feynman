import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256,
	patchPiWebAccessWindowsCookiesSource,
} from "./pi-web-access-windows-cookies-patch.mjs";

// Remove these forward files when the next pi-web-access release contains
// upstream commits 048700a8ae0da307d3891bfdbc3e54847a0a8635 and
// ad5f0ca66ef6658c7efa3f12fd0cb9b206f490f6.
export const PI_WEB_ACCESS_FORWARD_FILE_TARGETS = [
	"data-uri-sanitize.ts",
];

const PI_WEB_ACCESS_DATA_URI_SANITIZER_SHA256 =
	"2f63c0b0b5009eb9b92ca27d041707c3f7d0d0042ea0ee8a921ad0813f332ec0";

function countOccurrences(source, marker) {
	return source.split(marker).length - 1;
}

function requireMarkerCounts(source, relativePath, expectations, surface, version) {
	for (const [marker, expectedCount] of expectations) {
		const actualCount = countOccurrences(source, marker);
		if (actualCount !== expectedCount) {
			throw new Error(
				`Unsupported pi-web-access ${version} ${surface} ${relativePath}: expected ${expectedCount} occurrences of ${marker}, found ${actualCount}`,
			);
		}
	}
}

function rejectMarkers(source, relativePath, markers, surface, version) {
	for (const marker of markers) {
		if (source.includes(marker)) {
			throw new Error(
				`Unsupported pi-web-access ${version} ${surface} ${relativePath}: stale ${marker}`,
			);
		}
	}
}

export function assertPiWebAccessForwardFixSources(sources, surface, version) {
	for (const relativePath of [
		"index.ts",
		"extract.ts",
		"firecrawl.ts",
		"ssrf-protection.ts",
		...PI_WEB_ACCESS_FORWARD_FILE_TARGETS,
	]) {
		if (!sources.has(relativePath)) {
			throw new Error(`Unsupported pi-web-access ${version} ${surface}: missing ${relativePath}`);
		}
	}

	const indexSource = sources.get("index.ts");
	requireMarkerCounts(indexSource, "index.ts", [
		['import { execFileSync, spawn } from "node:child_process";', 1],
		['const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });', 1],
		["const timer = setTimeout(resolve, 100);", 1],
		["child.unref();", 1],
	], surface, version);
	rejectMarkers(indexSource, "index.ts", [
		'import { execFileSync } from "node:child_process";',
		'await pi.exec("xdg-open", [url])',
	], surface, version);

	const extractSource = sources.get("extract.ts");
	requireMarkerCounts(extractSource, "extract.ts", [
		['import { sanitizeInlineDataUris } from "./data-uri-sanitize.ts";', 1],
		['if (options?.mode === "raw") return results;', 1],
		['const sanitized = sanitizeInlineDataUris(result.content, `urls[${index}].content`);', 1],
	], surface, version);
	rejectMarkers(
		extractSource,
		"extract.ts",
		['return Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));'],
		surface,
		version,
	);

	const firecrawlSource = sources.get("firecrawl.ts");
	requireMarkerCounts(firecrawlSource, "firecrawl.ts", [
		['import net from "node:net";', 1],
		["function isLoopbackApiUrl(url: URL): boolean {", 1],
		["function firecrawlApiSsrfOptions(", 1],
		["const loopbackApiOrigin = isLoopbackApiUrl(initialUrl) ? initialUrl.origin : null;", 1],
		["firecrawlApiSsrfOptions(options, loopbackApiOrigin !== null)", 1],
		["firecrawlApiSsrfOptions(options, redirectUrl.origin === loopbackApiOrigin)", 1],
	], surface, version);
	rejectMarkers(firecrawlSource, "firecrawl.ts", [
		"const allowLoopback = isLoopbackApiUrl(new URL(url));",
		"firecrawlApiSsrfOptions(options, allowLoopback)",
		"let current = await validateRemoteUrl(url, ssrfOptions(options));",
		"const next = await validateRemoteUrl(new URL(location, current), ssrfOptions(options));",
	], surface, version);

	const ssrfSource = sources.get("ssrf-protection.ts");
	requireMarkerCounts(ssrfSource, "ssrf-protection.ts", [
		['const LOOPBACK_ALLOW_RANGES = ["127.0.0.0/8", "::1", "::ffff:127.0.0.0/104"];', 1],
		["allowLoopback?: boolean;", 1],
		['if (hostname === "localhost") {', 1],
		["if (options.allowLoopback === true) return url;", 1],
		["const addressAllowRanges = options.allowLoopback === true", 1],
	], surface, version);
	rejectMarkers(
		ssrfSource,
		"ssrf-protection.ts",
		['if (hostname === "localhost" || hostname.endsWith(".localhost")) {'],
		surface,
		version,
	);

	const chromeCookiesSource = sources.get("chrome-cookies.ts");
	const chromeCookiesDigest = createHash("sha256")
		.update(chromeCookiesSource.replace(/\r\n/g, "\n"))
		.digest("hex");
	if (chromeCookiesDigest !== PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) {
		throw new Error(
			`Unsupported pi-web-access ${version} ${surface} chrome-cookies.ts: expected ${PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256}, found ${chromeCookiesDigest}`,
		);
	}
	requireMarkerCounts(chromeCookiesSource, "chrome-cookies.ts", [
		['const WINDOWS_BROWSER_CONFIGS: BrowserConfig[] = [', 1],
		['{ name: "Chrome", baseDir: "Google/Chrome/User Data", usesLocalAppData: true }', 1],
		['{ name: "Edge", baseDir: "Microsoft/Edge/User Data", usesLocalAppData: true }', 1],
		['const networkCookies = join(profilePath, "Network", "Cookies");', 1],
		["function decryptWindowsCookieValue(", 1],
		['encrypted.subarray(0, 3).toString("utf8") === "v20"', 1],
		["async function readWindowsEncryptionKey(", 1],
		["Add-Type -AssemblyName System.Security", 1],
		["[Console]::In.ReadToEnd()", 1],
		['execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]', 1],
		['child.stdin.end(protectedData.toString("base64"))', 1],
	], surface, version);
	rejectMarkers(chromeCookiesSource, "chrome-cookies.ts", [
		'currentPlatform === "darwin" ? MACOS_BROWSER_CONFIGS : currentPlatform === "linux" ? LINUX_BROWSER_CONFIGS : []',
	], surface, version);

	const sanitizerSource = sources.get("data-uri-sanitize.ts");
	const sanitizerDigest = createHash("sha256")
		.update(sanitizerSource.replace(/\r\n/g, "\n"))
		.digest("hex");
	if (sanitizerDigest !== PI_WEB_ACCESS_DATA_URI_SANITIZER_SHA256) {
		throw new Error(
			`Unsupported pi-web-access ${version} ${surface} data-uri-sanitize.ts: expected ${PI_WEB_ACCESS_DATA_URI_SANITIZER_SHA256}, found ${sanitizerDigest}`,
		);
	}
	requireMarkerCounts(sanitizerSource, "data-uri-sanitize.ts", [
		["export function sanitizeInlineDataUris(", 1],
		["retrieval: \"not-retained\";", 1],
		["MAX_DATA_URI_HEADER_CHARS = 1024", 1],
	], surface, version);
}

const EXTRACT_DATA_URI_IMPORT =
	'import { sanitizeInlineDataUris } from "./data-uri-sanitize.ts";';
const EXTRACT_DATA_URI_IMPORT_ANCHOR =
	'import { getBrowserCookiesForHosts, getLastBrowserCookieDiagnostic } from "./chrome-cookies.ts";';
const EXTRACT_FETCH_ALL_ORIGINAL = [
	"export async function fetchAllContent(",
	"\turls: string[],",
	"\tsignal?: AbortSignal,",
	"\toptions?: ExtractOptions,",
	"): Promise<ExtractedContent[]> {",
	"\treturn Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));",
	"}",
].join("\n");
const EXTRACT_FETCH_ALL_PATCHED = [
	"export async function fetchAllContent(",
	"\turls: string[],",
	"\tsignal?: AbortSignal,",
	"\toptions?: ExtractOptions,",
	"): Promise<ExtractedContent[]> {",
	"\tconst results = await Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));",
	'\tif (options?.mode === "raw") return results;',
	"\t// Inline data: URIs in extracted markdown would otherwise flow into tool",
	"\t// results and the fetch cache as opaque base64; typed thumbnail/frame image",
	"\t// blocks are deliberate outputs and are left untouched.",
	"\treturn results.map((result, index) => {",
	"\t\tif (!result.content) return result;",
	"\t\tconst sanitized = sanitizeInlineDataUris(result.content, `urls[${index}].content`);",
	"\t\treturn sanitized.omissions.length > 0 ? { ...result, content: sanitized.text } : result;",
	"\t});",
	"}",
].join("\n");

function patchInlineDataUriSource(source) {
	let patched = source;
	if (!patched.includes(EXTRACT_DATA_URI_IMPORT) && patched.includes(EXTRACT_DATA_URI_IMPORT_ANCHOR)) {
		patched = patched.replace(
			EXTRACT_DATA_URI_IMPORT_ANCHOR,
			`${EXTRACT_DATA_URI_IMPORT_ANCHOR}\n${EXTRACT_DATA_URI_IMPORT}`,
		);
	}
	return patched.replace(EXTRACT_FETCH_ALL_ORIGINAL, EXTRACT_FETCH_ALL_PATCHED);
}

const INDEX_CHILD_PROCESS_IMPORT_ORIGINAL =
	'import { execFileSync } from "node:child_process";';
const INDEX_CHILD_PROCESS_IMPORT_PATCHED =
	'import { execFileSync, spawn } from "node:child_process";';
const INDEX_OPEN_BROWSER_ORIGINAL = [
	"async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {",
	"\tconst plat = platform();",
	'\tconst result = plat === "darwin"',
	'\t\t? await pi.exec("open", [url])',
	'\t\t: plat === "win32"',
	'\t\t\t? await pi.exec("cmd", ["/c", "start", "", url])',
	'\t\t\t: await pi.exec("xdg-open", [url]);',
	"\tif (result.code !== 0) {",
	"\t\tthrow new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);",
	"\t}",
	"}",
].join("\n");
const INDEX_OPEN_BROWSER_PATCHED = [
	"async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {",
	"\tconst plat = platform();",
	'\tif (plat !== "darwin" && plat !== "win32") {',
	"\t\tawait new Promise<void>((resolve, reject) => {",
	'\t\t\tconst child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });',
	"\t\t\tconst timer = setTimeout(resolve, 100);",
	'\t\t\tchild.once("error", (err) => {',
	"\t\t\t\tclearTimeout(timer);",
	"\t\t\t\treject(err);",
	"\t\t\t});",
	'\t\t\tchild.once("exit", (code) => {',
	"\t\t\t\tclearTimeout(timer);",
	'\t\t\t\tif (code === 0) resolve();',
	'\t\t\t\telse reject(new Error(`Failed to open browser (exit code ${code ?? "unknown"})`));',
	"\t\t\t});",
	"\t\t\tchild.unref();",
	"\t\t});",
	"\t\treturn;",
	"\t}",
	'\tconst result = plat === "darwin"',
	'\t\t? await pi.exec("open", [url])',
	'\t\t: await pi.exec("cmd", ["/c", "start", "", url]);',
	"\tif (result.code !== 0) {",
	"\t\tthrow new Error(result.stderr || `Failed to open browser (exit code ${result.code})`);",
	"\t}",
	"}",
].join("\n");

function patchLinuxBrowserLaunchSource(source) {
	return source
		.replace(INDEX_CHILD_PROCESS_IMPORT_ORIGINAL, INDEX_CHILD_PROCESS_IMPORT_PATCHED)
		.replace(INDEX_OPEN_BROWSER_ORIGINAL, INDEX_OPEN_BROWSER_PATCHED);
}

const FIRECRAWL_LOOPBACK_HELPERS = [
	"function isLoopbackApiUrl(url: URL): boolean {",
	'\tconst hostname = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "").replace(/\\.$/, "");',
	'\tif (hostname === "localhost" || hostname === "::1") return true;',
	"\tif (net.isIP(hostname) !== 4) return false;",
	'\treturn hostname.split(".")[0] === "127";',
	"}",
	"",
	"function firecrawlApiSsrfOptions(",
	"\toptions: FirecrawlExtractOptions | FirecrawlSearchOptions | undefined,",
	"\tallowLoopback: boolean,",
	"): ReturnType<typeof ssrfOptions> & { allowLoopback: boolean } {",
	"\treturn { ...ssrfOptions(options), allowLoopback };",
	"}",
	"",
].join("\n");

function patchFirecrawlLoopbackSource(source) {
	let patched = source;
	const fsImport = 'import { existsSync, readFileSync } from "node:fs";';
	if (!patched.includes('import net from "node:net";') && patched.includes(fsImport)) {
		patched = patched.replace(fsImport, `${fsImport}\nimport net from "node:net";`);
	}
	const helperAnchor =
		"function withoutSensitiveHeaders(headers: Record<string, string>): Record<string, string> {";
	if (!patched.includes("function isLoopbackApiUrl(") && patched.includes(helperAnchor)) {
		patched = patched.replace(helperAnchor, `${FIRECRAWL_LOOPBACK_HELPERS}${helperAnchor}`);
	}
	return patched
		.replace(
			[
				"const allowLoopback = isLoopbackApiUrl(new URL(url));",
				"let current = await validateRemoteUrl(url, firecrawlApiSsrfOptions(options, allowLoopback));",
			].join("\n"),
			[
				"const initialUrl = new URL(url);",
				"const loopbackApiOrigin = isLoopbackApiUrl(initialUrl) ? initialUrl.origin : null;",
				"let current = await validateRemoteUrl(initialUrl, firecrawlApiSsrfOptions(options, loopbackApiOrigin !== null));",
			].join("\n"),
		)
		.replace(
			"let current = await validateRemoteUrl(url, ssrfOptions(options));",
			[
				"const initialUrl = new URL(url);",
				"const loopbackApiOrigin = isLoopbackApiUrl(initialUrl) ? initialUrl.origin : null;",
				"let current = await validateRemoteUrl(initialUrl, firecrawlApiSsrfOptions(options, loopbackApiOrigin !== null));",
			].join("\n"),
		)
		.replace(
			"const next = await validateRemoteUrl(new URL(location, current), firecrawlApiSsrfOptions(options, allowLoopback));",
			[
				"const redirectUrl = new URL(location, current);",
				"const next = await validateRemoteUrl(",
				"\tredirectUrl,",
				"\tfirecrawlApiSsrfOptions(options, redirectUrl.origin === loopbackApiOrigin),",
				");",
			].join("\n"),
		)
		.replace(
			"const next = await validateRemoteUrl(new URL(location, current), ssrfOptions(options));",
			[
				"const redirectUrl = new URL(location, current);",
				"const next = await validateRemoteUrl(",
				"\tredirectUrl,",
				"\tfirecrawlApiSsrfOptions(options, redirectUrl.origin === loopbackApiOrigin),",
				");",
			].join("\n"),
		);
}

const SSRF_LOOPBACK_RANGES =
	'const LOOPBACK_ALLOW_RANGES = ["127.0.0.0/8", "::1", "::ffff:127.0.0.0/104"];';
const SSRF_LOCALHOST_ORIGINAL = [
	'\tif (hostname === "localhost" || hostname.endsWith(".localhost")) {',
	"\t\tthrow new Error(`Blocked internal hostname: ${hostname}`);",
	"\t}",
].join("\n");
const SSRF_LOCALHOST_PATCHED = [
	'\tif (hostname === "localhost") {',
	"\t\tif (options.allowLoopback === true) return url;",
	"\t\tthrow new Error(`Blocked internal hostname: ${hostname}`);",
	"\t}",
	'\tif (hostname.endsWith(".localhost")) {',
	"\t\tthrow new Error(`Blocked internal hostname: ${hostname}`);",
	"\t}",
].join("\n");
const SSRF_LITERAL_IP_ORIGINAL = [
	"\tif (net.isIP(hostname)) {",
	"\t\tassertPublicAddress(hostname, hostname, allowRanges);",
	"\t\treturn url;",
	"\t}",
].join("\n");
const SSRF_LITERAL_IP_PATCHED = [
	"\tif (net.isIP(hostname)) {",
	"\t\tconst addressAllowRanges = options.allowLoopback === true",
	"\t\t\t? [...allowRanges, ...parseAllowRanges(LOOPBACK_ALLOW_RANGES)]",
	"\t\t\t: allowRanges;",
	"\t\tassertPublicAddress(hostname, hostname, addressAllowRanges);",
	"\t\treturn url;",
	"\t}",
].join("\n");

function patchSsrfLoopbackSource(source) {
	let patched = source;
	const redirectStatuses = "const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);";
	if (!patched.includes(SSRF_LOOPBACK_RANGES) && patched.includes(redirectStatuses)) {
		patched = patched.replace(
			redirectStatuses,
			`${redirectStatuses}\n${SSRF_LOOPBACK_RANGES}`,
		);
	}
	const trustOption = "\ttrustEnvProxy?: boolean;";
	if (!patched.includes("\tallowLoopback?: boolean;") && patched.includes(trustOption)) {
		patched = patched.replace(
			trustOption,
			[
				trustOption,
				"\t/** Allow loopback URLs for explicit provider base endpoints, not fetched targets. */",
				"\tallowLoopback?: boolean;",
			].join("\n"),
		);
	}
	return patched
		.replace(SSRF_LOCALHOST_ORIGINAL, SSRF_LOCALHOST_PATCHED)
		.replace(SSRF_LITERAL_IP_ORIGINAL, SSRF_LITERAL_IP_PATCHED);
}

export function patchPiWebAccessForwardFixSource(relativePath, source) {
	if (relativePath === "chrome-cookies.ts") {
		return patchPiWebAccessWindowsCookiesSource(source);
	}
	if (relativePath === "index.ts") return patchLinuxBrowserLaunchSource(source);
	if (relativePath === "extract.ts") return patchInlineDataUriSource(source);
	if (relativePath === "firecrawl.ts") return patchFirecrawlLoopbackSource(source);
	if (relativePath === "ssrf-protection.ts") return patchSsrfLoopbackSource(source);
	return source;
}

export function syncPiWebAccessForwardFiles(appRoot, packageRoot, version) {
	let changed = false;
	for (const relativePath of PI_WEB_ACCESS_FORWARD_FILE_TARGETS) {
		const fixturePath = resolve(appRoot, "fixtures", `pi-web-access-${version}`, relativePath);
		if (!existsSync(fixturePath)) {
			throw new Error(`pi-web-access forward fixture is missing: ${relativePath}`);
		}
		const entryPath = resolve(packageRoot, relativePath);
		const fixtureSource = readFileSync(fixturePath, "utf8");
		if (!existsSync(entryPath) || readFileSync(entryPath, "utf8") !== fixtureSource) {
			writeFileSync(entryPath, fixtureSource, "utf8");
			changed = true;
		}
	}
	return changed;
}
