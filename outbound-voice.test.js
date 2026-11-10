import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOutboundTranscript } from './outbound-voice.js';

const NOW = new Date(2026, 10, 10, 12, 0, 0); // Tue Nov 10, 2026
const CUSTOMERS = [
  'Northwind Trading',
  'Bright Harbor Goods',
  'Lumen Home Co',
  'Costa Mesa Supply',
  'Pacific Sample Works',
];

function parse(text, customers = CUSTOMERS) {
  return parseOutboundTranscript(text, { customers, now: NOW });
}

function expectFilled(result, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(result.fields[key], value, `${key} should be ${JSON.stringify(value)}, got ${JSON.stringify(result.fields[key])}`);
    if (value == null) assert.equal(result.filled.includes(key), false, `${key} should not be filled`);
    else assert.equal(result.filled.includes(key), true, `${key} should be filled`);
  }
}

test('empty transcript fills nothing and highlights nothing', () => {
  const result = parse('   ');
  for (const key of Object.keys(result.fields)) assert.equal(result.fields[key], null);
  assert.deepEqual(result.filled, []);
  assert.deepEqual(result.ambiguous, []);
});

test('unrelated speech is not guessed into fields', () => {
  const result = parse('hello warehouse team please stand by');
  for (const key of Object.keys(result.fields)) assert.equal(result.fields[key], null);
  assert.deepEqual(result.ambiguous, []);
});

test('English full shipment', () => {
  const result = parse(
    'Customer Northwind Trading, PO 48213, ship tomorrow, carrier pickup, Old Dominion, 20 pallets, 12 cartons, 8 SKUs, BOL 2291, note sort by aisle'
  );
  expectFilled(result, {
    customer: 'Northwind Trading',
    reference: 'PO-48213',
    shipDate: '2026-11-11',
    method: 'pickup',
    carrier: 'Old Dominion',
    cartons: '12 cartons, 20 pallets',
    skus: '8',
    tag: 'BOL-2291',
    note: 'sort by aisle',
  });
  assert.deepEqual(result.ambiguous, []);
});

test('English spoken digits and cardinals', () => {
  const result = parse('order number four eight two one three, thirty cartons, ship today, twenty three pallets');
  expectFilled(result, {
    reference: '48213',
    cartons: '30 cartons, 23 pallets',
    shipDate: '2026-11-10',
  });
});

test('English one hundred forty five cartons and company delivery', () => {
  const result = parse('company delivery tomorrow, one hundred forty five cartons');
  expectFilled(result, {
    method: 'delivery',
    shipDate: '2026-11-11',
    cartons: '145 cartons',
  });
});

test('PO keyword alone is ambiguous and stays blank', () => {
  const result = parse('PO for Northwind Trading ship tomorrow');
  expectFilled(result, {
    customer: 'Northwind Trading',
    reference: null,
    shipDate: '2026-11-11',
  });
  assert.ok(result.ambiguous.includes('reference'));
  assert.equal(result.filled.includes('reference'), false);
});

test('bare number is not guessed as an order number', () => {
  const result = parse('48213 tomorrow');
  expectFilled(result, { reference: null, shipDate: '2026-11-11' });
  assert.equal(result.ambiguous.includes('reference'), false);
});

test('two different PO numbers stay blank', () => {
  const result = parse('PO 111 and PO 222 ship today');
  expectFilled(result, { reference: null, shipDate: '2026-11-10' });
  assert.ok(result.ambiguous.includes('reference'));
});

test('pickup and delivery together are ambiguous', () => {
  const result = parse('pickup and delivery tomorrow for Northwind Trading');
  expectFilled(result, {
    method: null,
    shipDate: '2026-11-11',
    customer: 'Northwind Trading',
  });
  assert.ok(result.ambiguous.includes('method'));
});

test('delivery date sets the ship date and not the method', () => {
  const result = parse('delivery date November 12, customer Lumen Home Co');
  expectFilled(result, {
    shipDate: '2026-11-12',
    method: null,
    customer: 'Lumen Home Co',
  });
  assert.equal(result.ambiguous.includes('method'), false);
  assert.equal(result.ambiguous.includes('shipDate'), false);
});

test('weekday and next week stay blank', () => {
  const monday = parse('Monday pickup');
  expectFilled(monday, { shipDate: null, method: 'pickup' });
  assert.ok(monday.ambiguous.includes('shipDate'));

  const next = parse('ship next week, Old Dominion');
  expectFilled(next, { shipDate: null, carrier: 'Old Dominion' });
  assert.ok(next.ambiguous.includes('shipDate'));
});

test('a past month-day without a year is not rolled forward', () => {
  const result = parse('November 2 pickup');
  expectFilled(result, { shipDate: null, method: 'pickup' });
  assert.ok(result.ambiguous.includes('shipDate'));
});

test('today and tomorrow together are ambiguous', () => {
  const result = parse('ship today or tomorrow, 10 cartons');
  expectFilled(result, { shipDate: null, cartons: '10 cartons' });
  assert.ok(result.ambiguous.includes('shipDate'));
});

test('or-quantities and about-quantities stay blank', () => {
  const either = parse('12 or 15 pallets ship today');
  expectFilled(either, { cartons: null, shipDate: '2026-11-10' });
  assert.ok(either.ambiguous.includes('cartons'));

  const about = parse('about 20 pallets');
  expectFilled(about, { cartons: null });
  assert.ok(about.ambiguous.includes('cartons'));
});

test('pallets mentioned without a number are highlighted', () => {
  const result = parse('pallets tomorrow pickup');
  expectFilled(result, { cartons: null, shipDate: '2026-11-11', method: 'pickup' });
  assert.ok(result.ambiguous.includes('cartons'));
});

test('two carriers or a TBD carrier stay blank', () => {
  const either = parse('Estes or Saia will pick up');
  expectFilled(either, { carrier: null, method: 'pickup' });
  assert.ok(either.ambiguous.includes('carrier'));

  const tbd = parse('carrier TBD, customer Pacific Sample Works, 10 cartons');
  expectFilled(tbd, {
    carrier: null,
    customer: 'Pacific Sample Works',
    cartons: '10 cartons',
  });
  assert.ok(tbd.ambiguous.includes('carrier'));
});

test('unique customer prefix uses the stored name', () => {
  const result = parse('Northwind PO 100 ship today pickup');
  expectFilled(result, { customer: 'Northwind Trading', reference: 'PO-100', method: 'pickup' });
});

test('shared customer prefix stays blank', () => {
  const result = parse('Northwind PO 100', ['Northwind Trading', 'Northwind Foods']);
  expectFilled(result, { customer: null, reference: 'PO-100' });
  assert.ok(result.ambiguous.includes('customer'));
});

test('two full customer names stay blank', () => {
  const result = parse('Northwind Trading or Bright Harbor Goods PO 100 ship today pickup');
  expectFilled(result, { customer: null, reference: 'PO-100', shipDate: '2026-11-10', method: 'pickup' });
  assert.ok(result.ambiguous.includes('customer'));
});

test('explicit customer typo within one edit uses the stored name', () => {
  const result = parse('customer Northwind Tradng, 4 pallets');
  expectFilled(result, { customer: 'Northwind Trading', cartons: '4 pallets' });
});

test('explicit unknown customer is kept verbatim and not matched loosely', () => {
  const result = parse('customer Harbor Lane Goods, PO 77, delivery');
  expectFilled(result, {
    customer: 'Harbor Lane Goods',
    reference: 'PO-77',
    method: 'delivery',
  });
  assert.equal(result.fields.customer === 'Bright Harbor Goods', false);
});

test('Spanish shipment with spoken numbers', () => {
  const result = parse(
    'Cliente Costa Mesa Supply pedido 5521 para mañana entrega 30 cajas y 4 tarimas guía 7788 nota frágil ocho códigos'
  );
  expectFilled(result, {
    customer: 'Costa Mesa Supply',
    reference: '5521',
    shipDate: '2026-11-11',
    method: 'delivery',
    cartons: '30 cartons, 4 pallets',
    tag: 'BOL-7788',
    note: 'frágil',
    skus: '8',
  });
  assert.deepEqual(result.ambiguous, []);
});

test('Spanish treinta y dos, veintitrés, hoy, recoger', () => {
  const boxes = parse('treinta y dos cajas');
  expectFilled(boxes, { cartons: '32 cartons' });

  const pallets = parse('veintitrés tarimas');
  expectFilled(pallets, { cartons: '23 pallets' });

  const when = parse('hoy recoger, cliente Lumen Home Co');
  expectFilled(when, { shipDate: '2026-11-10', method: 'pickup', customer: 'Lumen Home Co' });
});

test('Spanish spoken PO digits', () => {
  const result = parse('po cuatro ocho dos uno tres, una tarima');
  expectFilled(result, { reference: 'PO-48213', cartons: '1 pallet' });
});

test('Mandarin shipment', () => {
  const result = parse('客户 Bright Harbor Goods 订单号 10086 明天 送货 三十箱 两托盘 提单 5566 备注 易碎 十二个SKU');
  expectFilled(result, {
    customer: 'Bright Harbor Goods',
    reference: '10086',
    shipDate: '2026-11-11',
    method: 'delivery',
    cartons: '30 cartons, 2 pallets',
    tag: 'BOL-5566',
    note: '易碎',
    skus: '12',
  });
  assert.deepEqual(result.ambiguous, []);
});

test('Mandarin today, pickup, twelve cartons, two pallets, 235 cartons', () => {
  const when = parse('今天自提');
  expectFilled(when, { shipDate: '2026-11-10', method: 'pickup' });

  const twelve = parse('十二箱');
  expectFilled(twelve, { cartons: '12 cartons' });

  const two = parse('两个托盘');
  expectFilled(two, { cartons: '2 pallets' });

  const big = parse('两百三十五箱');
  expectFilled(big, { cartons: '235 cartons' });
});

test('mixed English, Spanish, and Mandarin in one utterance', () => {
  const one = parse('Lumen Home Co PO 48213 mañana 20 tarimas pickup BOL 2291');
  expectFilled(one, {
    customer: 'Lumen Home Co',
    reference: 'PO-48213',
    shipDate: '2026-11-11',
    cartons: '20 pallets',
    method: 'pickup',
    tag: 'BOL-2291',
  });

  const two = parse('Northwind Trading 明天 12 cartons 自提');
  expectFilled(two, {
    customer: 'Northwind Trading',
    shipDate: '2026-11-11',
    cartons: '12 cartons',
    method: 'pickup',
  });

  const three = parse('customer Costa Mesa Supply 三十箱 tomorrow pickup');
  expectFilled(three, {
    customer: 'Costa Mesa Supply',
    cartons: '30 cartons',
    shipDate: '2026-11-11',
    method: 'pickup',
  });
});

test('Mandarin pickup and delivery together stay blank', () => {
  const result = parse('自提还是送货 明天 十箱');
  expectFilled(result, { method: null, shipDate: '2026-11-11', cartons: '10 cartons' });
  assert.ok(result.ambiguous.includes('method'));
});

test('SKU without a count is ambiguous', () => {
  const result = parse('customer Pacific Sample Works, SKU, pickup');
  expectFilled(result, { customer: 'Pacific Sample Works', skus: null, method: 'pickup' });
  assert.ok(result.ambiguous.includes('skus'));
});

test('filled and ambiguous never overlap, and ambiguous values are null', () => {
  const samples = [
    'PO for Northwind Trading',
    'pickup and delivery',
    '12 or 15 pallets',
    'Estes or Saia',
    'ship next week',
    'note , PO 12',
    '',
  ];
  for (const sample of samples) {
    const result = parse(sample);
    for (const key of result.ambiguous) {
      assert.equal(result.fields[key], null, sample);
      assert.equal(result.filled.includes(key), false, sample);
    }
    for (const key of result.filled) {
      assert.notEqual(result.fields[key], null);
      assert.equal(result.ambiguous.includes(key), false);
    }
  }
});
