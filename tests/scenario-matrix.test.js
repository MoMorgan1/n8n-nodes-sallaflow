'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SallaFlow } = require('./node-harness');
const { scenarioMatrix } = require('./scenario-matrix');

function descriptorPairs() {
  const node = new SallaFlow();
  return node.description.properties
    .filter((property) => (
      property.name === 'operation'
      && property.displayOptions?.show?.resource?.length === 1
    ))
    .flatMap((property) => property.options.map((operation) => (
      `${property.displayOptions.show.resource[0]}.${operation.value}`
    )))
    .sort();
}

function matrixPairs() {
  return Object.entries(scenarioMatrix)
    .flatMap(([resource, operations]) => (
      Object.keys(operations).map((operation) => `${resource}.${operation}`)
    ))
    .sort();
}

test('every exposed operation has a scenario-matrix entry and no stale entries exist', () => {
  assert.deepEqual(matrixPairs(), descriptorPairs());
  assert.equal(matrixPairs().length, 46);
});

test('every operation documents both success and failure behavior', () => {
  for (const [resource, operations] of Object.entries(scenarioMatrix)) {
    for (const [operation, scenarios] of Object.entries(operations)) {
      assert.ok(
        Array.isArray(scenarios.positive) && scenarios.positive.length > 0,
        `${resource}.${operation} needs at least one positive scenario`,
      );
      assert.ok(
        Array.isArray(scenarios.negative) && scenarios.negative.length > 0,
        `${resource}.${operation} needs at least one negative scenario`,
      );
      assert.equal(
        new Set([...scenarios.positive, ...scenarios.negative]).size,
        scenarios.positive.length + scenarios.negative.length,
        `${resource}.${operation} contains duplicate scenario names`,
      );
    }
  }
});

test('order creation cannot lose its conditional delivery and payment modes', () => {
  const create = scenarioMatrix.order.create;
  const requiredPositive = [
    'digital + pending payment',
    'digital + paid COD',
    'pickup + branch',
    'shipping + courier + ship_to',
    'advanced JSON',
  ];
  const requiredNegative = [
    'pending payment without accepted methods',
    'pickup without branch',
    'shipping without courier',
    'shipping without ship_to fields',
    'Salla 422 field errors',
  ];

  for (const scenario of requiredPositive) assert.ok(create.positive.includes(scenario));
  for (const scenario of requiredNegative) assert.ok(create.negative.includes(scenario));
});
