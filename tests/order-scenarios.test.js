'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SallaFlow,
  executeOperation,
  findCall,
} = require('./node-harness');

const baseOrder = {
  useCustomJson: false,
  orderCustomerId: '41001',
  orderProductId: '31001',
  orderProductQty: 1,
  orderPaymentStatus: 'pending_payment',
  orderAcceptedMethods: ['cod'],
  orderDeliveryMethod: '',
  orderProductOptions: [],
  orderAdditionalFields: {},
};

const shippingAddress = {
  name: 'Test Receiver',
  email: 'receiver@example.com',
  phone: '966500000000',
  country: '101',
  city: '201',
  district: '301',
  block: 'Al Olaya',
  street_number: '8230',
  address: 'Test delivery address',
  address_line: 'Building 10',
  postal_code: '12345',
  short_address: 'TEST1234',
  building_number: '10',
  additional_number: '20',
  latitude: 24.7136,
  longitude: 46.6753,
};

function orderCall(calls) {
  return findCall(calls, 'POST', '/salla/orders');
}

test('order descriptor exposes conditional pickup and shipping inputs', () => {
  const node = new SallaFlow();
  const properties = new Map(node.description.properties.map((property) => [property.name, property]));

  assert.deepEqual(
    properties.get('orderCourierId').displayOptions.show.orderDeliveryMethod,
    ['shipping'],
  );
  assert.equal(properties.get('orderCourierId').typeOptions.loadOptionsMethod, 'getShippingCompanies');
  assert.deepEqual(
    properties.get('orderShipTo').displayOptions.show.orderDeliveryMethod,
    ['shipping'],
  );

  const additionalFields = properties.get('orderAdditionalFields').options;
  assert.ok(additionalFields.some((field) => field.name === 'branch_id'));
});

test('digital pending-payment order omits delivery-only fields', async () => {
  const { calls } = await executeOperation('order', 'create', baseOrder);
  const request = orderCall(calls);

  assert.deepEqual(request.body, {
    customer: { id: 41001 },
    products: [{
      identifier_type: 'id',
      identifier: 31001,
      quantity: 1,
    }],
    payment: {
      status: 'pending_payment',
      accepted_methods: ['cod'],
    },
  });
  assert.equal(request.body.courier_id, undefined);
  assert.equal(request.body.ship_to, undefined);
  assert.equal(request.body.branch_id, undefined);
});

test('pickup order includes branch and does not require courier or ship_to', async () => {
  const { calls } = await executeOperation('order', 'create', {
    ...baseOrder,
    orderDeliveryMethod: 'pickup',
    orderAdditionalFields: { branch_id: '801' },
  });

  assert.deepEqual(orderCall(calls).body, {
    customer: { id: 41001 },
    products: [{
      identifier_type: 'id',
      identifier: 31001,
      quantity: 1,
    }],
    payment: {
      status: 'pending_payment',
      accepted_methods: ['cod'],
    },
    delivery_method: 'pickup',
    branch_id: 801,
  });
});

test('pickup order rejects a missing branch before calling the backend', async () => {
  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderDeliveryMethod: 'pickup',
    }),
    /Branch is required when Delivery Method is Pickup/,
  );
});

test('shipping order sends courier_id and the complete ship_to object', async () => {
  const { calls } = await executeOperation('order', 'create', {
    ...baseOrder,
    orderDeliveryMethod: 'shipping',
    orderCourierId: '901',
    orderShipTo: shippingAddress,
  });
  const body = orderCall(calls).body;

  assert.equal(body.delivery_method, 'shipping');
  assert.equal(body.courier_id, 901);
  assert.deepEqual(body.ship_to, {
    name: 'Test Receiver',
    email: 'receiver@example.com',
    phone: '966500000000',
    country: 101,
    city: 201,
    district: 301,
    block: 'Al Olaya',
    street_number: '8230',
    address: 'Test delivery address',
    address_line: 'Building 10',
    postal_code: '12345',
    short_address: 'TEST1234',
    building_number: '10',
    additional_number: '20',
    geo_coordinates: {
      lat: 24.7136,
      lng: 46.6753,
    },
  });
});

test('shipping order rejects missing courier before calling the backend', async () => {
  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderDeliveryMethod: 'shipping',
      orderCourierId: '',
      orderShipTo: shippingAddress,
    }),
    /Courier is required when Delivery Method is Shipping/,
  );
});

test('shipping order rejects missing destination fields before calling the backend', async () => {
  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderDeliveryMethod: 'shipping',
      orderCourierId: '901',
      orderShipTo: { country: '101', city: '201' },
    }),
    /Shipping Address is missing:.*Block.*Street Number.*Address.*Address Line.*Postal Code/,
  );
});

test('shipping order validates IDs and coordinate pairs', async () => {
  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderDeliveryMethod: 'shipping',
      orderCourierId: '901',
      orderShipTo: { ...shippingAddress, country: 'Saudi Arabia' },
    }),
    /country must be a valid numeric Salla ID/,
  );

  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderDeliveryMethod: 'shipping',
      orderCourierId: '901',
      orderShipTo: { ...shippingAddress, longitude: 0 },
    }),
    /requires both Latitude and Longitude/,
  );
});

test('paid COD and pending orders produce different payment contracts', async () => {
  const paid = await executeOperation('order', 'create', {
    ...baseOrder,
    orderPaymentStatus: 'paid',
    orderPaymentMethod: 'cod',
  });
  assert.deepEqual(orderCall(paid.calls).body.payment, {
    status: 'paid',
    method: 'cod',
    cash_on_delivery: { amount: 0, currency: 'SAR' },
  });

  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderAcceptedMethods: [],
    }),
    /Select at least one Accepted Payment Method/,
  );
});

test('order validates customer, product, and quantity at runtime', async () => {
  const cases = [
    [{ orderCustomerId: '' }, /Customer is required/],
    [{ orderProductId: 'not-an-id' }, /Product is required/],
    [{ orderProductQty: 0 }, /Quantity must be at least 1|quantity must be a number of 1 or more/i],
  ];

  for (const [overrides, error] of cases) {
    await assert.rejects(
      () => executeOperation('order', 'create', { ...baseOrder, ...overrides }),
      error,
    );
  }
});

test('order groups matching product options and rejects mismatched or malformed options', async () => {
  const valid = await executeOperation('order', 'create', {
    ...baseOrder,
    orderProductOptions: [
      '31001|3201|3301',
      '31001|3201|3302',
      '31001|3202|3303',
    ],
  });
  assert.deepEqual(orderCall(valid.calls).body.products[0].options, [
    { id: 3201, value: ['3301', '3302'] },
    { id: 3202, value: ['3303'] },
  ]);

  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderProductOptions: ['999|3201|3301'],
    }),
    /belongs to product 999/,
  );
  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderProductOptions: ['31001|broken'],
    }),
    /is malformed/,
  );
});

test('additional products must be a JSON array and valid arrays are forwarded', async () => {
  const valid = await executeOperation('order', 'create', {
    ...baseOrder,
    orderAdditionalFields: {
      coupon_code: 'SAVE10',
      extra_products: JSON.stringify([
        { identifier_type: 'sku', identifier: 'SKU-2', quantity: 2 },
      ]),
    },
  });
  const body = orderCall(valid.calls).body;
  assert.equal(body.coupon_code, 'SAVE10');
  assert.equal(body.products.length, 2);
  assert.deepEqual(body.products[1], {
    identifier_type: 'sku',
    identifier: 'SKU-2',
    quantity: 2,
  });

  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderAdditionalFields: { extra_products: '{invalid' },
    }),
    /Additional Products(?: JSON)? is not valid JSON/,
  );
  await assert.rejects(
    () => executeOperation('order', 'create', {
      ...baseOrder,
      orderAdditionalFields: { extra_products: '{"not":"an array"}' },
    }),
    /Additional Products(?: JSON)? must be a JSON array/,
  );
});

test('advanced JSON order mode forwards the caller contract unchanged', async () => {
  const advancedBody = {
    customer: { id: 41001 },
    delivery_method: 'shipping',
    courier_id: 901,
    ship_to: { country: 101, city: 201 },
    payment: { status: 'paid', method: 'bank' },
    products: [{ identifier_type: 'sku', identifier: 'SKU-1', quantity: 1 }],
  };
  const { calls } = await executeOperation('order', 'create', {
    useCustomJson: true,
    customJsonBody: JSON.stringify(advancedBody),
  });

  assert.deepEqual(orderCall(calls).body, advancedBody);
});

test('shipping-company dropdown maps the active couriers returned by the backend', async () => {
  const node = new SallaFlow();
  const calls = [];
  const context = {
    getCredentials: async () => ({ apiKey: 'test-key' }),
    helpers: {
      httpRequestWithAuthentication: async (_credentialType, request) => {
        calls.push(request);
        return {
          data: [
            { id: 9101, name: 'SMSA', activation_type: 'manual' },
            { id: 9102, name: 'DHL Express', activation_type: 'api' },
          ],
        };
      },
    },
  };

  const options = await node.methods.loadOptions.getShippingCompanies.call(context);
  assert.deepEqual(options, [
    { name: 'SMSA (manual)', value: '9101' },
    { name: 'DHL Express (api)', value: '9102' },
  ]);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/salla\/shipping\/companies\/$/);
});
