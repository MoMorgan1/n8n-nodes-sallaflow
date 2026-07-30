import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const execFileAsync = promisify(execFile);

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function toPosixPath(value) {
	return value.split(sep).join('/');
}

export function repositoryPath(path) {
	return toPosixPath(relative(repositoryRoot, path)) || '.';
}

export async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

export function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function failIfErrors(errors, heading) {
	if (errors.length === 0) return;
	const error = new Error(`${heading}\n${errors.map((item) => `- ${item}`).join('\n')}`);
	error.validationErrors = errors;
	throw error;
}

export async function walkFiles(root, options = {}) {
	const {
		ignoreDirectories = new Set(),
		includeSymlinks = false,
	} = options;
	const results = [];

	async function visit(path) {
		const stat = await lstat(path);
		if (stat.isSymbolicLink()) {
			if (includeSymlinks) results.push({ path, stat, type: 'symlink' });
			return;
		}
		if (stat.isDirectory()) {
			if (path !== root && ignoreDirectories.has(path.split(sep).at(-1))) return;
			const names = await readdir(path);
			names.sort((a, b) => a.localeCompare(b));
			for (const name of names) await visit(resolve(path, name));
			return;
		}
		if (stat.isFile()) results.push({ path, stat, type: 'file' });
	}

	await visit(root);
	return results;
}

export async function runFile(command, args, options = {}) {
	try {
		return await execFileAsync(command, args, {
			cwd: repositoryRoot,
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
			...options,
			shell: false,
		});
	} catch (error) {
		const details = [error.stderr, error.stdout].filter(Boolean).join('\n').trim();
		throw new Error(
			`${command} ${args.join(' ')} failed${details ? `:\n${details}` : ''}`,
			{ cause: error },
		);
	}
}

function parseTarNumber(field) {
	if ((field[0] & 0x80) !== 0) {
		let value = BigInt(field[0] & 0x7f);
		for (let index = 1; index < field.length; index += 1) {
			value = (value << 8n) | BigInt(field[index]);
		}
		if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error('Tar entry number exceeds JavaScript safe integer range');
		}
		return Number(value);
	}
	const text = field.toString('ascii').replace(/\0.*$/s, '').trim();
	return text === '' ? 0 : Number.parseInt(text, 8);
}

function parsePax(data) {
	const values = {};
	let offset = 0;
	while (offset < data.length) {
		const space = data.indexOf(0x20, offset);
		if (space === -1) throw new Error('Malformed PAX record length');
		const length = Number.parseInt(data.toString('ascii', offset, space), 10);
		if (!Number.isSafeInteger(length) || length <= 0 || offset + length > data.length) {
			throw new Error('Invalid PAX record length');
		}
		const record = data.toString('utf8', space + 1, offset + length).replace(/\n$/, '');
		const equals = record.indexOf('=');
		if (equals !== -1) values[record.slice(0, equals)] = record.slice(equals + 1);
		offset += length;
	}
	return values;
}

function cleanTarString(field) {
	const nul = field.indexOf(0);
	return field.toString('utf8', 0, nul === -1 ? field.length : nul);
}

function verifyHeaderChecksum(header, expected) {
	const copy = Buffer.from(header);
	copy.fill(0x20, 148, 156);
	let actual = 0;
	for (const byte of copy) actual += byte;
	if (actual !== expected) {
		throw new Error(`Invalid tar header checksum: expected ${expected}, calculated ${actual}`);
	}
}

export function normalizeArchivePath(path) {
	if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/')) {
		throw new Error(`Unsafe archive path ${JSON.stringify(path)}`);
	}
	const parts = path.split('/');
	if (parts.some((part) => part === '' || part === '.' || part === '..')) {
		throw new Error(`Unsafe archive path ${JSON.stringify(path)}`);
	}
	return parts.join('/');
}

export function parseTarGzip(buffer) {
	const tar = gunzipSync(buffer, { maxOutputLength: 64 * 1024 * 1024 });
	const entries = [];
	let offset = 0;
	let nextPax = {};
	let globalPax = {};
	let longPath;

	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		offset += 512;
		if (header.every((byte) => byte === 0)) break;

		const checksum = parseTarNumber(header.subarray(148, 156));
		verifyHeaderChecksum(header, checksum);
		const name = cleanTarString(header.subarray(0, 100));
		const prefix = cleanTarString(header.subarray(345, 500));
		const headerPath = prefix ? `${prefix}/${name}` : name;
		const size = parseTarNumber(header.subarray(124, 136));
		const mode = parseTarNumber(header.subarray(100, 108));
		const type = String.fromCharCode(header[156] || 0x30);
		const linkPath = cleanTarString(header.subarray(157, 257));
		const paddedSize = Math.ceil(size / 512) * 512;
		if (offset + paddedSize > tar.length) throw new Error(`Truncated tar entry ${headerPath}`);
		const data = Buffer.from(tar.subarray(offset, offset + size));
		offset += paddedSize;

		if (type === 'x') {
			nextPax = { ...nextPax, ...parsePax(data) };
			continue;
		}
		if (type === 'g') {
			globalPax = { ...globalPax, ...parsePax(data) };
			continue;
		}
		if (type === 'L') {
			longPath = cleanTarString(data);
			continue;
		}

		const attributes = { ...globalPax, ...nextPax };
		const path = normalizeArchivePath(attributes.path || longPath || headerPath);
		entries.push({
			path,
			type,
			mode,
			size,
			linkPath: attributes.linkpath || linkPath || null,
			data,
		});
		nextPax = {};
		longPath = undefined;
	}

	return entries;
}

export function isProbablyText(buffer) {
	if (buffer.length === 0) return true;
	const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
	let suspicious = 0;
	for (const byte of sample) {
		if (byte === 0) return false;
		if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
	}
	return suspicious / sample.length < 0.01;
}
