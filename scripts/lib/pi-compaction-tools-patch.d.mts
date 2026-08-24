export declare const PI_COMPACTION_TOOLS_REQUIRED_VERSION: "0.84.2";
export declare const PI_COMPACTION_TOOLS_RUNTIME_TARGETS: readonly string[];
export declare const PI_COMPACTION_TOOLS_TYPE_TARGETS: readonly string[];
export declare const PI_COMPACTION_TOOLS_PATCH_TARGETS: readonly string[];
export declare const PI_COMPACTION_TOOLS_PATCH_MARKERS: Readonly<{
	request: string;
	historyResponse: string;
	prefixResponse: string;
	branchResponse: string;
	summaryFailure: string;
	summaryFailureTypes: string;
}>;
export declare function assertPiCompactionToolsPatchedSource(relativePath: string, source: string): void;
export declare function patchPiCompactionToolsSource(relativePath: string, source: string): string;
