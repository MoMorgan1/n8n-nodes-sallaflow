import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	failIfErrors,
	parseTarGzip,
	readJson,
	repositoryRoot,
	runFile,
	sha256,
} from './verification-lib.mjs';
import { scanBuffer } from './scan-sensitive.mjs';

const tarballPolicyPath = resolve(repositoryRoot, 'security/tarball-policy.json');
const scanPolicyPath = resolve(repositoryRoot, 'security/scan-policy.json');

function digest(buffer, algorithm, encoding = 'hex') {
	return createHash(algorithm).update(buffer).digest(encoding);
}

function compilePatterns(patterns) {
	return patterns.map((pattern) => new RegExp(pattern));
}

async function createPack(destination) {
	const { stdout } = await runFile(
		'npm',
		['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
		{ cwd: repositoryRoot },
	);

	let metadata = null;
	if (stdout.trim()) {
		let result;
		try {
			result = JSON.parse(stdout);
		} catch (error) {
			throw new Error(`npm pack returned invalid JSON: ${error.message}`);
		}
		if (!Array.isArray(result) || result.length !== 1 || !result[0].filename) {
			throw new Error('npm pack did not describe exactly one tarball');
		}
		[metadata] = result;
	}

	// npm 11 can emit no JSON when --pack-destination is used through a
	// non-interactive child process, despite successfully writing the archive.
	// The destination is isolated, so its single .tgz is an unambiguous fallback.
	const archives = (await readdir(destination)).filter((name) => name.endsWith('.tgz'));
	if (archives.length !== 1) {
		throw new Error(`npm pack wrote ${archives.length} tarballs; expected exactly one`);
	}
	if (metadata?.filename && metadata.filename !== archives[0]) {
		throw new Error('npm pack JSON filename differs from the archive written to disk');
	}
	const path = resolve(destination, archives[0]);
	return { path, metadata, buffer: await readFile(path) };
}

export async function verifyTarball(path, npmMetadata = null) {
	const [sourcePackage, policy, scanPolicy, buffer] = await Promise.all([
		readJson(resolve(repositoryRoot, 'package.json')),
		readJson(tarballPolicyPath),
		readJson(scanPolicyPath),
		readFile(path),
	]);
	const errors = [];
	let entries;
	try {
		entries = parseTarGzip(buffer);
	} catch (error) {
		throw new Error(`Tarball parsing failed: ${error.message}`);
	}

	const allowedPatterns = compilePatterns(policy.allowedFilePatterns);
	const forbiddenPatterns = compilePatterns(policy.forbiddenFilePatterns);
	const regularEntries = [];
	const seen = new Set();
	let totalBytes = 0;

	for (const entry of entries) {
		if (entry.type !== '0' && entry.type !== '\0') {
			if (entry.type !== '5') errors.push(`${entry.path} is not a regular file`);
			continue;
		}
		regularEntries.push(entry);
		totalBytes += entry.size;
		if (seen.has(entry.path)) errors.push(`Duplicate tarball path: ${entry.path}`);
		seen.add(entry.path);
		if (!allowedPatterns.some((pattern) => pattern.test(entry.path))) {
			errors.push(`Tarball path is not allowlisted: ${entry.path}`);
		}
		if (forbiddenPatterns.some((pattern) => pattern.test(entry.path))) {
			errors.push(`Tarball path is forbidden: ${entry.path}`);
		}
		if (entry.size > policy.maximumFileBytes) {
			errors.push(`${entry.path} exceeds ${policy.maximumFileBytes} bytes`);
		}
		if ((entry.mode & 0o111) !== 0) errors.push(`${entry.path} is unexpectedly executable`);
	}

	for (const required of policy.requiredFiles) {
		if (!seen.has(required)) errors.push(`Required tarball file is missing: ${required}`);
	}
	if (regularEntries.length > policy.maximumFileCount) {
		errors.push(`Tarball has ${regularEntries.length} files; maximum is ${policy.maximumFileCount}`);
	}
	if (totalBytes > policy.maximumUnpackedBytes) {
		errors.push(`Tarball unpacks to ${totalBytes} bytes; maximum is ${policy.maximumUnpackedBytes}`);
	}

	const packageEntry = regularEntries.find(({ path: entryPath }) => entryPath === 'package/package.json');
	let packedPackage;
	if (!packageEntry) {
		errors.push('Tarball has no root package.json');
	} else {
		try {
			packedPackage = JSON.parse(packageEntry.data.toString('utf8'));
		} catch (error) {
			errors.push(`Packed package.json is invalid: ${error.message}`);
		}
	}

	if (packedPackage) {
		for (const field of ['name', 'version', 'description', 'license', 'main', 'n8n']) {
			if (JSON.stringify(packedPackage[field]) !== JSON.stringify(sourcePackage[field])) {
				errors.push(`Packed package.json field ${field} differs from source`);
			}
		}
		if (packedPackage.private === true) errors.push('Packed package is marked private');
		if (packedPackage.dependencies && Object.keys(packedPackage.dependencies).length > 0) {
			errors.push('Packed package contains runtime dependencies');
		}
		const unexpectedPeers = Object.keys(packedPackage.peerDependencies ?? {}).filter(
			(name) => name !== 'n8n-workflow',
		);
		if (unexpectedPeers.length > 0) {
			errors.push(`Unexpected peer dependencies: ${unexpectedPeers.join(', ')}`);
		}
		for (const entry of [
			packedPackage.main,
			...(packedPackage.n8n?.nodes ?? []),
			...(packedPackage.n8n?.credentials ?? []),
		]) {
			if (!seen.has(`package/${entry}`)) errors.push(`Packed entry point is missing: ${entry}`);
		}
	}

	if (npmMetadata) {
		const npmPaths = (npmMetadata.files ?? []).map(({ path: filePath }) => `package/${filePath}`).sort();
		const tarPaths = regularEntries.map(({ path: entryPath }) => entryPath).sort();
		if (JSON.stringify(npmPaths) !== JSON.stringify(tarPaths)) {
			errors.push('npm file inventory differs from parsed tarball inventory');
		}
		const shasum = digest(buffer, 'sha1');
		const integrity = `sha512-${digest(buffer, 'sha512', 'base64')}`;
		if (npmMetadata.shasum !== shasum) errors.push('npm-reported SHA-1 differs from tarball bytes');
		if (npmMetadata.integrity !== integrity) errors.push('npm-reported integrity differs from tarball bytes');
		if (npmMetadata.name !== sourcePackage.name || npmMetadata.version !== sourcePackage.version) {
			errors.push('npm pack identity differs from source package identity');
		}
	}

	const scanFindings = [];
	for (const entry of regularEntries) {
		scanFindings.push(
			...(await scanBuffer(`tarball!${entry.path}`, entry.data, scanPolicy)),
		);
	}
	for (const finding of scanFindings) {
		errors.push(`${finding.label}:${finding.line}: ${finding.rule}`);
	}

	failIfErrors(errors, 'Package tarball verification failed');
	return {
		path,
		sha256: sha256(buffer),
		files: regularEntries.length,
		packedBytes: buffer.length,
		unpackedBytes: totalBytes,
	};
}

export async function main(args = process.argv.slice(2)) {
	let suppliedTarball;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === '--tarball') {
			suppliedTarball = args[index + 1];
			if (!suppliedTarball) throw new Error('--tarball requires a path');
			index += 1;
		} else if (args[index] === '--help') {
			console.log('Usage: node scripts/pack-verify.mjs [--tarball PACKAGE.tgz]');
			return;
		} else {
			throw new Error(`Unknown argument: ${args[index]}`);
		}
	}

	if (suppliedTarball) {
		const result = await verifyTarball(resolve(repositoryRoot, suppliedTarball));
		console.log(
			`Package tarball verification passed: ${result.files} files, SHA-256 ${result.sha256}.`,
		);
		return result;
	}

	const temporaryRoot = await mkdtemp(join(tmpdir(), 'sallaflow-pack-'));
	try {
		const firstDirectory = resolve(temporaryRoot, 'first');
		const secondDirectory = resolve(temporaryRoot, 'second');
		await Promise.all([mkdir(firstDirectory), mkdir(secondDirectory)]);
		const first = await createPack(firstDirectory);
		const second = await createPack(secondDirectory);
		const firstHash = sha256(first.buffer);
		const secondHash = sha256(second.buffer);
		if (firstHash !== secondHash) {
			throw new Error(
				`Independent npm pack operations were not reproducible: ${firstHash} != ${secondHash}`,
			);
		}
		const result = await verifyTarball(first.path, first.metadata);
		console.log(
			`Package tarball verification passed: ${result.files} files, reproducible SHA-256 ${result.sha256}.`,
		);
		return result;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	await main();
}
