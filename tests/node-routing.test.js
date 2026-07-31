'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SallaFlow,
  normalizeSallaError,
} = require('../dist/nodes/SallaFlow/SallaFlow.node.js');
const { SallaFlowTrigger } = require('../dist/nodes/SallaFlowTrigger/SallaFlowTrigger.node.js');

const API_PREFIX = 'https://api.sallaflow.cloud/api/v1/';

const defaults = {
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
  statusId: '81',
  returnAll: false,
  limit: 5,
  page: 1,
  abandonedCartFilters: {},
  productFilters: {},
  feedbackFilters: {},
  useCustomJson: true,
  customJsonBody: '{"name":"Routing test"}',
  optionUseJson: true,
  optionJsonBodyCreate: '{"name":"Size","type":"radio","purpose":"variants","values":[{"name":"S","price":0}]}',
  optionJsonBodyUpdate: '{"name":"Updated Size"}',
  valueUseJson: true,
  valueJsonBody: '{"id":"33","name":"Medium"}',
  deleteUseJson: false,
  imageUrl: 'https://example.com/product.jpg',
  imageMain: true,
  imageAlt: 'Front view',
  imageSort: 0,
  unlimitedQuantity: false,
  quantityValue: 7,
  inventoryUseJson: false,
  inventoryItems: {
    item: [{
      identifierType: 'id',
      identifier: '31',
      quantity: 5,
      mode: 'increment',
      branch: '',
      reason_id: '',
      unlimited_quantity: '',
    }],
  },
  variantUseJson: false,
  variantUpdateFields: { sku: 'SKU-UPDATED' },
  variantBranchQuantities: {},
  variantQuantityUseJson: false,
  variantQuantity: 3,
  variantQuantityMode: 'increment',
  variantQuantityAdditionalFields: {},
  customMethod: 'GET',
  customEndpoint: '/products',
  customQuery: 'per_page=2',
};

function responseFor(options) {
  if (options.method === 'GET' && options.url.includes('/products/options/values/')) {
    return { data: { id: 33, name: 'Small', price: 0, quantity: 1 } };
  }
  if (options.method === 'GET' && options.url.includes('/products/options/')) {
    return {
      data: {
        id: 32,
        name: 'Size',
        type: 'radio',
        purpose: 'variants',
        display_type: 'text',
        required: false,
        values: [{ id: 33, name: 'Small', price: 0, quantity: 1 }],
      },
    };
  }
  if (options.method === 'GET' && /\/salla\/products\/31$/.test(options.url)) {
    return { data: { id: 31, options: [{ id: 32, name: 'Size', values: [] }] } };
  }
  if (options.method === 'GET' && options.url.includes('?')) {
    return { data: [], pagination: { currentPage: 1, totalPages: 1, total: 0 } };
  }
  if (options.method === 'DELETE') return { success: true };
  return { data: { id: 999, success: true } };
}

async function executeOperation(resource, operation, overrides = {}) {
  const calls = [];
  const customHttpRequest = overrides.__httpRequest;
  const params = { ...defaults, resource, operation, ...overrides };
  const node = new SallaFlow();
  const context = {
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name, _index, fallback) => (
      Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback
    ),
    getCredentials: async () => ({ apiKey: 'test-key' }),
    getNode: () => ({
      name: 'SallaFlow Routing Test',
      type: 'CUSTOM.sallaFlow',
      typeVersion: 5,
      position: [0, 0],
      parameters: params,
    }),
    continueOnFail: () => false,
    logger: { warn: () => {} },
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, options) => {
        calls.push(options);
        if (customHttpRequest) return customHttpRequest(options);
        return responseFor(options);
      },
    },
  };

  const output = await node.execute.call(context);
  return { calls, output };
}

const routingCases = [
  ['abandonedCart', 'get', 'GET', 'salla/carts/abandoned/11'],
  ['abandonedCart', 'getAll', 'GET', 'salla/carts/abandoned?'],
  ['order', 'get', 'GET', 'salla/orders/21'],
  ['order', 'getAll', 'GET', 'salla/orders?'],
  ['order', 'create', 'POST', 'salla/orders'],
  ['order', 'updateStatus', 'POST', 'salla/orders/21/status'],
  ['order', 'cancel', 'POST', 'salla/orders/21/status'],
  ['product', 'get', 'GET', 'salla/products/31'],
  ['product', 'getAll', 'GET', 'salla/products?'],
  ['product', 'create', 'POST', 'salla/products'],
  ['product', 'update', 'PUT', 'salla/products/31'],
  ['product', 'delete', 'DELETE', 'salla/products/31'],
  ['product', 'attachImage', 'POST', 'salla-upload/products/31/images'],
  ['product', 'updateQuantity', 'PUT', 'salla/products/31'],
  ['product', 'updateInventoryBulk', 'POST', 'salla/products/quantities/bulk'],
  ['productOption', 'create', 'POST', 'salla/products/31/options'],
  ['productOption', 'get', 'GET', 'salla/products/options/32'],
  ['productOption', 'getAll', 'GET', 'salla/products/31'],
  ['productOption', 'update', 'PUT', 'salla/products/options/32'],
  ['productOption', 'updateValue', 'PUT', 'salla/products/options/values/33'],
  ['productOption', 'delete', 'DELETE', 'salla/products/options/32'],
  ['productVariant', 'getAll', 'GET', 'salla/products/31/variants?'],
  ['productVariant', 'get', 'GET', 'salla/products/variants/34'],
  ['productVariant', 'update', 'PUT', 'salla/products/variants/34'],
  ['productVariant', 'updateQuantity', 'POST', 'salla/products/quantities/bulk'],
  ['customer', 'get', 'GET', 'salla/customers/41'],
  ['customer', 'getAll', 'GET', 'salla/customers?'],
  ['customer', 'create', 'POST', 'salla/customers'],
  ['customer', 'update', 'PUT', 'salla/customers/41'],
  ['coupon', 'get', 'GET', 'salla/coupons/51'],
  ['coupon', 'getAll', 'GET', 'salla/coupons?'],
  ['coupon', 'create', 'POST', 'salla/coupons'],
  ['coupon', 'update', 'PUT', 'salla/coupons/51'],
  ['coupon', 'delete', 'DELETE', 'salla/coupons/51'],
  ['brand', 'get', 'GET', 'salla/brands/61'],
  ['brand', 'getAll', 'GET', 'salla/brands?'],
  ['brand', 'create', 'POST', 'salla/brands'],
  ['brand', 'update', 'PUT', 'salla/brands/61'],
  ['brand', 'delete', 'DELETE', 'salla/brands/61'],
  ['category', 'get', 'GET', 'salla/categories/71'],
  ['category', 'getAll', 'GET', 'salla/categories?'],
  ['category', 'create', 'POST', 'salla/categories'],
  ['category', 'update', 'PUT', 'salla/categories/71'],
  ['category', 'delete', 'DELETE', 'salla/categories/71'],
  ['feedback', 'getAll', 'GET', 'salla/feedbacks?'],
  ['customApiCall', 'makeRequest', 'GET', 'salla/products?per_page=2'],
];

test('all 46 action operations route to the expected backend method and path', async () => {
  assert.equal(routingCases.length, 46);
  for (const [resource, operation, method, path] of routingCases) {
    const { calls } = await executeOperation(resource, operation);
    assert.ok(
      calls.some((call) => call.method === method && call.url.startsWith(API_PREFIX) && call.url.includes(path)),
      `${resource}/${operation} did not call ${method} ${path}; calls=${JSON.stringify(calls)}`,
    );
  }
});

test('bulk inventory Easy Fields emits Salla documented keys and safe adjustment mode', async () => {
  const { calls } = await executeOperation('product', 'updateInventoryBulk', {
    inventoryItems: {
      item: [{
        identifierType: 'sku',
        identifier: 'SKU-123',
        quantity: 8,
        mode: 'increment',
        branch: '901',
        reason_id: '902',
        unlimited_quantity: 'false',
      }],
    },
  });
  const request = calls.find((call) => call.url.includes('/products/quantities/bulk'));
  assert.deepEqual(request.body, {
    products: [{
      identifer_type: 'sku',
      identifer: 'SKU-123',
      quantity: 8,
      mode: 'increment',
      branch: '901',
      reason_id: '902',
      unlimited_quantity: false,
    }],
  });
});

test('bulk inventory Advanced JSON accepts correctly-spelled identifier aliases', async () => {
  const { calls } = await executeOperation('product', 'updateInventoryBulk', {
    inventoryUseJson: true,
    inventoryJsonBody: {
      products: [{
        identifier_type: 'variant_id',
        identifier: 4455,
        quantity: 2,
        mode: 'decrement',
      }],
    },
  });
  const request = calls.find((call) => call.url.includes('/products/quantities/bulk'));
  assert.deepEqual(request.body, {
    products: [{
      identifer_type: 'variant_id',
      identifer: '4455',
      quantity: 2,
      mode: 'decrement',
    }],
  });
});

test('variant quantity uses recommended bulk endpoint instead of deprecated endpoint', async () => {
  const { calls } = await executeOperation('productVariant', 'updateQuantity', {
    variantId: '7788',
    variantQuantity: 4,
    variantQuantityMode: 'decrement',
    variantQuantityAdditionalFields: { branch: '12', reason_id: '13' },
  });
  const request = calls.find((call) => call.url.includes('/products/quantities/bulk'));
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.body, {
    products: [{
      identifer_type: 'variant_id',
      identifer: '7788',
      quantity: 4,
      mode: 'decrement',
      branch: '12',
      reason_id: '13',
    }],
  });
  assert.ok(calls.every((call) => !call.url.includes('/products/quantities/variant/')));
});

test('variant Easy Fields update sends details and branch quantities', async () => {
  const { calls } = await executeOperation('productVariant', 'update', {
    variantUpdateFields: {
      sku: 'SKU-BLUE-M',
      price: 120,
      stock_quantity: 9,
    },
    variantBranchQuantities: {
      quantity: [{
        branch: '55',
        quantity: 7,
        reason_id: '66',
      }],
    },
  });
  const request = calls.find((call) => call.url.includes('/products/variants/34'));
  assert.equal(request.method, 'PUT');
  assert.deepEqual(request.body, {
    sku: 'SKU-BLUE-M',
    price: 120,
    stock_quantity: 9,
    quantities: [{
      branch: '55',
      quantity: 7,
      reason_id: '66',
    }],
  });
});

test('variant update rejects an empty body before making an API call', async () => {
  await assert.rejects(
    executeOperation('productVariant', 'update', {
      variantUpdateFields: {},
      variantBranchQuantities: {},
    }),
    /Choose at least one variant field or branch quantity/,
  );
});

test('bulk inventory validates identifier, quantity, and mode before making an API call', async () => {
  await assert.rejects(
    executeOperation('product', 'updateInventoryBulk', {
      inventoryItems: {
        item: [{
          identifierType: 'id',
          identifier: '',
          quantity: -1,
          mode: 'overwrite',
        }],
      },
    }),
    /identifier is required/,
  );
  await assert.rejects(
    executeOperation('product', 'updateInventoryBulk', {
      inventoryUseJson: true,
      inventoryJsonBody: [{
        identifier_type: 'id',
        identifier: '31',
        quantity: 2,
        mode: 'replace',
      }],
    }),
    /mode must be increment, decrement, or overwrite/,
  );
});

test('non-idempotent inventory writes are not retried after a transient upstream error', async () => {
  let attempts = 0;
  await assert.rejects(
    executeOperation('product', 'updateInventoryBulk', {
      __httpRequest: async () => {
        attempts += 1;
        const error = new Error('rate limited');
        error.statusCode = 429;
        error.body = { message: 'Try later' };
        throw error;
      },
    }),
    /\[429\] Try later/,
  );
  assert.equal(attempts, 1);
});

test('Product and Product Option keep Easy Fields as the default with Advanced JSON available', () => {
  const node = new SallaFlow();
  const property = (name) => node.description.properties.find((item) => item.name === name);

  assert.equal(property('useCustomJson').default, false);
  assert.equal(property('useCustomJson').displayName, 'Use Advanced JSON');
  assert.equal(property('optionUseJson').default, false);
  assert.equal(property('optionUseJson').displayName, 'Use Advanced JSON');
  assert.deepEqual(property('productUpdateFields').displayOptions.show.useCustomJson, [false]);
  assert.equal(property('inventoryUseJson').default, false);
  assert.equal(property('variantUseJson').default, false);
  assert.equal(property('updateValueQuantity'), undefined);
  assert.equal(node.description.version, 5, 'existing typeVersion 5 workflows must remain compatible');
});

test('dependent variant dropdown loads the selected product variants', async () => {
  const calls = [];
  const node = new SallaFlow();
  const context = {
    getCurrentNodeParameter: () => '31',
    getCredentials: async () => ({ apiKey: 'test-key' }),
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, options) => {
        calls.push(options);
        return {
          data: [{
            id: 34,
            sku: 'SKU-34',
            stock_quantity: 6,
            price: { amount: 99, currency: 'SAR' },
          }],
          pagination: { currentPage: 1, totalPages: 1, total: 1 },
        };
      },
    },
  };

  const options = await node.methods.loadOptions.getVariantsForSelectedProduct.call(context);
  assert.equal(options.length, 1);
  assert.equal(options[0].value, '34');
  assert.match(options[0].name, /SKU-34 — qty 6/);
  assert.ok(calls[0].url.includes('/products/31/variants?per_page=60&page=1'));
});

test('attach image sends main, sort, and alt metadata', async () => {
  const { calls } = await executeOperation('product', 'attachImage');
  const upload = calls.find((call) => call.url.includes('/salla-upload/products/31/images'));
  assert.deepEqual(upload.body, {
    image_url: 'https://example.com/product.jpg',
    main: true,
    sort: 0,
    alt: 'Front view',
  });
});

test('dynamic dropdown pagination respects Salla limit and loads three pages', async () => {
  const calls = [];
  const node = new SallaFlow();
  const context = {
    getCredentials: async () => ({ apiKey: 'test-key' }),
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, options) => {
        calls.push(options);
        const page = Number(new URL(options.url).searchParams.get('page'));
        return {
          data: [{ id: page, name: `Product ${page}`, price: { amount: 1, currency: 'SAR' } }],
          pagination: { currentPage: page, totalPages: 3, total: 3 },
        };
      },
    },
  };

  const options = await node.methods.loadOptions.getProducts.call(context);
  assert.equal(options.length, 3);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.url.includes('per_page=60')));
});

test('trigger exposes 64 current events plus one deprecated compatibility alias', () => {
  const trigger = new SallaFlowTrigger();
  const eventProperty = trigger.description.properties.find((property) => property.name === 'event');
  const events = eventProperty.options.map((option) => option.value);

  assert.equal(events.length, 65);
  assert.equal(new Set(events).size, 65);
  assert.ok(events.includes('abandoned.cart'));
  assert.ok(events.includes('abandoned.cart.updated'));
  assert.ok(events.includes('product.quantity.low'));
  assert.ok(events.includes('product.price.updated'));
  assert.ok(events.includes('shipment.return.creating'));
  assert.ok(events.includes('order.shipment.return.creating'));
  assert.ok(events.includes('invoice.created'));
});

test('trigger registration uses the selected event and n8n webhook URL', async () => {
  const calls = [];
  const trigger = new SallaFlowTrigger();
  const context = {
    getNodeWebhookUrl: () => 'https://n8n.example/webhook/test',
    getNodeParameter: () => 'order.created',
    getCredentials: async () => ({ apiKey: 'test-key' }),
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, options) => {
        calls.push(options);
        return { success: true };
      },
    },
  };

  const created = await trigger.webhookMethods.default.create.call(context);
  assert.equal(created, true);
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body, {
    event: 'order.created',
    webhookUrl: 'https://n8n.example/webhook/test',
  });
});

test('trigger lifecycle checks the exact event and URL', async () => {
  const trigger = new SallaFlowTrigger();
  const baseContext = {
    getNodeWebhookUrl: () => 'https://n8n.example/webhook/test',
    getNodeParameter: () => 'order.created',
    getCredentials: async () => ({ apiKey: 'test-key' }),
  };

  const exists = await trigger.webhookMethods.default.checkExists.call({
    ...baseContext,
    helpers: {
      httpRequestWithAuthentication: async () => ({
        success: true,
        subscriptions: [
          { event: 'product.created', n8n_webhook_url: 'https://n8n.example/webhook/test' },
          { event: 'order.created', n8n_webhook_url: 'https://n8n.example/webhook/test' },
        ],
      }),
    },
  });
  assert.equal(exists, true);

  const absent = await trigger.webhookMethods.default.checkExists.call({
    ...baseContext,
    helpers: {
      httpRequestWithAuthentication: async () => ({
        success: true,
        subscriptions: [
          { event: 'product.created', n8n_webhook_url: 'https://n8n.example/webhook/test' },
        ],
      }),
    },
  });
  assert.equal(absent, false);
});

test('trigger lifecycle reports lookup failures without leaking request details', async () => {
  const trigger = new SallaFlowTrigger();
  const logs = [];
  const lookupFailure = await trigger.webhookMethods.default.checkExists.call({
    getNodeWebhookUrl: () => 'https://n8n.example/webhook/private-token',
    getNodeParameter: () => 'order.created',
    logger: { error: (message) => logs.push(message) },
    helpers: {
      httpRequestWithAuthentication: async () => {
        throw new Error('offline: secret-detail');
      },
    },
  });
  assert.equal(lookupFailure, false);
  assert.deepEqual(logs, ['Unable to verify the SallaFlow webhook registration']);
  assert.doesNotMatch(logs.join(' '), /private-token|secret-detail/);
});

test('trigger deletion sends the exact subscription identity and completes cleanup', async () => {
  const trigger = new SallaFlowTrigger();
  const deleteCalls = [];
  const deleted = await trigger.webhookMethods.default.delete.call({
    getNodeWebhookUrl: () => 'https://n8n.example/webhook/test',
    getNodeParameter: () => 'order.created',
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, request) => {
        deleteCalls.push(request);
        return { success: true };
      },
    },
  });
  assert.equal(deleted, true);
  assert.deepEqual(deleteCalls[0].body, {
    event: 'order.created',
    webhookUrl: 'https://n8n.example/webhook/test',
  });
});

test('trigger deletion reports remote cleanup failures without blocking local cleanup', async () => {
  const trigger = new SallaFlowTrigger();
  const logs = [];
  const deleted = await trigger.webhookMethods.default.delete.call({
    getNodeWebhookUrl: () => 'https://n8n.example/webhook/private-token',
    getNodeParameter: () => 'order.created',
    logger: { error: (message) => logs.push(message) },
    helpers: {
      httpRequestWithAuthentication: async () => {
        throw new Error('already removed: secret-detail');
      },
    },
  });

  assert.equal(deleted, true);
  assert.deepEqual(logs, ['Unable to remove the SallaFlow webhook registration']);
  assert.doesNotMatch(logs.join(' '), /private-token|secret-detail/);
});

test('trigger registration rejects an unsuccessful backend response', async () => {
  const trigger = new SallaFlowTrigger();
  await assert.rejects(
    () => trigger.webhookMethods.default.create.call({
      getNodeWebhookUrl: () => 'https://n8n.example/webhook/test',
      getNodeParameter: () => 'order.created',
      getCredentials: async () => ({ apiKey: 'test-key' }),
      getNode: () => ({ name: 'SallaFlow Trigger Test' }),
      helpers: {
        httpRequestWithAuthentication: async () => ({ success: false, error: 'denied' }),
      },
    }),
    /Failed to register webhook/,
  );
});

test('trigger webhook forwards the complete incoming event body', async () => {
  const trigger = new SallaFlowTrigger();
  const event = { event: 'order.created', merchant: 123, data: { id: 456 } };
  const result = await trigger.webhook.call({
    getBodyData: () => event,
    helpers: {
      returnJsonArray: (body) => [{ json: body }],
    },
  });

  assert.deepEqual(result, {
    workflowData: [[{ json: event }]],
  });
});

test('top-level Salla validation fields become a merchant-friendly message', () => {
  const normalized = normalizeSallaError({
    statusCode: 422,
    body: {
      status: 422,
      success: false,
      code: 'error',
      message: 'alert.invalid.fields',
      fields: {
        username: 'Username is already in use.',
      },
    },
  });

  assert.equal(normalized.status, 422);
  assert.equal(
    normalized.msg,
    'Please correct these fields — Username: Username is already in use.',
  );
});

test('custom API supports PATCH with a JSON body', async () => {
  const { calls } = await executeOperation('customApiCall', 'makeRequest', {
    customMethod: 'PATCH',
    customEndpoint: '/orders/21',
    customQuery: '',
    customBody: '{"note":"Updated"}',
  });

  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url, `${API_PREFIX}salla/orders/21`);
  assert.deepEqual(calls[0].body, { note: 'Updated' });
});

test('custom API rejects invalid JSON before making an HTTP request', async () => {
  await assert.rejects(
    () => executeOperation('customApiCall', 'makeRequest', {
      customMethod: 'POST',
      customEndpoint: '/orders',
      customBody: '{invalid',
    }),
    /JSON Body is not valid JSON/,
  );
});

test('advanced resource JSON reports a clear parse error', async () => {
  await assert.rejects(
    () => executeOperation('coupon', 'create', {
      useCustomJson: true,
      customJsonBody: '{invalid',
    }),
    /Advanced JSON Body is not valid JSON/,
  );
});
