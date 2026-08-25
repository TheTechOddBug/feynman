import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	assertPiCodingAgentForwardFixSource,
	PI_CODING_AGENT_FORWARD_FIX_TARGETS,
	patchPiCodingAgentForwardFixSource,
} from "../scripts/lib/pi-runtime-correctness-patch.mjs";
import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
patchPiRuntimeNodeModules(appRoot);
const codingAgentRoot = resolve(
	appRoot,
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
);

test("coding-agent forward fixes are complete, fail-closed, and idempotent", () => {
	for (const relativePath of PI_CODING_AGENT_FORWARD_FIX_TARGETS) {
		const source = readFileSync(
			resolve(codingAgentRoot, ...relativePath.split("/")),
			"utf8",
		);
		assert.doesNotThrow(() =>
			assertPiCodingAgentForwardFixSource(relativePath, source, relativePath)
		);
		assert.equal(patchPiCodingAgentForwardFixSource(relativePath, source), source);
	}

	const toolExecution = readFileSync(
		resolve(
			codingAgentRoot,
			"dist",
			"modes",
			"interactive",
			"components",
			"tool-execution.js",
		),
		"utf8",
	);
	assert.throws(
		() =>
			assertPiCodingAgentForwardFixSource(
				"dist/modes/interactive/components/tool-execution.js",
				toolExecution.replace(
					"for (const line of contentLines)\n                    lines.push(line);",
					"lines.push(...contentLines);",
				),
			),
		/(missing for \(const line of contentLines\)|retained lines\.push\(\.\.\.contentLines\))/,
	);
});

test("large tool render appends content, spacer, and image lines without spreading", async () => {
	const modulePath = resolve(
		codingAgentRoot,
		"dist",
		"modes",
		"interactive",
		"components",
		"tool-execution.js",
	);
	const { ToolExecutionComponent } = await import(
		`${pathToFileURL(modulePath).href}?large-render=${Date.now()}`
	);
	const component = Object.create(ToolExecutionComponent.prototype) as {
		hideComponent: boolean;
		imageComponents: unknown[];
		imageSpacers: unknown[];
		selfRenderContainer: { render: () => string[] };
		hasRendererDefinition: () => boolean;
		getRenderShell: () => string;
		render: (width: number) => string[];
	};
	const contentLines = Array.from({ length: 200_000 }, (_, index) => `line-${index}`);
	const spacerLines = Array(150_000).fill("spacer");
	const imageLines = Array(150_000).fill("image");
	component.hideComponent = false;
	component.imageComponents = [{ render: () => imageLines }];
	component.imageSpacers = [{ render: () => spacerLines }];
	component.selfRenderContainer = { render: () => contentLines };
	component.hasRendererDefinition = () => true;
	component.getRenderShell = () => "self";

	const rendered = component.render(80);
	assert.equal(
		rendered.length,
		contentLines.length + spacerLines.length + imageLines.length + 1,
	);
	assert.equal(rendered[0], "");
	assert.equal(rendered[contentLines.length], contentLines.at(-1));
	assert.equal(rendered[contentLines.length + 1], "spacer");
	assert.equal(rendered[contentLines.length + spacerLines.length + 1], "image");
	assert.equal(rendered.at(-1), "image");
});

test("fd and rg release lookup uses GitHub's public redirect without API quota", async (t) => {
	const modulePath = resolve(codingAgentRoot, "dist", "utils", "tools-manager.js");
	const originalFetch = globalThis.fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
	});
	const requests: Array<{ url: string; redirect?: RequestRedirect }> = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		requests.push({ url: String(input), redirect: init?.redirect });
		return new Response(null, {
			status: 302,
			headers: { location: "/sharkdp/fd/releases/tag/v10.3.0" },
		});
	}) as typeof fetch;

	const toolsManager = (await import(
		`${pathToFileURL(modulePath).href}?release-redirect=${Date.now()}`
	)) as unknown as { getLatestVersion(repo: string): Promise<string> };
	assert.equal(await toolsManager.getLatestVersion("sharkdp/fd"), "10.3.0");
	assert.deepEqual(requests, [
		{ url: "https://github.com/sharkdp/fd/releases/latest", redirect: "manual" },
	]);

	globalThis.fetch = (async () =>
		new Response(null, {
			status: 302,
			headers: { location: "https://attacker.example/sharkdp/fd/releases/tag/v99" },
		})) as typeof fetch;
	await assert.rejects(
		toolsManager.getLatestVersion("sharkdp/fd"),
		/Unexpected GitHub release redirect/,
	);

	globalThis.fetch = (async () =>
		new Response(null, {
			status: 302,
			headers: { location: "https://github.com/sharkdp/fd/releases/tag/v10.4.2%2Fevil" },
		})) as typeof fetch;
	await assert.rejects(
		toolsManager.getLatestVersion("sharkdp/fd"),
		/Invalid GitHub release version/,
	);
});
