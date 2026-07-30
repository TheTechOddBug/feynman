import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	fauxAssistantMessage,
	fauxToolCall,
	registerFauxProvider,
	streamSimple,
} from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

import { resolveChildProcessCommand } from "./lib/child-process-command.mjs";

const EXPECTED_FEYNMAN_COMMANDS = Object.freeze([
	"capabilities",
	"commands",
	"feynman-model",
	"help",
	"init",
	"outputs",
	"service-tier",
	"thinking",
	"tools",
]);
const EXPECTED_FEYNMAN_TOOLS = Object.freeze([
	"alpha_annotate_paper",
	"alpha_ask_paper",
	"alpha_get_paper",
	"alpha_list_annotations",
	"alpha_read_code",
	"alpha_search",
	"feynman_connector_call",
	"feynman_connector_tools",
	"feynman_model_endpoint_call",
	"feynman_open_chemistry_sketcher",
	"feynman_science_database_search",
	"feynman_workbench_context",
	"hf_dataset_info",
	"hf_repo_files",
	"hf_repo_read_file",
]);

const packageRoot = resolve(import.meta.dirname, "..");
const binaryPath = resolve(process.argv[2] ?? resolve(packageRoot, "bin", "feynman.js"));

function normalizedPath(path) {
	return `${path ?? ""}`.replaceAll("\\", "/");
}

function namesFromToolOptions(options) {
	return options
		.filter((option) => option.endsWith("[extension]"))
		.map((option) => option.split(" — ")[0])
		.sort();
}

async function verifyRpcSurface() {
	const home = mkdtempSync(resolve(tmpdir(), "feynman-installed-rpc-"));
	const invocation = resolveChildProcessCommand(binaryPath, ["--mode", "rpc"]);
	let stderr = "";
	let stdoutBuffer = "";
	let commandsVerified = false;
	let toolsVerified = false;
	let schemaSummaryVerified = false;
	let promptAccepted = false;
	let stdinEnded = false;

	try {
		await new Promise((resolvePromise, rejectPromise) => {
			const child = spawn(invocation.command, invocation.args, {
				cwd: home,
				env: {
					...process.env,
					DO_NOT_TRACK: "1",
					FEYNMAN_HOME: home,
					FEYNMAN_TELEMETRY: "0",
					HOME: home,
				},
				shell: invocation.shell,
				windowsVerbatimArguments: invocation.windowsVerbatimArguments,
				stdio: ["pipe", "pipe", "pipe"],
			});
			const timeout = setTimeout(() => {
				child.kill();
				rejectPromise(
					new Error(
						`Installed RPC verification timed out. commands=${commandsVerified} tools=${toolsVerified} schema=${schemaSummaryVerified}\n${stderr}`,
					),
				);
			}, 45 * 60_000);
			const fail = (error) => {
				clearTimeout(timeout);
				child.kill();
				rejectPromise(error);
			};

			const finishInput = () => {
				if (
					!stdinEnded &&
					commandsVerified &&
					toolsVerified &&
					schemaSummaryVerified &&
					promptAccepted
				) {
					stdinEnded = true;
					child.stdin.end();
				}
			};
			const handleRecord = (record) => {
				if (
					record.type === "response" &&
					record.command === "get_commands" &&
					record.id === "feynman-command-inventory"
				) {
					assert.equal(record.success, true, record.error);
					const commands = Array.isArray(record.data?.commands)
						? record.data.commands
						: [];
					const feynmanCommands = commands
						.filter((command) =>
							normalizedPath(command.sourceInfo?.path).endsWith("/extensions/research-tools.ts"),
						)
						.map((command) => command.name)
						.sort();
					assert.deepEqual(feynmanCommands, [...EXPECTED_FEYNMAN_COMMANDS]);
					commandsVerified = true;
					finishInput();
					return;
				}
				if (
					record.type === "extension_ui_request" &&
					record.method === "select" &&
					record.title === "Tools"
				) {
					const options = Array.isArray(record.options) ? record.options : [];
					assert.deepEqual(namesFromToolOptions(options), [...EXPECTED_FEYNMAN_TOOLS]);
					const alphaGetPaper = options.find((option) =>
						option.startsWith("alpha_get_paper — "),
					);
					assert.ok(alphaGetPaper, "RPC /tools omitted alpha_get_paper");
					toolsVerified = true;
					child.stdin.write(`${JSON.stringify({
						type: "extension_ui_response",
						id: record.id,
						value: alphaGetPaper,
					})}\n`);
					return;
				}
				if (
					record.type === "extension_ui_request" &&
					record.method === "notify" &&
					typeof record.message === "string" &&
					record.message.startsWith("alpha_get_paper:")
				) {
					assert.equal(
						record.message,
						"alpha_get_paper: paper, fullText, section, sections",
					);
					schemaSummaryVerified = true;
					finishInput();
					return;
				}
				if (
					record.type === "response" &&
					record.command === "prompt" &&
					record.id === "feynman-tool-browser"
				) {
					assert.equal(record.success, true, record.error);
					promptAccepted = true;
					finishInput();
				}
			};

			child.stderr.setEncoding("utf8");
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			child.stdout.setEncoding("utf8");
			child.stdout.on("data", (chunk) => {
				stdoutBuffer += chunk;
				while (true) {
					const newlineIndex = stdoutBuffer.indexOf("\n");
					if (newlineIndex === -1) break;
					const line = stdoutBuffer.slice(0, newlineIndex);
					stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
					if (!line.trim()) continue;
					try {
						handleRecord(JSON.parse(line));
					} catch (error) {
						fail(error);
						return;
					}
				}
			});
			child.once("error", (error) => {
				fail(error);
			});
			child.once("exit", (code, signal) => {
				clearTimeout(timeout);
				if (
					code !== 0 ||
					signal ||
					!commandsVerified ||
					!toolsVerified ||
					!schemaSummaryVerified ||
					!promptAccepted
				) {
					rejectPromise(
						new Error(
							`Installed RPC verification failed: code=${code} signal=${signal} commands=${commandsVerified} tools=${toolsVerified} schema=${schemaSummaryVerified} prompt=${promptAccepted}\n${stderr}`,
						),
					);
					return;
				}
				resolvePromise();
			});

			child.stdin.write(`${JSON.stringify({
				id: "feynman-command-inventory",
				type: "get_commands",
			})}\n`);
			child.stdin.write(`${JSON.stringify({
				id: "feynman-tool-browser",
				type: "prompt",
				message: "/tools",
			})}\n`);
		});
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

async function verifyInstalledSchemas() {
	const root = mkdtempSync(resolve(tmpdir(), "feynman-installed-schemas-"));
	const extensionPath = resolve(packageRoot, "extensions", "research-tools.ts");
	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
		packages: [],
	});
	let inventorySession;
	let probeSession;
	const faux = registerFauxProvider();

	try {
		const inventoryLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			additionalExtensionPaths: [extensionPath],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await inventoryLoader.reload();
		assert.deepEqual(
			inventoryLoader.getExtensions().errors,
			[],
			"Installed extension loader reported errors",
		);
		const inventory = await createAgentSession({
			cwd: root,
			agentDir: root,
			resourceLoader: inventoryLoader,
			sessionManager: SessionManager.inMemory(root),
			settingsManager,
			noTools: "builtin",
		});
		inventorySession = inventory.session;
		const installedTools = inventorySession
			.getAllTools()
			.filter((tool) =>
				normalizedPath(tool.sourceInfo?.path).endsWith("/extensions/research-tools.ts"),
			);
		assert.deepEqual(
			installedTools
				.map((tool) => tool.name)
				.sort(),
			[...EXPECTED_FEYNMAN_TOOLS],
		);
		for (const tool of installedTools) {
			assert.doesNotThrow(
				() => Compile(tool.parameters),
				`Installed TypeBox schema did not compile: ${tool.name}`,
			);
		}
		assert.deepEqual(
			inventory.extensionsResult.extensions
				.filter((extension) =>
					normalizedPath(extension.path).endsWith("/extensions/research-tools.ts"),
				)
				.flatMap((extension) => [...extension.commands.keys()])
				.sort(),
			[...EXPECTED_FEYNMAN_COMMANDS],
		);
		let observedArguments;
		let executeCalls = 0;
		const nullableArraySchema = Type.Object({
			values: Type.Union([Type.Array(Type.String()), Type.Null()]),
		});
		assert.equal(Compile(nullableArraySchema).Check({ values: null }), true);
		const probeLoader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		});
		await probeLoader.reload();
		faux.setResponses([
			fauxAssistantMessage(
				fauxToolCall(
					"feynman_typebox_probe",
					{ values: null },
					{ id: "nullable-typebox-probe" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxToolCall(
					"feynman_typebox_probe",
					{},
					{ id: "malformed-typebox-probe" },
				),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		const modelRuntime = {
			hasConfiguredAuth: () => true,
			checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
			isUsingOAuth: () => false,
			streamSimple,
		};
		const probe = await createAgentSession({
			cwd: root,
			agentDir: root,
			modelRuntime,
			model: faux.getModel(),
			resourceLoader: probeLoader,
			sessionManager: SessionManager.inMemory(root),
			settingsManager,
			tools: ["feynman_typebox_probe"],
			customTools: [{
				name: "feynman_typebox_probe",
				label: "Feynman TypeBox Probe",
				description: "Validates the installed nullable-array tool schema.",
				parameters: nullableArraySchema,
				execute: async (_toolCallId, parameters) => {
					executeCalls += 1;
					observedArguments = parameters;
					return {
						content: [{ type: "text", text: "validated" }],
						details: {},
					};
				},
			}],
		});
		probeSession = probe.session;
		await probeSession.prompt("exercise the installed tool schema", {
			expandPromptTemplates: false,
		});
		const toolResult = probeSession.messages.find(
			(message) =>
				message.role === "toolResult" &&
				message.toolCallId === "nullable-typebox-probe",
		);
		assert.ok(toolResult, "Pi did not emit the installed schema probe result");
		assert.equal(toolResult.isError, false);
		assert.equal(observedArguments?.values, null);
		const malformedResult = probeSession.messages.find(
			(message) =>
				message.role === "toolResult" &&
				message.toolCallId === "malformed-typebox-probe",
		);
		assert.ok(malformedResult, "Pi did not emit the malformed-argument schema probe result");
		assert.equal(malformedResult.isError, true);
		assert.equal(executeCalls, 1, "Malformed arguments reached the custom tool execute function");
	} finally {
		probeSession?.dispose();
		inventorySession?.dispose();
		faux.unregister();
		rmSync(root, { recursive: true, force: true });
	}
}

await verifyRpcSurface();
await verifyInstalledSchemas();
console.log(JSON.stringify({
	binary: binaryPath,
	commands: EXPECTED_FEYNMAN_COMMANDS.length,
	tools: EXPECTED_FEYNMAN_TOOLS.length,
	typeboxSchemas: EXPECTED_FEYNMAN_TOOLS.length,
	typeboxNullableArray: "passed",
	typeboxMalformedArguments: "rejected",
}));
