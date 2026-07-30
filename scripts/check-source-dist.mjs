import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import {
	failIfErrors,
	readJson,
	repositoryRoot,
	runFile,
	toPosixPath,
	walkFiles,
} from './verification-lib.mjs';

const errors = [];
const temporaryRoot = await mkdtemp(join(tmpdir(), 'sallaflow-source-dist-'));
const generatedRoot = resolve(temporaryRoot, 'dist');
const sourcePackagePath = resolve(repositoryRoot, 'package.json');
const distRoot = resolve(repositoryRoot, 'dist');

function normalizedMap(value) {
	const parsed = JSON.parse(value);
	return {
		version: parsed.version,
		file: parsed.file,
		names: parsed.names,
		mappings: parsed.mappings,
		sources: (parsed.sources ?? []).map((source) => {
			const normalized = source.replaceAll('\\', '/');
			for (const marker of ['/credentials/', '/nodes/']) {
				const index = normalized.indexOf(marker);
				if (index !== -1) return normalized.slice(index + 1);
			}
			return basename(normalized);
		}),
		sourcesContent: parsed.sourcesContent ?? null,
	};
}

async function compareFile(generatedPath, committedPath, relativePath) {
	let generated;
	let committed;
	try {
		[generated, committed] = await Promise.all([
			readFile(generatedPath),
			readFile(committedPath),
		]);
	} catch (error) {
		errors.push(`${relativePath} is missing: ${error.code ?? error.message}`);
		return;
	}
	if (relativePath.endsWith('.map')) {
		try {
			if (
				JSON.stringify(normalizedMap(generated.toString('utf8'))) !==
				JSON.stringify(normalizedMap(committed.toString('utf8')))
			) {
				errors.push(`${relativePath} differs from a clean TypeScript build`);
			}
		} catch (error) {
			errors.push(`${relativePath} is not a valid source map: ${error.message}`);
		}
		return;
	}
	if (!generated.equals(committed)) {
		errors.push(`${relativePath} differs from a clean TypeScript build`);
	}
}

try {
	const typescriptCli = resolve(repositoryRoot, 'node_modules/typescript/bin/tsc');
	await runFile(
		process.execPath,
		[
			typescriptCli,
			'--project',
			resolve(repositoryRoot, 'tsconfig.json'),
			'--outDir',
			generatedRoot,
			'--incremental',
			'false',
		],
		{ cwd: repositoryRoot },
	);

	const generatedFiles = await walkFiles(generatedRoot);
	const expectedDistFiles = new Set();
	for (const { path } of generatedFiles) {
		const relativePath = toPosixPath(relative(generatedRoot, path));
		expectedDistFiles.add(relativePath);
		await compareFile(path, resolve(distRoot, relativePath), relativePath);
	}

	for (const sourceDirectory of ['credentials', 'nodes']) {
		const absoluteSource = resolve(repositoryRoot, sourceDirectory);
		for (const { path } of await walkFiles(absoluteSource)) {
			if (!path.endsWith('.svg') && !path.endsWith('.json')) continue;
			const relativePath = toPosixPath(relative(repositoryRoot, path));
			expectedDistFiles.add(relativePath);
			let source;
			let built;
			try {
				[source, built] = await Promise.all([
					readFile(path),
					readFile(resolve(distRoot, relativePath)),
				]);
			} catch (error) {
				errors.push(`${relativePath} was not copied to dist: ${error.code ?? error.message}`);
				continue;
			}
			if (!source.equals(built)) errors.push(`${relativePath} differs between source and dist`);
		}
	}

	expectedDistFiles.add('package.json');
	try {
		const [sourcePackage, distPackage] = await Promise.all([
			readJson(sourcePackagePath),
			readJson(resolve(distRoot, 'package.json')),
		]);
		if (JSON.stringify(sourcePackage) !== JSON.stringify(distPackage)) {
			errors.push('dist/package.json differs from package.json');
		}
	} catch (error) {
		errors.push(`Package metadata comparison failed: ${error.message}`);
	}

	const committedFiles = await walkFiles(distRoot);
	for (const { path } of committedFiles) {
		const relativePath = toPosixPath(relative(distRoot, path));
		if (!expectedDistFiles.has(relativePath)) {
			errors.push(`Unexpected generated file in dist: ${relativePath}`);
		}
	}
} finally {
	await rm(temporaryRoot, { recursive: true, force: true });
}

failIfErrors(errors, 'Source/dist verification failed');
console.log('Source/dist verification passed using an isolated TypeScript build (Git not required).');
