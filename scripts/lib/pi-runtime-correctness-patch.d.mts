export declare const PI_RUNTIME_CORRECTNESS_PATCH_TARGETS: Readonly<{
	codingAgent: readonly string[];
	piAi: readonly string[];
}>;
export declare function patchPiAgentSessionSource(source: string): string;
export declare function patchPiSessionManagerSource(source: string): string;
export declare function patchPiTransformMessagesSource(source: string): string;
