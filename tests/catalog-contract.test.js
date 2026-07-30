'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const actions = require('../contracts/actions.manifest.json');
const triggers = require('../contracts/triggers.manifest.json');
const { SallaFlow } = require('../dist/nodes/SallaFlow/SallaFlow.node.js');
const { SallaFlowTrigger } = require('../dist/nodes/SallaFlowTrigger/SallaFlowTrigger.node.js');
const { executeOperation } = require('./node-harness');
const { scenarioMatrix } = require('./scenario-matrix');

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function executableActionDescriptors() {
  const node = new SallaFlow();
  const resources = node.description.properties
    .find((property) => property.name === 'resource')
    .options
    .map(({ name, value, description }) => ({ name, value, description }));
  const operations = node.description.properties
    .filter((property) => (
      property.name === 'operation'
      && property.displayOptions?.show?.resource?.length === 1
    ))
    .flatMap((property) => property.options.map(({ name, value, action, description }) => ({
      resource: property.displayOptions.show.resource[0],
      name,
      value,
      action,
      description: description || null,
    })))
    .sort((a, b) => `${a.resource}.${a.value}`.localeCompare(`${b.resource}.${b.value}`));
  return { node, resources, operations };
}

test('Action manifest locks resource and operation values, descriptors, and exact counts', () => {
  const { resources, operations } = executableActionDescriptors();
  assert.equal(actions.runtimeGeneration, false);
  assert.equal(actions.node.typeVersion, 5);
  assert.equal(resources.length, actions.node.resourceCount);
  assert.equal(operations.length, actions.node.operationCount);
  assert.deepEqual(resources.map((entry) => entry.value), actions.resources);
  assert.equal(sha256(resources), actions.descriptorHashes.resourcesSha256);
  assert.equal(sha256(operations), actions.descriptorHashes.operationsSha256);
  assert.deepEqual(
    operations.map((entry) => `${entry.resource}.${entry.value}`),
    actions.operations.map((entry) => entry.id).sort(),
  );
});

test('manifest covers every execution scenario and dynamic-loader dependency exactly', () => {
  const scenarioIds = Object.entries(scenarioMatrix)
    .flatMap(([resource, operations]) => Object.keys(operations).map((operation) => `${resource}.${operation}`))
    .sort();
  assert.deepEqual(actions.operations.map((entry) => entry.id).sort(), scenarioIds);
  for (const [resource, operations] of Object.entries(scenarioMatrix)) {
    for (const [operation, scenarios] of Object.entries(operations)) {
      assert.ok(scenarios.positive.length > 0, `${resource}.${operation} positive scenarios`);
      assert.ok(scenarios.negative.length > 0, `${resource}.${operation} negative scenarios`);
    }
  }

  const { node } = executableActionDescriptors();
  assert.deepEqual(Object.keys(node.methods.loadOptions).sort(), actions.dynamicLoaders);
  const descriptorLoaders = new Set();
  function collect(properties) {
    for (const property of properties || []) {
      if (property.typeOptions?.loadOptionsMethod) {
        descriptorLoaders.add(property.typeOptions.loadOptionsMethod);
      }
      for (const option of property.options || []) {
        if (Array.isArray(option.values)) collect(option.values);
        if (Array.isArray(option.options)) collect(option.options);
      }
    }
  }
  collect(node.description.properties);
  for (const loader of descriptorLoaders) {
    assert.ok(actions.dynamicLoaders.includes(loader), `undeclared loader ${loader}`);
  }
});

function advancedJsonOperationIds(node) {
  const result = new Map();
  const toggles = node.description.properties.filter((property) => (
    property.type === 'boolean'
    && /(?:useCustomJson|UseJson)$/.test(property.name)
  ));
  for (const toggle of toggles) {
    const resources = toggle.displayOptions?.show?.resource || [];
    const operations = toggle.displayOptions?.show?.operation || [];
    for (const resource of resources) {
      for (const operation of operations) {
        const id = `${resource}.${operation}`;
        result.set(id, toggle.name === 'useCustomJson' ? 'generic' : 'operation-specific');
      }
    }
  }
  return result;
}

test('advanced JSON support cannot silently disappear or expand', () => {
  const { node, operations } = executableActionDescriptors();
  const exposedIds = new Set(operations.map((entry) => `${entry.resource}.${entry.value}`));
  const actual = advancedJsonOperationIds(node);
  const manifest = new Map(actions.operations.map((entry) => [entry.id, entry.advancedJson]));
  for (const id of exposedIds) {
    assert.equal(
      manifest.get(id),
      actual.get(id) || (id === 'customApiCall.makeRequest' ? 'custom' : 'none'),
      id,
    );
  }
});

const templateValues = {
  abandonedCartId: '11',
  orderId: '21',
  productId: '31',
  optionId: '32',
  optionValueId: '33',
  variantId: '34',
  customerId: '41',
  couponId: '51',
  brandId: '61',
  categoryId: '71',
  endpoint: 'products',
};

function materialize(template) {
  return template.replace(/\{([^}]+)\}/g, (_match, name) => templateValues[name]);
}

test('manifest request templates match executable routing for all 46 operations', async () => {
  for (const operation of actions.operations) {
    const [resource, operationName] = operation.id.split('.');
    const { calls } = await executeOperation(resource, operationName);
    const actual = calls.map((call) => ({
      method: call.method,
      backend: new URL(call.url).pathname,
    }));
    const expected = operation.requests.map((request) => ({
      method: request.method === 'DYNAMIC' ? 'GET' : request.method,
      backend: materialize(request.backend),
    }));
    assert.deepEqual(actual, expected, operation.id);
  }
});

test('public route, quota, and retry classifications are internally consistent', () => {
  for (const operation of actions.operations) {
    const methods = new Set(operation.requests.map((request) => request.method));
    if (methods.size === 1 && methods.has('GET')) {
      assert.equal(operation.quota, 'read', operation.id);
      assert.match(operation.retry, /backend-safe/, operation.id);
    } else if (!methods.has('GET') && !methods.has('DYNAMIC')) {
      assert.equal(operation.quota, 'write', operation.id);
      assert.equal(operation.retry, 'never-ambiguous', operation.id);
    } else if (methods.has('GET') && methods.size > 1) {
      assert.equal(operation.quota, 'mixed', operation.id);
      assert.equal(operation.retry, 'backend-safe-reads-only', operation.id);
    } else {
      assert.equal(operation.quota, 'method-classified', operation.id);
    }

    for (const request of operation.requests) {
      assert.match(request.backend, /^\/api\/v1\//, operation.id);
      assert.match(request.upstream, /^\/admin\/v2\//, operation.id);
      if (request.backend.startsWith('/api/v1/salla/')) {
        assert.equal(
          request.upstream,
          request.backend.replace('/api/v1/salla/', '/admin/v2/'),
          operation.id,
        );
      }
    }
  }

});

test('Trigger manifest locks the public catalogue, aliases, descriptors, and versions', () => {
  const trigger = new SallaFlowTrigger();
  const options = trigger.description.properties
    .find((property) => property.name === 'event')
    .options;
  const descriptor = options.map(({ name, value, description }) => ({
    name,
    value,
    description: description || null,
  }));

  assert.equal(triggers.runtimeGeneration, false);
  assert.equal(trigger.description.version, triggers.node.typeVersion);
  assert.equal(triggers.canonicalEvents.length, triggers.node.canonicalEventCount);
  assert.equal(options.length, triggers.node.selectableEventCount);
  assert.equal(sha256(descriptor), triggers.descriptorHash);
  assert.deepEqual(
    [...new Set(options.map((option) => option.value))].sort(),
    [...triggers.canonicalEvents, ...Object.keys(triggers.legacyAliases)].sort(),
  );
});
