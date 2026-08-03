export declare const PI_WEB_ACCESS_REQUIRED_VERSION: "0.18.0";
export const PI_WEB_ACCESS_PATCH_TARGETS: string[];
export declare function assertPiWebAccessVersion(version: string | undefined, surface: string): void;
export function patchPiWebAccessSource(relativePath: string, source: string): string;
