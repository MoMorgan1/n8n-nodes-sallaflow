'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const packageMetadata = require('../package.json');
const public052 = require('./fixtures/public-npm-0.5.2.json');
const hosted061 = require('./fixtures/hosted-0.6.1.json');
const public052Workflow = require('../examples/compatibility/public-npm-0.5.2.json');
const hosted061Workflow = require('../examples/compatibility/hosted-0.6.1-custom.json');
const { SallaFlow } = require('../dist/nodes/SallaFlow/SallaFlow.node.js');
const { SallaFlowTrigger } = require('../dist/nodes/SallaFlowTrigger/SallaFlowTrigger.node.js');

function currentContract() {
	const action = new SallaFlow().description;
	const trigger = new SallaFlowTrigger().description;
	return {
		action,
		trigger,
		resources: new Map(
			action.properties
				.filter((property) => property.name === 'operation')
				.flatMap(
					(property) =>
						property.displayOptions?.show?.resource?.map((resource) => [
							resource,
							new Set(property.options.map((operation) => operation.value)),
						]) || [],
				),
		),
		triggerEvents: new Set(
			trigger.properties
				.find((property) => property.name === 'event')
				.options.map((event) => event.value),
		),
	};
}

for (const fixture of [public052, hosted061]) {
	test(`0.6.3 preserves the node-local contract from ${fixture.channel} ${fixture.packageVersion}`, () => {
		const current = currentContract();
		assert.equal(packageMetadata.version, '0.6.3');
		assert.equal(current.action.name, fixture.actionNodeName);
		assert.equal(current.action.version, fixture.actionTypeVersion);
		assert.equal(current.trigger.name, fixture.triggerNodeName);
		assert.equal(current.trigger.version, fixture.triggerTypeVersion);

		for (const [resource, operations] of Object.entries(fixture.resources)) {
			assert.ok(current.resources.has(resource), `missing saved resource ${resource}`);
			for (const operation of operations) {
				assert.ok(
					current.resources.get(resource).has(operation),
					`missing saved operation ${resource}.${operation}`,
				);
			}
		}
		for (const event of fixture.triggerEvents) {
			assert.ok(current.triggerEvents.has(event), `missing saved trigger event ${event}`);
		}
	});
}

function sallaFlowNodes(workflow) {
	return workflow.nodes.filter(
		(node) =>
			node.type.split('.').at(-1) === 'sallaFlow' ||
			node.type.split('.').at(-1) === 'sallaFlowTrigger',
	);
}

function installedPackageNodeTypes() {
	const current = currentContract();
	return new Map([
		[`${packageMetadata.name}.${current.action.name}`, current.action.version],
		[`${packageMetadata.name}.${current.trigger.name}`, current.trigger.version],
	]);
}

test('public npm 0.5.2 workflow node types resolve after npm package installation', () => {
	const knownTypes = installedPackageNodeTypes();
	const nodes = sallaFlowNodes(public052Workflow);

	assert.equal(nodes.length, 2);
	assert.deepEqual(nodes.map(({ type }) => type).sort(), [...knownTypes.keys()].sort());
	for (const node of nodes) {
		assert.equal(node.typeVersion, knownTypes.get(node.type));
	}
});

test('hosted 0.6.1 CUSTOM workflow node types do not resolve after npm package installation', () => {
	const knownTypes = installedPackageNodeTypes();
	const nodes = sallaFlowNodes(hosted061Workflow);

	assert.equal(nodes.length, 2);
	assert.deepEqual(nodes.map(({ type }) => type).sort(), [
		'CUSTOM.sallaFlow',
		'CUSTOM.sallaFlowTrigger',
	]);
	for (const node of nodes) {
		assert.equal(knownTypes.has(node.type), false);
	}
});

test('hosted 0.6.1 workflow resolves after exact namespace migration', async () => {
	const { PUBLIC_NODE_TYPES, findLegacySallaFlowNodeTypes, migrateSallaFlowNodeTypes } =
		await import('../scripts/migrate-workflow-namespace.mjs');
	const knownTypes = installedPackageNodeTypes();
	const original = structuredClone(hosted061Workflow);
	const expected = structuredClone(hosted061Workflow);
	for (const node of expected.nodes) {
		if (Object.hasOwn(PUBLIC_NODE_TYPES, node.type)) {
			node.type = PUBLIC_NODE_TYPES[node.type];
		}
	}

	assert.equal(findLegacySallaFlowNodeTypes(hosted061Workflow).length, 2);
	const { workflow: migrated, migrations } = migrateSallaFlowNodeTypes(hosted061Workflow);

	assert.equal(migrations.length, 2);
	assert.deepEqual(migrated, expected);
	assert.deepEqual(hosted061Workflow, original, 'the source workflow must not be mutated');
	assert.equal(findLegacySallaFlowNodeTypes(migrated).length, 0);
	for (const node of sallaFlowNodes(migrated)) {
		assert.equal(knownTypes.has(node.type), true);
		assert.equal(node.typeVersion, knownTypes.get(node.type));
	}

	const secondPass = migrateSallaFlowNodeTypes(migrated);
	assert.equal(secondPass.migrations.length, 0);
	assert.deepEqual(secondPass.workflow, migrated);
});

test('namespace migration changes only exact workflow-node type values', async () => {
	const { migrateSallaFlowNodeTypes } = await import('../scripts/migrate-workflow-namespace.mjs');
	const input = structuredClone(hosted061Workflow);
	input.nodes[1].parameters.nestedData = {
		type: 'CUSTOM.sallaFlow',
		otherType: 'CUSTOM.sallaFlowTrigger',
	};
	input.nodes[3].type = 'CUSTOM.unrelatedNode';

	const { workflow: migrated, migrations } = migrateSallaFlowNodeTypes(input);

	assert.equal(migrations.length, 2);
	assert.equal(migrated.nodes[1].type, 'n8n-nodes-sallaflow.sallaFlow');
	assert.equal(migrated.nodes[2].type, 'n8n-nodes-sallaflow.sallaFlowTrigger');
	assert.deepEqual(migrated.nodes[1].parameters.nestedData, {
		type: 'CUSTOM.sallaFlow',
		otherType: 'CUSTOM.sallaFlowTrigger',
	});
	assert.equal(migrated.nodes[3].type, 'CUSTOM.unrelatedNode');
});

test('namespace migration accepts multi-workflow CLI export arrays', async () => {
	const { migrateSallaFlowNodeTypes } = await import('../scripts/migrate-workflow-namespace.mjs');
	const input = [structuredClone(public052Workflow), structuredClone(hosted061Workflow)];

	const { workflow: migrated, migrations } = migrateSallaFlowNodeTypes(input);

	assert.equal(migrations.length, 2);
	assert.equal(migrated.length, 2);
	assert.deepEqual(migrated[0], public052Workflow);
	for (const node of sallaFlowNodes(migrated[1])) {
		assert.equal(installedPackageNodeTypes().has(node.type), true);
	}
});
