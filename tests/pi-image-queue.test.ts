import test from "node:test";
import assert from "node:assert/strict";

import type { Context } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { patchPiRuntimeNodeModules } from "../src/pi/runtime-patches.js";

const appRoot = process.cwd();
patchPiRuntimeNodeModules(appRoot);

function createResourceLoader(runtime: unknown) {
	return {
		getExtensions: () => ({
			extensions: [],
			errors: [],
			runtime,
		}),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

test("real image-only steering and follow-up delivery clears colliding empty queue keys", async (t) => {
	const [{ Agent }, codingAgent, piAi] = await Promise.all([
		import("@earendil-works/pi-agent-core"),
		import("@earendil-works/pi-coding-agent"),
		import("@earendil-works/pi-ai/compat"),
	]);
	const { AgentSession, SessionManager, SettingsManager, convertToLlm } = codingAgent;
	const { fauxAssistantMessage, fauxToolCall, registerFauxProvider, streamSimple } = piAi;
	const faux = registerFauxProvider({
		models: [{ id: "faux-image-queue", input: ["text", "image"] }],
	});
	let disposeSession: (() => void) | undefined;
	t.after(() => {
		disposeSession?.();
		faux.unregister();
	});

	let markToolStarted: (() => void) | undefined;
	const toolStarted = new Promise<void>((resolveStarted) => {
		markToolStarted = resolveStarted;
	});
	let releaseTool: (() => void) | undefined;
	const toolGate = new Promise<void>((resolveTool) => {
		releaseTool = resolveTool;
	});
	const waitTool = {
		name: "wait",
		label: "wait",
		description: "Hold the turn while image-only messages are queued",
		parameters: Type.Object({}),
		execute: async () => {
			markToolStarted?.();
			await toolGate;
			return {
				content: [{ type: "text" as const, text: "released" }],
				details: {},
			};
		},
	};
	const model = faux.getModel();
	const modelRuntime = {
		hasConfiguredAuth: () => true,
		checkAuth: async () => ({ auth: { apiKey: "faux-key" } }),
		getAuth: async () => ({ auth: { apiKey: "faux-key" } }),
		isUsingOAuth: () => false,
	};
	const agent = new Agent({
		getApiKey: () => "faux-key",
		streamFn: streamSimple,
		initialState: {
			model,
			systemPrompt: "You are a test assistant.",
			tools: [],
		},
		convertToLlm,
	});
	const session = new AgentSession({
		agent,
		sessionManager: SessionManager.inMemory(appRoot),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
		cwd: appRoot,
		modelRuntime: modelRuntime as never,
		resourceLoader: createResourceLoader(codingAgent.createExtensionRuntime()) as never,
		baseToolsOverride: { wait: waitTool },
	});
	disposeSession = () => session.dispose();

	const receivedImageData: string[] = [];
	const recordLatestImage = (context: Context) => {
		const user = [...context.messages].reverse().find((message) => message.role === "user");
		const image = user?.role === "user" && Array.isArray(user.content)
			? user.content.find((part) => part.type === "image")
			: undefined;
		assert.equal(image?.type, "image");
		receivedImageData.push(image?.type === "image" ? image.data : "");
	};
	faux.setResponses([
		fauxAssistantMessage(fauxToolCall("wait", {}, { id: "wait-call" }), {
			stopReason: "toolUse",
		}),
		(context) => {
			recordLatestImage(context);
			return fauxAssistantMessage("steering image received");
		},
		(context) => {
			recordLatestImage(context);
			return fauxAssistantMessage("follow-up image received");
		},
	]);

	const updates: Array<{ steering: string[]; followUp: string[] }> = [];
	session.subscribe((event) => {
		if (event.type === "queue_update") {
			updates.push({
				steering: [...event.steering],
				followUp: [...event.followUp],
			});
		}
	});
	const followUpImage = {
		type: "image" as const,
		mimeType: "image/png",
		data: "Zm9sbG93LXVw",
	};
	const steeringImage = {
		type: "image" as const,
		mimeType: "image/png",
		data: "c3RlZXI=",
	};

	const prompt = session.prompt("wait for queued images");
	await toolStarted;
	await session.followUp("", [followUpImage]);
	await session.steer("", [steeringImage]);
	assert.equal(session.pendingMessageCount, 2);
	assert.deepEqual(updates.at(-1), { steering: [""], followUp: [""] });
	releaseTool?.();
	await prompt;

	assert.deepEqual(receivedImageData, [steeringImage.data, followUpImage.data]);
	assert.equal(session.agent.hasQueuedMessages(), false);
	assert.equal(session.pendingMessageCount, 0);
	assert.deepEqual(updates, [
		{ steering: [], followUp: [""] },
		{ steering: [""], followUp: [""] },
		{ steering: [], followUp: [""] },
		{ steering: [], followUp: [] },
	]);
});
