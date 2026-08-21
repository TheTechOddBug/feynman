export declare const PI_AI_FORWARD_FIX_REQUIRED_VERSION: "0.84.2";
export declare const PI_AI_FORWARD_FIX_TARGETS: readonly string[];
export declare const PI_AI_FORWARD_FIX_MARKERS: Readonly<{
	googleGenerativeAi: string;
	googleShared: string;
	googleVertex: string;
	bedrock: string;
	toolChoice: string;
}>;
export declare function assertPiAiForwardFixSource(relativePath: string, source: string): void;
export declare function patchPiAiForwardFixSource(relativePath: string, source: string): string;
