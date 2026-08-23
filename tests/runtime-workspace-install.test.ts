import assert from "node:assert/strict";
import {
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeFileSha256 } from "../scripts/lib/runtime-workspace-integrity.mjs";
import { installRuntimeWorkspaceFromPackageLock } from "../scripts/lib/runtime-workspace-install.mjs";

test("package-manager fallback uses npm ci and rejects lock mutation", () => {
	const root = mkdtempSync(join(tmpdir(), "feynman-runtime-exact-lock-"));
	const lockPath = join(root, "package-lock.json");
	const lockSource =
		'{"name":"runtime","lockfileVersion":3,"packages":{"":{"dependencies":{}}}}\n';
	try {
		writeFileSync(lockPath, lockSource);
		const expectedPackageLockSha256 = computeFileSha256(lockPath);
		let heartbeats = 0;
		assert.equal(
			installRuntimeWorkspaceFromPackageLock(root, {
				expectedPackageLockSha256,
				heartbeat: () => {
					heartbeats += 1;
				},
				invocation: { command: "npm", args: [] },
				spawn(command, args, options) {
					assert.equal(command, "npm");
					assert.equal(args[0], "ci");
					assert.equal(options.cwd, root);
					return {
						status: 0,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			true,
		);
		assert.equal(heartbeats, 2);

		writeFileSync(lockPath, lockSource);
		assert.equal(
			installRuntimeWorkspaceFromPackageLock(root, {
				expectedPackageLockSha256,
				invocation: { command: "npm", args: [] },
				spawn() {
					writeFileSync(lockPath, `${lockSource} `);
					return {
						status: 0,
						signal: null,
						stdout: Buffer.alloc(0),
						stderr: Buffer.alloc(0),
					};
				},
			}),
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
