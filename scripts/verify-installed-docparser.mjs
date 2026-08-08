import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const VERIFICATION_PHRASE = "Feynman installed docparser verification phrase";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const defaultPackageRoot = resolve(import.meta.dirname, "..");

function isPathInside(path, root) {
	const relativePath = relative(root, path);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function escapePdfText(value) {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("(", "\\(")
		.replaceAll(")", "\\)");
}

export function createMinimalPdf(text = VERIFICATION_PHRASE) {
	const byteLength = (value) => Buffer.byteLength(value, "latin1");
	const content = [
		"BT",
		"/F1 18 Tf",
		"72 720 Td",
		`(${escapePdfText(text)}) Tj`,
		"ET",
		"",
	].join("\n");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${byteLength(content)} >>\nstream\n${content}endstream`,
	];
	let source = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
	const offsets = [0];
	for (let index = 0; index < objects.length; index += 1) {
		offsets.push(byteLength(source));
		source += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
	}
	const xrefOffset = byteLength(source);
	source += `xref\n0 ${objects.length + 1}\n`;
	source += "0000000000 65535 f \n";
	for (const offset of offsets.slice(1)) {
		source += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	source += [
		"trailer",
		`<< /Size ${objects.length + 1} /Root 1 0 R >>`,
		"startxref",
		String(xrefOffset),
		"%%EOF",
		"",
	].join("\n");
	return Buffer.from(source, "latin1");
}

export function resolveInstalledDocparserPaths(packageRoot = defaultPackageRoot) {
	const resolvedPackageRoot = realpathSync(resolve(packageRoot));
	const piRoot = resolve(
		resolvedPackageRoot,
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	const piRequire = createRequire(resolve(piRoot, "package.json"));
	const jitiEntryPath = realpathSync(piRequire.resolve("jiti"));
	const jitiManifestPath = realpathSync(piRequire.resolve("jiti/package.json"));
	const piNodeModulesRoot = resolve(piRoot, "node_modules");
	const packageNodeModulesRoot = resolve(resolvedPackageRoot, "node_modules");
	assert.ok(
		isPathInside(jitiEntryPath, piNodeModulesRoot) ||
			isPathInside(jitiEntryPath, packageNodeModulesRoot),
		`Pi resolved Jiti outside the installed package: ${jitiEntryPath}`,
	);

	const docparserRoot = resolve(
		resolvedPackageRoot,
		".feynman",
		"npm",
		"node_modules",
		"pi-docparser",
	);
	const extensionPath = resolve(docparserRoot, "extensions", "docparser", "index.ts");
	assert.ok(existsSync(extensionPath), `Installed pi-docparser extension is missing: ${extensionPath}`);
	return {
		packageRoot: resolvedPackageRoot,
		piRoot,
		jitiEntryPath,
		jitiManifestPath,
		docparserRoot,
		extensionPath,
	};
}

function findTool(tools, name) {
	const tool = tools.get(name);
	assert.ok(tool, `Installed pi-docparser did not register ${name}`);
	assert.equal(typeof tool.execute, "function", `${name} has no execute function`);
	return tool;
}

export function assertDocumentParseResult(result) {
	assert.equal(result?.details?.pageCount, 1, "document_parse did not parse exactly one page");
	assert.ok(
		typeof result.details.outputPath === "string" && statSync(result.details.outputPath).size > 0,
		"document_parse did not write a nonempty parsed artifact",
	);
	return result.details.outputDir;
}

export function assertDocumentSearchResult(result, phrase = VERIFICATION_PHRASE) {
	const hits = result?.details?.hits;
	assert.ok(Array.isArray(hits), "document_search returned no structured hit list");
	assert.ok(
		hits.some((hit) => hit?.pageNum === 1 && hit?.text === phrase),
		`document_search did not return the exact phrase on page 1: ${phrase}`,
	);
}

export function assertDocumentScreenshotResult(result) {
	const screenshots = result?.details?.screenshots;
	assert.equal(screenshots?.length, 1, "document_screenshot did not return exactly one page");
	const screenshot = screenshots[0];
	assert.equal(screenshot.pageNum, 1, "document_screenshot returned the wrong page");
	assert.ok(screenshot.bytes > 0, "document_screenshot reported an empty PNG");
	const png = readFileSync(screenshot.outputPath);
	assert.ok(png.byteLength > PNG_SIGNATURE.byteLength, "document_screenshot wrote an empty PNG");
	assert.deepEqual(
		png.subarray(0, PNG_SIGNATURE.byteLength),
		PNG_SIGNATURE,
		"document_screenshot output is not a PNG",
	);
	return result.details.outputDir;
}

export async function verifyInstalledDocparser(options = {}) {
	const paths = resolveInstalledDocparserPaths(options.packageRoot);
	const root = await mkdtemp(resolve(tmpdir(), "feynman-installed-docparser-"));
	const pdfPath = resolve(root, "verification.pdf");
	const tools = new Map();
	const shutdownHandlers = [];
	const outputDirs = new Set();
	const previousTempEnv = {
		TMPDIR: process.env.TMPDIR,
		TMP: process.env.TMP,
		TEMP: process.env.TEMP,
	};
	let verification;
	let primaryError;
	const cleanupErrors = [];

	try {
		process.env.TMPDIR = root;
		process.env.TMP = root;
		process.env.TEMP = root;
		writeFileSync(pdfPath, createMinimalPdf());
		const jitiModule = await import(pathToFileURL(paths.jitiEntryPath).href);
		assert.equal(typeof jitiModule.createJiti, "function", "Pi's installed Jiti has no createJiti");
		const jiti = jitiModule.createJiti(import.meta.url, { moduleCache: false });
		const extension = await jiti.import(
			process.platform === "win32"
				? pathToFileURL(paths.extensionPath).href
				: paths.extensionPath,
			{ default: true },
		);
		assert.equal(typeof extension, "function", "Installed pi-docparser extension has no factory");
		extension({
			on(event, handler) {
				if (event === "session_shutdown") shutdownHandlers.push(handler);
			},
			registerCommand() {},
			registerTool(tool) {
				assert.equal(tools.has(tool.name), false, `Duplicate installed tool: ${tool.name}`);
				tools.set(tool.name, tool);
			},
		});

		const context = { cwd: root };
		const parseResult = await findTool(tools, "document_parse").execute(
			"installed-docparser-parse",
			{ path: pdfPath, format: "json", ocr: "off", maxPages: 1 },
			undefined,
			undefined,
			context,
		);
		if (parseResult?.details?.outputDir) outputDirs.add(parseResult.details.outputDir);
		assertDocumentParseResult(parseResult);

		const searchResult = await findTool(tools, "document_search").execute(
			"installed-docparser-search",
			{
				path: pdfPath,
				phrase: VERIFICATION_PHRASE,
				ocr: "off",
				maxPages: 1,
				maxResults: 5,
			},
			undefined,
			undefined,
			context,
		);
		assertDocumentSearchResult(searchResult);

		const screenshotResult = await findTool(tools, "document_screenshot").execute(
			"installed-docparser-screenshot",
			{ path: pdfPath, pages: "1", dpi: 72 },
			undefined,
			undefined,
			context,
		);
		if (screenshotResult?.details?.outputDir) outputDirs.add(screenshotResult.details.outputDir);
		assertDocumentScreenshotResult(screenshotResult);

		const jitiManifest = JSON.parse(readFileSync(paths.jitiManifestPath, "utf8"));
		verification = {
			docparser: JSON.parse(
				readFileSync(resolve(paths.docparserRoot, "package.json"), "utf8"),
			).version,
			jiti: jitiManifest.version,
			pageCount: parseResult.details.pageCount,
			hits: searchResult.details.hits.length,
			pngBytes: screenshotResult.details.screenshots[0].bytes,
		};
	} catch (error) {
		primaryError = error;
	} finally {
		for (const handler of shutdownHandlers.reverse()) {
			try {
				await handler();
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		for (const [name, value] of Object.entries(previousTempEnv)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		for (const outputDir of outputDirs) {
			try {
				rmSync(outputDir, { recursive: true, force: true });
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		try {
			rmSync(root, { recursive: true, force: true });
		} catch (error) {
			cleanupErrors.push(error);
		}
	}
	if (primaryError && cleanupErrors.length > 0) {
		const aggregate = new AggregateError(
			[primaryError, ...cleanupErrors],
			`${primaryError instanceof Error ? primaryError.message : String(primaryError)}; installed pi-docparser cleanup also failed`,
		);
		aggregate.cause = primaryError;
		throw aggregate;
	}
	if (primaryError) throw primaryError;
	if (cleanupErrors.length > 0) {
		throw new AggregateError(cleanupErrors, "Installed pi-docparser cleanup failed");
	}
	return verification;
}

export function isDirectExecution(
	entryPath = process.argv[1],
	modulePath = fileURLToPath(import.meta.url),
) {
	if (!entryPath) return false;
	try {
		return realpathSync(entryPath) === realpathSync(modulePath);
	} catch {
		return resolve(entryPath) === resolve(modulePath);
	}
}

if (isDirectExecution()) {
	console.log(JSON.stringify(await verifyInstalledDocparser()));
}
