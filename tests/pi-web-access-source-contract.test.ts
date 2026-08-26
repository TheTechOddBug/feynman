import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
	assertPiWebAccessPatchedSources,
	PI_WEB_ACCESS_PATCH_TARGETS,
	patchPiWebAccessSources,
} from "../scripts/lib/pi-web-access-patch.mjs";

function reviewedSources(): Map<string, string> {
	return new Map(
		PI_WEB_ACCESS_PATCH_TARGETS.map((relativePath) => [
			relativePath,
			readFileSync(
				join(
					import.meta.dirname,
					"fixtures",
					"pi-web-access-0.25.0",
					`${relativePath}.fixture`,
				),
				"utf8",
			),
		]),
	);
}

test("pi-web-access source contract rejects marker-preserving fail-open drift", () => {
	const baseline = reviewedSources();
	const unreviewed = new Map(baseline);
	unreviewed.set(
		"utils.ts",
		(unreviewed.get("utils.ts") ?? "")
			.replace(
				"|| isProxyBypassedUrl(url)) {",
				"|| (false && isProxyBypassedUrl(url))) {",
			),
	);
	assert.throws(
		() => patchPiWebAccessSources(unreviewed, "fail-open baseline"),
		/unreviewed digest/,
	);

	const patched = patchPiWebAccessSources(baseline, "reviewed baseline");
	const disabled = new Map(patched);
	disabled.set(
		"firecrawl.ts",
		(disabled.get("firecrawl.ts") ?? "")
			.replace(
				"redirectUrl.origin === loopbackApiOrigin",
				"true || redirectUrl.origin === loopbackApiOrigin",
			),
	);
	assert.throws(
		() => assertPiWebAccessPatchedSources(disabled, "fail-open patched tree"),
		/expected .* found/,
	);
});

test("pi-web-access source contract covers every production file added or changed by 0.25.0", () => {
	for (const relativePath of [
		"credential-source.ts",
		"curator-page.ts",
		"curator-server.ts",
		"gemini-url-context.ts",
		"github-api.ts",
	]) {
		assert.ok(
			PI_WEB_ACCESS_PATCH_TARGETS.includes(relativePath),
			`${relativePath} is missing from the exact source contract`,
		);
		const mutated = reviewedSources();
		mutated.set(
			relativePath,
			`${mutated.get(relativePath) ?? ""}\n// unreviewed source drift\n`,
		);
		assert.throws(
			() => patchPiWebAccessSources(mutated, `unreviewed ${relativePath}`),
			new RegExp(`${relativePath.replace(".", "\\.")}: unreviewed digest`),
		);
	}
});

test("pi-web-access patched contract rejects disabled proxy and Windows ADC guards", () => {
	const patched = patchPiWebAccessSources(reviewedSources(), "reviewed baseline");
	for (const [relativePath, original, replacement] of [
		[
			"utils.ts",
			"for (const name of PROXY_ENV_NAMES) env[name] = proxy;",
			"if (false) for (const name of PROXY_ENV_NAMES) env[name] = proxy;",
		],
		[
			"github-issue-pr.ts",
			'...getProxyProcessEnv("https://github.com")',
			"...process.env",
		],
		[
			"gemini-adc.ts",
			'if (currentPlatform === "win32" && appData) {',
			'if (false && currentPlatform === "win32" && appData) {',
		],
	] as const) {
		const disabled = new Map(patched);
		const source = disabled.get(relativePath) ?? "";
		assert.ok(source.includes(original), `${relativePath} mutation anchor is missing`);
		disabled.set(relativePath, source.replace(original, replacement));
		assert.throws(
			() =>
				assertPiWebAccessPatchedSources(
					disabled,
					`disabled ${relativePath}`,
				),
			/expected .* found/,
		);
	}
});
