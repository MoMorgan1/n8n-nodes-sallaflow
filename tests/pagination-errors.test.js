'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeOperation,
  findCall,
} = require('./node-harness');

test('return-all pagination walks sequential pages and combines results', async () => {
  const { calls, output } = await executeOperation('product', 'getAll', {
    returnAll: true,
    productFilters: {},
  }, {
    httpRequest: async (request) => {
      const page = Number(new URL(request.url).searchParams.get('page'));
      return {
        data: [{ id: page, name: `Product ${page}` }],
        pagination: { currentPage: page, totalPages: 3, total: 3 },
      };
    },
  });

  assert.deepEqual(
    calls.map((call) => Number(new URL(call.url).searchParams.get('page'))),
    [1, 2, 3],
  );
  assert.ok(calls.every((call) => call.url.includes('per_page=60')));
  assert.deepEqual(
    calls.map((call) => call.headers['X-SallaFlow-Read-Context']),
    ['action', 'pagination', 'pagination'],
  );
  assert.equal(
    new Set(calls.map((call) => call.headers['X-SallaFlow-Logical-Request-Id'])).size,
    3,
  );
  assert.deepEqual(output[0].map((item) => item.json.id), [1, 2, 3]);
});

test('return-all stops safely when an upstream page is unexpectedly empty', async () => {
  const { calls, output } = await executeOperation('order', 'getAll', {
    returnAll: true,
  }, {
    httpRequest: async (_request, callNumber) => ({
      data: callNumber === 1 ? [{ id: 1 }] : [],
      pagination: { currentPage: callNumber, totalPages: 10, total: 10 },
    }),
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(output[0].map((item) => item.json.id), [1]);
});

test('single-page product filters preserve keywords and array category syntax', async () => {
  const { calls } = await executeOperation('product', 'getAll', {
    returnAll: false,
    limit: 30,
    page: 2,
    productFilters: {
      keyword: 'red shirt',
      status: 'sale',
      category: '10, 20',
    },
  });
  const url = calls[0].url;

  assert.match(url, /per_page=30/);
  assert.match(url, /page=2/);
  assert.match(url, /keyword=red%20shirt/);
  assert.match(url, /status=sale/);
  assert.match(url, /categories\[\]=10/);
  assert.match(url, /categories\[\]=20/);
});

test('feedback filters fan out by type while preserving list and boolean filters', async () => {
  const { calls, output } = await executeOperation('feedback', 'getAll', {
    returnAll: false,
    limit: 20,
    page: 1,
    feedbackFilters: {
      type: ['product', 'shipping'],
      keyword: 'great',
      products: '10,11',
      blogs: ['12'],
      customers: '13',
      stars: ['4', '5'],
      reply: false,
      publish: true,
      start_date: '2026-01-01',
      end_date: '2026-01-31',
    },
  }, {
    httpRequest: async (request) => {
      const type = new URL(request.url).searchParams.get('type');
      return {
        data: [{ id: type, type }],
        pagination: { currentPage: 1, totalPages: 1, total: 1 },
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.ok(calls.some((call) => call.url.includes('type=product')));
  assert.ok(calls.some((call) => call.url.includes('type=shipping')));
  assert.ok(calls.every((call) => call.url.includes('products[]=10')));
  assert.ok(calls.every((call) => call.url.includes('products[]=11')));
  assert.ok(calls.every((call) => call.url.includes('stars[]=4')));
  assert.ok(calls.every((call) => call.url.includes('stars[]=5')));
  assert.ok(calls.every((call) => call.url.includes('reply=false')));
  assert.ok(calls.every((call) => call.url.includes('publish=true')));
  assert.ok(calls.every((call) => (
    call.headers['X-SallaFlow-Read-Context'] === 'feedback-fanout'
  )));
  assert.deepEqual(output[0].map((item) => item.json.id), ['product', 'shipping']);
});

test('empty list results remain distinguishable from request failures', async () => {
  const { output } = await executeOperation('customer', 'getAll', {}, {
    httpRequest: async () => ({
      data: [],
      pagination: { currentPage: 1, totalPages: 1, total: 0 },
    }),
  });

  assert.deepEqual(output[0][0].json, {
    data: [],
    message: 'No items found',
    pagination: { currentPage: 1, totalPages: 1, total: 0 },
  });
});

test('422 field errors preserve every Salla validation detail', async () => {
  await assert.rejects(
    () => executeOperation('order', 'create', {
      useCustomJson: true,
      customJsonBody: '{"delivery_method":"shipping"}',
    }, {
      httpRequest: async () => {
        const error = new Error('Unprocessable Entity');
        error.statusCode = 422;
        error.body = {
          status: 422,
          message: 'alert.invalid.fields',
          fields: {
            courier_id: 'حقل رقم شركة الشحن مطلوب.',
            ship_to: 'حقل الشحن ل مطلوب.',
          },
        };
        throw error;
      },
    }),
    /\[422\] Please correct these fields — Courier Id: حقل رقم شركة الشحن مطلوب.; Ship To: حقل الشحن ل مطلوب./,
  );
});

test('continue-on-fail emits a clean item instead of leaking transport objects', async () => {
  const { output } = await executeOperation('product', 'get', {
    productId: '31',
  }, {
    continueOnFail: true,
    httpRequest: async () => {
      const error = new Error('Request failed');
      error.statusCode = 404;
      error.body = { message: 'Product not found' };
      throw error;
    },
  });

  assert.deepEqual(output[0][0], {
    json: { error: '[404] Product not found' },
    pairedItem: { item: 0 },
  });
});

test('transient reads are sent to the backend once and expose clean errors', async () => {
  let attempts = 0;
  await assert.rejects(
    () => executeOperation('product', 'get', {
      productId: '31',
    }, {
      httpRequest: async () => {
        attempts++;
        const error = new Error('Rate limited');
        error.response = {
          status: 429,
          headers: { 'retry-after': '0' },
          data: { message: 'Try again' },
        };
        throw error;
      },
    }),
    /\[429\] Try again/,
  );
  assert.equal(attempts, 1);
});

test('reads carry logical identity while writes do not claim read identity', async () => {
  const read = await executeOperation('product', 'get', { productId: '31' });
  assert.match(
    read.calls[0].headers['X-SallaFlow-Logical-Request-Id'],
    /^[A-Za-z0-9._:-]{1,128}$/,
  );
  assert.equal(read.calls[0].headers['X-SallaFlow-Read-Context'], 'action');

  const write = await executeOperation('customer', 'create');
  assert.equal(write.calls[0].headers['X-SallaFlow-Logical-Request-Id'], undefined);
  assert.equal(write.calls[0].headers['X-SallaFlow-Read-Context'], undefined);
});

test('mutating requests do not retry ambiguous transient failures', async () => {
  let attempts = 0;
  await assert.rejects(
    () => executeOperation('customApiCall', 'makeRequest', {
      customMethod: 'POST',
      customEndpoint: '/orders',
      customQuery: '',
      customBody: '{"customer_id":41}',
    }, {
      httpRequest: async () => {
        attempts++;
        const error = new Error('Gateway timed out after forwarding the request');
        error.response = {
          status: 504,
          data: { message: 'Upstream timeout' },
        };
        throw error;
      },
    }),
    /\[504\] Upstream timeout/,
  );
  assert.equal(attempts, 1);
});

test('nonretryable validation errors fail after one request', async () => {
  let attempts = 0;
  await assert.rejects(
    () => executeOperation('coupon', 'create', {
      useCustomJson: true,
      customJsonBody: '{"code":""}',
    }, {
      httpRequest: async () => {
        attempts++;
        const error = new Error('Validation failed');
        error.statusCode = 422;
        error.body = { message: 'Coupon code is required' };
        throw error;
      },
    }),
    /\[422\] Coupon code is required/,
  );
  assert.equal(attempts, 1);
});

test('multiple input items produce paired calls and outputs', async () => {
  const { calls, output } = await executeOperation('product', 'get', {
    productId: '31',
  }, {
    items: [{ json: { index: 1 } }, { json: { index: 2 } }],
    httpRequest: async (_request, callNumber) => ({ data: { call: callNumber } }),
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(output[0].map((item) => item.json.call), [1, 2]);
});
