export interface ChildProcessCommandOptions {
	platform?: NodeJS.Platform;
	comSpec?: string;
}

export interface ChildProcessCommand {
	command: string;
	args: string[];
	shell: false;
	windowsVerbatimArguments: boolean;
}

export declare function resolveChildProcessCommand(
	command: string,
	args: string[],
	options?: ChildProcessCommandOptions,
): ChildProcessCommand;
