import { createHash } from "node:crypto";

// Remove this forward port after pi-web-access ships upstream commit
// ad5f0ca66ef6658c7efa3f12fd0cb9b206f490f6 plus the Windows PowerShell 5.1
// System.Security/stdin correction, and the native DPAPI verifier passes without it.
const BASELINE_SHA256 = "71ad181b8c640acedacccae552dad46352773473fedcacaea6bb398a0d531d46";
const PREVIOUS_TARGET_SHA256 = "abfa2abc29f49a40343ed602044d436d1736300f56eb664d97406b2745f43115";
export const PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256 = "3abd41432a923cd4e62ce032f1479753edc84c0e1554ca5d9cff5054c6c8e702";

const PREVIOUS_UNPROTECT_WINDOWS_DATA = `function unprotectWindowsData(protectedData: Buffer): Promise<Buffer | null> {
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

const WINDOWS_COOKIE_REPLACEMENTS = [
	["import { execFile } from \"node:child_process\";\nimport { pbkdf2Sync, createDecipheriv } from \"node:crypto\";\nimport { copyFileSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from \"node:fs\";\nimport { tmpdir, homedir } from \"node:os\";\nimport { isAbsolute, join, sep } from \"node:path\";\nimport { isBrowserCookieAccessAllowed } from \"./gemini-web-config.ts\";\n", "import { execFile } from \"node:child_process\";\nimport { pbkdf2Sync, createDecipheriv } from \"node:crypto\";\nimport { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from \"node:fs\";\nimport { tmpdir, homedir } from \"node:os\";\nimport { isAbsolute, join, sep } from \"node:path\";\nimport { isBrowserCookieAccessAllowed } from \"./gemini-web-config.ts\";\n"],
	["interface BrowserConfig {\n\tname: string;\n\tbaseDir: string;\n\tkeychainService?: string;\n\tkeychainAccount?: string;\n\tsecretToolApp?: string;\n", "interface BrowserConfig {\n\tname: string;\n\tbaseDir: string;\n\tusesLocalAppData?: boolean;\n\tkeychainService?: string;\n\tkeychainAccount?: string;\n\tsecretToolApp?: string;\n"],
	["\t{ name: \"Chrome\", baseDir: \".config/google-chrome\", secretToolApp: \"chrome\" },\n];\n\nconst browserPasswordCache = new Map<string, Promise<string | null>>();\nlet lastCookieDiagnostic: string | null = null;\nlet sqliteModule: typeof import(\"node:sqlite\") | null = null;\n", "\t{ name: \"Chrome\", baseDir: \".config/google-chrome\", secretToolApp: \"chrome\" },\n];\n\nconst WINDOWS_BROWSER_CONFIGS: BrowserConfig[] = [\n\t{ name: \"Chrome\", baseDir: \"Google/Chrome/User Data\", usesLocalAppData: true },\n\t{ name: \"Edge\", baseDir: \"Microsoft/Edge/User Data\", usesLocalAppData: true },\n];\n\nconst browserPasswordCache = new Map<string, Promise<string | null>>();\nlet lastCookieDiagnostic: string | null = null;\nlet sqliteModule: typeof import(\"node:sqlite\") | null = null;\n"],
	["\t}\n\n\tconst currentPlatform = process.platform;\n\tconst configs = currentPlatform === \"darwin\" ? MACOS_BROWSER_CONFIGS : currentPlatform === \"linux\" ? LINUX_BROWSER_CONFIGS : [];\n\tif (configs.length === 0) {\n\t\tlastCookieDiagnostic = \"Chromium cookie extraction is unsupported on this platform.\";\n\t\treturn null;\n", "\t}\n\n\tconst currentPlatform = process.platform;\n\tconst configs = currentPlatform === \"darwin\" ? MACOS_BROWSER_CONFIGS : currentPlatform === \"linux\" ? LINUX_BROWSER_CONFIGS : currentPlatform === \"win32\" ? WINDOWS_BROWSER_CONFIGS : [];\n\tif (configs.length === 0) {\n\t\tlastCookieDiagnostic = \"Chromium cookie extraction is unsupported on this platform.\";\n\t\treturn null;\n"],
	["\t\tlastCookieDiagnostic = \"No valid cookie hosts were requested.\";\n\t\treturn null;\n\t}\n\tconst home = homedir();\n\tlet sawCookieDatabase = false;\n\tlet sawRequiredCookies = false;\n\tlet sawAnyHostCookie = false;\n\tlet sawBackendFailure: SqliteFailure | undefined;\n\tlet sawUnsafeProfilePath = false;\n\n\tfor (const config of configs) {\n\t\tconst profiles = requestedProfile ? [requestedProfile] : listBrowserProfiles(home, config);\n", "\t\tlastCookieDiagnostic = \"No valid cookie hosts were requested.\";\n\t\treturn null;\n\t}\n\tconst home = currentPlatform === \"win32\" ? process.env.USERPROFILE || homedir() : homedir();\n\tlet sawCookieDatabase = false;\n\tlet sawRequiredCookies = false;\n\tlet sawAnyHostCookie = false;\n\tlet sawBackendFailure: SqliteFailure | undefined;\n\tlet sawUnsafeProfilePath = false;\n\tlet sawWindowsAppBoundCookie = false;\n\n\tfor (const config of configs) {\n\t\tconst profiles = requestedProfile ? [requestedProfile] : listBrowserProfiles(home, config);\n"],
	["\t\t\t\tcontinue;\n\t\t\t}\n\t\t\tif (!profilePath) continue;\n\t\t\tconst cookiesPath = join(profilePath, \"Cookies\");\n\t\t\tsawCookieDatabase = true;\n\n\t\t\tconst tempDir = mkdtempSync(join(tmpdir(), \"pi-chrome-cookies-\"));\n", "\t\t\t\tcontinue;\n\t\t\t}\n\t\t\tif (!profilePath) continue;\n\t\t\tconst cookiesPath = cookieDatabasePath(profilePath, config);\n\t\t\tif (!cookiesPath) continue;\n\t\t\tsawCookieDatabase = true;\n\n\t\t\tconst tempDir = mkdtempSync(join(tmpdir(), \"pi-chrome-cookies-\"));\n"],
	["\t\t\t\t\tsawRequiredCookies = true;\n\t\t\t\t}\n\n\t\t\t\tconst password = await readBrowserPassword(config, currentPlatform);\n\t\t\t\tif (!password) {\n\t\t\t\t\twarningSet.add(`Could not read ${config.name} cookie encryption password`);\n\t\t\t\t\tcontinue;\n\t\t\t\t}\n\n\t\t\t\tconst key = pbkdf2Sync(password, \"saltysalt\", currentPlatform === \"darwin\" ? 1003 : 1, 16, \"sha1\");\n\t\t\t\tconst metaVersion = await readMetaVersion(tempDb);\n\t\t\t\tif (metaVersion.failure) sawBackendFailure = metaVersion.failure;\n\t\t\t\tif (metaVersion.value === null) continue;\n", "\t\t\t\t\tsawRequiredCookies = true;\n\t\t\t\t}\n\n\t\t\t\tconst key = currentPlatform === \"win32\"\n\t\t\t\t\t? await readWindowsEncryptionKey(config, home)\n\t\t\t\t\t: await readBrowserPassword(config, currentPlatform).then((password) => password ? pbkdf2Sync(password, \"saltysalt\", currentPlatform === \"darwin\" ? 1003 : 1, 16, \"sha1\") : null);\n\t\t\t\tif (!key) {\n\t\t\t\t\twarningSet.add(currentPlatform === \"win32\"\n\t\t\t\t\t\t? `Could not read ${config.name} Windows cookie encryption key`\n\t\t\t\t\t\t: `Could not read ${config.name} cookie encryption password`);\n\t\t\t\t\tcontinue;\n\t\t\t\t}\n\t\t\t\tconst metaVersion = await readMetaVersion(tempDb);\n\t\t\t\tif (metaVersion.failure) sawBackendFailure = metaVersion.failure;\n\t\t\t\tif (metaVersion.value === null) continue;\n"],
	["\t\t\t\t\tif (!name) continue;\n\t\t\t\t\tlet value = typeof row.value === \"string\" && row.value.length > 0 ? row.value : null;\n\t\t\t\t\tif (!value && typeof row.encrypted_value_hex === \"string\" && /^[0-9a-f]*$/i.test(row.encrypted_value_hex)) {\n\t\t\t\t\t\tvalue = decryptCookieValue(Buffer.from(row.encrypted_value_hex, \"hex\"), key, metaVersion.value >= 24);\n\t\t\t\t\t}\n\t\t\t\t\tif (!value) continue;\n\t\t\t\t\tconst path = typeof row.path === \"string\" && row.path.startsWith(\"/\") ? row.path : \"/\";\n", "\t\t\t\t\tif (!name) continue;\n\t\t\t\t\tlet value = typeof row.value === \"string\" && row.value.length > 0 ? row.value : null;\n\t\t\t\t\tif (!value && typeof row.encrypted_value_hex === \"string\" && /^[0-9a-f]*$/i.test(row.encrypted_value_hex)) {\n\t\t\t\t\t\tconst encrypted = Buffer.from(row.encrypted_value_hex, \"hex\");\n\t\t\t\t\t\tif (currentPlatform === \"win32\" && encrypted.subarray(0, 3).toString(\"utf8\") === \"v20\") sawWindowsAppBoundCookie = true;\n\t\t\t\t\t\tvalue = currentPlatform === \"win32\"\n\t\t\t\t\t\t\t? decryptWindowsCookieValue(encrypted, key, metaVersion.value >= 24)\n\t\t\t\t\t\t\t: decryptCookieValue(encrypted, key, metaVersion.value >= 24);\n\t\t\t\t\t}\n\t\t\t\t\tif (!value) continue;\n\t\t\t\t\tconst path = typeof row.path === \"string\" && row.path.startsWith(\"/\") ? row.path : \"/\";\n"],
	["\t\t\t: \"No detected Chromium profile contains a cookie database.\";\n\t} else if (requiredCookies?.length && !sawRequiredCookies) {\n\t\tlastCookieDiagnostic = `No detected Chromium profile contains the required ${options.requiredLabel ?? \"browser\"} cookies.`;\n\t} else if (!sawAnyHostCookie) {\n\t\tlastCookieDiagnostic = options.requestUrl\n\t\t\t? \"No detected Chromium profile contains cookies for the requested URL.\"\n", "\t\t\t: \"No detected Chromium profile contains a cookie database.\";\n\t} else if (requiredCookies?.length && !sawRequiredCookies) {\n\t\tlastCookieDiagnostic = `No detected Chromium profile contains the required ${options.requiredLabel ?? \"browser\"} cookies.`;\n\t} else if (sawWindowsAppBoundCookie) {\n\t\tlastCookieDiagnostic = \"Windows Chromium v20 app-bound cookies are not supported.\";\n\t} else if (!sawAnyHostCookie) {\n\t\tlastCookieDiagnostic = options.requestUrl\n\t\t\t? \"No detected Chromium profile contains cookies for the requested URL.\"\n"],
	["}\n\nfunction resolveProfilePath(home: string, config: BrowserConfig, profile: string): string | \"outside-root\" | null {\n\tconst basePath = join(home, config.baseDir);\n\tconst profilePath = join(basePath, profile);\n\tconst cookiesPath = join(profilePath, \"Cookies\");\n\tif (!existsSync(cookiesPath)) return null;\n\ttry {\n\t\tconst baseRealPath = realpathSync(basePath);\n\t\tconst profileRealPath = realpathSync(profilePath);\n", "}\n\nfunction resolveProfilePath(home: string, config: BrowserConfig, profile: string): string | \"outside-root\" | null {\n\tconst basePath = browserBasePath(home, config);\n\tconst profilePath = join(basePath, profile);\n\tif (!cookieDatabasePath(profilePath, config)) return null;\n\ttry {\n\t\tconst baseRealPath = realpathSync(basePath);\n\t\tconst profileRealPath = realpathSync(profilePath);\n"],
	["\t}\n}\n\nfunction normalizeCookieNames(names: string[] | undefined): string[] | undefined {\n\tif (!names?.length) return undefined;\n\tconst normalized = names.filter((name): name is string => typeof name === \"string\").map((name) => name.trim()).filter(Boolean);\n", "\t}\n}\n\nfunction cookieDatabasePath(profilePath: string, config: BrowserConfig): string | null {\n\tconst networkCookies = join(profilePath, \"Network\", \"Cookies\");\n\tif (config.usesLocalAppData && existsSync(networkCookies)) return networkCookies;\n\tconst legacyCookies = join(profilePath, \"Cookies\");\n\treturn existsSync(legacyCookies) ? legacyCookies : null;\n}\n\nfunction browserBasePath(home: string, config: BrowserConfig): string {\n\treturn config.usesLocalAppData\n\t\t? join(process.env.LOCALAPPDATA || join(home, \"AppData\", \"Local\"), config.baseDir)\n\t\t: join(home, config.baseDir);\n}\n\nfunction normalizeCookieNames(names: string[] | undefined): string[] | undefined {\n\tif (!names?.length) return undefined;\n\tconst normalized = names.filter((name): name is string => typeof name === \"string\").map((name) => name.trim()).filter(Boolean);\n"],
	["}\n\nfunction listBrowserProfiles(home: string, config: BrowserConfig): string[] {\n\tconst basePath = join(home, config.baseDir);\n\tif (!existsSync(basePath)) return [\"Default\"];\n\tconst profiles = new Set<string>();\n\ttry {\n\t\tfor (const entry of readdirSync(basePath, { withFileTypes: true })) {\n\t\t\tif (entry.isDirectory() && existsSync(join(basePath, entry.name, \"Cookies\"))) profiles.add(entry.name);\n\t\t}\n\t} catch {\n\t}\n", "}\n\nfunction listBrowserProfiles(home: string, config: BrowserConfig): string[] {\n\tconst basePath = browserBasePath(home, config);\n\tif (!existsSync(basePath)) return [\"Default\"];\n\tconst profiles = new Set<string>();\n\ttry {\n\t\tfor (const entry of readdirSync(basePath, { withFileTypes: true })) {\n\t\t\tif (entry.isDirectory() && cookieDatabasePath(join(basePath, entry.name), config)) profiles.add(entry.name);\n\t\t}\n\t} catch {\n\t}\n"],
	["\t}\n}\n\nfunction removePkcs7Padding(buf: Buffer): Buffer {\n\tif (!buf.length) return buf;\n\tconst padding = buf[buf.length - 1];\n", "\t}\n}\n\nfunction decryptWindowsCookieValue(encrypted: Uint8Array, key: Buffer, stripHash: boolean): string | null {\n\tconst buf = Buffer.from(encrypted);\n\tif (buf.subarray(0, 3).toString(\"utf8\") !== \"v10\" || buf.length < 3 + 12 + 16) return null;\n\ttry {\n\t\tconst nonce = buf.subarray(3, 15);\n\t\tconst ciphertext = buf.subarray(15, -16);\n\t\tconst decipher = createDecipheriv(\"aes-256-gcm\", key, nonce);\n\t\tdecipher.setAuthTag(buf.subarray(-16));\n\t\tconst plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);\n\t\treturn new TextDecoder(\"utf-8\", { fatal: true }).decode(stripHash && plaintext.length >= 32 ? plaintext.subarray(32) : plaintext);\n\t} catch {\n\t\treturn null;\n\t}\n}\n\nfunction removePkcs7Padding(buf: Buffer): Buffer {\n\tif (!buf.length) return buf;\n\tconst padding = buf[buf.length - 1];\n"],
	["\treturn passwordPromise;\n}\n\nfunction readKeychainPassword(account: string, service: string): Promise<string | null> {\n\treturn new Promise((resolve) => {\n\t\texecFile(\"security\", [\"find-generic-password\", \"-w\", \"-a\", account, \"-s\", service], { timeout: 5000 }, (err, stdout) => {\n", "\treturn passwordPromise;\n}\n\nasync function readWindowsEncryptionKey(config: BrowserConfig, home: string): Promise<Buffer | null> {\n\ttry {\n\t\tconst localState = JSON.parse(readFileSync(join(browserBasePath(home, config), \"Local State\"), \"utf8\")) as { os_crypt?: { encrypted_key?: unknown } };\n\t\tconst encodedKey = localState.os_crypt?.encrypted_key;\n\t\tif (typeof encodedKey !== \"string\") return null;\n\t\tconst protectedKey = Buffer.from(encodedKey, \"base64\");\n\t\tif (protectedKey.subarray(0, 5).toString(\"utf8\") !== \"DPAPI\") return null;\n\t\tconst decrypted = await unprotectWindowsData(protectedKey.subarray(5));\n\t\treturn decrypted?.length === 32 ? decrypted : null;\n\t} catch {\n\t\treturn null;\n\t}\n}\n\nfunction unprotectWindowsData(protectedData: Buffer): Promise<Buffer | null> {\n\treturn new Promise((resolve) => {\n\t\tconst script = \"$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$encoded=[Console]::In.ReadToEnd();$data=[Convert]::FromBase64String($encoded);$clear=[Security.Cryptography.ProtectedData]::Unprotect($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Write([Convert]::ToBase64String($clear))\";\n\t\tconst child = execFile(\"powershell.exe\", [\"-NoProfile\", \"-NonInteractive\", \"-Command\", script], { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => {\n\t\t\tif (err) { resolve(null); return; }\n\t\t\ttry {\n\t\t\t\tresolve(Buffer.from(stdout.trim(), \"base64\"));\n\t\t\t} catch {\n\t\t\t\tresolve(null);\n\t\t\t}\n\t\t});\n\t\tif (!child.stdin) {\n\t\t\tchild.kill();\n\t\t\tresolve(null);\n\t\t\treturn;\n\t\t}\n\t\tchild.stdin.on(\"error\", () => {});\n\t\tchild.stdin.end(protectedData.toString(\"base64\"));\n\t});\n}\n\nfunction readKeychainPassword(account: string, service: string): Promise<string | null> {\n\treturn new Promise((resolve) => {\n\t\texecFile(\"security\", [\"find-generic-password\", \"-w\", \"-a\", account, \"-s\", service], { timeout: 5000 }, (err, stdout) => {\n"],
];

function digest(source) {
	return createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
}

export function patchPiWebAccessWindowsCookiesSource(source) {
	const sourceDigest = digest(source);
	if (sourceDigest === PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) return source;
	if (sourceDigest === PREVIOUS_TARGET_SHA256) {
		const patched = source.replace(
			PREVIOUS_UNPROTECT_WINDOWS_DATA,
			FIXED_UNPROTECT_WINDOWS_DATA,
		);
		const patchedDigest = digest(patched);
		if (patchedDigest !== PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) {
			throw new Error(
				`Unsupported pi-web-access 0.24.0 chrome-cookies.ts: DPAPI correction produced ${patchedDigest}`,
			);
		}
		return patched;
	}
	if (sourceDigest !== BASELINE_SHA256) {
		throw new Error(`Unsupported pi-web-access 0.24.0 chrome-cookies.ts: expected ${BASELINE_SHA256}, ${PREVIOUS_TARGET_SHA256}, or ${PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256}, found ${sourceDigest}`);
	}
	let patched = source;
	for (const [original, replacement] of WINDOWS_COOKIE_REPLACEMENTS) {
		if (!patched.includes(original)) {
			throw new Error("Unsupported pi-web-access 0.24.0 chrome-cookies.ts: exact upstream patch hunk is missing");
		}
		patched = patched.replace(original, replacement);
	}
	const patchedDigest = digest(patched);
	if (patchedDigest !== PI_WEB_ACCESS_WINDOWS_COOKIES_SHA256) {
		throw new Error(`Unsupported pi-web-access 0.24.0 chrome-cookies.ts: forward port produced ${patchedDigest}`);
	}
	return patched;
}
