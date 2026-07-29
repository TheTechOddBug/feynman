// Adapted from cross-spawn's MIT-licensed Windows escaping algorithm. cmd.exe
// expands metacharacters (including %VAR%) even inside quotes, so every token
// must be escaped before the final /s /c command string is assembled.
const WINDOWS_CMD_META_CHARACTERS = /([()\][%!^"`<>&|;, *?])/g;

function escapeWindowsCmdCommand(command) {
	return `${command}`.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
}

function escapeWindowsCmdArgument(argument) {
	let escaped = `${argument}`;
	escaped = escaped.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
	escaped = escaped.replace(/(?=(\\+?)?)\1$/, "$1$1");
	escaped = `"${escaped}"`;
	return escaped.replace(WINDOWS_CMD_META_CHARACTERS, "^$1");
}

export function resolveChildProcessCommand(
	command,
	args,
	options = {},
) {
	const platform = options.platform ?? process.platform;
	if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(command)) {
		return { command, args, shell: false, windowsVerbatimArguments: false };
	}

	const comSpec = options.comSpec ?? process.env.ComSpec ?? "cmd.exe";
	const commandLine = [
		escapeWindowsCmdCommand(command),
		...args.map(escapeWindowsCmdArgument),
	].join(" ");
	return {
		command: comSpec,
		args: ["/d", "/s", "/v:off", "/c", `"${commandLine}"`],
		shell: false,
		windowsVerbatimArguments: true,
	};
}
