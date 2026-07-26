import assert from "node:assert/strict";
import test from "node:test";

import { patchMcpSdkPackageJsonSource } from "../scripts/lib/mcp-sdk-package-patch.mjs";

test("MCP SDK package patch carries the safe Hono node server into bundled consumers", () => {
	const source = JSON.stringify({
		name: "@modelcontextprotocol/sdk",
		version: "1.29.0",
		dependencies: {
			"@hono/node-server": "^1.19.9",
		},
	});

	const patched = JSON.parse(patchMcpSdkPackageJsonSource(source)) as {
		dependencies: Record<string, string>;
	};
	assert.equal(patched.dependencies["@hono/node-server"], "2.0.12");
});

test("MCP SDK package patch is idempotent and replaces unsafe lower 2.x ranges", () => {
	const safe = JSON.stringify({
		dependencies: {
			"@hono/node-server": "2.0.12",
		},
	});
	assert.equal(patchMcpSdkPackageJsonSource(safe), safe);
	for (const unsafe of ["2.0.0", "^2.0.0", "~2.0.4"]) {
		const patched = JSON.parse(patchMcpSdkPackageJsonSource(JSON.stringify({
			dependencies: { "@hono/node-server": unsafe },
		}))) as { dependencies: Record<string, string> };
		assert.equal(patched.dependencies["@hono/node-server"], "2.0.12");
	}
});

test("MCP SDK package patch fails closed on incompatible manifests", () => {
	assert.throws(
		() => patchMcpSdkPackageJsonSource(JSON.stringify({ dependencies: {} })),
		/no @hono\/node-server dependency/,
	);
	for (const unsupported of ["^1.20.0", "^2.1.0", "3.0.0", "workspace:*"]) {
		assert.throws(
			() => patchMcpSdkPackageJsonSource(JSON.stringify({
				dependencies: { "@hono/node-server": unsupported },
			})),
			/Unsupported .* @hono\/node-server dependency/,
		);
	}
});
