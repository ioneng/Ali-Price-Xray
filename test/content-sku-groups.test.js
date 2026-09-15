const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGroups() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'extension', 'content-sku-groups.js'), 'utf8'),
    context
  );
  return context;
}

function sku(id, visibleValue, hiddenValue, price, salable, stock = 0) {
  return {
    skuId: id,
    skuAttr: `200007763:${hiddenValue};14:${visibleValue}#Option ${visibleValue}`,
    skuPath: `14:${visibleValue};200007763:${hiddenValue}`,
    salePrice: price,
    salePriceString: `AU$${price.toFixed(2)}`,
    currency: 'AUD',
    salable,
    stock
  };
}

test('collapses hidden backend paths into customer-visible SKU groups', () => {
  const context = loadGroups();
  const raw = [
    sku('a-1', '10', 'AU', 77.93, true, 10),
    sku('a-2', '10', 'US', 80.44, true, 20),
    sku('a-3', '10', 'EU', 77.93, false),
    sku('b-1', '20', 'AU', 110, true, 30),
    sku('b-2', '20', 'US', 110, false)
  ];

  const grouped = context.xrayGroupVisibleSkus(raw);
  assert.equal(raw.length, 5);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].salable, true);
  assert.equal(grouped[0].salePrice, 77.93);
  assert.equal(grouped[0].salePriceString, null);
  assert.deepEqual(JSON.parse(JSON.stringify(grouped[0].xrayVisibleGroup)), {
    rawCount: 3,
    saleableCount: 2,
    unknownCount: 0,
    min: 77.93,
    max: 80.44,
    skuIds: ['a-1', 'a-2', 'a-3']
  });
});

test('keeps ordinary one-path visible choices unchanged', () => {
  const context = loadGroups();
  const grouped = context.xrayGroupVisibleSkus([
    { skuId: '1', skuAttr: '14:1#2C23T', skuPath: '14:1', salePrice: 97.99, salePriceString: 'AU$97.99', salable: true, stock: 991 },
    { skuId: '2', skuAttr: '14:2#2C53T', skuPath: '14:2', salePrice: 124.39, salePriceString: 'AU$124.39', salable: true, stock: 996 }
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].salePriceString, 'AU$97.99');
  assert.equal(grouped[0].stock, 991);
  assert.equal(grouped[0].xrayVisibleGroup.rawCount, 1);
});

test('retains an unavailable group when every hidden path is sold out', () => {
  const context = loadGroups();
  const [grouped] = context.xrayGroupVisibleSkus([
    sku('a-1', '10', 'AU', 77.93, false),
    sku('a-2', '10', 'US', 80.44, false)
  ]);

  assert.equal(grouped.salable, false);
  assert.equal(grouped.xrayVisibleGroup.rawCount, 2);
  assert.equal(grouped.xrayVisibleGroup.saleableCount, 0);
});

test('does not merge unlabeled paths or distinct visible value IDs', () => {
  const context = loadGroups();
  const grouped = context.xrayGroupVisibleSkus([
    { skuId: '1', skuAttr: '14:1#Black', skuPath: '14:1', salable: true },
    { skuId: '2', skuAttr: '14:2#Black', skuPath: '14:2', salable: true },
    { skuId: '3', skuAttr: '', skuPath: '14:3', salable: true },
    { skuId: '4', skuAttr: '', skuPath: '14:4', salable: true }
  ]);

  assert.equal(grouped.length, 4);
});
