import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	failIfErrors,
	isProbablyText,
	readJson,
	repositoryRoot,
	runFile,
} from './verification-lib.mjs';
import { scanArchiveBuffer, scanBuffer } from './scan-sensitive.mjs';

const scanPolicyPath = resolve(repositoryRoot, 'security/scan-policy.json');
const maximumBlobBytes = 5 * 1024 * 1024;
const archivePattern = /\.(?:tgz|tar\.gz)$/i;
const unsupportedArchivePattern = /\.(?:zip|7z|rar|tar|gz)$/i;

function safeHistoryPath(path, objectId) {
	if (!path || path.startsWith('.git/') || path === '.git') {
		return `history:unpathed-blob@${objectId.slice(0, 12)}`;
	}
	return `history:${path}@${objectId.slice(0, 12)}`;
}

async function git(args, options = {}) {
	return runFile('git', args, { cwd: repositoryRoot, ...options });
}

async function repositoryAvailable() {
	try {
		const { stdout } = await git(['rev-parse', '--is-inside-work-tree']);
		return stdout.trim() === 'true';
	} catch {
		return false;
	}
}

function parseObjectLines(output) {
	const objects = new Map();
	for (const line of output.split('\n')) {
		if (!line) continue;
		const separator = line.indexOf(' ');
		const objectId = separator === -1 ? line : line.slice(0, separator);
		const path = separator === -1 ? null : line.slice(separator + 1);
		const current = objects.get(objectId) ?? { objectId, paths: new Set() };
		if (path) current.paths.add(path);
		objects.set(objectId, current);
	}
	return objects;
}

async function addTreeMetadata(objects, findings) {
	const { stdout: commitOutput } = await git(['rev-list', '--all']);
	const commits = commitOutput.trim() ? commitOutput.trim().split('\n') : [];
	for (const commit of commits) {
		const { stdout } = await git(['ls-tree', '-r', '-z', '--full-tree', commit], {
			encoding: 'buffer',
			maxBuffer: 32 * 1024 * 1024,
		});
		for (const record of stdout.toString('utf8').split('\0')) {
			if (!record) continue;
			const tab = record.indexOf('\t');
			if (tab === -1) continue;
			const metadata = record.slice(0, tab).split(' ');
			const [mode, type, objectId] = metadata;
			const path = record.slice(tab + 1);
			if (type === 'blob') {
				const current = objects.get(objectId) ?? { objectId, paths: new Set() };
				current.paths.add(path);
				objects.set(objectId, current);
			}
			if (mode === '120000') {
				findings.push(`history:${path}@${commit.slice(0, 12)}: symbolic link`);
			}
			if (mode === '160000') {
				findings.push(`history:${path}@${commit.slice(0, 12)}: Git submodule`);
			}
		}
	}
}

export async function main() {
	if (!(await repositoryAvailable())) {
		console.log('Git history scan skipped: repository has not been initialized yet.');
		return;
	}

	let objectOutput;
	try {
		({ stdout: objectOutput } = await git(['rev-list', '--objects', '--all']));
	} catch (error) {
		if (/does not have any commits|bad revision|unknown revision/i.test(error.message)) {
			console.log('Git history scan skipped: repository has no reachable commits yet.');
			return;
		}
		throw error;
	}
	if (!objectOutput.trim()) {
		console.log('Git history scan passed: no reachable objects.');
		return;
	}

	const objects = parseObjectLines(objectOutput);
	const findings = [];
	await addTreeMetadata(objects, findings);
	const policy = await readJson(scanPolicyPath);
	let scannedBlobs = 0;

	for (const object of objects.values()) {
		const { stdout: typeOutput } = await git(['cat-file', '-t', object.objectId]);
		if (typeOutput.trim() !== 'blob') continue;
		scannedBlobs += 1;
		const paths = object.paths.size > 0 ? [...object.paths] : [null];
		const label = safeHistoryPath(paths[0], object.objectId);
		const { stdout: sizeOutput } = await git(['cat-file', '-s', object.objectId]);
		const size = Number.parseInt(sizeOutput.trim(), 10);
		if (!Number.isSafeInteger(size) || size < 0) {
			findings.push(`${label}: invalid blob size`);
			continue;
		}
		if (size > maximumBlobBytes) {
			findings.push(`${label}: blob exceeds ${maximumBlobBytes} bytes`);
			continue;
		}

		const { stdout: buffer } = await git(['cat-file', 'blob', object.objectId], {
			encoding: 'buffer',
			maxBuffer: maximumBlobBytes + 1024,
		});
		for (const path of paths) {
			const pathLabel = safeHistoryPath(path, object.objectId);
			let blobFindings;
			if (archivePattern.test(path ?? '')) {
				blobFindings = await scanArchiveBuffer(pathLabel, buffer, policy);
			} else if (unsupportedArchivePattern.test(path ?? '') && !isProbablyText(buffer)) {
				blobFindings = [{ label: pathLabel, line: 1, rule: 'unsupported binary archive in history' }];
			} else {
				blobFindings = await scanBuffer(pathLabel, buffer, policy);
			}
			for (const finding of blobFindings) {
				findings.push(`${finding.label}:${finding.line}: ${finding.rule}`);
			}
		}
	}

	failIfErrors(
		findings,
		'Git history scan failed (matched values and .git paths are intentionally omitted)',
	);
	console.log(`Git history scan passed: ${scannedBlobs} unique reachable blobs checked.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	await main();
}
