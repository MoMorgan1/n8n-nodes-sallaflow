import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import {
	PUBLIC_NODE_TYPES,
	findLegacySallaFlowNodeTypes,
	migrateSallaFlowNodeTypes,
} from './migrate-workflow-namespace.mjs';
import { failIfErrors, readJson, repositoryRoot } from './verification-lib.mjs';

const require = createRequire(import.meta.url);
const fixturePaths = [
	resolve(repositoryRoot, 'tests/fixtures/public-npm-0.5.2.json'),
	resolve(repositoryRoot, 'tests/fixtures/hosted-0.6.1.json'),
];
const publicWorkflowPath = resolve(repositoryRoot, 'examples/compatibility/public-npm-0.5.2.json');
const hostedWorkflowPath = resolve(
	repositoryRoot,
	'examples/compatibility/hosted-0.6.1-custom.json',
);
const [fixtures, packageMetadata, publicWorkflow, hostedWorkflow] = await Promise.all([
	Promise.all(fixturePaths.map(readJson)),
	readJson(resolve(repositoryRoot, 'package.json')),
	readJson(publicWorkflowPath),
	readJson(hostedWorkflowPath),
]);
const errors = [];
const { SallaFlow } = require(resolve(repositoryRoot, 'dist/nodes/SallaFlow/SallaFlow.node.js'));
const { SallaFlowTrigger } = require(
	resolve(repositoryRoot, 'dist/nodes/SallaFlowTrigger/SallaFlowTrigger.node.js'),
);
const action = new SallaFlow().description;
const trigger = new SallaFlowTrigger().description;
const resources = new Map();

for (const property of action.properties.filter(({ name }) => name === 'operation')) {
	for (const resource of property.displayOptions?.show?.resource ?? []) {
		if (!resources.has(resource)) resources.set(resource, new Set());
		for (const operation of property.options ?? []) resources.get(resource).add(operation.value);
	}
}
const triggerEvents = new Set(
	trigger.properties.find(({ name }) => name === 'event').options.map(({ value }) => value),
);

for (const fixture of fixtures) {
	const label = `${fixture.channel} ${fixture.packageVersion}`;
	if (action.name !== fixture.actionNodeName) errors.push(`${label}: Action node name changed`);
	if (action.version !== fixture.actionTypeVersion)
		errors.push(`${label}: Action type version changed`);
	if (trigger.name !== fixture.triggerNodeName) errors.push(`${label}: Trigger node name changed`);
	if (trigger.version !== fixture.triggerTypeVersion)
		errors.push(`${label}: Trigger type version changed`);

	for (const [resource, operations] of Object.entries(fixture.resources ?? {})) {
		if (!resources.has(resource)) {
			errors.push(`${label}: saved resource ${resource} is missing`);
			continue;
		}
		for (const operation of operations) {
			if (!resources.get(resource).has(operation)) {
				errors.push(`${label}: saved operation ${resource}.${operation} is missing`);
			}
		}
	}
	for (const event of fixture.triggerEvents ?? []) {
		if (!triggerEvents.has(event)) errors.push(`${label}: saved trigger event ${event} is missing`);
	}

	for (const hashField of ['artifactSha256', 'actionDistSha256', 'triggerDistSha256']) {
		if (fixture[hashField] !== undefined && !/^[a-f0-9]{64}$/.test(fixture[hashField])) {
			errors.push(`${label}: ${hashField} is not a SHA-256 digest`);
		}
	}
	if (
		fixture.channel === 'hosted-production' &&
		/(?:\/opt\/|\/root\/|https?:\/\/)/i.test(fixture.source)
	) {
		errors.push(`${label}: hosted fixture source is not sanitized`);
	}
}

const installedPackageTypes = new Map([
	[`${packageMetadata.name}.${action.name}`, action.version],
	[`${packageMetadata.name}.${trigger.name}`, trigger.version],
]);
const isSallaFlowNode = ({ type }) =>
	type?.split('.').at(-1) === action.name || type?.split('.').at(-1) === trigger.name;
const publicWorkflowNodes = publicWorkflow.nodes.filter(isSallaFlowNode);
const hostedWorkflowNodes = hostedWorkflow.nodes.filter(isSallaFlowNode);

if (publicWorkflow.active !== false || typeof publicWorkflow.id !== 'string') {
	errors.push('Public 0.5.2 workflow fixture is not an inactive importable workflow');
}
if (hostedWorkflow.active !== false || typeof hostedWorkflow.id !== 'string') {
	errors.push('Hosted 0.6.1 workflow fixture is not an inactive importable workflow');
}
if (publicWorkflowNodes.length !== 2) {
	errors.push('Public 0.5.2 workflow fixture must contain one Action and one Trigger');
}
for (const node of publicWorkflowNodes) {
	if (!installedPackageTypes.has(node.type)) {
		errors.push(`Public 0.5.2 workflow node type does not resolve: ${node.type}`);
	} else if (installedPackageTypes.get(node.type) !== node.typeVersion) {
		errors.push(`Public 0.5.2 workflow node type version changed: ${node.type}`);
	}
}

const legacyReferences = findLegacySallaFlowNodeTypes(hostedWorkflow);
if (hostedWorkflowNodes.length !== 2 || legacyReferences.length !== 2) {
	errors.push('Hosted 0.6.1 workflow fixture must contain the two exact CUSTOM SallaFlow types');
}
for (const node of hostedWorkflowNodes) {
	if (installedPackageTypes.has(node.type)) {
		errors.push(`Hosted 0.6.1 CUSTOM node unexpectedly resolves without migration: ${node.type}`);
	}
}

const expectedMigratedWorkflow = structuredClone(hostedWorkflow);
for (const node of expectedMigratedWorkflow.nodes) {
	if (Object.hasOwn(PUBLIC_NODE_TYPES, node.type)) node.type = PUBLIC_NODE_TYPES[node.type];
}
const { workflow: migratedWorkflow, migrations } = migrateSallaFlowNodeTypes(hostedWorkflow);
if (migrations.length !== 2) {
	errors.push(`Hosted 0.6.1 migration changed ${migrations.length} node types instead of 2`);
}
if (JSON.stringify(migratedWorkflow) !== JSON.stringify(expectedMigratedWorkflow)) {
	errors.push('Hosted 0.6.1 migration changed data outside the two exact node type values');
}
if (findLegacySallaFlowNodeTypes(migratedWorkflow).length !== 0) {
	errors.push('Hosted 0.6.1 migrated workflow still contains CUSTOM SallaFlow node types');
}
for (const node of migratedWorkflow.nodes.filter(isSallaFlowNode)) {
	if (!installedPackageTypes.has(node.type)) {
		errors.push(`Migrated hosted 0.6.1 workflow node type does not resolve: ${node.type}`);
	} else if (installedPackageTypes.get(node.type) !== node.typeVersion) {
		errors.push(`Migrated hosted 0.6.1 workflow node type version changed: ${node.type}`);
	}
}

failIfErrors(errors, 'Saved-workflow compatibility verification failed');
console.log(
	`Saved-workflow compatibility passed for ${fixtures
		.map(({ channel, packageVersion }) => `${channel} ${packageVersion}`)
		.join(' and ')}, including the hosted/custom namespace migration.`,
);
