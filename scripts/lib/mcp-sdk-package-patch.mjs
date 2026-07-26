const SAFE_HONO_NODE_SERVER_VERSION = "2.0.12";

/**
 * MCP SDK 1.29.0 still declares @hono/node-server ^1.19.9 even though the
 * compatible v2 line contains the security fix required by Feynman's Node 22+
 * runtime. Feynman bundles this dependency tree so consumers receive the
 * tested override; remove this patch once MCP itself requires >=2.0.5.
 */
export function patchMcpSdkPackageJsonSource(source) {
	const manifest = JSON.parse(source);
	if (!manifest.dependencies || typeof manifest.dependencies !== "object") {
		throw new Error("@modelcontextprotocol/sdk package.json has no dependencies object");
	}

	const current = manifest.dependencies["@hono/node-server"];
	if (current === SAFE_HONO_NODE_SERVER_VERSION) {
		return source;
	}
	if (typeof current !== "string") {
		throw new Error("@modelcontextprotocol/sdk package.json has no @hono/node-server dependency");
	}
	const knownUnsafeRange =
		current === "^1.19.9" ||
		(() => {
			const match = /^[~^]?2\.0\.(\d+)$/.exec(current);
			return match !== null && Number.parseInt(match[1], 10) < 12;
		})();
	if (!knownUnsafeRange) {
		throw new Error(
			`Unsupported @modelcontextprotocol/sdk @hono/node-server dependency: ${current}`,
		);
	}

	manifest.dependencies["@hono/node-server"] = SAFE_HONO_NODE_SERVER_VERSION;
	return JSON.stringify(manifest, null, 2) + "\n";
}
