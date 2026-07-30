'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  executeOperation,
  findCall,
} = require('./node-harness');

test('product form creation maps every supported additional-field group', async () => {
  const { calls } = await executeOperation('product', 'create', {
    useCustomJson: false,
    productName: 'Physical Product',
    productPrice: 100,
    productType: 'product',
    productQuantity: 5,
    productDescription: 'Description',
    productRequireShipping: true,
    productSku: 'SKU-100',
    productSalePrice: 90,
    productAdditionalFields: {
      categories: ['10', '11'],
      brand_id: '12',
      cost_price: 50,
      sale_end: '2026-12-31',
      weight: 2.5,
      weight_type: 'kg',
      status: 'sale',
      with_tax: false,
      mpn: 'MPN-1',
      gtin: 'GTIN-1',
      promotion_title: 'Promo',
      promotion_sub_title: 'Subtitle',
      metadata_title: 'SEO title',
      metadata_description: 'SEO description',
      metadata_url: 'physical-product',
    },
  });

  assert.deepEqual(findCall(calls, 'POST', '/salla/products').body, {
    name: 'Physical Product',
    price: 100,
    product_type: 'product',
    quantity: 5,
    description: 'Description',
    require_shipping: true,
    weight: 2.5,
    sku: 'SKU-100',
    sale_price: 90,
    categories: [10, 11],
    brand_id: 12,
    cost_price: 50,
    sale_end: '2026-12-31',
    weight_type: 'kg',
    status: 'sale',
    with_tax: false,
    mpn: 'MPN-1',
    gtin: 'GTIN-1',
    promotion: { title: 'Promo', sub_title: 'Subtitle' },
    metadata: {
      title: 'SEO title',
      description: 'SEO description',
      url: 'physical-product',
    },
  });
});

test('product creation uploads image only after a successful product response', async () => {
  const { calls } = await executeOperation('product', 'create', {
    useCustomJson: false,
    productName: 'Product with image',
    productPrice: 10,
    productType: 'product',
    productQuantity: 1,
    productDescription: '',
    productRequireShipping: false,
    productSku: '',
    productSalePrice: 0,
    productAdditionalFields: { image_url: 'https://example.com/image.jpg' },
  });

  assert.equal(calls.length, 2);
  assert.ok(findCall(calls, 'POST', '/salla/products'));
  assert.deepEqual(findCall(calls, 'POST', '/salla-upload/products/999/images').body, {
    image_url: 'https://example.com/image.jpg',
  });
});

test('post-create image failure does not erase a successfully created product', async () => {
  const { output } = await executeOperation('product', 'create', {
    useCustomJson: false,
    productName: 'Product with unavailable image',
    productPrice: 10,
    productType: 'product',
    productQuantity: 1,
    productDescription: '',
    productRequireShipping: false,
    productSku: '',
    productSalePrice: 0,
    productAdditionalFields: { image_url: 'https://example.com/unavailable.jpg' },
  }, {
    httpRequest: async (request) => {
      if (request.url.includes('/salla-upload/')) throw new Error('image host unavailable');
      return { data: { id: 999, name: 'Created' } };
    },
  });

  assert.deepEqual(output[0][0].json, { id: 999, name: 'Created' });
});

test('product update converts IDs and nests promotion and metadata fields', async () => {
  const { calls } = await executeOperation('product', 'update', {
    useCustomJson: false,
    productId: '31',
    productUpdateFields: {
      name: 'Updated',
      categories: ['10', '11'],
      brand_id: '12',
      promotion_title: 'Promo',
      promotion_sub_title: 'Sub',
      metadata_title: 'SEO',
      metadata_description: 'Description',
      metadata_url: 'updated',
    },
  });

  assert.deepEqual(findCall(calls, 'PUT', '/salla/products/31').body, {
    name: 'Updated',
    categories: [10, 11],
    brand_id: 12,
    promotion: { title: 'Promo', sub_title: 'Sub' },
    metadata: { title: 'SEO', description: 'Description', url: 'updated' },
  });
});

test('product quantity has finite and unlimited contracts', async () => {
  const finite = await executeOperation('product', 'updateQuantity', {
    productId: '31',
    unlimitedQuantity: false,
    quantityValue: 0,
  });
  assert.deepEqual(findCall(finite.calls, 'PUT', '/salla/products/31').body, { quantity: 0 });

  const unlimited = await executeOperation('product', 'updateQuantity', {
    productId: '31',
    unlimitedQuantity: true,
    quantityValue: 20,
  });
  assert.deepEqual(findCall(unlimited.calls, 'PUT', '/salla/products/31').body, {
    unlimited_quantity: true,
  });
});

test('customer create and update transform group lists consistently', async () => {
  const created = await executeOperation('customer', 'create', {
    useCustomJson: false,
    customerFirstName: 'Test',
    customerLastName: 'Customer',
    customerMobile: '500000000',
    customerEmail: 'customer@example.com',
    customerCountryCode: '+966',
    customerAdditionalFields: {
      gender: 'male',
      birthday: '1990-01-01',
      groups: '10, 20,30',
    },
  });
  assert.deepEqual(findCall(created.calls, 'POST', '/salla/customers').body, {
    first_name: 'Test',
    last_name: 'Customer',
    mobile: '500000000',
    email: 'customer@example.com',
    mobile_code_country: '+966',
    gender: 'male',
    birthday: '1990-01-01',
    groups: ['10', '20', '30'],
  });

  const updated = await executeOperation('customer', 'update', {
    useCustomJson: false,
    customerId: '41',
    customerUpdateFields: { first_name: 'Updated', groups: '30,40' },
  });
  assert.deepEqual(findCall(updated.calls, 'PUT', '/salla/customers/41').body, {
    first_name: 'Updated',
    groups: ['30', '40'],
  });
});

test('coupon create and update transform lists, IDs, dates, and limits', async () => {
  const created = await executeOperation('coupon', 'create', {
    useCustomJson: false,
    couponCode: 'SAVE10',
    couponType: 'percentage',
    couponAmount: 10,
    couponFreeShipping: true,
    couponStartDate: '2026-01-01',
    couponExpiryDate: '2026-12-31',
    couponMaxAmount: 50,
    couponAdditionalFields: {
      exclude_sale_products: true,
      usage_limit: 100,
      usage_limit_per_user: 1,
      minimum_amount: 25,
      is_apply_with_offer: false,
      applied_in: 'app',
      include_product_ids: '1,2',
      exclude_category_ids: '3,4',
      include_customer_group_ids: '5',
      exclude_brands_ids: ['6', '7'],
      include_payment_methods: 'cod,bank',
    },
  });
  assert.deepEqual(findCall(created.calls, 'POST', '/salla/coupons').body, {
    code: 'SAVE10',
    type: 'percentage',
    amount: 10,
    free_shipping: true,
    exclude_sale_products: true,
    expiry_date: '2026-12-31',
    start_date: '2026-01-01',
    maximum_amount: 50,
    usage_limit: 100,
    usage_limit_per_user: 1,
    minimum_amount: 25,
    is_apply_with_offer: false,
    applied_in: 'app',
    include_product_ids: ['1', '2'],
    exclude_category_ids: ['3', '4'],
    include_customer_group_ids: ['5'],
    exclude_brands_ids: [6, 7],
    include_payment_methods: ['cod', 'bank'],
  });

  const updated = await executeOperation('coupon', 'update', {
    useCustomJson: false,
    couponId: '51',
    couponUpdateFields: {
      include_product_ids: '8,9',
      exclude_brands_ids: ['10'],
      include_payment_methods: 'cod',
    },
  });
  assert.deepEqual(findCall(updated.calls, 'PUT', '/salla/coupons/51').body, {
    include_product_ids: ['8', '9'],
    exclude_brands_ids: [10],
    include_payment_methods: ['cod'],
  });
});

test('brand create and logo update use upload endpoints while text-only update does not', async () => {
  const created = await executeOperation('brand', 'create', {
    useCustomJson: false,
    brandName: 'Brand',
    brandLogo: 'https://example.com/logo.png',
    brandAdditionalFields: {
      description: 'Description',
      banner: 'https://example.com/banner.png',
      status: 'active',
      metadata_title: 'SEO',
      metadata_description: 'Meta',
      metadata_url: 'brand',
    },
  });
  assert.deepEqual(findCall(created.calls, 'POST', '/salla-upload/brands').body, {
    name: 'Brand',
    logo_url: 'https://example.com/logo.png',
    description: 'Description',
    banner: 'https://example.com/banner.png',
    status: 'active',
    metadata_title: 'SEO',
    metadata_description: 'Meta',
    metadata_url: 'brand',
  });

  const textOnly = await executeOperation('brand', 'update', {
    useCustomJson: false,
    brandId: '61',
    brandUpdateFields: { name: 'Renamed', metadata_title: 'SEO' },
  });
  assert.deepEqual(findCall(textOnly.calls, 'PUT', '/salla/brands/61').body, {
    name: 'Renamed',
    metadata_title: 'SEO',
  });

  const logo = await executeOperation('brand', 'update', {
    useCustomJson: false,
    brandId: '61',
    brandUpdateFields: { logo_url: 'https://example.com/new-logo.png' },
  });
  assert.ok(findCall(logo.calls, 'PUT', '/salla-upload/brands/61'));
});

test('category create converts parent ID and forwards optional metadata', async () => {
  const { calls } = await executeOperation('category', 'create', {
    useCustomJson: false,
    categoryName: 'Child',
    categoryAdditionalFields: {
      parent_id: '70',
      image: 'https://example.com/category.png',
      status: 'active',
      metadata_title: 'SEO',
      metadata_description: 'Meta',
      metadata_url: 'child',
    },
  });

  assert.deepEqual(findCall(calls, 'POST', '/salla/categories').body, {
    name: 'Child',
    parent_id: 70,
    image: 'https://example.com/category.png',
    status: 'active',
    metadata_title: 'SEO',
    metadata_description: 'Meta',
    metadata_url: 'child',
  });
});

test('status update and cancel both send numeric status IDs', async () => {
  const updated = await executeOperation('order', 'updateStatus', {
    orderId: '21',
    statusId: '81',
  });
  assert.deepEqual(findCall(updated.calls, 'POST', '/salla/orders/21/status').body, {
    status_id: 81,
  });

  const canceled = await executeOperation('order', 'cancel', {
    orderId: '21',
    statusId: '82',
  });
  assert.deepEqual(findCall(canceled.calls, 'POST', '/salla/orders/21/status').body, {
    status_id: 82,
  });
});

test('custom API supports every method and sends bodies only for body methods', async () => {
  for (const method of ['POST', 'PUT', 'PATCH']) {
    const { calls } = await executeOperation('customApiCall', 'makeRequest', {
      customMethod: method,
      customEndpoint: 'orders/21',
      customQuery: '',
      customBody: '{"note":"test"}',
    });
    assert.deepEqual(calls[0].body, { note: 'test' });
  }

  for (const method of ['GET', 'DELETE']) {
    const { calls } = await executeOperation('customApiCall', 'makeRequest', {
      customMethod: method,
      customEndpoint: '/orders/21',
      customQuery: 'format=light',
    });
    assert.equal(calls[0].body, undefined);
    assert.match(calls[0].url, /\?format=light$/);
  }
});
