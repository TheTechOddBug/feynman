import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const e2eWorkflow = readFileSync(".github/workflows/e2e.yml", "utf8");
const publishWorkflow = readFileSync(".github/workflows/publish.yml", "utf8");

test("pull-request release gates validate the merge candidate", () => {
	assert.match(e2eWorkflow, /pull_request:\s*\n\s+branches: \[main\]/);
	assert.doesNotMatch(e2eWorkflow, /github\.event\.pull_request\.head\.sha/);
	assert.match(e2eWorkflow, /name: Release candidate \(PR\)/);
	assert.match(e2eWorkflow, /name: Candidate consumer \(\$\{\{ matrix\.os \}\}, Node \$\{\{ matrix\.node \}\}\)/);
	assert.match(e2eWorkflow, /name: pr-npm-package/);
	assert.match(e2eWorkflow, /node: "22\.22\.0"/);
	assert.match(e2eWorkflow, /node: "25"/);
	assert.match(e2eWorkflow, /name: Windows native installer \(PR\)/);
	assert.match(e2eWorkflow, /shell: powershell/);
	assert.match(e2eWorkflow, /shell: pwsh/);
	assert.match(e2eWorkflow, /tarball_for_tar=\$\(cygpath -u "\$tarball"\)/);
	assert.match(e2eWorkflow, /consumer=\$\(cygpath -u "\$consumer"\)/);
	assert.match(e2eWorkflow, /runtime_archive=\$\(cygpath -u "\$runtime_archive"\)/);
	assert.equal(
		(e2eWorkflow.match(/scripts\/verify-windows-installer\.ps1/g) ?? []).length,
		2,
	);
});

test("PR and publish workflows require clean package and consumer audits", () => {
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.match(workflow, /npm audit --omit=dev --prefix \.feynman\/npm/);
		assert.match(workflow, /npm audit --omit=dev --prefix "\$consumer"/);
		assert.match(workflow, /\.feynman\/runtime-workspace\.tgz/);
		assert.match(workflow, /npm audit --omit=dev --prefix "\$runtime_audit\/npm"/);
		assert.doesNotMatch(
			workflow,
			/npm audit --omit=dev --prefix\s+\\?\s*"\$consumer\/node_modules\/@companion-ai\/feynman\/\.feynman\/npm"/,
		);
		assert.match(workflow, /npm pack --dry-run --json/);
		assert.match(workflow, /verify-package-artifact\.mjs/);
		assert.match(workflow, /verify-package-budget\.mjs/);
		assert.match(workflow, /git status --porcelain --untracked-files=all/);
	}
});

test("publish uses the exact verified tarball after native bundles pass", () => {
	assert.match(publishWorkflow, /concurrency:\s*\n\s+group: publish-/);
	assert.match(publishWorkflow, /name: npm-package/);
	assert.match(publishWorkflow, /name: npm-package\s*\n\s+path: npm-package/);
	const publishNpmJob = publishWorkflow.match(/\n  publish-npm:[\s\S]*?(?=\n  build-native-bundles:)/);
	assert.ok(publishNpmJob, "publish workflow must define the npm publication job");
	assert.match(
		publishNpmJob[0],
		/tarball=\$\(node -e 'process\.stdout\.write\(require\("node:path"\)\.resolve\(process\.argv\[1\]\)\)' "\$tarball"\)/,
	);
	assert.match(publishNpmJob[0], /npx npm@11\.18\.0 publish "\$tarball" --access public --provenance/);
	assert.match(
		publishWorkflow,
		/publish-npm:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- verify-package-consumers\s*\n\s+- build-native-bundles/,
	);
	assert.match(
		publishWorkflow,
		/build-native-bundles:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- verify-package-consumers/,
	);
	assert.match(publishWorkflow, /verify-package-consumers:/);
	for (const os of ["ubuntu-latest", "macos-14", "windows-latest"]) {
		assert.match(publishWorkflow, new RegExp(`- os: ${os}`));
	}
	for (const nodeVersion of ["22.22.0", "24.18.0", "25"]) {
		assert.match(publishWorkflow, new RegExp(`node: "${nodeVersion.replace(/\./g, "\\.")}"`));
	}
	const consumerJob = publishWorkflow.match(
		/\n  verify-package-consumers:[\s\S]*?(?=\n  publish-npm:)/,
	);
	assert.ok(consumerJob, "publish workflow must define the package consumer job");
	assert.match(
		consumerJob[0],
		/runtime_archive="\$consumer\/node_modules\/@companion-ai\/feynman\/\.feynman\/runtime-workspace\.tgz"/,
	);
	assert.match(consumerJob[0], /runtime_archive=\$\(cygpath -u "\$runtime_archive"\)/);
	assert.match(consumerJob[0], /runtime_audit=\$\(cygpath -u "\$runtime_audit"\)/);
	assert.match(publishWorkflow, /needs\.build-native-bundles\.result == 'success'/);
	assert.match(publishWorkflow, /needs\.verify-package-consumers\.result == 'success'/);
	assert.match(publishWorkflow, /dist\.integrity/);
	assert.match(publishWorkflow, /dist\.tarball/);
	assert.match(publishWorkflow, /audit signatures --json --include-attestations/);
	assert.match(publishWorkflow, /verify-npm-provenance\.mjs/);
	assert.match(publishWorkflow, /SHOULD_PUBLISH_NPM/);
	assert.match(publishWorkflow, /needs\.verify\.outputs\.package_integrity/);
	assert.doesNotMatch(
		publishWorkflow,
		/if \[ "\$\{\{ needs\.version-check\.outputs\.should_publish_npm \}\}" = "true" \]/,
	);
});

test("GitHub release waits for verification, native bundles, and npm publication", () => {
	assert.match(
		publishWorkflow,
		/release-github:\s*\n\s+needs:\s*\n\s+- version-check\s*\n\s+- verify\s*\n\s+- publish-npm\s*\n\s+- build-native-bundles/,
	);
	assert.match(publishWorkflow, /needs\.verify\.result == 'success'/);
	assert.match(publishWorkflow, /needs\.publish-npm\.result == 'success'/);
	assert.match(publishWorkflow, /always\(\)/);
	assert.match(publishWorkflow, /pattern: native-\*/);
	assert.doesNotMatch(publishWorkflow, /gh release view "v\$VERSION" >\/dev\/null 2>&1/);
	assert.match(publishWorkflow, /release_exists=true/);
	assert.match(publishWorkflow, /release_exists=false/);
	assert.match(publishWorkflow, /--draft/);
	assert.match(publishWorkflow, /Staged release asset mismatch/);
});

test("version reconciliation and post-publish verification cover all release surfaces", () => {
	for (const id of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]) {
		assert.match(publishWorkflow, new RegExp(`feynman-.*-${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
	}
	assert.match(publishWorkflow, /SHA256SUMS/);
	assert.match(publishWorkflow, /sha256sum -c SHA256SUMS/);
	assert.match(publishWorkflow, /SHA256SUMS entry mismatch/);
	assert.match(publishWorkflow, /assets\.length === expected\.size/);
	assert.match(publishWorkflow, /Number\(asset\.size\) > 0/);
	assert.match(publishWorkflow, /verify-published-state:/);
	assert.match(publishWorkflow, /gh release download "v\$VERSION"/);
	assert.match(publishWorkflow, /npm install --prefix "\$consumer".*"@companion-ai\/feynman@\$VERSION"/);
	assert.match(publishWorkflow, /unzip -t/);
	assert.match(publishWorkflow, /targetCommitish/);
	assert.match(publishWorkflow, /asset\.digest/);
	assert.match(
		publishWorkflow,
		/repos\/\$GITHUB_REPOSITORY\/compare\/\$RELEASE_TARGET\.\.\.\$GITHUB_SHA/,
	);
	assert.match(publishWorkflow, /identical \| ahead/);
	assert.match(
		publishWorkflow,
		/npm version \$LOCAL provenance belongs to \$PUBLISHED_SOURCE_SHA, but GitHub release v\$LOCAL targets \$RELEASE_TARGET/,
	);
	assert.doesNotMatch(publishWorkflow, /npm view .* gitHead/);
	assert.doesNotMatch(
		publishWorkflow,
		/npm view "@companion-ai\/feynman@\$VERSION" version 2>\/dev\/null \|\| true/,
	);
	assert.match(publishWorkflow, /node-version-file: \.nvmrc/);
	assert.match(publishWorkflow, /npx npm@11\.18\.0 publish/);
	assert.match(publishWorkflow, /Windows native launcher failed --help/);
	assert.doesNotMatch(publishWorkflow, /npm@latest/);
	for (const workflow of [e2eWorkflow, publishWorkflow]) {
		assert.doesNotMatch(workflow, /uses: actions\/[^@\s]+@v\d/);
	}
});
