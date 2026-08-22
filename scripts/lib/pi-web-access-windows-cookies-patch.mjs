import { createHash } from "node:crypto";

// pi-web-access 0.24.1 includes upstream Windows Chrome/Edge cookie support,
// but its PowerShell command passes DPAPI ciphertext through argv, does not
// load System.Security explicitly under Windows PowerShell 5.1, and selects
// Chrome's microsecond expiry integer directly through node:sqlite even though
// current values exceed Number.MAX_SAFE_INTEGER. Keep only these narrow
// corrections until upstream ships them and the native Windows verifier passes
// without this patch.
const BASELINE_SHA256 = "abfa2abc29f49a40343ed602044d436d1736300f56eb664d97406b2745f43115";
const PREVIOUS_TARGET_SHA256 = "3abd41432a923cd4e62ce032f1479753edc84c0e1554ca5d9cff5054c6c8e702";
export const PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256 =
	"a98cf2f60f451108a2a371ee8a08aaac6ab881ba654cacf08a664c3364088968";

const UPSTREAM_UNPROTECT_WINDOWS_DATA = `function unprotectWindowsData(protectedData: Buffer): Promise<Buffer | null> {
	return new Promise((resolve) => {
		const script = "$data=[Convert]::FromBase64String($args[0]);$clear=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($clear))";
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, protectedData.toString("base64")], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
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

const UPSTREAM_EXPIRY_QUERY = `	const expiresExpr = columns.columns.has("expires_utc") ? "expires_utc" : "0 AS expires_utc";
	const expiryFilter = filterExpired && columns.columns.has("expires_utc") ? \` AND (expires_utc = 0 OR expires_utc > \${chromeExpiryNowMicros()})\` : "";`;

const FIXED_EXPIRY_QUERY = `	const expiresExpr = columns.columns.has("expires_utc")
		? "CAST((expires_utc / 1000000) AS INTEGER) AS expires_utc"
		: "0 AS expires_utc";
	const expiryFilter = filterExpired && columns.columns.has("expires_utc")
		? \` AND (expires_utc = 0 OR CAST((expires_utc / 1000000) AS INTEGER) > \${chromeExpiryNowSeconds()})\`
		: "";`;

const UPSTREAM_EXPIRY_CLOCK = `function chromeExpiryNowMicros(): number {
	return (Date.now() + 11644473600000) * 1000;
}`;

const FIXED_EXPIRY_CLOCK = `function chromeExpiryNowSeconds(): number {
	return Math.floor((Date.now() + 11644473600000) / 1000);
}`;

function digest(source) {
	return createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
}

export function patchPiWebAccessWindowsCookiesSource(source) {
	const sourceDigest = digest(source);
	if (sourceDigest === PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) return source;
	if (![BASELINE_SHA256, PREVIOUS_TARGET_SHA256].includes(sourceDigest)) {
		throw new Error(
			`Unsupported pi-web-access 0.24.1 chrome-cookies.ts: expected ${BASELINE_SHA256}, ${PREVIOUS_TARGET_SHA256}, or ${PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256}, found ${sourceDigest}`,
		);
	}
	let patched = source;
	if (patched.includes(UPSTREAM_UNPROTECT_WINDOWS_DATA)) {
		patched = patched.replace(
			UPSTREAM_UNPROTECT_WINDOWS_DATA,
			FIXED_UNPROTECT_WINDOWS_DATA,
		);
	} else if (!patched.includes(FIXED_UNPROTECT_WINDOWS_DATA)) {
		throw new Error(
			"Unsupported pi-web-access 0.24.1 chrome-cookies.ts: exact upstream DPAPI hunk is missing",
		);
	}
	if (!patched.includes(UPSTREAM_EXPIRY_QUERY) || !patched.includes(UPSTREAM_EXPIRY_CLOCK)) {
		throw new Error(
			"Unsupported pi-web-access 0.24.1 chrome-cookies.ts: exact upstream expiry hunk is missing",
		);
	}
	patched = patched
		.replace(UPSTREAM_EXPIRY_QUERY, FIXED_EXPIRY_QUERY)
		.replace(UPSTREAM_EXPIRY_CLOCK, FIXED_EXPIRY_CLOCK);
	const patchedDigest = digest(patched);
	if (patchedDigest !== PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) {
		throw new Error(
			`Unsupported pi-web-access 0.24.1 chrome-cookies.ts: DPAPI and expiry correction produced ${patchedDigest}`,
		);
	}
	return patched;
}
