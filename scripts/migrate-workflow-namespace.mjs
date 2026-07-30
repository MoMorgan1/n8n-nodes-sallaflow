#!/usr/bin/env node

import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_NODE_TYPES = Object.freeze({
	'CUSTOM.sallaFlow': 'n8n-nodes-sallaflow.sallaFlow',
	'CUSTOM.sallaFlowTrigger': 'n8n-nodes-sallaflow.sallaFlowTrigger',
});

function workflowDocuments(document) {
	const workflows = Array.isArray(document) ? document : [document];
	if (
		workflows.length === 0 ||
		workflows.some(
			(workflow) =>
				workflow === null ||
				typeof workflow !== 'object' ||
				Array.isArray(workflow) ||
				!Array.isArray(workflow.nodes),
		)
	) {
		throw new TypeError('Expected an n8n workflow object or an array of n8n workflow objects');
	}
	return workflows;
}

export function findLegacySallaFlowNodeTypes(document) {
	const matches = [];
	for (const [workflowIndex, workflow] of workflowDocuments(document).entries()) {
		for (const [nodeIndex, node] of workflow.nodes.entries()) {
			if (
				node !== null &&
				typeof node === 'object' &&
				!Array.isArray(node) &&
				Object.hasOwn(PUBLIC_NODE_TYPES, node.type)
			) {
				matches.push({
					workflowIndex,
					nodeIndex,
					nodeName: typeof node.name === 'string' ? node.name : null,
					from: node.type,
					to: PUBLIC_NODE_TYPES[node.type],
				});
			}
		}
	}
	return matches;
}

export function migrateSallaFlowNodeTypes(document) {
	workflowDocuments(document);
	const migrated = structuredClone(document);
	const matches = findLegacySallaFlowNodeTypes(migrated);
	const workflows = Array.isArray(migrated) ? migrated : [migrated];

	for (const match of matches) {
		workflows[match.workflowIndex].nodes[match.nodeIndex].type = match.to;
	}

	return { workflow: migrated, migrations: matches };
}

function usage() {
	return [
		'Usage:',
		'  node scripts/migrate-workflow-namespace.mjs --check <workflow.json>',
		'  node scripts/migrate-workflow-namespace.mjs <input.json> <new-output.json>',
	].join('\n');
}

async function readWorkflow(path) {
	let content;
	try {
		content = await readFile(path, 'utf8');
	} catch (error) {
		throw new Error(`Could not read ${path}: ${error.message}`, { cause: error });
	}
	try {
		return JSON.parse(content);
	} catch (error) {
		throw new Error(`Could not parse ${path} as JSON: ${error.message}`, { cause: error });
	}
}

async function runCli(argv) {
	if (argv[0] === '--check') {
		if (argv.length !== 2) throw new Error(usage());
		const inputPath = resolve(argv[1]);
		const workflow = await readWorkflow(inputPath);
		const matches = findLegacySallaFlowNodeTypes(workflow);
		if (matches.length > 0) {
			throw new Error(
				`${inputPath} still contains ${matches.length} hosted/custom SallaFlow node type reference(s)`,
			);
		}
		console.log(`${inputPath} contains no hosted/custom SallaFlow node type references.`);
		return;
	}

	if (argv.length !== 2) throw new Error(usage());
	const inputPath = resolve(argv[0]);
	const outputPath = resolve(argv[1]);
	if (inputPath === outputPath) {
		throw new Error(
			'Input and output paths must differ; this helper never overwrites the source export',
		);
	}
	try {
		await access(outputPath, constants.F_OK);
		throw new Error(`Output already exists: ${outputPath}`);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
	}

	const workflow = await readWorkflow(inputPath);
	const { workflow: migrated, migrations } = migrateSallaFlowNodeTypes(workflow);
	if (migrations.length === 0) {
		throw new Error(
			'No exact CUSTOM.sallaFlow or CUSTOM.sallaFlowTrigger node types were found; no output was written',
		);
	}
	await writeFile(outputPath, `${JSON.stringify(migrated, null, 2)}\n`, {
		encoding: 'utf8',
		flag: 'wx',
		mode: 0o600,
	});
	console.log(
		`Migrated ${migrations.length} SallaFlow node type reference(s) and wrote ${outputPath}.`,
	);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
	runCli(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
