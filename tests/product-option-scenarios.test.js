'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeOperation,
  findCall,
} = require('./node-harness');

test('product-option form creation fans out every option with nested values', async () => {
  const { calls, output } = await executeOperation('productOption', 'create', {
    productId: '31',
    optionUseJson: false,
    optionsList: {
      option: [
        {
          name: 'Size',
          purpose: 'variants',
          type: 'radio',
          display_type: 'text',
          required: true,
          description: 'Pick a size',
          values: {
            value: [
              { name: 'Small', price: 0, quantity: 10, is_default: true },
              { name: 'Large', price: 5, display_value: 'L' },
            ],
          },
        },
        {
          name: 'Gift note',
          purpose: 'options',
          type: 'text',
          display_type: 'text',
          required: false,
          values: { value: [] },
        },
      ],
    },
  });

  const posts = calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, {
    name: 'Size',
    purpose: 'variants',
    type: 'radio',
    display_type: 'text',
    required: true,
    description: 'Pick a size',
    values: [
      { name: 'Small', price: 0, quantity: 10, is_default: true },
      { name: 'Large', price: 5, display_value: 'L' },
    ],
  });
  assert.deepEqual(posts[1].body, {
    name: 'Gift note',
    purpose: 'options',
    type: 'text',
    display_type: 'text',
    required: false,
  });
  assert.equal(output[0][0].json.options_created.length, 2);
});

test('product-option JSON creation accepts object or array and rejects empty input', async () => {
  const single = await executeOperation('productOption', 'create', {
    productId: '31',
    optionUseJson: true,
    optionJsonBodyCreate: '{"name":"Color","type":"radio"}',
  });
  assert.deepEqual(single.calls[0].body, { name: 'Color', type: 'radio' });

  const many = await executeOperation('productOption', 'create', {
    productId: '31',
    optionUseJson: true,
    optionJsonBodyCreate: '[{"name":"Size"},{"name":"Material"}]',
  });
  assert.equal(many.calls.filter((call) => call.method === 'POST').length, 2);

  await assert.rejects(
    () => executeOperation('productOption', 'create', {
      productId: '31',
      optionUseJson: true,
      optionJsonBodyCreate: '[]',
    }),
    /No options to create/,
  );
  await assert.rejects(
    () => executeOperation('productOption', 'create', {
      productId: '31',
      optionUseJson: true,
      optionJsonBodyCreate: '{invalid',
    }),
    /Options JSON is not valid JSON/,
  );
});

test('product-option get-many extracts only the product options array', async () => {
  const { output } = await executeOperation('productOption', 'getAll', {
    productId: '31',
  }, {
    httpRequest: async () => ({
      data: {
        id: 31,
        name: 'Product',
        options: [{ id: 32, name: 'Size' }, { id: 33, name: 'Color' }],
      },
    }),
  });

  assert.deepEqual(output[0].map((item) => item.json), [
    { id: 32, name: 'Size' },
    { id: 33, name: 'Color' },
  ]);
});

test('safe option update preserves current values and strips read-only fields', async () => {
  const { calls } = await executeOperation('productOption', 'update', {
    optionId: '32',
    optionUseJson: false,
    updateOptionName: 'Updated Size',
    updateOptionDescription: '',
    updateOptionPurpose: '',
    updateOptionType: '',
    updateOptionDisplayType: '',
    updateOptionRequired: 'false',
    updateOptionReplaceValues: false,
  });

  const put = findCall(calls, 'PUT', '/salla/products/options/32');
  assert.deepEqual(put.body, {
    name: 'Updated Size',
    type: 'radio',
    purpose: 'variants',
    display_type: 'text',
    required: false,
    values: [{ id: 33, name: 'Small', price: 0, quantity: 1 }],
  });
  assert.equal(put.body.id, undefined);
});

test('safe option bulk update reports per-entry success and validation errors', async () => {
  const { calls, output } = await executeOperation('productOption', 'update', {
    optionUseJson: true,
    optionJsonBodyUpdate: '[{"id":32,"name":"Size 2"},{"id":34,"required":true}]',
  });

  assert.equal(calls.filter((call) => call.method === 'GET').length, 2);
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 2);
  assert.deepEqual(output[0][0].json, {
    total: 2,
    succeeded: 2,
    failed: 0,
    results: [
      { id: '32', success: true, data: { id: 999, success: true } },
      { id: '34', success: true, data: { id: 999, success: true } },
    ],
  });

  await assert.rejects(
    () => executeOperation('productOption', 'update', {
      optionUseJson: true,
      optionJsonBodyUpdate: '[{"name":"Missing ID"}]',
    }),
    /must include an "id" field/,
  );
});

test('option-value update GET-merges-PUTs without erasing sibling fields', async () => {
  const { calls, output } = await executeOperation('productOption', 'updateValue', {
    optionValueId: '33',
    valueUseJson: false,
    updateValueName: 'Medium',
    updateValuePrice: '2.5',
    updateValueQuantity: '8',
    updateValueDisplayValue: 'M',
    updateValueIsDefault: 'false',
  });

  assert.deepEqual(findCall(calls, 'PUT', '/salla/products/options/values/33').body, {
    name: 'Medium',
    price: 2.5,
    quantity: 8,
    display_value: 'M',
    is_default: false,
  });
  assert.equal(output[0][0].json.succeeded, 1);
});

test('option-value form update rejects empty and nonnumeric changes', async () => {
  await assert.rejects(
    () => executeOperation('productOption', 'updateValue', {
      optionValueId: '33',
      valueUseJson: false,
      updateValueName: '',
      updateValuePrice: '',
      updateValueQuantity: '',
      updateValueDisplayValue: '',
      updateValueIsDefault: '',
    }),
    /Nothing to update/,
  );
  await assert.rejects(
    () => executeOperation('productOption', 'updateValue', {
      optionValueId: '33',
      valueUseJson: false,
      updateValueName: '',
      updateValuePrice: 'not-a-number',
      updateValueQuantity: '',
      updateValueDisplayValue: '',
      updateValueIsDefault: '',
    }),
    /Price must be a number/,
  );
});

test('bulk option deletion reports partial failures while single deletion throws', async () => {
  const bulk = await executeOperation('productOption', 'delete', {
    deleteUseJson: true,
    deleteJsonBody: '[32,33]',
  }, {
    httpRequest: async (_request, callNumber) => {
      if (callNumber === 2) {
        const error = new Error('Cannot delete option');
        error.statusCode = 422;
        throw error;
      }
      return { success: true };
    },
  });

  assert.equal(bulk.output[0][0].json.total, 2);
  assert.equal(bulk.output[0][0].json.succeeded, 1);
  assert.equal(bulk.output[0][0].json.failed, 1);

  await assert.rejects(
    () => executeOperation('productOption', 'delete', {
      optionId: '32',
      deleteUseJson: false,
    }, {
      httpRequest: async () => {
        const error = new Error('Cannot delete option');
        error.statusCode = 422;
        throw error;
      },
    }),
    /Cannot delete option/,
  );
});
