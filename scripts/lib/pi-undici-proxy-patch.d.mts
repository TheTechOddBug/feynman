export const FEYNMAN_UNDICI_VERSION: "8.9.0";

export function patchPiCodingAgentUndiciPackageJsonSource(source: string): string;
export function patchPiCodingAgentUndiciShrinkwrapSource(source: string): string;
export function patchPiUndiciPackageLockSource(source: string): string;
export function patchPiUndiciProxyTree(
	nodeModulesPath: string,
	fallbackPackagePath?: string,
): boolean;
