'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SallaFlow } = require('./node-harness');

function contextWith(response, current = {}) {
  return {
    getCredentials: async () => ({ apiKey: 'test-key' }),
    getCurrentNodeParameter: (name) => current[name],
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, request) => (
        typeof response === 'function' ? response(request) : response
      ),
    },
  };
}

test('all entity dropdowns map Salla data to stable string IDs', async () => {
  const node = new SallaFlow();
  const cases = [
    ['getOrders', {
      data: [{
        id: 1,
        reference_id: 1001,
        customer: { full_name: 'Order Customer' },
        amounts: { total: { amount: 25, currency: 'SAR' } },
      }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '1'],
    ['getCustomers', {
      data: [{
        id: 2,
        full_name: 'Customer',
        mobile: '500000000',
        email: 'customer@example.com',
      }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '2'],
    ['getCoupons', {
      data: [{
        id: 3,
        code: 'SAVE',
        type: 'percentage',
        amount: { amount: 10 },
        status: 'active',
      }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '3'],
    ['getCategories', {
      data: [{ id: 4, name: 'Category' }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '4'],
    ['getBranches', {
      data: [{ id: 5, name: 'Main', is_default: true }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '5'],
    ['getBrands', {
      data: [{ id: 6, name: 'Brand', status: 'active' }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '6'],
  ];

  for (const [method, response, expectedValue] of cases) {
    const options = await node.methods.loadOptions[method].call(contextWith(response));
    assert.equal(options[0].value, expectedValue, method);
    assert.ok(options[0].name.length > 0, method);
  }
});

test('status and coupon-for-order dropdowns use their operation-specific values', async () => {
  const node = new SallaFlow();
  const statuses = await node.methods.loadOptions.getOrderStatuses.call(contextWith({
    data: [{ id: 81, name: 'Under Review', slug: 'under_review' }],
  }));
  assert.deepEqual(statuses, [
    { name: 'Under Review (under_review)', value: '81' },
  ]);

  const coupons = await node.methods.loadOptions.getCouponsForOrder.call(contextWith({
    data: [{
      id: 3,
      code: 'SAVE',
      type: 'percentage',
      amount: { amount: 10 },
    }],
    pagination: { currentPage: 1, totalPages: 1 },
  }));
  assert.deepEqual(coupons, [
    { name: 'No Coupon', value: '' },
    { name: 'SAVE — percentage 10%', value: 'SAVE' },
  ]);
});

test('product-option dropdown flattens product, option, and value identity', async () => {
  const node = new SallaFlow();
  const options = await node.methods.loadOptions.getProductOptions.call(contextWith({
    data: [{
      id: 31,
      name: 'Shirt',
      options: [{
        id: 32,
        name: 'Size',
        values: [{ id: 33, name: 'Small' }, { id: 34, name: 'Large' }],
      }],
    }],
    pagination: { currentPage: 1, totalPages: 1 },
  }));

  assert.deepEqual(options, [
    { name: 'Shirt → Size: Small', value: '31|32|33' },
    { name: 'Shirt → Size: Large', value: '31|32|34' },
  ]);
});

test('dependent option and value dropdowns read the currently selected parent', async () => {
  const node = new SallaFlow();
  const values = await node.methods.loadOptions.getValuesForSelectedOption.call(contextWith({
    data: {
      values: [{
        id: 33,
        name: 'Small',
        price: { amount: 2, currency: 'SAR' },
        quantity: 5,
      }],
    },
  }, { optionId: '32' }));
  assert.deepEqual(values, [
    { name: 'Small— 2 SAR (qty 5)', value: '33' },
  ]);

  const options = await node.methods.loadOptions.getOptionsForSelectedProduct.call(contextWith({
    data: {
      options: [{ id: 32, name: 'Size', type: 'radio', purpose: 'variants' }],
    },
  }, { productId: '31' }));
  assert.deepEqual(options, [
    { name: 'Size (radio / variants)', value: '32' },
  ]);
});

test('dropdown mapping handles sparse records and empty dependent selections', async () => {
  const node = new SallaFlow();
  const sparseCases = [
    ['getOrders', {
      data: [{ id: 1, total: { amount: 5 }, currency: 'USD' }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '1'],
    ['getProducts', {
      data: [{ id: 2, name: 'Priceless' }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '2'],
    ['getCustomers', {
      data: [{ id: 3, first_name: 'First', last_name: 'Last' }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '3'],
    ['getCoupons', {
      data: [{ id: 4, code: 'FIXED', type: 'fixed', amount: { amount: 5, currency: 'USD' } }],
      pagination: { currentPage: 1, totalPages: 1 },
    }, '4'],
  ];

  for (const [method, response, value] of sparseCases) {
    const options = await node.methods.loadOptions[method].call(contextWith(response));
    assert.equal(options[0].value, value);
  }

  const noProductOptions = await node.methods.loadOptions.getProductOptions.call(contextWith({
    data: [{ id: 31, name: 'Simple', options: [] }],
    pagination: { currentPage: 1, totalPages: 1 },
  }));
  assert.deepEqual(noProductOptions, [{ name: 'No Products with Options Found', value: '' }]);

  const noOptionSelected = await node.methods.loadOptions.getValuesForSelectedOption.call(
    contextWith({}, { optionId: '' }),
  );
  assert.deepEqual(noOptionSelected, [{ name: '⚠ Pick an Option First', value: '' }]);

  const noProductSelected = await node.methods.loadOptions.getOptionsForSelectedProduct.call(
    contextWith({}, { productId: '' }),
  );
  assert.deepEqual(noProductSelected, [{ name: '⚠ Pick a Product First', value: '' }]);

  const noValues = await node.methods.loadOptions.getValuesForSelectedOption.call(contextWith({
    data: { values: [] },
  }, { optionId: '32' }));
  assert.deepEqual(noValues, [{ name: 'No Values on This Option', value: '' }]);

  const noOptions = await node.methods.loadOptions.getOptionsForSelectedProduct.call(contextWith({
    data: { options: [] },
  }, { productId: '31' }));
  assert.deepEqual(noOptions, [{ name: 'No Options on This Product Yet', value: '' }]);

  const noCouriers = await node.methods.loadOptions.getShippingCompanies.call(contextWith({
    data: [],
  }));
  assert.deepEqual(noCouriers, [{ name: 'No Active Shipping Companies Found', value: '' }]);
});

test('dropdown failures return visible n8n options instead of throwing', async () => {
  const node = new SallaFlow();
  const failingContext = contextWith(async () => {
    throw new Error('upstream unavailable');
  }, { optionId: '32', productId: '31' });
  const methods = [
    'getOrders',
    'getProducts',
    'getCustomers',
    'getCoupons',
    'getOrderStatuses',
    'getCategories',
    'getCouponsForOrder',
    'getBranches',
    'getShippingCompanies',
    'getProductOptions',
    'getBrands',
    'getValuesForSelectedOption',
    'getOptionsForSelectedProduct',
  ];

  for (const method of methods) {
    const options = await node.methods.loadOptions[method].call(failingContext);
    assert.equal(options.length, 1, method);
    assert.equal(options[0].value, '', method);
  }
});
