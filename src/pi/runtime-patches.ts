import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { patchAlphaHubAuthSource } from "../../scripts/lib/alpha-hub-auth-patch.mjs";
import { patchAlphaHubSearchResultsSource, patchAlphaHubSearchSource } from "../../scripts/lib/alpha-hub-search-patch.mjs";
import { patchPiAgentCoreSource } from "../../scripts/lib/pi-agent-core-patch.mjs";
import { patchPiPackageManagerSource } from "../../scripts/lib/pi-package-manager-patch.mjs";
import { PI_SUBAGENTS_PATCH_TARGETS, patchPiSubagentsSource } from "../../scripts/lib/pi-subagents-patch.mjs";
import { patchPiEditorSource, patchPiInteractiveThemeSource, patchPiTuiSource } from "../../scripts/lib/pi-tui-patch.mjs";
import { PI_WEB_ACCESS_PATCH_TARGETS, patchPiWebAccessSource } from "../../scripts/lib/pi-web-access-patch.mjs";

function patchFileIfPresent(path: string, patchSource: (source: string) => string): boolean {
	if (!existsSync(path)) {
		return false;
	}
	const source = readFileSync(path, "utf8");
	const patched = patchSource(source);
	if (patched === source) {
		return false;
	}
	writeFileSync(path, patched, "utf8");
	return true;
}

function patchPackageFiles(
	nodeModulesPath: string,
	packageName: string,
	relativePaths: string[],
	patchSource: (relativePath: string, source: string) => string,
): boolean {
	let changed = false;
	for (const relativePath of relativePaths) {
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, ...packageName.split("/"), ...relativePath.split("/")),
			(source) => patchSource(relativePath, source),
		) || changed;
	}
	return changed;
}

function patchScopedPiPackageFileIfPresent(
	nodeModulesPath: string,
	packageName: string,
	relativePath: string,
	patchSource: (source: string) => string,
): boolean {
	let changed = false;
	for (const scope of ["@earendil-works", "@mariozechner"]) {
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, scope, packageName, ...relativePath.split("/")),
			patchSource,
		) || changed;
	}
	return changed;
}

export function patchPiRuntimeNodeModules(appRoot: string): boolean {
	const nodeModuleRoots = [
		resolve(appRoot, "node_modules"),
		resolve(appRoot, ".feynman", "npm", "node_modules"),
	];
	let changed = false;
	for (const nodeModulesPath of nodeModuleRoots) {
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-agent-core",
			"dist/agent-loop.js",
			patchPiAgentCoreSource,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-tui",
			"dist/tui.js",
			patchPiTuiSource,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-tui",
			"dist/components/editor.js",
			patchPiEditorSource,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/modes/interactive/theme/theme.js",
			patchPiInteractiveThemeSource,
		) || changed;
		changed = patchScopedPiPackageFileIfPresent(
			nodeModulesPath,
			"pi-coding-agent",
			"dist/core/package-manager.js",
			patchPiPackageManagerSource,
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@companion-ai", "alpha-hub", "src", "lib", "auth.js"),
			patchAlphaHubAuthSource,
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@companion-ai", "alpha-hub", "src", "lib", "alphaxiv.js"),
			patchAlphaHubSearchSource,
		) || changed;
		changed = patchFileIfPresent(
			resolve(nodeModulesPath, "@companion-ai", "alpha-hub", "src", "lib", "index.js"),
			patchAlphaHubSearchResultsSource,
		) || changed;
		changed = patchPackageFiles(
			nodeModulesPath,
			"pi-web-access",
			PI_WEB_ACCESS_PATCH_TARGETS,
			patchPiWebAccessSource,
		) || changed;
		changed = patchPackageFiles(
			nodeModulesPath,
			"pi-subagents",
			PI_SUBAGENTS_PATCH_TARGETS,
			patchPiSubagentsSource,
		) || changed;
	}
	return changed;
}
