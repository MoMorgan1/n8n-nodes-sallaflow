import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scanText } from '../scripts/scan-sensitive.mjs';

const policy = JSON.parse(
	readFileSync(new URL('../security/scan-policy.json', import.meta.url), 'utf8'),
);

test('history labels preserve package-lock and scan-policy path handling', () => {
	const dependencyMetadata = JSON.stringify({
		resolved: ['https:', '', 'registry.vendor.invalid', 'package'].join('/'),
		email: ['owner', 'vendor.invalid'].join('@'),
	});
	assert.deepEqual(
		scanText(
			'history:package-lock.json@abcdef123456',
			dependencyMetadata,
			policy,
		),
		[],
	);
	const forbiddenPolicy = JSON.stringify({
		forbiddenPathFragments: [policy.forbiddenPathFragments[0]],
	});
	assert.deepEqual(
		scanText(
			'history:security/scan-policy.json@abcdef123456',
			forbiddenPolicy,
			policy,
		),
		[],
	);
});

test('history labels do not suppress private paths in ordinary files', () => {
	const findings = scanText(
		'history:docs/example.md@abcdef123456',
		`Operator copy lives at ${policy.forbiddenPathFragments[0]}/private.txt`,
		policy,
	);
	assert.equal(findings.length, 1);
	assert.equal(findings[0].rule, 'private operational path');
});
