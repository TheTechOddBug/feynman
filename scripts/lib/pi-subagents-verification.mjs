import { assertPiSubagentAgentDiagnosticsSources } from "./pi-subagents-agent-diagnostics-patch.mjs";
import { assertPiSubagentPromptMetadataSources } from "./pi-subagents-prompt-metadata-patch.mjs";

export function assertPiSubagentPatchedSources(readSource, label = "pi-subagents") {
	assertPiSubagentAgentDiagnosticsSources(readSource, label);
	assertPiSubagentPromptMetadataSources(readSource, label);
}
