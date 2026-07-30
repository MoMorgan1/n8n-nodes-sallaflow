import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	failIfErrors,
	isProbablyText,
	parseTarGzip,
	readJson,
	repositoryPath,
	repositoryRoot,
	walkFiles,
} from './verification-lib.mjs';

const policyPath = resolve(repositoryRoot, 'security/scan-policy.json');
const supportedArchivePattern = /\.(?:tgz|tar\.gz)$/i;
const unsupportedArchivePattern = /\.(?:zip|7z|rar|tar|gz)$/i;

function hostAllowed(hostname, policy) {
	const host = hostname.toLowerCase().replace(/\.$/, '');
	if (policy.allowedExactHosts.includes(host)) return true;
	return policy.allowedDomainSuffixes.some((suffix) => {
		const normalized = suffix.toLowerCase().replace(/^\./, '');
		return host === normalized || host.endsWith(`.${normalized}`);
	});
}

function emailAllowed(email, policy) {
	if ((policy.allowedExactEmails ?? []).includes(email.toLowerCase())) return true;
	const domain = email.toLowerCase().split('@').at(-1);
	return policy.allowedEmailDomainSuffixes.some((suffix) => {
		const normalized = suffix.toLowerCase().replace(/^\./, '');
		return domain === normalized || domain.endsWith(`.${normalized}`);
	});
}

function isSyntheticSecret(value, policy) {
	const normalized = value.trim().toLowerCase();
	if (
		normalized.startsWith('${') ||
		normalized.startsWith('{{') ||
		normalized.startsWith('<') ||
		normalized.includes('process.env')
	) {
		return true;
	}
	return policy.syntheticSecretValues.some(
		(synthetic) => normalized === synthetic || normalized.startsWith(`${synthetic}-`),
	);
}

function validIpv4(value) {
	const parts = value.split('.').map(Number);
	return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
}

function allowedIp(value) {
	return value.startsWith('127.') || value === '0.0.0.0';
}

function lineAt(text, offset) {
	let line = 1;
	for (let index = 0; index < offset; index += 1) {
		if (text.charCodeAt(index) === 10) line += 1;
	}
	return line;
}

function logicalPath(label) {
	const archiveSeparator = label.lastIndexOf('!');
	if (archiveSeparator !== -1) return label.slice(archiveSeparator + 1);
	return label.replace(/^history:/, '').replace(/@[0-9a-f]{12}$/i, '');
}

function addFinding(findings, seen, label, text, offset, rule) {
	const line = lineAt(text, offset);
	const key = `${label}\0${line}\0${rule}`;
	if (seen.has(key)) return;
	seen.add(key);
	findings.push({ label, line, rule });
}

export function scanText(label, text, policy) {
	const findings = [];
	const seen = new Set();
	const path = logicalPath(label);

	const tokenRules = [
		['private key material', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
		['GitHub personal access token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
		['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
		['npm access token', /\bnpm_[A-Za-z0-9]{20,}\b/g],
		['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g],
		['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
		['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
		['Stripe live key', /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g],
		['JWT-like token', /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
	];
	for (const [rule, pattern] of tokenRules) {
		for (const match of text.matchAll(pattern)) {
			addFinding(findings, seen, label, text, match.index, rule);
		}
	}

	const secretAssignment =
		/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|npm[_-]?token|github[_-]?token|password|database[_-]?url)\b["']?\s*[:=]\s*(["'`])([^"'`\r\n]{1,512})\2/gi;
	for (const match of text.matchAll(secretAssignment)) {
		if (!isSyntheticSecret(match[3], policy)) {
			addFinding(
				findings,
				seen,
				label,
				text,
				match.index,
				`literal value assigned to ${match[1].toLowerCase()}`,
			);
		}
	}

	if (basename(path) !== 'package-lock.json') {
		const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;
		for (const match of text.matchAll(urlPattern)) {
			const candidate = match[0].replace(/[\])},.;]+$/g, '');
			let url;
			try {
				url = new URL(candidate);
			} catch {
				addFinding(findings, seen, label, text, match.index, 'malformed absolute URL');
				continue;
			}
			if (url.username || url.password) {
				addFinding(findings, seen, label, text, match.index, 'URL contains user information');
			}
			if (!hostAllowed(url.hostname, policy)) {
				addFinding(findings, seen, label, text, match.index, 'URL host is not on the public allowlist');
			}
		}
	}

	const connectionString = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"'`]+/gi;
	for (const match of text.matchAll(connectionString)) {
		addFinding(findings, seen, label, text, match.index, 'database connection string');
	}

	const ipv4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
	for (const match of text.matchAll(ipv4)) {
		if (validIpv4(match[0]) && !allowedIp(match[0])) {
			addFinding(findings, seen, label, text, match.index, 'non-loopback IP address');
		}
	}

	if (basename(path) !== 'package-lock.json') {
		const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
		for (const match of text.matchAll(email)) {
			if (!emailAllowed(match[0], policy)) {
				addFinding(findings, seen, label, text, match.index, 'email domain is not on the public allowlist');
			}
		}
	}

	const contextualIdentifier =
		/\b(?:merchant|store|demo|customer|product|order|branch|courier|country|city|district|option|variant)[a-z_-]{0,40}id\b["']?\s*[:=]\s*["']?(\d{7,})\b/gi;
	for (const match of text.matchAll(contextualIdentifier)) {
		addFinding(findings, seen, label, text, match.index, 'long business identifier may be real data');
	}

	if (path !== 'security/scan-policy.json') {
		for (const fragment of policy.forbiddenPathFragments) {
			let offset = text.indexOf(fragment);
			while (offset !== -1) {
				addFinding(findings, seen, label, text, offset, 'private operational path');
				offset = text.indexOf(fragment, offset + fragment.length);
			}
		}
	}

	return findings;
}

function sensitiveFilename(label) {
	const name = basename(logicalPath(label)).toLowerCase();
	if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) return true;
	if (['id_rsa', 'id_dsa', 'id_ed25519'].includes(name)) return true;
	return /\.(?:pem|p12|pfx|keystore)$/i.test(name);
}

export async function scanBuffer(label, buffer, policy) {
	const findings = [];
	if (sensitiveFilename(label)) findings.push({ label, line: 1, rule: 'sensitive filename' });
	if (isProbablyText(buffer)) {
		let text = buffer.toString('utf8');
		if (logicalPath(label).endsWith('.map')) {
			try {
				const sourceMap = JSON.parse(text);
				text = JSON.stringify({
					file: sourceMap.file,
					sourceRoot: sourceMap.sourceRoot,
					sources: sourceMap.sources,
					names: sourceMap.names,
					sourcesContent: sourceMap.sourcesContent,
				});
			} catch {
				// Invalid source maps are scanned as ordinary text and rejected elsewhere.
			}
		}
		findings.push(...scanText(label, text, policy));
	}
	return findings;
}

export async function scanArchiveBuffer(label, buffer, policy) {
	const findings = [];
	let entries;
	try {
		entries = parseTarGzip(buffer);
	} catch (error) {
		return [{ label, line: 1, rule: `invalid tarball: ${error.message}` }];
	}
	for (const entry of entries) {
		if (entry.type !== '0' && entry.type !== '\0') {
			if (entry.type === '2' || entry.type === '1') {
				findings.push({
					label: `${label}!${entry.path}`,
					line: 1,
					rule: 'archive contains a link',
				});
			}
			continue;
		}
		findings.push(
			...(await scanBuffer(`${label}!${entry.path}`, entry.data, policy)),
		);
	}
	return findings;
}

async function scanArchive(path, policy) {
	return scanArchiveBuffer(repositoryPath(path), await readFile(path), policy);
}

export async function scanTargets(targets, options = {}) {
	const policy = options.policy ?? (await readJson(policyPath));
	const ignoredDirectories = new Set(policy.ignoredDirectories);
	const findings = [];
	let scannedFiles = 0;

	for (const target of targets) {
		const absolute = resolve(repositoryRoot, target);
		if (supportedArchivePattern.test(absolute)) {
			findings.push(...(await scanArchive(absolute, policy)));
			scannedFiles += 1;
			continue;
		}
		let entries;
		try {
			entries = await walkFiles(absolute, {
				ignoreDirectories: ignoredDirectories,
				includeSymlinks: true,
			});
		} catch (error) {
			findings.push({
				label: repositoryPath(absolute),
				line: 1,
				rule: `scan target unavailable: ${error.code ?? error.message}`,
			});
			continue;
		}
		for (const entry of entries) {
			const label = repositoryPath(entry.path);
			if (entry.type === 'symlink') {
				findings.push({ label, line: 1, rule: 'symbolic link in public tree' });
				continue;
			}
			scannedFiles += 1;
			if (supportedArchivePattern.test(entry.path)) {
				findings.push(...(await scanArchive(entry.path, policy)));
			} else if (unsupportedArchivePattern.test(entry.path)) {
				findings.push({
					label,
					line: 1,
					rule: 'unsupported archive format in public tree',
				});
			} else {
				findings.push(...(await scanBuffer(label, await readFile(entry.path), policy)));
			}
		}
	}

	return { findings, scannedFiles };
}

export async function main(args = process.argv.slice(2)) {
	const targets = [];
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === '--target' || argument === '--tarball') {
			const value = args[index + 1];
			if (!value) throw new Error(`${argument} requires a path`);
			targets.push(value);
			index += 1;
		} else if (argument === '--help') {
			console.log(
				'Usage: node scripts/scan-sensitive.mjs [--target PATH] [--tarball PACKAGE.tgz]',
			);
			return;
		} else {
			targets.push(argument);
		}
	}
	if (targets.length === 0) targets.push(repositoryRoot);

	const { findings, scannedFiles } = await scanTargets(targets);
	failIfErrors(
		findings.map(({ label, line, rule }) => `${label}:${line}: ${rule}`),
		'Sensitive-data scan failed (matched values are intentionally redacted)',
	);
	console.log(`Sensitive-data scan passed: ${scannedFiles} files checked.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
