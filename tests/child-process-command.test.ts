import assert from "node:assert/strict";
import test from "node:test";

import { resolveChildProcessCommand } from "../scripts/lib/child-process-command.mjs";

test("Windows command shims use explicit ComSpec without shell args", () => {
	assert.deepEqual(
		resolveChildProcessCommand(
			"C:\\Program Files\\Feynman Test\\feynman.cmd",
			["--mode", "rpc"],
			{ platform: "win32", comSpec: "C:\\Windows\\System32\\cmd.exe" },
		),
		{
			command: "C:\\Windows\\System32\\cmd.exe",
			args: [
				"/d",
				"/s",
				"/v:off",
				"/c",
				'"C:\\Program^ Files\\Feynman^ Test\\feynman.cmd ^"--mode^" ^"rpc^""',
			],
			shell: false,
			windowsVerbatimArguments: true,
		},
	);
});

test("plain executables remain direct child processes", () => {
	assert.deepEqual(
		resolveChildProcessCommand("/tmp/Feynman Test/feynman", ["--mode", "rpc"], {
			platform: "darwin",
		}),
		{
			command: "/tmp/Feynman Test/feynman",
			args: ["--mode", "rpc"],
			shell: false,
			windowsVerbatimArguments: false,
		},
	);
});

test("Windows command shims escape percent expansion and shell metacharacters", () => {
	const invocation = resolveChildProcessCommand(
		"C:\\Users\\100%REAL%\\Feynman & Test\\feynman.cmd",
		['quoted"value', "percent%PATH%", "caret^bang!amp&pipe|"],
		{ platform: "win32", comSpec: "C:\\Windows\\System32\\cmd.exe" },
	);
	assert.equal(invocation.shell, false);
	assert.equal(invocation.windowsVerbatimArguments, true);
	assert.equal(
		invocation.args.at(-1),
		'"C:\\Users\\100^%REAL^%\\Feynman^ ^&^ Test\\feynman.cmd ^"quoted\\^"value^" ^"percent^%PATH^%^" ^"caret^^bang^!amp^&pipe^|^""',
	);
});
