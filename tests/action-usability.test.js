'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SallaFlow } = require('../dist/nodes/SallaFlow/SallaFlow.node.js');
const {
  SallaFlowTrigger,
} = require('../dist/nodes/SallaFlowTrigger/SallaFlowTrigger.node.js');

function property(node, name, predicate = () => true) {
  return node.description.properties.find((entry) => entry.name === name && predicate(entry));
}

function executionContext(params, responder) {
  const calls = [];
  const node = new SallaFlow();
  const context = {
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name, _index, fallback) => (
      Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback
    ),
    getCredentials: async () => ({ apiKey: 'test-key' }),
    getNode: () => ({
      name: 'Action usability test',
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
        return responder(options);
      },
    },
  };
  return { node, context, calls };
}

test('only the Action is exposed as an AI tool', () => {
  const action = new SallaFlow();
  const trigger = new SallaFlowTrigger();

  assert.equal(action.description.usableAsTool, true);
  assert.equal('usableAsTool' in trigger.description, false);
  assert.deepEqual(trigger.description.inputs, []);
});

test('advanced JSON hides guided fields for every non-product create/update resource', () => {
  const node = new SallaFlow();
  const guidedNames = [
    'orderCustomerId', 'orderProductId', 'orderProductQty', 'orderPaymentStatus',
    'brandName', 'brandLogo', 'brandAdditionalFields', 'brandUpdateFields',
    'categoryName', 'categoryAdditionalFields', 'categoryUpdateFields',
    'customerFirstName', 'customerLastName', 'customerMobile', 'customerEmail',
    'customerCountryCode', 'customerAdditionalFields', 'customerUpdateFields',
    'couponCode', 'couponType', 'couponAmount', 'couponStartDate', 'couponExpiryDate',
    'couponFreeShipping', 'couponMaxAmount', 'couponAdditionalFields', 'couponUpdateFields',
  ];

  for (const name of guidedNames) {
    const entry = property(node, name);
    assert.ok(entry, `missing property ${name}`);
    assert.deepEqual(entry.displayOptions.show.useCustomJson, [false], `${name} is not hidden in advanced mode`);
  }

  assert.equal(property(node, 'useCustomJson').displayName, 'Use Advanced JSON');
  assert.equal(property(node, 'customJsonBody').displayName, 'Advanced JSON Body');
});

test('cart and order IDs are loaded selectors that still accept expressions', () => {
  const node = new SallaFlow();
  const cart = property(node, 'abandonedCartId');
  const order = property(node, 'orderId');

  assert.equal(cart.type, 'options');
  assert.equal(cart.typeOptions.loadOptionsMethod, 'getAbandonedCarts');
  assert.match(cart.description, /Expression/);
  assert.equal(order.type, 'options');
  assert.equal(order.typeOptions.loadOptionsMethod, 'getOrders');
  assert.match(order.description, /Expression/);
});

test('feedback exposes every currently documented type', () => {
  const node = new SallaFlow();
  const filters = property(node, 'feedbackFilters');
  const types = filters.options.find((entry) => entry.name === 'type').options.map((entry) => entry.value);
  assert.deepEqual(types, ['product', 'ask', 'blog', 'reported', 'shipping', 'store']);
});

test('every audited Get Many resource exposes a dedicated filter collection', () => {
  const node = new SallaFlow();
  for (const name of [
    'abandonedCartFilters',
    'orderFilters',
    'customerFilters',
    'couponFilters',
    'brandFilters',
    'categoryFilters',
    'feedbackFilters',
  ]) {
    const entry = property(node, name);
    assert.ok(entry, `missing ${name}`);
    assert.equal(entry.type, 'collection');
  }
});

test('order Get Many uses the current 30-item cap and encodes supported filters', async () => {
  const params = {
    resource: 'order',
    operation: 'getAll',
    returnAll: true,
    orderFilters: {
      keyword: 'Ahmed + sons',
      status: 'under_review',
      from_date: '2026-07-01',
      to_date: '2026-07-28',
    },
  };
  const { node, context, calls } = executionContext(params, async () => ({
    data: [],
    pagination: { currentPage: 1, totalPages: 1 },
  }));

  await node.execute.call(context);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('per_page'), '30');
  assert.equal(url.searchParams.get('keyword'), 'Ahmed + sons');
  assert.equal(url.searchParams.get('status'), 'under_review');
  assert.equal(url.searchParams.get('from_date'), '2026-07-01');
  assert.equal(url.searchParams.get('to_date'), '2026-07-28');
});

test('all proposed list filters use the exact officially documented query keys', async () => {
  const cases = [
    {
      resource: 'customer',
      parameter: 'customerFilters',
      filters: { keyword: 'ahmed@example.com', date_from: '2026-07-01', date_to: '2026-07-28' },
    },
    {
      resource: 'coupon',
      parameter: 'couponFilters',
      filters: {
        keyword: 'SUMMER',
        creation_date: '2026-01-01,2026-12-31',
        expiration_date: '2026-06-01,2026-12-31',
      },
    },
    {
      resource: 'brand',
      parameter: 'brandFilters',
      filters: { keyword: 'Acme & Sons' },
    },
    {
      resource: 'category',
      parameter: 'categoryFilters',
      filters: { keyword: 'Phones + Tablets', status: 'active' },
    },
  ];

  for (const entry of cases) {
    const params = {
      resource: entry.resource,
      operation: 'getAll',
      returnAll: false,
      limit: 20,
      page: 1,
      [entry.parameter]: entry.filters,
    };
    const { node, context, calls } = executionContext(params, async () => ({
      data: [],
      pagination: { currentPage: 1, totalPages: 1 },
    }));

    await node.execute.call(context);
    assert.equal(calls.length, 1, `${entry.resource} request count`);
    const query = new URL(calls[0].url).searchParams;
    for (const [key, expected] of Object.entries(entry.filters)) {
      assert.equal(query.get(key), expected, `${entry.resource}.${key}`);
    }
  }
});

test('invalid list-filter dates fail before any HTTP request', async () => {
  const params = {
    resource: 'order',
    operation: 'getAll',
    returnAll: false,
    limit: 20,
    page: 1,
    orderFilters: { from_date: '29/07/2026' },
  };
  const { node, context, calls } = executionContext(params, async () => ({
    data: [],
    pagination: { currentPage: 1, totalPages: 1 },
  }));

  await assert.rejects(
    () => node.execute.call(context),
    /from date must use YYYY-MM-DD format/i,
  );
  assert.equal(calls.length, 0);
});

test('invalid custom API JSON fails before any HTTP request', async () => {
  const params = {
    resource: 'customApiCall',
    operation: 'makeRequest',
    customMethod: 'POST',
    customEndpoint: '/orders',
    customQuery: '',
    customBody: '{"broken":',
  };
  const { node, context, calls } = executionContext(params, async () => ({ data: {} }));

  await assert.rejects(
    () => node.execute.call(context),
    /JSON Body is not valid JSON/,
  );
  assert.equal(calls.length, 0);
});

test('empty guided updates fail locally with an actionable message', async () => {
  const params = {
    resource: 'customer',
    operation: 'update',
    customerId: '41',
    customerUpdateFields: {},
    useCustomJson: false,
  };
  const { node, context, calls } = executionContext(params, async () => ({ data: {} }));

  await assert.rejects(
    () => node.execute.call(context),
    /Add at least one customer field to update/,
  );
  assert.equal(calls.length, 0);
});

test('customer create omits blank optional email and last name', async () => {
  const params = {
    resource: 'customer',
    operation: 'create',
    useCustomJson: false,
    customerFirstName: 'Ahmed',
    customerLastName: '',
    customerMobile: '500000000',
    customerEmail: '',
    customerCountryCode: '+966',
    customerAdditionalFields: {},
  };
  const { node, context, calls } = executionContext(params, async () => ({
    data: { id: 41 },
  }));

  await node.execute.call(context);
  assert.deepEqual(calls[0].body, {
    first_name: 'Ahmed',
    mobile: '500000000',
    mobile_code_country: '+966',
  });
});

test('brand guided fields preserve Salla request names for SEO metadata', async () => {
  const params = {
    resource: 'brand',
    operation: 'create',
    useCustomJson: false,
    brandName: 'Acme',
    brandLogo: 'https://example.com/logo.png',
    brandAdditionalFields: {
      metadata_title: 'Acme Store',
      metadata_description: 'Acme description',
      metadata_url: 'acme',
    },
  };
  const { node, context, calls } = executionContext(params, async () => ({
    data: { id: 61 },
  }));

  await node.execute.call(context);
  assert.match(calls[0].url, /salla-upload\/brands$/);
  assert.equal(calls[0].body.metadata_title, 'Acme Store');
  assert.equal(calls[0].body.metadata_description, 'Acme description');
  assert.equal(calls[0].body.metadata_url, 'acme');
  assert.equal(calls[0].body.metadata, undefined);
});

test('invalid additional-order-products JSON is never silently ignored', async () => {
  const params = {
    resource: 'order',
    operation: 'create',
    useCustomJson: false,
    orderCustomerId: '41',
    orderProductId: '31',
    orderProductQty: 1,
    orderPaymentStatus: 'pending_payment',
    orderAcceptedMethods: ['cod'],
    orderDeliveryMethod: '',
    orderProductOptions: [],
    orderAdditionalFields: { extra_products: '[{"id":' },
  };
  const { node, context, calls } = executionContext(params, async () => ({ data: {} }));

  await assert.rejects(
    () => node.execute.call(context),
    /Additional Products JSON is not valid JSON/,
  );
  assert.equal(calls.length, 0);
});

test('multi-type feedback merges duplicate IDs and applies Limit globally', async () => {
  const params = {
    resource: 'feedback',
    operation: 'getAll',
    returnAll: false,
    limit: 2,
    page: 1,
    feedbackFilters: { type: ['product', 'ask'] },
  };
  const { node, context, calls } = executionContext(params, async (options) => {
    const type = new URL(options.url).searchParams.get('type');
    return {
      data: type === 'product'
        ? [{ id: 1, type }, { id: 2, type }]
        : [{ id: 2, type }, { id: 3, type }],
      pagination: { currentPage: 1, totalPages: 1 },
    };
  });

  const output = await node.execute.call(context);
  assert.equal(calls.length, 2);
  assert.deepEqual(output[0].map((item) => item.json.id), [1, 2]);
});

test('merchant-useful selectors expose multi-select without changing identity fields', () => {
  const node = new SallaFlow();
  const multiOrder = property(node, 'orderIds');
  const orderLines = property(node, 'orderProducts');
  const productFilters = property(node, 'productFilters');
  const feedbackFilters = property(node, 'feedbackFilters');
  const couponCreate = property(node, 'couponAdditionalFields');
  const couponUpdate = property(node, 'couponUpdateFields');

  assert.equal(multiOrder.type, 'multiOptions');
  assert.equal(multiOrder.typeOptions.loadOptionsMethod, 'getOrders');
  assert.equal(orderLines.type, 'fixedCollection');
  assert.equal(orderLines.typeOptions.multipleValues, true);
  assert.equal(productFilters.options.find((entry) => entry.name === 'category').type, 'multiOptions');
  assert.equal(feedbackFilters.options.find((entry) => entry.name === 'products').type, 'multiOptions');
  assert.equal(feedbackFilters.options.find((entry) => entry.name === 'customers').type, 'multiOptions');
  for (const collection of [couponCreate, couponUpdate]) {
    for (const name of [
      'include_product_ids',
      'exclude_product_ids',
      'include_category_ids',
      'exclude_category_ids',
      'include_payment_methods',
    ]) {
      assert.equal(
        collection.options.find((entry) => entry.name === name).type,
        'multiOptions',
        `${collection.name}.${name}`,
      );
    }
  }

  assert.equal(property(node, 'productId').type, 'options');
  assert.equal(property(node, 'customerId').type, 'options');
  assert.equal(property(node, 'categoryId').type, 'options');
});

test('guided order creation accepts multiple product lines with per-product options', async () => {
  const params = {
    resource: 'order',
    operation: 'create',
    useCustomJson: false,
    orderCustomerId: '41',
    orderUseMultipleProducts: true,
    orderProducts: {
      product: [
        { productId: '31', quantity: 2, options: ['31|301|3001', '31|302|3002'] },
        { productId: '32', quantity: 1, options: [] },
      ],
    },
    orderPaymentStatus: 'pending_payment',
    orderAcceptedMethods: ['cod', 'bank'],
    orderDeliveryMethod: '',
    orderAdditionalFields: {},
  };
  const { node, context, calls } = executionContext(params, async () => ({
    data: { id: 901 },
  }));

  await node.execute.call(context);
  assert.deepEqual(calls[0].body.products, [
    {
      identifier_type: 'id',
      identifier: 31,
      quantity: 2,
      options: [
        { id: 301, value: ['3001'] },
        { id: 302, value: ['3002'] },
      ],
    },
    {
      identifier_type: 'id',
      identifier: 32,
      quantity: 1,
    },
  ]);
  assert.deepEqual(calls[0].body.payment.accepted_methods, ['cod', 'bank']);
});

test('multiple order status updates process every order and report partial failures', async () => {
  const params = {
    resource: 'order',
    operation: 'updateStatus',
    orderUseMultiple: true,
    orderIds: ['101', '102', '101'],
    statusId: '81',
  };
  const { node, context, calls } = executionContext(params, async (options) => {
    if (options.url.includes('/orders/102/status')) {
      const error = new Error('Order cannot move to this status');
      error.statusCode = 422;
      error.response = {
        status: 422,
        data: { message: 'Order cannot move to this status' },
      };
      throw error;
    }
    return { data: { id: 101, status: 'under_review' } };
  });

  const output = await node.execute.call(context);
  assert.equal(calls.length, 2, 'duplicate order IDs should be processed once');
  assert.deepEqual(
    calls.map((call) => call.url.match(/orders\/(\d+)\/status/)[1]),
    ['101', '102'],
  );
  assert.deepEqual(calls.map((call) => call.body), [
    { status_id: 81 },
    { status_id: 81 },
  ]);
  assert.equal(output[0][0].json.total, 2);
  assert.equal(output[0][0].json.succeeded, 1);
  assert.equal(output[0][0].json.failed, 1);
  assert.equal(output[0][0].json.results[1].order_id, '102');
  assert.equal(output[0][0].json.results[1].success, false);
});

test('multi-select product, customer, and category filters emit repeated array keys', async () => {
  const feedbackParams = {
    resource: 'feedback',
    operation: 'getAll',
    returnAll: false,
    limit: 10,
    page: 1,
    feedbackFilters: {
      products: ['31', '32'],
      customers: ['41', '42'],
      type: [],
      stars: [],
    },
  };
  const feedback = executionContext(feedbackParams, async () => ({
    data: [],
    pagination: { currentPage: 1, totalPages: 1 },
  }));
  await feedback.node.execute.call(feedback.context);
  const feedbackUrl = new URL(feedback.calls[0].url);
  assert.deepEqual(feedbackUrl.searchParams.getAll('products[]'), ['31', '32']);
  assert.deepEqual(feedbackUrl.searchParams.getAll('customers[]'), ['41', '42']);

  const productParams = {
    resource: 'product',
    operation: 'getAll',
    returnAll: false,
    limit: 10,
    page: 1,
    productFilters: { category: ['71', '72'] },
  };
  const products = executionContext(productParams, async () => ({
    data: [],
    pagination: { currentPage: 1, totalPages: 1 },
  }));
  await products.node.execute.call(products.context);
  const productUrl = new URL(products.calls[0].url);
  assert.deepEqual(productUrl.searchParams.getAll('categories[]'), ['71', '72']);
});

test('coupon multi-select fields remain compatible with Salla array payloads', async () => {
  const params = {
    resource: 'coupon',
    operation: 'create',
    useCustomJson: false,
    couponCode: 'MULTI2026',
    couponType: 'percentage',
    couponAmount: 10,
    couponStartDate: '',
    couponExpiryDate: '2026-12-31',
    couponFreeShipping: false,
    couponMaxAmount: 0,
    couponAdditionalFields: {
      include_product_ids: ['31', '32'],
      exclude_category_ids: ['71', '72'],
      include_payment_methods: ['cod', 'mada'],
    },
  };
  const { node, context, calls } = executionContext(params, async () => ({
    data: { id: 51 },
  }));

  await node.execute.call(context);
  assert.deepEqual(calls[0].body.include_product_ids, ['31', '32']);
  assert.deepEqual(calls[0].body.exclude_category_ids, ['71', '72']);
  assert.deepEqual(calls[0].body.include_payment_methods, ['cod', 'mada']);
});
