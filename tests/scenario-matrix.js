'use strict';

// This is the review checklist for every operation exposed by the node.
// The descriptor-parity test fails whenever a new operation is added without
// adding its expected success and failure modes here.
const scenarioMatrix = {
  abandonedCart: {
    get: {
      positive: ['existing ID'],
      negative: ['missing ID', 'unauthorized', 'upstream not found'],
    },
    getAll: {
      positive: ['single page', 'keyword filter', 'return all', 'empty result'],
      negative: ['rate limited', 'unauthorized'],
    },
  },
  order: {
    get: {
      positive: ['existing ID'],
      negative: ['missing ID', 'not found'],
    },
    getAll: {
      positive: ['single page', 'return all', 'empty result'],
      negative: ['out-of-sequence page', 'rate limited'],
    },
    create: {
      positive: [
        'digital + pending payment',
        'digital + paid COD',
        'pickup + branch',
        'shipping + courier + ship_to',
        'matching product options',
        'multiple products',
        'coupon',
        'advanced JSON',
      ],
      negative: [
        'invalid customer ID',
        'invalid product ID',
        'quantity below one',
        'pending payment without accepted methods',
        'paid without method',
        'pickup without branch',
        'shipping without courier',
        'shipping without ship_to fields',
        'invalid address IDs',
        'partial coordinates',
        'mismatched product option',
        'malformed product option',
        'malformed additional-products JSON',
        'Salla 422 field errors',
      ],
    },
    updateStatus: {
      positive: ['valid order and status IDs'],
      negative: ['invalid transition', 'missing order', 'missing status'],
    },
    cancel: {
      positive: ['cancelable order and canceled status'],
      negative: ['already completed order', 'invalid cancel status'],
    },
  },
  product: {
    get: {
      positive: ['existing ID'],
      negative: ['not found'],
    },
    getAll: {
      positive: ['single page', 'return all', 'keyword filter', 'status filter', 'category array filter', 'empty result'],
      negative: ['rate limited', 'invalid page'],
    },
    create: {
      positive: ['minimal form', 'physical shipping fields', 'all additional fields', 'post-create image upload', 'advanced JSON'],
      negative: ['missing name', 'invalid price', 'upstream image failure'],
    },
    update: {
      positive: ['partial form update', 'ID-array transforms', 'nested metadata and promotion', 'advanced JSON'],
      negative: ['empty update', 'not found', 'validation error'],
    },
    delete: {
      positive: ['existing deletable product'],
      negative: ['product in use', 'not found'],
    },
    attachImage: {
      positive: ['main image', 'secondary image', 'alt and sort metadata'],
      negative: ['missing URL', 'unsafe URL', 'unsupported content', 'download timeout'],
    },
    updateQuantity: {
      positive: ['finite quantity', 'zero quantity', 'unlimited quantity'],
      negative: ['negative quantity', 'not found'],
    },
    updateInventoryBulk: {
      positive: ['easy-field adjustments', 'advanced JSON aliases', 'increment', 'decrement', 'overwrite'],
      negative: ['missing identifier', 'negative quantity', 'invalid adjustment mode', 'partial upstream failure'],
    },
  },
  productOption: {
    create: {
      positive: ['single form option', 'multiple form options', 'JSON object', 'JSON array', 'nested values'],
      negative: ['empty options', 'invalid JSON', 'upstream partial failure'],
    },
    get: {
      positive: ['existing option'],
      negative: ['not found'],
    },
    getAll: {
      positive: ['product with options', 'product without options'],
      negative: ['product not found'],
    },
    update: {
      positive: ['form merge', 'JSON object merge', 'bulk JSON merge', 'preserve values', 'replace values'],
      negative: ['invalid JSON', 'bulk entry without ID', 'partial bulk failure'],
    },
    updateValue: {
      positive: ['form merge', 'JSON object merge', 'bulk JSON merge', 'zero price and quantity', 'false default value'],
      negative: ['nothing to update', 'nonnumeric price', 'nonnumeric quantity', 'JSON entry without ID'],
    },
    delete: {
      positive: ['single ID', 'bulk IDs'],
      negative: ['invalid JSON', 'entry without ID', 'single upstream failure', 'partial bulk failure'],
    },
  },
  productVariant: {
    get: {
      positive: ['existing variant ID'],
      negative: ['missing ID', 'not found'],
    },
    getAll: {
      positive: ['product variants', 'single page', 'return all', 'empty result'],
      negative: ['missing product', 'rate limited'],
    },
    update: {
      positive: ['partial fields', 'branch quantities', 'advanced JSON'],
      negative: ['empty update', 'invalid branch quantity', 'not found'],
    },
    updateQuantity: {
      positive: ['increment', 'decrement', 'overwrite', 'branch and reason metadata'],
      negative: ['missing variant', 'negative quantity', 'invalid adjustment mode'],
    },
  },
  customer: {
    get: {
      positive: ['existing ID'],
      negative: ['not found'],
    },
    getAll: {
      positive: ['single page', 'return all', 'empty result'],
      negative: ['rate limited'],
    },
    create: {
      positive: ['minimal identity', 'gender birthday and groups', 'advanced JSON'],
      negative: ['invalid mobile', 'duplicate email', 'missing name'],
    },
    update: {
      positive: ['partial update', 'group-list transform', 'advanced JSON'],
      negative: ['duplicate mobile', 'not found'],
    },
  },
  coupon: {
    get: {
      positive: ['existing ID'],
      negative: ['not found'],
    },
    getAll: {
      positive: ['single page', 'return all', 'empty result'],
      negative: ['rate limited'],
    },
    create: {
      positive: ['percentage', 'fixed amount', 'free shipping', 'date range', 'limits and inclusion lists', 'advanced JSON'],
      negative: ['duplicate code', 'invalid date range', 'invalid amount'],
    },
    update: {
      positive: ['partial update', 'CSV-list transforms', 'brand-ID transform', 'advanced JSON'],
      negative: ['not found', 'validation error'],
    },
    delete: {
      positive: ['existing coupon'],
      negative: ['not found'],
    },
  },
  brand: {
    get: {
      positive: ['existing ID'],
      negative: ['not found'],
    },
    getAll: {
      positive: ['single page', 'return all', 'empty result'],
      negative: ['rate limited'],
    },
    create: {
      positive: ['logo upload', 'metadata', 'advanced JSON'],
      negative: ['missing logo', 'unsafe logo URL', 'duplicate name'],
    },
    update: {
      positive: ['text-only proxy update', 'logo upload update', 'metadata transform', 'advanced JSON'],
      negative: ['unsafe logo URL', 'not found'],
    },
    delete: {
      positive: ['unused brand'],
      negative: ['brand in use', 'not found'],
    },
  },
  category: {
    get: {
      positive: ['existing ID'],
      negative: ['not found'],
    },
    getAll: {
      positive: ['single page', 'return all', 'empty result'],
      negative: ['rate limited'],
    },
    create: {
      positive: ['root category', 'child category', 'image and metadata', 'advanced JSON'],
      negative: ['missing name', 'invalid parent'],
    },
    update: {
      positive: ['partial update', 'advanced JSON'],
      negative: ['circular parent', 'not found'],
    },
    delete: {
      positive: ['empty category'],
      negative: ['category in use', 'not found'],
    },
  },
  feedback: {
    getAll: {
      positive: ['all types', 'single type', 'multiple type fan-out', 'list filters', 'boolean filters', 'return all', 'empty result'],
      negative: ['invalid type', 'rate limited'],
    },
  },
  customApiCall: {
    makeRequest: {
      positive: ['GET', 'POST JSON', 'PUT JSON', 'PATCH JSON', 'DELETE', 'query string'],
      negative: ['invalid JSON', 'unauthorized endpoint', 'upstream validation error'],
    },
  },
};

module.exports = { scenarioMatrix };
