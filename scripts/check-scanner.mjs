import {
	analyzePackage,
	SOURCE_FILE_PATTERNS,
} from '@n8n/scan-community-package/scanner/scanner.mjs';

const checks = [
	['source', SOURCE_FILE_PATTERNS],
	['compiled package', ['package.json', 'dist/**/*.js']],
];
let failed = false;

for (const [label, patterns] of checks) {
	const result = await analyzePackage(process.cwd(), patterns);
	if (result.passed) {
		console.log(`n8n scanner ${label} check passed`);
		continue;
	}

	failed = true;
	console.error(`n8n scanner ${label} check failed: ${result.message}`);
	if (result.details) console.error(result.details);
}

if (failed) process.exitCode = 1;
