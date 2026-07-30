'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SallaFlow,
  csvToArray,
  fetchPaginated,
  formatFieldErrors,
  hasFields,
  normalizeInventoryItems,
  normalizeSallaError,
  parseJsonArray,
  parseJsonInput,
  parseJsonObject,
  withReadTelemetry,
} = require('../dist/nodes/SallaFlow/SallaFlow.node.js');
const { executeOperation } = require('./node-harness');

const node = { name: 'coverage branches' };

test('data-shaping helpers cover empty, scalar, array, and numeric inputs', () => {
  assert.deepEqual(csvToArray(undefined), []);
  assert.deepEqual(csvToArray(null), []);
  assert.deepEqual(csvToArray(''), []);
  assert.deepEqual(csvToArray(['1, 2', '', 3]), ['1', '2', '3']);
  assert.deepEqual(csvToArray('1,2', true), [1, 2]);

  assert.deepEqual(parseJsonInput({ ok: true }, node, 0, 'Input'), { ok: true });
  assert.deepEqual(parseJsonInput('{"ok":true}', node, 0, 'Input'), { ok: true });
  assert.throws(() => parseJsonInput('{', node, 0, 'Input'), /Input is not valid JSON/);

  assert.deepEqual(parseJsonObject('{"ok":true}', 'Body', node, 0), { ok: true });
  assert.deepEqual(parseJsonObject({ ok: true }, 'Body', node, 0), { ok: true });
  assert.throws(() => parseJsonObject(' ', 'Body', node, 0), /cannot be empty/);
  assert.throws(() => parseJsonObject('{', 'Body', node, 0), /not valid JSON/);
  for (const invalid of [null, [], 1]) {
    assert.throws(() => parseJsonObject(invalid, 'Body', node, 0), /must be a JSON object/);
  }

  assert.deepEqual(parseJsonArray('[1,2]', 'Items', node, 0), [1, 2]);
  assert.deepEqual(parseJsonArray([1], 'Items', node, 0), [1]);
  assert.throws(() => parseJsonArray('{', 'Items', node, 0), /not valid JSON/);
  assert.throws(() => parseJsonArray({}, 'Items', node, 0), /must be a JSON array/);

  assert.equal(hasFields(null), false);
  assert.equal(hasFields('value'), false);
  assert.equal(hasFields({}), false);
  assert.equal(hasFields({ value: 1 }), true);
});

test('inventory normalization covers aliases, optional metadata, and every rejection', () => {
  assert.deepEqual(normalizeInventoryItems({
    products: [{
      identifier_type: 'variant_id',
      identifier: 44,
      quantity: '0',
      mode: 'overwrite',
      branch: 5,
      reason_id: 6,
      unlimited_quantity: true,
    }],
  }, node, 0), [{
    identifer_type: 'variant_id',
    identifer: '44',
    quantity: 0,
    mode: 'overwrite',
    branch: 5,
    reason_id: 6,
    unlimited_quantity: true,
  }]);
  assert.deepEqual(normalizeInventoryItems([{
    identifer_type: 'sku',
    identifer: 'ABC',
    quantity: 2,
    mode: 'increment',
    branch: '',
    reason_id: null,
    unlimited_quantity: 'false',
  }], node, 0), [{
    identifer_type: 'sku',
    identifer: 'ABC',
    quantity: 2,
    mode: 'increment',
    unlimited_quantity: false,
  }]);

  for (const empty of [null, {}, [], { products: [] }]) {
    assert.throws(() => normalizeInventoryItems(empty, node, 0), /at least one/);
  }
  for (const invalidEntry of [null, 'item', []]) {
    assert.throws(() => normalizeInventoryItems([invalidEntry], node, 0), /must be an object/);
  }
  assert.throws(
    () => normalizeInventoryItems([{ identifier: '1', quantity: 1, mode: 'increment' }], node, 0),
    /identifier type/,
  );
  assert.throws(
    () => normalizeInventoryItems([{ identifier_type: 'id', quantity: 1, mode: 'increment' }], node, 0),
    /identifier is required/,
  );
  assert.throws(
    () => normalizeInventoryItems([{ identifier_type: 'id', identifier: '1', quantity: 'bad', mode: 'increment' }], node, 0),
    /quantity must be a number/,
  );
  assert.throws(
    () => normalizeInventoryItems([{ identifier_type: 'id', identifier: '1', quantity: -1, mode: 'increment' }], node, 0),
    /quantity must be a number/,
  );
  assert.throws(
    () => normalizeInventoryItems([{ identifier_type: 'id', identifier: '1', quantity: 1 }], node, 0),
    /mode must be/,
  );
});

test('error normalization covers all supported transport and Salla body shapes', () => {
  const retryStatuses = new Set([429, 503]);
  assert.deepEqual(
    normalizeSallaError({ message: '', response: { status: 503, data: {
      code: 'busy',
      error: { message: 'Busy', fields: { retry_after: ['later', null, ''] } },
    } } }, retryStatuses),
    {
      msg: 'Busy — Retry After: later',
      fields: { retry_after: ['later', null, ''] },
      code: 'busy',
      status: 503,
      retryable: true,
    },
  );
  assert.equal(normalizeSallaError({
    response: { body: '{"error":"invalid","message":"Bad request","errors":{"email":"wrong"}}' },
    statusCode: 422,
  }).msg, 'Bad request — Email: wrong');
  assert.equal(normalizeSallaError({
    cause: { response: { data: { error: { code: 'nested', errors: { mobile: 'bad' } } } } },
    httpCode: 400,
  }).code, 'nested');
  assert.equal(normalizeSallaError({
    body: '{not-json',
    message: 'Unprocessable Entity',
  }).msg, 'Unprocessable Entity');
  assert.equal(normalizeSallaError({
    body: { message: 'alert.invalid.fields', fields: { first_name: ['required'] } },
  }).msg, 'Please correct these fields — First Name: required');
  assert.equal(normalizeSallaError({ message: 'socket hang up' }).retryable, true);
  assert.equal(normalizeSallaError({ message: 'permanent failure' }).retryable, false);
  assert.equal(normalizeSallaError({}).msg, 'SallaFlow request failed');

  assert.equal(formatFieldErrors(null), '');
  assert.equal(
    formatFieldErrors({ 'first_name': ['required', undefined], 'contact.email': 'invalid' }),
    'First Name: required; Contact Email: invalid',
  );
});

test('dropdown pagination clamps page size and handles alternate pagination shapes', async () => {
  const calls = [];
  const context = {
    helpers: {
      httpRequestWithAuthentication: async (credentialType, request) => {
        calls.push({ credentialType, ...request });
        const page = Number(new URL(request.url).searchParams.get('page'));
        if (page === 1) return { data: [{ id: 1 }], pagination: { total_pages: 2 } };
        return { data: [{ id: 2 }], pagination: { total_pages: 2 } };
      },
    },
  };
  assert.deepEqual(await fetchPaginated(context, 'products', 999), [{ id: 1 }, { id: 2 }]);
  assert.ok(calls.every((call) => call.url.includes('per_page=60')));
  assert.ok(calls.every((call) => call.credentialType === 'sallaFlowApi'));
  assert.ok(calls.every((call) => (
    call.headers['X-SallaFlow-Read-Context'] === 'dynamic-loader'
  )));
  assert.ok(calls.every((call) => !('X-SallaFlow-Key' in call.headers)));

  let emptyCalls = 0;
  const empty = await fetchPaginated({
    helpers: {
      httpRequestWithAuthentication: async () => {
        emptyCalls += 1;
        return { data: null, pagination: { total: 20 } };
      },
    },
  }, 'products', 0);
  assert.deepEqual(empty, []);
  assert.equal(emptyCalls, 1);
});

test('read telemetry leaves mutating request objects untouched', () => {
  const write = { method: 'POST', headers: { 'X-SallaFlow-Key': 'key' } };
  assert.equal(withReadTelemetry(write, 'action'), write);
});

function loadContext(response, current = {}) {
  return {
    getCredentials: async () => ({ apiKey: 'key' }),
    getCurrentNodeParameter: (name) => current[name],
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, request) => (
        typeof response === 'function' ? response(request) : response
      ),
    },
  };
}

test('dynamic dropdown labels cover sparse and alternate upstream records', async () => {
  const action = new SallaFlow();
  const carts = await action.methods.loadOptions.getAbandonedCarts.call(loadContext({
    data: [
      { id: 1, customer: { first_name: 'A', last_name: 'B' }, total: { amount: 0, currency: 'USD' } },
      { id: 2, customer: { mobile: '500' }, amounts: { total: { amount: 4, currency: 'EUR' } } },
      { id: 3, customer: {}, currency: 'GBP' },
    ],
    pagination: { totalPages: 1 },
  }));
  assert.match(carts[0].name, /A B.*0 USD/);
  assert.match(carts[1].name, /500.*4 EUR/);
  assert.match(carts[2].name, /Unknown customer/);

  const orders = await action.methods.loadOptions.getOrders.call(loadContext({
    data: [
      { id: 1, customer: {}, total: { amount: 0 }, currency: 'USD' },
      { id: 2, amounts: { total: { amount: 4, currency: 'EUR' } } },
    ],
    pagination: { totalPages: 1 },
  }));
  assert.match(orders[0].name, /N\/A/);
  assert.match(orders[1].name, /4 EUR/);

  const products = await action.methods.loadOptions.getProducts.call(loadContext({
    data: [{ id: 1, name: 'No price' }, { id: 2, name: 'Priced', price: { amount: 4, currency: 'USD' } }],
    pagination: { totalPages: 1 },
  }));
  assert.match(products[0].name, /\\? SAR/);
  assert.match(products[1].name, /4 USD/);

  const variants = await action.methods.loadOptions.getVariantsForSelectedProduct.call(loadContext({
    data: [
      { id: 1, related_option_values: ['S', 'Blue'], stock_quantity: 0, price: { amount: 0, currency: 'USD' } },
      { id: 2, sku: 'SKU', stock_quantity: null, price: null },
    ],
    pagination: { totalPages: 1 },
  }, { productId: '10' }));
  assert.match(variants[0].name, /options S\/Blue.*qty 0.*0 USD/);
  assert.match(variants[1].name, /SKU.*qty \\?.*\\? SAR/);
});

test('dynamic dropdown alternatives and fallback messages remain visible', async () => {
  const action = new SallaFlow();
  assert.deepEqual(
    await action.methods.loadOptions.getVariantsForSelectedProduct.call(loadContext({}, { productId: '' })),
    [{ name: '⚠ Pick a Product First', value: '' }],
  );
  assert.deepEqual(
    await action.methods.loadOptions.getVariantsForSelectedProduct.call(loadContext({
      data: [], pagination: { totalPages: 1 },
    }, { productId: '10' })),
    [{ name: 'No Variants on This Product', value: '' }],
  );

  const canceled = await action.methods.loadOptions.getCanceledOrderStatuses.call(loadContext({
    data: [
      { id: 1, name: 'Completed', slug: 'completed' },
      { id: 2, name: 'ملغي', slug: null },
    ],
  }));
  assert.equal(canceled.length, 1);
  assert.equal(canceled[0].value, '2');
  assert.deepEqual(
    await action.methods.loadOptions.getCanceledOrderStatuses.call(loadContext({ data: {} })),
    [{ name: '⚠ No Canceled Status Found in This Store', value: '' }],
  );

  const coupons = await action.methods.loadOptions.getCoupons.call(loadContext({
    data: [
      { id: 1, code: 'P', type: 'percentage', amount: { amount: 0 }, status: '' },
      { id: 2, code: 'F', type: 'fixed', amount: {} },
    ],
    pagination: { totalPages: 1 },
  }));
  assert.match(coupons[0].name, /%/);
  assert.match(coupons[1].name, /SAR/);

  const branches = await action.methods.loadOptions.getBranches.call(loadContext({
    data: [{ id: 1, name: 'Main', is_default: true }, { id: 2, name: 'Other', is_default: false }],
    pagination: { totalPages: 1 },
  }));
  assert.match(branches[0].name, /Default/);
  assert.doesNotMatch(branches[1].name, /Default/);

  const companies = await action.methods.loadOptions.getShippingCompanies.call(loadContext({
    data: [{ id: 1, name: 'Courier', activation_type: 'api' }, { id: 2, name: 'Plain' }],
  }));
  assert.match(companies[0].name, /api/);
  assert.equal(companies[1].name, 'Plain');

  const brands = await action.methods.loadOptions.getBrands.call(loadContext({
    data: [{ id: 1, name: 'Active', status: 'active' }, { id: 2, name: 'Plain' }],
    pagination: { totalPages: 1 },
  }));
  assert.match(brands[0].name, /active/);
  assert.equal(brands[1].name, 'Plain');
});

test('dependent dropdowns cover missing metadata and transport failures without throwing', async () => {
  const action = new SallaFlow();
  const values = await action.methods.loadOptions.getValuesForSelectedOption.call(loadContext({
    data: { values: [
      { id: 1, name: 'Zero', price: 0, quantity: 0 },
      { id: 2, name: 'Blank', price: null, quantity: null },
    ] },
  }, { optionId: '3' }));
  assert.match(values[0].name, /0.*qty 0/);
  assert.equal(values[1].name, 'Blank');

  const options = await action.methods.loadOptions.getOptionsForSelectedProduct.call(loadContext({
    data: { options: [
      { id: 1, name: 'Size', type: 'radio', purpose: 'variants' },
      { id: 2, name: 'Note', type: 'text' },
    ] },
  }, { productId: '3' }));
  assert.match(options[0].name, /variants/);
  assert.equal(options[1].name, 'Note (text)');

  for (const [method, current] of [
    ['getVariantsForSelectedProduct', { productId: '3' }],
    ['getValuesForSelectedOption', { optionId: '3' }],
    ['getOptionsForSelectedProduct', { productId: '3' }],
  ]) {
    const result = await action.methods.loadOptions[method].call(loadContext(async () => {
      throw {};
    }, current));
    assert.equal(result[0].value, '');
  }
});

test('every dropdown catch path has a credential-safe fallback without an error message', async () => {
  const action = new SallaFlow();
  const methods = [
    ['getAbandonedCarts', {}],
    ['getOrders', {}],
    ['getProducts', {}],
    ['getVariantsForSelectedProduct', { productId: '3' }],
    ['getCustomers', {}],
    ['getCoupons', {}],
    ['getOrderStatuses', {}],
    ['getCanceledOrderStatuses', {}],
    ['getCategories', {}],
    ['getCouponsForOrder', {}],
    ['getBranches', {}],
    ['getShippingCompanies', {}],
    ['getProductOptions', {}],
    ['getBrands', {}],
    ['getValuesForSelectedOption', { optionId: '3' }],
    ['getOptionsForSelectedProduct', { productId: '3' }],
  ];
  for (const [method, current] of methods) {
    const result = await action.methods.loadOptions[method].call(loadContext(async () => {
      throw {};
    }, current));
    assert.equal(result.length, 1, method);
    assert.equal(result[0].value, '', method);
  }
});

test('guided validation rejects invalid coupon, customer, and brand branches before HTTP', async () => {
  for (const [resource, operation, overrides, pattern] of [
    ['customer', 'create', {
      useCustomJson: false,
      customerFirstName: 'Name',
      customerMobile: '500000000',
      customerCountryCode: '966',
    }, /Country Code/],
    ['customer', 'update', {
      useCustomJson: false,
      customerUpdateFields: { mobile_code_country: '966' },
    }, /Country Code/],
    ['coupon', 'create', {
      useCustomJson: false,
      couponCode: 'BAD',
      couponType: 'fixed',
      couponAmount: 0,
      couponExpiryDate: '2026-12-31',
    }, /greater than 0/],
    ['coupon', 'create', {
      useCustomJson: false,
      couponCode: 'BAD',
      couponType: 'percentage',
      couponAmount: 101,
      couponExpiryDate: '2026-12-31',
    }, /greater than 100/],
    ['coupon', 'create', {
      useCustomJson: false,
      couponCode: 'BAD',
      couponType: 'fixed',
      couponAmount: 1,
      couponStartDate: '2027-01-01',
      couponExpiryDate: '2026-12-31',
    }, /cannot be after/],
    ['coupon', 'update', {
      useCustomJson: false,
      couponUpdateFields: { amount: 'bad' },
    }, /greater than 0/],
    ['coupon', 'update', {
      useCustomJson: false,
      couponUpdateFields: { type: 'percentage', amount: 101 },
    }, /greater than 100/],
    ['coupon', 'update', {
      useCustomJson: false,
      couponUpdateFields: { start_date: '2027-01-01', expiry_date: '2026-12-31' },
    }, /cannot be after/],
    ['brand', 'create', {
      useCustomJson: false,
      brandName: 'Brand',
      brandLogo: 'file:///logo.png',
    }, /absolute http/],
    ['brand', 'update', {
      useCustomJson: false,
      brandUpdateFields: { logo_url: 'file:///logo.png' },
    }, /absolute http/],
  ]) {
    await assert.rejects(
      executeOperation(resource, operation, overrides),
      pattern,
      `${resource}.${operation}`,
    );
  }
});

test('custom API validation blocks empty, absolute, query-bearing, and unsupported routes', async () => {
  for (const [endpoint, pattern] of [
    ['', /Endpoint is required/],
    ['https://api.salla.dev/orders', /not a full URL/],
    ['/orders?page=2', /Query Parameters/],
  ]) {
    await assert.rejects(
      executeOperation('customApiCall', 'makeRequest', { customEndpoint: endpoint }),
      pattern,
    );
  }
  await assert.rejects(
    executeOperation('unknown', 'unknown'),
    /Unsupported/,
  );
});

test('return-all tolerates missing pagination metadata and non-data responses', async () => {
  const noPagination = await executeOperation('product', 'getAll', {
    returnAll: true,
  }, {
    httpRequest: async () => ({ data: [{ id: 1 }] }),
  });
  assert.equal(noPagination.calls.length, 1);
  assert.deepEqual(noPagination.output[0][0].json, { id: 1 });

  const raw = await executeOperation('customApiCall', 'makeRequest', {}, {
    httpRequest: async () => ({ success: true }),
  });
  assert.deepEqual(raw.output[0][0].json, { success: true });
});

test('continue-on-fail sanitizes nested and string transport response variants', async () => {
  for (const error of [
    Object.assign(new Error('fallback'), {
      cause: { response: { data: { error: { message: 'Nested error' } } } },
      statusCode: 400,
    }),
    Object.assign(new Error('fallback'), {
      body: '{"error":"String error","message":"Body message"}',
      statusCode: 400,
    }),
    Object.assign(new Error('plain failure'), { statusCode: 400 }),
  ]) {
    const result = await executeOperation('product', 'get', {}, {
      continueOnFail: true,
      httpRequest: async () => { throw error; },
    });
    assert.match(result.output[0][0].json.error, /^\[400\]/);
  }
});

test('variant and inventory validation rejects empty or malformed advanced and branch inputs', async () => {
  for (const [resource, operation, overrides, pattern] of [
    ['productVariant', 'update', {
      variantUseJson: true,
      variantJsonBody: '[]',
    }, /non-empty object/],
    ['productVariant', 'update', {
      variantUseJson: true,
      variantJsonBody: '{}',
    }, /non-empty object/],
    ['productVariant', 'update', {
      variantUseJson: false,
      variantUpdateFields: {},
      variantBranchQuantities: { quantity: [{ branch: '', quantity: 1 }] },
    }, /requires a branch ID/],
    ['productVariant', 'update', {
      variantUseJson: false,
      variantUpdateFields: {},
      variantBranchQuantities: { quantity: [{ branch: '1', quantity: -1 }] },
    }, /requires a branch ID/],
    ['productVariant', 'updateQuantity', {
      variantQuantityUseJson: true,
      variantQuantityJsonBody: '[]',
    }, /must be an object/],
    ['product', 'updateInventoryBulk', {
      inventoryUseJson: false,
      inventoryItems: {},
    }, /at least one/],
  ]) {
    await assert.rejects(executeOperation(resource, operation, overrides), pattern);
  }
});

function validOrder(overrides = {}) {
  return {
    useCustomJson: false,
    orderCustomerId: '41',
    orderUseMultipleProducts: false,
    orderProductId: '31',
    orderProductQty: 1,
    orderProductOptions: [],
    orderPaymentStatus: 'pending_payment',
    orderAcceptedMethods: ['cod'],
    orderDeliveryMethod: '',
    orderAdditionalFields: {},
    ...overrides,
  };
}

test('order validation covers empty multi-product, payment, and advanced JSON branches', async () => {
  for (const [overrides, pattern] of [
    [{ useCustomJson: true, customJsonBody: '{}' }, /must contain at least one field/],
    [validOrder({ orderUseMultipleProducts: true, orderProducts: {} }), /at least one product line/],
    [validOrder({ orderPaymentStatus: 'paid', orderPaymentMethod: '' }), /Payment Method is required/],
    [validOrder({ orderPaymentStatus: 'unsupported' }), /Unsupported Payment Status/],
  ]) {
    await assert.rejects(executeOperation('order', 'create', overrides), pattern);
  }
});

test('bulk cancel covers empty selection, raw successes, and message-less failures', async () => {
  await assert.rejects(
    executeOperation('order', 'cancel', {
      orderUseMultiple: true,
      orderIds: [],
    }),
    /at least one order/,
  );

  let call = 0;
  const result = await executeOperation('order', 'cancel', {
    orderUseMultiple: true,
    orderIds: ['1', '2'],
  }, {
    httpRequest: async () => {
      call += 1;
      if (call === 1) return { success: true };
      throw { statusCode: 400 };
    },
  });
  const summary = result.output[0][0].json;
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 1);
  assert.deepEqual(summary.results[0].data, { success: true });
  assert.match(summary.results[1].error, /SallaFlow request failed/);
});

test('feedback results preserve entries without IDs and pagination defaults', async () => {
  const result = await executeOperation('feedback', 'getAll', {
    returnAll: false,
    limit: 5,
    feedbackFilters: { type: '' },
  }, {
    httpRequest: async () => ({
      data: [{ name: 'anonymous' }, { id: null, name: 'null id' }, { id: 1 }, { id: 1 }],
    }),
  });
  assert.equal(result.output[0].length, 3);
});
