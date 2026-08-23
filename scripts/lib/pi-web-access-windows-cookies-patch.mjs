import { createHash } from "node:crypto";

// pi-web-access 0.24.2 fixes Chromium's oversized expiry values and removes
// DPAPI ciphertext from argv. Keep only Feynman's narrower transport hardening:
// the protected key travels over stdin rather than through the child
// environment, PowerShell failures are terminating, and the window stays
// hidden. Remove this patch after upstream ships equivalent stdin transport
// and the native Windows verifier passes without it.
const BASELINE_SHA256 =
	"e735ad014cbc167f5ed45fbd50b5582378771ed16120563587a48c6406fa495a";
export const PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256 =
	"20eba0bb1fd2ff9dbbdbfa1e469c88c2d2316dc663fdd0dd056d9e734b824da0";

const UPSTREAM_UNPROTECT_WINDOWS_DATA = `function unprotectWindowsData(protectedData: Buffer): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const script = "Add-Type -AssemblyName System.Security;$data=[Convert]::FromBase64String($env:PIWA_PROTECTED);$clear=[System.Security.Cryptography.ProtectedData]::Unprotect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($clear))";
		const encoded = Buffer.from(script, "utf16le").toString("base64");
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { timeout: 5000, maxBuffer: 1024 * 1024, env: { ...process.env, PIWA_PROTECTED: protectedData.toString("base64") } }, (err, stdout) => {
			if (err) { resolve(null); return; }
			try {
				resolve(Buffer.from(stdout.trim(), "base64"));
			} catch {
				resolve(null);
			}
		});
	});
}`;

const FIXED_UNPROTECT_WINDOWS_DATA = `function unprotectWindowsData(protectedData: Buffer): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const script = "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$encoded=[Console]::In.ReadToEnd();$data=[Convert]::FromBase64String($encoded);$clear=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($clear))";
		const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => {
			if (err) { resolve(null); return; }
			try {
				resolve(Buffer.from(stdout.trim(), "base64"));
			} catch {
				resolve(null);
			}
		});
		if (!child.stdin) {
			child.kill();
			resolve(null);
			return;
		}
		child.stdin.on("error", () => {});
		child.stdin.end(protectedData.toString("base64"));
	});
}`;

function digest(source) {
	return createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
}

export function patchPiWebAccessWindowsCookiesSource(source) {
	const sourceDigest = digest(source);
	if (sourceDigest === PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) return source;
	if (sourceDigest !== BASELINE_SHA256) {
		throw new Error(
			`Unsupported pi-web-access 0.24.2 chrome-cookies.ts: expected ${BASELINE_SHA256} or ${PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256}, found ${sourceDigest}`,
		);
	}
	if (!source.includes(UPSTREAM_UNPROTECT_WINDOWS_DATA)) {
		throw new Error(
			"Unsupported pi-web-access 0.24.2 chrome-cookies.ts: exact upstream DPAPI hunk is missing",
		);
	}
	const patched = source.replace(
		UPSTREAM_UNPROTECT_WINDOWS_DATA,
		FIXED_UNPROTECT_WINDOWS_DATA,
	);
	const patchedDigest = digest(patched);
	if (patchedDigest !== PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) {
		throw new Error(
			`Unsupported pi-web-access 0.24.2 chrome-cookies.ts: DPAPI correction produced ${patchedDigest}`,
		);
	}
	return patched;
}
