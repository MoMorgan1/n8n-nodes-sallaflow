'use strict';

const {
  SallaFlow,
  normalizeSallaError,
} = require('../dist/nodes/SallaFlow/SallaFlow.node.js');

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
  customJsonBody: '{"name":"Contract test"}',
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

function defaultResponse(options) {
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

async function executeOperation(resource, operation, overrides = {}, options = {}) {
  const calls = [];
  const params = { ...defaults, resource, operation, ...overrides };
  const node = new SallaFlow();
  const context = {
    getInputData: () => options.items || [{ json: {} }],
    getNodeParameter: (name, _index, fallback) => (
      Object.prototype.hasOwnProperty.call(params, name) ? params[name] : fallback
    ),
    getCredentials: async () => ({ apiKey: 'test-key' }),
    getNode: () => ({
      name: 'SallaFlow Contract Test',
      type: 'CUSTOM.sallaFlow',
      typeVersion: 5,
      position: [0, 0],
      parameters: params,
    }),
    continueOnFail: () => Boolean(options.continueOnFail),
    logger: { warn: () => {} },
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, request) => {
        calls.push(request);
        if (options.httpRequest) return options.httpRequest(request, calls.length);
        return defaultResponse(request);
      },
    },
  };

  const output = await node.execute.call(context);
  return { calls, output, params };
}

function findCall(calls, method, path) {
  return calls.find((call) => call.method === method && call.url.includes(path));
}

module.exports = {
  SallaFlow,
  defaults,
  executeOperation,
  findCall,
  normalizeSallaError,
};
